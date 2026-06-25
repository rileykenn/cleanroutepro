'use client';

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

/** Format minutes as Decimal text formula (e.g. 90 → '="1.50"') so Excel left-aligns it */
function minsToDecimal(minutes: number): string {
  const val = (minutes / 60).toFixed(2);
  return `="${val}"`;
}

function escapeCsv(val: any): string {
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportPayrollCsv(
  staffName: string,
  staffRole: string,
  hourlyRate: number,
  weekStart: Date,
  days: DayPayrollData[],
  weekTotals: WeekPayrollTotals,
  perKmRate: number,
  totalKm: number,
): Blob {
  const rows: string[][] = [];

  // ── Header Section ─────────────────────────────────────────────────────────
  rows.push(['Daily Payroll Breakdown']);
  rows.push([`${staffName} - ${staffRole.charAt(0).toUpperCase() + staffRole.slice(1)} - $${hourlyRate.toFixed(2)}/hr`]);
  rows.push([]); // Blank row

  // ── Column Headers ─────────────────────────────────────────────────────────
  rows.push([
    'Day / Date',
    'Team',
    'Start',
    'Finish',
    'Jobs',
    'Job Hours Total (Team)',
    'Job Hours (Individual)',
    'Travel',
    'Net Work',
    'KM',
  ]);
  rows.push([]); // Blank row before data

  // ── Daily Data ─────────────────────────────────────────────────────────────
  for (const day of days) {
    if (day.workMinutes === 0) continue; // Skip days with no work

    const dateObj = new Date(day.date + 'T00:00:00');

    // Row 1: Day Name + h:mm values
    rows.push([
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

    // Row 2: Date String + decimal values
    rows.push([
      dateObj.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' }),
      '',
      '',
      '',
      '',
      minsToDecimal(day.dayTotalJobMinutes),
      minsToDecimal(day.individualJobMinutes),
      minsToDecimal(day.travelMinutes),
      minsToDecimal(day.workMinutes),
      '',
    ]);

    // Blank row separator between days
    rows.push([]);
  }

  // Use sum of per-day KM from schedule data, fall back to manually entered totalKm
  const computedTotalKm = days.reduce((s, d) => s + d.distanceKm, 0);
  const effectiveTotalKm = computedTotalKm > 0 ? computedTotalKm : totalKm;

  rows.push([]);
  rows.push(['WEEKLY TOTALS']);

  const totalIndividualJobMins = days.reduce((s, d) => s + d.individualJobMinutes, 0);

  rows.push([
    'Total Job Hours (Team)',
    minsToHHMM(weekTotals.totalJobMins),
    `${minsToDecimal(weekTotals.totalJobMins)} hrs decimal`,
  ]);
  rows.push([
    'Total Job Hours (Individual)',
    minsToHHMM(totalIndividualJobMins),
    `${minsToDecimal(totalIndividualJobMins)} hrs decimal`,
  ]);
  rows.push([
    'Total Travel',
    minsToHHMM(weekTotals.totalTravelMins),
    `${minsToDecimal(weekTotals.totalTravelMins)} hrs decimal`,
  ]);
  rows.push([
    'Net Work Hours',
    minsToHHMM(weekTotals.workMins),
    `${minsToDecimal(weekTotals.workMins)} hrs decimal`,
  ]);
  rows.push([
    'Total KM',
    effectiveTotalKm > 0 ? `${effectiveTotalKm.toFixed(1)} km` : '—',
  ]);

  const grossWage = (weekTotals.workMins / 60) * hourlyRate;
  rows.push(['Gross Wage', `$${grossWage.toFixed(2)}`]);

  if (effectiveTotalKm > 0) {
    const kmAllowance = effectiveTotalKm * perKmRate;
    rows.push([`KM Allowance ($${perKmRate}/km)`, `$${kmAllowance.toFixed(2)}`]);
    rows.push(['Total Payable', `$${(grossWage + kmAllowance).toFixed(2)}`]);
  }

  const csvContent = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
  return new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
}
