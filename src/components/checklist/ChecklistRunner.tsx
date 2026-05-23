'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChecklistSection, ChecklistField, FieldResponse, PreFillMeta } from './types';
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

// Evaluate whether a field is visible given current responses
function isFieldVisible(field: ChecklistField, responses: FieldResponse[]): boolean {
  if (!field.conditionalOn) return true;
  const parentResp = responses.find(r => r.field_id === field.conditionalOn);
  if (!parentResp) return false;
  return parentResp.value === field.conditionalValue;
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

  // Compute visible fields across all sections
  const visibleFields: ChecklistField[] = useMemo(() =>
    sections.flatMap(s => s.fields.filter(f => isFieldVisible(f, responses))),
    [sections, responses]
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
          const visibleSectionFields = sec.fields.filter(f => isFieldVisible(f, responses));
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

      {/* ── Submit / status footer ────────────────────────────────────────────── */}
      {!readOnly && (
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
