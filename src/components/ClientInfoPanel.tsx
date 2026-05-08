'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

interface ChecklistItem { id: string; text: string; completed: boolean; }
interface MediaItem { id: string; file_name: string; file_path: string; file_type: 'image' | 'video'; caption: string; created_at: string; }

interface ClientInfoPanelProps {
  clientId: string;
  clientName: string;
  scheduleJobId?: string;
  onClose: () => void;
}

type Tab = 'info' | 'checklist' | 'media';

export default function ClientInfoPanel({ clientId, clientName, scheduleJobId, onClose }: ClientInfoPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [activeTab, setActiveTab] = useState<Tab>('info');

  // ── Client info state ──
  const [clientNotes, setClientNotes] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  // ── Checklist state ──
  const [checkItems, setCheckItems] = useState<ChecklistItem[]>([]);
  const [checkNotes, setCheckNotes] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [checkSaving, setCheckSaving] = useState(false);
  const [checkSaved, setCheckSaved] = useState(false);

  // ── Media state ──
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [previewMedia, setPreviewMedia] = useState<MediaItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);

  // ── Load all client data ──
  const loadData = useCallback(async () => {
    setLoading(true);
    // Load client details
    const { data: client } = await supabase.from('clients')
      .select('notes, address, email, phone, checklist_template_id, custom_checklist_items')
      .eq('id', clientId).single();

    if (client) {
      setClientNotes(client.notes || '');
      setClientAddress(client.address || '');
      setClientEmail(client.email || '');
      setClientPhone(client.phone || '');

      // Load checklist
      if (client.checklist_template_id) {
        setTemplateId(client.checklist_template_id);
        if (client.custom_checklist_items && Array.isArray(client.custom_checklist_items) && client.custom_checklist_items.length > 0) {
          setCheckItems((client.custom_checklist_items as { id: string; text: string }[]).map(it => ({ ...it, completed: false })));
          const { data: tmpl } = await supabase.from('checklist_templates').select('name').eq('id', client.checklist_template_id).single();
          setTemplateName((tmpl?.name || 'Checklist') + ' (Customised)');
        } else {
          const { data: tmpl } = await supabase.from('checklist_templates').select('items, name').eq('id', client.checklist_template_id).single();
          if (tmpl?.items) {
            setCheckItems((tmpl.items as { id: string; text: string }[]).map(it => ({ ...it, completed: false })));
            setTemplateName(tmpl.name || 'Checklist');
          }
        }
      }
    }

    // Load existing completion for this job
    if (scheduleJobId) {
      const { data: completion } = await supabase.from('checklist_completions')
        .select('items, notes').eq('schedule_job_id', scheduleJobId).maybeSingle();
      if (completion?.items) {
        try {
          const parsed = typeof completion.items === 'string' ? JSON.parse(completion.items) : completion.items;
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCheckItems(parsed);
            setCheckNotes(completion.notes || '');
            setCheckSaved(true);
          }
        } catch { /* ignore */ }
      }
    }

    // Load media
    const { data: mediaData } = await supabase.from('client_media')
      .select('*').eq('client_id', clientId).order('created_at', { ascending: false });
    if (mediaData) setMedia(mediaData as MediaItem[]);

    setLoading(false);
  }, [supabase, clientId, scheduleJobId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Checklist handlers ──
  const toggleItem = (id: string) => {
    if (checkSaved) return;
    setCheckItems(prev => prev.map(it => it.id === id ? { ...it, completed: !it.completed } : it));
  };
  const completedCount = checkItems.filter(it => it.completed).length;
  const checkProgress = checkItems.length > 0 ? (completedCount / checkItems.length) * 100 : 0;

  const handleSaveChecklist = async () => {
    if (!templateId) return;
    setCheckSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user!.id).single();
    if (scheduleJobId) {
      const { data: existing } = await supabase.from('checklist_completions').select('id').eq('schedule_job_id', scheduleJobId).maybeSingle();
      if (existing) {
        await supabase.from('checklist_completions').update({
          items: JSON.stringify(checkItems), notes: checkNotes, completed_by: user!.id, completed_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        await supabase.from('checklist_completions').insert({
          org_id: profile!.org_id, client_id: clientId, schedule_job_id: scheduleJobId,
          checklist_template_id: templateId, items: JSON.stringify(checkItems), notes: checkNotes,
          completed_by: user!.id, completed_at: new Date().toISOString(),
        });
      }
    } else {
      await supabase.from('checklist_completions').insert({
        org_id: profile!.org_id, client_id: clientId, checklist_template_id: templateId,
        items: JSON.stringify(checkItems), notes: checkNotes, completed_by: user!.id,
        completed_at: new Date().toISOString(),
      });
    }
    setCheckSaving(false);
    setCheckSaved(true);
  };

  // ── Media handlers ──
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user!.id).single();
    if (!profile?.org_id) { setUploading(false); return; }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(`Uploading ${i + 1} of ${files.length}...`);
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${profile.org_id}/${clientId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const fileType = file.type.startsWith('video/') ? 'video' : 'image';

      const { error: uploadError } = await supabase.storage.from('client-media').upload(path, file, { contentType: file.type });
      if (uploadError) { console.error('Upload error:', uploadError); continue; }

      const { data: urlData } = supabase.storage.from('client-media').getPublicUrl(path);

      await supabase.from('client_media').insert({
        org_id: profile.org_id, client_id: clientId, file_name: file.name,
        file_path: urlData.publicUrl, file_type: fileType, file_size: file.size,
        caption: '', uploaded_by: user!.id,
      });
    }

    setUploading(false);
    setUploadProgress('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Reload media
    const { data: mediaData } = await supabase.from('client_media')
      .select('*').eq('client_id', clientId).order('created_at', { ascending: false });
    if (mediaData) setMedia(mediaData as MediaItem[]);
  };

  const handleDeleteMedia = async (item: MediaItem) => {
    // Extract path from URL for storage deletion
    const url = new URL(item.file_path);
    const pathParts = url.pathname.split('/storage/v1/object/public/client-media/');
    if (pathParts[1]) {
      await supabase.storage.from('client-media').remove([decodeURIComponent(pathParts[1])]);
    }
    await supabase.from('client_media').delete().eq('id', item.id);
    setMedia(prev => prev.filter(m => m.id !== item.id));
    if (previewMedia?.id === item.id) setPreviewMedia(null);
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'info', label: 'Info', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg> },
    { key: 'checklist', label: 'Checklist', badge: checkItems.length || undefined, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> },
    { key: 'media', label: 'Media', badge: media.length || undefined, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-border-light shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-text-primary truncate pr-2">{clientName}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-tertiary shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          {/* Tabs */}
          <div className="flex gap-1">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
                  activeTab === tab.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-hover'
                }`}>
                {tab.icon}
                {tab.label}
                {tab.badge != null && tab.badge > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-surface-elevated text-text-tertiary'
                  }`}>{tab.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="p-5 space-y-3">{[1,2,3].map(i => <div key={i} className="shimmer h-12 rounded-lg" />)}</div>
          ) : (
            <AnimatePresence mode="wait">
              {/* ═══ INFO TAB ═══ */}
              {activeTab === 'info' && (
                <motion.div key="info" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="p-5 space-y-4">
                  {clientAddress && (
                    <div>
                      <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">Address</label>
                      <p className="text-sm text-text-primary">{clientAddress}</p>
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(clientAddress)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary font-medium mt-1.5 hover:underline">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                        Open in Maps
                      </a>
                    </div>
                  )}
                  {(clientEmail || clientPhone) && (
                    <div className="flex gap-4">
                      {clientEmail && (
                        <div>
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">Email</label>
                          <a href={`mailto:${clientEmail}`} className="text-sm text-primary hover:underline">{clientEmail}</a>
                        </div>
                      )}
                      {clientPhone && (
                        <div>
                          <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">Phone</label>
                          <a href={`tel:${clientPhone}`} className="text-sm text-primary hover:underline">{clientPhone}</a>
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">Notes</label>
                    {clientNotes ? (
                      <div className="text-sm text-text-primary bg-surface-elevated rounded-xl p-3 whitespace-pre-wrap">{clientNotes}</div>
                    ) : (
                      <p className="text-sm text-text-tertiary italic">No notes for this client.</p>
                    )}
                  </div>
                  {!clientAddress && !clientEmail && !clientPhone && !clientNotes && (
                    <div className="text-center py-8">
                      <div className="text-3xl mb-2">📋</div>
                      <p className="text-sm text-text-tertiary">No info saved for this client yet.</p>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ═══ CHECKLIST TAB ═══ */}
              {activeTab === 'checklist' && (
                <motion.div key="checklist" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex flex-col">
                  {checkItems.length > 0 && (
                    <div className="px-5 pt-4 pb-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-text-secondary">{templateName}</span>
                        <span className="text-xs text-text-tertiary">{completedCount}/{checkItems.length}</span>
                      </div>
                      <div className="w-full bg-surface-elevated rounded-full h-2 overflow-hidden">
                        <motion.div animate={{ width: `${checkProgress}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                          className="h-full bg-success rounded-full" />
                      </div>
                    </div>
                  )}
                  <div className="p-5 pt-2 space-y-2">
                    {checkItems.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-sm text-text-tertiary">No checklist assigned.</p>
                        <p className="text-xs text-text-tertiary mt-1">Assign one from the Clients page.</p>
                      </div>
                    ) : checkItems.map(item => (
                      <button key={item.id} onClick={() => toggleItem(item.id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${item.completed ? 'bg-success-light border-emerald-200' : 'bg-white border-border-light hover:border-border'} ${checkSaved ? 'pointer-events-none' : ''}`}>
                        <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${item.completed ? 'bg-success border-success text-white' : 'border-border'}`}>
                          {item.completed && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                        <span className={`text-sm ${item.completed ? 'line-through text-text-tertiary' : 'text-text-primary'}`}>{item.text}</span>
                      </button>
                    ))}
                  </div>
                  {checkItems.length > 0 && (
                    <div className="p-5 pt-0 space-y-3">
                      {checkSaved ? (
                        <div className="space-y-2">
                          <div className="text-center py-2">
                            <div className="text-2xl mb-1">✅</div>
                            <p className="text-sm font-semibold text-text-primary">Checklist saved!</p>
                          </div>
                          <button onClick={() => setCheckSaved(false)} className="btn-ghost w-full py-2 text-sm">Edit Checklist</button>
                        </div>
                      ) : (
                        <>
                          <textarea value={checkNotes} onChange={(e) => setCheckNotes(e.target.value)} placeholder="Add notes..."
                            className="input-field text-sm resize-none" rows={2} />
                          <button onClick={handleSaveChecklist} disabled={checkSaving} className="btn-primary w-full py-3 disabled:opacity-50">
                            {checkSaving ? 'Saving...' : checkProgress === 100 ? '✓ Mark Complete' : 'Save Progress'}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {/* ═══ MEDIA TAB ═══ */}
              {activeTab === 'media' && (
                <motion.div key="media" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="p-5 space-y-4">
                  {/* Upload button */}
                  <div>
                    <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple onChange={handleUpload} className="hidden" id="media-upload" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border-light hover:border-primary hover:bg-primary-light/30 text-text-tertiary hover:text-primary transition-all disabled:opacity-50">
                      {uploading ? (
                        <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        <span className="text-sm font-medium">{uploadProgress}</span></>
                      ) : (
                        <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span className="text-sm font-medium">Upload Photos or Videos</span></>
                      )}
                    </button>
                  </div>

                  {/* Media grid */}
                  {media.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-3xl mb-2">📷</div>
                      <p className="text-sm text-text-tertiary">No photos or videos yet.</p>
                      <p className="text-xs text-text-tertiary mt-1">Upload images of access codes, special instructions, etc.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {media.map(item => (
                        <div key={item.id} className="relative group rounded-xl overflow-hidden border border-border-light bg-surface-elevated aspect-square">
                          {item.file_type === 'image' ? (
                            <img src={item.file_path} alt={item.caption || item.file_name}
                              className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewMedia(item)} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-900 cursor-pointer" onClick={() => setPreviewMedia(item)}>
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            </div>
                          )}
                          {/* Delete button */}
                          <button onClick={() => handleDeleteMedia(item)}
                            className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                          </button>
                          {item.file_type === 'video' && (
                            <div className="absolute bottom-1.5 left-1.5 text-[10px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">VIDEO</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </motion.div>

      {/* ═══ MEDIA PREVIEW MODAL ═══ */}
      <AnimatePresence>
        {previewMedia && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setPreviewMedia(null)}>
            <button className="absolute top-4 right-4 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 z-10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <div className="max-w-3xl max-h-[85vh] w-full" onClick={e => e.stopPropagation()}>
              {previewMedia.file_type === 'image' ? (
                <img src={previewMedia.file_path} alt={previewMedia.caption || previewMedia.file_name}
                  className="w-full h-auto max-h-[85vh] object-contain rounded-xl" />
              ) : (
                <video src={previewMedia.file_path} controls autoPlay className="w-full max-h-[85vh] rounded-xl" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
