'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { exportPayrollCsv, DayPayrollData } from '@/lib/payrollCsvExport';

// ─── Types ────────────────────────────────────────────────────────────────────
interface StaffMember {
  id: string;
  name: string;
  hourly_rate: number;
  role: string;
}

interface ScheduleJob {
  id: string;
  name: string;
  address: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  is_break: boolean;
  break_label: string | null;
  assigned_staff_ids: string[];
  schedule_date: string;
  schedule_id: string;
}

interface DayData extends DayPayrollData {
  jobs: ScheduleJob[];
  breaks: ScheduleJob[];
  totalJobMinutes: number;
  totalBreakMinutes: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseTimeToMinutes(t: string | null): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function minutesToDecimal(mins: number): string {
  return (mins / 60).toFixed(2);
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PayrollPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Owner-only page
  useEffect(() => {
    if (profile && profile.role !== 'owner') {
      router.replace(profile.role === 'staff' ? '/dashboard/staff-view' : '/dashboard/schedule');
    }
  }, [profile?.role, router]);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [publishedWeeks, setPublishedWeeks] = useState<{ start: string, end: string, startObj: Date, display: string }[]>([]);
  const [jobs, setJobs] = useState<ScheduleJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [perKmRate, setPerKmRate] = useState(0.99);
  const [totalKm, setTotalKm] = useState(0);
  const [teams, setTeams] = useState<Record<string, { name: string, dayStartTime: string | null }>>({});
  const [scheduleDataMap, setScheduleDataMap] = useState<Map<string, { teamId: string, teamSize: number, totalTravelMinutes: number }>>(new Map());

  // Load staff list
  useEffect(() => {
    async function loadStaff() {
      if (!profile?.org_id) return;
      const { data } = await supabase.from('staff_members').select('*').eq('org_id', profile.org_id).order('name');
      if (data) {
        setStaff(data);
        if (data.length > 0 && !selectedStaffId) setSelectedStaffId(data[0].id);
      }
    }
    loadStaff();
  }, [supabase, profile?.org_id, selectedStaffId]);

  // Fetch all published weeks to populate the dropdown
  useEffect(() => {
    async function fetchPublishedWeeks() {
      if (!profile?.org_id) return;
      const { data } = await supabase
        .from('schedules')
        .select('schedule_date')
        .eq('org_id', profile.org_id)
        .eq('is_published', true);
      
      if (!data) return;
      const mondayStrs = new Set<string>();
      data.forEach((r: any) => {
        const d = new Date(r.schedule_date + 'T00:00:00');
        mondayStrs.add(toDateStr(getMondayOf(d)));
      });

      const weeks = Array.from(mondayStrs).map(s => {
        const startObj = new Date(s + 'T00:00:00');
        const endObj = addDays(startObj, 6);
        return {
          start: s,
          end: toDateStr(endObj),
          startObj,
          display: `${startObj.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — ${endObj.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
        };
      }).sort((a, b) => b.startObj.getTime() - a.startObj.getTime()); // Descending order (newest first)

      setPublishedWeeks(weeks);

      // If the currently selected weekStart is not in the list, default to the newest one
      setWeekStart((currentStart) => {
        const currentStartStr = toDateStr(currentStart);
        if (!mondayStrs.has(currentStartStr) && weeks.length > 0) {
          return weeks[0].startObj;
        }
        return currentStart;
      });
    }
    fetchPublishedWeeks();
  }, [supabase, profile?.org_id]);

  // Load teams
  useEffect(() => {
    if (!profile?.org_id) return;
    supabase.from('teams').select('id, name, day_start_time').eq('org_id', profile.org_id)
      .then(({ data }: { data: any }) => {
        if (data) {
          const map: Record<string, { name: string, dayStartTime: string | null }> = {};
          data.forEach((t: any) => map[t.id] = { name: t.name, dayStartTime: t.day_start_time });
          setTeams(map);
        }
      });
  }, [profile?.org_id, supabase]);

  // Load jobs for selected staff + week
  const loadJobs = useCallback(async () => {
    if (!profile?.org_id || !selectedStaffId) return;
    setLoading(true);

    const weekEnd = toDateStr(addDays(weekStart, 6));
    const weekStartStr = toDateStr(weekStart);

    // Get all schedules in the week range for this org
    const { data: schedules } = await supabase
      .from('schedules').select('id, schedule_date, staff_ids, driver_staff_id, team_id, total_travel_minutes')
      .eq('org_id', profile.org_id)
      .gte('schedule_date', weekStartStr)
      .lte('schedule_date', weekEnd)
      .eq('is_published', true);

    if (!schedules || schedules.length === 0) { setJobs([]); setLoading(false); return; }

    const scheduleIds = schedules.map((s: { id: string }) => s.id);
    const scheduleDateMap = new Map(schedules.map((s: { id: string; schedule_date: string }) => [s.id, s.schedule_date]));
    const newScheduleDataMap = new Map<string, { teamId: string, teamSize: number, totalTravelMinutes: number }>();
    schedules.forEach((s: any) => {
      const staffIds = s.staff_ids || [];
      const size = staffIds.length > 0 ? staffIds.length : 1;
      newScheduleDataMap.set(s.id, { teamId: s.team_id, teamSize: size, totalTravelMinutes: s.total_travel_minutes || 0 });
    });
    setScheduleDataMap(newScheduleDataMap);

    const staffScheduleIds = new Set(schedules
      .filter((s: any) => (s.staff_ids || []).includes(selectedStaffId) || s.driver_staff_id === selectedStaffId)
      .map((s: any) => s.id)
    );

    // Get all jobs for the week's schedules
    const { data: allJobsData } = await supabase
      .from('schedule_jobs').select('*')
      .in('schedule_id', scheduleIds);

    if (allJobsData) {
      const myJobs = allJobsData.filter((j: any) => {
        const isDayStaff = staffScheduleIds.has(j.schedule_id);
        const assigned = j.assigned_staff_ids || [];
        return assigned.includes(selectedStaffId) || isDayStaff;
      });

      setJobs(myJobs.map((j: any) => ({
        ...j,
        schedule_date: scheduleDateMap.get(j.schedule_id as string) || '',
      })) as ScheduleJob[]);
    } else {
      setJobs([]);
    }
    setLoading(false);
  }, [supabase, profile?.org_id, selectedStaffId, weekStart]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // ── Compute per-day data ──────────────────────────────────────────────────
  const days = useMemo<DayData[]>(() => {
    return Array.from({ length: 7 }, (_, di) => {
      const date = toDateStr(addDays(weekStart, di));
      const dayJobs = jobs.filter(j => j.schedule_date === date && !j.is_break);
      const dayBreaks = jobs.filter(j => j.schedule_date === date && j.is_break);

      const allForDay = jobs.filter(j => j.schedule_date === date);
      const startTimes = allForDay.map(j => j.start_time).filter(Boolean) as string[];
      const endTimes = allForDay.map(j => j.end_time).filter(Boolean) as string[];

      const firstStart = startTimes.length > 0 ? startTimes.sort()[0] : null;
      const lastEnd = endTimes.length > 0 ? endTimes.sort().reverse()[0] : null;

      const totalJobMinutes = dayJobs.reduce((sum, j) => sum + (j.duration_minutes || 0), 0);
      const totalBreakMinutes = dayBreaks.reduce((sum, j) => sum + (j.duration_minutes || 0), 0);

      const teamNamesSet = new Set<string>();
      let individualJobMinutes = 0;
      
      // We will also track which team this day primarily belongs to, 
      // so we can pull their day_start_time to calculate travel to the first job.
      let primaryTeamId: string | null = null;

      // We will also track the saved travel minutes for this day's schedule
      let savedTravelMinutes = 0;

      dayJobs.forEach(j => {
        const schedData = scheduleDataMap.get(j.schedule_id);
        const tSize = schedData?.teamSize || 1;
        individualJobMinutes += (j.duration_minutes || 0) / tSize;
        if (schedData?.teamId && teams[schedData.teamId]) {
          teamNamesSet.add(teams[schedData.teamId].name);
          if (!primaryTeamId) primaryTeamId = schedData.teamId;
        }
        if (schedData?.totalTravelMinutes) {
          // If a team has multiple schedules in a day, take the max, or assume they belong to one schedule.
          savedTravelMinutes = Math.max(savedTravelMinutes, schedData.totalTravelMinutes);
        }
      });

      // Calculate pure travel time from gaps as a fallback
      let travelMinutes = 0;
      let lastEndTracker = 0;
      
      if (primaryTeamId && teams[primaryTeamId]?.dayStartTime) {
         lastEndTracker = parseTimeToMinutes(teams[primaryTeamId].dayStartTime!);
      }

      // Sort jobs and breaks by start time to find the true travel gaps
      const allSorted = [...dayJobs, ...dayBreaks]
        .filter(j => j.start_time && j.end_time)
        .sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time));

      allSorted.forEach(j => {
        const sTime = parseTimeToMinutes(j.start_time);
        if (lastEndTracker > 0 && sTime > lastEndTracker) {
           travelMinutes += (sTime - lastEndTracker);
        }
        lastEndTracker = parseTimeToMinutes(j.end_time);
      });
      
      // Use the saved Google Maps travel time if available, otherwise fallback to the timeline gap calculation
      if (savedTravelMinutes > 0) {
        travelMinutes = savedTravelMinutes;
      }
      
      const workMinutes = individualJobMinutes + travelMinutes;

      const teamName = Array.from(teamNamesSet).join(', ') || '—';
      const jobNames = dayJobs.map(j => j.name).join('; ') || '—';

      return {
        date,
        dayLabel: DAY_LABELS[di],
        teamName,
        jobNames,
        jobs: dayJobs,
        breaks: dayBreaks,
        firstStart,
        lastEnd,
        dayTotalJobMinutes: totalJobMinutes,
        individualJobMinutes,
        travelMinutes,
        totalJobMinutes,
        totalBreakMinutes,
        workMinutes: Math.max(0, workMinutes),
      };
    });
  }, [weekStart, jobs, scheduleDataMap, teams]);

  const weekTotals = useMemo(() => ({
    totalJobMins: days.reduce((s, d) => s + d.totalJobMinutes, 0),
    totalBreakMins: days.reduce((s, d) => s + d.totalBreakMinutes, 0),
    workMins: days.reduce((s, d) => s + d.workMinutes, 0),
  }), [days]);

  const selectedStaff = staff.find(s => s.id === selectedStaffId);
  const hourlyRate = selectedStaff?.hourly_rate || 0;
  const grossWage = (weekTotals.workMins / 60) * hourlyRate;
  const kmAllowance = totalKm * perKmRate;
  const totalPayable = grossWage + kmAllowance;

  const weekEndDisplay = addDays(weekStart, 6).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const weekStartDisplay = weekStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar pb-20 lg:pb-6">
      <div className="max-w-[900px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/dashboard/staff"
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </Link>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Payroll Export</h2>
            <p className="text-sm text-text-secondary">Weekly staff summary &amp; wage calculation</p>
          </div>
        </div>

        {/* Controls */}
        <div className="card p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Staff selector */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Staff Member</label>
              <select
                value={selectedStaffId}
                onChange={e => setSelectedStaffId(e.target.value)}
                className="input-field text-sm">
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.name} — ${s.hourly_rate}/hr</option>
                ))}
              </select>
            </div>

            {/* Per-km rate */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Per-km Rate (ATO allowance)</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-tertiary shrink-0">$</span>
                <input
                  type="number" min={0} step={0.01}
                  value={perKmRate}
                  onChange={e => setPerKmRate(parseFloat(e.target.value) || 0)}
                  className="input-field text-sm"
                />
                <span className="text-xs text-text-tertiary shrink-0">/km</span>
              </div>
            </div>
          </div>

          {/* Week navigation */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">Published Week</label>
            {publishedWeeks.length === 0 ? (
              <p className="text-sm text-text-tertiary py-2">No published weeks available yet.</p>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  disabled={publishedWeeks.findIndex(w => w.start === toDateStr(weekStart)) >= publishedWeeks.length - 1}
                  onClick={() => {
                    const idx = publishedWeeks.findIndex(w => w.start === toDateStr(weekStart));
                    if (idx < publishedWeeks.length - 1) setWeekStart(publishedWeeks[idx + 1].startObj);
                  }}
                  className="p-2 rounded-xl border border-border-light hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-secondary transition-colors"
                  title="Older Week">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                
                <div className="flex-1 text-center">
                  <select 
                    className="input-field text-sm font-semibold w-full text-center appearance-none"
                    value={toDateStr(weekStart)}
                    onChange={(e) => {
                      const sel = publishedWeeks.find(w => w.start === e.target.value);
                      if (sel) setWeekStart(sel.startObj);
                    }}
                  >
                    {publishedWeeks.map(w => (
                      <option key={w.start} value={w.start}>{w.display}</option>
                    ))}
                  </select>
                </div>
                
                <button
                  disabled={publishedWeeks.findIndex(w => w.start === toDateStr(weekStart)) <= 0}
                  onClick={() => {
                    const idx = publishedWeeks.findIndex(w => w.start === toDateStr(weekStart));
                    if (idx > 0) setWeekStart(publishedWeeks[idx - 1].startObj);
                  }}
                  className="p-2 rounded-xl border border-border-light hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-text-secondary transition-colors"
                  title="Newer Week">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Daily breakdown */}
        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="shimmer h-16 rounded-xl"/>)}</div>
        ) : (
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-border-light">
              <h3 className="text-sm font-bold text-text-primary">Daily Breakdown</h3>
              {selectedStaff && (
                <p className="text-xs text-text-tertiary mt-0.5">{selectedStaff.name} · <span className="capitalize">{selectedStaff.role}</span> · ${hourlyRate}/hr</p>
              )}
            </div>

            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[80px_1fr_80px_80px_100px_90px_80px] gap-3 px-4 py-2 bg-surface-elevated border-b border-border-light text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
              <span>Day</span>
              <span>Jobs</span>
              <span>Start</span>
              <span>Finish</span>
              <span>Job Hours</span>
              <span>Breaks</span>
              <span>Net Work</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-border-light">
              {days.map((day, di) => {
                const isToday = day.date === toDateStr(new Date());
                const hasWork = day.jobs.length > 0 || day.breaks.length > 0;
                return (
                  <motion.div
                    key={day.date}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: di * 0.04 }}
                    className={`px-4 py-3 ${isToday ? 'bg-primary-light' : hasWork ? '' : 'bg-surface-elevated/40'}`}>

                    {/* Mobile layout */}
                    <div className="sm:hidden">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${isToday ? 'text-primary' : hasWork ? 'text-text-primary' : 'text-text-tertiary'}`}>
                            {day.dayLabel}
                          </span>
                          <span className="text-xs text-text-tertiary">
                            {new Date(day.date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                          </span>
                          {isToday && <span className="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded font-medium">Today</span>}
                        </div>
                        {hasWork && (
                          <span className="text-sm font-bold text-text-primary">{minutesToHHMM(day.workMinutes)}</span>
                        )}
                      </div>
                      {day.jobs.length > 0 ? (
                        <div className="space-y-0.5">
                          {day.jobs.map(j => (
                            <p key={j.id} className="text-xs text-text-secondary">
                              {j.start_time && j.end_time ? `${j.start_time}–${j.end_time}` : ''} {j.name}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-text-tertiary">No jobs</p>
                      )}
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden sm:grid grid-cols-[80px_1fr_80px_80px_100px_90px_80px] gap-3 items-center">
                      <div>
                        <p className={`text-sm font-semibold ${isToday ? 'text-primary' : hasWork ? 'text-text-primary' : 'text-text-tertiary'}`}>
                          {day.dayLabel}
                          {isToday && <span className="ml-1 text-[10px] bg-primary text-white px-1 py-0.5 rounded">Today</span>}
                        </p>
                        <p className="text-[11px] text-text-tertiary">
                          {new Date(day.date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>

                      <div className="min-w-0">
                        {day.jobs.length > 0 ? (
                          <div className="space-y-0.5">
                            {day.jobs.slice(0, 3).map(j => (
                              <p key={j.id} className="text-xs text-text-secondary truncate">{j.name}</p>
                            ))}
                            {day.jobs.length > 3 && (
                              <p className="text-[11px] text-text-tertiary">+{day.jobs.length - 3} more</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-text-tertiary">—</p>
                        )}
                      </div>

                      <p className="text-sm text-text-secondary">{day.firstStart || '—'}</p>
                      <p className="text-sm text-text-secondary">{day.lastEnd || '—'}</p>
                      <p className="text-sm font-medium text-text-primary">{hasWork ? minutesToHHMM(day.totalJobMinutes) : '—'}</p>
                      <p className="text-sm text-text-secondary">{day.totalBreakMinutes > 0 ? `${day.totalBreakMinutes}m` : '—'}</p>
                      <p className={`text-sm font-bold ${hasWork ? 'text-text-primary' : 'text-text-tertiary'}`}>
                        {hasWork ? minutesToHHMM(day.workMinutes) : '—'}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Weekly totals */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-text-primary">Weekly Summary</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Job Hours', value: minutesToHHMM(weekTotals.totalJobMins), sub: `${minutesToDecimal(weekTotals.totalJobMins)} decimal` },
              { label: 'Total Breaks', value: minutesToHHMM(weekTotals.totalBreakMins), sub: `${weekTotals.totalBreakMins} minutes` },
              { label: 'Net Work Hours', value: minutesToHHMM(weekTotals.workMins), sub: `${minutesToDecimal(weekTotals.workMins)} decimal` },
              { label: 'Days Worked', value: String(days.filter(d => d.jobs.length > 0).length), sub: 'days with jobs' },
            ].map(stat => (
              <div key={stat.label} className="bg-surface-elevated rounded-xl p-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">{stat.label}</p>
                <p className="text-xl font-bold text-text-primary mt-0.5">{stat.value}</p>
                <p className="text-[11px] text-text-tertiary">{stat.sub}</p>
              </div>
            ))}
          </div>

          {/* Wage breakdown */}
          <div className="border border-border-light rounded-xl overflow-hidden">
            <div className="bg-surface-elevated px-4 py-2.5 border-b border-border-light">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Wage Calculation</p>
            </div>
            <div className="divide-y divide-border-light">
              <div className="flex justify-between items-center px-4 py-3">
                <span className="text-sm text-text-secondary">
                  {minutesToDecimal(weekTotals.workMins)} hrs × ${hourlyRate.toFixed(2)}/hr
                </span>
                <span className="text-sm font-semibold text-text-primary">${grossWage.toFixed(2)}</span>
              </div>

              {/* KM input */}
              <div className="flex justify-between items-center px-4 py-3 gap-4">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-text-secondary shrink-0">Total KM travelled</span>
                  <input
                    type="number" min={0} step={0.1}
                    value={totalKm || ''}
                    onChange={e => setTotalKm(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-20 px-2 py-1 border border-border rounded-lg text-sm text-right"
                  />
                  <span className="text-xs text-text-tertiary shrink-0">km @ ${perKmRate}/km</span>
                </div>
                <span className="text-sm font-semibold text-text-primary shrink-0">${kmAllowance.toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center px-4 py-3.5 bg-surface-elevated">
                <span className="text-sm font-bold text-text-primary">Total Payable</span>
                <span className="text-lg font-bold text-primary">${totalPayable.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Export button */}
        <div className="flex justify-end">
          <button
            onClick={() => {
              const blob = exportPayrollCsv(
                selectedStaff?.name || 'Staff',
                selectedStaff?.role || 'staff',
                hourlyRate,
                weekStart,
                days,
                weekTotals,
                perKmRate,
                totalKm
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              const weekEnding = addDays(weekStart, 6).toLocaleDateString('en-AU').replace(/\//g, '-');
              a.href = url;
              a.download = `payroll-${(selectedStaff?.name || 'Staff').replace(/\s+/g, '-')}-w${weekEnding}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="btn-primary gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download CSV
          </button>
        </div>

      </div>
    </div>
  );
}
