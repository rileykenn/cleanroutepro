'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClients, SavedClient } from '@/lib/hooks/useClients';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { ChecklistSection, migrateOldSection, ChecklistField } from '@/components/checklist/types';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';

type ClientChecklist = {
  id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  sections: unknown[];
  created_at: string;
  updated_at: string;
};

type Completion = {
  id: string;
  checklist_id: string;
  client_id: string;
  status: string;
  submitted_at: string | null;
  pre_fill: { staff_name?: string; date?: string; time?: string } | null;
  created_at: string;
};

export default function ChecklistsPage() {
  const { profile } = useAuth();
  const orgId = profile?.org_id || null;
  const supabase = useMemo(() => createSupabaseClient(), []);
  const router = useRouter();

  const { clients } = useClients(orgId);

  const [checklists, setChecklists] = useState<ClientChecklist[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterClientId, setFilterClientId] = useState<string | 'all'>('all');

  // Builder state
  const [creatingFor, setCreatingFor] = useState<string | null>(null); // client_id
  const [editingChecklist, setEditingChecklist] = useState<ClientChecklist | null>(null);
  const [builderSections, setBuilderSections] = useState<ChecklistSection[]>([]);
  const [saving, setSaving] = useState(false);

  // Selected completion for detail view
  const [selectedCompletion, setSelectedCompletion] = useState<Completion | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // ─── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      supabase.from('client_checklists').select('*').eq('org_id', orgId).order('updated_at', { ascending: false }),
      supabase.from('checklist_completions').select('id, checklist_id, client_id, status, submitted_at, pre_fill, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    ]).then(([{ data: cls }, { data: comps }]) => {
      setChecklists((cls || []) as ClientChecklist[]);
      setCompletions((comps || []) as Completion[]);
      setLoading(false);
    });
  }, [orgId, supabase]);

  // ─── Derived ──────────────────────────────────────────────────────────────
  const clientMap = useMemo(() => {
    const m = new Map<string, SavedClient>();
    clients.forEach(c => m.set(c.id, c));
    return m;
  }, [clients]);

  const filteredChecklists = useMemo(() =>
    checklists.filter(cl => {
      if (filterClientId !== 'all' && cl.client_id !== filterClientId) return false;
      if (search && !cl.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }), [checklists, filterClientId, search]);

  // Group by client
  const grouped = useMemo(() => {
    const map = new Map<string, ClientChecklist[]>();
    filteredChecklists.forEach(cl => {
      const existing = map.get(cl.client_id) || [];
      map.set(cl.client_id, [...existing, cl]);
    });
    return map;
  }, [filteredChecklists]);

  const totalFields = (cl: ClientChecklist) =>
    cl.sections.reduce((sum: number, s) => {
      const sec = s as Record<string, unknown>;
      return sum + ((sec.fields as unknown[] | undefined)?.length ?? (sec.items as unknown[] | undefined)?.length ?? 0);
    }, 0);

  const checklistCompletions = (clId: string) => completions.filter(c => c.checklist_id === clId);

  // ─── Save actions ──────────────────────────────────────────────────────────
  const handleCreate = async (name: string, sections: ChecklistSection[], isDefault: boolean) => {
    if (!orgId || !creatingFor) return;
    setSaving(true);
    const { data } = await supabase.from('client_checklists').insert({
      org_id: orgId, client_id: creatingFor, name, sections, is_default: isDefault,
    }).select('*').single() as { data: ClientChecklist | null };
    if (data) {
      setChecklists(prev => [data, ...prev]);
      if (isDefault) {
        setChecklists(prev => prev.map(c => c.client_id === creatingFor && c.id !== data.id ? { ...c, is_default: false } : c));
      }
    }
    setCreatingFor(null);
    setBuilderSections([]);
    setSaving(false);
  };

  const handleUpdate = async (name: string, sections: ChecklistSection[], isDefault: boolean) => {
    if (!editingChecklist) return;
    setSaving(true);
    await supabase.from('client_checklists').update({ name, sections, is_default: isDefault, updated_at: new Date().toISOString() }).eq('id', editingChecklist.id);
    setChecklists(prev => prev.map(c => c.id === editingChecklist.id ? { ...c, name, sections: sections as unknown[], is_default: isDefault } : c));
    setEditingChecklist(null);
    setBuilderSections([]);
    setSaving(false);
  };

  const handleDuplicate = async (cl: ClientChecklist) => {
    if (!orgId) return;
    const { data } = await supabase.from('client_checklists').insert({
      org_id: orgId, client_id: cl.client_id, name: `${cl.name} (Copy)`, sections: cl.sections, is_default: false,
    }).select('*').single() as { data: ClientChecklist | null };
    if (data) setChecklists(prev => [data, ...prev]);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this checklist? This will not delete completed submissions.')) return;
    await supabase.from('client_checklists').delete().eq('id', id);
    setChecklists(prev => prev.filter(c => c.id !== id));
  };

  const downloadPDF = async (comp: Completion) => {
    setDownloading(comp.id);
    const res = await fetch(`/api/checklist/pdf?completion_id=${comp.id}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `checklist_${comp.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setDownloading(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 lg:px-6 py-4 border-b border-border-light bg-white">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-text-primary">Checklists</h1>
            <p className="text-xs text-text-tertiary">{checklists.length} template{checklists.length !== 1 ? 's' : ''} · {completions.filter(c => c.status === 'submitted').length} submitted</p>
          </div>
          {/* Create new — pick a client first */}
          <div className="relative">
            <select
              value=""
              onChange={e => {
                if (e.target.value) { setCreatingFor(e.target.value); setBuilderSections([]); }
              }}
              className="btn-primary text-xs py-2 px-3 pr-8 cursor-pointer appearance-none"
            >
              <option value="">+ New Checklist for…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-white" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex gap-2 mt-3">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search checklists…"
              className="input-field text-sm w-full pl-8 py-2" />
          </div>
          <select value={filterClientId} onChange={e => setFilterClientId(e.target.value as string)}
            className="input-field text-sm py-2 max-w-[150px]">
            <option value="all">All Clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* ── New checklist builder ────────────────────────────────────────── */}
        <AnimatePresence>
          {creatingFor && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-border-light" style={{ maxHeight: 600 }}>
              <div className="p-4 bg-surface-elevated">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                    New checklist for {clientMap.get(creatingFor)?.name || '—'}
                  </p>
                </div>
                <ChecklistBuilder
                  sections={builderSections}
                  onChange={setBuilderSections}
                  initialName=""
                  initialIsDefault={!checklists.some(c => c.client_id === creatingFor && c.is_default)}
                  mode="client-profile"
                  saving={saving}
                  onSave={handleCreate}
                  onCancel={() => { setCreatingFor(null); setBuilderSections([]); }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Edit existing checklist ──────────────────────────────────────── */}
        <AnimatePresence>
          {editingChecklist && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-border-light" style={{ maxHeight: 650 }}>
              <div className="p-4 bg-indigo-50/40">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">
                    Editing: {editingChecklist.name} · {clientMap.get(editingChecklist.client_id)?.name}
                  </p>
                </div>
                <ChecklistBuilder
                  sections={builderSections}
                  onChange={setBuilderSections}
                  initialName={editingChecklist.name}
                  initialIsDefault={editingChecklist.is_default}
                  mode="client-profile"
                  saving={saving}
                  onSave={handleUpdate}
                  onCancel={() => { setEditingChecklist(null); setBuilderSections([]); }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="shimmer h-20 rounded-2xl" />)}
          </div>
        ) : grouped.size === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center px-6">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mb-4">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
            </svg>
            <p className="text-sm font-semibold text-text-secondary">No checklists yet</p>
            <p className="text-xs text-text-tertiary mt-1">
              {search ? 'No checklists match your search.' : 'Create a checklist for a client using the button above.'}
            </p>
          </div>
        ) : (
          <div className="p-4 lg:p-6 space-y-6">
            {Array.from(grouped.entries()).map(([clientId, cls]) => {
              const client = clientMap.get(clientId);
              return (
                <div key={clientId}>
                  {/* Client group header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
                      style={{ backgroundColor: client?.color || '#6366f1' }}>
                      {(client?.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-text-primary">{client?.name || 'Unknown Client'}</h2>
                      <p className="text-xs text-text-tertiary">{cls.length} checklist{cls.length !== 1 ? 's' : ''}</p>
                    </div>
                    <button onClick={() => router.push(`/dashboard/clients/${clientId}`)}
                      className="ml-auto text-xs text-primary hover:text-primary/80 font-semibold transition-colors flex items-center gap-1">
                      View Profile
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {cls.map(cl => {
                      const clCompletions = checklistCompletions(cl.id);
                      const submitted = clCompletions.filter(c => c.status === 'submitted');
                      const drafts = clCompletions.filter(c => c.status === 'in_progress');

                      return (
                        <div key={cl.id} className="card overflow-hidden">
                          {/* Checklist header row */}
                          <div className="flex items-center gap-3 p-4">
                            <div className={`w-2 h-6 rounded-full shrink-0 ${cl.is_default ? 'bg-primary' : 'bg-border-light'}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-text-primary">{cl.name}</span>
                                {cl.is_default && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-primary-light text-primary">Default</span>
                                )}
                              </div>
                              <p className="text-xs text-text-tertiary mt-0.5">
                                {cl.sections.length} section{cl.sections.length !== 1 ? 's' : ''} · {totalFields(cl)} field{totalFields(cl) !== 1 ? 's' : ''} · {submitted.length} submitted · {drafts.length} in progress
                              </p>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  const migrated = (cl.sections as Record<string, unknown>[]).map(s => migrateOldSection(s));
                                  setBuilderSections(migrated);
                                  setEditingChecklist(editingChecklist?.id === cl.id ? null : cl);
                                  setCreatingFor(null);
                                }}
                                className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary transition-colors"
                                title="Edit"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                              <button onClick={() => handleDuplicate(cl)}
                                className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary transition-colors" title="Duplicate">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                              </button>
                              <button onClick={() => handleDelete(cl.id)}
                                className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors" title="Delete">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                              </button>
                            </div>
                          </div>

                          {/* Completions list */}
                          {clCompletions.length > 0 && (
                            <div className="border-t border-border-light divide-y divide-border-light/50">
                              <div className="px-4 py-2 bg-surface-elevated/50">
                                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Submissions</p>
                              </div>
                              {clCompletions.slice(0, 5).map(comp => (
                                <div key={comp.id} className="flex items-center gap-3 px-4 py-2.5">
                                  <div className={`w-2 h-2 rounded-full shrink-0 ${comp.status === 'submitted' ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-text-primary">
                                      {comp.pre_fill?.staff_name || 'Unknown staff'} · {comp.pre_fill?.date || new Date(comp.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                                    </p>
                                    <p className="text-[10px] text-text-tertiary capitalize">{comp.status === 'submitted' ? '✓ Submitted' : '• In progress'}</p>
                                  </div>
                                  {comp.status === 'submitted' && (
                                    <button
                                      onClick={() => downloadPDF(comp)}
                                      disabled={downloading === comp.id}
                                      className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                                      title="Download PDF"
                                    >
                                      {downloading === comp.id
                                        ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                        : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                      }
                                      PDF
                                    </button>
                                  )}
                                </div>
                              ))}
                              {clCompletions.length > 5 && (
                                <div className="px-4 py-2 text-[10px] text-text-tertiary">
                                  + {clCompletions.length - 5} more submissions
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
