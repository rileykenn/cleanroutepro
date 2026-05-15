/**
 * Centralized timezone configuration.
 *
 * All date/time logic in the app reads from this module so that
 * every component and utility uses the org-configured timezone.
 * Defaults to the browser's local timezone on first load.
 */

let _timezone: string = typeof Intl !== 'undefined'
  ? Intl.DateTimeFormat().resolvedOptions().timeZone
  : 'Australia/Sydney';

/** Set the app-wide timezone (called once when profile loads). */
export function setAppTimezone(tz: string) {
  _timezone = tz;
}

/** Get the current app-wide timezone IANA string. */
export function getAppTimezone(): string {
  return _timezone;
}

/**
 * Get the current date as YYYY-MM-DD in the configured timezone.
 * This replaces the old `getTodayISO()` which used UTC-unsafe `toISOString()`.
 */
export function getTodayInTimezone(): string {
  return formatDateInTimezone(new Date());
}

/**
 * Format any JS Date to YYYY-MM-DD in the configured timezone.
 */
export function formatDateInTimezone(date: Date): string {
  // Intl.DateTimeFormat with explicit timezone gives us the correct local date parts
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: _timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

/**
 * Get the current day-of-week (0=Sun..6=Sat) in the configured timezone.
 */
export function getDayOfWeekInTimezone(isoDate: string): number {
  const parts = isoDate.split('-').map(Number);
  // Create a date at noon to avoid any DST edge cases
  const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  // Use Intl to get the weekday in the configured timezone
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: _timezone,
    weekday: 'short',
  }).format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? d.getDay();
}

/** Common Australian + world timezones for the settings picker. */
export const TIMEZONE_OPTIONS = [
  // Australia
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
  { value: 'Australia/Perth', label: 'Perth (AWST)' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)' },
  // New Zealand
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)' },
  // Asia
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Kolkata', label: 'Kolkata (IST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  // Americas
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  // Pacific
  { value: 'Pacific/Honolulu', label: 'Honolulu (HST)' },
  { value: 'Pacific/Fiji', label: 'Fiji (FJT)' },
  // UTC
  { value: 'UTC', label: 'UTC' },
];
