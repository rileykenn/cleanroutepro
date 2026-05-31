'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { getTodayISO, getWeekDates, getWeekLabel, getShortDayLabel } from '@/lib/timeUtils';
import { ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import { COLLAB_COLORS } from '@/components/StaffChecklistView';

const STAFF_COLORS = COLLAB_COLORS.map((c: { bg: string; text: string }) => c.bg);
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Types ────────────────────────────────────────────────────────────────────
interface AssignedStaff {
  id: string;        // staff_members.id
  name: string;
  userId: string | null; // staff_members.user_id → auth user
  color: string;
}

interface FieldAnswer {
  fieldId: string;
  value: string | string[] | boolean | null;
  na?: boolean;
  completed_by?: string; // auth user id
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

interface JobWithCompletion {
  id: string;
  name: string;
  address: string;
  client_id: string | null;
  checklist_id: string | null;
  schedule_id: string;
  date: string;
  teamColor: string;
  teamName: string;
  assignedStaff: AssignedStaff[];
  completion: Completion | null;
  totalFields: number;
  answeredFields: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseItems(raw: unknown): FieldAnswer[] {
  try {
    if (typeof raw === 'string') return JSON.parse(raw) as FieldAnswer[];
    if (Array.isArray(raw)) return raw as FieldAnswer[];
  } catch { /* */ }
  return [];
}

type CompletionRow = {
  id: string; schedule_job_id: string; items: unknown;
  notes: string | null; completed_by: string; completed_at: string;
  status?: string; submitted_at?: string | null;
};

function parseCompletion(c: CompletionRow): Completion {
  return {
    id: c.id,
    schedule_job_id: c.schedule_job_id,
    items: parseItems(c.items),
    notes: c.notes,
    completed_by: c.completed_by,
    completed_at: c.completed_at,
    is_submitted: c.status === 'submitted' || !!c.submitted_at,
  };
}

function countAnswered(items: FieldAnswer[]): number {
  return items.filter(a => {
    if (a.na) return true;
    const v = a.value;
    if (v === null || v === '' || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;
}

// ─── Progress ring ────────────────────────────────────────────────────────────
function ProgressRing({ pct, submitted, size = 36 }: { pct: number; submitted: boolean; size?: number }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E5E7EB" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={submitted ? '#10B981' : pct > 0 ? '#4F46E5' : '#E5E7EB'}
        strokeWidth="3"
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.4s ease' }} />
    </svg>
  );
}

// ─── Checklist panel (admin read-only, live) ──────────────────────────────────
function ChecklistPanel({
  job, sections, completion, userNameMap, onClose, loading,
}: {
  job: JobWithCompletion;
  sections: ChecklistSection[];
  completion: Completion | null;
  userNameMap: Map<string, string>;
  onClose: () => void;
  loading: boolean;
}) {
  // Build userId → {color, name} from assignedStaff first (consistent colors)
  const staffByUserId = useMemo(() => {
    const m = new Map<string, AssignedStaff>();
    job.assignedStaff.forEach(s => { if (s.userId) m.set(s.userId, s); });
    return m;
  }, [job.assignedStaff]);

  const getColor = (uid?: string) => {
    if (!uid) return undefined;
    return staffByUserId.get(uid)?.color;
  };

  const getName = (uid?: string) => {
    if (!uid) return 'Staff';
    const staff = staffByUserId.get(uid);
    if (staff) return staff.name;
    return userNameMap.get(uid) || 'Staff';
  };

  const answers = useMemo(() => {
    const m = new Map<string, FieldAnswer>();
    (completion?.items || []).forEach(a => m.set(a.fieldId, a));
    return m;
  }, [completion]);

  const allFields = useMemo(() =>
    sections.flatMap(s => s.fields.filter(f => f.type !== 'heading' && f.type !== 'paragraph' && f.type !== 'logic')),
  [sections]);

  const answeredCount = useMemo(() => countAnswered(completion?.items || []), [completion]);
  const pct = allFields.length > 0 ? Math.round((answeredCount / allFields.length) * 100) : 0;
  const isSubmitted = completion?.is_submitted ?? false;

  // Unique contributors (users who answered at least one field)
  const contributors = useMemo(() => {
    const seen = new Set<string>();
    (completion?.items || []).forEach(a => { if (a.completed_by) seen.add(a.completed_by); });
    return [...seen].map(uid => ({ uid, color: getColor(uid) || STAFF_COLORS[0], name: getName(uid) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completion, staffByUserId, userNameMap]);

  return (
    <motion.div
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col border-l border-border-light lg:inset-y-0 lg:right-0 lg:top-auto lg:bottom-auto"
    >
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-border-light">
        <div className="flex items-start gap-3">
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-elevated text-text-secondary transition-colors shrink-0 mt-0.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-text-primary truncate">{job.name}</h3>
            <p className="text-xs text-text-tertiary truncate mt-0.5">{job.address}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ProgressRing pct={pct} submitted={isSubmitted} />
            <div className="text-right">
              <p className={`text-xs font-bold ${isSubmitted ? 'text-emerald-600' : pct > 0 ? 'text-primary' : 'text-text-tertiary'}`}>
                {isSubmitted ? 'Submitted' : pct > 0 ? 'In Progress' : 'Not Started'}
              </p>
              {allFields.length > 0 && (
                <p className="text-[10px] text-text-tertiary">{answeredCount}/{allFields.length} fields</p>
              )}
            </div>
          </div>
        </div>

        {/* Assigned team */}
        {job.assignedStaff.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-1.5">Assigned Team</p>
            <div className="flex flex-wrap gap-1.5">
              {job.assignedStaff.map(staff => (
                <span key={staff.id}
                  className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                  style={{ backgroundColor: staff.color }}>
                  {staff.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Who filled it in */}
        {contributors.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-1.5">Filled in by</p>
            <div className="flex flex-wrap gap-1.5">
              {contributors.map(({ uid, color, name }) => (
                <span key={uid}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                  style={{ borderColor: color, color }}>
                  ● {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Live indicator */}
        {!isSubmitted && completion && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-emerald-600 font-semibold">Live — updating in real time</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="shimmer h-12 rounded-xl" />)}
          </div>
        ) : sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <div className="w-12 h-12 rounded-xl bg-surface-elevated flex items-center justify-center text-2xl">📋</div>
            <p className="text-sm font-semibold text-text-secondary">No checklist assigned</p>
            <p className="text-xs text-text-tertiary">Assign a checklist to this job in the scheduler</p>
          </div>
        ) : (
          sections.map(section => (
            <div key={section.id}>
              {section.title && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-border" />
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary shrink-0 px-1">
                    {section.title}
                  </h4>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <div className="space-y-1.5">
                {section.fields.map(field => {
                  if (field.type === 'heading') return (
                    <p key={field.id} className="text-[11px] font-bold uppercase tracking-widest text-text-tertiary pt-2">
                      {field.label}
                    </p>
                  );
                  if (field.type === 'paragraph' || field.type === 'logic') return null;

                  const ans = answers.get(field.id);
                  const answererColor = getColor(ans?.completed_by);
                  const isAnswered = !!ans && (
                    ans.na === true ||
                    (ans.value !== null && ans.value !== undefined && ans.value !== '' &&
                     ans.value !== false && !(Array.isArray(ans.value) && ans.value.length === 0))
                  );

                  let displayVal = '';
                  if (ans?.na) displayVal = 'N/A';
                  else if (ans?.value === true || ans?.value === 'yes') displayVal = '✓  Yes';
                  else if (ans?.value === false || ans?.value === 'no') displayVal = '✗  No';
                  else if (Array.isArray(ans?.value) && field.type !== 'photo' && field.type !== 'video')
                    displayVal = (ans.value as string[]).join(', ');
                  else if (ans?.value && field.type !== 'photo' && field.type !== 'video')
                    displayVal = String(ans.value);

                  // For photo/video fields: get array of URLs
                  const mediaUrls: string[] = (field.type === 'photo' || field.type === 'video')
                    ? (Array.isArray(ans?.value) ? (ans.value as string[]) : ans?.value ? [String(ans.value)] : [])
                    : [];

                  return (
                    <div key={field.id}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                        isAnswered
                          ? 'bg-white border-border-light'
                          : 'bg-surface-elevated/50 border-transparent'
                      }`}
                      style={isAnswered && answererColor
                        ? { borderLeftColor: answererColor, borderLeftWidth: 3 }
                        : undefined}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-text-primary leading-snug">{field.label}</p>

                        {/* ── Photo thumbnails ── */}
                        {(field.type === 'photo' || field.type === 'video') ? (
                          mediaUrls.length > 0 ? (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {mediaUrls.map((url, ui) =>
                                field.type === 'photo' ? (
                                  <a key={ui} href={url} target="_blank" rel="noopener noreferrer"
                                    className="block w-20 h-20 rounded-xl overflow-hidden border border-border-light bg-surface-elevated shrink-0 hover:opacity-80 transition-opacity">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={url} alt={`Photo ${ui + 1}`} className="w-full h-full object-cover" />
                                  </a>
                                ) : (
                                  <a key={ui} href={url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border-light bg-surface-elevated text-xs font-medium text-primary hover:bg-primary/5 transition-colors">
                                    <span className="text-base">🎬</span>
                                    View video {ui + 1}
                                  </a>
                                )
                              )}
                            </div>
                          ) : (
                            <p className="text-[10px] text-text-tertiary mt-0.5">Not answered</p>
                          )
                        ) : displayVal ? (
                          <p className="text-xs text-text-secondary mt-0.5 font-medium">{displayVal}</p>
                        ) : (
                          <p className="text-[10px] text-text-tertiary mt-0.5">Not answered</p>
                        )}
                      </div>
                      {isAnswered && answererColor && (
                        <div
                          className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white mt-0.5"
                          style={{ backgroundColor: answererColor }}
                          title={getName(ans?.completed_by)}
                        >
                          {(getName(ans?.completed_by) || '?')[0].toUpperCase()}
                        </div>
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
                Submitted {new Date(completion.completed_at).toLocaleString('en-AU', {
                  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        )}

        {/* No completion yet */}
        {!loading && !completion && sections.length > 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-text-tertiary">No checklist submitted yet.</p>
            {job.assignedStaff.length > 0 && (
              <p className="text-xs text-text-tertiary mt-1">
                Waiting on: {job.assignedStaff.map(s => s.name).join(', ')}
              </p>
            )}
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

  // ── Published weeks navigation ──────────────────────────────────────────────
  // Only weeks that have at least one published schedule row are shown.
  // publishedWeekStarts is sorted newest → oldest (index 0 = most recent).
  const [publishedWeekStarts, setPublishedWeekStarts] = useState<string[]>([]);
  const [weekIndex, setWeekIndex] = useState(0); // 0 = most recent published week
  const [weeksLoading, setWeeksLoading] = useState(true);

  const [jobs, setJobs] = useState<JobWithCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<JobWithCompletion | null>(null);
  const [jobSections, setJobSections] = useState<ChecklistSection[]>([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [liveCompletion, setLiveCompletion] = useState<Completion | null>(null);
  const [userNameMap, setUserNameMap] = useState<Map<string, string>>(new Map());
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pageChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const today = useMemo(() => getTodayISO(), []);

  // Derive weekDates from the currently selected published week start
  const currentWeekStart = publishedWeekStarts[weekIndex] ?? null;
  const weekDates = useMemo(
    () => currentWeekStart ? getWeekDates(currentWeekStart) : [],
    [currentWeekStart]
  );
  const weekLabel = useMemo(
    () => weekDates.length === 7 ? getWeekLabel(weekDates[0], weekDates[6]) : 'No published weeks',
    [weekDates]
  );

  // ── Load all published week starts ─────────────────────────────────────────
  const loadPublishedWeeks = useCallback(async () => {
    if (!orgId) return;
    setWeeksLoading(true);

    const { data: teamsRaw } = await supabase
      .from('teams').select('id').eq('org_id', orgId);
    if (!teamsRaw || teamsRaw.length === 0) { setWeeksLoading(false); return; }
    const teamIds = (teamsRaw as { id: string }[]).map(t => t.id);

    const { data: schedulesRaw } = await supabase
      .from('schedules')
      .select('schedule_date')
      .in('team_id', teamIds)
      .eq('is_published', true);

    if (!schedulesRaw || schedulesRaw.length === 0) {
      setPublishedWeekStarts([]);
      setWeeksLoading(false);
      setLoading(false);
      return;
    }

    // Convert each date → its Monday (week start), deduplicate, sort newest first
    const weekStartSet = new Set<string>();
    (schedulesRaw as { schedule_date: string }[]).forEach(r => {
      weekStartSet.add(getWeekDates(r.schedule_date)[0]);
    });
    const sorted = [...weekStartSet].sort((a, b) => b.localeCompare(a)); // newest first
    setPublishedWeekStarts(sorted);
    setWeekIndex(0);
    setWeeksLoading(false);
  }, [orgId, supabase]);

  useEffect(() => { loadPublishedWeeks(); }, [loadPublishedWeeks]);

  // ── Load week ────────────────────────────────────────────────────────────────
  const loadWeek = useCallback(async () => {
    if (!orgId || weekDates.length === 0) return;
    setLoading(true);

    // 1. Teams
    const { data: teamsRaw } = await supabase
      .from('teams').select('id, name, color_index').eq('org_id', orgId);
    if (!teamsRaw) { setLoading(false); return; }
    type TeamRow = { id: string; name: string; color_index: number | null };
    const teams = teamsRaw as TeamRow[];
    const teamIds = teams.map(t => t.id);
    const teamColorMap = new Map<string, string>(teams.map(t => [t.id, STAFF_COLORS[(t.color_index || 0) % STAFF_COLORS.length]]));
    const teamNameMap = new Map<string, string>(teams.map(t => [t.id, t.name]));

    // 2. Schedules for the week — PUBLISHED ONLY
    const { data: schedulesRaw } = await supabase
      .from('schedules').select('id, team_id, schedule_date')
      .in('team_id', teamIds).in('schedule_date', weekDates)
      .eq('is_published', true);
    if (!schedulesRaw || schedulesRaw.length === 0) { setJobs([]); setLoading(false); return; }
    type ScheduleRow = { id: string; team_id: string; schedule_date: string };
    const schedules = schedulesRaw as ScheduleRow[];
    const scheduleIds = schedules.map(s => s.id);
    const scheduleTeamMap = new Map<string, string>(schedules.map(s => [s.id, s.team_id]));
    const scheduleDateMap = new Map<string, string>(schedules.map(s => [s.id, s.schedule_date]));

    // 3. Jobs (non-break, with client, including assigned staff)
    const { data: jobsRaw } = await supabase
      .from('schedule_jobs')
      .select('id, name, address, client_id, checklist_id, schedule_id, assigned_staff_ids')
      .in('schedule_id', scheduleIds)
      .eq('is_break', false)
      .not('client_id', 'is', null)
      .order('position');
    if (!jobsRaw || jobsRaw.length === 0) { setJobs([]); setLoading(false); return; }
    type RawJob = {
      id: string; name: string; address: string; client_id: string | null;
      checklist_id: string | null; schedule_id: string; assigned_staff_ids: string[] | null;
    };
    const rawJobs = jobsRaw as RawJob[];
    const jobIds = rawJobs.map(j => j.id);

    // 4. Fetch all assigned staff members
    const allStaffIds = new Set<string>();
    rawJobs.forEach(j => (j.assigned_staff_ids || []).forEach(id => allStaffIds.add(id)));
    type StaffRow = { id: string; name: string; user_id: string | null };
    let staffMap = new Map<string, StaffRow>();
    if (allStaffIds.size > 0) {
      const { data: staffData } = await supabase
        .from('staff_members').select('id, name, user_id').in('id', [...allStaffIds]);
      if (staffData) staffMap = new Map<string, StaffRow>((staffData as StaffRow[]).map(s => [s.id, s]));
    }

    // 5. Completions
    const { data: completionsRaw } = await supabase
      .from('checklist_completions')
      .select('id, schedule_job_id, items, notes, completed_by, completed_at, status, submitted_at')
      .in('schedule_job_id', jobIds);
    const completionMap = new Map<string, Completion>();
    const allUserIds = new Set<string>();
    (completionsRaw as CompletionRow[] || []).forEach(c => {
      const comp = parseCompletion(c);
      completionMap.set(c.schedule_job_id, comp);
      comp.items.forEach(a => { if (a.completed_by) allUserIds.add(a.completed_by); });
      if (c.completed_by) allUserIds.add(c.completed_by);
    });

    // 6. User display names
    if (allUserIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles').select('id, full_name').in('id', [...allUserIds]);
      const nameMap = new Map<string, string>();
      (profiles as { id: string; full_name: string | null }[] || []).forEach(p =>
        nameMap.set(p.id, p.full_name || 'Staff'));
      setUserNameMap(nameMap);
    }

    // 7. Assemble
    const assembled: JobWithCompletion[] = rawJobs.map(j => {
      const completion = completionMap.get(j.id) || null;
      const teamId = scheduleTeamMap.get(j.schedule_id) || '';

      const assignedStaff: AssignedStaff[] = (j.assigned_staff_ids || []).map((sid, si) => {
        const s = staffMap.get(sid);
        return {
          id: sid,
          name: s?.name || 'Staff',
          userId: s?.user_id || null,
          color: STAFF_COLORS[si % STAFF_COLORS.length],
        };
      });

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
        assignedStaff,
        completion,
        totalFields: completion?.items.length || 0,
        answeredFields: countAnswered(completion?.items || []),
      };
    });

    setJobs(assembled);
    setLoading(false);
  }, [orgId, weekDates, supabase]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  // ── Page-level realtime: watch ALL completions for this org ─────────────────
  // So when staff submit a checklist the job card updates immediately
  useEffect(() => {
    if (!orgId) return;

    const ch = supabase
      .channel(`completed-org:${orgId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'checklist_completions',
        filter: `org_id=eq.${orgId}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const row = payload.new;
        if (!row?.id) return;
        const jobId = row.schedule_job_id as string;
        if (!jobId) return;

        const comp = parseCompletion({
          id: row.id as string,
          schedule_job_id: jobId,
          items: row.items as unknown,
          notes: row.notes as string | null,
          completed_by: row.completed_by as string,
          completed_at: row.completed_at as string,
        });

        setJobs(prev => prev.map(j => {
          if (j.id !== jobId) return j;
          return {
            ...j,
            completion: comp,
            totalFields: Math.max(j.totalFields, comp.items.length),
            answeredFields: countAnswered(comp.items),
          };
        }));

        // Update live panel if it's open for this job
        setSelectedJob(prev => {
          if (!prev || prev.id !== jobId) return prev;
          return { ...prev, completion: comp };
        });
        setLiveCompletion(prev => {
          if (prev === null || prev.schedule_job_id === jobId) return comp;
          return prev;
        });
      })
      .subscribe();

    pageChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [orgId, supabase]);

  // ── Open job panel: fetch fresh data + subscribe realtime ───────────────────
  const handleSelectJob = useCallback(async (job: JobWithCompletion) => {
    setSelectedJob(job);
    setPanelLoading(true);
    setJobSections([]);
    setLiveCompletion(null);

    // Always fetch fresh completion from DB (don't rely on stale cached data)
    const { data: freshComp } = await supabase
      .from('checklist_completions')
      .select('id, schedule_job_id, items, notes, completed_by, completed_at, status, submitted_at')
      .eq('schedule_job_id', job.id)
      .maybeSingle();

    if (freshComp) {
      const parsed = parseCompletion(freshComp as CompletionRow);
      setLiveCompletion(parsed);
      setJobs(prev => prev.map(j => j.id === job.id
        ? { ...j, completion: parsed, answeredFields: countAnswered(parsed.items), totalFields: Math.max(j.totalFields, parsed.items.length) }
        : j));
    }

    // Load checklist template sections
    if (job.checklist_id) {
      const { data: cl } = await supabase
        .from('client_checklists').select('sections').eq('id', job.checklist_id).single();
      if (cl) setJobSections(((cl.sections as Record<string, unknown>[]) || []).map(migrateOldSection));
    } else if (job.client_id) {
      const { data: cl } = await supabase
        .from('client_checklists').select('sections')
        .eq('client_id', job.client_id).eq('is_default', true).maybeSingle();
      if (cl) setJobSections(((cl.sections as Record<string, unknown>[]) || []).map(migrateOldSection));
    }

    setPanelLoading(false);

    // Subscribe to realtime for this specific job (in addition to page-level)
    if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current);
    const ch = supabase
      .channel(`admin-cl:${job.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'checklist_completions',
        filter: `schedule_job_id=eq.${job.id}`,
      }, (payload: { new: Record<string, unknown> }) => {
        const row = payload.new;
        if (!row?.id) return;
        const comp = parseCompletion({
          id: row.id as string,
          schedule_job_id: row.schedule_job_id as string,
          items: row.items as unknown,
          notes: row.notes as string | null,
          completed_by: row.completed_by as string,
          completed_at: row.completed_at as string,
        });
        setLiveCompletion(comp);
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, completion: comp } : j));
      })
      .subscribe();
    realtimeChannelRef.current = ch;
  }, [supabase]);

  const handleClosePanel = useCallback(() => {
    setSelectedJob(null);
    setLiveCompletion(null);
    setJobSections([]);
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  }, [supabase]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const weekStats = useMemo(() => ({
    total: jobs.length,
    submitted: jobs.filter(j => j.completion?.is_submitted).length,
    inProgress: jobs.filter(j => j.completion && !j.completion.is_submitted).length,
  }), [jobs]);

  const jobsByDate = useMemo(() => {
    const map = new Map<string, JobWithCompletion[]>();
    weekDates.forEach(d => map.set(d, []));
    jobs.forEach(j => { if (map.has(j.date)) map.get(j.date)!.push(j); });
    return map;
  }, [jobs, weekDates]);

  return (
    <div className="h-full flex flex-col bg-[#f5f6fa] overflow-hidden">

      {/* ── Header ── */}
      <div className="shrink-0 bg-white border-b border-border-light px-4 lg:px-6 py-3 lg:py-4">
        <div className="flex items-center gap-4 flex-wrap justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-primary">Completed Jobs</h1>
            <p className="text-sm text-text-tertiary mt-0.5">{weekLabel}</p>
          </div>

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

          <div className="flex items-center gap-1">
            {/* Older week (higher index = older) */}
            <button
              onClick={() => setWeekIndex(i => Math.min(i + 1, publishedWeekStarts.length - 1))}
              disabled={weekIndex >= publishedWeekStarts.length - 1}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-elevated text-text-secondary transition-colors disabled:opacity-30">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="px-2 text-xs text-text-tertiary font-medium">
              {weekIndex + 1} / {publishedWeekStarts.length}
            </span>
            {/* Newer week (lower index = newer) */}
            <button
              onClick={() => setWeekIndex(i => Math.max(i - 1, 0))}
              disabled={weekIndex <= 0}
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-elevated text-text-secondary transition-colors disabled:opacity-30">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
            <div className="w-px h-4 bg-border-light mx-1" />
            {/* Manual refresh */}
            <button onClick={() => { loadPublishedWeeks(); loadWeek(); }} disabled={loading || weeksLoading}
              title="Refresh"
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-surface-elevated text-text-secondary transition-colors disabled:opacity-40">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className={loading || weeksLoading ? 'animate-spin' : ''}>
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Week grid ── */}
      <div className="flex-1 overflow-auto">
        {weeksLoading ? (
          <>
            {/* Desktop skeleton */}
            <div className="hidden lg:grid p-6 grid-cols-7 gap-3">
              {DAY_NAMES.map(d => (
                <div key={d}>
                  <div className="shimmer h-8 rounded-xl mb-2" />
                  {[1, 2, 3].map(i => <div key={i} className="shimmer h-20 rounded-xl mb-2" />)}
                </div>
              ))}
            </div>
            {/* Mobile skeleton */}
            <div className="lg:hidden p-4 space-y-3">
              {[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-2xl" />)}
            </div>
          </>
        ) : publishedWeekStarts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-surface-elevated flex items-center justify-center text-3xl">📅</div>
            <div>
              <p className="text-sm font-bold text-text-primary">No published weeks yet</p>
              <p className="text-xs text-text-tertiary mt-1">Publish a week from the Schedule page to see it here</p>
            </div>
          </div>
        ) : loading ? (
          <>
            {/* Desktop skeleton */}
            <div className="hidden lg:grid p-6 grid-cols-7 gap-3">
              {DAY_NAMES.map(d => (
                <div key={d}>
                  <div className="shimmer h-8 rounded-xl mb-2" />
                  {[1, 2, 3].map(i => <div key={i} className="shimmer h-20 rounded-xl mb-2" />)}
                </div>
              ))}
            </div>
            {/* Mobile skeleton */}
            <div className="lg:hidden p-4 space-y-3">
              {[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-2xl" />)}
            </div>
          </>
        ) : (
          <>
            {/* ══ DESKTOP: 7-column week grid ══ */}
            <div className="hidden lg:grid p-6 grid-cols-7 gap-3 min-w-[900px]">
              {weekDates.map(date => {
                const dayJobs = jobsByDate.get(date) || [];
                const isToday = date === today;
                const dayLabel = getShortDayLabel(date);
                const daySubmitted = dayJobs.filter(j => j.completion?.is_submitted).length;

                return (
                  <div key={date} className="flex flex-col gap-2">
                    <div className={`flex items-center justify-between px-2 py-1.5 rounded-xl ${
                      isToday ? 'bg-primary' : 'bg-white border border-border-light'
                    }`}>
                      <span className={`text-xs font-bold ${isToday ? 'text-white' : 'text-text-primary'}`}>
                        {dayLabel}
                      </span>
                      {dayJobs.length > 0 && (
                        <span className={`text-[10px] font-semibold ${isToday ? 'text-white/80' : 'text-text-tertiary'}`}>
                          {daySubmitted}/{dayJobs.length}
                        </span>
                      )}
                    </div>
                    {dayJobs.length === 0 ? (
                      <div className="min-h-[60px] rounded-xl border border-dashed border-border-light flex items-center justify-center">
                        <span className="text-[10px] text-text-tertiary">No jobs</span>
                      </div>
                    ) : (
                      dayJobs.map(job => {
                        const isSubmitted = job.completion?.is_submitted;
                        const inProgress = job.completion && !isSubmitted;
                        const pct = job.totalFields > 0
                          ? Math.round((job.answeredFields / job.totalFields) * 100) : 0;
                        return (
                          <motion.button
                            key={job.id}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleSelectJob(job)}
                            className={`w-full text-left rounded-xl border-2 p-3 bg-white shadow-sm transition-all ${
                              selectedJob?.id === job.id ? 'border-primary shadow-md' :
                              isSubmitted ? 'border-emerald-300' :
                              inProgress ? 'border-primary/30' :
                              'border-border-light'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <div className="w-1 min-h-[28px] rounded-full shrink-0" style={{ backgroundColor: job.teamColor }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-text-primary leading-snug truncate">{job.name}</p>
                                {job.teamName && <p className="text-[10px] text-text-tertiary mt-0.5 truncate">{job.teamName}</p>}
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-2">
                              <div className="flex -space-x-1">
                                {job.assignedStaff.length > 0
                                  ? job.assignedStaff.slice(0, 4).map(staff => (
                                    <div key={staff.id} title={staff.name}
                                      className="w-5 h-5 rounded-full border-2 border-white flex items-center justify-center text-[8px] font-bold text-white"
                                      style={{ backgroundColor: staff.color }}>
                                      {(staff.name || '?')[0].toUpperCase()}
                                    </div>
                                  ))
                                  : <div className="w-5 h-5 rounded-full border border-dashed border-border-light bg-surface-elevated" />}
                              </div>
                              <div>
                                {isSubmitted ? (
                                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-lg">✓ Done</span>
                                ) : inProgress ? (
                                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-lg">{pct}% done</span>
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

            {/* ══ MOBILE: vertical day list ══ */}
            <div className="lg:hidden p-3 space-y-2 pb-20">
              {weekDates.map(date => {
                const dayJobs = jobsByDate.get(date) || [];
                const isToday = date === today;
                const dayLabel = getShortDayLabel(date);
                const dayNum = new Date(date + 'T12:00:00').getDate();
                const daySubmitted = dayJobs.filter(j => j.completion?.is_submitted).length;
                if (dayJobs.length === 0) return null;

                return (
                  <div key={date}>
                    {/* Day heading */}
                    <div className={`flex items-center gap-2 px-2 py-2 mb-1.5`}>
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
                        isToday ? 'bg-primary text-white' : 'bg-white border border-border-light text-text-primary'
                      }`}>
                        {dayNum}
                      </div>
                      <div className="flex-1">
                        <span className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-text-primary'}`}>
                          {dayLabel}{isToday ? ' — Today' : ''}
                        </span>
                      </div>
                      <span className="text-xs text-text-tertiary font-medium">
                        {daySubmitted}/{dayJobs.length} done
                      </span>
                    </div>

                    {/* Job cards */}
                    <div className="space-y-2">
                      {dayJobs.map(job => {
                        const isSubmitted = job.completion?.is_submitted;
                        const inProgress = job.completion && !isSubmitted;
                        const pct = job.totalFields > 0
                          ? Math.round((job.answeredFields / job.totalFields) * 100) : 0;
                        return (
                          <motion.button
                            key={job.id}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleSelectJob(job)}
                            className={`w-full text-left rounded-2xl border-2 px-4 py-3 bg-white shadow-sm transition-all active:scale-[0.98] ${
                              selectedJob?.id === job.id ? 'border-primary shadow-md' :
                              isSubmitted ? 'border-emerald-300' :
                              inProgress ? 'border-primary/30' :
                              'border-border-light'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* Team color stripe */}
                              <div className="w-1 h-10 rounded-full shrink-0" style={{ backgroundColor: job.teamColor }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-text-primary leading-snug truncate">{job.name}</p>
                                <p className="text-xs text-text-tertiary mt-0.5 truncate">{job.address || job.teamName}</p>
                              </div>
                              {/* Status badge */}
                              <div className="shrink-0">
                                {isSubmitted ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-xl">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                    Done
                                  </span>
                                ) : inProgress ? (
                                  <span className="inline-flex items-center text-xs font-bold text-primary bg-primary/10 px-2.5 py-1.5 rounded-xl">{pct}%</span>
                                ) : (
                                  <span className="inline-flex items-center text-xs text-text-tertiary bg-surface-elevated px-2.5 py-1.5 rounded-xl">—</span>
                                )}
                              </div>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
                                <polyline points="9 18 15 12 9 6"/>
                              </svg>
                            </div>
                            {/* Staff avatars */}
                            {job.assignedStaff.length > 0 && (
                              <div className="flex items-center gap-1.5 mt-2 pl-4">
                                <div className="flex -space-x-1">
                                  {job.assignedStaff.slice(0, 5).map(staff => (
                                    <div key={staff.id} title={staff.name}
                                      className="w-5 h-5 rounded-full border-2 border-white flex items-center justify-center text-[8px] font-bold text-white"
                                      style={{ backgroundColor: staff.color }}>
                                      {(staff.name || '?')[0].toUpperCase()}
                                    </div>
                                  ))}
                                </div>
                                <span className="text-[10px] text-text-tertiary">
                                  {job.assignedStaff.map(s => s.name).join(', ')}
                                </span>
                              </div>
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Empty state for mobile */}
              {weekDates.every(d => (jobsByDate.get(d) || []).length === 0) && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <div className="text-4xl">📋</div>
                  <p className="text-sm font-semibold text-text-secondary">No jobs this week</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Slide-in panel ── */}
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
              userNameMap={userNameMap}
              onClose={handleClosePanel}
              loading={panelLoading}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
