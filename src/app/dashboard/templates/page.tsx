'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

interface Template { id: string; name: string; label: string; week_data: Record<string, unknown>; created_at: string; }

export default function TemplatesPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    if (!profile?.org_id) return;
    const { data } = await supabase.from('schedule_templates').select('*').eq('org_id', profile.org_id).order('created_at', { ascending: false });
    if (data) setTemplates(data);
    setLoading(false);
  }, [supabase, profile?.org_id]);

  useEffect(() => { if (profile?.org_id) loadTemplates(); }, [profile?.org_id, loadTemplates]);

  const handleDelete = async (id: string) => {
    await supabase.from('schedule_templates').delete().eq('id', id);
    setTemplates((p) => p.filter((t) => t.id !== id));
  };

  const labels = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>;

  return (
    <div className="h-full overflow-y-auto p-4 lg:p-6 custom-scrollbar">
      <div className="max-w-[700px] mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Schedule Templates</h2>
          <p className="text-sm text-text-secondary mt-1">Save and load recurring weekly schedules. Use labels (A1, B2, etc.) for 4-week rotation patterns.</p>
        </div>

        {templates.length === 0 ? (
          <div className="card-elevated p-8 text-center">
            <div className="text-4xl mb-3">📋</div>
            <h3 className="text-base font-bold text-text-primary mb-1">No templates yet</h3>
            <p className="text-sm text-text-secondary">Save your current schedule from the Schedule page to create a template.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {templates.map((t, i) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="card p-4 group">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {t.label && <span className="text-xs font-bold bg-primary-light text-primary px-2 py-0.5 rounded-md">{t.label}</span>}
                      <h4 className="text-sm font-bold text-text-primary">{t.name}</h4>
                    </div>
                    <p className="text-xs text-text-tertiary">Created {new Date(t.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger md:opacity-0 md:group-hover:opacity-100 transition-all">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        <div className="card-elevated p-5">
          <h3 className="text-sm font-bold text-text-primary mb-2">Rotation Labels</h3>
          <div className="flex flex-wrap gap-2">
            {labels.map((l) => <span key={l} className="text-xs bg-surface-elevated px-3 py-1.5 rounded-lg text-text-secondary font-medium">{l}</span>)}
          </div>
          <p className="text-xs text-text-tertiary mt-2">Use these labels to create a 4-week rotation pattern across your teams.</p>
        </div>
      </div>
    </div>
  );
}
