'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Suspense, lazy } from 'react';

const StaffChecklistView = lazy(() => import('@/components/StaffChecklistView'));

interface JobInfo {
  id: string;
  name: string;
  address: string;
  duration_minutes: number;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  is_break: boolean;
  break_label: string | null;
  position: number;
  client_id: string | null;
  assigned_staff_ids: string[];
  place_id: string | null;
}

interface DayData {
  date: string;
  dayName: string;
  dayNum: number;
  monthName: string;
  isToday: boolean;
  jobs: JobInfo[];
  published: boolean;
  teamName: string;
  teamColor: string;
  startTime: string | null;
}

const TEAM_COLORS = [
  '#4F46E5', '#059669', '#D97706', '#DC2626', '#7C3AED',
  '#0891B2', '#C026D3', '#EA580C',
];

function formatTime(t: string | null) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')}${period}`;
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function StaffViewPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [weekOffset, setWeekOffset] = useState(0);
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checklistClientId, setChecklistClientId] = useState<string | null>(null);
  const [checklistClientName, setChecklistClientName] = useState('');
  const [checklistJobId, setChecklistJobId] = useState<string | null>(null);
  const [allStaff, setAllStaff] = useState<{ id: string; name: string }[]>([]);

  // Generate week dates (Mon–Sun)
  const weekDates = useMemo(() => {
    const today = new Date();
    const day = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((day + 6) % 7) + weekOffset * 7);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push({
        date: d.toISOString().split('T')[0],
        dayName: d.toLocaleDateString('en-AU', { weekday: 'short' }),
        dayNum: d.getDate(),
        monthName: d.toLocaleDateString('en-AU', { month: 'short' }),
        isToday: d.toISOString().split('T')[0] === new Date().toISOString().split('T')[0],
      });
    }
    return days;
  }, [weekOffset]);

  const weekLabel = useMemo(() => {
    if (weekDates.length < 7) return '';
    const start = weekDates[0];
    const end = weekDates[6];
    if (start.monthName === end.monthName) {
      return `${start.dayNum} – ${end.dayNum} ${start.monthName}`;
    }
    return `${start.dayNum} ${start.monthName} – ${end.dayNum} ${end.monthName}`;
  }, [weekDates]);

  // Load all staff for name lookups
  useEffect(() => {
    if (!profile?.org_id) return;
    (async () => {
      const { data } = await supabase
        .from('staff_members').select('id, name')
        .eq('org_id', profile.org_id);
      if (data) setAllStaff(data);
    })();
  }, [profile?.org_id, supabase]);

  // Load entire week's data
  const loadWeek = useCallback(async () => {
    if (!profile?.org_id || weekDates.length === 0) return;
    setLoading(true);

    const dateStrings = weekDates.map(d => d.date);

    // Get teams
    const { data: teams } = await supabase
      .from('teams').select('id, name, color_index, day_start_time')
      .eq('org_id', profile.org_id).order('sort_order');

    // Get all schedules for this week
    const { data: schedules } = await supabase
      .from('schedules').select('id, schedule_date, team_id, is_published')
      .eq('org_id', profile.org_id)
      .in('schedule_date', dateStrings);

    // Get all jobs for those schedules
    const scheduleIds = (schedules || []).map((s: { id: string }) => s.id);
    let allJobs: (JobInfo & { schedule_id: string })[] = [];
    if (scheduleIds.length > 0) {
      const { data: jobsData } = await supabase
        .from('schedule_jobs').select('*')
        .in('schedule_id', scheduleIds)
        .order('position');
      allJobs = (jobsData || []) as (JobInfo & { schedule_id: string })[];
    }

    // Build day data
    const days: DayData[] = weekDates.map(wd => {
      const daySchedules = (schedules || []).filter((s: { schedule_date: string; is_published: boolean; id: string; team_id: string }) => s.schedule_date === wd.date && s.is_published);
      const dayJobs: JobInfo[] = [];
      let teamName = '';
      let teamColor = TEAM_COLORS[0];
      let startTime: string | null = null;

      for (const sched of daySchedules) {
        const team = (teams || []).find((t: { id: string; name: string; color_index: number; day_start_time: string }) => t.id === sched.team_id);
        const jobs = allJobs.filter(j => j.schedule_id === sched.id);
        dayJobs.push(...jobs);
        if (team && !teamName) {
          teamName = team.name;
          teamColor = TEAM_COLORS[team.color_index % TEAM_COLORS.length];
          startTime = team.day_start_time;
        }
      }

      // Sort by position
      dayJobs.sort((a, b) => a.position - b.position);

      return {
        ...wd,
        jobs: dayJobs,
        published: daySchedules.length > 0,
        teamName,
        teamColor,
        startTime,
      };
    });

    setWeekData(days);
    setLoading(false);
  }, [profile?.org_id, supabase, weekDates]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  const selectedDayData = weekData.find(d => d.date === selectedDay);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-surface">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-border-light">
        <div className="px-4 py-3 flex items-center justify-between">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-xl hover:bg-surface-hover text-text-secondary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="text-center">
            <h1 className="text-base font-bold text-text-primary">{weekLabel}</h1>
            {weekOffset !== 0 && (
              <button onClick={() => setWeekOffset(0)} className="text-xs text-primary font-medium mt-0.5">Jump to this week</button>
            )}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-xl hover:bg-surface-hover text-text-secondary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {/* ========== DAY DETAIL VIEW ========== */}
        {selectedDay && selectedDayData ? (
          <motion.div key="detail" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
            className="p-4 max-w-[600px] mx-auto">
            {/* Back button */}
            <button onClick={() => setSelectedDay(null)}
              className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-primary transition-colors mb-4">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              Back to week
            </button>

            {/* Day header */}
            <div className="mb-5">
              <h2 className="text-xl font-bold text-text-primary">
                {new Date(selectedDayData.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h2>
              {selectedDayData.teamName && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedDayData.teamColor }} />
                  <span className="text-sm text-text-secondary">{selectedDayData.teamName}</span>
                  {selectedDayData.startTime && <span className="text-xs text-text-tertiary">· starts {formatTime(selectedDayData.startTime)}</span>}
                </div>
              )}
            </div>

            {/* Jobs */}
            {selectedDayData.jobs.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-3xl mb-2">📋</div>
                <p className="text-sm text-text-secondary">No jobs scheduled</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDayData.jobs.map((job, i) => {
                  if (job.is_break) {
                    return (
                      <motion.div key={job.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
                        <span className="text-lg">☕</span>
                        <div>
                          <p className="text-sm font-medium text-amber-800">{job.break_label || 'Break'}</p>
                          <p className="text-xs text-amber-600">{formatDuration(job.duration_minutes)}{job.start_time ? ` · ${formatTime(job.start_time)}` : ''}</p>
                        </div>
                      </motion.div>
                    );
                  }

                  const clientJobIndex = selectedDayData.jobs.filter(j => !j.is_break).indexOf(job) + 1;
                  const assignedNames = (job.assigned_staff_ids || []).map(sid => allStaff.find(s => s.id === sid)?.name).filter(Boolean);

                  return (
                    <motion.div key={job.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className="bg-white rounded-xl border border-border-light p-4" style={{ borderLeft: `3px solid ${selectedDayData.teamColor}` }}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg text-xs font-bold text-white flex items-center justify-center shrink-0"
                            style={{ backgroundColor: selectedDayData.teamColor }}>
                            {clientJobIndex}
                          </div>
                          <div>
                            <h5 className="text-sm font-bold text-text-primary">{job.name || 'Unnamed'}</h5>
                            <p className="text-xs text-text-tertiary truncate max-w-[220px]">{job.address}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {job.client_id && (
                            <button onClick={() => { setChecklistClientId(job.client_id!); setChecklistClientName(job.name); setChecklistJobId(job.id); }}
                              className="p-1.5 rounded-lg hover:bg-emerald-50 text-text-tertiary hover:text-emerald-600 transition-colors" title="Checklist">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                            </button>
                          )}
                          <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}&destination_place_id=${job.place_id || ''}`}
                            target="_blank" rel="noopener noreferrer"
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-text-tertiary hover:text-primary transition-colors" title="Navigate">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                          </a>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-secondary flex-wrap">
                        {job.start_time && job.end_time && (
                          <span className="font-semibold" style={{ color: selectedDayData.teamColor }}>
                            {formatTime(job.start_time)} – {formatTime(job.end_time)}
                          </span>
                        )}
                        <span>{formatDuration(job.duration_minutes)}</span>
                        {assignedNames.length > 0 && <span className="text-text-tertiary">· {assignedNames.join(', ')}</span>}
                      </div>
                      {job.notes && (
                        <div className="mt-2 pt-2 border-t border-border-light">
                          <p className="text-xs text-text-secondary"><span className="font-medium text-text-tertiary">Notes: </span>{job.notes}</p>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : (

          /* ========== WEEK OVERVIEW ========== */
          <motion.div key="week" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="p-4 max-w-[600px] mx-auto space-y-2">
            {loading ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>
            ) : (
              weekData.map((day, i) => {
                const clientJobs = day.jobs.filter(j => !j.is_break);
                const hasJobs = clientJobs.length > 0;
                const firstJob = clientJobs[0];
                const totalMinutes = clientJobs.reduce((s, j) => s + j.duration_minutes, 0);

                return (
                  <motion.button key={day.date}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    onClick={() => hasJobs && setSelectedDay(day.date)}
                    disabled={!hasJobs}
                    className={`w-full text-left rounded-xl border transition-all ${
                      day.isToday
                        ? 'border-primary/30 bg-primary/[0.03] shadow-sm'
                        : hasJobs
                          ? 'border-border-light bg-white hover:border-primary/20 hover:shadow-sm'
                          : 'border-border-light bg-white/60 opacity-50'
                    } ${hasJobs ? 'cursor-pointer active:scale-[0.99]' : 'cursor-default'}`}>
                    <div className="p-4 flex items-center gap-4">
                      {/* Date column */}
                      <div className={`w-12 text-center shrink-0 ${day.isToday ? 'text-primary' : 'text-text-secondary'}`}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider">{day.dayName}</p>
                        <p className={`text-2xl font-bold ${day.isToday ? 'text-primary' : 'text-text-primary'}`}>{day.dayNum}</p>
                      </div>

                      {/* Divider */}
                      <div className={`w-0.5 h-10 rounded-full ${hasJobs ? '' : 'bg-border'}`}
                        style={hasJobs ? { backgroundColor: day.teamColor } : {}} />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        {hasJobs ? (
                          <>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-bold text-text-primary">
                                {clientJobs.length} job{clientJobs.length !== 1 ? 's' : ''}
                              </span>
                              <span className="text-xs text-text-tertiary">· {formatDuration(totalMinutes)}</span>
                            </div>
                            <p className="text-xs text-text-secondary truncate">
                              {clientJobs.map(j => j.name).join(' → ')}
                            </p>
                            {firstJob?.start_time && (
                              <p className="text-[10px] text-text-tertiary mt-1">
                                Starts {formatTime(firstJob.start_time)}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-text-tertiary">No jobs</p>
                        )}
                      </div>

                      {/* Arrow */}
                      {hasJobs && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                    </div>
                  </motion.button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checklist Modal */}
      {checklistClientId && (
        <Suspense fallback={null}>
          <StaffChecklistView
            clientId={checklistClientId}
            clientName={checklistClientName}
            scheduleJobId={checklistJobId || undefined}
            onClose={() => { setChecklistClientId(null); setChecklistJobId(null); }}
          />
        </Suspense>
      )}
    </div>
  );
}
