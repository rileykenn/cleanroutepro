'use client';

import { useState } from 'react';
import { ChecklistField, FieldType, FIELD_TYPE_LABELS, FIELD_TYPE_ICONS } from './types';
import { generateId } from '@/lib/timeUtils';

const ALL_TYPES: FieldType[] = [
  'checkbox', 'text', 'yesno', 'dropdown', 'multiselect', 'date', 'time', 'photo', 'video',
];

interface ChecklistFieldEditorProps {
  field: ChecklistField;
  allYesNoFields: { id: string; label: string }[]; // for conditional logic picker
  onChange: (updated: ChecklistField) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export default function ChecklistFieldEditor({
  field, allYesNoFields, onChange, onDelete, onMoveUp, onMoveDown,
}: ChecklistFieldEditorProps) {
  const [showTypeGrid, setShowTypeGrid] = useState(false);
  const [newOption, setNewOption] = useState('');

  const update = (patch: Partial<ChecklistField>) => onChange({ ...field, ...patch });

  const addOption = () => {
    const opt = newOption.trim();
    if (!opt) return;
    update({ options: [...(field.options || []), opt] });
    setNewOption('');
  };

  const removeOption = (i: number) =>
    update({ options: (field.options || []).filter((_, idx) => idx !== i) });

  const needsOptions = field.type === 'dropdown' || field.type === 'multiselect';
  const canHaveConditional = true; // any field can be made conditional
  const parentOptions = allYesNoFields.filter(f => f.id !== field.id);

  return (
    <div className="rounded-xl border border-border-light bg-white overflow-hidden">
      {/* Drag handle + type + move buttons */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-elevated border-b border-border-light">
        {/* Move up/down */}
        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={onMoveUp} disabled={!onMoveUp}
            className="p-0.5 rounded hover:bg-surface-hover disabled:opacity-30 text-text-tertiary hover:text-text-primary transition-colors">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button onClick={onMoveDown} disabled={!onMoveDown}
            className="p-0.5 rounded hover:bg-surface-hover disabled:opacity-30 text-text-tertiary hover:text-text-primary transition-colors">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>

        {/* Type pill */}
        <div className="relative">
          <button onClick={() => setShowTypeGrid(!showTypeGrid)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-border-light text-xs font-semibold text-text-primary hover:border-primary transition-colors">
            <span>{FIELD_TYPE_ICONS[field.type]}</span>
            <span>{FIELD_TYPE_LABELS[field.type]}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showTypeGrid ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          {showTypeGrid && (
            <div className="absolute left-0 top-full mt-1 z-30 bg-white rounded-xl shadow-xl border border-border-light p-2 grid grid-cols-3 gap-1 w-52">
              {ALL_TYPES.map(t => (
                <button key={t} onClick={() => { update({ type: t, options: t === 'dropdown' || t === 'multiselect' ? field.options || [] : undefined }); setShowTypeGrid(false); }}
                  className={`flex flex-col items-center gap-0.5 p-2 rounded-lg text-center transition-colors ${field.type === t ? 'bg-primary text-white' : 'hover:bg-surface-elevated text-text-secondary'}`}>
                  <span className="text-base leading-none">{FIELD_TYPE_ICONS[t]}</span>
                  <span className="text-[9px] font-semibold leading-tight">{FIELD_TYPE_LABELS[t]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Required toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
          <button onClick={() => update({ required: !field.required })}
            className={`relative w-8 h-4 rounded-full transition-colors ${field.required ? 'bg-primary' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${field.required ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">Required</span>
        </label>

        {/* N/A toggle */}
        <label className="flex items-center gap-1.5 cursor-pointer select-none shrink-0">
          <button onClick={() => update({ allowNA: !field.allowNA })}
            className={`relative w-8 h-4 rounded-full transition-colors ${field.allowNA ? 'bg-amber-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${field.allowNA ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">N/A</span>
        </label>

        {/* Delete */}
        <button onClick={onDelete}
          className="p-1 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors shrink-0">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>

      {/* Field content */}
      <div className="p-3 space-y-2.5">
        {/* Label */}
        <div>
          <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">
            Label {field.required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          <input value={field.label} onChange={e => update({ label: e.target.value })}
            placeholder="e.g. Are there ceiling fans?"
            className="input-field text-sm w-full py-2" />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">Helper text (optional)</label>
          <input value={field.description || ''} onChange={e => update({ description: e.target.value || undefined })}
            placeholder="Extra instructions shown to staff below the label"
            className="input-field text-sm w-full py-2 text-text-secondary" />
        </div>

        {/* Options editor for dropdown / multiselect */}
        {needsOptions && (
          <div>
            <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Options</label>
            <div className="space-y-1.5 mb-2">
              {(field.options || []).map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded border border-border-light shrink-0 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
                  </div>
                  <input value={opt}
                    onChange={e => update({ options: (field.options || []).map((o, idx) => idx === i ? e.target.value : o) })}
                    className="input-field text-sm flex-1 py-1.5" />
                  <button onClick={() => removeOption(i)}
                    className="p-0.5 rounded hover:text-danger text-text-tertiary transition-colors shrink-0">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newOption} onChange={e => setNewOption(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }}
                placeholder="Add option…"
                className="input-field text-sm flex-1 py-1.5" />
              <button onClick={addOption}
                className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-border-light text-xs font-semibold text-text-secondary hover:text-primary hover:border-primary transition-colors">
                Add
              </button>
            </div>
          </div>
        )}

        {/* Conditional logic */}
        {parentOptions.length > 0 && (
          <div className="pt-1 border-t border-border-light">
            <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1.5">
              Conditional — only show when
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={field.conditionalOn || ''}
                onChange={e => update({ conditionalOn: e.target.value || undefined, conditionalValue: e.target.value ? (field.conditionalValue || 'yes') : undefined })}
                className="input-field text-xs py-1.5 flex-1 min-w-[120px]"
              >
                <option value="">Always show (no condition)</option>
                {parentOptions.map(f => (
                  <option key={f.id} value={f.id}>{f.label || 'Untitled Yes/No'}</option>
                ))}
              </select>
              {field.conditionalOn && (
                <>
                  <span className="text-xs text-text-tertiary shrink-0">= </span>
                  <div className="flex rounded-lg border border-border-light overflow-hidden shrink-0">
                    {(['yes', 'no'] as const).map(v => (
                      <button key={v} onClick={() => update({ conditionalValue: v })}
                        className={`px-3 py-1.5 text-xs font-semibold transition-colors ${field.conditionalValue === v ? 'bg-primary text-white' : 'bg-white text-text-secondary hover:bg-surface-elevated'}`}>
                        {v === 'yes' ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
