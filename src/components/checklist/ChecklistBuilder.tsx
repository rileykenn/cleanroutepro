'use client';

/**
 * ChecklistBuilder
 *
 * Universal checklist component used everywhere in CleanRoute Pro.
 *
 * mode="builder"    → Admin edits the checklist template structure
 * mode="completion" → Staff fills in answers for a specific job
 *
 * compact={true}    → Designed to fit in a sidebar panel (e.g. schedule right panel)
 * compact={false}   → Full-page layout (e.g. client profile, /checklist preview)
 */

import {
  useState, useCallback, useRef, useEffect, useMemo, ChangeEvent,
} from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  ChecklistSection, ChecklistField, ChecklistFieldType,
  ClientChecklist, ChecklistCompletion, FieldAnswer, ChecklistContext,
} from '@/lib/types';
import { generateId } from '@/lib/timeUtils';
import { createClient as createSupabase } from '@/lib/supabase/client';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_TYPES: { type: ChecklistFieldType; label: string; icon: string }[] = [
  { type: 'text',        label: 'Text',         icon: 'T'  },
  { type: 'yesno',       label: 'Yes / No',     icon: '?'  },
  { type: 'dropdown',    label: 'Dropdown',     icon: '▾'  },
  { type: 'multiselect', label: 'Multi-select', icon: '☰'  },
  { type: 'date',        label: 'Date',         icon: '📅' },
  { type: 'time',        label: 'Time',         icon: '⏱'  },
  { type: 'photo',       label: 'Photo',        icon: '📷' },
  { type: 'video',       label: 'Video',        icon: '🎥' },
];

function fieldTypeLabel(type: ChecklistFieldType) {
  return FIELD_TYPES.find(f => f.type === type)?.label ?? type;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyField(type: ChecklistFieldType = 'text'): ChecklistField {
  return { id: generateId(), type, label: '', required: false, allowNA: false };
}

function emptySection(): ChecklistSection {
  return { id: generateId(), title: 'New Section', description: '', fields: [emptyField('text')] };
}

function getAnswer(answers: FieldAnswer[], fieldId: string): FieldAnswer | undefined {
  return answers.find(a => a.field_id === fieldId);
}

function patchAnswer(prev: FieldAnswer[], patch: Partial<FieldAnswer> & { field_id: string }): FieldAnswer[] {
  const existing = prev.find(a => a.field_id === patch.field_id);
  if (existing) return prev.map(a => a.field_id === patch.field_id ? { ...a, ...patch } : a);
  return [...prev, { value: null, ...patch }];
}

// ─── Icons (inline SVG helpers) ───────────────────────────────────────────────

function DragIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="6" r="1" fill="currentColor" /><circle cx="15" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" /><circle cx="15" cy="18" r="1" fill="currentColor" />
    </svg>
  );
}

function TrashIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ─── Field type picker (builder mode) ─────────────────────────────────────────

function FieldTypePicker({ value, onChange }: { value: ChecklistFieldType; onChange: (t: ChecklistFieldType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-elevated border border-border-light text-xs font-semibold text-text-secondary hover:border-primary hover:text-primary transition-all"
      >
        {fieldTypeLabel(value)}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-border-light p-1.5 w-44"
          >
            {FIELD_TYPES.map(ft => (
              <button
                key={ft.type}
                type="button"
                onClick={() => { onChange(ft.type); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ${value === ft.type ? 'bg-primary text-white' : 'hover:bg-surface-elevated text-text-primary'}`}
              >
                <span className="w-4 text-center">{ft.icon}</span>
                {ft.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Options editor (for dropdown / multiselect) ──────────────────────────────

function OptionsEditor({ options = [], onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  const [newOpt, setNewOpt] = useState('');
  const add = () => {
    if (!newOpt.trim()) return;
    onChange([...options, newOpt.trim()]);
    setNewOpt('');
  };
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Options</label>
      <div className="space-y-1">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border border-border-light bg-surface-elevated shrink-0" />
            <input
              value={opt}
              onChange={e => { const copy = [...options]; copy[i] = e.target.value; onChange(copy); }}
              className="input-field text-xs py-1 flex-1"
            />
            <button type="button" onClick={() => onChange(options.filter((_, j) => j !== i))} className="p-0.5 text-text-tertiary hover:text-danger transition-colors">
              <TrashIcon size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={newOpt}
          onChange={e => setNewOpt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add option…"
          className="input-field text-xs py-1 flex-1"
        />
        <button type="button" onClick={add} className="btn-primary text-xs px-2.5 py-1">Add</button>
      </div>
    </div>
  );
}

// ─── Field (builder config view) ─────────────────────────────────────────────

function FieldBuilderRow({
  field, sections, sectionId, onUpdate, onDelete, index, totalFields,
}: {
  field: ChecklistField;
  sections: ChecklistSection[];
  sectionId: string;
  onUpdate: (patch: Partial<ChecklistField>) => void;
  onDelete: () => void;
  index: number;
  totalFields: number;
}) {
  const [expanded, setExpanded] = useState(false);

  // All yes/no fields in the checklist (potential parent conditional fields)
  const yesNoFields = sections.flatMap(s =>
    s.fields.filter(f => f.type === 'yesno' && f.id !== field.id).map(f => ({ id: f.id, label: f.label || 'Untitled question', sectionTitle: s.title }))
  );

  return (
    <Reorder.Item value={field} id={field.id} className="group">
      <div className={`rounded-xl border transition-all ${expanded ? 'border-primary/40 shadow-sm' : 'border-border-light bg-white hover:border-gray-200'}`}>
        {/* Collapsed row */}
        <div className="flex items-center gap-2 p-3">
          {/* Drag handle */}
          <div className="cursor-grab active:cursor-grabbing text-text-tertiary hover:text-primary shrink-0 transition-colors">
            <DragIcon />
          </div>

          {/* Label input */}
          <input
            value={field.label}
            onChange={e => onUpdate({ label: e.target.value })}
            placeholder="Question / field label…"
            className="flex-1 text-sm font-medium text-text-primary bg-transparent border-none outline-none placeholder:text-text-tertiary min-w-0"
          />

          {/* Type badge */}
          <FieldTypePicker value={field.type} onChange={type => onUpdate({ type, options: type === 'dropdown' || type === 'multiselect' ? (field.options ?? []) : undefined })} />

          {/* Required badge */}
          {field.required && (
            <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-md shrink-0">REQ</span>
          )}

          {/* Conditional badge */}
          {field.conditional && (
            <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-md shrink-0">IF</span>
          )}

          {/* Expand/config */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-primary transition-colors shrink-0"
            title="Configure field"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          >
            <TrashIcon />
          </button>
        </div>

        {/* Expanded config panel */}
        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="px-4 pb-4 pt-1 border-t border-border-light bg-surface-elevated rounded-b-xl space-y-3">

                {/* Description */}
                <div>
                  <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Help text / description</label>
                  <input
                    value={field.description ?? ''}
                    onChange={e => onUpdate({ description: e.target.value })}
                    placeholder="Optional instruction shown below the label…"
                    className="input-field text-xs mt-1 w-full"
                  />
                </div>

                {/* Options for dropdown / multiselect */}
                {(field.type === 'dropdown' || field.type === 'multiselect') && (
                  <OptionsEditor options={field.options ?? []} onChange={opts => onUpdate({ options: opts })} />
                )}

                {/* Toggles row */}
                <div className="flex flex-wrap gap-3">
                  {/* Required */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <div onClick={() => onUpdate({ required: !field.required })}
                      className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${field.required ? 'bg-primary' : 'bg-border-light'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${field.required ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-xs font-medium text-text-primary">Required</span>
                  </label>

                  {/* N/A allowed */}
                  {field.type !== 'photo' && field.type !== 'video' && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <div onClick={() => onUpdate({ allowNA: !field.allowNA })}
                        className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${field.allowNA ? 'bg-primary' : 'bg-border-light'}`}>
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${field.allowNA ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-xs font-medium text-text-primary">Allow N/A</span>
                    </label>
                  )}
                </div>

                {/* Conditional logic */}
                {yesNoFields.length > 0 && (
                  <div>
                    <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider block mb-1.5">Conditional Logic</label>
                    {field.conditional ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-secondary shrink-0">Show when</span>
                          <select
                            value={field.conditional.parentFieldId}
                            onChange={e => onUpdate({ conditional: { ...field.conditional!, parentFieldId: e.target.value } })}
                            className="input-field text-xs flex-1"
                          >
                            {yesNoFields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                          </select>
                          <span className="text-xs text-text-secondary shrink-0">is</span>
                          <select
                            value={field.conditional.showWhen}
                            onChange={e => onUpdate({ conditional: { ...field.conditional!, showWhen: e.target.value as 'yes' | 'no' } })}
                            className="input-field text-xs w-20"
                          >
                            <option value="yes">YES</option>
                            <option value="no">NO</option>
                          </select>
                          <button type="button" onClick={() => onUpdate({ conditional: undefined })} className="text-xs text-danger hover:underline">Remove</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onUpdate({ conditional: { parentFieldId: yesNoFields[0].id, showWhen: 'yes' } })}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        + Add conditional logic
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Reorder.Item>
  );
}

// ─── Field (completion / answer view) ────────────────────────────────────────

function FieldCompletionRow({
  field, answer, onAnswer, orgId, compact,
}: {
  field: ChecklistField;
  answer: FieldAnswer | undefined;
  onAnswer: (patch: Partial<FieldAnswer>) => void;
  orgId?: string;
  compact?: boolean;
}) {
  const supabase = useMemo(() => createSupabase(), []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNA = answer?.na === true;
  const value = answer?.value ?? null;

  const toggle = (key: 'na') => onAnswer({ [key]: !answer?.[key] });

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploading(true);
    const path = `checklists/${orgId}/${generateId()}-${file.name}`;
    const { error } = await supabase.storage.from('client-media').upload(path, file);
    if (!error) {
      const url = supabase.storage.from('client-media').getPublicUrl(path).data.publicUrl;
      onAnswer({ media_urls: [...(answer?.media_urls ?? []), url], value: null });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className={`space-y-2 ${isNA ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Label + badges */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-semibold text-text-primary leading-tight ${compact ? '' : ''}`}>{field.label || 'Untitled'}</span>
            {field.required && <span className="text-[10px] font-bold text-red-500">*</span>}
          </div>
          {field.description && <p className="text-xs text-text-tertiary mt-0.5 leading-snug">{field.description}</p>}
        </div>
        {/* N/A toggle */}
        {field.allowNA && (
          <button
            type="button"
            onClick={() => toggle('na')}
            className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg border transition-all ${answer?.na ? 'bg-gray-100 border-gray-300 text-gray-600' : 'border-border-light text-text-tertiary hover:border-gray-300'}`}
          >
            N/A
          </button>
        )}
      </div>

      {/* Input */}
      {!isNA && (() => {
        switch (field.type) {
          case 'text':
            return (
              <textarea
                value={typeof value === 'string' ? value : ''}
                onChange={e => onAnswer({ value: e.target.value })}
                placeholder="Type your answer…"
                className={`input-field text-sm resize-none w-full ${compact ? 'min-h-[72px]' : 'min-h-[88px]'}`}
                rows={compact ? 2 : 3}
              />
            );

          case 'yesno':
            return (
              <div className="flex gap-2">
                {(['yes', 'no'] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onAnswer({ value: value === opt ? null : opt })}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2 ${compact ? 'py-2.5 text-xs' : ''} ${
                      value === opt
                        ? opt === 'yes'
                          ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                          : 'bg-red-500 border-red-500 text-white shadow-sm'
                        : 'border-border-light bg-white text-text-secondary hover:border-gray-300'
                    }`}
                  >
                    {opt === 'yes' ? '✓ Yes' : '✕ No'}
                  </button>
                ))}
              </div>
            );

          case 'dropdown':
            return (
              <select
                value={typeof value === 'string' ? value : ''}
                onChange={e => onAnswer({ value: e.target.value || null })}
                className="input-field text-sm w-full"
              >
                <option value="">Select an option…</option>
                {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            );

          case 'multiselect': {
            const selected = Array.isArray(value) ? value : [];
            return (
              <div className="flex flex-wrap gap-2">
                {(field.options ?? []).map(opt => {
                  const active = selected.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => onAnswer({ value: active ? selected.filter(s => s !== opt) : [...selected, opt] })}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-all ${compact ? 'py-1.5' : ''} ${active ? 'bg-primary border-primary text-white' : 'border-border-light bg-white text-text-secondary hover:border-primary/40'}`}
                    >
                      {active && <span className="mr-1">✓</span>}{opt}
                    </button>
                  );
                })}
              </div>
            );
          }

          case 'date':
            return (
              <input
                type="date"
                value={typeof value === 'string' ? value : ''}
                onChange={e => onAnswer({ value: e.target.value })}
                className="input-field text-sm w-full"
              />
            );

          case 'time':
            return (
              <input
                type="time"
                value={typeof value === 'string' ? value : ''}
                onChange={e => onAnswer({ value: e.target.value })}
                className="input-field text-sm w-full"
              />
            );

          case 'photo':
          case 'video': {
            const mediaUrls = answer?.media_urls ?? [];
            const accept = field.type === 'photo' ? 'image/*' : 'video/*';
            return (
              <div>
                {mediaUrls.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {mediaUrls.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-surface-elevated group">
                        {field.type === 'video'
                          ? <video src={url} className="w-full h-full object-cover" />
                          // eslint-disable-next-line @next/next/no-img-element
                          : <img src={url} alt="" className="w-full h-full object-cover" />
                        }
                        <button
                          type="button"
                          onClick={() => onAnswer({ media_urls: mediaUrls.filter((_, j) => j !== i) })}
                          className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        >
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <input ref={fileRef} type="file" accept={accept} capture="environment" className="hidden" onChange={handleFileUpload} />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-border-light hover:border-primary text-sm text-text-tertiary hover:text-primary transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {uploading
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    : <span className="text-lg">{field.type === 'photo' ? '📷' : '🎥'}</span>
                  }
                  {uploading ? 'Uploading…' : `Add ${field.type === 'photo' ? 'photo' : 'video'}`}
                </button>
              </div>
            );
          }

          default:
            return null;
        }
      })()}
    </div>
  );
}

// ─── Section (builder mode) ───────────────────────────────────────────────────

function SectionBuilder({
  section, sections, onUpdate, onDelete, onAddField,
}: {
  section: ChecklistSection;
  sections: ChecklistSection[];
  onUpdate: (patch: Partial<ChecklistSection>) => void;
  onDelete: () => void;
  onAddField: (type: ChecklistFieldType) => void;
}) {
  const [addingField, setAddingField] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!addRef.current?.contains(e.target as Node)) setAddingField(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1.5">
          <input
            value={section.title}
            onChange={e => onUpdate({ title: e.target.value })}
            placeholder="Section title…"
            className="w-full text-sm font-bold text-text-primary bg-transparent border-none outline-none placeholder:text-text-tertiary"
          />
          <input
            value={section.description ?? ''}
            onChange={e => onUpdate({ description: e.target.value })}
            placeholder="Optional section description…"
            className="w-full text-xs text-text-secondary bg-transparent border-none outline-none placeholder:text-text-tertiary"
          />
        </div>
        <button type="button" onClick={onDelete} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors shrink-0 mt-0.5">
          <TrashIcon />
        </button>
      </div>

      {/* Fields */}
      <Reorder.Group
        axis="y"
        values={section.fields}
        onReorder={fields => onUpdate({ fields })}
        className="space-y-2"
      >
        {section.fields.map((field, fi) => (
          <FieldBuilderRow
            key={field.id}
            field={field}
            sections={sections}
            sectionId={section.id}
            index={fi}
            totalFields={section.fields.length}
            onUpdate={patch => onUpdate({ fields: section.fields.map(f => f.id === field.id ? { ...f, ...patch } : f) })}
            onDelete={() => onUpdate({ fields: section.fields.filter(f => f.id !== field.id) })}
          />
        ))}
      </Reorder.Group>

      {/* Add field */}
      <div ref={addRef} className="relative">
        <button
          type="button"
          onClick={() => setAddingField(!addingField)}
          className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors py-1"
        >
          <PlusIcon />
          Add field
        </button>
        <AnimatePresence>
          {addingField && (
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 top-full mt-1 z-40 bg-white rounded-xl shadow-xl border border-border-light p-2 grid grid-cols-2 gap-1 w-52"
            >
              {FIELD_TYPES.map(ft => (
                <button
                  key={ft.type}
                  type="button"
                  onClick={() => { onAddField(ft.type); setAddingField(false); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  <span>{ft.icon}</span>{ft.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Section (completion mode) ────────────────────────────────────────────────

function SectionCompletion({
  section, answers, onAnswer, orgId, compact, parentAnswers,
}: {
  section: ChecklistSection;
  answers: FieldAnswer[];
  onAnswer: (patch: Partial<FieldAnswer> & { field_id: string }) => void;
  orgId?: string;
  compact?: boolean;
  /** All answers in the whole form — needed for conditional logic evaluation */
  parentAnswers: FieldAnswer[];
}) {
  const visibleFields = section.fields.filter(field => {
    if (!field.conditional) return true;
    const parentAnswer = parentAnswers.find(a => a.field_id === field.conditional!.parentFieldId);
    return parentAnswer?.value === field.conditional.showWhen;
  });

  if (visibleFields.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className={`font-bold text-text-primary ${compact ? 'text-xs uppercase tracking-wider text-text-tertiary' : 'text-sm'}`}>{section.title}</h3>
        {section.description && <p className="text-xs text-text-secondary mt-0.5">{section.description}</p>}
      </div>
      <div className={`space-y-${compact ? '4' : '5'}`}>
        {visibleFields.map(field => (
          <FieldCompletionRow
            key={field.id}
            field={field}
            answer={answers.find(a => a.field_id === field.id)}
            onAnswer={patch => onAnswer({ field_id: field.id, ...patch })}
            orgId={orgId}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function CompletionProgress({ sections, answers }: { sections: ChecklistSection[]; answers: FieldAnswer[] }) {
  const allFields = sections.flatMap(s => s.fields);
  const required = allFields.filter(f => f.required);
  const answered = required.filter(f => {
    const a = answers.find(ans => ans.field_id === f.id);
    if (!a) return false;
    if (a.na) return true;
    if (Array.isArray(a.value)) return a.value.length > 0;
    if (a.media_urls?.length) return true;
    return typeof a.value === 'string' && a.value.trim().length > 0;
  });
  const total = allFields.length;
  const totalAnswered = answers.filter(a => {
    if (a.na) return true;
    if (Array.isArray(a.value)) return a.value.length > 0;
    if (a.media_urls?.length) return true;
    return typeof a.value === 'string' && a.value.trim().length > 0;
  }).length;
  const pct = total > 0 ? Math.round((totalAnswered / total) * 100) : 0;
  const allRequired = required.length === 0 || answered.length === required.length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">
          {totalAnswered} / {total} answered
          {required.length > 0 && ` · ${answered.length}/${required.length} required`}
        </span>
        <span className={`text-xs font-bold ${pct === 100 ? 'text-emerald-600' : pct > 0 ? 'text-amber-600' : 'text-text-tertiary'}`}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </div>
  );
}

// ─── ChecklistBuilder (root) ──────────────────────────────────────────────────

export interface ChecklistBuilderProps {
  /** Mode: admin edits the template, or staff fills it in */
  mode: 'builder' | 'completion';
  /** The checklist template (structure definition) */
  checklist: ClientChecklist | null;
  /** Current completion answers (completion mode only) */
  completion?: ChecklistCompletion | null;
  /** Context pre-fills for completion (staff name, client, date, time) */
  context?: ChecklistContext;
  /** Org ID — needed for media uploads */
  orgId?: string;
  /** compact=true: fits in a sidebar panel; false: full-page */
  compact?: boolean;
  /** Called when admin saves the template changes */
  onSaveTemplate?: (updated: { name: string; sections: ChecklistSection[] }) => Promise<void>;
  /** Called when staff submits the completed form */
  onSubmit?: (answers: FieldAnswer[], notes: string) => Promise<void>;
  /** Called on every answer change — debounced auto-save */
  onAutoSave?: (answers: FieldAnswer[]) => void;
  /** Called when admin creates a new checklist from this one */
  onSaveAsNew?: (name: string, sections: ChecklistSection[]) => Promise<ClientChecklist | null>;
  /** Called for "save for this job only" (schedule panel) */
  onSaveJobOnly?: (sections: ChecklistSection[]) => void;
  /** Show save-as-new and save-job-only buttons (schedule panel context) */
  showJobActions?: boolean;
}

export default function ChecklistBuilder({
  mode, checklist, completion, context, orgId,
  compact = false,
  onSaveTemplate, onSubmit, onAutoSave, onSaveAsNew, onSaveJobOnly,
  showJobActions = false,
}: ChecklistBuilderProps) {
  // Builder state
  const [sections, setSections] = useState<ChecklistSection[]>(() => checklist?.sections ?? []);
  const [templateName, setTemplateName] = useState(checklist?.name ?? '');
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Completion state
  const [answers, setAnswers] = useState<FieldAnswer[]>(() => completion?.items ?? []);
  const [notes, setNotes] = useState(completion?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(!!completion?.submitted);
  const [saveAsNamePrompt, setSaveAsNamePrompt] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');

  // Auto-save on answer change
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mode !== 'completion' || !onAutoSave) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => onAutoSave(answers), 1500);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [answers, mode, onAutoSave]);

  // Sync if checklist prop changes
  useEffect(() => {
    if (checklist) { setSections(checklist.sections); setTemplateName(checklist.name); }
  }, [checklist]);
  useEffect(() => {
    if (completion) { setAnswers(completion.items); setNotes(completion.notes ?? ''); }
  }, [completion]);

  const handleAnswer = useCallback((patch: Partial<FieldAnswer> & { field_id: string }) => {
    setAnswers(prev => patchAnswer(prev, patch));
  }, []);

  const handleSaveTemplate = async () => {
    if (!onSaveTemplate) return;
    setSavingTemplate(true);
    await onSaveTemplate({ name: templateName, sections });
    setSavingTemplate(false);
  };

  const handleSubmit = async () => {
    if (!onSubmit) return;
    setSubmitting(true);
    await onSubmit(answers, notes);
    setSubmitted(true);
    setSubmitting(false);
  };

  const handleSaveAsNew = async () => {
    if (!onSaveAsNew || !saveAsName.trim()) return;
    setSavingTemplate(true);
    await onSaveAsNew(saveAsName.trim(), sections);
    setSaveAsNamePrompt(false);
    setSaveAsName('');
    setSavingTemplate(false);
  };

  // ── Builder mode ──────────────────────────────────────────────────────────

  if (mode === 'builder') {
    return (
      <div className={`flex flex-col ${compact ? 'h-full' : 'min-h-0'}`}>
        {/* Template name */}
        {!compact && (
          <div className="mb-4">
            <label className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Checklist Name</label>
            <input
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="e.g. Standard Clean, Deep Clean, End of Lease…"
              className="input-field text-base font-semibold mt-1 w-full"
            />
          </div>
        )}

        {/* Sections */}
        <div className={`space-y-5 flex-1 ${compact ? 'overflow-y-auto custom-scrollbar pr-1' : ''}`}>
          <Reorder.Group axis="y" values={sections} onReorder={setSections} className="space-y-5">
            {sections.map((section) => (
              <Reorder.Item key={section.id} value={section} id={section.id}>
                <div className="bg-white rounded-2xl border border-border-light p-4 shadow-sm">
                  <SectionBuilder
                    section={section}
                    sections={sections}
                    onUpdate={patch => setSections(s => s.map(sec => sec.id === section.id ? { ...sec, ...patch } : sec))}
                    onDelete={() => setSections(s => s.filter(sec => sec.id !== section.id))}
                    onAddField={type => {
                      const newField = emptyField(type);
                      setSections(s => s.map(sec => sec.id === section.id
                        ? { ...sec, fields: [...sec.fields, newField] }
                        : sec
                      ));
                    }}
                  />
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>

          {/* Add section */}
          <button
            type="button"
            onClick={() => setSections(s => [...s, emptySection()])}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-border-light hover:border-primary text-sm font-semibold text-text-tertiary hover:text-primary transition-all flex items-center justify-center gap-2"
          >
            <PlusIcon size={13} />
            Add Section
          </button>
        </div>

        {/* Actions */}
        {onSaveTemplate && (
          <div className="flex gap-2 pt-4 mt-auto shrink-0">
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={savingTemplate}
              className="btn-primary text-sm flex-1 py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {savingTemplate
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              }
              Save Checklist
            </button>
            {showJobActions && onSaveAsNew && (
              <button type="button" onClick={() => setSaveAsNamePrompt(true)} className="btn-ghost text-sm px-3">Save as New</button>
            )}
            {showJobActions && onSaveJobOnly && (
              <button type="button" onClick={() => onSaveJobOnly(sections)} className="btn-ghost text-sm px-3 text-xs">Job Only</button>
            )}
          </div>
        )}

        {/* Save-as-new name modal */}
        <AnimatePresence>
          {saveAsNamePrompt && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
                className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                <h3 className="text-sm font-bold mb-3">Name this checklist</h3>
                <input autoFocus value={saveAsName} onChange={e => setSaveAsName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveAsNew(); if (e.key === 'Escape') setSaveAsNamePrompt(false); }}
                  placeholder="e.g. Deep Clean…" className="input-field text-sm w-full mb-4" />
                <div className="flex gap-2">
                  <button onClick={handleSaveAsNew} disabled={!saveAsName.trim() || savingTemplate} className="btn-primary flex-1 text-sm disabled:opacity-50">Save</button>
                  <button onClick={() => setSaveAsNamePrompt(false)} className="btn-ghost text-sm px-4">Cancel</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Completion mode ──────────────────────────────────────────────────────

  if (!checklist) {
    return (
      <div className="flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm font-semibold text-text-primary mb-1">No checklist</p>
          <p className="text-xs text-text-tertiary">No checklist has been assigned to this client yet.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div>
          <h3 className="text-sm font-bold text-text-primary mb-1">Checklist submitted</h3>
          <p className="text-xs text-text-tertiary">All answers have been saved and submitted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${compact ? 'h-full' : 'min-h-0'}`}>
      {/* Pre-filled context banner */}
      {context && (context.staffName || context.clientName || context.date) && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-4 text-xs text-indigo-800 flex flex-wrap gap-x-4 gap-y-1 shrink-0">
          {context.staffName && <span>👤 {context.staffName}</span>}
          {context.clientName && <span>🏠 {context.clientName}</span>}
          {context.date && <span>📅 {new Date(context.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
          {context.time && <span>⏱ {context.time}</span>}
        </div>
      )}

      {/* Progress */}
      {sections.length > 0 && (
        <div className="mb-4 shrink-0">
          <CompletionProgress sections={sections} answers={answers} />
        </div>
      )}

      {/* Sections */}
      <div className={`space-y-6 flex-1 ${compact ? 'overflow-y-auto custom-scrollbar pr-1' : ''}`}>
        {sections.map(section => (
          <div key={section.id} className={`${compact ? '' : 'bg-white rounded-2xl border border-border-light p-4 shadow-sm'}`}>
            <SectionCompletion
              section={section}
              answers={answers.filter(a => section.fields.some(f => f.id === a.field_id))}
              onAnswer={patch => handleAnswer(patch)}
              orgId={orgId}
              compact={compact}
              parentAnswers={answers}
            />
          </div>
        ))}

        {/* Notes */}
        {!compact && (
          <div className="bg-white rounded-2xl border border-border-light p-4 shadow-sm">
            <label className="text-xs font-bold text-text-secondary uppercase tracking-wider block mb-2">Additional Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any extra notes for this job…"
              className="input-field text-sm resize-none w-full"
              rows={3}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      {onSubmit && (
        <div className="pt-4 mt-auto shrink-0 space-y-2">
          {compact && (
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional notes…"
              className="input-field text-xs resize-none w-full"
              rows={2}
            />
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full btn-primary py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            }
            {submitting ? 'Submitting…' : 'Submit Checklist'}
          </button>
        </div>
      )}
    </div>
  );
}
