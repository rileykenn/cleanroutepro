import { TeamSchedule, StaffMember } from './types';
import { parseTime } from './timeUtils';

export type WarningLevel = 'error' | 'warning' | 'info';

export interface ScheduleWarning {
  id: string;
  level: WarningLevel;
  title: string;
  detail: string;
  teamIds?: string[];
  staffId?: string;
}

function formatMins(totalMins: number): string {
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const dh = h % 12 || 12;
  return `${dh}:${m.toString().padStart(2, '0')} ${period}`;
}

function minsReadable(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface TeamWindow {
  teamId: string;
  teamName: string;
  start: number;  // minutes from midnight
  end: number;
  hasTimes: boolean;
}

function buildTeamWindows(teams: TeamSchedule[]): TeamWindow[] {
  return teams.map(team => {
    const timed = team.clients.filter(c => c.startTime && c.endTime);
    if (timed.length === 0) {
      const base = parseTime(team.dayStartTime);
      return { teamId: team.id, teamName: team.name, start: base, end: base + 480, hasTimes: false };
    }
    const starts = timed.map(c => parseTime(c.startTime!));
    const ends   = timed.map(c => parseTime(c.endTime!));
    return { teamId: team.id, teamName: team.name, start: Math.min(...starts), end: Math.max(...ends), hasTimes: true };
  });
}

function overlaps(a: TeamWindow, b: TeamWindow): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Compute all scheduling warnings for a single day given the teams array.
 * Pure function — no side effects, no API calls.
 */
export function computeDayWarnings(
  teams: TeamSchedule[],
  allStaff: StaffMember[],
): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  if (teams.length === 0) return warnings;

  const staffMap = new Map(allStaff.map(s => [s.id, s]));
  const windows = buildTeamWindows(teams);

  // ── 1. Staff assigned to multiple teams ─────────────────────────────────
  // staffTeams: staffId → list of teamIds they appear in
  const staffTeams = new Map<string, string[]>();
  for (const team of teams) {
    for (const sid of team.staffIds || []) {
      const list = staffTeams.get(sid) || [];
      list.push(team.id);
      staffTeams.set(sid, list);
    }
  }

  for (const [staffId, assignedTeamIds] of staffTeams) {
    if (assignedTeamIds.length < 2) continue;
    const staff = staffMap.get(staffId);
    if (!staff) continue;

    // Check all unique pairs for time overlap
    for (let i = 0; i < assignedTeamIds.length; i++) {
      for (let j = i + 1; j < assignedTeamIds.length; j++) {
        const winA = windows.find(w => w.teamId === assignedTeamIds[i]);
        const winB = windows.find(w => w.teamId === assignedTeamIds[j]);
        if (!winA || !winB) continue;

        if (overlaps(winA, winB)) {
          // Only warn when at least one side has real computed times
          if (!winA.hasTimes && !winB.hasTimes) continue;
          warnings.push({
            id: `overlap-${staffId}-${winA.teamId}-${winB.teamId}`,
            level: 'error',
            title: `${staff.name} has a scheduling conflict`,
            detail: `${winA.teamName} (${formatMins(winA.start)}–${formatMins(winA.end)}) overlaps ${winB.teamName} (${formatMins(winB.start)}–${formatMins(winB.end)}). Swap ${staff.name} out of one team.`,
            teamIds: [winA.teamId, winB.teamId],
            staffId,
          });
        } else {
          // Non-overlapping — check travel feasibility between the two teams.
          // Order by which team starts first so we know the finishing→starting direction.
          const teamAEntry = { win: winA, team: teams.find(t => t.id === winA.teamId)! };
          const teamBEntry = { win: winB, team: teams.find(t => t.id === winB.teamId)! };
          const finisher  = winA.start <= winB.start ? teamAEntry : teamBEntry;
          const starter   = winA.start <= winB.start ? teamBEntry : teamAEntry;

          if (!finisher.win.hasTimes || !starter.win.hasTimes) continue;
          if (!finisher.team || !starter.team) continue;

          // Last timed job on the finishing team, first timed job on the starting team
          const finisherJobs = finisher.team.clients
            .filter(c => c.startTime && c.endTime)
            .sort((a, b) => parseTime(b.endTime!) - parseTime(a.endTime!));
          const starterJobs = starter.team.clients
            .filter(c => c.startTime && c.endTime)
            .sort((a, b) => parseTime(a.startTime!) - parseTime(b.startTime!));

          if (!finisherJobs.length || !starterJobs.length) continue;

          const lastJob  = finisherJobs[0];
          const firstJob = starterJobs[0];
          const gapMins  = parseTime(firstJob.startTime!) - parseTime(lastJob.endTime!);
          if (gapMins <= 0) continue;

          // Use live travel segment if available, otherwise haversine at 60 km/h
          const lat1 = lastJob.location.lat;
          const lng1 = lastJob.location.lng;
          const lat2 = firstJob.location.lat;
          const lng2 = firstJob.location.lng;
          if (!lat1 || !lng1 || !lat2 || !lng2) continue;

          const segKey  = `${lastJob.id}->${firstJob.id}`;
          const liveSeg = finisher.team.travelSegments?.get(segKey);
          let travelMins: number;
          let isEstimate: boolean;

          if (liveSeg && !liveSeg.isCalculating && liveSeg.durationMinutes > 0) {
            travelMins = liveSeg.durationMinutes;
            isEstimate = false;
          } else {
            const distKm = haversineKm(lat1, lng1, lat2, lng2);
            if (distKm < 2) continue; // ignore trivially close locations
            travelMins = Math.ceil(distKm / 60 * 60); // 60 km/h avg
            isEstimate = true;
          }

          if (travelMins > gapMins) {
            const endStr   = formatMins(parseTime(lastJob.endTime!));
            const startStr = formatMins(parseTime(firstJob.startTime!));
            const est = isEstimate ? ' (est.)' : '';
            warnings.push({
              id: `travel-${staffId}-${finisher.win.teamId}-${starter.win.teamId}`,
              level: 'warning',
              title: `${staff.name} may not make it between teams`,
              detail: `${finisher.win.teamName} ends at ${endStr}, ${starter.win.teamName} starts at ${startStr} — only ${minsReadable(gapMins)} gap, ~${minsReadable(travelMins)} drive needed${est}. Delay ${starter.win.teamName}'s start or swap staff.`,
              teamIds: [finisher.win.teamId, starter.win.teamId],
              staffId,
            });
          }
        }
      }
    }
  }

  // ── 2. No staff assigned to a team that has jobs ─────────────────────────
  for (const team of teams) {
    if (team.clients.length === 0) continue;
    if ((team.staffIds || []).length === 0) {
      warnings.push({
        id: `no-staff-${team.id}`,
        level: 'info',
        title: `${team.name} has no staff assigned`,
        detail: `Add at least one staff member to ${team.name} for this day.`,
        teamIds: [team.id],
      });
    }
  }

  return warnings;
}

/**
 * Returns the highest severity level in a list of warnings.
 */
export function maxWarningLevel(warnings: ScheduleWarning[]): WarningLevel | null {
  if (warnings.some(w => w.level === 'error'))   return 'error';
  if (warnings.some(w => w.level === 'warning')) return 'warning';
  if (warnings.some(w => w.level === 'info'))    return 'info';
  return null;
}

/**
 * Time-overlap check exported for use in the staff picker.
 * Returns { overlapping: true, teamName } if the staff member's OTHER team time
 * window overlaps with the given (myStart, myEnd) window, else { overlapping: false }.
 */
export function getStaffConflict(
  staffId: string,
  teams: TeamSchedule[],
  activeTeamId: string,
): { overlapping: boolean; teamName: string } | null {
  const windows = buildTeamWindows(teams);
  const myWin = windows.find(w => w.teamId === activeTeamId);
  if (!myWin) return null;

  for (const team of teams) {
    if (team.id === activeTeamId) continue;
    if (!(team.staffIds || []).includes(staffId)) continue;
    const otherWin = windows.find(w => w.teamId === team.id);
    if (!otherWin) continue;
    if (overlaps(myWin, otherWin)) {
      return { overlapping: true, teamName: team.name };
    }
    // Non-overlapping — return info about the shared assignment
    return { overlapping: false, teamName: team.name };
  }
  return null;
}

/**
 * For a staff member, return the formatted end time of their OTHER team window
 * (used to show "Shared · Team X ends 5:32 PM" in the picker).
 */
export function getOtherTeamEndLabel(
  staffId: string,
  teams: TeamSchedule[],
  activeTeamId: string,
): string | null {
  const windows = buildTeamWindows(teams);
  for (const team of teams) {
    if (team.id === activeTeamId) continue;
    if (!(team.staffIds || []).includes(staffId)) continue;
    const win = windows.find(w => w.teamId === team.id);
    if (!win || !win.hasTimes) return `Shared · ${team.name}`;
    return `Shared · ${team.name} ends ${formatMins(win.end)}`;
  }
  return null;
}
