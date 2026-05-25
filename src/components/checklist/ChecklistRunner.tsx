'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChecklistSection, ChecklistField, FieldResponse, PreFillMeta, LogicCondition } from './types';
import ChecklistFieldInput from './ChecklistFieldInput';

interface ChecklistRunnerProps {
  sections: ChecklistSection[];
  responses: FieldResponse[];
  onChange: (responses: FieldResponse[]) => void;
  onSubmit: () => Promise<void>;

  orgId: string;
  completionId: string | null;
  preFilledMeta?: PreFillMeta;

  isAdmin?: boolean;
  readOnly?: boolean;  // submitted form
  saving?: boolean;
}

// ─── Logic engine ─────────────────────────────────────────────────────────────

function evalCondition(cond: LogicCondition, responses: FieldResponse[]): boolean {
  const raw = responses.find(r => r.field_id === cond.fieldId)?.value ?? null;
  switch (cond.operator) {
    case 'is_answered':
      return raw !== null && raw !== '' && !(Array.isArray(raw) && raw.length === 0);
    case 'is_empty':
      return raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    case 'equals':
    case 'not_equals': {
      let s: string | null = null;
      if (typeof raw === 'string') s = raw;
      else if (typeof raw === 'boolean') s = raw ? 'yes' : 'no';
      else if (Array.isArray(raw)) s = raw[0] ?? null;
      const match = s === cond.value;
      return cond.operator === 'equals' ? match : !match;
    }
    case 'contains':
      if (Array.isArray(raw)) return raw.includes(cond.value ?? '');
      if (typeof raw === 'string') return raw.toLowerCase().includes((cond.value ?? '').toLowerCase());
      return false;
    default: return false;
  }
}

/** Build a map of fieldId → visible for all non-logic fields */
function buildVisibilityMap(
  allFields: ChecklistField[],
  responses: FieldResponse[]
): Record<string, boolean> {
  const logicBlocks = allFields.filter(
    f => f.type === 'logic' && (f.logicConditions?.length ?? 0) > 0 && (f.logicTargets?.length ?? 0) > 0
  );

  // Fields targeted by a 'show' action are hidden by default
  const hiddenByDefault = new Set<string>();
  for (const lb of logicBlocks) {
    if (lb.logicAction === 'show') lb.logicTargets!.forEach(id => hiddenByDefault.add(id));
  }

  const map: Record<string, boolean> = {};

  for (const field of allFields) {
    if (field.type === 'logic') continue;

    // ── Legacy conditionalOn (keep working) ─────────────────────────────
    if (field.conditionalOn && !hiddenByDefault.has(field.id) && logicBlocks.every(lb => !lb.logicTargets?.includes(field.id))) {
      const parentResp = responses.find(r => r.field_id === field.conditionalOn);
      if (!parentResp) { map[field.id] = false; continue; }
      map[field.id] = parentResp.value === field.conditionalValue;
      continue;
    }

    // ── New logic system ─────────────────────────────────────────────────
    let visible = !hiddenByDefault.has(field.id);

    for (const lb of logicBlocks) {
      if (!lb.logicTargets?.includes(field.id)) continue;
      const conds = lb.logicConditions ?? [];
      const op = lb.logicOperator ?? 'and';
      const met = op === 'and'
        ? conds.every(c => evalCondition(c, responses))
        : conds.some(c => evalCondition(c, responses));

      if (lb.logicAction === 'show' && met) visible = true;
      if (lb.logicAction === 'hide' && met) visible = false;
    }

    map[field.id] = visible;
  }

  return map;
}

// Get or create a FieldResponse for a field
function ensureResponse(responses: FieldResponse[], fieldId: string): FieldResponse {
  return responses.find(r => r.field_id === fieldId) || { field_id: fieldId, value: null, na: false };
}

export default function ChecklistRunner({
  sections, responses, onChange, onSubmit,
  orgId, completionId, preFilledMeta,
  isAdmin = false, readOnly = false, saving = false,
}: ChecklistRunnerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]); // field IDs with missing required
  const [showErrors, setShowErrors] = useState(false);
  const firstErrorRef = useRef<HTMLDivElement | null>(null);

  const updateResponse = useCallback((updated: FieldResponse) => {
    const existing = responses.find(r => r.field_id === updated.field_id);
    if (existing) {
      onChange(responses.map(r => r.field_id === updated.field_id ? updated : r));
    } else {
      onChange([...responses, updated]);
    }
    // Clear error for this field when answered
    setValidationErrors(prev => prev.filter(id => id !== updated.field_id));
  }, [responses, onChange]);

  // Build visibility map from all logic blocks + legacy conditionalOn
  const allFields = useMemo(() => sections.flatMap(s => s.fields), [sections]);
  const visibilityMap = useMemo(() => buildVisibilityMap(allFields, responses), [allFields, responses]);

  // Compute visible interactive fields (headings and logic blocks are decorative)
  const visibleFields: ChecklistField[] = useMemo(() =>
    allFields.filter(f => f.type !== 'heading' && f.type !== 'logic' && visibilityMap[f.id] !== false),
    [allFields, visibilityMap]
  );

  // Progress
  const requiredVisible = visibleFields.filter(f => f.required);
  const answeredRequired = requiredVisible.filter(f => {
    const r = responses.find(resp => resp.field_id === f.id);
    if (!r) return false;
    if (r.na) return true; // N/A counts as answered
    if (Array.isArray(r.value)) return r.value.length > 0;
    return r.value !== null && r.value !== '';
  });
  const totalRequired = requiredVisible.length;
  const answeredCount = answeredRequired.length;
  const progressPct = totalRequired > 0 ? Math.round((answeredCount / totalRequired) * 100) : 100;

  // All-fields progress (non-required)
  const allVisible = visibleFields.length;
  const allAnswered = visibleFields.filter(f => {
    const r = responses.find(resp => resp.field_id === f.id);
    if (!r) return false;
    if (r.na) return true;
    if (Array.isArray(r.value)) return r.value.length > 0;
    return r.value !== null && r.value !== '';
  }).length;

  const handleSubmit = async () => {
    // Validate required fields
    const missing = requiredVisible.filter(f => {
      const r = responses.find(resp => resp.field_id === f.id);
      if (!r) return true;
      if (r.na) return false;
      if (Array.isArray(r.value)) return r.value.length === 0;
      return r.value === null || r.value === '';
    }).map(f => f.id);

    if (missing.length > 0) {
      setValidationErrors(missing);
      setShowErrors(true);
      // Scroll to first error
      setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      return;
    }

    setSubmitting(true);
    await onSubmit();
    setSubmitting(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Pre-fill banner ─────────────────────────────────────────────────── */}
      {preFilledMeta && (
        <div className="shrink-0 bg-primary-light/30 border-b border-primary/20 px-4 py-2.5">
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-primary/80">
            <span>📅 {preFilledMeta.date}</span>
            <span>🕐 {preFilledMeta.time}</span>
            <span>👤 {preFilledMeta.staff_name}</span>
            <span>🏠 {preFilledMeta.client_name}</span>
          </div>
        </div>
      )}

      {/* ── Progress bar ─────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div className="shrink-0 px-4 py-2.5 border-b border-border-light">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-secondary font-medium">
              {totalRequired > 0
                ? `${answeredCount} / ${totalRequired} required${allVisible > totalRequired ? ` · ${allAnswered}/${allVisible} total` : ''}`
                : `${allAnswered} / ${allVisible} answered`
              }
            </span>
            <span className={`text-xs font-bold ${progressPct === 100 ? 'text-emerald-600' : progressPct > 0 ? 'text-amber-600' : 'text-text-tertiary'}`}>
              {progressPct}%
            </span>
          </div>
          <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full transition-all ${progressPct === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${progressPct}%` }}
              layout
            />
          </div>
        </div>
      )}

      {/* ── Validation error banner ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showErrors && validationErrors.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden border-b border-red-200 bg-red-50 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-red-700 font-semibold">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {validationErrors.length} required field{validationErrors.length !== 1 ? 's' : ''} must be completed before submitting
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sections ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6 pb-4">
        {sections.map(sec => {
          const visibleSectionFields = sec.fields.filter(f =>
            f.type !== 'logic' && visibilityMap[f.id] !== false
          );
          if (visibleSectionFields.length === 0) return null;

          return (
            <div key={sec.id}>
              {/* Section header */}
              {sec.title && (
                <div className="mb-3">
                  <h3 className="text-xs font-bold text-text-tertiary uppercase tracking-widest">{sec.title}</h3>
                  {sec.description && <p className="text-xs text-text-tertiary mt-0.5">{sec.description}</p>}
                </div>
              )}

              <div className="space-y-4">
                {visibleSectionFields.map(field => {
                  // Paragraph — plain readable body text, no input
                  if (field.type === 'paragraph') {
                    return (
                      <p key={field.id} className="text-sm text-text-secondary leading-relaxed py-0.5">
                        {field.label}
                      </p>
                    );
                  }

                  // Heading — renders as a section divider, not an interactive field
                  if (field.type === 'heading') {
                    return (
                      <div key={field.id} className="pt-2 pb-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-xs font-black text-text-secondary uppercase tracking-widest whitespace-nowrap">
                            {field.label || 'Section'}
                          </h3>
                          <div className="flex-1 h-px bg-border-light"/>
                        </div>
                        {field.description && (
                          <p className="text-xs text-text-tertiary mt-1">{field.description}</p>
                        )}
                      </div>
                    );
                  }

                  const resp = ensureResponse(responses, field.id);
                  const hasError = showErrors && validationErrors.includes(field.id);

                  return (
                    <div
                      key={field.id}
                      ref={hasError && validationErrors[0] === field.id ? (el => { firstErrorRef.current = el; }) : undefined}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        hasError ? 'border-red-300 bg-red-50' : 'border-border-light bg-white'
                      }`}
                    >
                      <ChecklistFieldInput
                        field={field}
                        response={resp}
                        onChange={updateResponse}
                        orgId={orgId}
                        completionId={completionId}
                        readOnly={readOnly}
                      />
                      {hasError && (
                        <p className="text-[11px] text-red-500 font-semibold mt-2 flex items-center gap-1">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          This field is required
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Submit / status footer ── staff only ──────────────────────────── */}
      {!readOnly && !isAdmin && (
        <div className="shrink-0 border-t border-border-light p-4 bg-white">
          {saving && (
            <p className="text-[11px] text-text-tertiary text-center mb-2 flex items-center justify-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Auto-saving draft…
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full btn-primary py-3.5 text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting
              ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Submitting…</>
              : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> Submit Checklist</>
            }
          </button>
          {totalRequired > 0 && answeredCount < totalRequired && (
            <p className="text-[11px] text-text-tertiary text-center mt-1.5">
              {totalRequired - answeredCount} required field{totalRequired - answeredCount !== 1 ? 's' : ''} remaining
            </p>
          )}
        </div>
      )}

      {/* Read-only: submitted banner */}
      {readOnly && (
        <div className="shrink-0 border-t border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            Submitted — this form is locked
          </div>
        </div>
      )}
    </div>
  );
}
