'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { ChecklistField, ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import { MediaUrls } from '@/lib/types';

interface StaffChecklistViewProps {
  clientId: string;
  clientName: string;
  clientAddress?: string;
  scheduleJobId?: string;
  jobChecklistId?: string | null;
  onClose: () => void;
}

// ─── Staff color palette (6 distinct colors for collaboration) ────────────────
export const COLLAB_COLORS = [
  { bg: '#4F46E5', light: '#EEF2FF', text: '#3730A3' }, // Indigo
  { bg: '#059669', light: '#ECFDF5', text: '#065F46' }, // Emerald
  { bg: '#D97706', light: '#FFFBEB', text: '#92400E' }, // Amber
  { bg: '#DC2626', light: '#FEF2F2', text: '#991B1B' }, // Red
  { bg: '#7C3AED', light: '#F5F3FF', text: '#5B21B6' }, // Purple
  { bg: '#0891B2', light: '#ECFEFF', text: '#155E75' }, // Cyan
];

// ─── Per-field answer (includes who last answered it) ─────────────────────────
interface FieldAnswer {
  fieldId: string;
  value: string | string[] | boolean | null;
  na?: boolean;
  completed_by?: string; // auth user id of who last touched this field
}

// ─── Field renderer (identical to before) ────────────────────────────────────
function FieldCard({
  field,
  answer,
  onChange,
  onNa,
  onFileChange,
  hasError,
  answererColor,
}: {
  field: ChecklistField;
  answer: FieldAnswer;
  onChange: (value: FieldAnswer['value']) => void;
  onNa: () => void;
  onFileChange: (files: FileList) => void;
  hasError: boolean;
  answererColor?: string; // hex color of whoever answered this field
}) {
  const value = answer.value;
  const isNa = !!answer.na;

  if (field.type === 'heading') {
    return (
      <div className="pt-2 pb-1">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary shrink-0 px-1">{field.label}</h3>
          <div className="flex-1 h-px bg-border" />
        </div>
        {field.description && <p className="text-center text-xs text-text-tertiary mt-1">{field.description}</p>}
      </div>
    );
  }

  if (field.type === 'paragraph') {
    return (
      <div className="px-1 py-2">
        <p className="text-sm text-text-secondary leading-relaxed">{field.label}</p>
      </div>
    );
  }

  const isAnswered = isNa || (value !== null && value !== '' && value !== false && !(Array.isArray(value) && value.length === 0));
  const borderColor = isAnswered && answererColor ? answererColor : undefined;

  const wrapperCls = `rounded-2xl border-2 p-4 bg-white transition-all ${
    hasError ? 'border-red-300 bg-red-50/50' :
    isNa ? 'border-border-light opacity-60' :
    'border-border-light'
  }`;

  const Header = () => (
    <div className="flex items-start justify-between gap-2 mb-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary leading-snug">
          {field.label}
          {field.required && !isNa && <span className="text-red-500 ml-1">*</span>}
        </p>
        {field.description && <p className="text-xs text-text-tertiary mt-0.5">{field.description}</p>}
        {hasError && <p className="text-xs text-red-500 mt-1 font-medium">This field is required</p>}
      </div>
      <div className="flex items-center gap-2">
        {isAnswered && answererColor && (
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: answererColor }} />
        )}
        {field.allowNA !== false && (
          <button
            onClick={onNa}
            className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
              isNa
                ? 'bg-surface-elevated border-border text-text-secondary'
                : 'border-border-light text-text-tertiary hover:border-border hover:text-text-secondary'
            }`}
          >N/A</button>
        )}
      </div>
    </div>
  );

  if (field.type === 'checkbox') {
    const checked = value === true || value === 'true';
    return (
      <button
        onClick={() => !isNa && onChange(!checked)}
        className={`w-full flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.99]`}
        style={checked && answererColor ? { borderColor: answererColor, backgroundColor: answererColor + '18' } : undefined}
      >
        <div
          className={`shrink-0 w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all`}
          style={checked && answererColor ? { backgroundColor: answererColor, borderColor: answererColor } : { borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' }}
        >
          {checked && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-snug ${checked ? 'text-text-primary' : 'text-text-primary'}`}>
            {field.label}
            {field.required && !isNa && !checked && <span className="text-red-500 ml-1">*</span>}
          </p>
          {field.description && <p className="text-xs text-text-tertiary mt-0.5">{field.description}</p>}
          {hasError && <p className="text-xs text-red-500 mt-1 font-medium">Required</p>}
        </div>
        {field.allowNA !== false && (
          <button onClick={e => { e.stopPropagation(); onNa(); }}
            className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
              isNa ? 'bg-surface-elevated border-border text-text-secondary' : 'border-border-light text-text-tertiary'
            }`}>N/A</button>
        )}
      </button>
    );
  }

  if (field.type === 'yesno') {
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <div className="flex gap-2">
          {(['yes', 'no'] as const).map(opt => (
            <button key={opt} onClick={() => !isNa && onChange(opt)} disabled={isNa}
              className={`flex-1 py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] ${
                value === opt
                  ? opt === 'yes' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-red-400 text-white shadow-sm'
                  : 'bg-surface-elevated text-text-secondary border border-border-light hover:border-border'
              } disabled:pointer-events-none`}>
              {opt === 'yes' ? '✓  Yes' : '✗  No'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'multiselect') {
    const opts = field.options || [];
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      if (isNa) return;
      onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
    };
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <div className="space-y-2">
          {opts.map(opt => {
            const ticked = selected.includes(opt);
            return (
              <button key={opt} onClick={() => toggle(opt)} disabled={isNa}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left active:scale-[0.99] disabled:pointer-events-none`}
                style={ticked && answererColor ? { borderColor: answererColor, backgroundColor: answererColor + '18' } : undefined}
              >
                <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center`}
                  style={ticked && answererColor ? { backgroundColor: answererColor, borderColor: answererColor } : { borderColor: '#D1D5DB', backgroundColor: '#fff' }}>
                  {ticked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span className="text-sm font-medium text-text-primary">{opt}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.type === 'multidropdown') {
    const opts = field.options || [];
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      if (isNa) return;
      onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
    };
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <div className="flex flex-wrap gap-2">
          {opts.map(opt => (
            <button key={opt} onClick={() => toggle(opt)} disabled={isNa}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all disabled:pointer-events-none`}
              style={selected.includes(opt) && answererColor ? { backgroundColor: answererColor, borderColor: answererColor, color: '#fff' } : undefined}
            >
              {selected.includes(opt) ? '✓ ' : ''}{opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'dropdown') {
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <select value={String(value || '')} onChange={e => !isNa && onChange(e.target.value)} disabled={isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50 appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}>
          <option value="">Select an option...</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === 'text') {
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <textarea value={String(value || '')} onChange={e => !isNa && onChange(e.target.value)} disabled={isNa}
          rows={3} placeholder="Type your response here..."
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-text-tertiary disabled:opacity-50" />
      </div>
    );
  }

  if (field.type === 'date') {
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <input type="date" value={String(value || '')} onChange={e => !isNa && onChange(e.target.value)} disabled={isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50" />
      </div>
    );
  }

  if (field.type === 'time') {
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <input type="time" value={String(value || '')} onChange={e => !isNa && onChange(e.target.value)} disabled={isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50" />
      </div>
    );
  }

  if (field.type === 'photo' || field.type === 'video') {
    const isVideo = field.type === 'video';
    const uploadedUrls = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className={wrapperCls} style={borderColor ? { borderColor } : undefined}>
        <Header />
        <label className={`flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
          isNa ? 'opacity-50 pointer-events-none' : 'border-border hover:border-primary hover:bg-primary-light/20'
        }`}>
          <input type="file" accept={isVideo ? 'video/*' : 'image/*'} capture="environment" multiple disabled={isNa}
            className="sr-only" onChange={e => e.target.files && onFileChange(e.target.files)} />
          <span className="text-2xl">{isVideo ? '🎥' : '📷'}</span>
          <p className="text-sm text-text-secondary font-medium">Tap to {isVideo ? 'record / upload video' : 'take photo or upload image'}</p>
          <p className="text-xs text-text-tertiary">{isVideo ? 'Camera or file' : 'Camera or camera roll'}</p>
        </label>
        {uploadedUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {uploadedUrls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                className="w-16 h-16 rounded-xl overflow-hidden border border-border-light bg-surface-elevated flex items-center justify-center">
                {isVideo ? <span className="text-2xl">🎬</span> : <img src={url} alt="" className="w-full h-full object-cover" />}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function StaffChecklistView({
  clientId, clientName, clientAddress, scheduleJobId, jobChecklistId, onClose,
}: StaffChecklistViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [sections, setSections] = useState<ChecklistSection[]>([]);
  const [answers, setAnswers] = useState<Map<string, FieldAnswer>>(new Map());
  const [mediaUrls, setMediaUrls] = useState<MediaUrls>({});
  const [notes, setNotes] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  // ── Collaboration: user color ─────────────────────────────────────────────
  // Assign a color to the current user based on which slots are taken by remote answers
  const myColor = useMemo(() => {
    const takenColors = new Set<string>();
    answers.forEach(a => {
      if (a.completed_by && a.completed_by !== currentUserIdRef.current) {
        // find which color index this userId would get — we don't know here,
        // so we just track a simple round-robin; real mapping done in render
      }
    });
    return COLLAB_COLORS[0].bg; // resolved properly in userColorMap below
  }, [answers]);

  // Map userId → color (determined by first-seen order)
  const [userColorMap, setUserColorMap] = useState<Map<string, string>>(new Map());
  const [userNameMap, setUserNameMap] = useState<Map<string, string>>(new Map());

  // ── LocalStorage helpers ──────────────────────────────────────────────────
  const localKey = scheduleJobId ? `crp_cl_draft_${scheduleJobId}` : null;

  const writeDraft = useCallback((ans: Map<string, FieldAnswer>, n: string) => {
    if (!localKey) return;
    try {
      localStorage.setItem(localKey, JSON.stringify({
        answers: Array.from(ans.values()), notes: n, ts: Date.now(),
      }));
    } catch { /* storage full */ }
  }, [localKey]);

  const clearDraft = useCallback(() => {
    if (localKey) { try { localStorage.removeItem(localKey); } catch { /* ignore */ } }
  }, [localKey]);

  // ── Load checklist ────────────────────────────────────────────────────────
  const allFields = useMemo(() =>
    sections.flatMap(s => s.fields.filter(f => f.type !== 'heading' && f.type !== 'paragraph' && f.type !== 'logic')),
  [sections]);

  const loadChecklist = useCallback(async () => {
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];
    const nowTime = now.toTimeString().slice(0, 5);

    const initAnswers = (secs: ChecklistSection[]) => {
      const map = new Map<string, FieldAnswer>();
      secs.forEach(s => s.fields.forEach(f => {
        if (f.type === 'heading' || f.type === 'paragraph' || f.type === 'logic') return;
        const base: FieldAnswer = { fieldId: f.id, value: null };
        if (f.type === 'date') base.value = todayDate;
        if (f.type === 'time') base.value = nowTime;
        map.set(f.id, base);
      }));
      return map;
    };

    if (jobChecklistId) {
      const { data: cl } = await supabase.from('client_checklists').select('id, name, sections').eq('id', jobChecklistId).single();
      if (cl) {
        setTemplateId(cl.id);
        setTemplateName(cl.name || 'Checklist');
        const secs = ((cl.sections as Record<string, unknown>[]) || []).map(migrateOldSection);
        setSections(secs);
        setAnswers(initAnswers(secs));
        setLoading(false);
        return;
      }
    }

    if (clientId) {
      const { data: clientRow } = await supabase.from('clients').select('email, checklist_template_id').eq('id', clientId).single();
      if (clientRow?.email) setClientEmail(clientRow.email);
      const { data: defaultCl } = await supabase.from('client_checklists').select('id, name, sections').eq('client_id', clientId).eq('is_default', true).maybeSingle();
      if (defaultCl) {
        setTemplateId(defaultCl.id);
        setTemplateName(defaultCl.name || 'Checklist');
        const secs = ((defaultCl.sections as Record<string, unknown>[]) || []).map(migrateOldSection);
        setSections(secs);
        setAnswers(initAnswers(secs));
        setLoading(false);
        return;
      }
    }

    setLoading(false);
  }, [supabase, clientId, jobChecklistId]);

  useEffect(() => { loadChecklist(); }, [loadChecklist]);

  // ── Get current user ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) currentUserIdRef.current = user.id;
    })();
  }, [supabase]);

  // ── Build user → color + name map from all answers ────────────────────────
  const buildUserMap = useCallback((ans: Map<string, FieldAnswer>) => {
    const seenUsers: string[] = [];
    ans.forEach(a => {
      if (a.completed_by && !seenUsers.includes(a.completed_by)) {
        seenUsers.push(a.completed_by);
      }
    });
    // Ensure current user is always first (gets first color)
    const myId = currentUserIdRef.current;
    if (myId && !seenUsers.includes(myId)) seenUsers.unshift(myId);
    else if (myId) {
      const idx = seenUsers.indexOf(myId);
      if (idx > 0) { seenUsers.splice(idx, 1); seenUsers.unshift(myId); }
    }
    const newMap = new Map<string, string>();
    seenUsers.forEach((uid, i) => newMap.set(uid, COLLAB_COLORS[i % COLLAB_COLORS.length].bg));
    setUserColorMap(newMap);
  }, []);

  // ── Fetch display names for collaborators ─────────────────────────────────
  const fetchUserNames = useCallback(async (userIds: string[]) => {
    if (userIds.length === 0) return;
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
    if (data) {
      setUserNameMap(prev => {
        const next = new Map(prev);
        data.forEach((p: { id: string; full_name: string | null }) => next.set(p.id, p.full_name || 'Unknown'));
        return next;
      });
    }
  }, [supabase]);

  // ── Resume existing draft + Realtime subscription ─────────────────────────
  useEffect(() => {
    if (!scheduleJobId || !templateId) return;

    const mergeRemoteItems = (rawItems: unknown, sourceMap: Map<string, string>) => {
      try {
        const items: FieldAnswer[] = typeof rawItems === 'string' ? JSON.parse(rawItems as string) : (rawItems as FieldAnswer[] || []);
        if (!Array.isArray(items)) return;
        const myId = currentUserIdRef.current;
        setAnswers(prev => {
          const next = new Map(prev);
          items.forEach(remoteAnswer => {
            const existing = next.get(remoteAnswer.fieldId);
            // Accept remote answer if it was answered by someone else
            if (!existing || remoteAnswer.completed_by !== myId) {
              next.set(remoteAnswer.fieldId, remoteAnswer);
            }
          });
          buildUserMap(next);
          // Fetch names for any new users
          const newIds = items
            .map(a => a.completed_by)
            .filter((id): id is string => !!id && !sourceMap.has(id));
          if (newIds.length > 0) fetchUserNames(newIds);
          writeDraft(next, '');
          return next;
        });
      } catch { /* ignore */ }
    };

    let active = true;

    (async () => {
      const { data } = await supabase.from('checklist_completions')
        .select('id, items, notes, media_urls, status, submitted_at').eq('schedule_job_id', scheduleJobId).maybeSingle();

      if (!active) return;

      if (data) {
        completionIdRef.current = data.id;
        if (data.notes) setNotes(data.notes);
        if (data.media_urls) setMediaUrls(data.media_urls as MediaUrls);
        try {
          const items: FieldAnswer[] = typeof data.items === 'string' ? JSON.parse(data.items) : (data.items || []);
          if (Array.isArray(items) && items.length > 0) {
            const ansMap = new Map(items.map(a => [a.fieldId, a]));
            setAnswers(ansMap);
            buildUserMap(ansMap);
            const uids = [...new Set(items.map(a => a.completed_by).filter(Boolean))] as string[];
            fetchUserNames(uids);
          }
          // Lock the form if already submitted — prevents re-submission on reopen
          if ((data as { status?: string }).status === 'submitted' || (data as { submitted_at?: string | null }).submitted_at) {
            setSaved(true);
          }
        } catch { /* ignore */ }
      } else if (localKey) {
        // Restore from localStorage if no DB draft
        try {
          const raw = localStorage.getItem(localKey);
          if (raw) {
            const parsed = JSON.parse(raw) as { answers: FieldAnswer[]; notes: string };
            if (Array.isArray(parsed.answers) && parsed.answers.length > 0) {
              const ansMap = new Map(parsed.answers.map(a => [a.fieldId, a]));
              setAnswers(ansMap);
              if (parsed.notes) setNotes(parsed.notes);
              buildUserMap(ansMap);
              autoSaveRef.current = setTimeout(() => { performSave(false); }, 2000);
            }
          }
        } catch { /* corrupted */ }
      }
    })();

    // Subscribe to realtime changes
    const channel = supabase
      .channel(`checklist:${scheduleJobId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'checklist_completions',
        filter: `schedule_job_id=eq.${scheduleJobId}`,
      }, (payload: { new: Record<string, unknown> }) => {
        if (!active) return;
        const newRow = payload.new as Record<string, unknown>;
        if (newRow?.id) completionIdRef.current = newRow.id as string;
        if (newRow?.notes) setNotes(newRow.notes as string);
        mergeRemoteItems(newRow?.items, userNameMap);
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [scheduleJobId, templateId, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Answer helpers ────────────────────────────────────────────────────────
  const setAnswer = (fieldId: string, value: FieldAnswer['value']) => {
    const myId = currentUserIdRef.current;
    setAnswers(prev => {
      const next = new Map(prev);
      next.set(fieldId, { ...next.get(fieldId) || { fieldId }, value, na: false, completed_by: myId || undefined });
      writeDraft(next, notes);
      buildUserMap(next);
      return next;
    });
    setSaved(false);
    scheduleAutoSave();
  };

  const toggleNa = (fieldId: string) => {
    const myId = currentUserIdRef.current;
    setAnswers(prev => {
      const next = new Map(prev);
      const cur = next.get(fieldId) || { fieldId, value: null };
      next.set(fieldId, { ...cur, na: !cur.na, value: !cur.na ? null : cur.value, completed_by: myId || undefined });
      writeDraft(next, notes);
      buildUserMap(next);
      return next;
    });
    setSaved(false);
    scheduleAutoSave();
  };

  // ── Media upload ──────────────────────────────────────────────────────────
  const handleFileChange = async (fieldId: string, files: FileList) => {
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop();
      const path = `${user?.id}/${fieldId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('checklist-media').upload(path, file, { upsert: true });
      if (!error) {
        const { data: urlData } = supabase.storage.from('checklist-media').getPublicUrl(path);
        if (urlData?.publicUrl) uploaded.push(urlData.publicUrl);
      }
    }
    if (uploaded.length > 0) {
      setMediaUrls(prev => ({ ...prev, [fieldId]: [...(prev[fieldId] || []), ...uploaded] }));
      setAnswers(prev => {
        const next = new Map(prev);
        const cur = next.get(fieldId) || { fieldId, value: [] };
        const existing = Array.isArray(cur.value) ? cur.value as string[] : [];
        next.set(fieldId, { ...cur, value: [...existing, ...uploaded], completed_by: user?.id });
        return next;
      });
    }
    setUploading(false);
    setSaved(false);
    scheduleAutoSave();
  };

  // ── Auto-save ─────────────────────────────────────────────────────────────
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => { performSave(false); }, 1500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const performSave = async (isFinal: boolean) => {
    if (!templateId) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profileData } = await supabase.from('profiles').select('org_id').eq('id', user!.id).single();
    const answersArr = Array.from(answers.values());
    const now = new Date().toISOString();

    // Base payload for both insert and autosave updates
    const basePayload = {
      org_id: profileData!.org_id,
      client_id: clientId,
      schedule_job_id: scheduleJobId || null,
      checklist_template_id: templateId,
      items: JSON.stringify(answersArr),
      media_urls: mediaUrls,
      notes,
      completed_by: user!.id,
      completed_at: now,
    };

    // On final submit add status=submitted + submitted_at
    // On autosave keep status=in_progress (never downgrade a submitted record)
    const insertPayload = { ...basePayload, status: isFinal ? 'submitted' : 'in_progress', submitted_at: isFinal ? now : null };

    if (scheduleJobId) {
      const { data: existing } = await supabase
        .from('checklist_completions')
        .select('id, status')
        .eq('schedule_job_id', scheduleJobId)
        .maybeSingle();
      if (existing) {
        // Don't downgrade a submitted record back to in_progress on autosave
        const updatePayload = isFinal
          ? { ...basePayload, status: 'submitted', submitted_at: now }
          : (existing as { status?: string }).status === 'submitted'
            ? { items: basePayload.items, notes: basePayload.notes, media_urls: basePayload.media_urls } // only update content, not status
            : { ...basePayload, status: 'in_progress' };
        await supabase.from('checklist_completions').update(updatePayload).eq('id', existing.id);
        completionIdRef.current = existing.id;
      } else {
        const { data: ins } = await supabase.from('checklist_completions').insert(insertPayload).select('id').single();
        if (ins) completionIdRef.current = ins.id;
      }
    } else if (completionIdRef.current) {
      await supabase.from('checklist_completions')
        .update({ ...basePayload, ...(isFinal ? { status: 'submitted', submitted_at: now } : { status: 'in_progress' }) })
        .eq('id', completionIdRef.current);
    } else {
      const { data: ins } = await supabase.from('checklist_completions').insert(insertPayload).select('id').single();
      if (ins) completionIdRef.current = ins.id;
    }
    setSaving(false);
    if (isFinal) { setSaved(true); clearDraft(); }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const errs = new Set<string>();
    allFields.forEach(f => {
      if (!f.required) return;
      const ans = answers.get(f.id);
      if (!ans || ans.na) return;
      const v = ans.value;
      if (v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)) errs.add(f.id);
    });
    setErrors(errs);
    if (errs.size > 0) {
      document.getElementById(`field-${[...errs][0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    await performSave(true);
  };

  // ── Email ─────────────────────────────────────────────────────────────────
  const handleEmailToClient = () => {
    if (!clientEmail) return;
    const subject = encodeURIComponent(`${templateName} — ${clientName} — ${new Date().toLocaleDateString('en-AU')}`);
    let body = `Hi,\n\nHere is the completed ${templateName} for ${clientName}`;
    if (clientAddress) body += ` (${clientAddress})`;
    body += `:\n\n`;
    sections.forEach(sec => {
      if (sec.title) body += `\n— ${sec.title} —\n`;
      sec.fields.forEach(f => {
        if (f.type === 'heading' || f.type === 'paragraph' || f.type === 'logic') return;
        const ans = answers.get(f.id);
        if (!ans) return;
        let val = 'No response';
        if (ans.na) val = 'N/A';
        else if (ans.value === true || ans.value === 'yes') val = 'Yes';
        else if (ans.value === false || ans.value === 'no') val = 'No';
        else if (Array.isArray(ans.value)) val = ans.value.join(', ') || 'None selected';
        else if (ans.value) val = String(ans.value);
        body += `${f.label}: ${val}\n`;
      });
    });
    if (notes) body += `\nNotes: ${notes}`;
    body += `\n\n---\nSent from CleanRoute Pro`;
    window.open(`mailto:${clientEmail}?subject=${subject}&body=${encodeURIComponent(body)}`, '_self');
  };

  // ── Progress ──────────────────────────────────────────────────────────────
  const { answeredCount, totalCount } = useMemo(() => {
    const total = allFields.length;
    const done = allFields.filter(f => {
      const a = answers.get(f.id);
      if (!a) return false;
      if (a.na) return true;
      const v = a.value;
      if (v === null || v === '' || v === false) return false;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }).length;
    return { answeredCount: done, totalCount: total };
  }, [allFields, answers]);

  const progressPct = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
  const allAnswered = totalCount > 0 && answeredCount === totalCount;

  // Unique collaborators currently visible
  const collaborators = useMemo(() => {
    return Array.from(userColorMap.entries()).map(([uid, color]) => ({
      uid, color, name: userNameMap.get(uid) || 'Staff',
      isMe: uid === currentUserIdRef.current,
    }));
  }, [userColorMap, userNameMap]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col bg-[#f5f6fa]" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="flex flex-col h-full w-full">

        {/* Sticky header */}
        <div className="shrink-0 bg-white border-b border-border-light">
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            <button onClick={onClose}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-surface-elevated border border-border-light text-text-secondary active:scale-95 transition-transform">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-text-primary leading-tight truncate">{clientName}</h2>
              <p className="text-xs text-text-tertiary truncate">{templateName}</p>
            </div>
            {/* Collaborator avatars */}
            {collaborators.length > 0 && (
              <div className="flex -space-x-1.5 shrink-0">
                {collaborators.map(({ uid, color, name, isMe }) => (
                  <div key={uid} title={isMe ? `${name} (you)` : name}
                    className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: color }}>
                    {(name || '?')[0].toUpperCase()}
                  </div>
                ))}
              </div>
            )}
            {saving && (
              <span className="shrink-0 flex items-center gap-1 text-[10px] text-amber-500 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Saving…
              </span>
            )}
          </div>

          {/* Progress bar */}
          {!loading && totalCount > 0 && (
            <div className="px-4 pb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-text-secondary">{answeredCount} of {totalCount} completed</span>
                <span className={`text-xs font-bold ${allAnswered ? 'text-emerald-600' : 'text-text-tertiary'}`}>{progressPct}%</span>
              </div>
              <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${allAnswered ? 'bg-emerald-500' : 'bg-primary'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPct}%` }}
                  transition={{ type: 'spring', damping: 30, stiffness: 200 }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="shimmer h-24 rounded-2xl" />)}</div>
          ) : sections.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-surface-elevated flex items-center justify-center text-3xl">📋</div>
              <p className="text-text-secondary font-medium">No checklist assigned</p>
              <p className="text-text-tertiary text-sm">Ask your admin to assign a checklist to this job in the scheduler.</p>
            </div>
          ) : saved ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center min-h-full gap-4 p-8 text-center">
              <div className="w-20 h-20 rounded-2xl bg-emerald-100 flex items-center justify-center text-4xl">✅</div>
              <div>
                <p className="text-lg font-bold text-text-primary">All done!</p>
                <p className="text-text-secondary text-sm mt-1">Checklist submitted for {clientName}</p>
              </div>
              {collaborators.length > 1 && (
                <div className="flex flex-col gap-1 items-center">
                  <p className="text-xs text-text-tertiary font-medium">Completed by</p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {collaborators.map(({ uid, color, name }) => (
                      <span key={uid} className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full text-white"
                        style={{ backgroundColor: color }}>
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {clientEmail && (
                <button onClick={handleEmailToClient}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white border border-border-light text-text-secondary text-sm font-semibold shadow-sm active:scale-95 transition-transform">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  Email report to client
                </button>
              )}
              <button onClick={onClose}
                className="px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow active:scale-95 transition-transform">
                Back to jobs
              </button>
            </motion.div>
          ) : (
            <div className="p-4 space-y-3 pb-8">
              {sections.map(section => (
                <div key={section.id}>
                  {section.title && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex-1 h-px bg-border" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary shrink-0 px-1">{section.title}</h3>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  {section.description && <p className="text-xs text-text-tertiary text-center mb-2">{section.description}</p>}
                  <div className="space-y-2">
                    {section.fields.map(field => {
                      const ans = answers.get(field.id) || { fieldId: field.id, value: null };
                      const answererColor = ans.completed_by ? userColorMap.get(ans.completed_by) : undefined;
                      return (
                        <div key={field.id} id={`field-${field.id}`}>
                          <FieldCard
                            field={field}
                            answer={ans}
                            onChange={val => setAnswer(field.id, val)}
                            onNa={() => toggleNa(field.id)}
                            onFileChange={files => handleFileChange(field.id, files)}
                            hasError={errors.has(field.id)}
                            answererColor={answererColor}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Notes */}
              <div className="rounded-2xl border-2 border-border-light bg-white p-4">
                <p className="text-sm font-semibold text-text-primary mb-2">Additional notes</p>
                <textarea value={notes}
                  onChange={e => { const n = e.target.value; setNotes(n); writeDraft(answers, n); setSaved(false); scheduleAutoSave(); }}
                  rows={3} placeholder="Any extra notes for this job..."
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-text-tertiary" />
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer */}
        {!loading && sections.length > 0 && !saved && (
          <div className="shrink-0 bg-white border-t border-border-light px-4 py-4">
            {errors.size > 0 && (
              <p className="text-xs text-red-500 font-medium text-center mb-2">Please complete all required fields before submitting.</p>
            )}
            <button onClick={handleSubmit} disabled={saving || uploading}
              className={`w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98] shadow-sm ${
                allAnswered ? 'bg-emerald-500 text-white' : 'bg-primary text-white'
              } disabled:opacity-60 disabled:pointer-events-none`}>
              {uploading ? '⬆ Uploading media…' : saving ? 'Saving…' : allAnswered ? '✓ Submit Checklist' : `Submit (${answeredCount}/${totalCount})`}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
