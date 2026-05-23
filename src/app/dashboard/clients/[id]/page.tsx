'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClientChecklists } from '@/lib/hooks/useClientChecklists';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';
import { ClientChecklist, ChecklistSection, CLIENT_COLORS } from '@/lib/types';
import { generateId } from '@/lib/timeUtils';
import ChecklistBuilder from '@/components/checklist/ChecklistBuilder';

// (Checklist editing now uses ChecklistBuilder component)

// ─── Media uploader ───────────────────────────────────────────────────────────
function MediaSection({ clientId, orgId }: { clientId: string; orgId: string }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [media, setMedia] = useState<{ id: string; file_name: string; file_path: string; file_type: string; caption: string | null }[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from('client_media').select('id, file_name, file_path, file_type, caption')
      .eq('client_id', clientId).eq('org_id', orgId).order('created_at', { ascending: false })
      .then(({ data }: { data: typeof media | null }) => { if (data) setMedia(data); });
  }, [clientId, orgId, supabase]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const path = `${orgId}/${clientId}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage.from('client-media').upload(path, file);
    if (!uploadErr) {
      const { data: row } = await supabase.from('client_media').insert({
        org_id: orgId, client_id: clientId,
        file_name: file.name, file_path: path,
        file_type: file.type, file_size: file.size,
      }).select('id, file_name, file_path, file_type, caption').single();
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
        <h3 className="text-sm font-bold text-text-primary">Photos & Videos</h3>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-ghost text-xs flex items-center gap-1.5"
        >
          {uploading ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          )}
          Upload
        </button>
        <input ref={inputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload} />
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
              {m.file_type.startsWith('video') ? (
                <video src={getUrl(m.file_path)} className="w-full h-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getUrl(m.file_path)} alt={m.file_name} className="w-full h-full object-cover" />
              )}
              <button
                onClick={() => deleteMedia(m.id, m.file_path)}
                className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main profile page ─────────────────────────────────────────────────────────
export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const orgId = profile?.org_id || null;
  const supabase = useMemo(() => createSupabaseClient(), []);

  // Fetch client directly by ID — avoids depending on the full client list being loaded
  type ClientRow = {
    id: string; name: string; address: string; phone: string | null; email: string | null;
    default_duration_minutes: number; default_staff_count: number;
    notes: string | null; color: string | null; access_instructions: string | null;
    created_at: string;
  };
  const [client, setClient] = useState<ClientRow | null>(null);
  const [clientsLoading, setClientsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setClientsLoading(true);
    supabase
      .from('clients')
      .select('id, name, address, phone, email, default_duration_minutes, default_staff_count, notes, color, access_instructions, created_at')
      .eq('id', id)
      .single()
      .then(({ data }: { data: ClientRow | null }) => {
        setClient(data);
        setClientsLoading(false);
      });
  }, [id, supabase]);

  // Direct update: patch the clients table and reflect locally
  const updateClient = useCallback(async (field: string, value: string | number | null) => {
    if (!id) return;
    await supabase.from('clients').update({ [field]: value }).eq('id', id);
    setClient(prev => prev ? { ...prev, [field]: value } : prev);
  }, [id, supabase]);

  const deleteClientFn = useCallback(async () => {
    if (!id) return;
    await supabase.from('clients').delete().eq('id', id);
  }, [id, supabase]);

  const { checklists, defaultChecklist, loading: checklistsLoading, addChecklist, updateChecklist, deleteChecklist, setDefault } = useClientChecklists(id || null, orgId);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '', email: '', default_duration_minutes: 90, default_staff_count: 1, notes: '', access_instructions: '' });
  const [editingChecklistId, setEditingChecklistId] = useState<string | 'new' | null>(null);
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
        notes: client.notes || '',
        access_instructions: client.access_instructions || '',
      });
    }
  }, [client]);

  const saveField = useCallback(async (field: string, value: string | number) => {
    await updateClient(field, value);
    setEditingField(null);
  }, [updateClient]);

  const handleDelete = async () => {
    if (!id || !confirm('Delete this client and all their data? This cannot be undone.')) return;
    setDeleting(true);
    await deleteClientFn();
    router.push('/dashboard/clients');
  };

  if (clientsLoading) {
    return (
      <div className="h-full overflow-y-auto p-4 lg:p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="shimmer h-28 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary text-sm mb-3">Client not found.</p>
          <button onClick={() => router.push('/dashboard/clients')} className="btn-ghost text-sm">← Back to Clients</button>
        </div>
      </div>
    );
  }

  const totalItems = checklists.reduce((sum, cl) => sum + cl.sections.reduce((s, sec) => s + sec.fields.length, 0), 0);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-2xl mx-auto p-4 lg:p-6 space-y-5 pb-20">

        {/* Back navigation */}
        <button onClick={() => router.push('/dashboard/clients')}
          className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors group">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="group-hover:-translate-x-0.5 transition-transform"><polyline points="15 18 9 12 15 6" /></svg>
          All Clients
        </button>

        {/* Header card */}
        <div className="card p-5">
          <div className="flex items-start gap-4">
            {/* Colour dot / picker */}
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
                      {(CLIENT_COLORS as { value: string; name: string }[]).map((c) => (
                        <button key={c.value}
                          onClick={() => { updateClient('color', client.color === c.value ? null : c.value); setShowColorPicker(false); }}
                          className={`w-9 h-9 rounded-xl border-2 transition-all hover:scale-110 flex items-center justify-center ${client.color === c.value ? 'border-gray-700 scale-110 shadow-sm' : 'border-transparent'}`}
                          style={{ backgroundColor: c.value }} title={c.name}>
                          {client.color === c.value && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
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
                    className="input-field text-lg font-bold flex-1" />
                  <button onClick={() => saveField('name', form.name)} className="btn-primary text-xs py-1.5 px-3">Save</button>
                  <button onClick={() => setEditingField(null)} className="btn-ghost text-xs py-1.5">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setEditingField('name')}
                  className="group flex items-center gap-2 text-left w-full">
                  <h1 className="text-xl font-bold text-text-primary">{client.name}</h1>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
              <p className="text-sm text-text-tertiary mt-0.5 truncate">{client.address}</p>
              <p className="text-xs text-text-tertiary mt-1">Added {new Date(client.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            </div>

            <button onClick={handleDelete} disabled={deleting}
              className="p-2 rounded-xl hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Contact & Job Details */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-text-primary">Contact & Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['phone', 'email', 'default_duration_minutes', 'default_staff_count'] as const).map(field => (
              <div key={field}>
                <label className="block text-xs font-medium text-text-secondary mb-1 capitalize">
                  {field === 'default_duration_minutes' ? 'Default Duration (min)' : field === 'default_staff_count' ? 'Default Staff Count' : field.charAt(0).toUpperCase() + field.slice(1)}
                </label>
                {editingField === field ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      type={field.includes('_') ? 'number' : field === 'email' ? 'email' : 'text'}
                      value={form[field]}
                      onChange={e => setForm(f => ({ ...f, [field]: field.includes('_') ? Number(e.target.value) : e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveField(field, form[field]); if (e.key === 'Escape') setEditingField(null); }}
                      className="input-field text-sm flex-1 py-1.5"
                    />
                    <button onClick={() => saveField(field, form[field])} className="btn-primary text-xs py-1 px-2">✓</button>
                    <button onClick={() => setEditingField(null)} className="btn-ghost text-xs py-1 px-2">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setEditingField(field)}
                    className="group flex items-center gap-1.5 w-full text-left px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover transition-colors">
                    <span className="text-sm text-text-primary flex-1">
                      {form[field] || <span className="text-text-tertiary italic">Not set</span>}
                    </span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary opacity-0 group-hover:opacity-100 shrink-0 transition-opacity">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Access Instructions */}
        <div className="card p-5">
          <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
            Access Instructions
          </h3>
          <textarea
            value={form.access_instructions}
            onChange={e => setForm(f => ({ ...f, access_instructions: e.target.value }))}
            onBlur={() => saveField('access_instructions', form.access_instructions)}
            placeholder="How to get in, alarm code, key location, gate code, pets, special notes for staff…"
            className="input-field text-sm resize-none w-full"
            rows={4}
          />
          <p className="text-[11px] text-text-tertiary mt-1.5">Auto-saves on blur · Shown to staff in the schedule job panel</p>
        </div>

        {/* Notes */}
        <div className="card p-5">
          <h3 className="text-sm font-bold text-text-primary mb-3">Internal Notes</h3>
          <textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            onBlur={() => saveField('notes', form.notes)}
            placeholder="Internal admin notes…"
            className="input-field text-sm resize-none w-full"
            rows={3}
          />
        </div>

        {/* Media */}
        {orgId && (
          <div className="card p-5">
            <MediaSection clientId={id} orgId={orgId} />
          </div>
        )}

        {/* Checklists */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-text-primary">Checklists</h3>
              <p className="text-xs text-text-tertiary mt-0.5">
                {checklists.length} checklist{checklists.length !== 1 ? 's' : ''} · {totalItems} items total
              </p>
            </div>
            <button onClick={() => setEditingChecklistId('new')}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Checklist
            </button>
          </div>

          {/* New checklist editor */}
          <AnimatePresence>
            {editingChecklistId === 'new' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mb-4">
                <div className="bg-surface-elevated rounded-xl p-4">
                  <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">New Checklist</h4>
                  <ChecklistBuilder
                    mode="builder"
                    checklist={{ id: 'new', org_id: orgId || '', client_id: id, name: '', is_default: checklists.length === 0, sections: [], created_at: '', updated_at: '' }}
                    compact={false}
                    onSaveTemplate={async ({ name, sections }) => {
                      await addChecklist(name, sections, checklists.length === 0);
                      setEditingChecklistId(null);
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {checklistsLoading ? (
            <div className="space-y-2">{[1, 2].map(i => <div key={i} className="shimmer h-16 rounded-xl" />)}</div>
          ) : checklists.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-border-light rounded-xl">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-2">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <path d="M9 12h6M9 16h4" />
              </svg>
              <p className="text-sm text-text-tertiary">No checklists yet</p>
              <p className="text-xs text-text-tertiary mt-1">Create one above to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {checklists.map((cl) => (
                <div key={cl.id}>
                  <motion.div layout className="rounded-xl border border-border-light overflow-hidden">
                    <div className="flex items-center gap-3 p-3 bg-white hover:bg-surface-elevated transition-colors">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${cl.is_default ? 'bg-primary' : 'bg-border-light'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-text-primary">{cl.name}</span>
                          {cl.is_default && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-primary-light text-primary">Default</span>
                          )}
                        </div>
                      <p className="text-xs text-text-tertiary">
                          {cl.sections.length} section{cl.sections.length !== 1 ? 's' : ''} · {cl.sections.reduce((s, sec) => s + sec.fields.length, 0)} fields
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!cl.is_default && (
                          <button onClick={() => setDefault(cl.id)}
                            className="text-[10px] font-medium px-2 py-1 rounded-lg hover:bg-primary-light hover:text-primary text-text-tertiary transition-colors">
                            Set Default
                          </button>
                        )}
                        <button onClick={() => setEditingChecklistId(editingChecklistId === cl.id ? null : cl.id)}
                          className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary transition-colors">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        {checklists.length > 1 && (
                          <button onClick={() => { if (confirm(`Delete "${cl.name}"?`)) deleteChecklist(cl.id); }}
                            className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    <AnimatePresence>
                      {editingChecklistId === cl.id && (
                        <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                          className="overflow-hidden border-t border-border-light">
                          <div className="p-4 bg-surface-elevated">
                            <ChecklistBuilder
                              mode="builder"
                              checklist={cl}
                              compact={false}
                              onSaveTemplate={async ({ name, sections }) => {
                                await updateChecklist(cl.id, { name, sections, is_default: cl.is_default });
                                setEditingChecklistId(null);
                              }}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
