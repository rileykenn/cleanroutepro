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

// ─── Per-field answer ─────────────────────────────────────────────────────────
interface FieldAnswer {
  fieldId: string;
  value: string | string[] | boolean | null;
  na?: boolean;
}

// ─── Field renderer ───────────────────────────────────────────────────────────
function FieldCard({
  field,
  answer,
  onChange,
  onNa,
  onFileChange,
  hasError,
}: {
  field: ChecklistField;
  answer: FieldAnswer;
  onChange: (value: FieldAnswer['value']) => void;
  onNa: () => void;
  onFileChange: (files: FileList) => void;
  hasError: boolean;
}) {
  const value = answer.value;
  const isNa = !!answer.na;

  // ── Heading / paragraph: no interactive content ──
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
        {field.description && <p className="text-xs text-text-tertiary mt-1">{field.description}</p>}
      </div>
    );
  }

  // ── Wrapper for interactive fields ──
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
      {field.allowNA !== false && (
        <button
          onClick={onNa}
          className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
            isNa
              ? 'bg-surface-elevated border-border text-text-secondary'
              : 'border-border-light text-text-tertiary hover:border-border hover:text-text-secondary'
          }`}
        >
          N/A
        </button>
      )}
    </div>
  );

  // ── Checkbox (single tick-off item) ──
  if (field.type === 'checkbox') {
    const checked = value === true || value === 'true';
    return (
      <button
        onClick={() => !isNa && onChange(!checked)}
        className={`w-full flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.99] ${
          hasError ? 'border-red-300 bg-red-50/50' :
          checked ? 'border-emerald-400 bg-emerald-50' :
          isNa ? 'border-border-light bg-white opacity-60' :
          'border-border-light bg-white hover:border-border'
        }`}
      >
        <div className={`shrink-0 w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all ${
          checked ? 'bg-emerald-500 border-emerald-500' : 'border-border bg-surface-elevated'
        }`}>
          {checked && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-snug ${checked ? 'text-emerald-700' : 'text-text-primary'}`}>
            {field.label}
            {field.required && !isNa && !checked && <span className="text-red-500 ml-1">*</span>}
          </p>
          {field.description && <p className="text-xs text-text-tertiary mt-0.5">{field.description}</p>}
          {hasError && <p className="text-xs text-red-500 mt-1 font-medium">Required</p>}
        </div>
        {/* N/A for checkbox */}
        {field.allowNA !== false && (
          <button
            onClick={e => { e.stopPropagation(); onNa(); }}
            className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
              isNa ? 'bg-surface-elevated border-border text-text-secondary' : 'border-border-light text-text-tertiary'
            }`}
          >
            N/A
          </button>
        )}
      </button>
    );
  }

  // ── Yes / No ──
  if (field.type === 'yesno') {
    return (
      <div className={wrapperCls}>
        <Header />
        <div className="flex gap-2">
          {(['yes', 'no'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => !isNa && onChange(opt)}
              disabled={isNa}
              className={`flex-1 py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] ${
                value === opt
                  ? opt === 'yes' ? 'bg-emerald-500 text-white shadow-sm' : 'bg-red-400 text-white shadow-sm'
                  : 'bg-surface-elevated text-text-secondary border border-border-light hover:border-border'
              } disabled:pointer-events-none`}
            >
              {opt === 'yes' ? '✓  Yes' : '✗  No'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Multi-select checkbox list (all options expanded) ──
  if (field.type === 'multiselect') {
    const opts = field.options || [];
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      if (isNa) return;
      const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
      onChange(next);
    };
    return (
      <div className={wrapperCls}>
        <Header />
        <div className="space-y-2">
          {opts.map(opt => {
            const ticked = selected.includes(opt);
            return (
              <button key={opt} onClick={() => toggle(opt)} disabled={isNa}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left active:scale-[0.99] ${
                  ticked
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                    : 'border-border-light bg-surface-elevated text-text-secondary hover:border-border'
                } disabled:pointer-events-none`}>
                <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                  ticked ? 'bg-emerald-500 border-emerald-500' : 'border-border bg-white'
                }`}>
                  {ticked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span className="text-sm font-medium">{opt}</span>
              </button>
            );
          })}
          {opts.length === 0 && <p className="text-xs text-text-tertiary">No options configured.</p>}
        </div>
      </div>
    );
  }

  // ── Multi-dropdown (collapsed select with chips) ──
  if (field.type === 'multidropdown') {
    const opts = field.options || [];
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      if (isNa) return;
      const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
      onChange(next);
    };
    return (
      <div className={wrapperCls}>
        <Header />
        <div className="flex flex-wrap gap-2">
          {opts.map(opt => (
            <button key={opt} onClick={() => toggle(opt)} disabled={isNa}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all disabled:pointer-events-none ${
                selected.includes(opt)
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-surface-elevated border-border-light text-text-secondary hover:border-border'
              }`}>
              {selected.includes(opt) ? '✓ ' : ''}{opt}
            </button>
          ))}
          {opts.length === 0 && <p className="text-xs text-text-tertiary">No options configured.</p>}
        </div>
      </div>
    );
  }

  // ── Single dropdown ──
  if (field.type === 'dropdown') {
    const opts = field.options || [];
    return (
      <div className={wrapperCls}>
        <Header />
        <select
          value={String(value || '')}
          onChange={e => !isNa && onChange(e.target.value)}
          disabled={isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50 appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          <option value="">Select an option...</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  // ── Open text ──
  if (field.type === 'text') {
    return (
      <div className={wrapperCls}>
        <Header />
        <textarea
          value={String(value || '')}
          onChange={e => !isNa && onChange(e.target.value)}
          disabled={isNa}
          rows={3}
          placeholder="Type your response here..."
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-text-tertiary disabled:opacity-50"
        />
      </div>
    );
  }

  // ── Date ──
  if (field.type === 'date') {
    return (
      <div className={wrapperCls}>
        <Header />
        <input type="date" value={String(value || '')} onChange={e => !isNa && onChange(e.target.value)} disabled={isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50" />
      </div>
    );
  }

  // ── Time ──
  if (field.type === 'time') {
    return (
      <div className={wrapperCls}>
        <Header />
        <input type="time" value={String(value || '')} onChange={e => !isNa && onChange(e.target.value)} disabled={isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50" />
      </div>
    );
  }

  // ── Photo / Video ──
  if (field.type === 'photo' || field.type === 'video') {
    const isVideo = field.type === 'video';
    const uploadedUrls = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className={wrapperCls}>
        <Header />
        <label className={`flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
          isNa ? 'opacity-50 pointer-events-none' : 'border-border hover:border-primary hover:bg-primary-light/20'
        }`}>
          <input type="file" accept={isVideo ? 'video/*' : 'image/*'} capture="environment" multiple disabled={isNa}
            className="sr-only" onChange={e => e.target.files && onFileChange(e.target.files)} />
          <span className="text-2xl">{isVideo ? '🎥' : '📷'}</span>
          <p className="text-sm text-text-secondary font-medium">Tap to {isVideo ? 'record / upload video' : 'take photo / upload'}</p>
          <p className="text-xs text-text-tertiary">Up to 50MB per file</p>
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

  // logic blocks and unknown types: skip silently
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

  // Flat list of all actionable fields (not headings/paragraphs/logic)
  const allFields = useMemo(() =>
    sections.flatMap(s => s.fields.filter(f => f.type !== 'heading' && f.type !== 'paragraph' && f.type !== 'logic')),
  [sections]);

  // ── Load checklist ─────────────────────────────────────────────────────────
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

    // Priority 1: job-specific checklist from client_checklists
    if (jobChecklistId) {
      const { data: cl } = await supabase
        .from('client_checklists')
        .select('id, name, sections')
        .eq('id', jobChecklistId)
        .single();
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

    // Priority 2: client's default checklist (client_checklists table, is_default)
    if (clientId) {
      const { data: clientRow } = await supabase
        .from('clients')
        .select('email, checklist_template_id, custom_checklist_items')
        .eq('id', clientId)
        .single();
      if (clientRow?.email) setClientEmail(clientRow.email);

      // Try new client_checklists first
      const { data: defaultCl } = await supabase
        .from('client_checklists')
        .select('id, name, sections')
        .eq('client_id', clientId)
        .eq('is_default', true)
        .maybeSingle();
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

  // ── Resume existing draft ──────────────────────────────────────────────────
  useEffect(() => {
    if (!scheduleJobId || !templateId) return;
    (async () => {
      const { data } = await supabase.from('checklist_completions')
        .select('id, items, notes, media_urls').eq('schedule_job_id', scheduleJobId).maybeSingle();
      if (!data) return;
      completionIdRef.current = data.id;
      if (data.notes) setNotes(data.notes);
      if (data.media_urls) setMediaUrls(data.media_urls as MediaUrls);
      try {
        const items: FieldAnswer[] = typeof data.items === 'string' ? JSON.parse(data.items) : (data.items || []);
        if (Array.isArray(items) && items.length > 0) {
          setAnswers(new Map(items.map(a => [a.fieldId, a])));
          setSaved(true);
        }
      } catch { /* ignore */ }
    })();
  }, [scheduleJobId, templateId, supabase]);

  // ── Answer helpers ─────────────────────────────────────────────────────────
  const setAnswer = (fieldId: string, value: FieldAnswer['value']) => {
    setAnswers(prev => {
      const next = new Map(prev);
      next.set(fieldId, { ...next.get(fieldId) || { fieldId }, value, na: false });
      return next;
    });
    setSaved(false);
    scheduleAutoSave();
  };

  const toggleNa = (fieldId: string) => {
    setAnswers(prev => {
      const next = new Map(prev);
      const cur = next.get(fieldId) || { fieldId, value: null };
      next.set(fieldId, { ...cur, na: !cur.na, value: !cur.na ? null : cur.value });
      return next;
    });
    setSaved(false);
    scheduleAutoSave();
  };

  // ── Media upload ───────────────────────────────────────────────────────────
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
        next.set(fieldId, { ...cur, value: [...existing, ...uploaded] });
        return next;
      });
    }
    setUploading(false);
    setSaved(false);
    scheduleAutoSave();
  };

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => { performSave(false); }, 10000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const performSave = async (isFinal: boolean) => {
    if (!templateId) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profileData } = await supabase.from('profiles').select('org_id').eq('id', user!.id).single();
    const answersArr = Array.from(answers.values());
    const payload = {
      org_id: profileData!.org_id,
      client_id: clientId,
      schedule_job_id: scheduleJobId || null,
      checklist_template_id: templateId,
      items: JSON.stringify(answersArr),
      media_urls: mediaUrls,
      notes,
      completed_by: user!.id,
      completed_at: new Date().toISOString(),
    };
    if (scheduleJobId) {
      const { data: existing } = await supabase.from('checklist_completions')
        .select('id').eq('schedule_job_id', scheduleJobId).maybeSingle();
      if (existing) {
        await supabase.from('checklist_completions').update(payload).eq('id', existing.id);
        completionIdRef.current = existing.id;
      } else {
        const { data: ins } = await supabase.from('checklist_completions').insert(payload).select('id').single();
        if (ins) completionIdRef.current = ins.id;
      }
    } else if (completionIdRef.current) {
      await supabase.from('checklist_completions').update(payload).eq('id', completionIdRef.current);
    } else {
      const { data: ins } = await supabase.from('checklist_completions').insert(payload).select('id').single();
      if (ins) completionIdRef.current = ins.id;
    }
    setSaving(false);
    if (isFinal) setSaved(true);
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
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

  // ── Email ──────────────────────────────────────────────────────────────────
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

  // ── Progress ───────────────────────────────────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────────────────────
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
            <div className="p-4 space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="shimmer h-24 rounded-2xl" />)}
            </div>
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
                  {/* Section title banner */}
                  {section.title && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex-1 h-px bg-border" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-text-secondary shrink-0 px-1">{section.title}</h3>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  {section.description && (
                    <p className="text-xs text-text-tertiary text-center mb-2">{section.description}</p>
                  )}
                  <div className="space-y-2">
                    {section.fields.map(field => (
                      <div key={field.id} id={`field-${field.id}`}>
                        <FieldCard
                          field={field}
                          answer={answers.get(field.id) || { fieldId: field.id, value: null }}
                          onChange={val => setAnswer(field.id, val)}
                          onNa={() => toggleNa(field.id)}
                          onFileChange={files => handleFileChange(field.id, files)}
                          hasError={errors.has(field.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Notes */}
              <div className="rounded-2xl border-2 border-border-light bg-white p-4">
                <p className="text-sm font-semibold text-text-primary mb-2">Additional notes</p>
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setSaved(false); scheduleAutoSave(); }}
                  rows={3}
                  placeholder="Any extra notes for this job..."
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-text-tertiary"
                />
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer */}
        {!loading && sections.length > 0 && !saved && (
          <div className="shrink-0 bg-white border-t border-border-light px-4 py-4">
            {errors.size > 0 && (
              <p className="text-xs text-red-500 font-medium text-center mb-2">
                Please complete all required fields before submitting.
              </p>
            )}
            <button
              onClick={handleSubmit}
              disabled={saving || uploading}
              className={`w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98] shadow-sm ${
                allAnswered ? 'bg-emerald-500 text-white' : 'bg-primary text-white'
              } disabled:opacity-60 disabled:pointer-events-none`}
            >
              {uploading ? '⬆ Uploading media…' : saving ? 'Saving…' : allAnswered ? '✓ Submit Checklist' : `Submit (${answeredCount}/${totalCount})`}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
