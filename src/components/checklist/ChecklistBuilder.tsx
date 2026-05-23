'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChecklistField, ChecklistSection, FieldType, FIELD_TYPE_LABELS, FIELD_TYPE_ICONS } from './types';

// All types shown in the type picker (simple pill row)
const TYPE_PILLS: { type: FieldType; icon: string; label: string }[] = [
  { type: 'checkbox', icon: '☑', label: 'Check' },
  { type: 'yesno',    icon: '👍', label: 'Yes/No' },
  { type: 'text',     icon: '📝', label: 'Text' },
  { type: 'photo',    icon: '📷', label: 'Photo' },
  { type: 'dropdown', icon: '🔽', label: 'Dropdown' },
  { type: 'date',     icon: '📅', label: 'Date' },
  { type: 'time',     icon: '🕐', label: 'Time' },
  { type: 'multiselect', icon: '☰', label: 'Multi' },
  { type: 'video',    icon: '🎥', label: 'Video' },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

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
  const [newOption, setNewOption] = useState('');
  const [showSaveAsNew, setShowSaveAsNew] = useState(false);
  const [saveAsNewName, setSaveAsNewName] = useState('');
  const addRef = useRef<HTMLInputElement>(null);

  // ── Flat field list (we keep ONE internal section for DB compat) ────────────
  const fields: ChecklistField[] = sections[0]?.fields ?? [];

  const setFields = useCallback((next: ChecklistField[]) => {
    onChange([{ id: sections[0]?.id ?? uid(), title: '', fields: next }]);
  }, [sections, onChange]);

  // ── Field CRUD ──────────────────────────────────────────────────────────────
  const addField = () => {
    const text = addText.trim();
    if (!text) return;
    const newField: ChecklistField = { id: uid(), type: 'checkbox', label: text };
    setFields([...fields, newField]);
    setAddText('');
    addRef.current?.focus();
  };

  const updateField = (id: string, patch: Partial<ChecklistField>) =>
    setFields(fields.map(f => f.id === id ? { ...f, ...patch } : f));

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...fields];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setFields(next);
  };

  const moveDown = (idx: number) => {
    if (idx === fields.length - 1) return;
    const next = [...fields];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setFields(next);
  };

  // ── Options for dropdown/multiselect ───────────────────────────────────────
  const addOption = (fieldId: string) => {
    const opt = newOption.trim();
    if (!opt) return;
    const f = fields.find(f => f.id === fieldId);
    if (!f) return;
    updateField(fieldId, { options: [...(f.options ?? []), opt] });
    setNewOption('');
  };

  // ── All yes/no fields for conditional logic picker ─────────────────────────
  const yesNoFields = fields.filter(f => f.type === 'yesno');

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    await onSave(name.trim() || 'Untitled', sections, isDefault);
  };

  const handleSaveAsNew = async () => {
    await onSaveAsNew?.(saveAsNewName.trim() || 'Untitled', sections);
    setShowSaveAsNew(false);
    setSaveAsNewName('');
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Name row ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border-light bg-surface-elevated">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Checklist name…"
          className="input-field text-sm font-semibold flex-1 py-2"
        />
        {mode === 'client-profile' && (
          <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
            <button
              type="button"
              onClick={() => setIsDefault(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${isDefault ? 'bg-primary' : 'bg-border-light'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isDefault ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs font-semibold text-text-secondary whitespace-nowrap">Default</span>
          </label>
        )}
      </div>

      {/* ── Field list ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="divide-y divide-border-light/60">
          <AnimatePresence initial={false}>
            {fields.map((field, idx) => {
              const expanded = expandedId === field.id;
              const needsOptions = field.type === 'dropdown' || field.type === 'multiselect';
              const isNonDefault = field.type !== 'checkbox';

              return (
                <motion.div
                  key={field.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  {/* ── Main item row ── */}
                  <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-surface-elevated/50 group">
                    {/* Drag / reorder */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => moveUp(idx)} disabled={idx === 0}
                        className="p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-20 transition-colors">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                      </button>
                      <button onClick={() => moveDown(idx)} disabled={idx === fields.length - 1}
                        className="p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-20 transition-colors">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                    </div>

                    {/* Type icon */}
                    <span className="text-sm shrink-0 select-none" title={FIELD_TYPE_LABELS[field.type]}>
                      {FIELD_TYPE_ICONS[field.type]}
                    </span>

                    {/* Label */}
                    <input
                      value={field.label}
                      onChange={e => updateField(field.id, { label: e.target.value })}
                      placeholder="Item label…"
                      className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary outline-none min-w-0 py-0.5"
                    />

                    {/* Badges */}
                    <div className="flex items-center gap-1 shrink-0">
                      {field.required && (
                        <span className="text-[10px] font-bold text-red-400 leading-none">*</span>
                      )}
                      {field.allowNA && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-100 text-gray-500 leading-none">N/A</span>
                      )}
                      {isNonDefault && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-light text-primary leading-none">
                          {FIELD_TYPE_LABELS[field.type]}
                        </span>
                      )}
                    </div>

                    {/* Expand settings */}
                    <button
                      onClick={() => setExpandedId(expanded ? null : field.id)}
                      className="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors shrink-0"
                      title="Field settings"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => removeField(field.id)}
                      className="p-1 rounded-lg text-text-tertiary hover:text-danger hover:bg-danger-light transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
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
                        <div className="px-4 pb-4 pt-2 bg-surface-elevated/60 border-t border-border-light/60 space-y-3">

                          {/* Helper text */}
                          <div>
                            <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">Helper text (optional)</label>
                            <input
                              value={field.description ?? ''}
                              onChange={e => updateField(field.id, { description: e.target.value || undefined })}
                              placeholder="Extra instruction shown to staff below the label…"
                              className="input-field text-xs w-full py-2"
                            />
                          </div>

                          {/* Type pills */}
                          <div>
                            <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Field type</label>
                            <div className="flex flex-wrap gap-1.5">
                              {TYPE_PILLS.map(({ type, icon, label }) => (
                                <button
                                  key={type}
                                  onClick={() => updateField(field.id, { type, options: undefined, conditionalOn: undefined, conditionalValue: undefined })}
                                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                    field.type === type
                                      ? 'bg-primary text-white border-primary'
                                      : 'bg-white text-text-secondary border-border-light hover:border-primary hover:text-primary'
                                  }`}
                                >
                                  <span>{icon}</span> {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Required + N/A toggles */}
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <button type="button" onClick={() => updateField(field.id, { required: !field.required })}
                                className={`relative w-8 h-4 rounded-full transition-colors ${field.required ? 'bg-primary' : 'bg-border-light'}`}>
                                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${field.required ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </button>
                              <span className="text-xs font-semibold text-text-secondary">Required</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <button type="button" onClick={() => updateField(field.id, { allowNA: !field.allowNA })}
                                className={`relative w-8 h-4 rounded-full transition-colors ${field.allowNA ? 'bg-amber-500' : 'bg-border-light'}`}>
                                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${field.allowNA ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              </button>
                              <span className="text-xs font-semibold text-text-secondary">Allow N/A</span>
                            </label>
                          </div>

                          {/* Options editor */}
                          {needsOptions && (
                            <div>
                              <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Options</label>
                              <div className="space-y-1.5 mb-2">
                                {(field.options ?? []).map((opt, oi) => (
                                  <div key={oi} className="flex items-center gap-2">
                                    <input
                                      value={opt}
                                      onChange={e => updateField(field.id, { options: (field.options ?? []).map((o, i) => i === oi ? e.target.value : o) })}
                                      className="input-field text-xs flex-1 py-1.5"
                                    />
                                    <button onClick={() => updateField(field.id, { options: (field.options ?? []).filter((_, i) => i !== oi) })}
                                      className="p-0.5 text-text-tertiary hover:text-danger transition-colors">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
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
                                  className="input-field text-xs flex-1 py-1.5"
                                />
                                <button onClick={() => addOption(field.id)}
                                  className="px-3 text-xs font-semibold text-primary border border-primary rounded-lg hover:bg-primary-light/30 transition-colors">
                                  Add
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Conditional logic */}
                          {yesNoFields.filter(f => f.id !== field.id).length > 0 && (
                            <div>
                              <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Only show when</label>
                              <div className="flex items-center gap-2 flex-wrap">
                                <select
                                  value={field.conditionalOn ?? ''}
                                  onChange={e => updateField(field.id, {
                                    conditionalOn: e.target.value || undefined,
                                    conditionalValue: e.target.value ? (field.conditionalValue ?? 'yes') : undefined,
                                  })}
                                  className="input-field text-xs py-1.5 flex-1 min-w-[120px]"
                                >
                                  <option value="">Always visible</option>
                                  {yesNoFields.filter(f => f.id !== field.id).map(f => (
                                    <option key={f.id} value={f.id}>{f.label || 'Untitled Yes/No'}</option>
                                  ))}
                                </select>
                                {field.conditionalOn && (
                                  <div className="flex rounded-lg border border-border-light overflow-hidden shrink-0">
                                    {(['yes', 'no'] as const).map(v => (
                                      <button key={v} onClick={() => updateField(field.id, { conditionalValue: v })}
                                        className={`px-3 py-1.5 text-xs font-semibold transition-colors ${field.conditionalValue === v ? 'bg-primary text-white' : 'bg-white text-text-secondary hover:bg-surface-elevated'}`}>
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

          {/* ── Empty state ── */}
          {fields.length === 0 && (
            <div className="py-8 text-center text-sm text-text-tertiary">
              No items yet — type below to add your first one
            </div>
          )}
        </div>

        {/* ── Add item input ──────────────────────────────────────────────── */}
        <div className="px-3 py-3 border-t border-border-light sticky bottom-0 bg-white">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-tertiary shrink-0">☑</span>
            <input
              ref={addRef}
              value={addText}
              onChange={e => setAddText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addField(); } }}
              placeholder="Add an item and press Enter…"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary outline-none py-1"
            />
            {addText.trim() && (
              <button onClick={addField}
                className="shrink-0 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                Add
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Save actions ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border-light p-3 bg-white space-y-2">
        {mode === 'client-profile' ? (
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="btn-primary text-sm flex-1 py-2.5 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving
                ? <svg width="13" height="13" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
              }
              Save Checklist
            </button>
            {onCancel && (
              <button onClick={onCancel} className="btn-ghost text-sm px-4">Cancel</button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleSave} disabled={saving}
                className="btn-primary text-xs py-2.5 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {saving
                  ? <svg width="12" height="12" className="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                }
                Save Changes
              </button>
              {onSaveAsNew && (
                <button onClick={() => setShowSaveAsNew(true)} disabled={saving}
                  className="btn-ghost text-xs py-2.5 disabled:opacity-50">
                  Save as New
                </button>
              )}
            </div>
            {onSaveJobOnly && (
              <button onClick={() => onSaveJobOnly(sections)} disabled={saving}
                className="w-full text-xs text-text-tertiary hover:text-primary py-1.5 text-center transition-colors">
                Save for this job only
              </button>
            )}
            {onCancel && (
              <button onClick={onCancel} className="w-full text-xs text-text-tertiary hover:text-text-primary py-1 text-center transition-colors">
                Cancel
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Save-as-new name prompt ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showSaveAsNew && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
              <h3 className="text-sm font-bold text-text-primary mb-1">Name this checklist</h3>
              <p className="text-xs text-text-secondary mb-4">Saves a copy to this client's profile.</p>
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
    </div>
  );
}
