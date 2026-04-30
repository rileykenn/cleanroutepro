'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { Client } from '@/lib/types';

interface Template {
  id: string;
  name: string;
  label: string;
  week_data: { clients: Client[]; dayStartTime?: string; baseAddress?: unknown };
  created_at: string;
}

interface LoadTemplateModalProps {
  orgId: string | null;
  onLoad: (data: { clients: Client[]; additive: boolean }) => void;
  onClose: () => void;
}

export default function LoadTemplateModal({ orgId, onLoad, onClose }: LoadTemplateModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('schedule_templates')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (data) setTemplates(data);
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleDelete = async (id: string) => {
    await supabase.from('schedule_templates').delete().eq('id', id);
    setTemplates((p) => p.filter((t) => t.id !== id));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="p-5 border-b border-border-light shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">Load Template</h3>
                <p className="text-xs text-text-tertiary">{templates.length} saved templates</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm text-text-tertiary">No templates saved yet.</p>
              <p className="text-xs text-text-tertiary mt-1">Save your current schedule to create a template.</p>
            </div>
          ) : (
            templates.map((t, i) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="card p-4 group"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      {t.label && (
                        <span className="text-xs font-bold bg-primary-light text-primary px-2 py-0.5 rounded-md">{t.label}</span>
                      )}
                      <h4 className="text-sm font-bold text-text-primary">{t.name}</h4>
                    </div>
                    <p className="text-xs text-text-tertiary">
                      {t.week_data?.clients?.length || 0} clients · Created {new Date(t.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <button onClick={() => handleDelete(t.id)}
                    className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger md:opacity-0 md:group-hover:opacity-100 transition-all shrink-0"
                    title="Delete template">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>

                {/* Client preview */}
                {t.week_data?.clients && t.week_data.clients.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {t.week_data.clients.slice(0, 4).map((c: Client, j: number) => (
                      <span key={j} className="text-[11px] bg-surface-elevated px-2 py-0.5 rounded-md text-text-secondary">{c.name}</span>
                    ))}
                    {t.week_data.clients.length > 4 && (
                      <span className="text-[11px] text-text-tertiary px-1">+{t.week_data.clients.length - 4} more</span>
                    )}
                  </div>
                )}

                <button
                  onClick={() => onLoad({ clients: t.week_data?.clients || [], additive: true })}
                  className="btn-primary w-full text-sm py-2"
                >
                  Add to Schedule
                </button>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
