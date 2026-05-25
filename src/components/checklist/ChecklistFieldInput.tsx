'use client';

import { useRef, useState, useEffect } from 'react';
import { ChecklistField, FieldResponse } from './types';
import { createClient } from '@/lib/supabase/client';

// ─── Multi-select dropdown (extracted to avoid hooks-in-switch) ───────────────
function MultiDropdownInput({
  field, selected, readOnly, fieldDisabled, onToggle,
}: {
  field: ChecklistField;
  selected: string[];
  readOnly: boolean;
  fieldDisabled: boolean;
  onToggle: (opt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={dropRef}>
      {/* Trigger — div with role=combobox avoids nested <button> inside <button> */}
      <div
        role="combobox"
        aria-expanded={open}
        tabIndex={fieldDisabled ? -1 : 0}
        onClick={() => !fieldDisabled && setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!fieldDisabled) setOpen(o => !o); } }}
        className={`w-full min-h-[48px] px-3 py-2 rounded-xl border-2 text-left transition-all flex items-center gap-2 flex-wrap cursor-pointer select-none ${
          fieldDisabled ? 'opacity-40 pointer-events-none' : ''
        } ${
          open ? 'border-primary bg-primary/5' : 'border-border-light bg-white hover:border-primary/50'
        }`}
      >
        {selected.length === 0 ? (
          <span className="text-sm text-text-tertiary">Select options…</span>
        ) : (
          selected.map(s => (
            <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
              {s}
              {!readOnly && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); onToggle(s); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onToggle(s); } }}
                  className="cursor-pointer hover:text-rose-500 transition-colors leading-none"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </span>
              )}
            </span>
          ))
        )}
        <svg className="ml-auto shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}/>
        </svg>
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-full bg-white rounded-xl shadow-xl border border-border-light py-1.5 max-h-52 overflow-y-auto">
          {(field.options || []).map(opt => {
            const checked = selected.includes(opt);
            return (
              <button key={opt} type="button"
                onClick={() => onToggle(opt)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors ${
                  checked ? 'bg-primary/10 text-primary' : 'text-text-primary hover:bg-surface-elevated'
                }`}
              >
                <div className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                  checked ? 'bg-primary border-primary' : 'border-gray-300'
                }`}>
                  {checked && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


interface ChecklistFieldInputProps {
  field: ChecklistField;
  response: FieldResponse;
  onChange: (r: FieldResponse) => void;
  orgId: string;
  completionId: string | null; // null means completion hasn't been created yet
  readOnly?: boolean;
}

export default function ChecklistFieldInput({ field, response, onChange, orgId, completionId, readOnly }: ChecklistFieldInputProps) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const update = (patch: Partial<FieldResponse>) => onChange({ ...response, ...patch });

  // N/A toggle
  const toggleNA = () => {
    if (readOnly) return;
    update({ na: !response.na, value: !response.na ? null : response.value });
  };

  const fieldDisabled = readOnly || response.na;

  // ─── Photo/video upload ────────────────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !completionId) return;
    setUploading(true);
    const path = `${orgId}/completions/${completionId}/${field.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('client-media').upload(path, file);
    if (!error) {
      const url = supabase.storage.from('client-media').getPublicUrl(path).data.publicUrl;
      update({ media_urls: [...(response.media_urls || []), url] });
      // Also save to checklist_completion_media table
      await supabase.from('checklist_completion_media').insert({
        org_id: orgId, completion_id: completionId,
        item_id: field.id, file_path: path, file_type: file.type,
      });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeMedia = (url: string) => {
    update({ media_urls: (response.media_urls || []).filter(u => u !== url) });
  };

  // ─── Render the right input type ─────────────────────────────────────────
  const renderInput = () => {
    if (response.na) return null;

    switch (field.type) {
      case 'checkbox':
        return (
          <button
            onClick={() => !readOnly && update({ value: !response.value })}
            disabled={fieldDisabled}
            className={`flex items-center gap-3 w-full text-left p-3 rounded-xl border-2 transition-all min-h-[52px] ${
              response.value
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-border-light hover:border-primary bg-white'
            } ${readOnly ? 'cursor-default' : 'active:scale-[0.99]'}`}
          >
            <div className={`shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
              response.value ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
            }`}>
              {response.value && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
            <span className={`text-sm font-medium ${response.value ? 'text-emerald-800' : 'text-text-primary'}`}>
              {response.value ? 'Completed' : 'Tap to mark complete'}
            </span>
          </button>
        );

      case 'text':
        return (
          <textarea
            value={(response.value as string) || ''}
            onChange={e => update({ value: e.target.value || null })}
            disabled={fieldDisabled}
            placeholder="Type your answer…"
            rows={3}
            className="input-field text-sm w-full resize-none disabled:opacity-40 min-h-[80px]"
          />
        );

      case 'yesno':
        return (
          <div className="flex gap-3">
            {(['yes', 'no'] as const).map(opt => (
              <button key={opt}
                onClick={() => !readOnly && update({ value: response.value === opt ? null : opt })}
                disabled={fieldDisabled}
                className={`flex-1 py-4 rounded-xl border-2 text-sm font-bold transition-all min-h-[56px] ${
                  response.value === opt
                    ? opt === 'yes'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'bg-red-500 border-red-500 text-white'
                    : 'bg-white border-border-light text-text-secondary hover:border-primary hover:text-primary'
                } ${readOnly ? 'cursor-default' : 'active:scale-[0.98]'}`}
              >
                {opt === 'yes' ? '👍 Yes' : '👎 No'}
              </button>
            ))}
          </div>
        );

      case 'dropdown':
        return (
          <select
            value={(response.value as string) || ''}
            onChange={e => update({ value: e.target.value || null })}
            disabled={fieldDisabled}
            className="input-field text-sm w-full py-3.5 disabled:opacity-40"
          >
            <option value="">Select an option…</option>
            {(field.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );

      case 'multiselect': {
        const selected = (response.value as string[]) || [];
        return (
          <div className="space-y-2">
            {(field.options || []).map(opt => {
              const checked = selected.includes(opt);
              return (
                <button key={opt}
                  onClick={() => {
                    if (readOnly) return;
                    const next = checked ? selected.filter(s => s !== opt) : [...selected, opt];
                    update({ value: next.length ? next : null });
                  }}
                  disabled={fieldDisabled}
                  className={`flex items-center gap-3 w-full text-left p-3 rounded-xl border-2 transition-all min-h-[48px] ${
                    checked ? 'border-primary bg-primary-light/30' : 'border-border-light bg-white hover:border-primary/50'
                  } disabled:opacity-40`}
                >
                  <div className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                    checked ? 'bg-primary border-primary' : 'border-gray-300'
                  }`}>
                    {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                  <span className="text-sm font-medium text-text-primary">{opt}</span>
                </button>
              );
            })}
          </div>
        );
      }

      case 'multidropdown': {
        const selected: string[] = (response.value as string[]) || [];
        const toggle = (opt: string) => {
          if (readOnly || fieldDisabled) return;
          const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
          update({ value: next.length ? next : null });
        };
        return (
          <MultiDropdownInput
            field={field}
            selected={selected}
            readOnly={readOnly ?? false}
            fieldDisabled={fieldDisabled}
            onToggle={toggle}
          />
        );
      }

      case 'date':
        return (
          <input
            type="date"
            value={(response.value as string) || ''}
            onChange={e => update({ value: e.target.value || null })}
            disabled={fieldDisabled}
            className="input-field text-sm w-full py-3.5 disabled:opacity-40"
          />
        );

      case 'time':
        return (
          <input
            type="time"
            value={(response.value as string) || ''}
            onChange={e => update({ value: e.target.value || null })}
            disabled={fieldDisabled}
            className="input-field text-sm w-full py-3.5 disabled:opacity-40"
          />
        );

      case 'photo':
      case 'video': {
        const accept = field.type === 'photo' ? 'image/*' : 'video/*';
        const capture: 'environment' | undefined = field.type === 'photo' ? 'environment' : undefined;
        return (
          <div>
            {/* Thumbnails */}
            {(response.media_urls || []).length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {(response.media_urls || []).map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-surface-elevated group">
                    {field.type === 'photo'
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={url} alt={`upload ${i + 1}`} className="w-full h-full object-cover" />
                      : <video src={url} className="w-full h-full object-cover" />
                    }
                    {!readOnly && (
                      <button onClick={() => removeMedia(url)}
                        className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Upload button */}
            {!readOnly && (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-full py-4 rounded-xl border-2 border-dashed border-border-light hover:border-primary text-sm text-text-tertiary hover:text-primary transition-colors font-medium flex items-center justify-center gap-2 min-h-[60px]"
                >
                  {uploading
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  }
                  {uploading ? 'Uploading…' : `Tap to ${field.type === 'photo' ? 'take photo or upload' : 'record or upload video'}`}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={accept}
                  capture={capture}
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className={`space-y-2 ${response.na ? 'opacity-60' : ''}`}>
      {/* Label row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary leading-snug">
            {field.label || <span className="text-text-tertiary italic">Untitled field</span>}
            {field.required && !response.na && <span className="text-red-400 ml-1 text-xs">*</span>}
          </p>
          {field.description && (
            <p className="text-xs text-text-tertiary mt-0.5 leading-relaxed">{field.description}</p>
          )}
        </div>
        {field.allowNA && !readOnly && (
          <button onClick={toggleNA}
            className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors ${
              response.na
                ? 'bg-gray-600 text-white border-gray-600'
                : 'bg-white text-text-tertiary border-border-light hover:border-gray-400'
            }`}
          >
            N/A
          </button>
        )}
        {response.na && field.allowNA && (
          <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg bg-gray-100 text-gray-500 border border-gray-200">
            Not Applicable
          </span>
        )}
      </div>

      {/* Input */}
      {!response.na && renderInput()}
    </div>
  );
}
