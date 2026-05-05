'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { Client } from '@/lib/types';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface TeamTemplateData {
  teamName: string;
  teamId: string;
  dayStartTime?: string;
  baseAddress?: unknown;
  clients: Client[];
}

interface WeekTemplateData {
  [dayIndex: string]: TeamTemplateData[];
}

// Legacy format (old single-day template)
interface LegacyTemplateData {
  clients: Client[];
  dayStartTime?: string;
  baseAddress?: unknown;
}

interface Template {
  id: string;
  name: string;
  label: string;
  week_data: WeekTemplateData | LegacyTemplateData;
  created_at: string;
}

interface LoadTemplateModalProps {
  orgId: string | null;
  onLoadWeek: (weekData: WeekTemplateData) => void;
  onClose: () => void;
}

function isLegacyTemplate(data: WeekTemplateData | LegacyTemplateData): data is LegacyTemplateData {
  return 'clients' in data && Array.isArray((data as LegacyTemplateData).clients);
}

export default function LoadTemplateModal({ orgId, onLoadWeek, onClose }: LoadTemplateModalProps) {
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

  const getTemplatePreview = (t: Template): { totalJobs: number; dayPreviews: { dayLabel: string; jobCount: number; teamColors: string[] }[] } => {
    const data = t.week_data;

    // Legacy: single-day template → treat as Monday
    if (isLegacyTemplate(data)) {
      const count = data.clients?.length || 0;
      return {
        totalJobs: count,
        dayPreviews: count > 0 ? [{ dayLabel: 'Mon', jobCount: count, teamColors: [] }] : [],
      };
    }

    let totalJobs = 0;
    const dayPreviews: { dayLabel: string; jobCount: number; teamColors: string[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const dayTeams = data[String(i)];
      if (dayTeams && dayTeams.length > 0) {
        const jobCount = dayTeams.reduce((sum, dt) => sum + (dt.clients?.length || 0), 0);
        totalJobs += jobCount;
        dayPreviews.push({ dayLabel: DAY_LABELS[i], jobCount, teamColors: [] });
      }
    }
    return { totalJobs, dayPreviews };
  };

  const handleLoad = (t: Template) => {
    const data = t.week_data;

    // Legacy template → convert to week format (put all on Monday for the current team)
    if (isLegacyTemplate(data)) {
      const weekData: WeekTemplateData = {
        '0': [{ teamName: 'Team', teamId: '', clients: data.clients || [] }],
      };
      onLoadWeek(weekData);
      return;
    }

    onLoadWeek(data as WeekTemplateData);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
                <h3 className="text-base font-bold text-text-primary">Load Week Template</h3>
                <p className="text-xs text-text-tertiary">{templates.length} saved template{templates.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="shimmer h-24 rounded-xl" />)}</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm text-text-tertiary">No week templates saved yet.</p>
              <p className="text-xs text-text-tertiary mt-1">Save your current week schedule to create a template.</p>
            </div>
          ) : (
            templates.map((t, i) => {
              const preview = getTemplatePreview(t);
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="card p-4 group"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h4 className="text-sm font-bold text-text-primary">{t.name}</h4>
                      <p className="text-xs text-text-tertiary">
                        {preview.totalJobs} job{preview.totalJobs !== 1 ? 's' : ''} · Created {new Date(t.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
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

                  {/* Day-by-day preview */}
                  {preview.dayPreviews.length > 0 && (
                    <div className="flex items-center gap-1 mb-3 flex-wrap">
                      {preview.dayPreviews.map((d, j) => (
                        <span key={j} className="text-[10px] font-medium bg-primary-light text-primary px-2 py-0.5 rounded-md">
                          {d.dayLabel}: {d.jobCount}
                        </span>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => handleLoad(t)}
                    className="btn-primary w-full text-sm py-2"
                  >
                    Load Week
                  </button>
                </motion.div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
