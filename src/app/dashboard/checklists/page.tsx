'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import {
  FormField, FormFieldType, FormFieldConditional,
  RichChecklistTemplate, RichChecklistCompletion,
  FieldAnswer, normaliseField, AnyFormField,
} from '@/lib/types';

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Field type config ────────────────────────────────────────────────────────
const FIELD_TYPES: { type: FormFieldType; label: string; icon: string; description: string }[] = [
  { type: 'section_heading', label: 'Section Heading', icon: '🏷️', description: 'A divider/title for grouping fields' },
  { type: 'text',            label: 'Text Input',      icon: '✏️', description: 'Free text or notes' },
  { type: 'yes_no',          label: 'Yes / No',        icon: '✅', description: 'Toggle — Yes or No' },
  { type: 'dropdown',        label: 'Dropdown',         icon: '📋', description: 'Single selection from a list' },
  { type: 'multi_select',    label: 'Multi Select',     icon: '☑️', description: 'Tick multiple options' },
  { type: 'date',            label: 'Date',             icon: '📅', description: 'Date picker' },
  { type: 'time',            label: 'Time',             icon: '🕐', description: 'Time picker' },
  { type: 'image',           label: 'Photo Upload',     icon: '📷', description: 'Staff attaches a photo' },
  { type: 'video',           label: 'Video Upload',     icon: '🎥', description: 'Staff attaches a video' },
];

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = Object.fromEntries(
  FIELD_TYPES.map(f => [f.type, f.label])
) as Record<FormFieldType, string>;

// ─── History answer renderer ───────────────────────────────────────────────────
function renderAnswerValue(answer: FieldAnswer, field?: FormField): string {
  if (answer.na) return 'N/A';
  if (answer.value === null || answer.value === undefined || answer.value === '') return '—';
  if (typeof answer.value === 'boolean') return answer.value ? 'Yes' : 'No';
  if (Array.isArray(answer.value)) return answer.value.join(', ') || '—';
  if (field?.type === 'yes_no') return answer.value === 'yes' ? 'Yes' : answer.value === 'no' ? 'No' : String(answer.value);
  return String(answer.value);
}

// ─── Field Editor Component ───────────────────────────────────────────────────
function FieldEditor({
  field,
  index,
  total,
  allFields,
  onChange,
  onDelete,
  onMove,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  field: FormField;
  index: number;
  total: number;
  allFields: FormField[];
  onChange: (updated: FormField) => void;
  onDelete: () => void;
  onMove: (from: number, to: number) => void;
  dragging: number | null;
  dragOver: number | null;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onDragEnd: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDragging = dragging === index;
  const isOver = dragOver === index && dragging !== null && dragging !== index;

  const update = (patch: Partial<FormField>) => onChange({ ...field, ...patch });

  const yesNoFields = allFields.filter(f => f.type === 'yes_no' && f.id !== field.id);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={e => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
      className={`rounded-xl border transition-all ${
        isDragging ? 'opacity-40 scale-[0.98]' : 'opacity-100'
      } ${isOver ? 'border-primary ring-2 ring-primary/20' : 'border-border-light'} bg-white`}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none" onClick={() => setExpanded(e => !e)}>
        {/* Drag handle */}
        <div className="text-text-tertiary cursor-grab active:cursor-grabbing mr-1 shrink-0" onClick={e => e.stopPropagation()}>
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>
            <circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/>
            <circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="13" r="1.5"/>
          </svg>
        </div>

        {/* Field type badge */}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
          field.type === 'section_heading' ? 'bg-amber-100 text-amber-700' :
          field.type === 'yes_no' ? 'bg-emerald-50 text-emerald-700' :
          field.type === 'text' ? 'bg-blue-50 text-blue-700' :
          'bg-primary-light text-primary'
        }`}>
          {FIELD_TYPE_LABELS[field.type]}
        </span>

        <p className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">
          {field.label || <span className="text-text-tertiary italic">Untitled</span>}
        </p>

        <div className="flex items-center gap-1 shrink-0">
          {field.required && (
            <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium">Required</span>
          )}
          {field.conditional && (
            <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded font-medium">Conditional</span>
          )}
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger ml-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`text-text-tertiary transition-transform ${expanded ? '' : '-rotate-90'}`}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      {/* Expanded config */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border-light">
            <div className="px-4 py-4 space-y-3">

              {/* Label */}
              {field.type !== 'section_heading' ? (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Question / Label *</label>
                  <input type="text" value={field.label} onChange={e => update({ label: e.target.value })}
                    className="input-field text-sm" placeholder="e.g. Are there ceiling fans?" />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Section Title</label>
                  <input type="text" value={field.label} onChange={e => update({ label: e.target.value })}
                    className="input-field text-sm font-semibold" placeholder="e.g. Bathroom" />
                </div>
              )}

              {/* Description */}
              {field.type !== 'section_heading' && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Description (optional)</label>
                  <input type="text" value={field.description || ''} onChange={e => update({ description: e.target.value })}
                    className="input-field text-sm" placeholder="Extra instruction for staff..." />
                </div>
              )}

              {/* Options for dropdown/multi_select */}
              {(field.type === 'dropdown' || field.type === 'multi_select') && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Options</label>
                  <div className="space-y-1.5">
                    {(field.options || []).map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input type="text" value={opt}
                          onChange={e => {
                            const opts = [...(field.options || [])];
                            opts[oi] = e.target.value;
                            update({ options: opts });
                          }}
                          className="input-field text-sm flex-1" placeholder={`Option ${oi + 1}`} />
                        <button onClick={() => {
                          const opts = (field.options || []).filter((_, i) => i !== oi);
                          update({ options: opts });
                        }} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger shrink-0">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button onClick={() => update({ options: [...(field.options || []), ''] })}
                      className="btn-ghost text-xs py-1.5">
                      + Add option
                    </button>
                  </div>
                </div>
              )}

              {/* Required + Conditional (not for section headings) */}
              {field.type !== 'section_heading' && (
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  {/* Required toggle */}
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <button
                      role="switch" aria-checked={field.required}
                      onClick={() => update({ required: !field.required })}
                      className={`relative w-9 h-5 rounded-full transition-colors ${field.required ? 'bg-primary' : 'bg-border'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${field.required ? 'translate-x-4' : ''}`} />
                    </button>
                    <span className="text-xs font-medium text-text-secondary">Required</span>
                  </label>

                  {/* Conditional (only when a yes_no parent exists) */}
                  {yesNoFields.length > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <button
                        role="switch" aria-checked={!!field.conditional}
                        onClick={() => update({ conditional: field.conditional ? undefined : { parentId: yesNoFields[0].id, showWhen: 'yes' } })}
                        className={`relative w-9 h-5 rounded-full transition-colors ${field.conditional ? 'bg-purple-500' : 'bg-border'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${field.conditional ? 'translate-x-4' : ''}`} />
                      </button>
                      <span className="text-xs font-medium text-text-secondary">Conditional</span>
                    </label>
                  )}
                </div>
              )}

              {/* Conditional config */}
              {field.conditional && yesNoFields.length > 0 && (
                <div className="bg-purple-50 border border-purple-100 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-purple-700">Show this field only when:</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={field.conditional.parentId}
                      onChange={e => update({ conditional: { ...field.conditional as FormFieldConditional, parentId: e.target.value } })}
                      className="input-field text-xs py-1.5 flex-1 min-w-0">
                      {yesNoFields.map(yf => (
                        <option key={yf.id} value={yf.id}>{yf.label || 'Untitled Yes/No'}</option>
                      ))}
                    </select>
                    <span className="text-xs text-purple-600 shrink-0">is answered</span>
                    <select value={field.conditional.showWhen}
                      onChange={e => update({ conditional: { ...field.conditional as FormFieldConditional, showWhen: e.target.value as 'yes' | 'no' } })}
                      className="input-field text-xs py-1.5 w-20 shrink-0">
                      <option value="yes">YES</option>
                      <option value="no">NO</option>
                    </select>
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Field Type Picker ────────────────────────────────────────────────────────
function FieldTypePicker({ onPick, onClose }: { onPick: (type: FormFieldType) => void; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden border border-border-light">
        <div className="p-4 border-b border-border-light flex items-center justify-between">
          <h3 className="text-sm font-bold text-text-primary">Add Field</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="p-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {FIELD_TYPES.map(ft => (
            <button key={ft.type} onClick={() => onPick(ft.type)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-elevated text-left transition-colors">
              <span className="text-xl w-8 text-center shrink-0">{ft.icon}</span>
              <div>
                <p className="text-sm font-medium text-text-primary">{ft.label}</p>
                <p className="text-xs text-text-tertiary">{ft.description}</p>
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ChecklistsPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [templates, setTemplates] = useState<RichChecklistTemplate[]>([]);
  const [completions, setCompletions] = useState<RichChecklistCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'templates' | 'history'>('templates');
  const [expandedCompletion, setExpandedCompletion] = useState<string | null>(null);

  // Builder state
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [formName, setFormName] = useState('');
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Drag state
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('checklist_templates').select('*').eq('org_id', profile.org_id).order('name');
    if (data) {
      setTemplates(data.map((t: Record<string, unknown>) => ({
        ...t,
        items: ((t.items as AnyFormField[]) || []).map(normaliseField),
      })) as RichChecklistTemplate[]);
    }
    setLoading(false);
  }, [supabase, profile?.org_id]);

  const loadCompletions = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase
      .from('checklist_completions').select('*').eq('org_id', profile.org_id)
      .order('completed_at', { ascending: false }).limit(50);
    if (!data) return;

    const clientIds = [...new Set(data.map((c: RichChecklistCompletion) => c.client_id))];
    const templateIds = [...new Set(data.map((c: RichChecklistCompletion) => c.checklist_template_id))];
    const userIds = [...new Set(data.map((c: RichChecklistCompletion) => c.completed_by).filter(Boolean))];

    const [clientsRes, templatesRes, profilesRes] = await Promise.all([
      clientIds.length > 0 ? supabase.from('clients').select('id, name').in('id', clientIds) : { data: [] },
      templateIds.length > 0 ? supabase.from('checklist_templates').select('id, name').in('id', templateIds) : { data: [] },
      userIds.length > 0 ? supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] },
    ]);

    const clientMap = new Map((clientsRes.data || []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const templateMap = new Map((templatesRes.data || []).map((t: { id: string; name: string }) => [t.id, t.name]));
    const profileMap = new Map((profilesRes.data || []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));

    setCompletions(data.map((c: Record<string, unknown>) => {
      let items: FieldAnswer[] = [];
      try {
        const raw = c.items;
        if (typeof raw === 'string') items = JSON.parse(raw);
        else if (Array.isArray(raw)) items = raw as FieldAnswer[];
      } catch { /* ignore */ }
      return {
        ...c,
        items,
        media_urls: (c.media_urls as Record<string, string[]>) || {},
        clientName: clientMap.get(c.client_id as string) || 'Unknown Client',
        templateName: templateMap.get(c.checklist_template_id as string) || 'Unknown Template',
        completedByName: profileMap.get(c.completed_by as string) || 'Unknown User',
      };
    }) as RichChecklistCompletion[]);
  }, [supabase, profile?.org_id]);

  useEffect(() => {
    if (profile?.org_id) { loadTemplates(); loadCompletions(); }
  }, [profile?.org_id, loadTemplates, loadCompletions]);

  // ── Builder actions ────────────────────────────────────────────────────────
  const startNew = () => {
    setEditing('new');
    setFormName('');
    setFormFields([]);
  };

  const startEdit = (t: RichChecklistTemplate) => {
    setEditing(t.id);
    setFormName(t.name);
    setFormFields([...t.items]);
  };

  const addField = (type: FormFieldType) => {
    const defaults: Partial<FormField> = {};
    if (type === 'dropdown' || type === 'multi_select') defaults.options = [''];
    setFormFields(prev => [...prev, { id: generateId(), type, label: '', ...defaults }]);
    setShowFieldPicker(false);
  };

  const updateField = (index: number, updated: FormField) => {
    setFormFields(prev => prev.map((f, i) => i === index ? updated : f));
  };

  const deleteField = (index: number) => {
    setFormFields(prev => prev.filter((_, i) => i !== index));
  };

  const moveField = (from: number, to: number) => {
    setFormFields(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  };

  const handleDragEnd = () => {
    if (dragging !== null && dragOver !== null && dragging !== dragOver) {
      moveField(dragging, dragOver);
    }
    setDragging(null);
    setDragOver(null);
  };

  const handleSave = async () => {
    if (!profile?.org_id || !formName.trim()) return;
    setSaving(true);
    const cleanFields = formFields.map(f => ({
      ...f,
      options: f.options?.filter(o => o.trim()) || undefined,
    }));

    if (editing === 'new') {
      const { data } = await supabase.from('checklist_templates')
        .insert({ org_id: profile.org_id, name: formName, items: cleanFields }).select().single();
      if (data) setTemplates(prev => [...prev, { ...data, items: cleanFields }].sort((a, b) => a.name.localeCompare(b.name)));
    } else if (editing) {
      await supabase.from('checklist_templates').update({ name: formName, items: cleanFields }).eq('id', editing);
      setTemplates(prev => prev.map(t => t.id === editing ? { ...t, name: formName, items: cleanFields } : t));
    }
    setSaving(false);
    setEditing(null);
  };

  const handleDuplicate = async (t: RichChecklistTemplate) => {
    if (!profile?.org_id) return;
    const newItems = t.items.map(f => ({ ...f, id: generateId() }));
    const { data } = await supabase.from('checklist_templates')
      .insert({ org_id: profile.org_id, name: `${t.name} (Copy)`, items: newItems }).select().single();
    if (data) setTemplates(prev => [...prev, { ...data, items: newItems }].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const handleDelete = async (id: string) => {
    await supabase.from('checklist_templates').delete().eq('id', id);
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-6 space-y-3">
      {[1, 2, 3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}
    </div>
  );

  // Full-screen builder mode
  if (editing !== null) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Builder header */}
        <div className="shrink-0 px-4 py-3 border-b border-border-light bg-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="Template name (e.g. Standard Clean)"
              className="input-field text-sm font-semibold min-w-0 flex-1"
            />
          </div>
          <button onClick={handleSave} disabled={saving || !formName.trim()}
            className="btn-primary text-sm shrink-0 disabled:opacity-40">
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>

        {/* Field list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 lg:p-6">
          <div className="max-w-[680px] mx-auto space-y-2">
            {formFields.length === 0 && (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">📋</div>
                <p className="text-text-secondary text-sm font-medium">No fields yet</p>
                <p className="text-text-tertiary text-xs mt-1">Click &quot;Add Field&quot; to start building your form</p>
              </div>
            )}

            {formFields.map((field, i) => (
              <FieldEditor
                key={field.id}
                field={field}
                index={i}
                total={formFields.length}
                allFields={formFields}
                onChange={updated => updateField(i, updated)}
                onDelete={() => deleteField(i)}
                onMove={moveField}
                dragging={dragging}
                dragOver={dragOver}
                onDragStart={setDragging}
                onDragOver={setDragOver}
                onDragEnd={handleDragEnd}
              />
            ))}

            {/* Add field button */}
            <button onClick={() => setShowFieldPicker(true)}
              className="w-full py-3 rounded-xl border-2 border-dashed border-border hover:border-primary text-text-tertiary hover:text-primary text-sm font-medium transition-all flex items-center justify-center gap-2 mt-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Field
            </button>
          </div>
        </div>

        {/* Field type picker modal */}
        <AnimatePresence>
          {showFieldPicker && (
            <FieldTypePicker onPick={addField} onClose={() => setShowFieldPicker(false)} />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
      <div className="max-w-[700px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Checklists</h2>
            <p className="text-sm text-text-secondary">{templates.length} template{templates.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={startNew} className="btn-primary text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Template
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-surface-elevated rounded-xl p-1">
          {(['templates', 'history'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 text-sm font-medium py-2 rounded-lg transition-all capitalize ${
                activeTab === tab ? 'bg-white shadow-card text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
              }`}>
              {tab === 'templates' ? `Templates (${templates.length})` : `History (${completions.length})`}
            </button>
          ))}
        </div>

        {/* ── Templates Tab ─────────────────────────────────────────────── */}
        {activeTab === 'templates' && (
          <div className="space-y-2">
            {templates.map((t, i) => {
              const nonHeadings = t.items.filter(f => f.type !== 'section_heading');
              const typeCounts = FIELD_TYPES.filter(ft => ft.type !== 'section_heading')
                .map(ft => ({ ...ft, count: nonHeadings.filter(f => f.type === ft.type).length }))
                .filter(ft => ft.count > 0);

              return (
                <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }} className="card p-4 group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-text-primary">{t.name}</h4>
                      <p className="text-xs text-text-tertiary mt-0.5">{t.items.length} field{t.items.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => startEdit(t)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button onClick={() => handleDuplicate(t)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary" title="Duplicate">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger" title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Field type chips */}
                  {typeCounts.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {typeCounts.map(ft => (
                        <span key={ft.type} className="text-[10px] bg-surface-elevated px-2 py-1 rounded-md text-text-secondary font-medium">
                          {ft.icon} {ft.label}{ft.count > 1 ? ` ×${ft.count}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}

            {templates.length === 0 && (
              <div className="text-center py-16">
                <div className="text-5xl mb-4">📋</div>
                <p className="text-text-tertiary text-sm">No checklist templates yet.</p>
                <p className="text-text-tertiary text-xs mt-1">Create one to get started.</p>
              </div>
            )}
          </div>
        )}

        {/* ── History Tab ───────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="space-y-2">
            {completions.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">📊</div>
                <p className="text-sm text-text-tertiary">No completed checklists yet.</p>
                <p className="text-xs text-text-tertiary mt-1">Completions will appear here as staff submit forms onsite.</p>
              </div>
            ) : (
              completions.map((c, i) => {
                const template = templates.find(t => t.id === c.checklist_template_id);
                const answered = c.items.filter(a => a.value !== null && a.value !== '' && !a.na).length;
                const total = c.items.length;
                const mediaCount = Object.values(c.media_urls || {}).flat().length;
                const isExpanded = expandedCompletion === c.id;

                return (
                  <motion.div key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }} className="card overflow-hidden">
                    <button onClick={() => setExpandedCompletion(isExpanded ? null : c.id)}
                      className="w-full text-left p-4 hover:bg-surface-elevated/50 transition-colors">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-text-primary truncate">{c.clientName}</h4>
                          <p className="text-xs text-text-tertiary">{c.templateName} · {c.completedByName}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-text-secondary">
                            {new Date(c.completed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                          <p className="text-[11px] text-text-tertiary">
                            {new Date(c.completed_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <p className="text-[11px] text-text-tertiary">{answered}/{total} answered</p>
                        {mediaCount > 0 && (
                          <p className="text-[11px] text-primary">📎 {mediaCount} file{mediaCount !== 1 ? 's' : ''}</p>
                        )}
                      </div>
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border-light">
                          <div className="p-4 space-y-3">
                            {c.items.map(answer => {
                              const field = template?.items.find(f => f.id === answer.fieldId);
                              const label = field?.label || answer.fieldId;
                              if (field?.type === 'section_heading') return null;
                              return (
                                <div key={answer.fieldId} className="flex items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-text-tertiary">{label}</p>
                                    <p className={`text-sm font-medium ${answer.na ? 'text-text-tertiary italic' : 'text-text-primary'}`}>
                                      {renderAnswerValue(answer, field)}
                                    </p>
                                  </div>
                                  {/* Media thumbnails */}
                                  {(c.media_urls?.[answer.fieldId] || []).length > 0 && (
                                    <div className="flex gap-1 shrink-0">
                                      {(c.media_urls[answer.fieldId] || []).map((url, ui) => (
                                        <a key={ui} href={url} target="_blank" rel="noopener noreferrer"
                                          className="w-10 h-10 rounded-lg overflow-hidden border border-border-light bg-surface-elevated flex items-center justify-center">
                                          <img src={url} alt="" className="w-full h-full object-cover" onError={e => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                          }} />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {c.notes && (
                              <div className="pt-2 border-t border-border-light">
                                <p className="text-xs text-text-tertiary mb-0.5">Notes</p>
                                <p className="text-sm text-text-secondary">{c.notes}</p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}
          </div>
        )}

      </div>
    </div>
  );
}
