'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { generateId } from '@/lib/timeUtils';

interface ChecklistTemplate { id: string; org_id: string; name: string; items: { id: string; text: string }[]; }

export default function ChecklistsPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formItems, setFormItems] = useState<{ id: string; text: string }[]>([]);

  const loadTemplates = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('checklist_templates').select('*').eq('org_id', profile.org_id).order('name');
    if (data) setTemplates(data.map((t: Record<string, unknown>) => ({ ...t, items: (t.items as { id: string; text: string }[]) || [] })) as ChecklistTemplate[]);
    setLoading(false);
  }, [supabase, profile?.org_id]);

  useEffect(() => { if (profile?.org_id) loadTemplates(); }, [profile?.org_id, loadTemplates]);

  const startNew = () => { setEditingId('new'); setFormName(''); setFormItems([{ id: generateId(), text: '' }]); };
  const startEdit = (t: ChecklistTemplate) => { setEditingId(t.id); setFormName(t.name); setFormItems([...t.items]); };
  const addItem = () => setFormItems([...formItems, { id: generateId(), text: '' }]);
  const removeItem = (id: string) => setFormItems(formItems.filter((it) => it.id !== id));
  const updateItemText = (id: string, text: string) => setFormItems(formItems.map((it) => it.id === id ? { ...it, text } : it));

  const handleSave = async () => {
    if (!profile?.org_id || !formName.trim()) return;
    const cleanItems = formItems.filter((it) => it.text.trim());
    if (editingId === 'new') {
      const { data } = await supabase.from('checklist_templates').insert({ org_id: profile.org_id, name: formName, items: cleanItems }).select().single();
      if (data) setTemplates((p) => [...p, { ...data, items: cleanItems }]);
    } else if (editingId) {
      await supabase.from('checklist_templates').update({ name: formName, items: cleanItems }).eq('id', editingId);
      setTemplates((p) => p.map((t) => t.id === editingId ? { ...t, name: formName, items: cleanItems } : t));
    }
    setEditingId(null);
  };

  const handleDuplicate = async (t: ChecklistTemplate) => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('checklist_templates').insert({ org_id: profile.org_id, name: `${t.name} (Copy)`, items: t.items.map((it) => ({ ...it, id: generateId() })) }).select().single();
    if (data) setTemplates((p) => [...p, { ...data, items: (data.items as { id: string; text: string }[]) || [] }]);
  };

  const handleDelete = async (id: string) => {
    await supabase.from('checklist_templates').delete().eq('id', id);
    setTemplates((p) => p.filter((t) => t.id !== id));
  };

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
      <div className="max-w-[700px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div><h2 className="text-lg font-bold text-text-primary">Checklists</h2><p className="text-sm text-text-secondary">{templates.length} templates</p></div>
          <button onClick={startNew} className="btn-primary text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Template
          </button>
        </div>

        <AnimatePresence>
          {editingId && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="card-elevated p-5 space-y-4 overflow-hidden">
              <h3 className="text-sm font-bold text-text-primary">{editingId === 'new' ? 'New Template' : 'Edit Template'}</h3>
              <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className="input-field text-sm" placeholder="Template name (e.g. Standard Clean)" />
              <div className="space-y-2">
                {formItems.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span className="text-xs text-text-tertiary w-6">{i + 1}.</span>
                    <input type="text" value={item.text} onChange={(e) => updateItemText(item.id, e.target.value)}
                      className="input-field text-sm flex-1" placeholder="Checklist item..." />
                    <button onClick={() => removeItem(item.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={addItem} className="btn-ghost text-xs">+ Add item</button>
              <div className="flex gap-2">
                <button onClick={handleSave} className="btn-primary text-sm">Save Template</button>
                <button onClick={() => setEditingId(null)} className="btn-ghost text-sm">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {templates.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="card p-4 group">
              <div className="flex items-start justify-between gap-3">
                <div><h4 className="text-sm font-bold text-text-primary">{t.name}</h4><p className="text-xs text-text-tertiary mt-0.5">{t.items.length} items</p></div>
                <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(t)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                  <button onClick={() => handleDuplicate(t)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary" title="Duplicate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
              </div>
              {t.items.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.items.slice(0, 5).map((item) => (
                    <span key={item.id} className="text-xs bg-surface-elevated px-2 py-1 rounded-md text-text-secondary">{item.text}</span>
                  ))}
                  {t.items.length > 5 && <span className="text-xs text-text-tertiary px-2 py-1">+{t.items.length - 5} more</span>}
                </div>
              )}
            </motion.div>
          ))}
          {templates.length === 0 && <div className="text-center py-12"><p className="text-text-tertiary text-sm">No checklist templates yet.</p></div>}
        </div>
      </div>
    </div>
  );
}
