'use client';

import ExcelJS from 'exceljs';
import { TeamSchedule, DaySummary, StaffMember } from './types';
import { calculateDaySummary } from './routeEngine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip trailing state, postcode, and country from an address string.
 *  e.g. "79 Strata Ave, Barrack Heights, NSW 2528, Australia" → "79 Strata Ave, Barrack Heights" */
function cleanAddress(address: string): string {
  return address
    // Remove ", Australia" or " Australia" at the end
    .replace(/,?\s*Australia\s*$/i, '')
    // Remove trailing ", STATE POSTCODE" (Australian states)
    .replace(/,?\s*(?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s*\d{4}\s*$/i, '')
    // Remove any trailing comma
    .replace(/,\s*$/, '')
    .trim();
}

/** Format minutes as H:MM (e.g. 494 → "8:14", 120 → "2:00") */
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

/** Number of people on the team */
function getTeamSize(team: TeamSchedule): number {
  const n = (team.staffIds || []).length;
  return n > 0 ? n : 1;
}

// ─── Shared Styles ────────────────────────────────────────────────────────────

const headerFill: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF2D5F8A' },
};
const headerFont: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};
const boldFont: Partial<ExcelJS.Font> = { bold: true, size: 11 };
const normalFont: Partial<ExcelJS.Font> = { size: 11 };

// ─── Write a single team section into a worksheet ─────────────────────────────

function writeTeamSection(
  ws: ExcelJS.Worksheet,
  team: TeamSchedule,
  summary: DaySummary,
  staffNames?: string[],
  driverName?: string,
) {
  const hasBase = team.baseAddress && team.baseAddress.lat !== 0;
  const teamSize = getTeamSize(team);

  // ── Column headers ─────────────────────────────────────────────────────────
  const hRow = ws.addRow([
    team.name,
    'Client',
    'Address',
    'Job Notes / Access',
    'Start Time',
    'End Time',
    'Total Duration',
  ]);
  hRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: 'middle' };
  });

  // ── Base row ───────────────────────────────────────────────────────────────
  if (hasBase) {
    const baseAddr = cleanAddress(team.baseAddress?.address || '');
    const row = ws.addRow(['', 'Base', baseAddr, '', team.dayStartTime, '', '']);
    row.eachCell((cell) => { cell.font = normalFont; });
  }

  // ── Client rows + breaks ───────────────────────────────────────────────────
  const breakMap = new Map<string, typeof team.breaks[0][]>();
  for (const b of team.breaks || []) {
    const list = breakMap.get(b.afterClientId) || [];
    list.push(b);
    breakMap.set(b.afterClientId, list);
  }

  team.clients.forEach((c, i) => {
    const effMin = c.jobDurationMinutes / teamSize;
    const addr = cleanAddress(c.location.address);
    const row = ws.addRow([
      String(i + 1),
      c.name,
      addr,
      c.notes || '',
      c.startTime || '',
      c.endTime || '',
      minsToHHMM(effMin),
    ]);
    row.eachCell((cell) => { cell.font = normalFont; });

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
        const breakRow = ws.addRow([
          '',
          b.label || 'Break',
          '',
          '',
          breakStart,
          breakEnd,
          minsToHHMM(b.durationMinutes),
        ]);
        breakRow.eachCell((cell) => { cell.font = normalFont; });
      }
    }
  });

  // ── Return to Base ─────────────────────────────────────────────────────────
  if (team.clients.length > 0 && hasBase) {
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

    const baseAddr = cleanAddress(team.baseAddress?.address || '');
    const returnRow = ws.addRow(['', 'Return to Base', baseAddr, '', last.endTime || '', arrivalTime, '']);
    returnRow.eachCell((cell) => { cell.font = normalFont; });
  }

  // ── Blank row ──────────────────────────────────────────────────────────────
  ws.addRow([]);

  // ── Summary section ────────────────────────────────────────────────────────
  const summaryRow = ws.addRow(['Summary']);
  summaryRow.getCell(1).font = boldFont;

  if (staffNames && staffNames.length > 0) {
    const teamStaffRow = ws.addRow([team.name, ...staffNames]);
    teamStaffRow.getCell(1).font = boldFont;
  }

  if (driverName) {
    const driverRow = ws.addRow(['Driver', '', driverName]);
    driverRow.getCell(1).font = boldFont;
  }

  const clientsRow = ws.addRow(['Total Clients', String(summary.clientCount)]);
  clientsRow.getCell(1).font = boldFont;

  const jobTimeRow = ws.addRow([
    'Total Job Time',
    minsToHHMM(summary.totalJobMinutes),
    (summary.totalJobMinutes / 60).toFixed(2),
  ]);
  jobTimeRow.getCell(1).font = boldFont;

  const effectiveJobMins = summary.payableMinutes - summary.totalTravelMinutes;
  const splitRow = ws.addRow([
    'Team Split',
    minsToHHMM(effectiveJobMins),
    (effectiveJobMins / 60).toFixed(2),
  ]);
  splitRow.getCell(1).font = boldFont;

  const travelRow = ws.addRow([
    'Travel',
    minsToHHMM(summary.totalTravelMinutes),
    (summary.totalTravelMinutes / 60).toFixed(2),
  ]);
  travelRow.getCell(1).font = boldFont;

  const kmRow = ws.addRow([
    'Driver Km',
    '',
    `${summary.totalDistanceKm.toFixed(1)} km`,
  ]);
  kmRow.getCell(1).font = boldFont;
}

// ─── Single-Team Staff XLSX Export ────────────────────────────────────────────

export async function exportStaffScheduleXLSX(
  team: TeamSchedule,
  summary: DaySummary,
  date: string,
  staffNames?: string[],
  driverName?: string,
  templateCode?: string,
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(`${team.name}-staff-schedule`);

  ws.columns = [
    { key: 'num',       width: 8  },
    { key: 'client',    width: 28 },
    { key: 'address',   width: 42 },
    { key: 'notes',     width: 40 },
    { key: 'start',     width: 12 },
    { key: 'end',       width: 12 },
    { key: 'duration',  width: 16 },
  ];

  // Week label
  if (templateCode) {
    const weekRow = ws.addRow([templateCode]);
    weekRow.getCell(1).font = boldFont;
  }

  // Date
  if (date) {
    const dateRow = ws.addRow([formatDateAU(date)]);
    dateRow.getCell(1).font = boldFont;
  }

  ws.addRow([]);

  writeTeamSection(ws, team, summary, staffNames, driverName);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob(
    [buffer],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
}

// ─── Merged All-Teams Day Roster XLSX Export ──────────────────────────────────

export async function exportDayRosterXLSX(
  teams: TeamSchedule[],
  allStaff: StaffMember[],
  date: string,
  templateCode?: string,
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Staff Roster');

  ws.columns = [
    { key: 'num',       width: 8  },
    { key: 'client',    width: 28 },
    { key: 'address',   width: 42 },
    { key: 'notes',     width: 40 },
    { key: 'start',     width: 12 },
    { key: 'end',       width: 12 },
    { key: 'duration',  width: 16 },
  ];

  // Week label
  if (templateCode) {
    const weekRow = ws.addRow([templateCode]);
    weekRow.getCell(1).font = boldFont;
  }

  // Date
  if (date) {
    const dateRow = ws.addRow([formatDateAU(date)]);
    dateRow.getCell(1).font = boldFont;
  }

  const staffMap = new Map(allStaff.map(s => [s.id, s]));

  // Only include teams that have clients scheduled
  const activeTeams = teams.filter(t => t.clients.length > 0);

  for (let idx = 0; idx < activeTeams.length; idx++) {
    const team = activeTeams[idx];
    const summary = calculateDaySummary(team);

    // Resolve staff names for this team
    const teamStaffNames = (team.staffIds || [])
      .map(id => staffMap.get(id)?.name)
      .filter((n): n is string => !!n);

    // Resolve driver name
    const driverName = team.driverStaffId
      ? staffMap.get(team.driverStaffId)?.name
      : undefined;

    // Blank separator between teams
    if (idx > 0) {
      ws.addRow([]);
      ws.addRow([]);
    }

    writeTeamSection(ws, team, summary, teamStaffNames, driverName);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob(
    [buffer],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
}
