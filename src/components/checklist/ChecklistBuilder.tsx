'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverlay, DragStartEvent, DragOverEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChecklistField, ChecklistSection, FieldType, FieldResponse, LogicCondition } from './types';
import ChecklistRunner from './ChecklistRunner';

// ─── Block type catalogue ────────────────────────────────────────────────────
const BLOCK_TYPES: { type: FieldType; label: string; desc: string; icon: React.ReactNode }[] = [
  { type: 'paragraph',     label: 'Text',          desc: 'Body text for staff to read',        icon: <BlockIcon type="paragraph"/> },
  { type: 'multiselect',   label: 'Checkbox',      desc: 'Tick one or more items',             icon: <BlockIcon type="multiselect"/> },
  { type: 'yesno',         label: 'Yes / No',      desc: 'Yes or no answer',                   icon: <BlockIcon type="yesno"/> },
  { type: 'text',          label: 'Response',      desc: 'Open-ended text response',           icon: <BlockIcon type="text"/> },
  { type: 'photo',         label: 'Photo / Image',  desc: 'Staff uploads a photo or image',     icon: <BlockIcon type="photo"/> },
  { type: 'video',         label: 'Video',          desc: 'Staff records or uploads a video',   icon: <BlockIcon type="video"/> },
  { type: 'date',          label: 'Date',          desc: 'Date picker',                        icon: <BlockIcon type="date"/> },
  { type: 'time',          label: 'Time',          desc: 'Time picker',                        icon: <BlockIcon type="time"/> },
  { type: 'dropdown',      label: 'Dropdown',      desc: 'Single choice from a list',          icon: <BlockIcon type="dropdown"/> },
  { type: 'multidropdown', label: 'Multi-select',  desc: 'Pick multiple from a dropdown',      icon: <BlockIcon type="multidropdown"/> },
  { type: 'heading',       label: 'Heading',       desc: 'Section title divider',              icon: <BlockIcon type="heading"/> },
  { type: 'logic',         label: 'Logic',         desc: 'Show/hide blocks based on answers',  icon: <span className="text-[13px]">⚡</span> },
];

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── Type icon ───────────────────────────────────────────────────────────────
function BlockIcon({ type }: { type: FieldType }) {
  const cls = 'w-4 h-4 flex items-center justify-center shrink-0';
  if (type === 'multiselect' || type === 'checkbox') return (
    <div className={cls}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1" y="1" width="5" height="5" rx="1"/>
        <line x1="8" y1="3.5" x2="15" y2="3.5"/>
        <rect x="1" y="9" width="5" height="5" rx="1"/>
        <line x1="8" y1="11.5" x2="15" y2="11.5"/>
      </svg>
    </div>
  );
  if (type === 'multidropdown') return (
    <div className={cls}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="1" y="2" width="14" height="5" rx="1.5"/>
        <polyline points="5 11 8 14 11 11"/>
        <line x1="8" y1="14" x2="8" y2="9"/>
      </svg>
    </div>
  );
  if (type === 'paragraph') return (
    <div className={cls}>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="2" y1="4" x2="14" y2="4"/>
        <line x1="2" y1="8" x2="14" y2="8"/>
        <line x1="2" y1="12" x2="9" y2="12"/>
      </svg>
    </div>
  );
  if (type === 'yesno')    return <div className={cls}><span className="text-[9px] font-black leading-none">Y/N</span></div>;
  if (type === 'text')     return <div className={cls}><span className="text-[10px] font-black leading-none">T</span></div>;
  if (type === 'photo')    return <div className={cls}><span className="text-[11px]">📷</span></div>;
  if (type === 'video')    return <div className={cls}><span className="text-[11px]">🎥</span></div>;
  if (type === 'date')     return <div className={cls}><span className="text-[11px]">📅</span></div>;
  if (type === 'time')     return <div className={cls}><span className="text-[11px]">🕐</span></div>;
  if (type === 'dropdown') return (
    <div className={cls}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
  );
  if (type === 'heading')  return <div className={cls}><span className="text-[10px] font-black leading-none">H</span></div>;
  return null;
}

// ─── Slash command menu ───────────────────────────────────────────────────────
interface SlashMenuProps {
  query: string;
  anchorRect: DOMRect | null;
  onSelect: (type: FieldType) => void;
  onClose: () => void;
}

function SlashMenu({ query, anchorRect, onSelect, onClose }: SlashMenuProps) {
  const [idx, setIdx] = useState(0);
  const filtered = BLOCK_TYPES.filter(b =>
    !query || b.label.toLowerCase().includes(query.toLowerCase()) || b.desc.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => { setIdx(0); }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter')     { e.preventDefault(); if (filtered[idx]) onSelect(filtered[idx].type); }
      if (e.key === 'Escape')    { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [idx, filtered, onSelect, onClose]);

  if (!anchorRect || filtered.length === 0) return null;

  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const flipUp = spaceBelow < 320; // not enough room below → open above
  const left = Math.min(anchorRect.left + window.scrollX, window.innerWidth - 230);
  const posStyle = flipUp
    ? { bottom: window.innerHeight - anchorRect.top + 4, left, width: 220 }
    : { top: anchorRect.bottom + window.scrollY + 4, left, width: 220 };

  return (
    <motion.div
      initial={{ opacity: 0, y: flipUp ? 6 : -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: flipUp ? 6 : -6, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className="fixed z-[999] bg-white rounded-2xl shadow-2xl border border-border-light overflow-hidden"
      style={posStyle}
    >
      {query && (
        <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold text-text-tertiary uppercase tracking-wider">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''} for "{query}"
        </p>
      )}
      <div className="py-1 max-h-72 overflow-y-auto">
        {filtered.map((b, i) => (
          <button key={b.type}
            onMouseDown={e => { e.preventDefault(); onSelect(b.type); }}
            onMouseEnter={() => setIdx(i)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${i === idx ? 'bg-primary/8' : 'hover:bg-surface-elevated'}`}
          >
            <span className={`text-text-tertiary shrink-0 ${i === idx ? 'text-primary' : ''}`}>
              <BlockIcon type={b.type}/>
            </span>
            <div>
              <p className={`text-sm font-semibold ${i === idx ? 'text-primary' : 'text-text-primary'}`}>{b.label}</p>
              <p className="text-[11px] text-text-tertiary">{b.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ─── Settings popover per block ───────────────────────────────────────────────
interface SettingsPopoverProps {
  field: ChecklistField;
  yesNoFields: ChecklistField[];
  onChange: (patch: Partial<ChecklistField>) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

function SettingsPopover({ field, yesNoFields, onChange, onClose, anchorRect }: SettingsPopoverProps) {
  const [newOpt, setNewOpt] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!anchorRect) return null;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const flipUp = spaceBelow < 360; // not enough room below → open above
  const left = Math.min(anchorRect.right + window.scrollX - 240, window.innerWidth - 260);
  const posStyle = flipUp
    ? { bottom: window.innerHeight - anchorRect.top + 4, left, width: 250 }
    : { top: anchorRect.bottom + window.scrollY + 4, left, width: 250 };
  const needsOptions = field.type === 'dropdown' || field.type === 'multiselect' || field.type === 'multidropdown';
  const hasYesNo = yesNoFields.filter(f => f.id !== field.id).length > 0;

  return (
    <motion.div ref={ref}
      initial={{ opacity: 0, y: flipUp ? 4 : -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: flipUp ? 4 : -4, scale: 0.97 }}
      transition={{ duration: 0.12 }}
      onClick={e => e.stopPropagation()}
      className="fixed z-[998] bg-white rounded-2xl shadow-2xl border border-border-light p-4 space-y-4"
      style={posStyle}
    >
      {/* Helper text */}
      <div>
        <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1.5">Helper text</label>
        <input value={field.description ?? ''} onChange={e => onChange({ description: e.target.value || undefined })}
          placeholder="Hint shown to staff below this field…"
          className="input-field text-xs w-full"/>
      </div>

      {/* Required + N/A */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button type="button" onClick={() => onChange({ required: !field.required })}
            className={`relative w-8 h-4 rounded-full transition-colors ${field.required ? 'bg-primary' : 'bg-gray-300'}`}>
            <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-200"
              style={{ left: field.required ? '18px' : '2px' }}/>
          </button>
          <span className="text-xs font-medium text-text-secondary">Required</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button type="button" onClick={() => onChange({ allowNA: !field.allowNA })}
            className={`relative w-8 h-4 rounded-full transition-colors ${field.allowNA ? 'bg-amber-400' : 'bg-gray-300'}`}>
            <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-200"
              style={{ left: field.allowNA ? '18px' : '2px' }}/>
          </button>
          <span className="text-xs font-medium text-text-secondary">Allow N/A</span>
        </label>
      </div>

      {/* Options (dropdown/multiselect) */}
      {needsOptions && (
        <div>
          <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Options</label>
          <div className="space-y-1.5 mb-2">
            {(field.options ?? []).map((opt, oi) => (
              <div key={oi} className="flex items-center gap-1.5 group/popt">
                <button onClick={() => onChange({ options: (field.options ?? []).filter((_, i) => i !== oi) })}
                  className="shrink-0 p-1 text-text-tertiary hover:text-rose-500 transition-colors opacity-0 group-hover/popt:opacity-100">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
                <input value={opt}
                  onChange={e => onChange({ options: (field.options ?? []).map((o, i) => i === oi ? e.target.value : o) })}
                  className="input-field text-xs flex-1 py-1"/>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input value={newOpt} onChange={e => setNewOpt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newOpt.trim()) { onChange({ options: [...(field.options ?? []), newOpt.trim()] }); setNewOpt(''); } }}
              placeholder="Add option…" className="input-field text-xs flex-1 py-1"/>
            <button onClick={() => { if (newOpt.trim()) { onChange({ options: [...(field.options ?? []), newOpt.trim()] }); setNewOpt(''); } }}
              disabled={!newOpt.trim()}
              className="px-2 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/5 disabled:opacity-30 transition-colors">+ Add</button>
          </div>
        </div>
      )}

      {/* Conditional logic */}
      {hasYesNo && (
        <div>
          <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Only show when</label>
          <div className="flex items-center gap-2">
            <select value={field.conditionalOn ?? ''}
              onChange={e => onChange({ conditionalOn: e.target.value || undefined, conditionalValue: e.target.value ? (field.conditionalValue ?? 'yes') : undefined })}
              className="input-field text-xs flex-1">
              <option value="">Always visible</option>
              {yesNoFields.filter(f => f.id !== field.id).map(f => (
                <option key={f.id} value={f.id}>{f.label || 'Untitled Yes/No'}</option>
              ))}
            </select>
            {field.conditionalOn && (
              <div className="flex rounded-lg border border-border-light overflow-hidden shrink-0">
                {(['yes', 'no'] as const).map(v => (
                  <button key={v} onClick={() => onChange({ conditionalValue: v })}
                    className={`px-2.5 py-1 text-xs font-semibold transition-colors ${field.conditionalValue === v ? 'bg-primary text-white' : 'bg-white text-text-secondary hover:bg-surface-elevated'}`}>
                    {v === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── Sortable block wrapper ────────────────────────────────────────────────────
interface SortableBlockProps {
  field: ChecklistField;
  idx: number;
  fields: ChecklistField[];
  settingsState: { blockId: string; anchorRect: DOMRect | null } | null;
  slashState: { blockId: string; prefix: string; query: string; anchorRect: DOMRect | null } | null;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  isDragging: boolean;
  updateField: (id: string, patch: Partial<ChecklistField>) => void;
  removeField: (id: string) => void;
  addBlock: (afterIdx: number, type?: FieldType) => string;
  handleInputChange: (field: ChecklistField, idx: number, val: string, el: HTMLInputElement | null) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, field: ChecklistField, idx: number) => void;
  setSettingsState: (s: { blockId: string; anchorRect: DOMRect | null } | null) => void;
  setSlashState: (s: { blockId: string; prefix: string; query: string; anchorRect: DOMRect | null } | null) => void;
  focusBlock: (id: string) => void;
}

function SortableBlock({
  field, idx, fields, settingsState, slashState, inputRefs, isDragging,
  updateField, removeField, addBlock, handleInputChange, handleKeyDown,
  setSettingsState, setSlashState, focusBlock,
}: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const isHeading = field.type === 'heading';
  const isLogic   = field.type === 'logic';
  const showingSettings = settingsState?.blockId === field.id;
  const inSlashMode = slashState?.blockId === field.id;
  const displayValue = inSlashMode
    ? slashState!.prefix + '/' + slashState!.query
    : field.label;

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: isDragging ? 0.35 : 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group relative"
    >
      {/* Logic blocks */}
      {isLogic && (
        <div className="flex items-start gap-1">
          {/* Drag handle for logic blocks */}
          <div
            {...attributes} {...listeners}
            className="shrink-0 mt-3 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity text-text-tertiary hover:text-text-secondary p-1"
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="2.5" cy="2.5" r="1.5"/><circle cx="7.5" cy="2.5" r="1.5"/>
              <circle cx="2.5" cy="7" r="1.5"/><circle cx="7.5" cy="7" r="1.5"/>
              <circle cx="2.5" cy="11.5" r="1.5"/><circle cx="7.5" cy="11.5" r="1.5"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <LogicBlockEditor
              field={field}
              allFields={fields}
              onChange={patch => updateField(field.id, patch)}
              onRemove={() => removeField(field.id)}
              onMove={() => {}}
              isFirst={false}
              isLast={false}
            />
          </div>
        </div>
      )}

      {/* Regular / Heading blocks */}
      {!isLogic && (
        <div className={`flex items-start gap-1.5 py-1 rounded-xl transition-all ${
          showingSettings ? 'bg-primary/4' :
          (!isHeading && field.type !== 'paragraph' && !field.label.trim()) ? 'ring-1 ring-rose-300 bg-rose-50/40' :
          'hover:bg-surface-elevated/60'
        } ${isHeading ? 'pt-4 pb-1' : ''}`}>

          {/* ── LEFT COLUMN: all controls ── */}
          <div className="flex items-center gap-1 shrink-0 -ml-5">

            {/* ⋮⋮ Drag handle */}
            <div
              {...attributes} {...listeners}
              className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity p-1 text-text-tertiary hover:text-text-secondary"
              title="Drag to reorder"
            >
              <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                <circle cx="2.5" cy="2.5" r="1.5"/><circle cx="7.5" cy="2.5" r="1.5"/>
                <circle cx="2.5" cy="7" r="1.5"/><circle cx="7.5" cy="7" r="1.5"/>
                <circle cx="2.5" cy="11.5" r="1.5"/><circle cx="7.5" cy="11.5" r="1.5"/>
              </svg>
            </div>

            {/* ⋯ Settings */}
            {!isHeading && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (showingSettings) { setSettingsState(null); return; }
                  const rect = (e.target as HTMLElement).closest('button')?.getBoundingClientRect() ?? null;
                  setSettingsState({ blockId: field.id, anchorRect: rect });
                }}
                className={`p-1 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${
                  showingSettings ? 'opacity-100 bg-primary/10 text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-surface-hover'
                }`}
                title="Field settings"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/>
                </svg>
              </button>
            )}

            {/* + Insert below */}
            <button
              onClick={e => {
                e.stopPropagation();
                const newId = addBlock(idx, 'text');
                const rect = (e.target as HTMLElement).closest('button')?.getBoundingClientRect() ?? null;
                setSlashState({ blockId: newId, prefix: '', query: '', anchorRect: rect });
                setTimeout(() => focusBlock(newId), 20);
              }}
              className="p-1 rounded-lg text-text-tertiary hover:text-primary hover:bg-primary/8 transition-colors opacity-0 group-hover:opacity-100"
              title="Insert block below"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>

            {/* 🗑 Delete */}
            <button onClick={() => removeField(field.id)}
              className="p-1 rounded-lg text-text-tertiary hover:text-rose-500 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100"
              title="Delete block"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
            </button>

            {/* Type icon */}
            <button
              onClick={e => {
                e.stopPropagation();
                const rect = (e.target as HTMLElement).closest('button')?.getBoundingClientRect() ?? null;
                setSlashState({ blockId: field.id, prefix: field.label, query: '', anchorRect: rect });
                focusBlock(field.id);
              }}
              className="text-text-tertiary hover:text-primary transition-colors p-0.5 rounded"
              title="Change block type"
            >
              <BlockIcon type={field.type}/>
            </button>
          </div>

          {/* ── RIGHT COLUMN: label + options stacked ── */}
          <div className="flex-1 min-w-0">

            {/* Label row */}
            <div className="flex items-center gap-1 min-w-0">
              <input
                ref={el => { inputRefs.current[field.id] = el; }}
                data-block-input
                value={displayValue}
                onChange={e => handleInputChange(field, idx, e.target.value, inputRefs.current[field.id])}
                onKeyDown={e => handleKeyDown(e, field, idx)}
                onFocus={() => { /* keep settings open */ }}
                placeholder={
                  isHeading ? 'Section heading…' :
                  field.type === 'paragraph' ? 'Body text…' :
                  field.type === 'multiselect' ? 'Checkbox title…' :
                  field.type === 'multidropdown' ? 'Multi-select title…' :
                  field.type === 'yesno' ? 'Yes / No question…' :
                  field.type === 'text' ? 'Text question…' :
                  field.type === 'photo' ? 'Photo caption…' :
                  field.type === 'video' ? 'Video caption…' :
                  field.type === 'dropdown' ? 'Dropdown question…' :
                  'Label…'
                }
                className={`flex-1 bg-transparent outline-none min-w-0 text-text-primary placeholder-text-tertiary/50 ${
                  isHeading ? 'text-sm font-bold uppercase tracking-wider' : 'text-sm'
                }`}
              />
              {/* Badges */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                {!isHeading && field.type !== 'paragraph' && !field.label.trim() && (
                  <span className="text-[9px] font-bold text-rose-400 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                    Title required
                  </span>
                )}
                {field.required && <span className="text-[9px] font-bold text-rose-400">REQ</span>}
                {field.conditionalOn && <span className="text-[9px] font-bold text-amber-500">COND</span>}
              </div>
            </div>

            {/* ── Inline options (multiselect / multidropdown / dropdown) ── */}
            {(field.type === 'multiselect' || field.type === 'dropdown' || field.type === 'multidropdown') && (
              <div className="mt-1 mb-1 space-y-0.5">
                {(field.options?.length ? field.options : ['Option 1']).map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2 group/opt py-0.5">
                    {/* Trash bin — appears on hover, left of the circle/box */}
                    {(field.options?.length ?? 0) > 1 && (
                      <button
                        onClick={() => updateField(field.id, { options: (field.options ?? []).filter((_, i) => i !== oi) })}
                        className="shrink-0 opacity-0 group-hover/opt:opacity-100 p-0.5 text-text-tertiary hover:text-rose-500 transition-all"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    )}
                    {field.type === 'multiselect'
                      ? <div className="shrink-0 w-3.5 h-3.5 rounded border border-border-light bg-white"/>
                      : field.type === 'multidropdown'
                        ? <div className="shrink-0 w-3.5 h-3.5 rounded-sm border border-primary/40 bg-primary/5 flex items-center justify-center">
                            <svg width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="2 4 5 7 8 4"/></svg>
                          </div>
                        : <div className="shrink-0 w-3.5 h-3.5 rounded-full border border-border-light bg-white"/>
                    }
                    <input
                      value={opt}
                      placeholder={`Option ${oi + 1}`}
                      onChange={e => {
                        const opts = field.options?.length ? [...field.options] : ['Option 1'];
                        opts[oi] = e.target.value;
                        updateField(field.id, { options: opts });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          const opts = field.options?.length ? [...field.options] : ['Option 1'];
                          if (oi === opts.length - 1) {
                            opts.push('');
                            updateField(field.id, { options: opts });
                            setTimeout(() => {
                              const inputs = document.querySelectorAll(`[data-opt-field="${field.id}"]`);
                              (inputs[oi + 1] as HTMLInputElement)?.focus();
                            }, 20);
                          } else {
                            const inputs = document.querySelectorAll(`[data-opt-field="${field.id}"]`);
                            (inputs[oi + 1] as HTMLInputElement)?.focus();
                          }
                        }
                        if (e.key === 'Backspace' && opt === '') {
                          e.preventDefault();
                          const opts = (field.options ?? ['Option 1']).filter((_, i) => i !== oi);
                          updateField(field.id, { options: opts.length ? opts : [''] });
                          setTimeout(() => {
                            const inputs = document.querySelectorAll(`[data-opt-field="${field.id}"]`);
                            (inputs[Math.max(0, oi - 1)] as HTMLInputElement)?.focus();
                          }, 20);
                        }
                      }}
                      data-opt-field={field.id}
                      className="flex-1 bg-transparent outline-none text-sm text-text-secondary placeholder-text-tertiary/40 min-w-0"
                    />
                    {/* remove button now on left — see above */}
                  </div>
                ))}
                <button
                  onClick={() => {
                    const opts = field.options?.length ? [...field.options] : ['Option 1'];
                    opts.push('');
                    updateField(field.id, { options: opts });
                    setTimeout(() => {
                      const inputs = document.querySelectorAll(`[data-opt-field="${field.id}"]`);
                      (inputs[opts.length - 1] as HTMLInputElement)?.focus();
                    }, 20);
                  }}
                  className="flex items-center gap-2 mt-1 text-[11px] font-semibold text-text-tertiary/60 hover:text-primary transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add option
                </button>
              </div>
            )}

            {isHeading && <div className="h-px bg-border-light mt-1 mb-2"/>}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── Logic Block Editor ───────────────────────────────────────────────────────
interface LogicBlockEditorProps {
  field: ChecklistField;
  allFields: ChecklistField[];
  onChange: (patch: Partial<ChecklistField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}

function getOperatorsFor(src: ChecklistField | undefined) {
  if (!src) return [{ v: 'is_answered', l: 'is answered' }];
  switch (src.type) {
    case 'yesno':      return [{ v: 'equals', l: 'is' }];
    case 'text':       return [{ v: 'is_answered', l: 'is answered' }, { v: 'is_empty', l: 'is empty' }, { v: 'contains', l: 'contains' }];
    case 'multiselect':
    case 'dropdown':   return [{ v: 'equals', l: 'is' }, { v: 'not_equals', l: 'is not' }, { v: 'contains', l: 'includes' }];
    default:           return [{ v: 'is_answered', l: 'is answered' }, { v: 'is_empty', l: 'is empty' }];
  }
}

function getValueOptions(src: ChecklistField | undefined, op: string): string[] | null {
  if (!src || op === 'is_answered' || op === 'is_empty') return null;
  if (src.type === 'yesno') return ['yes', 'no'];
  if ((src.type === 'multiselect' || src.type === 'multidropdown' || src.type === 'dropdown') && src.options?.length) return src.options;
  return null; // free-text input
}

function LogicBlockEditor({ field, allFields, onChange, onRemove, onMove, isFirst, isLast }: LogicBlockEditorProps) {
  const conditions: LogicCondition[] = field.logicConditions?.length
    ? field.logicConditions
    : [{ fieldId: '', operator: 'equals', value: '' }];
  const logicOperator = field.logicOperator ?? 'and';
  const logicAction   = field.logicAction ?? 'show';
  const logicTargets  = field.logicTargets ?? [];

  const eligibleFields = allFields.filter(f => f.type !== 'logic' && f.type !== 'heading' && f.id !== field.id);

  const updateCond = (idx: number, patch: Partial<LogicCondition>) => {
    const next = conditions.map((c, i) => i === idx ? { ...c, ...patch } : c);
    onChange({ logicConditions: next });
  };
  const addCond = () => onChange({ logicConditions: [...conditions, { fieldId: '', operator: 'equals', value: '' }] });
  const removeCond = (idx: number) => onChange({ logicConditions: conditions.filter((_, i) => i !== idx) });
  const toggleTarget = (id: string) => onChange({
    logicTargets: logicTargets.includes(id) ? logicTargets.filter(t => t !== id) : [...logicTargets, id],
  });

  return (
    <div className="my-1 rounded-2xl border-2 border-violet-200 bg-violet-50/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-100/60 border-b border-violet-200">
        <div className="flex flex-col gap-0 shrink-0">
          <button onClick={() => onMove(-1)} disabled={isFirst} className="p-0.5 text-violet-400 hover:text-violet-700 disabled:opacity-20">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button onClick={() => onMove(1)} disabled={isLast} className="p-0.5 text-violet-400 hover:text-violet-700 disabled:opacity-20">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        <span className="text-sm">⚡</span>
        <span className="text-xs font-bold text-violet-700 uppercase tracking-wider flex-1">Logic</span>
        <button onClick={onRemove} className="p-1 rounded-lg text-violet-400 hover:text-rose-500 hover:bg-rose-50 transition-colors">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* IF conditions */}
        <div className="space-y-2">
          {conditions.map((cond, idx) => {
            const srcField = allFields.find(f => f.id === cond.fieldId);
            const ops = getOperatorsFor(srcField);
            const valOpts = getValueOptions(srcField, cond.operator);
            const needsText = valOpts === null && cond.operator !== 'is_answered' && cond.operator !== 'is_empty';

            return (
              <div key={idx} className="space-y-2">
                {/* AND/OR joiner */}
                {idx > 0 && (
                  <button onClick={() => onChange({ logicOperator: logicOperator === 'and' ? 'or' : 'and' })}
                    className="text-[10px] font-black text-violet-600 uppercase tracking-widest hover:text-violet-800 transition-colors px-1">
                    {logicOperator}
                  </button>
                )}
                {idx === 0 && <span className="text-[10px] font-black text-violet-500 uppercase tracking-widest">If</span>}

                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Field selector */}
                  <select value={cond.fieldId}
                    onChange={e => updateCond(idx, { fieldId: e.target.value, operator: 'equals', value: '' })}
                    className="input-field text-xs py-1 flex-1 min-w-[120px]">
                    <option value="">Select a field…</option>
                    {eligibleFields.map(f => (
                      <option key={f.id} value={f.id}>{f.label || `(${f.type})`}</option>
                    ))}
                  </select>

                  {/* Operator */}
                  {cond.fieldId && (
                    <select value={cond.operator}
                      onChange={e => updateCond(idx, { operator: e.target.value as LogicCondition['operator'], value: '' })}
                      className="input-field text-xs py-1 shrink-0">
                      {ops.map(op => <option key={op.v} value={op.v}>{op.l}</option>)}
                    </select>
                  )}

                  {/* Value — buttons for yes/no and option chips, text input for contains */}
                  {cond.fieldId && valOpts && (
                    <div className="flex gap-1 flex-wrap">
                      {valOpts.map(v => (
                        <button key={v} onClick={() => updateCond(idx, { value: v })}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${cond.value === v ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-text-secondary border-border-light hover:border-violet-400 hover:text-violet-600'}`}>
                          {v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v}
                        </button>
                      ))}
                    </div>
                  )}
                  {cond.fieldId && needsText && (
                    <input value={cond.value ?? ''} onChange={e => updateCond(idx, { value: e.target.value })}
                      placeholder="Value…" className="input-field text-xs py-1 flex-1 min-w-[80px]"/>
                  )}

                  {/* Remove condition */}
                  {conditions.length > 1 && (
                    <button onClick={() => removeCond(idx)} className="p-1 text-text-tertiary hover:text-rose-500 transition-colors shrink-0">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <button onClick={addCond} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800 transition-colors">
            + Add condition
          </button>
        </div>

        {/* THEN action */}
        <div className="pt-1 border-t border-violet-200 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-violet-500 uppercase tracking-widest shrink-0">Then</span>
            <div className="flex rounded-lg border border-border-light overflow-hidden shrink-0">
              {(['show', 'hide'] as const).map(a => (
                <button key={a} onClick={() => onChange({ logicAction: a })}
                  className={`px-3 py-1 text-xs font-bold transition-colors ${logicAction === a ? 'bg-violet-600 text-white' : 'bg-white text-text-secondary hover:bg-violet-50'}`}>
                  {a === 'show' ? 'Show' : 'Hide'}
                </button>
              ))}
            </div>
            <span className="text-xs text-text-tertiary">these blocks:</span>
          </div>

          {/* Target field chips */}
          <div className="flex flex-wrap gap-1.5">
            {eligibleFields.length === 0 && (
              <p className="text-[11px] text-text-tertiary">No other fields to target</p>
            )}
            {eligibleFields.map(f => {
              const selected = logicTargets.includes(f.id);
              return (
                <button key={f.id} onClick={() => toggleTarget(f.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${selected ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-text-secondary border-border-light hover:border-violet-400 hover:text-violet-600'}`}>
                  {f.label || `(${f.type})`}
                </button>
              );
            })}
          </div>

          {logicAction === 'show' && logicTargets.length > 0 && (
            <p className="text-[10px] text-violet-500 flex items-center gap-1">
              <span>ℹ</span> Selected blocks are hidden by default and revealed when conditions are met
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main ChecklistBuilder ────────────────────────────────────────────────────
interface ChecklistBuilderProps {
  sections: ChecklistSection[];
  onChange: (sections: ChecklistSection[]) => void;
  initialName: string;
  initialIsDefault?: boolean;
  mode?: 'client-profile' | 'template';
  saving?: boolean;
  onSave: (name: string, sections: ChecklistSection[], isDefault: boolean) => void;
  onCancel?: () => void;
  onSaveAsNew?: (name: string, sections: ChecklistSection[]) => Promise<void>;
}

export default function ChecklistBuilder({
  sections, onChange, initialName, initialIsDefault = false,
  mode, saving, onSave, onCancel, onSaveAsNew,
}: ChecklistBuilderProps) {
  const [name, setName] = useState(initialName);
  const [isDefault, setIsDefault] = useState(initialIsDefault);

  // Flat field list (single section for DB compat)
  const fields: ChecklistField[] = useMemo(() => sections[0]?.fields ?? [], [sections]);
  const sectionId = useMemo(() => sections[0]?.id ?? uid(), [sections]);

  const setFields = useCallback((next: ChecklistField[]) => {
    onChange([{ id: sectionId, title: '', fields: next }]);
  }, [onChange, sectionId]);

  const updateField = useCallback((id: string, patch: Partial<ChecklistField>) =>
    setFields(fields.map(f => f.id === id ? { ...f, ...patch } : f)), [fields, setFields]);

  const removeField = useCallback((id: string) =>
    setFields(fields.filter(f => f.id !== id)), [fields, setFields]);

  const moveField = useCallback((idx: number, dir: -1 | 1) => {
    const next = [...fields];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setFields(next);
  }, [fields, setFields]);

  // Add new block after a given index (or at end)
  const addBlock = useCallback((afterIdx: number, type: FieldType = 'paragraph') => {
    const newId = uid();
    const next = [...fields];
    next.splice(afterIdx + 1, 0, { id: newId, type, label: '' });
    setFields(next);
    return newId;
  }, [fields, setFields]);

  const yesNoFields = useMemo(() => fields.filter(f => f.type === 'yesno'), [fields]);

  // ── Slash menu state ─────────────────────────────────────────────────────
  const [slashState, setSlashState] = useState<{
    blockId: string;
    prefix: string;       // text before the /
    query: string;        // text after the /
    anchorRect: DOMRect | null;
  } | null>(null);

  // ── Settings popover state ───────────────────────────────────────────────
  const [settingsState, setSettingsState] = useState<{
    blockId: string;
    anchorRect: DOMRect | null;
  } | null>(null);

  // ── Ghost input — persistent "new block" line at the bottom ──────────────
  const [ghostValue, setGhostValue] = useState('');
  const ghostRef = useRef<HTMLInputElement>(null);
  const GHOST_ID = '__ghost__';

  // Per-block input refs — declared here so ghost handlers can reference focusBlock
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusBlock = useCallback((id: string) => {
    setTimeout(() => {
      const el = inputRefs.current[id];
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 30);
  }, []);

  const handleGhostChange = useCallback((value: string, inputEl: HTMLInputElement | null) => {
    // Slash anywhere → open command palette
    if (value.includes('/') && !slashState) {
      const slashIdx = value.lastIndexOf('/');
      const prefix = value.slice(0, slashIdx);
      const rect = inputEl?.getBoundingClientRect() ?? null;
      setSlashState({ blockId: GHOST_ID, prefix, query: value.slice(slashIdx + 1), anchorRect: rect });
      setGhostValue(value);
      return;
    }
    if (slashState?.blockId === GHOST_ID) {
      const slashIdx = value.indexOf('/', slashState.prefix.length);
      if (slashIdx !== -1) {
        setSlashState(s => s ? { ...s, query: value.slice(slashIdx + 1) } : s);
        setGhostValue(value);
        return;
      } else {
        // Slash was deleted — exit slash mode
        setSlashState(null);
      }
    }
    // Normal typing — just update the ghost value
    setGhostValue(value);
  }, [slashState]);

  // handleGhostKeyDown declared below after focusBlock

  // ── Preview modal ────────────────────────────────────────────────────────
  const [showPreview, setShowPreview] = useState(false);
  const [previewResponses, setPreviewResponses] = useState<FieldResponse[]>([]);

  // ── Save-as-new modal ────────────────────────────────────────────────────
  const [showSaveAsNew, setShowSaveAsNew] = useState(false);
  const [saveAsNewName, setSaveAsNewName] = useState('');

  const handleGhostKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (slashState?.blockId === GHOST_ID) return; // slash menu handles keys
    if (e.key === 'Enter') {
      e.preventDefault();
      const label = ghostValue.trim();
      if (!label) return;
      const newId = uid();
      setFields([...fields, { id: newId, type: 'paragraph', label }]);
      setGhostValue('');
      focusBlock(newId);
    }
    if (e.key === 'ArrowUp' && fields.length > 0) {
      e.preventDefault();
      focusBlock(fields[fields.length - 1].id);
    }
  }, [slashState, ghostValue, fields, setFields, focusBlock]);

  // Close slash menu on outside click
  useEffect(() => {
    if (!slashState) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-slash-menu]') && !target.closest('[data-block-input]')) {
        // Restore the label to prefix (discard slash+query)
        updateField(slashState.blockId, { label: slashState.prefix });
        setSlashState(null);
      }
    };
    setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => window.removeEventListener('mousedown', handler);
  }, [slashState, updateField]);

  // ── Handle input change for a block ──────────────────────────────────────
  const handleInputChange = useCallback((field: ChecklistField, idx: number, value: string, inputEl: HTMLInputElement | null) => {
    // Check for slash trigger
    const slashIdx = value.lastIndexOf('/');

    if (slashState?.blockId === field.id) {
      // Already in slash mode for this block — update query
      const prefix = slashState.prefix;
      if (slashIdx >= prefix.length) {
        const query = value.slice(prefix.length + 1); // text after /
        setSlashState(s => s ? { ...s, query } : s);
        // Don't update field label while in slash mode
        return;
      } else {
        // Slash was deleted
        setSlashState(null);
      }
    }

    // New slash detection — trigger on '/' at any position
    if (value.endsWith('/') && !slashState) {
      const prefix = value.slice(0, -1);
      const rect = inputEl?.getBoundingClientRect() ?? null;
      setSlashState({ blockId: field.id, prefix, query: '', anchorRect: rect });
      // Show the slash in the input temporarily (controlled by slashState)
      updateField(field.id, { label: value });
      return;
    }

    updateField(field.id, { label: value });
  }, [slashState, updateField]);

  // selectSlashType — handles both block-level and ghost slash selections
  const selectSlashType = useCallback((type: FieldType) => {
    if (!slashState) return;
    const { blockId, prefix } = slashState;

    if (blockId === GHOST_ID) {
      // Create a brand-new block from the ghost
      const newId = uid();
      setFields([...fields, { id: newId, type, label: prefix }]);
      setGhostValue('');
      setSlashState(null);
      focusBlock(newId);
    } else {
      // Change an existing block's type
      updateField(blockId, { type, label: prefix, options: undefined, conditionalOn: undefined, conditionalValue: undefined });
      setSlashState(null);
      focusBlock(blockId);
    }
  }, [slashState, fields, setFields, updateField, focusBlock]);

  // ── Handle keydown for a block ────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, field: ChecklistField, idx: number) => {
    if (slashState?.blockId === field.id) return; // let slash menu handle keys

    if (e.key === 'Enter') {
      e.preventDefault();
      const newId = addBlock(idx, field.type === 'heading' ? 'paragraph' : field.type);
      focusBlock(newId);
    }

    if (e.key === 'Backspace' && field.label === '') {
      e.preventDefault();
      removeField(field.id);
      // Focus previous block
      const prev = fields[idx - 1];
      if (prev) focusBlock(prev.id);
    }

    if (e.key === 'ArrowUp' && idx > 0) {
      const prev = fields[idx - 1];
      if (prev) { e.preventDefault(); focusBlock(prev.id); }
    }
    if (e.key === 'ArrowDown') {
      // If last block, move to ghost
      if (idx === fields.length - 1) { e.preventDefault(); ghostRef.current?.focus(); return; }
      const next = fields[idx + 1];
      if (next) { e.preventDefault(); focusBlock(next.id); }
    }
  }, [slashState, addBlock, removeField, fields, focusBlock]);

  const unlabeledFields = useMemo(() =>
    fields.filter(f => f.type !== 'heading' && f.type !== 'paragraph' && f.type !== 'logic' && !f.label.trim()),
    [fields]
  );
  const hasUnlabeled = unlabeledFields.length > 0;

  // ── DnD state ──────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId]         = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleSave = () => {
    if (hasUnlabeled) return;
    onSave(name.trim() || 'Untitled', sections, isDefault);
  };
  const handleSaveAsNew = async () => {
    await onSaveAsNew?.(saveAsNewName.trim() || 'Untitled', sections);
    setShowSaveAsNew(false);
    setSaveAsNewName('');
  };

  const activeField = settingsState ? fields.find(f => f.id === settingsState.blockId) : null;

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border-light bg-white">
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Checklist name…"
          className="flex-1 text-sm font-bold text-text-primary placeholder-text-tertiary bg-transparent outline-none min-w-0"/>
        <button onClick={() => { setPreviewResponses([]); setShowPreview(true); }}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border-light text-xs font-semibold text-text-secondary hover:text-primary hover:border-primary hover:bg-primary/5 transition-all">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          Preview
        </button>
        {mode === 'client-profile' && (
          <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
            <button type="button" onClick={() => setIsDefault(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${isDefault ? 'bg-primary' : 'bg-gray-300'}`}>
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
                style={{ left: isDefault ? '18px' : '2px' }}/>
            </button>
            <span className="text-xs font-semibold text-text-secondary whitespace-nowrap">Default</span>
          </label>
        )}
      </div>

      {/* ── Block list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-5 py-4"
        onClick={e => { if (e.target === e.currentTarget) ghostRef.current?.focus(); }}>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
          onDragStart={(e: DragStartEvent) => { setDraggingId(String(e.active.id)); setOverId(String(e.active.id)); }}
          onDragOver={(e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null)}
          onDragEnd={(e: DragEndEvent) => {
            setDraggingId(null);
            setOverId(null);
            const { active, over } = e;
            if (!over || active.id === over.id) return;
            const sec = sections[0];
            const oldIdx = sec.fields.findIndex(f => f.id === active.id);
            const newIdx = sec.fields.findIndex(f => f.id === over.id);
            if (oldIdx === -1 || newIdx === -1) return;
            onChange(sections.map((s, si) =>
              si === 0 ? { ...s, fields: arrayMove(s.fields, oldIdx, newIdx) } : s
            ));
          }}
          onDragCancel={() => { setDraggingId(null); setOverId(null); }}
        >
          <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
            <AnimatePresence initial={false}>
              {fields.map((field, idx) => {
                // Compute whether to show drop line ABOVE this block.
                // Line appears above the over-item when dragging item comes from below,
                // or below the over-item when dragging from above. dnd-kit's
                // arrayMove gives us the destination index = index of over item.
                const draggingIdx = draggingId ? fields.findIndex(f => f.id === draggingId) : -1;
                const overIdx     = overId     ? fields.findIndex(f => f.id === overId)     : -1;
                const showLineAbove = draggingId && overIdx !== -1 && (
                  // line goes above the over item when dragging down into it
                  (draggingIdx < overIdx && field.id === overId) ||
                  // line goes above the over item when dragging up into it (actually below previous)
                  (draggingIdx > overIdx && field.id === overId)
                );

                return (
                  <div key={field.id}>
                    {/* Drop indicator line — shown above the target slot */}
                    {showLineAbove && (
                      <div className="relative h-0.5 mx-2 my-0.5 overflow-visible">
                        <div className="absolute inset-0 bg-primary rounded-full"
                          style={{ boxShadow: '0 0 6px 1px rgba(99,102,241,0.5)' }}/>
                        <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-primary border-2 border-white"
                          style={{ boxShadow: '0 0 4px rgba(99,102,241,0.6)' }}/>
                      </div>
                    )}
                    <SortableBlock
                      field={field}
                      idx={idx}
                      fields={fields}
                      settingsState={settingsState}
                      slashState={slashState}
                      inputRefs={inputRefs}
                      isDragging={draggingId === field.id}
                      updateField={updateField}
                      removeField={removeField}
                      addBlock={addBlock}
                      handleInputChange={handleInputChange}
                      handleKeyDown={handleKeyDown}
                      setSettingsState={setSettingsState}
                      setSlashState={setSlashState}
                      focusBlock={focusBlock}
                    />
                  </div>
                );
              })}
            </AnimatePresence>
          </SortableContext>

          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {draggingId && (() => {
              const f = fields.find(x => x.id === draggingId);
              if (!f) return null;
              return (
                <div className="bg-white border border-primary/30 shadow-xl rounded-xl px-3 py-2 opacity-95">
                  <span className="text-sm font-medium text-text-primary">{f.label || `(${f.type})`}</span>
                </div>
              );
            })()}
          </DragOverlay>
        </DndContext>

        {/* ── Ghost input — always-visible new-block line ──────────────── */}
        <div className="flex items-center gap-1.5 py-1 mt-1 group/ghost">
          {/* Spacer matching the left controls column: -ml-5 + drag + settings + plus + bin + type icon */}
          <div className="flex items-center gap-1 shrink-0 -ml-5 opacity-0 pointer-events-none" aria-hidden>
            <div className="p-1"><svg width="10" height="14" viewBox="0 0 10 14"/></div>{/* drag */}
            <div className="p-1"><svg width="13" height="13" viewBox="0 0 24 24"/></div>{/* settings */}
            <div className="p-1"><svg width="13" height="13" viewBox="0 0 24 24"/></div>{/* + */}
            <div className="p-1"><svg width="13" height="13" viewBox="0 0 24 24"/></div>{/* bin */}
            <div className="p-0.5"><svg width="16" height="16" viewBox="0 0 16 16"/></div>{/* type icon */}
          </div>
          <input
            ref={ghostRef}
            value={slashState?.blockId === GHOST_ID ? (slashState.prefix + '/' + slashState.query) : ghostValue}
            onChange={e => handleGhostChange(e.target.value, ghostRef.current)}
            onKeyDown={handleGhostKeyDown}
            onFocus={() => { /* intentionally blank — don't close settings */ }}
            placeholder="Type / to insert a block…"
            className="flex-1 bg-transparent outline-none text-sm text-text-tertiary placeholder-text-tertiary/40 min-w-0"
          />
        </div>
      </div>

      {/* ── Bottom action bar ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border-light bg-surface-elevated/60">
        {hasUnlabeled && (
          <div className="flex items-center gap-2 px-5 py-2 bg-rose-50 border-b border-rose-100">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-rose-400 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p className="text-[11px] font-semibold text-rose-600">
              {unlabeledFields.length} block{unlabeledFields.length > 1 ? 's are' : ' is'} missing a title — add titles before saving
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 px-5 py-3">
          <button onClick={handleSave} disabled={saving || hasUnlabeled}
            title={hasUnlabeled ? 'Add titles to all blocks before saving' : undefined}
            className="btn-primary text-sm px-5 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
            {saving && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>}
            {saving ? 'Saving…' : 'Save'}
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
        </div> {/* close inner flex div */}
      </div> {/* close outer action bar */}

      {/* ── Slash command menu (portal) ───────────────────────────────────── */}
      <AnimatePresence>
        {slashState && (
          <div data-slash-menu>
            <SlashMenu
              query={slashState.query}
              anchorRect={slashState.anchorRect}
              onSelect={selectSlashType}
              onClose={() => {
                if (slashState.blockId === GHOST_ID) {
                  setGhostValue('');
                } else {
                  updateField(slashState.blockId, { label: slashState.prefix });
                }
                setSlashState(null);
              }}
            />
          </div>
        )}
      </AnimatePresence>

      {/* ── Settings popover ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {settingsState && activeField && (
          <SettingsPopover
            field={activeField}
            yesNoFields={yesNoFields}
            onChange={patch => updateField(settingsState.blockId, patch)}
            onClose={() => setSettingsState(null)}
            anchorRect={settingsState.anchorRect}
          />
        )}
      </AnimatePresence>

      {/* ── Preview modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPreview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowPreview(false); }}>
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
              style={{ height: '85vh' }}>
              <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-border-light bg-slate-50">
                <div>
                  <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Staff Preview</p>
                  <h3 className="text-sm font-bold text-text-primary">{name || 'Untitled Checklist'}</h3>
                </div>
                <button onClick={() => setShowPreview(false)}
                  className="p-2 rounded-xl text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <ChecklistRunner sections={sections} responses={previewResponses} onChange={setPreviewResponses}
                  onSubmit={async () => setShowPreview(false)} orgId="preview" completionId={null} isAdmin={false}/>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Save-as-new modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showSaveAsNew && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
              <h3 className="text-sm font-bold text-text-primary mb-1">Name this checklist</h3>
              <p className="text-xs text-text-secondary mb-4">Saves a copy without changing the original.</p>
              <input autoFocus value={saveAsNewName} onChange={e => setSaveAsNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveAsNew(); if (e.key === 'Escape') setShowSaveAsNew(false); }}
                placeholder="e.g. Deep Clean, End of Lease…" className="input-field text-sm w-full mb-4"/>
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
