'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChecklistField, ChecklistSection, FieldType, FIELD_TYPE_LABELS, FieldResponse } from './types';
import ChecklistRunner from './ChecklistRunner';

const TYPE_OPTIONS: { type: FieldType; label: string }[] = [
  { type: 'checkbox',    label: 'Checkbox' },
  { type: 'yesno',      label: 'Yes / No' },
  { type: 'text',       label: 'Text answer' },
  { type: 'photo',      label: 'Photo' },
  { type: 'video',      label: 'Video' },
  { type: 'date',       label: 'Date' },
  { type: 'time',       label: 'Time' },
  { type: 'dropdown',   label: 'Dropdown' },
  { type: 'multiselect',label: 'Multi-select' },
];

function uid() { return Math.random().toString(36).slice(2, 10); }

interface ChecklistBuilderProps {
  sections: ChecklistSection[];
  onChange: (sections: ChecklistSection[]) => void;
  initialName?: string;
  initialIsDefault?: boolean;
  saving?: boolean;
  mode: 'client-profile' | 'schedule-panel';
  onSave: (name: string, sections: ChecklistSection[], isDefault: boolean) => Promise<void>;
  onSaveAsNew?: (name: string, sections: ChecklistSection[]) => Promise<void>;
  onSaveJobOnly?: (sections: ChecklistSection[]) => void;
  onCancel?: () => void;
}

export default function ChecklistBuilder({
  sections, onChange,
  initialName = '',
  initialIsDefault = false,
  saving = false,
  mode,
  onSave, onSaveAsNew, onSaveJobOnly, onCancel,
}: ChecklistBuilderProps) {
  const [name, setName] = useState(initialName);
  const [isDefault, setIsDefault] = useState(initialIsDefault);
  const [addText, setAddText] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newOption, setNewOption] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewResponses, setPreviewResponses] = useState<FieldResponse[]>([]);
  const [showSaveAsNew, setShowSaveAsNew] = useState(false);
  const [saveAsNewName, setSaveAsNewName] = useState('');

  const openPreview = () => { setPreviewResponses([]); setShowPreview(true); };

  // Auto-focus the name input on mount
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const [focusId, setFocusId] = useState<string | null>(null);

  // ── Single flat field list, one section for DB compat ──────────────────────
  const fields: ChecklistField[] = sections[0]?.fields ?? [];
  const sectionId = sections[0]?.id ?? uid();

  const setFields = (next: ChecklistField[]) => {
    onChange([{ id: sectionId, title: '', fields: next }]);
  };

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const addField = () => {
    const newId = uid();
    setFields([...fields, { id: newId, type: 'checkbox', label: '' }]);
    setFocusId(newId);
  };

  const updateField = (id: string, patch: Partial<ChecklistField>) =>
    setFields(fields.map(f => f.id === id ? { ...f, ...patch } : f));

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const next = [...fields];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setFields(next);
  };

  const addOption = (fieldId: string) => {
    const opt = newOption.trim();
    if (!opt) return;
    const f = fields.find(f => f.id === fieldId);
    if (!f) return;
    updateField(fieldId, { options: [...(f.options ?? []), opt] });
    setNewOption('');
  };

  const yesNoFields = fields.filter(f => f.type === 'yesno');

  const handleSave = () => onSave(name.trim() || 'Untitled', sections, isDefault);

  const handleSaveAsNew = async () => {
    await onSaveAsNew?.(saveAsNewName.trim() || 'Untitled', sections);
    setShowSaveAsNew(false);
    setSaveAsNewName('');
  };

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border-light bg-surface-elevated/60">
        <input
          ref={nameRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Checklist name…"
          className="input-field text-sm font-semibold flex-1 py-2"
        />
        {/* Preview button */}
        <button
          onClick={openPreview}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border-light text-xs font-semibold text-text-secondary hover:text-primary hover:border-primary hover:bg-primary/5 transition-all"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Preview
        </button>
        {mode === 'client-profile' && (
          <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
            <button
              type="button"
              onClick={() => setIsDefault(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${isDefault ? 'bg-primary' : 'bg-border-light'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isDefault ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs font-semibold text-text-secondary whitespace-nowrap">Default</span>
          </label>
        )}
      </div>

      {/* ── Add item button ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2.5 border-b border-border-light bg-white">
        <button
          onClick={addField}
          className="flex items-center gap-2.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors group"
        >
          <span className="w-6 h-6 rounded-lg bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </span>
          Add item
        </button>
      </div>

      {/* ── Item list ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {fields.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center px-6">
            <div className="w-10 h-10 rounded-2xl bg-surface-elevated flex items-center justify-center mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-text-secondary">No items yet</p>
            <p className="text-xs text-text-tertiary mt-1">Type above and press Enter to add your first item</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {fields.map((field, idx) => {
              const expanded = expandedId === field.id;
              const needsOptions = field.type === 'dropdown' || field.type === 'multiselect';

              return (
                <motion.div
                  key={field.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-b border-border-light/60 last:border-0"
                >
                  {/* ── Item row ── */}
                  <div className="flex items-center gap-3 px-4 py-3 group hover:bg-surface-elevated/40 transition-colors">
                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5 shrink-0 opacity-30 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => moveField(idx, -1)} disabled={idx === 0}
                        className="text-text-tertiary hover:text-text-primary disabled:opacity-20 transition-colors p-0.5">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                      </button>
                      <button onClick={() => moveField(idx, 1)} disabled={idx === fields.length - 1}
                        className="text-text-tertiary hover:text-text-primary disabled:opacity-20 transition-colors p-0.5">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                    </div>

                    {/* Checkbox preview */}
                    <div className={`w-4 h-4 rounded shrink-0 border-2 ${field.type === 'checkbox' ? 'border-border-light' : 'border-transparent bg-surface-elevated'} flex items-center justify-center`}>
                      {field.type !== 'checkbox' && (
                        <span className="text-[9px] font-bold text-text-tertiary leading-none">
                          {field.type === 'yesno' ? 'Y/N' : field.type === 'photo' ? '📷' : field.type === 'text' ? 'T' : field.type === 'date' ? 'D' : field.type === 'time' ? '⏱' : field.type === 'video' ? '🎥' : '…'}
                        </span>
                      )}
                    </div>

                    {/* Label — auto-focus if just created */}
                    <input
                      autoFocus={focusId === field.id}
                      value={field.label}
                      onChange={e => updateField(field.id, { label: e.target.value })}
                      onFocus={() => setFocusId(null)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addField(); } }}
                      placeholder="Item label…"
                      className="flex-1 text-sm text-text-primary placeholder-text-tertiary bg-transparent outline-none min-w-0"
                    />

                    {/* Badges */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {field.type !== 'checkbox' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 whitespace-nowrap">
                          {FIELD_TYPE_LABELS[field.type]}
                        </span>
                      )}
                      {field.required && (
                        <span className="text-[10px] font-bold text-rose-400">Required</span>
                      )}
                    </div>

                    {/* Settings toggle */}
                    <button
                      onClick={() => setExpandedId(expanded ? null : field.id)}
                      className={`p-1.5 rounded-lg transition-colors shrink-0 ${expanded ? 'bg-primary/10 text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => removeField(field.id)}
                      className="p-1.5 rounded-lg text-text-tertiary hover:text-rose-500 hover:bg-rose-50 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                      </svg>
                    </button>
                  </div>

                  {/* ── Expanded settings ── */}
                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 py-4 bg-slate-50/80 border-t border-border-light/50 space-y-4">

                          {/* Helper text */}
                          <div>
                            <label className="block text-[11px] font-bold text-text-tertiary uppercase tracking-wider mb-1.5">
                              Helper text <span className="font-normal normal-case">(shown to staff below the item)</span>
                            </label>
                            <input
                              value={field.description ?? ''}
                              onChange={e => updateField(field.id, { description: e.target.value || undefined })}
                              placeholder="e.g. Check all taps, under sink and around toilet base"
                              className="input-field text-sm w-full"
                            />
                          </div>

                          {/* Field type */}
                          <div>
                            <label className="block text-[11px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Field type</label>
                            <div className="grid grid-cols-3 gap-1.5">
                              {TYPE_OPTIONS.map(({ type, label }) => (
                                <button
                                  key={type}
                                  onClick={() => updateField(field.id, { type, options: undefined, conditionalOn: undefined, conditionalValue: undefined })}
                                  className={`px-2 py-2 rounded-xl text-xs font-semibold text-center border transition-all ${
                                    field.type === type
                                      ? 'bg-primary text-white border-primary shadow-sm'
                                      : 'bg-white text-text-secondary border-border-light hover:border-primary/50 hover:text-primary'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Required + N/A */}
                          <div className="flex items-center gap-6">
                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                              <button
                                type="button"
                                onClick={() => updateField(field.id, { required: !field.required })}
                                className={`relative w-9 h-5 rounded-full transition-colors ${field.required ? 'bg-primary' : 'bg-border-light'}`}
                              >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${field.required ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </button>
                              <span className="text-sm font-medium text-text-secondary">Required</span>
                            </label>
                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                              <button
                                type="button"
                                onClick={() => updateField(field.id, { allowNA: !field.allowNA })}
                                className={`relative w-9 h-5 rounded-full transition-colors ${field.allowNA ? 'bg-amber-400' : 'bg-border-light'}`}
                              >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${field.allowNA ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </button>
                              <span className="text-sm font-medium text-text-secondary">Allow N/A</span>
                            </label>
                          </div>

                          {/* Dropdown / multiselect options */}
                          {needsOptions && (
                            <div>
                              <label className="block text-[11px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Options</label>
                              <div className="space-y-1.5 mb-2">
                                {(field.options ?? []).map((opt, oi) => (
                                  <div key={oi} className="flex items-center gap-2">
                                    <input
                                      value={opt}
                                      onChange={e => updateField(field.id, { options: (field.options ?? []).map((o, i) => i === oi ? e.target.value : o) })}
                                      className="input-field text-sm flex-1"
                                    />
                                    <button
                                      onClick={() => updateField(field.id, { options: (field.options ?? []).filter((_, i) => i !== oi) })}
                                      className="p-1.5 text-text-tertiary hover:text-rose-500 transition-colors"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <input
                                  value={newOption}
                                  onChange={e => setNewOption(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(field.id); } }}
                                  placeholder="Add option…"
                                  className="input-field text-sm flex-1"
                                />
                                <button onClick={() => addOption(field.id)}
                                  className="px-3 text-sm font-semibold text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors">
                                  Add
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Conditional logic */}
                          {yesNoFields.filter(f => f.id !== field.id).length > 0 && (
                            <div>
                              <label className="block text-[11px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Only show when</label>
                              <div className="flex items-center gap-2 flex-wrap">
                                <select
                                  value={field.conditionalOn ?? ''}
                                  onChange={e => updateField(field.id, {
                                    conditionalOn: e.target.value || undefined,
                                    conditionalValue: e.target.value ? (field.conditionalValue ?? 'yes') : undefined,
                                  })}
                                  className="input-field text-sm flex-1 min-w-[140px]"
                                >
                                  <option value="">Always visible</option>
                                  {yesNoFields.filter(f => f.id !== field.id).map(f => (
                                    <option key={f.id} value={f.id}>{f.label || 'Untitled Yes/No'}</option>
                                  ))}
                                </select>
                                {field.conditionalOn && (
                                  <div className="flex rounded-xl border border-border-light overflow-hidden shrink-0">
                                    {(['yes', 'no'] as const).map(v => (
                                      <button key={v}
                                        onClick={() => updateField(field.id, { conditionalValue: v })}
                                        className={`px-4 py-2 text-sm font-semibold transition-colors ${field.conditionalValue === v ? 'bg-primary text-white' : 'bg-white text-text-secondary hover:bg-surface-elevated'}`}>
                                        {v === 'yes' ? 'Yes' : 'No'}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* ── Save bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border-light p-4 bg-white flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving
            ? <svg width="14" height="14" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            : null
          }
          Save Checklist
        </button>
        {onSaveAsNew && (
          <button onClick={() => setShowSaveAsNew(true)} disabled={saving}
            className="btn-ghost text-sm px-4 disabled:opacity-50">
            Save as New
          </button>
        )}
        {onCancel && (
          <button onClick={onCancel} className="btn-ghost text-sm px-4">Cancel</button>
        )}
      </div>

      {/* ── Save-as-new modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSaveAsNew && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
              <h3 className="text-sm font-bold text-text-primary mb-1">Name this checklist</h3>
              <p className="text-xs text-text-secondary mb-4">Saves a copy without changing the original.</p>
              <input
                autoFocus
                value={saveAsNewName}
                onChange={e => setSaveAsNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveAsNew(); if (e.key === 'Escape') setShowSaveAsNew(false); }}
                placeholder="e.g. Deep Clean, End of Lease…"
                className="input-field text-sm w-full mb-4"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveAsNew} disabled={!saveAsNewName.trim() || saving}
                  className="btn-primary text-sm flex-1 disabled:opacity-50">Save</button>
                <button onClick={() => setShowSaveAsNew(false)} className="btn-ghost text-sm px-4">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Preview modal ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPreview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowPreview(false); }}>
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
              style={{ height: '85vh' }}>
              {/* Preview header */}
              <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-border-light bg-slate-50">
                <div>
                  <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Staff Preview</p>
                  <h3 className="text-sm font-bold text-text-primary">{name || 'Untitled Checklist'}</h3>
                </div>
                <button onClick={() => setShowPreview(false)}
                  className="p-2 rounded-xl text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              {/* Runner — staff view, responses are local preview only */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChecklistRunner
                  sections={sections}
                  responses={previewResponses}
                  onChange={setPreviewResponses}
                  onSubmit={async () => { setShowPreview(false); }}
                  orgId="preview"
                  completionId={null}
                  isAdmin={false}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
