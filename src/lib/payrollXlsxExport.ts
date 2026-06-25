'use client';

import ExcelJS from 'exceljs';

export interface DayPayrollData {
  date: string;
  dayLabel: string;
  teamName: string;
  jobNames: string;
  firstStart: string | null;
  lastEnd: string | null;
  dayTotalJobMinutes: number;
  individualJobMinutes: number;
  travelMinutes: number;
  distanceKm: number;
  workMinutes: number;
}

export interface WeekPayrollTotals {
  totalJobMins: number;
  totalTravelMins: number;
  workMins: number;
}

/** Format minutes as H:MM (e.g. 494 → "8:14", 120 → "2:00") */
function minsToHHMM(minutes: number): string {
  if (minutes <= 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/** Format minutes as decimal hours (e.g. 90 → 1.50) */
function minsToDecimalNum(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

// ── Styling helpers ──────────────────────────────────────────────────────────

const HEADER_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const SUB_HEADER_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F5' } };
const SUB_HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FF555555' }, size: 9 };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, color: { argb: 'FF1A1A2E' } };
const SUBTITLE_FONT: Partial<ExcelJS.Font> = { size: 10, color: { argb: 'FF666666' } };
const VALUE_FONT: Partial<ExcelJS.Font> = { size: 10 };
const BOLD_VALUE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10 };
const DECIMAL_FONT: Partial<ExcelJS.Font> = { size: 9, color: { argb: 'FF888888' } };
const TOTALS_LABEL_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, color: { argb: 'FF1A1A2E' } };
const TOTALS_VALUE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 11, color: { argb: 'FF1A1A2E' } };
const TODAY_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
const BORDER_STYLE: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: 'FFE5E5E5' } },
};

export async function exportPayrollXlsx(
  staffName: string,
  staffRole: string,
  hourlyRate: number,
  weekStart: Date,
  days: DayPayrollData[],
  weekTotals: WeekPayrollTotals,
  totalKm: number,
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Payroll');

  // ── Column widths ────────────────────────────────────────────────────────
  ws.columns = [
    { key: 'day',        width: 16 },
    { key: 'team',       width: 18 },
    { key: 'start',      width: 10 },
    { key: 'finish',     width: 10 },
    { key: 'jobs',       width: 32 },
    { key: 'teamTotal',  width: 18 },
    { key: 'jobSplit',   width: 18 },
    { key: 'travel',     width: 14 },
    { key: 'netWork',    width: 14 },
    { key: 'km',         width: 10 },
  ];

  // ── Title section ────────────────────────────────────────────────────────
  const titleRow = ws.addRow(['Daily Payroll Breakdown']);
  titleRow.getCell(1).font = TITLE_FONT;
  ws.mergeCells(titleRow.number, 1, titleRow.number, 10);

  const subtitleRow = ws.addRow([`${staffName} · ${staffRole.charAt(0).toUpperCase() + staffRole.slice(1)} · $${hourlyRate.toFixed(2)}/hr`]);
  subtitleRow.getCell(1).font = SUBTITLE_FONT;
  ws.mergeCells(subtitleRow.number, 1, subtitleRow.number, 10);

  ws.addRow([]); // blank row

  // ── Column headers ───────────────────────────────────────────────────────
  const headerRow = ws.addRow([
    'Day / Date', 'Team', 'Start', 'Finish', 'Jobs',
    'Job Hours (Team)', 'Job Hours (Split)', 'Travel', 'Net Work', 'KM',
  ]);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER_STYLE;
  });
  headerRow.height = 24;

  // ── Daily data ───────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  for (const day of days) {
    const hasWork = day.workMinutes > 0;
    const isToday = day.date === today;
    const dateObj = new Date(day.date + 'T00:00:00');
    const dateStr = dateObj.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

    // Row 1: h:mm values
    const r1 = ws.addRow([
      `${day.dayLabel} ${dateStr}`,
      day.teamName || '—',
      day.firstStart || '—',
      day.lastEnd || '—',
      day.jobNames || '—',
      hasWork ? minsToHHMM(day.dayTotalJobMinutes) : '—',
      hasWork ? minsToHHMM(day.individualJobMinutes) : '—',
      hasWork ? minsToHHMM(day.travelMinutes) : '—',
      hasWork ? minsToHHMM(day.workMinutes) : '—',
      day.distanceKm > 0 ? day.distanceKm.toFixed(1) : '—',
    ]);
    r1.eachCell((cell, colNumber) => {
      cell.font = colNumber === 1 ? BOLD_VALUE_FONT : VALUE_FONT;
      cell.alignment = { vertical: 'middle', horizontal: colNumber <= 5 ? 'left' : 'center' };
      cell.border = BORDER_STYLE;
      if (isToday) cell.fill = TODAY_FILL;
    });

    // Row 2: decimal values
    if (hasWork) {
      const r2 = ws.addRow([
        '',
        '',
        '',
        '',
        '',
        minsToDecimalNum(day.dayTotalJobMinutes),
        minsToDecimalNum(day.individualJobMinutes),
        minsToDecimalNum(day.travelMinutes),
        minsToDecimalNum(day.workMinutes),
        '',
      ]);
      r2.eachCell((cell, colNumber) => {
        cell.font = DECIMAL_FONT;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        if (colNumber >= 6 && colNumber <= 9 && typeof cell.value === 'number') {
          cell.numFmt = '0.00';
        }
        if (isToday) cell.fill = TODAY_FILL;
      });
    }
  }

  // ── Blank separator ────────────────────────────────────────────────────
  ws.addRow([]);

  // ── Weekly totals ──────────────────────────────────────────────────────
  const computedTotalKm = days.reduce((s, d) => s + d.distanceKm, 0);
  const effectiveTotalKm = computedTotalKm > 0 ? computedTotalKm : totalKm;
  const totalIndividualJobMins = days.reduce((s, d) => s + d.individualJobMinutes, 0);

  const totalsHeaderRow = ws.addRow(['WEEKLY TOTALS']);
  totalsHeaderRow.getCell(1).font = { ...TOTALS_LABEL_FONT, size: 12 };
  ws.mergeCells(totalsHeaderRow.number, 1, totalsHeaderRow.number, 10);
  totalsHeaderRow.eachCell(cell => {
    cell.fill = SUB_HEADER_FILL;
    cell.border = BORDER_STYLE;
  });

  const addTotalRow = (label: string, mins: number) => {
    const r = ws.addRow([label, '', minsToHHMM(mins), '', '', minsToDecimalNum(mins)]);
    r.getCell(1).font = TOTALS_LABEL_FONT;
    r.getCell(3).font = TOTALS_VALUE_FONT;
    r.getCell(3).alignment = { horizontal: 'left' };
    r.getCell(6).font = DECIMAL_FONT;
    r.getCell(6).numFmt = '0.00';
    r.getCell(6).alignment = { horizontal: 'left' };
    r.eachCell(cell => { cell.border = BORDER_STYLE; });
  };

  addTotalRow('Total Job Hours (Team)', weekTotals.totalJobMins);
  addTotalRow('Total Job Hours (Individual)', totalIndividualJobMins);
  addTotalRow('Total Travel', weekTotals.totalTravelMins);
  addTotalRow('Net Work Hours', weekTotals.workMins);

  // KM row
  const kmRow = ws.addRow(['Total KM', '', effectiveTotalKm > 0 ? `${effectiveTotalKm.toFixed(1)} km` : '—']);
  kmRow.getCell(1).font = TOTALS_LABEL_FONT;
  kmRow.getCell(3).font = TOTALS_VALUE_FONT;
  kmRow.eachCell(cell => { cell.border = BORDER_STYLE; });

  // Gross wage
  const grossWage = (weekTotals.workMins / 60) * hourlyRate;
  const wageRow = ws.addRow(['Gross Wage', '', `$${grossWage.toFixed(2)}`]);
  wageRow.getCell(1).font = TOTALS_LABEL_FONT;
  wageRow.getCell(3).font = { ...TOTALS_VALUE_FONT, size: 13, color: { argb: 'FF16A34A' } };
  wageRow.eachCell(cell => { cell.border = BORDER_STYLE; });

  // ── Generate blob ──────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
