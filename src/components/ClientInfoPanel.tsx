'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

interface MediaItem { id: string; file_name: string; file_path: string; file_type: 'image' | 'video'; caption: string; created_at: string; }

interface ClientInfoPanelProps {
  clientId: string;
  clientName: string;
  scheduleJobId?: string;
  onClose: () => void;
}

export default function ClientInfoPanel({ clientId, clientName, onClose }: ClientInfoPanelProps) {
  const supabase = useMemo(() => createClient(), []);

  const [clientNotes, setClientNotes] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [previewMedia, setPreviewMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: client } = await supabase.from('clients')
      .select('notes, address, email, phone')
      .eq('id', clientId).single();

    if (client) {
      setClientNotes(client.notes || '');
      setClientAddress(client.address || '');
      setClientEmail(client.email || '');
      setClientPhone(client.phone || '');
    }

    const { data: mediaData } = await supabase.from('client_media')
      .select('*').eq('client_id', clientId).order('created_at', { ascending: false });
    if (mediaData) setMedia(mediaData as MediaItem[]);

    setLoading(false);
  }, [supabase, clientId]);

  useEffect(() => { loadData(); }, [loadData]);

  const hasContact = !!(clientEmail || clientPhone);
  const hasNotes = !!clientNotes;
  const hasMedia = media.length > 0;
  const hasAddress = !!clientAddress;
  const isEmpty = !hasContact && !hasNotes && !hasMedia && !hasAddress;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}>
      <motion.div
        initial={{ y: '100%', opacity: 0.8 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#f5f6fa] rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">

        {/* ── Handle bar (mobile pull indicator) ── */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* ── Header ── */}
        <div className="px-5 pt-3 sm:pt-5 pb-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-extrabold text-text-primary truncate tracking-tight">{clientName}</h3>
              {hasAddress && (
                <p className="text-xs text-text-tertiary truncate mt-0.5">{clientAddress}</p>
              )}
            </div>
            <button onClick={onClose}
              className="p-2 rounded-xl bg-white border border-border-light text-text-tertiary shrink-0 active:scale-90 transition-transform ml-3">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Quick actions row */}
          {(hasContact || hasAddress) && (
            <div className="flex gap-2 mt-3">
              {clientPhone && (
                <a href={`tel:${clientPhone}`}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-border-light text-text-primary text-xs font-semibold active:scale-95 transition-transform shadow-sm">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  {clientPhone}
                </a>
              )}
              {clientEmail && (
                <a href={`mailto:${clientEmail}`}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-border-light text-text-primary text-xs font-semibold active:scale-95 transition-transform shadow-sm truncate min-w-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2.5" className="shrink-0">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <span className="truncate">{clientEmail}</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-6">
          {loading ? (
            <div className="space-y-3 pt-1">
              <div className="shimmer h-24 rounded-2xl" />
              <div className="shimmer h-16 rounded-2xl" />
              <div className="shimmer h-32 rounded-2xl" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white border border-border-light flex items-center justify-center mb-3">
                <span className="text-3xl">📋</span>
              </div>
              <p className="text-sm font-semibold text-text-secondary">No info saved yet</p>
              <p className="text-xs text-text-tertiary mt-1">Ask your admin to add access notes and photos for this client.</p>
            </div>
          ) : (
            <div className="space-y-4 pt-1">

              {/* ── Access & Notes ── */}
              <div className="bg-white rounded-2xl border border-border-light overflow-hidden">
                <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                  <h4 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">Access & Notes</h4>
                </div>
                {hasNotes ? (
                  <div className="px-4 pb-4">
                    <div className="bg-amber-50/70 rounded-xl px-3.5 py-3">
                      <p className="text-[13px] text-text-primary whitespace-pre-wrap leading-relaxed">{clientNotes}</p>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 pb-4">
                    <p className="text-xs text-text-tertiary italic">No access notes added.</p>
                  </div>
                )}
              </div>

              {/* ── Photos & Videos ── */}
              {hasMedia && (
                <div className="bg-white rounded-2xl border border-border-light overflow-hidden">
                  <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
                    <div className="flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <h4 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">Photos & Videos</h4>
                    </div>
                    <span className="text-[10px] font-semibold text-text-tertiary bg-surface-elevated px-2 py-0.5 rounded-lg">
                      {media.length}
                    </span>
                  </div>
                  <div className="px-4 pb-4">
                    {media.length === 1 ? (
                      /* Single image — show it large */
                      <div className="rounded-xl overflow-hidden border border-border-light">
                        {media[0].file_type === 'image' ? (
                          <img src={media[0].file_path} alt={media[0].caption || media[0].file_name}
                            className="w-full max-h-64 object-cover cursor-pointer" onClick={() => setPreviewMedia(media[0])} />
                        ) : (
                          <div className="w-full h-48 flex items-center justify-center bg-gray-900 cursor-pointer relative" onClick={() => setPreviewMedia(media[0])}>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="white" stroke="none" opacity="0.9"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            <div className="absolute bottom-2 left-2 text-[10px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">VIDEO</div>
                          </div>
                        )}
                      </div>
                    ) : media.length === 2 ? (
                      /* Two items — side by side, slightly taller */
                      <div className="grid grid-cols-2 gap-2">
                        {media.map(item => (
                          <div key={item.id} className="relative rounded-xl overflow-hidden border border-border-light aspect-[4/3]">
                            {item.file_type === 'image' ? (
                              <img src={item.file_path} alt={item.caption || item.file_name}
                                className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewMedia(item)} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gray-900 cursor-pointer" onClick={() => setPreviewMedia(item)}>
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="none" opacity="0.9"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                <div className="absolute bottom-1.5 left-1.5 text-[10px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">VIDEO</div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* 3+ items — grid */
                      <div className="grid grid-cols-3 gap-1.5">
                        {media.map(item => (
                          <div key={item.id} className="relative rounded-xl overflow-hidden border border-border-light aspect-square">
                            {item.file_type === 'image' ? (
                              <img src={item.file_path} alt={item.caption || item.file_name}
                                className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewMedia(item)} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gray-900 cursor-pointer" onClick={() => setPreviewMedia(item)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none" opacity="0.9"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                <div className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/60 text-white px-1 py-0.5 rounded">VIDEO</div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </motion.div>

      {/* ═══ MEDIA PREVIEW MODAL ═══ */}
      <AnimatePresence>
        {previewMedia && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4"
            onClick={() => setPreviewMedia(null)}>
            <button onClick={() => setPreviewMedia(null)}
              className="absolute top-4 right-4 p-2.5 rounded-xl bg-white/10 text-white hover:bg-white/20 z-10 active:scale-90 transition-transform">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
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
