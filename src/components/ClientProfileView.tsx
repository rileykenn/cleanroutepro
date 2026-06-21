'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { CLIENT_COLORS } from '@/lib/types';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';
import ConfirmModal from '@/components/ConfirmModal';
import type { Location } from '@/lib/types';

function minutesToHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}
function hmToMinutes(str: string): number | null {
  const trimmed = str.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    const h = parseInt(trimmed, 10);
    if (isNaN(h) || h < 0) return null;
    return h * 60;
  }
  const h = parseInt(trimmed.slice(0, colonIdx), 10);
  const m = parseInt(trimmed.slice(colonIdx + 1), 10);
  if (isNaN(h) || isNaN(m) || h < 0 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// ── Media section ─────────────────────────────────────────────────────────────
function MediaSection({ clientId, orgId }: { clientId: string; orgId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  type MediaRow = { id: string; file_name: string; file_path: string; file_type: string; caption: string | null };
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from('client_media').select('id, file_name, file_path, file_type, caption')
      .eq('client_id', clientId).eq('org_id', orgId).order('created_at', { ascending: false })
      .then(({ data }: { data: MediaRow[] | null }) => { if (data) setMedia(data); });
  }, [clientId, orgId, supabase]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `${orgId}/${clientId}/${Date.now()}-${cleanFileName}`;
      const { error: uploadError } = await supabase.storage.from('client-media').upload(path, file);
      
      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        alert(`Failed to upload file: ${uploadError.message}`);
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
        return;
      }

      const { data: row, error: insertError } = await supabase.from('client_media').insert({
        org_id: orgId, 
        client_id: clientId,
        file_name: file.name, 
        file_path: path, 
        file_type: file.type.startsWith('video') ? 'video' : 'image', 
        file_size: file.size,
      }).select('id, file_name, file_path, file_type, caption').single();

      if (insertError) {
        console.error('Database insert error:', insertError);
        alert(`Failed to save media record: ${insertError.message}`);
      } else if (row) {
        setMedia(m => [row as MediaRow, ...m]);
      }
    } catch (err: any) {
      console.error('Unexpected upload error:', err);
      alert(`An unexpected error occurred: ${err?.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const getUrl = (path: string) => supabase.storage.from('client-media').getPublicUrl(path).data.publicUrl;
  const deleteMedia = async (id: string, path: string) => {
    await supabase.storage.from('client-media').remove([path]);
    await supabase.from('client_media').delete().eq('id', id);
    setMedia(m => m.filter(x => x.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-text-secondary">Photos &amp; Videos</span>
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors disabled:opacity-50 flex items-center gap-1">
          {uploading
            ? <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Uploading…</>
            : '+ Upload'
          }
        </button>
        <input ref={inputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload}/>
      </div>
      {media.length === 0 ? (
        <button onClick={() => inputRef.current?.click()}
          className="w-full h-14 rounded-xl border border-border-light bg-surface-elevated/60 text-xs text-text-tertiary hover:text-text-secondary hover:border-border-base transition-all flex items-center justify-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Tap to upload photos or videos
        </button>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
          {media.map(m => (
            <div key={m.id} className="relative group aspect-square rounded-lg overflow-hidden bg-surface-elevated border border-border-light">
              {m.file_type.startsWith('video')
                ? <video src={getUrl(m.file_path)} className="w-full h-full object-cover"/>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={getUrl(m.file_path)} alt={m.file_name} className="w-full h-full object-cover"/>
              }
              <button onClick={() => deleteMedia(m.id, m.file_path)}
                className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/60 text-white transition-opacity hover:bg-red-500/80">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
          <button onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-lg border border-border-light bg-surface-elevated hover:bg-surface-hover flex items-center justify-center text-text-tertiary hover:text-text-secondary text-lg transition-all">
            +
          </button>
        </div>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type ClientRow = {
  id: string; name: string; address: string;
  phone: string | null; email: string | null;
  default_duration_minutes: number; default_staff_count: number;
  rate: number | null; notes: string | null; color: string | null; created_at: string;
};

interface ClientProfileViewProps {
  clientId: string;
  orgId: string;
  showBackButton?: boolean;
  onBack?: () => void;
  onDelete?: () => void;
  hideRates?: boolean;
}

// ── Inline editable row ───────────────────────────────────────────────────────
function EditRow({
  icon, label, value, placeholder, type = 'text', inputMode, step, min, display, onSave,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  step?: string;
  min?: string;
  display?: React.ReactNode;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  return (
    <div className="flex items-center gap-3 py-2.5 group">
      <div className="shrink-0 w-4 flex justify-center text-text-tertiary">{icon}</div>
      <span className="text-xs text-text-tertiary w-20 shrink-0">{label}</span>
      {editing ? (
        <input
          autoFocus
          type={type}
          inputMode={inputMode}
          step={step}
          min={min}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          onBlur={commit}
          placeholder={placeholder}
          className="flex-1 min-w-0 text-sm bg-surface-elevated border border-primary/50 rounded-lg px-2.5 py-1 text-text-primary outline-none focus:ring-2 focus:ring-primary/20"
        />
      ) : (
        <button
          onClick={() => { setDraft(value); setEditing(true); }}
          className="flex-1 min-w-0 text-left text-sm flex items-center justify-between gap-2 group/btn"
        >
          <span className={value ? 'text-text-primary font-medium' : 'text-text-tertiary'}>
            {display ?? (value || placeholder)}
          </span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="shrink-0 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ClientProfileView({ clientId, orgId, showBackButton, onBack, onDelete, hideRates }: ClientProfileViewProps) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setClient(null);
    const fetchClient = async (attempt = 0) => {
      const { data, error } = await supabase.from('clients')
        .select('id, name, address, phone, email, default_duration_minutes, default_staff_count, rate, notes, color, created_at')
        .eq('id', clientId).single();
      if (cancelled) return;
      if ((data === null || error) && attempt < 2) { setTimeout(() => fetchClient(attempt + 1), 400); return; }
      setClient(data ?? null);
      setLoading(false);
    };
    fetchClient();
    return () => { cancelled = true; };
  }, [clientId, supabase]);

  const updateField = useCallback(async (field: string, value: string | number | null) => {
    await supabase.from('clients').update({ [field]: value }).eq('id', clientId);
    setClient(prev => prev ? { ...prev, [field]: value } : prev);
  }, [clientId, supabase]);

  const [form, setForm] = useState({ name: '', address: '', notes: '' });
  const [durationHM, setDurationHM] = useState('1:30');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    if (client) {
      setForm({ name: client.name, address: client.address, notes: client.notes || '' });
      setDurationHM(minutesToHM(client.default_duration_minutes));
    }
  }, [client]);

  const handleDelete = async () => {
    setShowDeleteModal(false);
    setDeleting(true);
    onDelete?.();
  };

  if (loading) {
    return (
      <div className="p-4 max-w-lg space-y-3">
        <div className="shimmer h-24 rounded-2xl"/>
        <div className="shimmer h-40 rounded-2xl"/>
        <div className="shimmer h-28 rounded-2xl"/>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-secondary">Client not found.</p>
      </div>
    );
  }

  const accentColor = client.color || '#6366f1';
  const initial = (form.name || client.name || 'U').charAt(0).toUpperCase();

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-4 space-y-3 max-w-lg pb-16">

        {showBackButton && onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary transition-colors group mb-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="group-hover:-translate-x-0.5 transition-transform"><polyline points="15 18 9 12 15 6"/></svg>
            All Clients
          </button>
        )}

        {/* ── Identity card (matches job card style) ── */}
        <div className="bg-white rounded-2xl border border-border-light overflow-hidden">
          {/* Coloured left accent bar */}
          <div className="flex">
            <div className="w-1 shrink-0 rounded-l-2xl" style={{ backgroundColor: accentColor }}/>
            <div className="flex-1 p-4">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => setShowColorPicker(v => !v)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shadow-sm transition-transform hover:scale-105"
                    style={{ backgroundColor: accentColor }}
                  >
                    {initial}
                  </button>
                  <AnimatePresence>
                    {showColorPicker && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        className="absolute left-0 top-full mt-2 z-50 bg-white rounded-xl shadow-xl border border-border-light p-3 w-44"
                      >
                        <div className="grid grid-cols-5 gap-1.5">
                          {(CLIENT_COLORS as { value: string; name: string }[]).map(c => (
                            <button key={c.value}
                              onClick={() => { updateField('color', client.color === c.value ? null : c.value); setShowColorPicker(false); }}
                              className={`w-7 h-7 rounded-lg transition-all hover:scale-110 flex items-center justify-center ${client.color === c.value ? 'ring-2 ring-offset-1 ring-gray-600 scale-110' : ''}`}
                              style={{ backgroundColor: c.value }}>
                              {client.color === c.value && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                            </button>
                          ))}
                        </div>
                        {client.color && (
                          <button onClick={() => { updateField('color', null); setShowColorPicker(false); }}
                            className="mt-2 w-full text-center text-[11px] text-text-tertiary hover:text-danger transition-colors pt-2 border-t border-border-light">
                            Remove colour
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Name — clearly styled as an input */}
                <div className="flex-1 min-w-0">
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    onBlur={() => { if (form.name.trim()) updateField('name', form.name); }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    placeholder="Client name"
                    className="w-full text-sm font-bold text-text-primary bg-surface-elevated border border-border-light rounded-lg px-2.5 py-1.5 outline-none placeholder:text-text-tertiary placeholder:font-normal hover:border-border-base focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
                  />
                  {form.address && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                      </svg>
                      <p className="text-xs text-text-tertiary truncate">{form.address}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Stat pills — matches job card bottom row */}
              <div className="flex items-center gap-2 mt-3 pl-[48px]">
                <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary bg-surface-elevated rounded-full px-2.5 py-1 border border-border-light">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {durationHM} hrs
                </span>
                {client.rate != null && !hideRates && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary bg-surface-elevated rounded-full px-2.5 py-1 border border-border-light">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    ${Number(client.rate).toFixed(2)}/hr
                  </span>
                )}
                <span className="text-[10px] text-text-tertiary ml-auto">
                  Added {new Date(client.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Address card ── */}
        <div className="bg-white rounded-2xl border border-border-light p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <p className="text-xs font-semibold text-text-tertiary">Address</p>
          </div>
          <PlacesAutocomplete
            defaultValue={client.address}
            placeholder="Search address…"
            className="w-full text-sm"
            onPlaceSelect={(loc: Location) => {
              setForm(f => ({ ...f, address: loc.address }));
              updateField('address', loc.address);
            }}
            onTextChange={(text: string) => setForm(f => ({ ...f, address: text }))}
          />
          <p className="text-[10px] text-text-tertiary mt-1.5">Used for route calculations — include suburb and postcode</p>
        </div>

        {/* ── Contact details card ── */}
        <div className="bg-white rounded-2xl border border-border-light p-4">
          <p className="text-xs font-semibold text-text-tertiary mb-2">Contact</p>
          <div className="divide-y divide-border-light/70">
            <EditRow
              icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.29 6.29l.54-.54a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.73 17z"/></svg>}
              label="Phone"
              value={client.phone || ''}
              placeholder="Add phone"
              type="tel"
              onSave={val => updateField('phone', val || null)}
            />
            <EditRow
              icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}
              label="Email"
              value={client.email || ''}
              placeholder="Add email"
              type="email"
              onSave={val => updateField('email', val || null)}
            />
            <EditRow
              icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
              label="Duration"
              value={durationHM}
              placeholder="h:mm"
              inputMode="numeric"
              display={<span className="font-semibold text-text-primary">{durationHM} hrs</span>}
              onSave={val => {
                const mins = hmToMinutes(val);
                if (mins !== null && mins > 0) {
                  const formatted = minutesToHM(mins);
                  setDurationHM(formatted);
                  updateField('default_duration_minutes', mins);
                }
              }}
            />
            {!hideRates && (
            <EditRow
              icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
              label="Rate"
              value={client.rate != null ? String(client.rate) : ''}
              placeholder="Add rate"
              type="number"
              step="0.01"
              min="0"
              display={client.rate != null
                ? <span className="font-semibold text-text-primary">${Number(client.rate).toFixed(2)}<span className="font-normal text-text-tertiary text-xs">/hr</span></span>
                : undefined
              }
              onSave={val => updateField('rate', val === '' ? null : Number(val))}
            />
            )}
          </div>
        </div>

        {/* ── Notes card ── */}
        <div className="bg-white rounded-2xl border border-border-light p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-text-tertiary">Access &amp; Notes</p>
            <span className="text-[10px] text-text-tertiary">Visible to staff</span>
          </div>
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            onBlur={() => updateField('notes', form.notes || null)}
            placeholder="Alarm code, key location, gate code, pets, access instructions…"
            className="w-full border border-border-light rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary bg-surface-elevated/40 hover:bg-white focus:bg-white focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 resize-none transition-all"
            rows={4}
          />
        </div>

        {/* ── Photos card ── */}
        <div className="bg-white rounded-2xl border border-border-light p-4">
          <MediaSection clientId={clientId} orgId={orgId}/>
        </div>

        {/* ── Danger zone ── */}
        <div className="pt-2 pb-2 text-center">
          <button
            onClick={() => setShowDeleteModal(true)}
            disabled={deleting}
            className="text-xs text-text-tertiary hover:text-danger transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete this client'}
          </button>
        </div>

      </div>

      {/* ── Delete confirmation modal ── */}
      <AnimatePresence>
        {showDeleteModal && (
          <ConfirmModal
            title="Delete client?"
            message={`This will permanently delete ${client.name} and all their data including checklists and media. This cannot be undone.`}
            confirmLabel="Delete client"
            danger
            onConfirm={handleDelete}
            onCancel={() => setShowDeleteModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
