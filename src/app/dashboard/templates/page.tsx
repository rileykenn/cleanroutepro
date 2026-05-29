'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { useChecklistMasters, AssignResult } from '@/lib/hooks/useChecklistMasters';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { ChecklistSection, migrateOldSection } from '@/components/checklist/types';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';
import AssignTemplateModal from '@/components/AssignTemplateModal';

// ─── Schedule Template types ───────────────────────────────────────────────────
interface ScheduleTemplate {
  id: string;
  name: string;
  label: string | null;
  week_data: Record<string, { teamName: string; teamId: string; clients?: { name: string }[] }[]>;
  created_at: string;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getScheduleTemplateStats(t: ScheduleTemplate) {
  let totalJobs = 0;
  const dayPreviews: { dayLabel: string; count: number }[] = [];
  let teamCount = 0;
  const teamNames = new Set<string>();
  const wd = t.week_data;
  if (wd && typeof wd === 'object' && !Array.isArray(wd)) {
    for (let i = 0; i < 7; i++) {
      const dayTeams = wd[String(i)];
      if (dayTeams && Array.isArray(dayTeams)) {
        let dayCount = 0;
        for (const team of dayTeams) {
          const c = team.clients?.length || 0;
          dayCount += c;
          if (team.teamName) teamNames.add(team.teamName);
        }
        if (dayCount > 0) {
          totalJobs += dayCount;
          dayPreviews.push({ dayLabel: DAY_LABELS[i], count: dayCount });
        }
      }
    }
    teamCount = teamNames.size;
  }
  return { totalJobs, dayPreviews, teamCount };
}

// ─── Tab type ──────────────────────────────────────────────────────────────────
type Tab = 'schedule' | 'checklist';

export default function TemplatesPage() {
  const { profile } = useAuth();
  const orgId = profile?.org_id || null;
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('schedule');

  // ── Schedule Templates ────────────────────────────────────────────────────
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [schedLoading, setSchedLoading] = useState(true);

  const loadScheduleTemplates = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('schedule_templates').select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (data) setScheduleTemplates(data);
    setSchedLoading(false);
  }, [orgId, supabase]);

  useEffect(() => { if (orgId) loadScheduleTemplates(); }, [orgId, loadScheduleTemplates]);

  const deleteScheduleTemplate = async (id: string, name: string) => {
    if (!confirm(`Delete schedule template "${name}"?`)) return;
    await supabase.from('schedule_templates').delete().eq('id', id);
    setScheduleTemplates(p => p.filter(t => t.id !== id));
  };

  const loadToSchedule = (id: string) => {
    router.push(`/dashboard/schedule?template=${id}`);
  };

  // ── Checklist Templates ───────────────────────────────────────────────────
  const { masters, loading: checklistLoading, addMaster, updateMaster, deleteMaster, duplicateMaster, assignToClients } = useChecklistMasters(orgId);

  const [selectedMasterId, setSelectedMasterId] = useState<string | 'new' | null>(null);
  const [builderSections, setBuilderSections] = useState<ChecklistSection[]>([]);
  const [builderName, setBuilderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [checklistSearch, setChecklistSearch] = useState('');

  // Assign modal
  const [assignModalMasterId, setAssignModalMasterId] = useState<string | null>(null);
  const [assignResult, setAssignResult] = useState<AssignResult | null>(null);

  const selectMaster = (id: string) => {
    const master = masters.find(m => m.id === id);
    if (!master) return;
    setSelectedMasterId(id);
    const migrated = (master.sections as unknown[]).map(s => migrateOldSection(s as Record<string, unknown>));
    setBuilderSections(migrated);
    setBuilderName(master.name);
  };

  const openNewMaster = () => {
    setSelectedMasterId('new');
    setBuilderSections([{ id: crypto.randomUUID(), title: '', fields: [] }]);
    setBuilderName('');
  };

  const handleSaveMaster = async (name: string, sections: ChecklistSection[]) => {
    if (!orgId) return;
    setSaving(true);
    if (selectedMasterId === 'new') {
      const created = await addMaster(name, sections);
      if (created) setSelectedMasterId(created.id);
    } else if (selectedMasterId) {
      await updateMaster(selectedMasterId, { name, sections });
    }
    setSaving(false);
  };

  const handleDeleteMaster = async (id: string, name: string) => {
    if (!confirm(`Delete checklist template "${name}"?`)) return;
    await deleteMaster(id);
    if (selectedMasterId === id) setSelectedMasterId(null);
  };

  const handleDuplicateMaster = async (id: string) => {
    const dup = await duplicateMaster(id);
    if (dup) selectMaster(dup.id);
  };

  const handleAssign = async (clientIds: string[], overwrite: boolean) => {
    if (!assignModalMasterId) return;
    const result = await assignToClients(assignModalMasterId, clientIds, overwrite);
    setAssignResult(result);
    // Auto-close after showing result
    setTimeout(() => {
      setAssignModalMasterId(null);
      setAssignResult(null);
    }, 2000);
  };

  const filteredMasters = useMemo(() => {
    if (!checklistSearch) return masters;
    const q = checklistSearch.toLowerCase();
    return masters.filter(m => m.name.toLowerCase().includes(q));
  }, [masters, checklistSearch]);

  const selectedMaster = useMemo(() =>
    selectedMasterId && selectedMasterId !== 'new' ? masters.find(m => m.id === selectedMasterId) ?? null : null,
    [selectedMasterId, masters]
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ══ Header + Tabs ═════════════════════════════════════════════════════ */}
      <div className="shrink-0 bg-white border-b border-border-light">
        <div className="px-5 pt-5 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg font-bold text-text-primary">Templates</h1>
              <p className="text-sm text-text-secondary mt-0.5">Manage reusable schedule and checklist templates</p>
            </div>
            {/* Action button — context-dependent */}
            {activeTab === 'schedule' ? (
              <button
                onClick={() => router.push('/dashboard/templates/schedule/new')}
                className="btn-primary text-sm py-2.5 px-4"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Schedule Template
              </button>
            ) : (
              <button onClick={openNewMaster} className="btn-primary text-sm py-2.5 px-4">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Checklist Template
              </button>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1">
            {([
              { key: 'schedule' as Tab, label: 'Schedule Templates', icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              ), count: scheduleTemplates.length },
              { key: 'checklist' as Tab, label: 'Checklist Templates', icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                  <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12l2 2 4-4"/>
                </svg>
              ), count: masters.length },
            ]).map(tab => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors rounded-t-xl ${
                    isActive
                      ? 'text-primary bg-white border border-border-light border-b-white -mb-px z-10'
                      : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-elevated'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${
                    isActive ? 'bg-primary/10 text-primary' : 'bg-surface-elevated text-text-tertiary'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ══ Content ═══════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'schedule' ? (
            <motion.div
              key="schedule"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
              className="h-full overflow-y-auto custom-scrollbar p-5"
            >
              <ScheduleTemplatesTab
                templates={scheduleTemplates}
                loading={schedLoading}
                onEdit={(id) => router.push(`/dashboard/templates/schedule/${id}`)}
                onLoadToSchedule={loadToSchedule}
                onDelete={deleteScheduleTemplate}
              />
            </motion.div>
          ) : (
            <motion.div
              key="checklist"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="h-full flex overflow-hidden"
            >
              {/* Left: template list */}
              <div className="w-72 shrink-0 flex flex-col border-r border-border-light bg-surface-elevated/40">
                <div className="shrink-0 p-3 border-b border-border-light">
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input value={checklistSearch} onChange={e => setChecklistSearch(e.target.value)}
                      placeholder="Search templates…" className="input-field text-sm w-full pl-10 py-2"/>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {checklistLoading ? (
                    <div className="p-3 space-y-2">
                      {[1,2,3].map(i => <div key={i} className="shimmer h-14 rounded-xl"/>)}
                    </div>
                  ) : filteredMasters.length === 0 && !checklistSearch ? (
                    <div className="text-center py-12 px-4">
                      <div className="text-3xl mb-2">📋</div>
                      <p className="text-sm font-medium text-text-secondary">No templates yet</p>
                      <p className="text-xs text-text-tertiary mt-1">Create a master checklist template to assign to multiple clients</p>
                      <button onClick={openNewMaster} className="btn-primary text-xs mt-4 py-2 px-4">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Create Template
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-border-light/40">
                      {filteredMasters.map(master => {
                        const isActive = selectedMasterId === master.id;
                        const fieldCount = master.sections.reduce((sum, s) => sum + (s.fields?.length || 0), 0);
                        return (
                          // Using div instead of button to avoid nested <button> HTML violations.
                          // Inner action buttons (assign, duplicate, delete) need to remain real buttons.
                          <div
                            key={master.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => selectMaster(master.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectMaster(master.id); }}
                            className={`w-full text-left px-4 py-3 transition-colors group cursor-pointer ${
                              isActive ? 'bg-primary/5 border-r-2 border-primary' : 'hover:bg-surface-elevated'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-sm font-semibold truncate ${isActive ? 'text-primary' : 'text-text-primary'}`}>
                                {master.name}
                              </p>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setAssignModalMasterId(master.id); }}
                                  className="p-1 rounded-md text-text-tertiary hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                                  title="Assign to clients"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                                    <circle cx="9" cy="7" r="4"/>
                                    <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDuplicateMaster(master.id); }}
                                  className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors opacity-0 group-hover:opacity-100"
                                  title="Duplicate"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                  </svg>
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeleteMaster(master.id, master.name); }}
                                  className="p-1 rounded-md text-text-tertiary hover:text-danger hover:bg-danger-light transition-colors opacity-0 group-hover:opacity-100"
                                  title="Delete"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-text-tertiary mt-0.5">
                              {fieldCount} field{fieldCount !== 1 ? 's' : ''} · Updated {new Date(master.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: checklist builder */}
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                <AnimatePresence mode="wait">
                  {selectedMasterId ? (
                    <motion.div key={selectedMasterId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex-1 flex flex-col min-h-0 overflow-hidden">
                      {/* Editor header */}
                      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border-light bg-white">
                        <button onClick={() => setSelectedMasterId(null)}
                          className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-bold">
                            {selectedMasterId === 'new' ? 'New Template' : 'Edit Template'}
                          </p>
                          <h2 className="text-sm font-bold text-text-primary truncate">
                            {selectedMasterId === 'new' ? 'Untitled Template' : selectedMaster?.name || 'Template'}
                          </h2>
                        </div>
                        {selectedMaster && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => setAssignModalMasterId(selectedMaster.id)}
                              className="btn-secondary text-xs py-1.5 px-3"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                                <circle cx="9" cy="7" r="4"/>
                                <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                              </svg>
                              Assign to Clients
                            </button>
                            <button
                              onClick={() => handleDeleteMaster(selectedMaster.id, selectedMaster.name)}
                              className="text-xs font-semibold text-text-tertiary hover:text-rose-500 px-2 py-1 rounded-lg hover:bg-rose-50 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-h-0 overflow-hidden">
                        <ChecklistBuilder
                          key={selectedMasterId}
                          sections={builderSections}
                          onChange={setBuilderSections}
                          initialName={builderName}
                          mode="template"
                          saving={saving}
                          onSave={handleSaveMaster}
                          onCancel={selectedMasterId === 'new' ? () => setSelectedMasterId(null) : undefined}
                        />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex-1 flex items-center justify-center text-center px-8">
                      <div>
                        <div className="w-16 h-16 rounded-2xl bg-surface-elevated flex items-center justify-center mx-auto mb-4">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
                            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                            <rect x="9" y="3" width="6" height="4" rx="1"/>
                            <path d="M9 12l2 2 4-4"/>
                          </svg>
                        </div>
                        <p className="text-sm font-semibold text-text-secondary">Select a template to edit</p>
                        <p className="text-xs text-text-tertiary mt-1">Or create a new one to get started</p>
                        <button onClick={openNewMaster} className="btn-primary text-xs mt-4 py-2 px-4">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                          Create Template
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ══ Assign Modal ══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {assignModalMasterId && (
          <AssignTemplateModal
            masterId={assignModalMasterId}
            masterName={masters.find(m => m.id === assignModalMasterId)?.name || 'Template'}
            orgId={orgId || ''}
            onClose={() => { setAssignModalMasterId(null); setAssignResult(null); }}
            onConfirm={handleAssign}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Schedule Templates Tab Content ──────────────────────────────────────────
function ScheduleTemplatesTab({
  templates,
  loading,
  onEdit,
  onLoadToSchedule,
  onDelete,
}: {
  templates: ScheduleTemplate[];
  loading: boolean;
  onEdit: (id: string) => void;
  onLoadToSchedule: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1,2,3].map(i => <div key={i} className="shimmer h-48 rounded-2xl"/>)}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <div className="w-20 h-20 rounded-2xl bg-surface-elevated flex items-center justify-center mx-auto mb-5">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
          </svg>
        </div>
        <h3 className="text-base font-bold text-text-primary mb-1">No schedule templates yet</h3>
        <p className="text-sm text-text-secondary mb-6">
          Create a template to save a reusable weekly schedule pattern.
          Perfect for rotation cycles (A1, A2, B1, B2, etc.)
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((t, i) => {
          const stats = getScheduleTemplateStats(t);
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="card p-5 group hover:shadow-lg transition-all"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-text-primary truncate">{t.name}</h4>
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    {stats.totalJobs} job{stats.totalJobs !== 1 ? 's' : ''} · {stats.teamCount} team{stats.teamCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(t.id, t.name)}
                  className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  title="Delete template"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>

              {/* Day pills */}
              {stats.dayPreviews.length > 0 && (
                <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                  {stats.dayPreviews.map((d, j) => (
                    <span key={j} className="text-[10px] font-semibold bg-primary/8 text-primary px-2 py-0.5 rounded-md">
                      {d.dayLabel}: {d.count}
                    </span>
                  ))}
                </div>
              )}

              {/* Meta */}
              <p className="text-[11px] text-text-tertiary mb-4">
                Created {new Date(t.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onEdit(t.id)}
                  className="btn-secondary flex-1 text-xs py-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                  Edit
                </button>
                <button
                  onClick={() => onLoadToSchedule(t.id)}
                  className="btn-primary flex-1 text-xs py-2"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Load
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
