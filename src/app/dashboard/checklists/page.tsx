'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { generateId } from '@/lib/timeUtils';

interface ChecklistTemplate { id: string; org_id: string; name: string; items: { id: string; text: string }[]; }
interface ChecklistCompletion {
  id: string; client_id: string; checklist_template_id: string;
  items: string; notes: string; completed_by: string; completed_at: string;
  clientName?: string; templateName?: string; completedByName?: string;
}

export default function ChecklistsPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [completions, setCompletions] = useState<ChecklistCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formItems, setFormItems] = useState<{ id: string; text: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'templates' | 'history'>('templates');
  const [expandedCompletion, setExpandedCompletion] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('checklist_templates').select('*').eq('org_id', profile.org_id).order('name');
    if (data) setTemplates(data.map((t: Record<string, unknown>) => ({ ...t, items: (t.items as { id: string; text: string }[]) || [] })) as ChecklistTemplate[]);
    setLoading(false);
  }, [supabase, profile?.org_id]);

  const loadCompletions = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase
      .from('checklist_completions')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('completed_at', { ascending: false })
      .limit(50);

    if (!data) return;

    // Enrich with client names, template names, and user names
    const clientIds = [...new Set(data.map((c: ChecklistCompletion) => c.client_id))];
    const templateIds = [...new Set(data.map((c: ChecklistCompletion) => c.checklist_template_id))];
    const userIds = [...new Set(data.map((c: ChecklistCompletion) => c.completed_by).filter(Boolean))];

    const [clientsRes, templatesRes, profilesRes] = await Promise.all([
      clientIds.length > 0 ? supabase.from('clients').select('id, name').in('id', clientIds) : { data: [] },
      templateIds.length > 0 ? supabase.from('checklist_templates').select('id, name').in('id', templateIds) : { data: [] },
      userIds.length > 0 ? supabase.from('profiles').select('id, full_name').in('id', userIds) : { data: [] },
    ]);

    const clientMap = new Map((clientsRes.data || []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const templateMap = new Map((templatesRes.data || []).map((t: { id: string; name: string }) => [t.id, t.name]));
    const profileMap = new Map((profilesRes.data || []).map((p: { id: string; full_name: string }) => [p.id, p.full_name]));

    setCompletions(data.map((c: ChecklistCompletion) => ({
      ...c,
      clientName: clientMap.get(c.client_id) || 'Unknown Client',
      templateName: templateMap.get(c.checklist_template_id) || 'Unknown Template',
      completedByName: profileMap.get(c.completed_by) || 'Unknown User',
    })));
  }, [supabase, profile?.org_id]);

  useEffect(() => { if (profile?.org_id) { loadTemplates(); loadCompletions(); } }, [profile?.org_id, loadTemplates, loadCompletions]);

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

  const parseCompletionItems = (itemsStr: string): { id: string; text: string; completed: boolean }[] => {
    try { return JSON.parse(itemsStr); } catch { return []; }
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

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-surface-elevated rounded-xl p-1">
          <button
            onClick={() => setActiveTab('templates')}
            className={`flex-1 text-sm font-medium py-2 rounded-lg transition-all ${activeTab === 'templates' ? 'bg-white shadow-card text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
          >
            Templates ({templates.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 text-sm font-medium py-2 rounded-lg transition-all ${activeTab === 'history' ? 'bg-white shadow-card text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
          >
            History ({completions.length})
          </button>
        </div>

        {/* Template Editor */}
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

        {/* Templates Tab */}
        {activeTab === 'templates' && (
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
        )}

        {/* Completion History Tab */}
        {activeTab === 'history' && (
          <div className="space-y-2">
            {completions.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">📊</div>
                <p className="text-sm text-text-tertiary">No completed checklists yet.</p>
                <p className="text-xs text-text-tertiary mt-1">Completions will appear here as staff mark checklists done.</p>
              </div>
            ) : (
              completions.map((c, i) => {
                const parsedItems = parseCompletionItems(c.items);
                const completedCount = parsedItems.filter((it) => it.completed).length;
                const totalCount = parsedItems.length;
                const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
                const isExpanded = expandedCompletion === c.id;

                return (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="card overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedCompletion(isExpanded ? null : c.id)}
                      className="w-full text-left p-4 hover:bg-surface-elevated/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                            pct === 100 ? 'bg-success-light text-success' : 'bg-warning-light text-warning'
                          }`}>
                            {pct}%
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-text-primary truncate">{c.clientName}</h4>
                            <p className="text-xs text-text-tertiary">{c.templateName}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-text-secondary">{new Date(c.completed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                          <p className="text-[11px] text-text-tertiary">{c.completedByName}</p>
                        </div>
                      </div>
                      <div className="w-full bg-surface-elevated rounded-full h-1.5 overflow-hidden">
                        <div className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-warning'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[11px] text-text-tertiary mt-1">{completedCount}/{totalCount} items · {new Date(c.completed_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</p>
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-border-light"
                        >
                          <div className="p-4 space-y-1.5">
                            {parsedItems.map((item) => (
                              <div key={item.id} className="flex items-center gap-2 text-sm">
                                <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                                  item.completed ? 'bg-success text-white' : 'border border-border'
                                }`}>
                                  {item.completed && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                                </div>
                                <span className={item.completed ? 'text-text-secondary line-through' : 'text-text-primary'}>{item.text}</span>
                              </div>
                            ))}
                            {c.notes && (
                              <div className="mt-3 pt-3 border-t border-border-light">
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
