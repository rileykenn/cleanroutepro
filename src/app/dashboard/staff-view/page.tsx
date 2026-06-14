'use client';

import { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { getTodayISO } from '@/lib/timeUtils';
import { formatDateInTimezone } from '@/lib/timezone';

const ClientInfoPanel = lazy(() => import('@/components/ClientInfoPanel'));
const StaffChecklistView = lazy(() => import('@/components/StaffChecklistView'));

// ─── Types ─────────────────────────────────────────────────────────────────────

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
  checklist_id: string | null;
  checklist_completed?: boolean;
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
  driverName: string | null;
  driverIsMe: boolean;
  checklistsDone: number;
  checklistsTotal: number;
}

interface CompletedChecklist {
  id: string;
  client_id: string;
  clientName: string;
  templateName: string;
  completed_at: string;
  schedule_job_id: string | null;
}

type Tab = 'today' | 'week' | 'completed';

const TEAM_COLORS = [
  '#4F46E5', '#059669', '#D97706', '#DC2626',
  '#7C3AED', '#0891B2', '#C026D3', '#EA580C',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(t: string | null): string {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')}${period}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ─── Tab Icons ─────────────────────────────────────────────────────────────────

const TAB_CONFIG: { id: Tab; label: string; iconPath: string }[] = [
  {
    id: 'today',
    label: 'Today',
    iconPath: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  },
  {
    id: 'week',
    label: 'Schedule',
    iconPath: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  },
  {
    id: 'completed',
    label: 'Completed',
    iconPath: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 12l2 2 4-4',
  },
];

// ─── Driver Banner ─────────────────────────────────────────────────────────────

function DriverBanner({ driverName, driverIsMe, teamName, teamColor }: {
  driverName: string; driverIsMe: boolean; teamName: string; teamColor: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl ${
        driverIsMe
          ? 'bg-primary'
          : 'bg-white border border-border-light'
      }`}
    >
      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        driverIsMe ? 'bg-white/20 text-white' : 'bg-primary-light text-primary'
      }`}>
        {driverName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${
          driverIsMe ? 'text-white/70' : 'text-text-tertiary'
        }`}>
          {driverIsMe ? "You're driving today 🚗" : 'Driver today'}
        </p>
        <p className={`text-sm font-bold truncate ${driverIsMe ? 'text-white' : 'text-text-primary'}`}>
          {driverName}
        </p>
      </div>
      {teamName && (
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: driverIsMe ? 'rgba(255,255,255,0.6)' : teamColor }}
          />
          <span className={`text-xs font-medium ${driverIsMe ? 'text-white/70' : 'text-text-secondary'}`}>
            {teamName}
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ─── Job Card ──────────────────────────────────────────────────────────────────

function JobCard({
  job,
  index,
  teamColor,
  onChecklist,
  onInfo,
}: {
  job: JobInfo;
  index: number;
  teamColor: string;
  onChecklist: () => void;
  onInfo: () => void;
}) {
  const isDone = !!job.checklist_completed;
  const accentColor = isDone ? '#059669' : teamColor;

  if (job.is_break) {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-amber-50 border border-amber-100">
        <span className="text-xl">☕</span>
        <div>
          <p className="text-sm font-bold text-amber-800">{job.break_label || 'Break'}</p>
          <p className="text-xs text-amber-600">
            {formatDuration(job.duration_minutes)}
            {job.start_time ? ` · ${formatTime(job.start_time)}` : ''}
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`bg-white rounded-2xl border overflow-hidden ${
        isDone ? 'border-emerald-200' : 'border-border-light'
      }`}
      style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{ backgroundColor: accentColor }}
          >
            {isDone ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            ) : index + 1}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-text-primary leading-tight">{job.name || 'Unnamed'}</h3>
            <p className="text-xs text-text-tertiary mt-0.5 truncate">{job.address}</p>
          </div>
          {job.client_id && (
            <button
              onClick={onInfo}
              className="p-2 rounded-xl hover:bg-surface-elevated text-text-tertiary shrink-0 active:scale-95 transition-transform"
              title="Client info"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
            </button>
          )}
        </div>

        {/* Time */}
        {(job.start_time || job.end_time) && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-bold" style={{ color: accentColor }}>
              {job.start_time ? formatTime(job.start_time) : ''}
              {job.start_time && job.end_time ? ' – ' : ''}
              {job.end_time ? formatTime(job.end_time) : ''}
            </span>
            <span className="text-xs text-text-tertiary">· {formatDuration(job.duration_minutes)}</span>
          </div>
        )}

        {/* Notes */}
        {job.notes && (
          <div className="mb-3 px-3 py-2.5 bg-surface-elevated rounded-xl">
            <p className="text-xs text-text-secondary leading-relaxed">{job.notes}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}${job.place_id ? `&destination_place_id=${job.place_id}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-surface-elevated border border-border-light text-text-secondary text-sm font-semibold active:scale-95 transition-transform"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="3 11 22 2 13 21 11 13 3 11"/>
            </svg>
            Navigate
          </a>
          {job.client_id && (
            <button
              onClick={onChecklist}
              className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold active:scale-95 transition-transform ${
                isDone
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-primary text-white shadow-sm shadow-primary/30'
              }`}
            >
              {isDone ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  Done
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <path d="M9 12h6M9 16h4"/>
                  </svg>
                  Checklist
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function StaffPortalPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [allStaff, setAllStaff] = useState<{ id: string; name: string }[]>([]);
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null);

  const [infoClientId, setInfoClientId] = useState<string | null>(null);
  const [infoClientName, setInfoClientName] = useState('');
  const [infoJobId, setInfoJobId] = useState<string | null>(null);
  const [checklistJob, setChecklistJob] = useState<{
    clientId: string; clientName: string; clientAddress: string; jobId: string; checklistId?: string | null;
  } | null>(null);

  const [completedChecklists, setCompletedChecklists] = useState<CompletedChecklist[]>([]);
  const [completedLoading, setCompletedLoading] = useState(false);

  // ── Week dates (Mon–Sun) ──────────────────────────────────────────────────
  const weekDates = useMemo(() => {
    const todayISO = getTodayISO();
    const parts = todayISO.split('-').map(Number);
    const today = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    const day = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((day + 6) % 7) + weekOffset * 7);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = formatDateInTimezone(d);
      days.push({
        date: dateStr,
        dayName: d.toLocaleDateString('en-AU', { weekday: 'short' }),
        dayNum: d.getDate(),
        monthName: d.toLocaleDateString('en-AU', { month: 'short' }),
        isToday: dateStr === todayISO,
      });
    }
    return days;
  }, [weekOffset]);

  const weekLabel = useMemo(() => {
    if (weekDates.length < 7) return '';
    const s = weekDates[0], e = weekDates[6];
    if (s.monthName === e.monthName) return `${s.dayNum} – ${e.dayNum} ${s.monthName}`;
    return `${s.dayNum} ${s.monthName} – ${e.dayNum} ${e.monthName}`;
  }, [weekDates]);

  const todayData = useMemo(() => weekData.find(d => d.isToday) ?? null, [weekData]);

  // ── Load staff roster ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!profile?.org_id || !profile?.id) return;
    (async () => {
      const { data } = await supabase
        .from('staff_members').select('id, name, email').eq('org_id', profile.org_id);
      if (data) setAllStaff(data.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));

      const { data: me } = await supabase
        .from('staff_members').select('id').eq('user_id', profile.id).maybeSingle();
      if (me) { setStaffMemberId(me.id); return; }

      // Fallback: match by email
      if (profile.email && data) {
        const match = data.find((s: { id: string; email: string | null }) =>
          s.email && s.email.toLowerCase() === profile.email!.toLowerCase()
        );
        if (match) {
          setStaffMemberId(match.id);
          await supabase.from('staff_members').update({ user_id: profile.id }).eq('id', match.id);
        }
      }
    })();
  }, [profile?.org_id, profile?.id, profile?.email, supabase]);

  // ── Load week data ────────────────────────────────────────────────────────
  const loadWeek = useCallback(async () => {
    if (!profile?.org_id || weekDates.length === 0 || !staffMemberId) return;
    setLoading(true);

    const dateStrings = weekDates.map(d => d.date);

    const { data: teams } = await supabase
      .from('teams').select('id, name, color_index, day_start_time')
      .eq('org_id', profile.org_id).order('sort_order');

    const { data: schedules } = await supabase
      .from('schedules').select('id, schedule_date, team_id, is_published, driver_staff_id, staff_ids')
      .eq('org_id', profile.org_id).in('schedule_date', dateStrings);



    const scheduleIds = (schedules || []).map((s: { id: string }) => s.id);
    type RawJob = JobInfo & { schedule_id: string };
    let allJobs: RawJob[] = [];
    const completionMap = new Map<string, boolean>();

    if (scheduleIds.length > 0) {
      const { data: jobsData } = await supabase
        .from('schedule_jobs').select('*').in('schedule_id', scheduleIds).order('position');
      allJobs = (jobsData || []) as RawJob[];

      // Checklist completion status
      const jobIds = allJobs.filter(j => !j.is_break && j.client_id).map(j => j.id);
      if (jobIds.length > 0) {
        const { data: completions } = await supabase
          .from('checklist_completions').select('schedule_job_id').in('schedule_job_id', jobIds);
        (completions || []).forEach((c: { schedule_job_id: string }) => completionMap.set(c.schedule_job_id, true));
      }
    }

    const days: DayData[] = weekDates.map(wd => {
      type RawSched = { id: string; schedule_date: string; team_id: string; is_published: boolean; driver_staff_id: string | null; staff_ids: string[] | null };
      const daySchedules = (schedules || []).filter((s: RawSched) => s.schedule_date === wd.date && s.is_published) as RawSched[];
      const dayJobs: JobInfo[] = [];
      let teamName = '';
      let teamColor = TEAM_COLORS[0];
      let startTime: string | null = null;
      let driverName: string | null = null;
      let driverIsMe = false;

      for (const sched of daySchedules) {
        type RawTeam = { id: string; name: string; color_index: number; day_start_time: string };
        const team = (teams || []).find((t: RawTeam) => t.id === sched.team_id) as RawTeam | undefined;
        const isDayStaff = (sched.staff_ids || []).includes(staffMemberId!) || sched.driver_staff_id === staffMemberId!;
        const myJobs = allJobs
          .filter(j => j.schedule_id === sched.id && ((j.assigned_staff_ids || []).includes(staffMemberId!) || isDayStaff))
          .map(j => ({ ...j, checklist_completed: completionMap.has(j.id) }));



        dayJobs.push(...myJobs);

        if (team && myJobs.length > 0 && !teamName) {
          teamName = team.name;
          teamColor = TEAM_COLORS[team.color_index % TEAM_COLORS.length];
          startTime = team.day_start_time;
        }

        if (sched.driver_staff_id && myJobs.length > 0 && !driverName) {
          const driver = allStaff.find(s => s.id === sched.driver_staff_id);
          if (driver) {
            driverName = driver.name;
            driverIsMe = sched.driver_staff_id === staffMemberId;
          }
        }
      }

      dayJobs.sort((a, b) => a.position - b.position);
      const clientJobs = dayJobs.filter(j => !j.is_break && j.client_id);

      return {
        ...wd,
        jobs: dayJobs,
        published: daySchedules.length > 0,
        teamName,
        teamColor,
        startTime,
        driverName,
        driverIsMe,
        checklistsDone: clientJobs.filter(j => j.checklist_completed).length,
        checklistsTotal: clientJobs.length,
      };
    });

    setWeekData(days);
    setLoading(false);
  }, [profile?.org_id, supabase, weekDates, staffMemberId, allStaff]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // ── Load completed history ────────────────────────────────────────────────
  const loadCompleted = useCallback(async () => {
    if (!profile?.id) return;
    setCompletedLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCompletedLoading(false); return; }

    const { data } = await supabase
      .from('checklist_completions')
      .select('id, client_id, schedule_job_id, completed_at, checklist_template_id')
      .eq('completed_by', user.id)
      .order('completed_at', { ascending: false })
      .limit(60);

    if (!data) { setCompletedLoading(false); return; }

    type RawCompletion = { id: string; client_id: string; schedule_job_id: string | null; completed_at: string; checklist_template_id: string };
    const rows = data as RawCompletion[];

    const clientIds = [...new Set(rows.map(d => d.client_id).filter(Boolean))];
    const templateIds = [...new Set(rows.map(d => d.checklist_template_id).filter(Boolean))];

    const [{ data: clientsData }, { data: templatesData }] = await Promise.all([
      clientIds.length > 0 ? supabase.from('clients').select('id, name').in('id', clientIds) : Promise.resolve({ data: [] }),
      templateIds.length > 0 ? supabase.from('checklist_templates').select('id, name').in('id', templateIds) : Promise.resolve({ data: [] }),
    ]);

    const clientMap = new Map((clientsData || []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const templateMap = new Map((templatesData || []).map((t: { id: string; name: string }) => [t.id, t.name]));

    setCompletedChecklists(rows.map(d => ({
      id: d.id,
      client_id: d.client_id,
      clientName: (clientMap.get(d.client_id) ?? 'Unknown Client') as string,
      templateName: (templateMap.get(d.checklist_template_id) ?? 'Checklist') as string,
      completed_at: d.completed_at,
      schedule_job_id: d.schedule_job_id,
    })));
    setCompletedLoading(false);
  }, [profile?.id, supabase]);

  useEffect(() => {
    if (activeTab === 'completed') loadCompleted();
  }, [activeTab, loadCompleted]);

  // When checklist closes, reload week to update completion badges
  const handleChecklistClose = useCallback(() => {
    setChecklistJob(null);
    loadWeek();
  }, [loadWeek]);

  const selectedDayData = weekData.find(d => d.date === selectedDay);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">

      {/* ── Scrollable content area ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <AnimatePresence mode="wait">

          {/* ═════════════════════ TODAY TAB ═════════════════════════════ */}
          {activeTab === 'today' && (
            <motion.div
              key="today"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Header */}
              <div className="px-4 pt-6 pb-4">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">
                  {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                <h1 className="text-3xl font-extrabold text-text-primary mt-1 tracking-tight">Today</h1>
              </div>

              {loading ? (
                <div className="px-4 space-y-3 pb-6">
                  {[1, 2, 3].map(i => <div key={i} className="shimmer h-28 rounded-2xl" />)}
                </div>
              ) : !todayData || todayData.jobs.filter(j => !j.is_break).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
                  <div className="w-20 h-20 rounded-3xl bg-surface-elevated border border-border-light flex items-center justify-center mb-4">
                    <span className="text-4xl">🏖️</span>
                  </div>
                  <p className="text-lg font-bold text-text-primary">No jobs today</p>
                  <p className="text-sm text-text-secondary mt-1.5">Check the Schedule tab for upcoming days</p>
                  <button
                    onClick={() => setActiveTab('week')}
                    className="mt-5 btn-primary text-sm px-6"
                  >
                    View Schedule
                  </button>
                </div>
              ) : (
                <div className="px-4 space-y-3 pb-20">

                  {/* Driver banner */}
                  {todayData.driverName && (
                    <DriverBanner
                      driverName={todayData.driverName}
                      driverIsMe={todayData.driverIsMe}
                      teamName={todayData.teamName}
                      teamColor={todayData.teamColor}
                    />
                  )}

                  {/* Stats strip */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        label: 'Jobs',
                        value: String(todayData.jobs.filter(j => !j.is_break).length),
                        color: todayData.teamColor,
                      },
                      {
                        label: 'Start',
                        value: todayData.startTime
                          ? formatTime(todayData.startTime)
                          : todayData.jobs[0]?.start_time
                            ? formatTime(todayData.jobs[0].start_time)
                            : '—',
                        color: undefined,
                      },
                      {
                        label: 'Signed',
                        value: `${todayData.checklistsDone}/${todayData.checklistsTotal}`,
                        color: todayData.checklistsDone === todayData.checklistsTotal && todayData.checklistsTotal > 0 ? '#059669' : undefined,
                      },
                    ].map(stat => (
                      <div
                        key={stat.label}
                        className="bg-white rounded-2xl p-3.5 border border-border-light text-center"
                      >
                        <p
                          className="text-2xl font-extrabold tracking-tight"
                          style={{ color: stat.color || 'var(--color-text-primary)' }}
                        >
                          {stat.value}
                        </p>
                        <p className="text-[10px] text-text-tertiary font-semibold uppercase tracking-wider mt-0.5">
                          {stat.label}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Divider */}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-border-light" />
                    <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">Your Jobs</span>
                    <div className="flex-1 h-px bg-border-light" />
                  </div>

                  {/* Job cards */}
                  {(() => {
                    let clientIdx = 0;
                    return todayData.jobs.map((job, i) => {
                      if (!job.is_break) clientIdx++;
                      return (
                        <JobCard
                          key={job.id}
                          job={job}
                          index={job.is_break ? i : clientIdx - 1}
                          teamColor={todayData.teamColor}
                          onChecklist={() => setChecklistJob({
                            clientId: job.client_id!,
                            clientName: job.name,
                            clientAddress: job.address,
                            jobId: job.id,
                            checklistId: job.checklist_id || null,
                          })}
                          onInfo={() => {
                            setInfoClientId(job.client_id!);
                            setInfoClientName(job.name);
                            setInfoJobId(job.id);
                          }}
                        />
                      );
                    });
                  })()}
                </div>
              )}
            </motion.div>
          )}

          {/* ═════════════════════ WEEK / SCHEDULE TAB ═══════════════════ */}
          {activeTab === 'week' && (
            <motion.div
              key="week"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Sticky week nav */}
              <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-border-light">
                <div className="flex items-center justify-between px-4 py-3">
                  <button
                    onClick={() => { setWeekOffset(w => w - 1); setSelectedDay(null); }}
                    className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface-elevated hover:bg-surface-hover text-text-secondary active:scale-90 transition-all"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </button>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-primary">{weekLabel}</p>
                    {weekOffset !== 0 && (
                      <button
                        onClick={() => { setWeekOffset(0); setSelectedDay(null); }}
                        className="text-[11px] text-primary font-semibold mt-0.5"
                      >
                        Jump to this week
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => { setWeekOffset(w => w + 1); setSelectedDay(null); }}
                    className="w-10 h-10 rounded-xl flex items-center justify-center bg-surface-elevated hover:bg-surface-hover text-text-secondary active:scale-90 transition-all"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {/* ── Day detail view ──────────────────────────────────── */}
                {selectedDay && selectedDayData ? (
                  <motion.div
                    key="detail"
                    initial={{ opacity: 0, x: 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                    className="p-4 space-y-3 pb-20"
                  >
                    <button
                      onClick={() => setSelectedDay(null)}
                      className="flex items-center gap-1.5 text-sm text-primary font-semibold active:scale-95 transition-transform py-1"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="15 18 9 12 15 6"/>
                      </svg>
                      Back to week
                    </button>

                    <div className="pt-1">
                      <h2 className="text-xl font-bold text-text-primary">
                        {new Date(selectedDayData.date + 'T00:00:00').toLocaleDateString('en-AU', {
                          weekday: 'long', day: 'numeric', month: 'long',
                        })}
                      </h2>
                      {selectedDayData.teamName && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedDayData.teamColor }} />
                          <span className="text-sm text-text-secondary">{selectedDayData.teamName}</span>
                          {selectedDayData.startTime && (
                            <span className="text-xs text-text-tertiary">
                              · starts {formatTime(selectedDayData.startTime)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Driver banner */}
                    {selectedDayData.driverName && (
                      <DriverBanner
                        driverName={selectedDayData.driverName}
                        driverIsMe={selectedDayData.driverIsMe}
                        teamName={selectedDayData.teamName}
                        teamColor={selectedDayData.teamColor}
                      />
                    )}

                    {selectedDayData.jobs.length === 0 ? (
                      <div className="flex flex-col items-center py-16 text-center">
                        <div className="text-4xl mb-3">📋</div>
                        <p className="text-sm font-semibold text-text-secondary">No jobs for this day</p>
                      </div>
                    ) : (
                      (() => {
                        let clientIdx = 0;
                        return selectedDayData.jobs.map((job, i) => {
                          if (!job.is_break) clientIdx++;
                          return (
                            <JobCard
                              key={job.id}
                              job={job}
                              index={job.is_break ? i : clientIdx - 1}
                              teamColor={selectedDayData.teamColor}
                              onChecklist={() => setChecklistJob({
                                clientId: job.client_id!,
                                clientName: job.name,
                                clientAddress: job.address,
                                jobId: job.id,
                                checklistId: job.checklist_id || null,
                              })}
                              onInfo={() => {
                                setInfoClientId(job.client_id!);
                                setInfoClientName(job.name);
                                setInfoJobId(job.id);
                              }}
                            />
                          );
                        });
                      })()
                    )}
                  </motion.div>

                ) : (
                  /* ── Week overview ───────────────────────────────────── */
                  <motion.div
                    key="week-list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="p-4 space-y-2 pb-20"
                  >
                    {loading ? (
                      <div className="space-y-2">
                        {[1, 2, 3, 4, 5].map(i => <div key={i} className="shimmer h-[76px] rounded-2xl" />)}
                      </div>
                    ) : (
                      weekData.map((day, i) => {
                        const clientJobs = day.jobs.filter(j => !j.is_break);
                        const hasJobs = clientJobs.length > 0;
                        const allDone = hasJobs && day.checklistsTotal > 0 && day.checklistsDone === day.checklistsTotal;
                        const someDone = hasJobs && day.checklistsDone > 0 && !allDone;

                        return (
                          <motion.button
                            key={day.date}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}
                            onClick={() => hasJobs && setSelectedDay(day.date)}
                            disabled={!hasJobs}
                            className={`w-full text-left rounded-2xl border transition-all active:scale-[0.98] ${
                              day.isToday
                                ? 'border-primary/25 bg-primary/[0.03] shadow-sm'
                                : hasJobs
                                  ? 'border-border-light bg-white hover:shadow-sm'
                                  : 'border-border-light bg-white/60 opacity-45'
                            } ${hasJobs ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            <div className="p-4 flex items-center gap-4">
                              {/* Date pill */}
                              <div className={`w-12 text-center shrink-0 ${day.isToday ? 'text-primary' : 'text-text-secondary'}`}>
                                <p className="text-[10px] font-bold uppercase tracking-wider">{day.dayName}</p>
                                <p className={`text-2xl font-extrabold leading-tight ${day.isToday ? 'text-primary' : 'text-text-primary'}`}>
                                  {day.dayNum}
                                </p>
                              </div>

                              {/* Colour accent */}
                              <div
                                className="w-1 h-10 rounded-full shrink-0"
                                style={{ backgroundColor: hasJobs ? day.teamColor : 'var(--color-border)' }}
                              />

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                {hasJobs ? (
                                  <>
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-sm font-bold text-text-primary">
                                        {clientJobs.length} job{clientJobs.length !== 1 ? 's' : ''}
                                      </span>
                                      <span className="text-xs text-text-tertiary">
                                        · {formatDuration(clientJobs.reduce((s, j) => s + j.duration_minutes, 0))}
                                      </span>
                                    </div>
                                    <p className="text-xs text-text-secondary truncate">
                                      {clientJobs.map(j => j.name).join(' → ')}
                                    </p>
                                    {day.driverName && (
                                      <p className="text-[10px] text-text-tertiary mt-0.5">
                                        {day.driverIsMe ? <>🚗 You&apos;re driving</> : `🚗 ${day.driverName}`}
                                      </p>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-sm text-text-tertiary">No jobs</p>
                                )}
                              </div>

                              {/* Checklist badge */}
                              {hasJobs && day.checklistsTotal > 0 && (
                                <div className={`shrink-0 px-2.5 py-1 rounded-lg border text-[10px] font-bold ${
                                  allDone
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : someDone
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-surface-elevated text-text-tertiary border-border-light'
                                }`}>
                                  {allDone ? '✓ Done' : `${day.checklistsDone}/${day.checklistsTotal}`}
                                </div>
                              )}

                              {hasJobs && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
                                  <polyline points="9 18 15 12 9 6"/>
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
            </motion.div>
          )}

          {/* ═════════════════════ COMPLETED TAB ════════════════════════ */}
          {activeTab === 'completed' && (
            <motion.div
              key="completed"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-4 pt-6 pb-4">
                <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">Completed</h1>
                <p className="text-sm text-text-secondary mt-1">Your submitted checklists</p>
              </div>

              {completedLoading ? (
                <div className="px-4 space-y-2 pb-6">
                  {[1, 2, 3, 4, 5].map(i => <div key={i} className="shimmer h-[72px] rounded-2xl" />)}
                </div>
              ) : completedChecklists.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
                  <div className="w-20 h-20 rounded-3xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2">
                      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                      <rect x="9" y="3" width="6" height="4" rx="1"/>
                      <path d="M9 12h6M9 16h4"/>
                    </svg>
                  </div>
                  <p className="text-lg font-bold text-text-primary">No completions yet</p>
                  <p className="text-sm text-text-secondary mt-1.5">Signed-off job checklists appear here</p>
                </div>
              ) : (
                <div className="px-4 space-y-2 pb-20">
                  {completedChecklists.map((c, i) => {
                    const date = new Date(c.completed_at);
                    const dateStr = date.toLocaleDateString('en-AU', {
                      weekday: 'short', day: 'numeric', month: 'short',
                    });
                    const timeStr = date.toLocaleTimeString('en-AU', {
                      hour: 'numeric', minute: '2-digit', hour12: true,
                    });

                    return (
                      <motion.div
                        key={c.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="bg-white rounded-2xl border border-border-light p-4 flex items-center gap-3.5"
                      >
                        <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
                            <path d="M20 6L9 17l-5-5"/>
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-text-primary truncate">{c.clientName}</p>
                          <p className="text-xs text-text-secondary truncate">{c.templateName}</p>
                          <p className="text-[10px] text-text-tertiary mt-0.5">
                            {dateStr} · {timeStr}
                          </p>
                        </div>
                        {c.client_id && c.schedule_job_id && (
                          <button
                            onClick={() => setChecklistJob({
                              clientId: c.client_id,
                              clientName: c.clientName,
                              clientAddress: '',
                              jobId: c.schedule_job_id!,
                            })}
                            className="shrink-0 px-3 py-2 rounded-xl bg-surface-elevated border border-border-light text-text-secondary text-xs font-semibold hover:bg-surface-hover active:scale-95 transition-all"
                          >
                            View
                          </button>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── Bottom Tab Bar ────────────────────────────────────────────────── */}
      <div
        className="shrink-0 bg-white border-t border-border-light"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="flex">
          {TAB_CONFIG.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== 'week') setSelectedDay(null);
                }}
                className={`relative flex-1 flex flex-col items-center gap-1 py-3 transition-colors active:scale-95 ${
                  isActive ? 'text-primary' : 'text-text-tertiary'
                }`}
              >
                {/* Active indicator */}
                {isActive && (
                  <motion.div
                    layoutId="tab-bar-indicator"
                    className="absolute top-0 left-[20%] right-[20%] h-[3px] rounded-full bg-primary"
                  />
                )}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={isActive ? 2.5 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={tab.iconPath} />
                </svg>
                <span className={`text-[10px] font-bold tracking-wide ${isActive ? 'text-primary' : 'text-text-tertiary'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Overlays ──────────────────────────────────────────────────────── */}
      {infoClientId && (
        <Suspense fallback={null}>
          <ClientInfoPanel
            clientId={infoClientId}
            clientName={infoClientName}
            scheduleJobId={infoJobId ?? undefined}
            onClose={() => { setInfoClientId(null); setInfoJobId(null); }}
          />
        </Suspense>
      )}
      {checklistJob && (
        <Suspense fallback={null}>
          <StaffChecklistView
            clientId={checklistJob.clientId}
            clientName={checklistJob.clientName}
            clientAddress={checklistJob.clientAddress}
            scheduleJobId={checklistJob.jobId}
            jobChecklistId={checklistJob.checklistId}
            onClose={handleChecklistClose}
          />
        </Suspense>
      )}
    </div>
  );
}
