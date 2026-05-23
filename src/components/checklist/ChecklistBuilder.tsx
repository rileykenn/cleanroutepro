'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChecklistSection, ChecklistField, FieldType, FIELD_TYPE_ICONS, FIELD_TYPE_LABELS } from './types';
import ChecklistFieldEditor from './ChecklistFieldEditor';
import { generateId } from '@/lib/timeUtils';

const QUICK_ADD_TYPES: FieldType[] = ['checkbox', 'text', 'yesno', 'dropdown', 'photo'];

interface ChecklistBuilderProps {
  /** Controlled — caller holds the state */
  sections: ChecklistSection[];
  onChange: (sections: ChecklistSection[]) => void;

  /** Save actions */
  initialName?: string;
  initialIsDefault?: boolean;
  saving?: boolean;

  // Which save actions to show
  mode: 'client-profile' | 'schedule-panel';
  onSave: (name: string, sections: ChecklistSection[], isDefault: boolean) => Promise<void>;
  onSaveAsNew?: (name: string, sections: ChecklistSection[]) => Promise<void>;
  onSaveJobOnly?: (sections: ChecklistSection[]) => void;
  onCancel?: () => void;
}

export default function ChecklistBuilder({
  sections, onChange,
  initialName = '', initialIsDefault = false,
  saving = false,
  mode, onSave, onSaveAsNew, onSaveJobOnly, onCancel,
}: ChecklistBuilderProps) {
  const [name, setName] = useState(initialName);
  const [isDefault, setIsDefault] = useState(initialIsDefault);
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingAction, setPendingAction] = useState<'save-new' | null>(null);
  const [newSaveName, setNewSaveName] = useState('');

  // ─── Section helpers ────────────────────────────────────────────────────────
  const addSection = () => {
    const newSection: ChecklistSection = { id: generateId(), title: '', fields: [] };
    onChange([...sections, newSection]);
  };

  const updateSection = (sid: string, patch: Partial<ChecklistSection>) =>
    onChange(sections.map(s => s.id === sid ? { ...s, ...patch } : s));

  const removeSection = (sid: string) =>
    onChange(sections.filter(s => s.id !== sid));

  const moveSectionUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...sections];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };

  const moveSectionDown = (idx: number) => {
    if (idx === sections.length - 1) return;
    const next = [...sections];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    onChange(next);
  };

  // ─── Field helpers ──────────────────────────────────────────────────────────
  const addField = (sid: string, type: FieldType) => {
    const field: ChecklistField = { id: generateId(), type, label: '' };
    updateSection(sid, { fields: [...(sections.find(s => s.id === sid)?.fields || []), field] });
  };

  const updateField = (sid: string, fid: string, updated: ChecklistField) =>
    updateSection(sid, {
      fields: (sections.find(s => s.id === sid)?.fields || []).map(f => f.id === fid ? updated : f),
    });

  const removeField = (sid: string, fid: string) =>
    updateSection(sid, {
      fields: (sections.find(s => s.id === sid)?.fields || []).filter(f => f.id !== fid),
    });

  const moveFieldUp = (sid: string, idx: number) => {
    const sec = sections.find(s => s.id === sid);
    if (!sec || idx === 0) return;
    const fields = [...sec.fields];
    [fields[idx - 1], fields[idx]] = [fields[idx], fields[idx - 1]];
    updateSection(sid, { fields });
  };

  const moveFieldDown = (sid: string, idx: number) => {
    const sec = sections.find(s => s.id === sid);
    if (!sec || idx === sec.fields.length - 1) return;
    const fields = [...sec.fields];
    [fields[idx], fields[idx + 1]] = [fields[idx + 1], fields[idx]];
    updateSection(sid, { fields });
  };

  // ─── Drag-and-drop section reorder ──────────────────────────────────────────
  const handleDragStart = (sid: string) => setDraggingSectionId(sid);
  const handleDragOver = (e: React.DragEvent, sid: string) => { e.preventDefault(); setDragOverSectionId(sid); };
  const handleDrop = (sid: string) => {
    if (!draggingSectionId || draggingSectionId === sid) { setDraggingSectionId(null); setDragOverSectionId(null); return; }
    const from = sections.findIndex(s => s.id === draggingSectionId);
    const to = sections.findIndex(s => s.id === sid);
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setDraggingSectionId(null);
    setDragOverSectionId(null);
  };

  // All yes/no fields across all sections (for conditional logic picker)
  const allYesNoFields = sections.flatMap(s =>
    s.fields.filter(f => f.type === 'yesno').map(f => ({ id: f.id, label: f.label }))
  );

  const totalFields = sections.reduce((sum, s) => sum + s.fields.length, 0);

  const handleSave = async () => {
    await onSave(name || 'Untitled', sections, isDefault);
  };

  const handleSaveAsNew = async () => {
    if (!newSaveName.trim()) return;
    await onSaveAsNew?.(newSaveName.trim(), sections);
    setShowNamePrompt(false);
    setNewSaveName('');
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Name + default row ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light bg-surface-elevated shrink-0 flex-wrap gap-y-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Checklist name…"
          className="input-field text-sm font-semibold flex-1 min-w-[140px] py-2"
        />
        {mode === 'client-profile' && (
          <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
            <button onClick={() => setIsDefault(!isDefault)}
              className={`relative w-9 h-5 rounded-full transition-colors ${isDefault ? 'bg-primary' : 'bg-border-light'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isDefault ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs font-semibold text-text-secondary">Default</span>
          </label>
        )}
        <span className="text-xs text-text-tertiary shrink-0">{totalFields} field{totalFields !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Sections ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        <AnimatePresence initial={false}>
          {sections.map((sec, si) => (
            <motion.div
              key={sec.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, height: 0 }}
              draggable
              onDragStart={() => handleDragStart(sec.id)}
              onDragOver={e => handleDragOver(e, sec.id)}
              onDrop={() => handleDrop(sec.id)}
              onDragEnd={() => { setDraggingSectionId(null); setDragOverSectionId(null); }}
              className={`rounded-xl border-2 transition-all ${
                draggingSectionId === sec.id ? 'opacity-40' : 'opacity-100'
              } ${
                dragOverSectionId === sec.id && draggingSectionId !== sec.id
                  ? 'border-primary bg-primary-light/20'
                  : 'border-border-light bg-white'
              }`}
            >
              {/* Section header */}
              <div className="flex items-start gap-2 p-3 border-b border-border-light">
                {/* Drag handle */}
                <button className="mt-1 p-1 rounded cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-primary transition-colors shrink-0">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="8" cy="6" r="1" fill="currentColor"/><circle cx="16" cy="6" r="1" fill="currentColor"/>
                    <circle cx="8" cy="12" r="1" fill="currentColor"/><circle cx="16" cy="12" r="1" fill="currentColor"/>
                    <circle cx="8" cy="18" r="1" fill="currentColor"/><circle cx="16" cy="18" r="1" fill="currentColor"/>
                  </svg>
                </button>

                <div className="flex-1 space-y-1.5">
                  <input
                    value={sec.title}
                    onChange={e => updateSection(sec.id, { title: e.target.value })}
                    placeholder={`Section ${si + 1} title…`}
                    className="input-field text-sm font-bold w-full py-2"
                  />
                  <input
                    value={sec.description || ''}
                    onChange={e => updateSection(sec.id, { description: e.target.value || undefined })}
                    placeholder="Section description (optional)…"
                    className="input-field text-xs text-text-secondary w-full py-1.5"
                  />
                </div>

                <div className="flex items-center gap-1 shrink-0 mt-1">
                  <button onClick={() => moveSectionUp(si)} disabled={si === 0}
                    className="p-1 rounded hover:bg-surface-hover disabled:opacity-20 text-text-tertiary transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15"/></svg>
                  </button>
                  <button onClick={() => moveSectionDown(si)} disabled={si === sections.length - 1}
                    className="p-1 rounded hover:bg-surface-hover disabled:opacity-20 text-text-tertiary transition-colors">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  {sections.length > 1 && (
                    <button onClick={() => removeSection(sec.id)}
                      className="p-1 rounded hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Fields */}
              <div className="p-3 space-y-3">
                <AnimatePresence initial={false}>
                  {sec.fields.map((field, fi) => (
                    <motion.div key={field.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <ChecklistFieldEditor
                        field={field}
                        allYesNoFields={allYesNoFields}
                        onChange={updated => updateField(sec.id, field.id, updated)}
                        onDelete={() => removeField(sec.id, field.id)}
                        onMoveUp={fi > 0 ? () => moveFieldUp(sec.id, fi) : undefined}
                        onMoveDown={fi < sec.fields.length - 1 ? () => moveFieldDown(sec.id, fi) : undefined}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Quick add field buttons */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {QUICK_ADD_TYPES.map(type => (
                    <button key={type}
                      onClick={() => addField(sec.id, type)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-dashed border-border-light text-text-tertiary hover:border-primary hover:text-primary hover:bg-primary-light/20 transition-all">
                      <span>{FIELD_TYPE_ICONS[type]}</span>
                      {FIELD_TYPE_LABELS[type]}
                    </button>
                  ))}
                  {/* More types dropdown */}
                  <MoreTypesButton onAdd={type => addField(sec.id, type)} />
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Add section */}
        <button onClick={addSection}
          className="w-full py-3 rounded-xl border-2 border-dashed border-border-light hover:border-primary text-sm text-text-tertiary hover:text-primary transition-colors font-semibold flex items-center justify-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Section
        </button>
      </div>

      {/* ── Save actions ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border-light p-3 space-y-2 bg-white">
        {mode === 'client-profile' ? (
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="btn-primary text-sm flex-1 py-2.5 disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving
                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
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
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                }
                Save Changes
              </button>
              {onSaveAsNew && (
                <button onClick={() => setShowNamePrompt(true)} disabled={saving}
                  className="btn-ghost text-xs py-2.5 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save as New
                </button>
              )}
            </div>
            {onSaveJobOnly && (
              <button onClick={() => onSaveJobOnly(sections)} disabled={saving}
                className="w-full text-xs text-text-tertiary hover:text-primary py-1.5 text-center transition-colors border border-border-light rounded-lg hover:border-primary hover:bg-primary-light/20">
                Save for this job only
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Save-as-new name prompt ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showNamePrompt && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
            >
              <h3 className="text-sm font-bold text-text-primary mb-1">Name this checklist</h3>
              <p className="text-xs text-text-secondary mb-4">It will be saved to this client's profile for future use.</p>
              <input
                autoFocus
                value={newSaveName}
                onChange={e => setNewSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveAsNew(); if (e.key === 'Escape') { setShowNamePrompt(false); setNewSaveName(''); } }}
                placeholder="e.g. Deep Clean, End of Lease…"
                className="input-field text-sm w-full mb-4"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveAsNew} disabled={!newSaveName.trim() || saving}
                  className="btn-primary text-sm flex-1 disabled:opacity-50">Save</button>
                <button onClick={() => { setShowNamePrompt(false); setNewSaveName(''); }} className="btn-ghost text-sm px-4">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── More field types picker ────────────────────────────────────────────────────
const EXTRA_TYPES: FieldType[] = ['multiselect', 'date', 'time', 'video'];
function MoreTypesButton({ onAdd }: { onAdd: (type: FieldType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-dashed border-border-light text-text-tertiary hover:border-primary hover:text-primary transition-all">
        + More
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-30 bg-white rounded-xl shadow-xl border border-border-light p-2 grid grid-cols-2 gap-1 w-44">
          {EXTRA_TYPES.map(t => (
            <button key={t} onClick={() => { onAdd(t); setOpen(false); }}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold text-text-secondary hover:bg-surface-elevated hover:text-primary transition-colors">
              <span>{FIELD_TYPE_ICONS[t]}</span>
              {FIELD_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
