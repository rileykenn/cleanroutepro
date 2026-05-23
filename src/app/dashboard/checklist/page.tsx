'use client';

/**
 * /checklist — Standalone preview page for iterating the ChecklistBuilder.
 *
 * No real data. Shows both Builder mode and Completion mode side-by-side
 * (or tabbed on mobile). Edit the DEMO_CHECKLIST below to test different
 * configurations while designing.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';
import { ClientChecklist, ChecklistSection, FieldAnswer } from '@/lib/types';
import { generateId } from '@/lib/timeUtils';

// ─── Demo checklist (edit this to test different configurations) ──────────────

const DEMO_CHECKLIST: ClientChecklist = {
  id: 'demo',
  org_id: 'demo',
  client_id: 'demo',
  name: 'Standard Residential Clean',
  is_default: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  sections: [
    {
      id: generateId(),
      title: 'Property Entry',
      description: 'Complete before starting the job',
      fields: [
        { id: generateId(), type: 'yesno', label: 'Property accessible on arrival?', required: true },
        { id: generateId(), type: 'text', label: 'Any issues with access? Please describe.', allowNA: true, conditional: { parentFieldId: '', showWhen: 'no' } },
        { id: generateId(), type: 'yesno', label: 'Are there pets on the premises?', allowNA: true },
      ],
    },
    {
      id: generateId(),
      title: 'Living Areas',
      description: 'Lounge, dining, hallways',
      fields: [
        { id: generateId(), type: 'yesno', label: 'Are there ceiling fans?', allowNA: true },
        { id: generateId(), type: 'text', label: 'Condition notes', allowNA: true },
        { id: generateId(), type: 'multiselect', label: 'Areas cleaned', required: true, options: ['Lounge', 'Dining', 'Hallway', 'Stairs', 'Study'] },
      ],
    },
    {
      id: generateId(),
      title: 'Kitchen',
      fields: [
        { id: generateId(), type: 'yesno', label: 'Oven cleaned?', required: true },
        { id: generateId(), type: 'dropdown', label: 'Oven condition', options: ['Excellent', 'Good', 'Fair', 'Poor'], allowNA: true },
        { id: generateId(), type: 'yesno', label: 'Fridge cleaned (exterior)?', required: false },
      ],
    },
    {
      id: generateId(),
      title: 'Completion',
      fields: [
        { id: generateId(), type: 'yesno', label: 'Property locked and secured?', required: true },
        { id: generateId(), type: 'time', label: 'Job finish time', required: true },
        { id: generateId(), type: 'photo', label: 'Before photos', allowNA: true },
        { id: generateId(), type: 'photo', label: 'After photos', allowNA: false },
      ],
    },
  ],
};

// Wire up the conditional for "issues with access" — parentFieldId should point to "accessible"
function wireConditionals(cl: ClientChecklist): ClientChecklist {
  const sections = cl.sections.map(s => ({ ...s, fields: [...s.fields] }));
  // Wire the "issues" field to the "accessible" field
  const entrySection = sections[0];
  if (entrySection?.fields[0] && entrySection?.fields[1]) {
    entrySection.fields[1] = {
      ...entrySection.fields[1],
      conditional: { parentFieldId: entrySection.fields[0].id, showWhen: 'no' },
    };
  }
  return { ...cl, sections };
}

const WIRED_DEMO = wireConditionals(DEMO_CHECKLIST);

// ─── Preview page ─────────────────────────────────────────────────────────────

export default function ChecklistPreviewPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'builder' | 'completion'>('builder');
  const [builderChecklist, setBuilderChecklist] = useState<ClientChecklist>(WIRED_DEMO);
  const [answers, setAnswers] = useState<FieldAnswer[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSaveTemplate = async (updated: { name: string; sections: ChecklistSection[] }) => {
    setBuilderChecklist(prev => ({ ...prev, ...updated }));
    setLastSaved(new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    // Short delay to simulate save
    await new Promise(r => setTimeout(r, 400));
  };

  const handleSubmit = async (submittedAnswers: FieldAnswer[], notes: string) => {
    setAnswers(submittedAnswers);
    setSubmitted(true);
    console.log('Submitted answers:', submittedAnswers, 'Notes:', notes);
    await new Promise(r => setTimeout(r, 600));
  };

  return (
    <div className="h-full overflow-y-auto bg-surface-elevated">
      {/* Page header */}
      <div className="bg-white border-b border-border-light px-4 py-3 flex items-center gap-4 sticky top-0 z-30">
        <button onClick={() => router.push('/dashboard')} className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-text-primary">Checklist Builder Preview</h1>
          <p className="text-[11px] text-text-tertiary">Sandbox — no data is saved to the database from this page</p>
        </div>
        {lastSaved && (
          <span className="text-[11px] text-emerald-600 font-medium hidden sm:block">✓ Saved {lastSaved}</span>
        )}
        <div className="flex items-center gap-1 bg-surface-elevated rounded-xl p-1">
          {(['builder', 'completion'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setSubmitted(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${tab === t ? 'bg-white text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}`}
            >
              {t === 'builder' ? '🔧 Builder' : '✅ Completion'}
            </button>
          ))}
        </div>
      </div>

      {/* Split layout on desktop, tab on mobile */}
      <div className="max-w-7xl mx-auto p-4 lg:p-6">

        {/* Desktop: side by side */}
        <div className="hidden lg:grid grid-cols-2 gap-6">
          {/* Builder */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">🔧 Builder Mode</span>
              <span className="text-[10px] text-text-tertiary">— Admin edits the template</span>
            </div>
            <div className="bg-white rounded-2xl border border-border-light p-5 shadow-sm min-h-[600px]">
              <ChecklistBuilder
                mode="builder"
                checklist={builderChecklist}
                compact={false}
                onSaveTemplate={handleSaveTemplate}
              />
            </div>
          </div>

          {/* Completion (live preview of the saved state) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">✅ Completion Mode</span>
              <span className="text-[10px] text-text-tertiary">— Staff fills it in</span>
            </div>

            {/* Full-page view */}
            <div className="bg-white rounded-2xl border border-border-light p-5 shadow-sm">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-3">Full-page view</p>
              {!submitted ? (
                <ChecklistBuilder
                  mode="completion"
                  checklist={builderChecklist}
                  context={{
                    staffName: 'Jane Smith',
                    clientName: 'Demo Client',
                    address: '42 Coastal Drive, Shellharbour',
                    date: new Date().toISOString(),
                    time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
                  }}
                  compact={false}
                  onSubmit={handleSubmit}
                  onAutoSave={a => setAnswers(a)}
                />
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <h3 className="text-sm font-bold mb-1">Submitted!</h3>
                  <p className="text-xs text-text-tertiary mb-4">{answers.filter(a => a.value !== null || a.na || a.media_urls?.length).length} answers recorded</p>
                  <button onClick={() => { setSubmitted(false); setAnswers([]); }} className="btn-ghost text-sm">Reset</button>
                </div>
              )}
            </div>

            {/* Compact panel view */}
            <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 bg-gray-800 flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-gray-400 ml-2 font-mono">Schedule sidebar — compact mode</span>
              </div>
              <div className="p-3 h-[420px] flex flex-col overflow-hidden bg-white">
                <ChecklistBuilder
                  mode="completion"
                  checklist={builderChecklist}
                  compact={true}
                  onSubmit={async () => {}}
                  onAutoSave={a => setAnswers(a)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Mobile: tab switcher */}
        <div className="lg:hidden">
          {tab === 'builder' ? (
            <div className="bg-white rounded-2xl border border-border-light p-4 shadow-sm">
              <ChecklistBuilder
                mode="builder"
                checklist={builderChecklist}
                compact={false}
                onSaveTemplate={handleSaveTemplate}
              />
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-border-light p-4 shadow-sm">
              {!submitted ? (
                <ChecklistBuilder
                  mode="completion"
                  checklist={builderChecklist}
                  context={{
                    staffName: 'Jane Smith',
                    clientName: 'Demo Client',
                    date: new Date().toISOString(),
                    time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
                  }}
                  compact={false}
                  onSubmit={handleSubmit}
                  onAutoSave={a => setAnswers(a)}
                />
              ) : (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <h3 className="text-sm font-bold mb-1">Submitted!</h3>
                  <button onClick={() => { setSubmitted(false); setAnswers([]); }} className="btn-ghost text-sm mt-3">Reset & try again</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Field type reference */}
        <div className="mt-6 bg-white rounded-2xl border border-border-light p-5 shadow-sm">
          <h2 className="text-sm font-bold text-text-primary mb-3">Supported Field Types</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: 'T', label: 'Text', desc: 'Free text, single or multiline' },
              { icon: '?', label: 'Yes / No', desc: 'Toggle with conditional logic support' },
              { icon: '▾', label: 'Dropdown', desc: 'Single option from custom list' },
              { icon: '☰', label: 'Multi-select', desc: 'Multiple choices from custom list' },
              { icon: '📅', label: 'Date', desc: 'Date picker' },
              { icon: '⏱', label: 'Time', desc: 'Time picker' },
              { icon: '📷', label: 'Photo', desc: 'Camera or file upload, thumbnail grid' },
              { icon: '🎥', label: 'Video', desc: 'Video recording or file upload' },
            ].map(f => (
              <div key={f.label} className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-elevated">
                <span className="text-xl shrink-0">{f.icon}</span>
                <div>
                  <div className="text-xs font-bold text-text-primary">{f.label}</div>
                  <div className="text-[10px] text-text-tertiary leading-snug mt-0.5">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-text-secondary">
            <div className="flex items-start gap-2 p-3 bg-surface-elevated rounded-xl">
              <span className="text-red-500 font-bold shrink-0 mt-0.5">REQ</span>
              <span><strong>Required enforcement</strong> — mark any field required; staff cannot submit without completing it</span>
            </div>
            <div className="flex items-start gap-2 p-3 bg-surface-elevated rounded-xl">
              <span className="font-bold text-gray-500 shrink-0 mt-0.5">N/A</span>
              <span><strong>N/A toggle</strong> — lets staff mark a field as not applicable for this visit</span>
            </div>
            <div className="flex items-start gap-2 p-3 bg-surface-elevated rounded-xl">
              <span className="text-indigo-500 font-bold shrink-0 mt-0.5">IF</span>
              <span><strong>Conditional logic</strong> — show follow-up questions based on Yes/No answers</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
