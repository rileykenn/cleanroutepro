'use client';

import ExcelJS from 'exceljs';
import { TeamSchedule, DaySummary } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip trailing Australian state abbreviation + postcode from an address string.
 *  e.g. "79 Strata Ave, Barrack Heights, NSW 2541" → "79 Strata Ave  Barrack Heights" */
function stripStatePostcode(address: string): string {
  // Remove trailing ", STATE POSTCODE" or " STATE POSTCODE"
  // Australian states: NSW, VIC, QLD, SA, WA, TAS, ACT, NT
  return address
    .replace(/,?\s*(?:NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s*\d{4}\s*$/i, '')
    .replace(/,\s*$/, '') // remove any trailing comma
    .trim();
}

/** Format minutes as H:MM (e.g. 494 → "8:14") */
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

// ─── XLSX Export ──────────────────────────────────────────────────────────────

export async function exportScheduleXLSX(
  team: TeamSchedule,
  summary: DaySummary,
  date: string,
  staffNames?: string[],
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Schedule');

  const hasBase = team.baseAddress && team.baseAddress.lat !== 0;

  // ── Column widths ──────────────────────────────────────────────────────────
  ws.columns = [
    { key: 'date',     width: 14 },
    { key: 'client',   width: 28 },
    { key: 'address',  width: 42 },
    { key: 'start',    width: 10 },
    { key: 'finish',   width: 10 },
    { key: 'duration', width: 20 },
    { key: 'notes',    width: 50 },
  ];

  // ── Header styling ────────────────────────────────────────────────────────
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

  // ── Row 1: Headers ─────────────────────────────────────────────────────────
  const headerRow = ws.addRow(['Date:', 'Client', 'Address', 'Start', 'Finish', 'Effective Duration', 'Access & Notes']);
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: 'middle' };
  });

  // ── Row 2: blank spacer ───────────────────────────────────────────────────
  ws.addRow([]);

  // ── Row 3: Base ───────────────────────────────────────────────────────────
  if (hasBase) {
    const baseAddr = stripStatePostcode(team.baseAddress?.address || '');
    ws.addRow([formatDateAU(date), 'Base', baseAddr, team.dayStartTime, '', '', '']);
  }

  // ── Client rows ───────────────────────────────────────────────────────────
  team.clients.forEach((c) => {
    const effMin = c.jobDurationMinutes / getTeamSize(team);
    const addr = stripStatePostcode(c.location.address);
    const row = ws.addRow([
      '',
      c.name,
      addr,
      c.startTime || '',
      c.endTime || '',
      minsToHHMM(effMin),
      c.notes || '',
    ]);
    row.eachCell((cell) => { cell.font = normalFont; });
  });

  // ── Return to Base ────────────────────────────────────────────────────────
  if (team.clients.length > 0 && hasBase) {
    const last = team.clients[team.clients.length - 1];
    const ret = team.travelSegments.get(`${last.id}->base-return`);
    // Calculate actual arrival time at base = last client endTime + return travel
    let arrivalTime = '';
    if (last.endTime && ret && !ret.isCalculating) {
      const parts = last.endTime.split(':').map(Number);
      const totalMin = parts[0] * 60 + parts[1] + ret.durationMinutes;
      const h = Math.floor(totalMin / 60) % 24;
      const m = totalMin % 60;
      arrivalTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    const baseAddr = stripStatePostcode(team.baseAddress?.address || '');
    ws.addRow(['', 'Return to Base', baseAddr, last.endTime || '', arrivalTime, '', '']);
  }

  // ── Blank rows ────────────────────────────────────────────────────────────
  ws.addRow([]);

  // ── Summary section ───────────────────────────────────────────────────────
  const summaryHeaderRow = ws.addRow(['', 'Summary']);
  summaryHeaderRow.getCell(2).font = boldFont;

  if (staffNames && staffNames.length > 0) {
    ws.addRow(['', 'Assigned Staff', staffNames.join(', ')]);
    ws.addRow(['', 'Team Headcount', String(staffNames.length)]);
  }

  ws.addRow(['', 'Total Clients', String(summary.clientCount)]);
  ws.addRow(['', 'Total Job Time', minsToHHMM(summary.totalJobMinutes)]);
  ws.addRow(['', 'Total Travel', minsToHHMM(summary.totalTravelMinutes)]);
  ws.addRow(['', 'Total Distance', `${summary.totalDistanceKm.toFixed(1)} km`]);
  ws.addRow(['', 'Total Work', minsToHHMM(summary.payableMinutes), `${(summary.payableMinutes / 60).toFixed(2)} hrs`]);
  ws.addRow(['', 'Work Hours (decimal)', `${(summary.payableMinutes / 60).toFixed(2)} hours`]);
  ws.addRow(['', `Wage ($${team.hourlyRate}/hr)`, `$${summary.wageAmount.toFixed(2)}`]);
  if (team.perKmRate > 0) {
    ws.addRow(['', `Per-KM ($${team.perKmRate}/km)`, `$${summary.perKmCost.toFixed(2)}`]);
  }

  // ── Bold the label column in summary rows ─────────────────────────────────
  ws.eachRow((row, rowNumber) => {
    // Summary rows start after the spacer row
    if (rowNumber > 1) {
      const cellB = row.getCell(2);
      if (typeof cellB.value === 'string' && ['Summary', 'Assigned Staff', 'Team Headcount',
        'Total Clients', 'Total Job Time', 'Total Travel', 'Total Distance', 'Total Work',
        'Work Hours (decimal)'].includes(cellB.value)) {
        cellB.font = boldFont;
      }
      // Wage and Per-KM labels start with those prefixes
      if (typeof cellB.value === 'string' && (cellB.value.startsWith('Wage') || cellB.value.startsWith('Per-KM'))) {
        cellB.font = boldFont;
      }
    }
  });

  // ── Generate buffer and return as Blob ─────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob(
    [buffer],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
}
