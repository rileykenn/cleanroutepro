'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { getTodayISO, getWeekDates, addDays, getWeekLabel, getShortDayLabel } from '@/lib/timeUtils';
import { ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import { COLLAB_COLORS } from '@/components/StaffChecklistView';

// ─── Types ────────────────────────────────────────────────────────────────────
interface JobInfo {
  id: string;
  name: string;
  address: string;
  client_id: string | null;
  checklist_id: string | null;
  schedule_id: string;
  date: string;
  teamColor: string;
  teamName: string;
}

interface FieldAnswer {
  fieldId: string;
  value: string | string[] | boolean | null;
  na?: boolean;
  completed_by?: string;
}

interface Completion {
  id: string;
  schedule_job_id: string;
  items: FieldAnswer[];
  notes: string | null;
  completed_by: string;
  completed_at: string;
  is_submitted: boolean;
}

interface JobWithCompletion extends JobInfo {
  completion: Completion | null;
  totalFields: number;
  answeredFields: number;
  contributors: Array<{ uid: string; color: string; name: string }>;
}

const STAFF_COLORS = COLLAB_COLORS.map((c: { bg: string; text: string }) => c.bg);

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Completion ring SVG ──────────────────────────────────────────────────────
function ProgressRing({ pct, size = 36, submitted }: { pct: number; size?: number; submitted: boolean }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E5E7EB" strokeWidth="3" />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={submitted ? '#10B981' : pct > 0 ? '#4F46E5' : '#E5E7EB'}
        strokeWidth="3" strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.4s ease' }} />
    </svg>
  );
}

// ─── Live checklist panel (admin read-only + realtime) ────────────────────────
function ChecklistPanel({
  job,
  sections,
  completion,
  contributors,
  userNameMap,
  userColorMap,
  onClose,
}: {
  job: JobWithCompletion;
  sections: ChecklistSection[];
  completion: Completion | null;
  contributors: JobWithCompletion['contributors'];
  userNameMap: Map<string, string>;
  userColorMap: Map<string, string>;
  onClose: () => void;
}) {
  const answers = useMemo(() => {
    const map = new Map<string, FieldAnswer>();
    (completion?.items || []).forEach(a => map.set(a.fieldId, a));
    return map;
  }, [completion]);

  const allFields = useMemo(() =>
    sections.flatMap(s => s.fields.filter(f => f.type !== 'heading' && f.type !== 'paragraph' && f.type !== 'logic')),
  [sections]);

  const answeredCount = allFields.filter(f => {
    const a = answers.get(f.id);
    if (!a) return false;
    if (a.na) return true;
    const v = a.value;
    if (v === null || v === '' || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;

  const pct = allFields.length > 0 ? Math.round((answeredCount / allFields.length) * 100) : 0;
  const isSubmitted = completion?.is_submitted ?? false;

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col border-l border-border-light"
    >
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-border-light">
        <div className="flex items-center gap-3">
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-elevated text-text-secondary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-text-primary truncate">{job.name}</h3>
            <p className="text-xs text-text-tertiary truncate">{job.address}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ProgressRing pct={pct} submitted={isSubmitted} />
            <div className="text-right">
              <p className={`text-xs font-bold ${isSubmitted ? 'text-emerald-600' : pct > 0 ? 'text-primary' : 'text-text-tertiary'}`}>
                {isSubmitted ? 'Submitted' : pct > 0 ? 'In Progress' : 'Not Started'}
              </p>
              {allFields.length > 0 && <p className="text-[10px] text-text-tertiary">{answeredCount}/{allFields.length}</p>}
            </div>
          </div>
        </div>

        {/* Contributors */}
        {contributors.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {contributors.map(({ uid, color, name }) => (
              <span key={uid} className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                style={{ backgroundColor: color }}>
                {name}
              </span>
            ))}
          </div>
        )}

        {/* Live pulse */}
        {!isSubmitted && completion && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-600 font-semibold">Live — updating in real time</span>
          </div>
        )}
      </div>

      {/* Checklist body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-12 h-12 rounded-xl bg-surface-elevated flex items-center justify-center text-2xl">📋</div>
            <p className="text-sm text-text-secondary">No checklist assigned to this job</p>
          </div>
        ) : (
          sections.map(section => (
            <div key={section.id}>
              {section.title && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-border" />
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary shrink-0 px-1">{section.title}</h4>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <div className="space-y-1.5">
                {section.fields.map(field => {
                  if (field.type === 'heading') return (
                    <p key={field.id} className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary pt-2">{field.label}</p>
                  );
                  if (field.type === 'paragraph' || field.type === 'logic') return null;

                  const ans = answers.get(field.id);
                  const answererColor = ans?.completed_by ? userColorMap.get(ans.completed_by) : undefined;
                  const isAnswered = ans && (ans.na || (ans.value !== null && ans.value !== '' && ans.value !== false && !(Array.isArray(ans.value) && ans.value.length === 0)));

                  let displayVal = '—';
                  if (ans?.na) displayVal = 'N/A';
                  else if (ans?.value === true || ans?.value === 'yes') displayVal = '✓ Yes';
                  else if (ans?.value === false || ans?.value === 'no') displayVal = '✗ No';
                  else if (Array.isArray(ans?.value)) displayVal = (ans.value as string[]).join(', ') || '—';
                  else if (ans?.value) displayVal = String(ans.value);

                  return (
                    <div key={field.id}
                      className={`flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                        isAnswered ? 'bg-white border-border-light' : 'bg-surface-elevated border-transparent'
                      }`}
                      style={isAnswered && answererColor ? { borderLeftColor: answererColor, borderLeftWidth: 3 } : undefined}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-text-primary leading-snug">{field.label}</p>
                        {isAnswered && (
                          <p className="text-xs text-text-secondary mt-0.5 font-medium">{displayVal}</p>
                        )}
                      </div>
                      {isAnswered && answererColor && (
                        <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ backgroundColor: answererColor }}>
                          {(userNameMap.get(ans!.completed_by!) || '?')[0].toUpperCase()}
                        </div>
                      )}
                      {!isAnswered && (
                        <span className="shrink-0 text-[10px] text-text-tertiary">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* Notes */}
        {completion?.notes && (
          <div className="rounded-xl border border-border-light bg-amber-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600 mb-1">Notes</p>
            <p className="text-sm text-text-primary">{completion.notes}</p>
          </div>
        )}

        {/* Submitted timestamp */}
        {isSubmitted && completion?.completed_at && (
          <div className="text-center py-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 rounded-xl">
              <span className="text-emerald-500">✓</span>
              <span className="text-xs font-semibold text-emerald-700">
                Submitted {new Date(completion.completed_at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CompletedPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id;

  const [weekOffset, setWeekOffset] = useState(0);
  const [jobs, setJobs] = useState<JobWithCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<JobWithCompletion | null>(null);
  const [jobSections, setJobSections] = useState<ChecklistSection[]>([]);
  const [liveCompletion, setLiveCompletion] = useState<Completion | null>(null);
  const [userNameMap, setUserNameMap] = useState<Map<string, string>>(new Map());
  const [userColorMap, setUserColorMap] = useState<Map<string, string>>(new Map());
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const today = useMemo(() => getTodayISO(), []);
  const focusedDate = useMemo(() => addDays(today, weekOffset * 7), [today, weekOffset]);
  const weekDates = useMemo(() => getWeekDates(focusedDate), [focusedDate]);
  const weekLabel = useMemo(() => getWeekLabel(weekDates[0], weekDates[6]), [weekDates]);

  // ── Load week data ─────────────────────────────────────────────────────────
  const loadWeek = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);

    // 1. Get teams
    const { data: teams } = await supabase.from('teams').select('id, name, color_index').eq('org_id', orgId);
    if (!teams) { setLoading(false); return; }
    const teamIds = teams.map((t: { id: string; name: string; color_index: number | null }) => t.id);
    const teamColorMap = new Map<string, string>(teams.map((t: { id: string; name: string; color_index: number | null }) => [t.id, STAFF_COLORS[((t.color_index as number) || 0) % STAFF_COLORS.length]]));
    const teamNameMap = new Map<string, string>(teams.map((t: { id: string; name: string; color_index: number | null }) => [t.id, t.name as string]));

    // 2. Get schedules for the week
    const { data: schedules } = await supabase
      .from('schedules')
      .select('id, team_id, schedule_date, is_published')
      .in('team_id', teamIds)
      .in('schedule_date', weekDates);
    if (!schedules || schedules.length === 0) { setJobs([]); setLoading(false); return; }

    type ScheduleRow = { id: string; team_id: string; schedule_date: string; is_published: boolean };
    const scheduleIds = schedules.map((s: ScheduleRow) => s.id);
    const scheduleTeamMap = new Map<string, string>(schedules.map((s: ScheduleRow) => [s.id, s.team_id]));
    const scheduleDateMap = new Map<string, string>(schedules.map((s: ScheduleRow) => [s.id, s.schedule_date]));

    // 3. Get jobs (non-break, with client)
    const { data: rawJobs } = await supabase
      .from('schedule_jobs')
      .select('id, name, address, client_id, checklist_id, schedule_id, is_break')
      .in('schedule_id', scheduleIds)
      .eq('is_break', false)
      .not('client_id', 'is', null)
      .order('position');
    if (!rawJobs || rawJobs.length === 0) { setJobs([]); setLoading(false); return; }

    type RawJob = { id: string; name: string; address: string; client_id: string | null; checklist_id: string | null; schedule_id: string; is_break: boolean };
    const jobIds = rawJobs.map((j: RawJob) => j.id);

    // 4. Get completions
    const { data: completions } = await supabase
      .from('checklist_completions')
      .select('id, schedule_job_id, items, notes, completed_by, completed_at')
      .in('schedule_job_id', jobIds);

    const completionMap = new Map<string, Completion>();
    const allUserIds = new Set<string>();

    type CompletionRow = { id: string; schedule_job_id: string; items: unknown; notes: string | null; completed_by: string; completed_at: string };
    (completions as CompletionRow[] || []).forEach(c => {
      let items: FieldAnswer[] = [];
      try { items = typeof c.items === 'string' ? JSON.parse(c.items) : ((c.items as FieldAnswer[]) || []); } catch { /* */ }
      completionMap.set(c.schedule_job_id, {
        id: c.id,
        schedule_job_id: c.schedule_job_id,
        items,
        notes: c.notes,
        completed_by: c.completed_by,
        completed_at: c.completed_at,
        is_submitted: !!c.completed_at,
      });
      items.forEach(a => { if (a.completed_by) allUserIds.add(a.completed_by); });
      if (c.completed_by) allUserIds.add(c.completed_by);
    });

    // 5. Fetch user names
    const uidArr = [...allUserIds];
    if (uidArr.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', uidArr);
      const nameMap = new Map<string, string>();
      (profiles || []).forEach((p: { id: string; full_name: string | null }) => nameMap.set(p.id, p.full_name || 'Staff'));
      setUserNameMap(nameMap);
    }

    // 6. Build color map (consistent uid → color)
    const colorMap = new Map<string, string>();
    let colorIdx = 0;
    allUserIds.forEach(uid => {
      colorMap.set(uid, STAFF_COLORS[colorIdx % STAFF_COLORS.length]);
      colorIdx++;
    });
    setUserColorMap(colorMap);

    // 7. Assemble jobs with completion info
    const jobsWithCompletion: JobWithCompletion[] = (rawJobs as RawJob[]).map(j => {
      const completion = completionMap.get(j.id) || null;
      const items = completion?.items || [];
      const teamId = scheduleTeamMap.get(j.schedule_id) || '';

      // Count answerable fields (we don't have sections loaded here — use items count as proxy)
      const answeredFields = items.filter(a => {
        if (a.na) return true;
        const v = a.value;
        if (v === null || v === '' || v === false) return false;
        if (Array.isArray(v)) return v.length > 0;
        return true;
      }).length;

      // Contributors: unique users who answered anything
      const contribUids = [...new Set(items.map(a => a.completed_by).filter(Boolean))] as string[];
      const contributors = contribUids.map((uid, i) => ({
        uid,
        color: colorMap.get(uid) || STAFF_COLORS[i % STAFF_COLORS.length],
        name: 'Staff', // filled in after userNameMap is set
      }));

      return {
        id: j.id,
        name: j.name,
        address: j.address,
        client_id: j.client_id,
        checklist_id: j.checklist_id,
        schedule_id: j.schedule_id,
        date: scheduleDateMap.get(j.schedule_id) || '',
        teamColor: teamColorMap.get(teamId) || '#4F46E5',
        teamName: teamNameMap.get(teamId) || '',
        completion,
        totalFields: items.length, // approximation; refined when panel opens
        answeredFields,
        contributors,
      };
    });

    setJobs(jobsWithCompletion);
    setLoading(false);
  }, [orgId, weekDates, supabase]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // Update contributor names once userNameMap is loaded
  const jobsWithNames = useMemo(() => jobs.map(j => ({
    ...j,
    contributors: j.contributors.map(c => ({ ...c, name: userNameMap.get(c.uid) || 'Staff' })),
  })), [jobs, userNameMap]);

  // ── Select job + load sections + subscribe realtime ────────────────────────
  const handleSelectJob = useCallback(async (job: JobWithCompletion) => {
    setSelectedJob(job);
    setLiveCompletion(job.completion);
    setJobSections([]);

    // Load checklist sections
    const clId = job.checklist_id;
    if (clId) {
      const { data: cl } = await supabase.from('client_checklists').select('sections').eq('id', clId).single();
      if (cl) {
        const secs = ((cl.sections as Record<string, unknown>[]) || []).map(migrateOldSection);
        setJobSections(secs);
      }
    } else if (job.client_id) {
      const { data: defaultCl } = await supabase.from('client_checklists').select('sections').eq('client_id', job.client_id).eq('is_default', true).maybeSingle();
      if (defaultCl) {
        const secs = ((defaultCl.sections as Record<string, unknown>[]) || []).map(migrateOldSection);
        setJobSections(secs);
      }
    }

    // Subscribe to realtime for this job
    if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current);
    const channel = supabase
      .channel(`admin-checklist:${job.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'checklist_completions',
        filter: `schedule_job_id=eq.${job.id}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const newRow = payload.new as Record<string, unknown>;
        if (!newRow) return;
        let items: FieldAnswer[] = [];
        try { items = typeof newRow.items === 'string' ? JSON.parse(newRow.items as string) : (newRow.items as FieldAnswer[] || []); } catch { /* */ }
        const newCompletion: Completion = {
          id: newRow.id as string,
          schedule_job_id: newRow.schedule_job_id as string,
          items,
          notes: newRow.notes as string | null,
          completed_by: newRow.completed_by as string,
          completed_at: newRow.completed_at as string,
          is_submitted: !!newRow.completed_at,
        };
        setLiveCompletion(newCompletion);
        // Update jobs list too
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, completion: newCompletion } : j));
        // Fetch any new user names
        const newUids = items.map(a => a.completed_by).filter((id): id is string => !!id && !userNameMap.has(id));
        if (newUids.length > 0) {
          supabase.from('profiles').select('id, full_name').in('id', newUids).then((res: { data: unknown }) => {
            const d = res.data as { id: string; full_name: string | null }[] | null;
            if (d) setUserNameMap(prev => { const n = new Map(prev); d.forEach(p => n.set(p.id, p.full_name || 'Staff')); return n; });
          });
        }
      })
      .subscribe();
    realtimeChannelRef.current = channel;
  }, [supabase, userNameMap]);

  const handleClosePanel = useCallback(() => {
    setSelectedJob(null);
    setLiveCompletion(null);
    setJobSections([]);
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  }, [supabase]);

  // ── Week stats ─────────────────────────────────────────────────────────────
  const weekStats = useMemo(() => {
    const total = jobsWithNames.length;
    const submitted = jobsWithNames.filter(j => j.completion?.is_submitted).length;
    const inProgress = jobsWithNames.filter(j => j.completion && !j.completion.is_submitted).length;
    return { total, submitted, inProgress };
  }, [jobsWithNames]);

  // ── Jobs grouped by date ───────────────────────────────────────────────────
  const jobsByDate = useMemo(() => {
    const map = new Map<string, JobWithCompletion[]>();
    weekDates.forEach(d => map.set(d, []));
    jobsWithNames.forEach(j => { if (map.has(j.date)) map.get(j.date)!.push(j); });
    return map;
  }, [jobsWithNames, weekDates]);

  return (
    <div className="h-full flex flex-col bg-[#f5f6fa] overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 bg-white border-b border-border-light px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-text-primary">Completed Jobs</h1>
            <p className="text-sm text-text-tertiary mt-0.5">{weekLabel}</p>
          </div>

          {/* Stats pills */}
          {!loading && (
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold">
                {weekStats.submitted}/{weekStats.total} submitted
              </span>
              {weekStats.inProgress > 0 && (
                <span className="px-3 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-bold">
                  {weekStats.inProgress} in progress
                </span>
              )}
            </div>
          )}

          {/* Week navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => setWeekOffset(w => w - 1)}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-elevated text-text-secondary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button onClick={() => setWeekOffset(0)}
              disabled={weekOffset === 0}
              className="px-3 h-8 rounded-xl text-xs font-semibold text-text-secondary hover:bg-surface-elevated disabled:opacity-40 transition-all">
              Today
            </button>
            <button onClick={() => setWeekOffset(w => w + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-elevated text-text-secondary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Week grid ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 grid grid-cols-7 gap-3">
            {DAY_NAMES.map(d => (
              <div key={d}>
                <div className="shimmer h-8 rounded-xl mb-2" />
                {[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl mb-2" />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 grid grid-cols-7 gap-3 min-w-[900px]">
            {weekDates.map((date, di) => {
              const dayJobs = jobsByDate.get(date) || [];
              const isToday = date === today;
              const dayLabel = getShortDayLabel(date);
              const daySubmitted = dayJobs.filter(j => j.completion?.is_submitted).length;
              const dayInProgress = dayJobs.filter(j => j.completion && !j.completion.is_submitted).length;

              return (
                <div key={date} className="flex flex-col gap-2">
                  {/* Day header */}
                  <div className={`flex items-center justify-between px-2 py-1.5 rounded-xl ${
                    isToday ? 'bg-primary text-white' : 'bg-white border border-border-light'
                  }`}>
                    <span className={`text-xs font-bold ${isToday ? 'text-white' : 'text-text-primary'}`}>{dayLabel}</span>
                    {dayJobs.length > 0 && (
                      <span className={`text-[10px] font-semibold ${isToday ? 'text-white/80' : 'text-text-tertiary'}`}>
                        {daySubmitted}/{dayJobs.length}
                      </span>
                    )}
                  </div>

                  {/* Job cards */}
                  {dayJobs.length === 0 ? (
                    <div className="flex-1 min-h-[60px] rounded-xl border border-dashed border-border-light flex items-center justify-center">
                      <span className="text-[10px] text-text-tertiary">No jobs</span>
                    </div>
                  ) : (
                    dayJobs.map(job => {
                      const isSubmitted = job.completion?.is_submitted;
                      const inProgress = job.completion && !isSubmitted;
                      const pct = job.totalFields > 0 ? Math.round((job.answeredFields / job.totalFields) * 100) : 0;

                      return (
                        <motion.button
                          key={job.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleSelectJob(job)}
                          className={`w-full text-left rounded-xl border-2 p-3 bg-white transition-all shadow-sm ${
                            selectedJob?.id === job.id ? 'border-primary shadow-md' :
                            isSubmitted ? 'border-emerald-300' :
                            inProgress ? 'border-primary/30' :
                            'border-border-light'
                          }`}
                        >
                          {/* Color stripe + name */}
                          <div className="flex items-start gap-2">
                            <div className="w-1 h-full min-h-[32px] rounded-full shrink-0 mt-0.5" style={{ backgroundColor: job.teamColor }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-text-primary leading-snug truncate">{job.name}</p>
                              {job.teamName && <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{job.teamName}</p>}
                            </div>
                          </div>

                          {/* Status + progress */}
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex -space-x-1">
                              {job.contributors.slice(0, 4).map(({ uid, color, name }) => (
                                <div key={uid} title={name}
                                  className="w-5 h-5 rounded-full border-2 border-white flex items-center justify-center text-[8px] font-bold text-white"
                                  style={{ backgroundColor: color }}>
                                  {(name || '?')[0].toUpperCase()}
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isSubmitted ? (
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-lg">✓ Done</span>
                              ) : inProgress ? (
                                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-lg">Live</span>
                              ) : (
                                <span className="text-[10px] text-text-tertiary">Not started</span>
                              )}
                            </div>
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Slide-in panel backdrop ── */}
      <AnimatePresence>
        {selectedJob && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={handleClosePanel}
            />
            <ChecklistPanel
              job={selectedJob}
              sections={jobSections}
              completion={liveCompletion}
              contributors={selectedJob.contributors.map(c => ({ ...c, name: userNameMap.get(c.uid) || 'Staff' }))}
              userNameMap={userNameMap}
              userColorMap={userColorMap}
              onClose={handleClosePanel}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
