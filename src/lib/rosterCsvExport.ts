'use client';

import { TeamSchedule, StaffMember, DaySummary } from './types';
import { calculateDaySummary, calculateScheduleTimes } from './routeEngine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip trailing state, postcode, and country from an address string. */
function cleanAddress(address: string): string {
  return address
    .replace(/,?\s*Australia\s*$/i, '')
    .replace(/,?\s*(?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s*\d{4}\s*$/i, '')
    .replace(/,\s*$/, '')
    .trim();
}

/** Format minutes as H:MM */
function minsToHHMM(minutes: number): string {
  if (minutes <= 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/** Format date string "2026-06-18" → "18/06/2026" (AU format) */
function formatDateAU(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** Get day of week label from date string */
function getDayLabel(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long' });
}

/** Number of people on the team */
function getTeamSize(team: TeamSchedule): number {
  const n = (team.staffIds || []).length;
  return n > 0 ? n : 1;
}

function escapeCsv(val: any): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(vals: any[]): string {
  return vals.map(escapeCsv).join(',');
}

// ─── Merged All-Teams Day Roster CSV Export ───────────────────────────────────

export function exportDayRosterCSV(
  teams: TeamSchedule[],
  allStaff: StaffMember[],
  date: string,
  templateCode?: string,
  summaries?: Map<string, DaySummary>,
): Blob {
  const lines: string[] = [];
  const staffMap = new Map(allStaff.map(s => [s.id, s]));

  // Date + day header
  if (templateCode) {
    lines.push(csvRow([templateCode]));
  }
  if (date) {
    lines.push(csvRow([`${getDayLabel(date)} ${formatDateAU(date)}`]));
  }
  lines.push(''); // blank line

  // Only include teams that have clients scheduled
  const activeTeams = teams.filter(t => t.clients.length > 0);

  for (let idx = 0; idx < activeTeams.length; idx++) {
    const team = activeTeams[idx];
    let summary = summaries?.get(team.id) || calculateDaySummary(team);

    // Fallback: if the route engine returned 0 travel (travelSegments empty for non-active teams),
    // compute travel from timeline gaps (dayStartTime → first job, gaps between jobs).
    if (summary.totalTravelMinutes === 0 && team.clients.length > 0) {
      const parseTime = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
      let gapTravel = 0;
      let lastEnd = parseTime(team.dayStartTime);

      // Sort clients by start time
      const sorted = [...team.clients]
        .filter(c => c.startTime && c.endTime)
        .sort((a, b) => parseTime(a.startTime!) - parseTime(b.startTime!));

      for (const c of sorted) {
        const cStart = parseTime(c.startTime!);
        if (cStart > lastEnd) {
          gapTravel += (cStart - lastEnd);
        }
        lastEnd = parseTime(c.endTime!);
      }

      if (gapTravel > 0) {
        // Rebuild summary with the gap-calculated travel
        summary = {
          ...summary,
          totalTravelMinutes: gapTravel,
          payableMinutes: (summary.payableMinutes - summary.totalTravelMinutes) + gapTravel,
        };
      }
    }

    const teamSize = getTeamSize(team);
    const hasBase = team.baseAddress && team.baseAddress.lat !== 0;

    // Resolve staff names for this team
    const teamStaffNames = (team.staffIds || [])
      .map(id => staffMap.get(id)?.name)
      .filter((n): n is string => !!n);

    // Resolve driver name
    const driverName = team.driverStaffId
      ? staffMap.get(team.driverStaffId)?.name || ''
      : '';

    // Blank separator between teams
    if (idx > 0) {
      lines.push('');
      lines.push('');
    }

    // ── Team header row ──
    lines.push(csvRow([team.name, 'Client', 'Address', 'Job Notes / Access', 'Start Time', 'End Time', 'Total Duration']));

    // ── Base row ──
    if (hasBase) {
      const baseAddr = cleanAddress(team.baseAddress?.address || '');
      // Use the route engine's calculated departure time (accounts for "Leave Base At" overrides)
      const { baseDepartureTime } = calculateScheduleTimes(team);
      lines.push(csvRow(['', 'Base', baseAddr, '', baseDepartureTime, '', '']));
    }

    // ── Client rows + breaks ──
    const breakMap = new Map<string, typeof team.breaks[0][]>();
    for (const b of team.breaks || []) {
      const list = breakMap.get(b.afterClientId) || [];
      list.push(b);
      breakMap.set(b.afterClientId, list);
    }

    team.clients.forEach((c, i) => {
      const effMin = c.jobDurationMinutes / teamSize;
      const addr = cleanAddress(c.location.address);
      lines.push(csvRow([
        String(i + 1),
        c.name,
        addr,
        c.notes || '',
        c.startTime || '',
        c.endTime || '',
        minsToHHMM(effMin),
      ]));

      // Insert breaks after this client
      const breaksAfter = breakMap.get(c.id);
      if (breaksAfter) {
        for (const b of breaksAfter) {
          const breakStart = c.endTime || '';
          let breakEnd = '';
          if (breakStart && b.durationMinutes > 0) {
            const parts = breakStart.split(':').map(Number);
            const totalMin = parts[0] * 60 + parts[1] + b.durationMinutes;
            const h = Math.floor(totalMin / 60) % 24;
            const m = totalMin % 60;
            breakEnd = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
          }
          lines.push(csvRow([
            '',
            b.label || 'Break',
            '',
            '',
            breakStart,
            breakEnd,
            minsToHHMM(b.durationMinutes),
          ]));
        }
      }
    });

    // ── Return to Base ──
    const hasReturn = team.returnAddress !== null && team.returnAddress !== 'none';
    if (team.clients.length > 0 && hasReturn) {
      const last = team.clients[team.clients.length - 1];
      const ret = team.travelSegments.get(`${last.id}->base-return`);

      let arrivalTime = '';
      if (last.endTime && ret && !ret.isCalculating) {
        const parts = last.endTime.split(':').map(Number);
        const totalMin = parts[0] * 60 + parts[1] + ret.durationMinutes;
        const h = Math.floor(totalMin / 60) % 24;
        const m = totalMin % 60;
        arrivalTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }

      const returnAddr = typeof team.returnAddress === 'object' && team.returnAddress
        ? cleanAddress(team.returnAddress.address)
        : cleanAddress(team.baseAddress?.address || '');
      lines.push(csvRow(['', 'Return to Base', returnAddr, '', last.endTime || '', arrivalTime, '']));
    }

    // ── Summary section ──
    lines.push('');
    lines.push(csvRow(['Summary']));

    if (teamStaffNames.length > 0) {
      lines.push(csvRow([team.name, ...teamStaffNames]));
    }

    if (driverName) {
      lines.push(csvRow(['Driver', driverName]));
    }

    lines.push(csvRow(['Total Clients', `${summary.clientCount} clients`]));
    lines.push(csvRow(['Total Job Time', minsToHHMM(summary.totalJobMinutes), `${(summary.totalJobMinutes / 60).toFixed(2)} hrs`]));

    const effectiveJobMins = summary.payableMinutes - summary.totalTravelMinutes;
    lines.push(csvRow(['Team Split', minsToHHMM(effectiveJobMins), `${(effectiveJobMins / 60).toFixed(2)} hrs`]));
    lines.push(csvRow(['Travel', minsToHHMM(summary.totalTravelMinutes), `${(summary.totalTravelMinutes / 60).toFixed(2)} hrs`]));
    lines.push(csvRow(['Driver Km', `${summary.totalDistanceKm.toFixed(1)} km`]));
  }

  const csvContent = lines.join('\n');
  return new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
}
