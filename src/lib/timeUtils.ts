/**
 * Format minutes into human-readable string
 * e.g. 90 => "1h 30m", 45 => "45m"
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format distance in km
 */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)} km`;
}

/**
 * Parse time string "HH:MM" into total minutes from midnight
 */
export function parseTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert total minutes from midnight to "HH:MM" format
 */
export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = Math.round(totalMinutes % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Format time for display: "9:00 AM"
 */
export function formatTimeDisplay(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Add minutes to a time string and return new time string
 */
export function addMinutesToTime(time: string, minutes: number): string {
  const total = parseTime(time) + minutes;
  return minutesToTime(total);
}

/**
 * Calculate wage based on total minutes and hourly rate
 */
export function calculateWage(totalMinutes: number, hourlyRate: number): number {
  return (totalMinutes / 60) * hourlyRate;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
export function getTodayISO(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Format date for display: "Monday, 14 April 2026"
 */
export function formatDateDisplay(isoDate: string): string {
  const date = new Date(isoDate + 'T00:00:00');
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * JOB_DURATIONS — available job duration options in minutes
 */
export const JOB_DURATIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '2.5 hours' },
  { value: 180, label: '3 hours' },
  { value: 210, label: '3.5 hours' },
  { value: 240, label: '4 hours' },
  { value: 300, label: '5 hours' },
  { value: 360, label: '6 hours' },
  { value: 480, label: '8 hours' },
];

/**
 * Add/subtract days from an ISO date string
 */
export function addDays(isoDate: string, days: number): string {
  const parts = isoDate.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Get Mon–Sun ISO dates for the week containing a given date
 */
export function getWeekDates(isoDate: string): string[] {
  const parts = isoDate.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, '0');
    const dd = String(day.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

/**
 * Format a week label: "5 – 11 May 2026"
 */
export function getWeekLabel(mondayISO: string, sundayISO: string): string {
  const mon = new Date(mondayISO + 'T00:00:00');
  const sun = new Date(sundayISO + 'T00:00:00');
  const monDay = mon.getDate();
  const sunDay = sun.getDate();
  const sunMonth = sun.toLocaleDateString('en-AU', { month: 'long' });
  const sunYear = sun.getFullYear();
  if (mon.getMonth() === sun.getMonth()) {
    return `${monDay} – ${sunDay} ${sunMonth} ${sunYear}`;
  }
  const monMonth = mon.toLocaleDateString('en-AU', { month: 'short' });
  return `${monDay} ${monMonth} – ${sunDay} ${sunMonth} ${sunYear}`;
}

/**
 * Short day label: "Mon 5"
 */
export function getShortDayLabel(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = d.toLocaleDateString('en-AU', { weekday: 'short' });
  return `${day} ${d.getDate()}`;
}

/**
 * Get calendar grid for a month (weeks as rows, Mon–Sun)
 */
export function getMonthCalendarDates(year: number, month: number): string[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Find the Monday of the week containing the 1st
  let dayOfWeek = firstDay.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() + mondayOffset);

  const weeks: string[][] = [];
  const current = new Date(start);
  while (current <= lastDay || current.getDay() !== 1) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    if (current > lastDay && current.getDay() === 1) break;
  }
  return weeks;
}

/**
 * Check if a date is today
 */
export function isToday(isoDate: string): boolean {
  return isoDate === getTodayISO();
}

