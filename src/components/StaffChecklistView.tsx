'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

interface ChecklistItem { id: string; text: string; completed: boolean; }

interface StaffChecklistViewProps { clientId: string; clientName: string; onClose: () => void; }

export default function StaffChecklistView({ clientId, clientName, onClose }: StaffChecklistViewProps) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [notes, setNotes] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadChecklist = useCallback(async () => {
    // Load the client's checklist template
    const { data: client } = await supabase.from('clients').select('checklist_template_id').eq('id', clientId).single();
    if (!client?.checklist_template_id) { setLoading(false); return; }
    setTemplateId(client.checklist_template_id);
    const { data: tmpl } = await supabase.from('checklist_templates').select('items').eq('id', client.checklist_template_id).single();
    if (tmpl?.items) {
      const templateItems = (tmpl.items as { id: string; text: string }[]).map((it) => ({ ...it, completed: false }));
      setItems(templateItems);
    }
    setLoading(false);
  }, [supabase, clientId]);

  useEffect(() => { loadChecklist(); }, [loadChecklist]);

  const toggleItem = (id: string) => { setItems((prev) => prev.map((it) => it.id === id ? { ...it, completed: !it.completed } : it)); };
  const completedCount = items.filter((it) => it.completed).length;
  const progress = items.length > 0 ? (completedCount / items.length) * 100 : 0;

  const handleSave = async () => {
    if (!templateId) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user!.id).single();
    await supabase.from('checklist_completions').insert({
      org_id: profile!.org_id, client_id: clientId, checklist_template_id: templateId,
      items: JSON.stringify(items), notes, completed_by: user!.id, completed_at: new Date().toISOString(),
    });
    setSaving(false); onClose();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4 sm:p-0" onClick={onClose}>
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-border-light shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-text-primary">{clientName}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="w-full bg-surface-elevated rounded-full h-2 overflow-hidden">
            <motion.div animate={{ width: `${progress}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="h-full bg-success rounded-full" />
          </div>
          <p className="text-xs text-text-tertiary mt-1.5">{completedCount} of {items.length} complete</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2 custom-scrollbar">
          {loading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="shimmer h-12 rounded-lg" />)}</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-text-tertiary text-sm">No checklist template assigned to this client.</p>
              <p className="text-text-tertiary text-xs mt-1">Assign one from the Clients page.</p>
            </div>
          ) : items.map((item) => (
            <button key={item.id} onClick={() => toggleItem(item.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${item.completed ? 'bg-success-light border-emerald-200' : 'bg-white border-border-light hover:border-border'}`}>
              <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${item.completed ? 'bg-success border-success text-white' : 'border-border'}`}>
                {item.completed && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <span className={`text-sm ${item.completed ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{item.text}</span>
            </button>
          ))}
        </div>

        {items.length > 0 && (
          <div className="p-5 border-t border-border-light shrink-0 space-y-3">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes..."
              className="input-field text-sm resize-none" rows={2} />
            <button onClick={handleSave} disabled={saving} className="btn-primary w-full py-3 disabled:opacity-50">
              {saving ? 'Saving...' : progress === 100 ? '✓ Mark Complete' : 'Save Progress'}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
