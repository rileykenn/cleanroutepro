'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { FormField, FormFieldType, FieldAnswer, MediaUrls, normaliseField, AnyFormField } from '@/lib/types';

interface StaffChecklistViewProps {
  clientId: string;
  clientName: string;
  clientAddress?: string;
  scheduleJobId?: string;
  onClose: () => void;
}

// ─── Field renderer ───────────────────────────────────────────────────────────
function FieldInput({
  field,
  answer,
  onChange,
  onNa,
  onFileChange,
  disabled,
  hasError,
}: {
  field: FormField;
  answer: FieldAnswer;
  onChange: (value: FieldAnswer['value']) => void;
  onNa: () => void;
  onFileChange: (files: FileList) => void;
  disabled: boolean;
  hasError: boolean;
}) {
  const value = answer.value;
  const isNa = !!answer.na;

  const wrapperClass = `rounded-xl border-2 p-4 transition-all ${
    hasError ? 'border-red-300 bg-red-50' :
    isNa ? 'border-border-light bg-surface-elevated opacity-60' :
    'border-border-light bg-white'
  }`;

  const Header = () => (
    <div className="flex items-start justify-between gap-2 mb-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary leading-snug">
          {field.label}
          {field.required && !isNa && <span className="text-red-500 ml-1">*</span>}
        </p>
        {field.description && (
          <p className="text-xs text-text-tertiary mt-0.5">{field.description}</p>
        )}
        {hasError && <p className="text-xs text-red-500 mt-1 font-medium">This field is required</p>}
      </div>
      {/* N/A toggle */}
      <button
        onClick={onNa}
        disabled={disabled}
        className={`shrink-0 text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
          isNa
            ? 'bg-surface-elevated border-border text-text-secondary'
            : 'border-border-light text-text-tertiary hover:border-border hover:text-text-secondary'
        }`}>
        N/A
      </button>
    </div>
  );

  if (field.type === 'section_heading') {
    return (
      <div className="mt-2 mb-1">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border-light" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-tertiary shrink-0">{field.label}</h3>
          <div className="flex-1 h-px bg-border-light" />
        </div>
        {field.description && <p className="text-center text-xs text-text-tertiary mt-1">{field.description}</p>}
      </div>
    );
  }

  if (field.type === 'yes_no') {
    return (
      <div className={wrapperClass}>
        <Header />
        <div className="flex gap-2">
          {(['yes', 'no'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => !isNa && !disabled && onChange(opt)}
              disabled={disabled || isNa}
              className={`flex-1 py-3.5 rounded-xl font-semibold text-sm transition-all ${
                value === opt
                  ? opt === 'yes'
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'bg-red-400 text-white shadow-sm'
                  : 'bg-surface-elevated text-text-secondary hover:bg-surface-hover border border-border-light'
              } disabled:pointer-events-none`}>
              {opt === 'yes' ? '✓  Yes' : '✗  No'}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === 'text') {
    return (
      <div className={wrapperClass}>
        <Header />
        <textarea
          value={String(value || '')}
          onChange={e => !isNa && onChange(e.target.value)}
          disabled={disabled || isNa}
          rows={3}
          placeholder="Type your response here..."
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-text-tertiary disabled:opacity-50"
        />
      </div>
    );
  }

  if (field.type === 'dropdown') {
    const opts = field.options || [];
    return (
      <div className={wrapperClass}>
        <Header />
        <select
          value={String(value || '')}
          onChange={e => !isNa && onChange(e.target.value)}
          disabled={disabled || isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50 appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}>
          <option value="">Select an option...</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === 'multi_select') {
    const opts = field.options || [];
    const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      if (isNa || disabled) return;
      const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
      onChange(next);
    };
    return (
      <div className={wrapperClass}>
        <Header />
        <div className="flex flex-wrap gap-2">
          {opts.map(opt => (
            <button key={opt} onClick={() => toggle(opt)}
              disabled={disabled || isNa}
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

  if (field.type === 'date') {
    return (
      <div className={wrapperClass}>
        <Header />
        <input
          type="date"
          value={String(value || '')}
          onChange={e => !isNa && onChange(e.target.value)}
          disabled={disabled || isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50"
        />
      </div>
    );
  }

  if (field.type === 'time') {
    return (
      <div className={wrapperClass}>
        <Header />
        <input
          type="time"
          value={String(value || '')}
          onChange={e => !isNa && onChange(e.target.value)}
          disabled={disabled || isNa}
          className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50"
        />
      </div>
    );
  }

  if (field.type === 'image' || field.type === 'video') {
    const isVideo = field.type === 'video';
    const uploadedUrls = (value as string[]) || [];
    return (
      <div className={wrapperClass}>
        <Header />
        <label className={`flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
          disabled || isNa ? 'opacity-50 pointer-events-none' : 'border-border hover:border-primary hover:bg-primary-light/30'
        }`}>
          <input
            type="file"
            accept={isVideo ? 'video/*' : 'image/*'}
            capture="environment"
            multiple
            disabled={disabled || isNa}
            className="sr-only"
            onChange={e => e.target.files && onFileChange(e.target.files)}
          />
          <span className="text-2xl">{isVideo ? '🎥' : '📷'}</span>
          <p className="text-sm text-text-secondary font-medium">Tap to {isVideo ? 'record / upload video' : 'take photo / upload'}</p>
          <p className="text-xs text-text-tertiary">Up to 50MB per file</p>
        </label>
        {uploadedUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {uploadedUrls.map((url, ui) => (
              <a key={ui} href={url} target="_blank" rel="noopener noreferrer"
                className="w-16 h-16 rounded-xl overflow-hidden border border-border-light bg-surface-elevated flex items-center justify-center">
                {isVideo
                  ? <span className="text-2xl">🎬</span>
                  : <img src={url} alt="" className="w-full h-full object-cover" />}
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
  clientId, clientName, clientAddress, scheduleJobId, onClose,
}: StaffChecklistViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [fields, setFields] = useState<FormField[]>([]);
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

  // ── Load template & pre-fill ──────────────────────────────────────────────
  const loadChecklist = useCallback(async () => {
    const { data: client } = await supabase.from('clients')
      .select('checklist_template_id, email, custom_checklist_items').eq('id', clientId).single();
    if (client?.email) setClientEmail(client.email);
    if (!client?.checklist_template_id) { setLoading(false); return; }
    setTemplateId(client.checklist_template_id);

    // Prefer custom items
    let rawItems: AnyFormField[] = [];
    if (client.custom_checklist_items && Array.isArray(client.custom_checklist_items) && client.custom_checklist_items.length > 0) {
      rawItems = client.custom_checklist_items as AnyFormField[];
      const { data: tmpl } = await supabase.from('checklist_templates').select('name').eq('id', client.checklist_template_id).single();
      setTemplateName((tmpl?.name || 'Checklist') + ' (Customised)');
    } else {
      const { data: tmpl } = await supabase.from('checklist_templates').select('items, name').eq('id', client.checklist_template_id).single();
      if (tmpl?.items) rawItems = tmpl.items as AnyFormField[];
      setTemplateName(tmpl?.name || 'Checklist');
    }

    const normalised = (rawItems || []).map(normaliseField);
    setFields(normalised);

    // Pre-fill date/time fields
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];
    const nowTime = now.toTimeString().slice(0, 5);
    const initialAnswers = new Map<string, FieldAnswer>();
    normalised.forEach(f => {
      const base: FieldAnswer = { fieldId: f.id, value: null };
      if (f.type === 'date') base.value = todayDate;
      if (f.type === 'time') base.value = nowTime;
      initialAnswers.set(f.id, base);
    });
    setAnswers(initialAnswers);
    setLoading(false);
  }, [supabase, clientId]);

  useEffect(() => { loadChecklist(); }, [loadChecklist]);

  // ── Resume existing draft ─────────────────────────────────────────────────
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

  // ── Conditional visibility ────────────────────────────────────────────────
  const visibleFieldIds = useMemo(() => {
    const visible = new Set<string>();
    fields.forEach(f => {
      if (!f.conditional) { visible.add(f.id); return; }
      const parentAnswer = answers.get(f.conditional.parentId);
      if (parentAnswer?.value === f.conditional.showWhen) visible.add(f.id);
    });
    return visible;
  }, [fields, answers]);

  // ── Answer helpers ────────────────────────────────────────────────────────
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
      setMediaUrls(prev => ({
        ...prev,
        [fieldId]: [...(prev[fieldId] || []), ...uploaded],
      }));
      // Also store URLs in answer value for easy access
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

  // ── Auto-save ─────────────────────────────────────────────────────────────
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

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    // Validate required fields (only visible ones)
    const errs = new Set<string>();
    fields.forEach(f => {
      if (!f.required || !visibleFieldIds.has(f.id) || f.type === 'section_heading') return;
      const ans = answers.get(f.id);
      if (!ans || ans.na) return; // N/A is valid
      const v = ans.value;
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) errs.add(f.id);
    });
    setErrors(errs);
    if (errs.size > 0) {
      // Scroll to first error
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

    fields.forEach(f => {
      if (!visibleFieldIds.has(f.id)) return;
      if (f.type === 'section_heading') { body += `\n— ${f.label} —\n`; return; }
      const ans = answers.get(f.id);
      if (!ans) return;
      let val = 'No response';
      if (ans.na) val = 'N/A';
      else if (ans.value === 'yes') val = 'Yes';
      else if (ans.value === 'no') val = 'No';
      else if (Array.isArray(ans.value)) val = ans.value.join(', ') || 'None selected';
      else if (ans.value) val = String(ans.value);
      body += `${f.label}: ${val}\n`;
    });

    if (notes) body += `\nNotes: ${notes}`;
    body += `\n\n---\nSent from CleanRoute Pro`;

    window.open(`mailto:${clientEmail}?subject=${subject}&body=${encodeURIComponent(body)}`, '_self');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="shrink-0 p-4 border-b border-border-light">
          <div className="flex items-center justify-between mb-1">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-text-primary truncate">{clientName}</h3>
              <p className="text-xs text-text-tertiary">{templateName}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary ml-2 shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          {/* Auto-save indicator */}
          {saving && (
            <p className="text-[10px] text-text-tertiary flex items-center gap-1 mt-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Saving draft...
            </p>
          )}
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {loading ? (
            <div className="space-y-3">{[1, 2, 3, 4].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>
          ) : fields.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-tertiary text-sm">No checklist template assigned to this client.</p>
              <p className="text-text-tertiary text-xs mt-1">Assign one from the Clients page.</p>
            </div>
          ) : (
            fields.map(field => {
              if (!visibleFieldIds.has(field.id)) return null;
              const answer = answers.get(field.id) || { fieldId: field.id, value: null };
              return (
                <div key={field.id} id={`field-${field.id}`}>
                  <FieldInput
                    field={field}
                    answer={answer}
                    onChange={val => setAnswer(field.id, val)}
                    onNa={() => toggleNa(field.id)}
                    onFileChange={files => handleFileChange(field.id, files)}
                    disabled={saved}
                    hasError={errors.has(field.id)}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {fields.length > 0 && (
          <div className="shrink-0 p-4 border-t border-border-light space-y-3">
            {saved ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                <div className="text-center py-2">
                  <div className="text-3xl mb-1">✅</div>
                  <p className="text-sm font-semibold text-text-primary">Checklist submitted!</p>
                </div>
                {clientEmail && (
                  <button onClick={handleEmailToClient} className="btn-secondary w-full py-3 text-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    Email report to client
                  </button>
                )}
                <button onClick={() => setSaved(false)} className="btn-ghost w-full py-2 text-sm">Edit Response</button>
                <button onClick={onClose} className="btn-ghost w-full py-2 text-sm text-text-tertiary">Close</button>
              </motion.div>
            ) : (
              <>
                <textarea
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setSaved(false); scheduleAutoSave(); }}
                  placeholder="Additional notes (optional)..."
                  className="w-full bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-text-tertiary"
                  rows={2}
                />
                {errors.size > 0 && (
                  <p className="text-xs text-red-500 font-medium text-center">
                    Please complete all required fields ({errors.size} remaining)
                  </p>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={saving || uploading}
                  className="btn-primary w-full py-3.5 text-sm disabled:opacity-50 disabled:cursor-wait">
                  {uploading ? '⬆ Uploading media...' : saving ? 'Saving...' : '✓ Submit Checklist'}
                </button>
              </>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
