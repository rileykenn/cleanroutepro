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

function minsToHHMM(minutes: number): string {
  if (minutes <= 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function minsToDecimal(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

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

  // Column widths
  ws.columns = [
    { width: 22 }, { width: 18 }, { width: 10 }, { width: 10 },
    { width: 30 }, { width: 20 }, { width: 20 },
    { width: 14 }, { width: 14 }, { width: 10 },
  ];

  // Title
  ws.addRow(['Daily Payroll Breakdown']);
  ws.addRow([`${staffName} - ${staffRole.charAt(0).toUpperCase() + staffRole.slice(1)} - $${hourlyRate.toFixed(2)}/hr`]);
  ws.addRow([]);

  // Column headers
  ws.addRow([
    'Day / Date', 'Team', 'Start', 'Finish', 'Jobs',
    'Job Hours Total (Team)', 'Job Hours (Individual)',
    'Travel', 'Net Work', 'KM',
  ]);
  ws.addRow([]);

  // Daily data
  for (const day of days) {
    if (day.workMinutes === 0) continue;

    const dateObj = new Date(day.date + 'T00:00:00');

    // Row 1: h:mm
    ws.addRow([
      day.dayLabel,
      day.teamName,
      day.firstStart || '—',
      day.lastEnd || '—',
      day.jobNames || '—',
      minsToHHMM(day.dayTotalJobMinutes),
      minsToHHMM(day.individualJobMinutes),
      minsToHHMM(day.travelMinutes),
      minsToHHMM(day.workMinutes),
      day.distanceKm > 0 ? day.distanceKm.toFixed(1) : '—',
    ]);

    // Row 2: decimal
    ws.addRow([
      dateObj.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }),
      '', '', '', '',
      minsToDecimal(day.dayTotalJobMinutes),
      minsToDecimal(day.individualJobMinutes),
      minsToDecimal(day.travelMinutes),
      minsToDecimal(day.workMinutes),
      '',
    ]);

    ws.addRow([]);
  }

  // Weekly totals
  const computedTotalKm = days.reduce((s, d) => s + d.distanceKm, 0);
  const effectiveTotalKm = computedTotalKm > 0 ? computedTotalKm : totalKm;
  const totalIndividualJobMins = days.reduce((s, d) => s + d.individualJobMinutes, 0);

  ws.addRow([]);
  ws.addRow(['WEEKLY TOTALS']);
  ws.addRow(['Total Job Hours (Team)', minsToHHMM(weekTotals.totalJobMins), minsToDecimal(weekTotals.totalJobMins)]);
  ws.addRow(['Total Job Hours (Individual)', minsToHHMM(totalIndividualJobMins), minsToDecimal(totalIndividualJobMins)]);
  ws.addRow(['Total Travel', minsToHHMM(weekTotals.totalTravelMins), minsToDecimal(weekTotals.totalTravelMins)]);
  ws.addRow(['Net Work Hours', minsToHHMM(weekTotals.workMins), minsToDecimal(weekTotals.workMins)]);
  ws.addRow(['Total KM', effectiveTotalKm > 0 ? `${effectiveTotalKm.toFixed(1)} km` : '—']);

  const grossWage = (weekTotals.workMins / 60) * hourlyRate;
  ws.addRow(['Gross Wage', `$${grossWage.toFixed(2)}`]);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
