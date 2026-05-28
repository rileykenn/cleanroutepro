'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { CLIENT_COLORS } from '@/lib/types';

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
    const path = `${orgId}/${clientId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('client-media').upload(path, file);
    if (!error) {
      const { data: row } = await supabase.from('client_media').insert({
        org_id: orgId, client_id: clientId,
        file_name: file.name, file_path: path, file_type: file.type, file_size: file.size,
      }).select('id, file_name, file_path, file_type, caption').single() as { data: MediaRow | null };
      if (row) setMedia(m => [row, ...m]);
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
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
        <h3 className="text-sm font-bold text-text-primary">Photos &amp; Videos</h3>
        <button onClick={() => inputRef.current?.click()} disabled={uploading} className="btn-ghost text-xs flex items-center gap-1.5">
          {uploading
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          }
          Upload
        </button>
        <input ref={inputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload}/>
      </div>
      {media.length === 0 ? (
        <button onClick={() => inputRef.current?.click()}
          className="w-full h-24 rounded-xl border-2 border-dashed border-border-light hover:border-primary text-sm text-text-tertiary hover:text-primary transition-colors">
          Tap to upload photos or videos
        </button>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {media.map(m => (
            <div key={m.id} className="relative group aspect-square rounded-xl overflow-hidden bg-surface-elevated">
              {m.file_type.startsWith('video')
                ? <video src={getUrl(m.file_path)} className="w-full h-full object-cover"/>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={getUrl(m.file_path)} alt={m.file_name} className="w-full h-full object-cover"/>
              }
              <button onClick={() => deleteMedia(m.id, m.file_path)}
                className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type ClientRow = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  email: string | null;
  default_duration_minutes: number;
  default_staff_count: number;
  rate: number | null;
  notes: string | null;
  color: string | null;
  created_at: string;
};

interface ClientProfileViewProps {
  clientId: string;
  orgId: string;
  /** Show the back-to-clients nav button (used in the standalone profile page) */
  showBackButton?: boolean;
  onBack?: () => void;
  onDelete?: () => void;
}

// ── Main reusable component ───────────────────────────────────────────────────
export default function ClientProfileView({ clientId, orgId, showBackButton, onBack, onDelete }: ClientProfileViewProps) {
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
      if ((data === null || error) && attempt < 2) {
        // Auth session may not be ready yet — retry once after a short delay
        setTimeout(() => fetchClient(attempt + 1), 400);
        return;
      }
      setClient(data ?? null);
      setLoading(false);
    };

    fetchClient();
    return () => { cancelled = true; };
  }, [clientId, supabase]);

  const updateClient = useCallback(async (field: string, value: string | number | null) => {
    await supabase.from('clients').update({ [field]: value }).eq('id', clientId);
    setClient(prev => prev ? { ...prev, [field]: value } : prev);
  }, [clientId, supabase]);


  const [editingField, setEditingField] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', address: '', phone: '', email: '',
    default_duration_minutes: 90, default_staff_count: 1,
    rate: '' as string | number,
    notes: '' as string,
  });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (client) {
      setForm({
        name: client.name,
        address: client.address,
        phone: client.phone || '',
        email: client.email || '',
        default_duration_minutes: client.default_duration_minutes,
        default_staff_count: client.default_staff_count,
        rate: client.rate != null ? client.rate : '',
        notes: client.notes || '',
      });
    }
  }, [client]);

  const saveField = useCallback(async (field: string, value: string | number) => {
    await updateClient(field, value);
    setEditingField(null);
  }, [updateClient]);

  const handleDelete = async () => {
    if (!confirm('Delete this client and all their data? This cannot be undone.')) return;
    setDeleting(true);
    await supabase.from('clients').delete().eq('id', clientId);
    onDelete?.();
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-6 space-y-4 max-w-2xl mx-auto">
        {[1, 2, 3, 4].map(i => <div key={i} className="shimmer h-28 rounded-2xl"/>)}
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


  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-2xl mx-auto p-4 lg:p-6 space-y-5 pb-20">

        {/* Back button */}
        {showBackButton && onBack && (
          <button onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="group-hover:-translate-x-0.5 transition-transform"><polyline points="15 18 9 12 15 6"/></svg>
            All Clients
          </button>
        )}

        {/* Header card */}
        <div className="card p-5">
          <div className="flex items-start gap-4">
            {/* Colour avatar / picker */}
            <div className="relative shrink-0">
              <button onClick={() => setShowColorPicker(!showColorPicker)}
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-sm transition-all hover:scale-105"
                style={{ backgroundColor: client.color || '#6366f1' }}>
                {client.name.charAt(0).toUpperCase()}
              </button>
              <AnimatePresence>
                {showColorPicker && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute left-0 top-full mt-2 z-40 bg-white rounded-2xl shadow-xl border border-border-light p-4 w-56">
                    <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Colour Tag</p>
                    <div className="grid grid-cols-5 gap-2">
                      {(CLIENT_COLORS as { value: string; name: string }[]).map(c => (
                        <button key={c.value}
                          onClick={() => { updateClient('color', client.color === c.value ? null : c.value); setShowColorPicker(false); }}
                          className={`w-9 h-9 rounded-xl border-2 transition-all hover:scale-110 flex items-center justify-center ${client.color === c.value ? 'border-gray-700 scale-110 shadow-sm' : 'border-transparent'}`}
                          style={{ backgroundColor: c.value }} title={c.name}>
                          {client.color === c.value && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                        </button>
                      ))}
                    </div>
                    {client.color && (
                      <button onClick={() => { updateClient('color', null); setShowColorPicker(false); }}
                        className="w-full mt-3 pt-2 border-t border-border-light text-xs text-text-tertiary hover:text-danger transition-colors text-center">
                        Clear colour
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex-1 min-w-0">
              {editingField === 'name' ? (
                <div className="flex items-center gap-2">
                  <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveField('name', form.name); if (e.key === 'Escape') setEditingField(null); }}
                    className="input-field text-lg font-bold flex-1"/>
                  <button onClick={() => saveField('name', form.name)} className="btn-primary text-xs py-1.5 px-3">Save</button>
                  <button onClick={() => setEditingField(null)} className="btn-ghost text-xs py-1.5">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setEditingField('name')} className="group flex items-center gap-2 text-left w-full">
                  <h1 className="text-xl font-bold text-text-primary">{client.name}</h1>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              )}
              <p className="text-sm text-text-tertiary mt-0.5 truncate">{client.address}</p>
              <p className="text-xs text-text-tertiary mt-1">
                Added {new Date(client.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>

            <button onClick={handleDelete} disabled={deleting}
              className="p-2 rounded-xl hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Contact & Details */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-text-primary">Contact &amp; Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['phone', 'email', 'default_duration_minutes', 'rate'] as const).map(field => (
              <div key={field}>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {field === 'default_duration_minutes' ? 'Default Duration (min)' : field === 'rate' ? 'Client Rate ($/hr)' : field.charAt(0).toUpperCase() + field.slice(1)}
                </label>
                {editingField === field ? (
                  <div className="flex gap-1">
                    <input autoFocus
                      type={field === 'rate' || field.includes('_') ? 'number' : field === 'email' ? 'email' : 'text'}
                      value={form[field]}
                      onChange={e => setForm(f => ({ ...f, [field]: field === 'rate' || field.includes('_') ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveField(field, form[field] === '' ? null as unknown as number : form[field]); if (e.key === 'Escape') setEditingField(null); }}
                      placeholder={field === 'rate' ? '0.00' : ''}
                      step={field === 'rate' ? '0.01' : undefined}
                      min={field === 'rate' ? '0' : undefined}
                      className="input-field text-sm flex-1 py-1.5"/>
                    <button onClick={() => saveField(field, form[field] === '' ? null as unknown as number : form[field])} className="btn-primary text-xs py-1 px-2">✓</button>
                    <button onClick={() => setEditingField(null)} className="btn-ghost text-xs py-1 px-2">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setEditingField(field)}
                    className="group flex items-center gap-1.5 w-full text-left px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover transition-colors">
                    <span className="text-sm text-text-primary flex-1">
                      {field === 'rate'
                        ? (form[field] !== '' && form[field] != null ? `$${Number(form[field]).toFixed(2)}/hr` : <span className="text-text-tertiary italic">Not set</span>)
                        : (form[field] || <span className="text-text-tertiary italic">Not set</span>)
                      }
                    </span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className="text-text-tertiary opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Notes / Access */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Notes / Access
          </h3>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Access Instructions &amp; Notes</label>
            <textarea value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              onBlur={() => saveField('notes', form.notes)}
              placeholder="How to get in, alarm code, key location, gate code, pets, special notes for staff…"
              className="input-field text-sm resize-none w-full" rows={4}/>
            <p className="text-[10px] text-text-tertiary mt-1">Shown to staff in the schedule job panel</p>
          </div>
          <div className="border-t border-border-light pt-3">
            <MediaSection clientId={clientId} orgId={orgId}/>
          </div>
        </div>
      </div>
    </div>
  );
}
