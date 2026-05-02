'use client';

import { useState, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import PlacesAutocomplete from './PlacesAutocomplete';
import { formatTimeDisplay } from '@/lib/timeUtils';
import { Client, Location, ScheduleAction, TeamSchedule } from '@/lib/types';

const StaffChecklistView = lazy(() => import('./StaffChecklistView'));

interface ClientCardProps { client: Client; index: number; totalClients: number; team: TeamSchedule; dispatch: React.Dispatch<ScheduleAction>; }

export default function ClientCard({ client, index, totalClients, team, dispatch }: ClientCardProps) {
  const [addressText, setAddressText] = useState('');
  const [hasEdited, setHasEdited] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [addressVersion, setAddressVersion] = useState(0);
  const [editingStartTime, setEditingStartTime] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const placesLib = useMapsLibrary('places');

  const resolveAddress = useCallback(async (text: string): Promise<Location | null> => {
    if (!placesLib) return null;
    const svc = new placesLib.AutocompleteService();
    return new Promise((resolve) => {
      svc.getPlacePredictions({ input: text, componentRestrictions: { country: 'au' }, types: ['address'] }, (preds, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !preds?.length) { resolve(null); return; }
        const div = document.createElement('div');
        const ps = new placesLib.PlacesService(div);
        ps.getDetails({ placeId: preds[0].place_id, fields: ['formatted_address', 'geometry', 'place_id', 'name'] }, (place, s) => {
          if (s === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
            resolve({ address: place.formatted_address || place.name || preds[0].description, lat: place.geometry.location.lat(), lng: place.geometry.location.lng(), placeId: place.place_id });
          } else resolve(null);
        });
      });
    });
  }, [placesLib]);

  const handleConfirmAddress = async () => {
    const text = addressText.trim(); if (!text) return;
    setIsResolving(true);
    const resolved = await resolveAddress(text);
    setIsResolving(false);
    if (resolved) { dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { location: resolved } }); setHasEdited(false); setAddressText(''); setAddressVersion((v) => v + 1); }
  };

  const handleCancelEdit = () => { setHasEdited(false); setAddressText(''); setAddressVersion((v) => v + 1); };
  const mapsNavUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(client.location.address)}&destination_place_id=${client.location.placeId || ''}`;
  const durationHours = client.jobDurationMinutes / 60;
  const effectiveDuration = client.jobDurationMinutes / (client.staffCount || 1);

  const handleFixedTimeChange = (time: string) => { dispatch({ type: 'SET_FIXED_START_TIME', teamId: team.id, clientId: client.id, time: time || undefined }); setEditingStartTime(false); };
  const clearFixedTime = () => { dispatch({ type: 'SET_FIXED_START_TIME', teamId: team.id, clientId: client.id, time: undefined }); setEditingStartTime(false); };

  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`card p-4 group ${client.isLocked ? 'ring-2 ring-amber-300' : ''}`}
      style={{ borderLeft: `3px solid ${team.color.primary}` }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold text-white shrink-0 relative" style={{ backgroundColor: team.color.primary }}>
            {index + 1}
            {client.isLocked && <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[8px]">🔒</div>}
          </div>
          <input type="text" value={client.name} onChange={(e) => dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { name: e.target.value } })}
            className="font-semibold text-sm bg-transparent border-none outline-none flex-1 min-w-0 text-text-primary hover:bg-surface-elevated focus:bg-surface-elevated px-2 py-1 -ml-2 rounded-md transition-colors" placeholder="Client name" />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => setEditingStartTime(!editingStartTime)} className={`p-1.5 rounded-lg transition-colors ${client.fixedStartTime ? 'bg-indigo-50 text-primary' : 'hover:bg-surface-elevated text-text-tertiary hover:text-text-primary'}`} title="Override start time">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          <button onClick={() => dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { isLocked: !client.isLocked } })} className={`p-1.5 rounded-lg transition-colors ${client.isLocked ? 'bg-amber-50 text-amber-600' : 'hover:bg-surface-elevated text-text-tertiary hover:text-text-primary'}`} title="Lock position">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{client.isLocked ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></> : <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>}</svg>
          </button>
          <button onClick={() => setShowChecklist(true)} className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-emerald-600 transition-colors" title="Checklist">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          </button>
          <a href={mapsNavUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-primary transition-colors" title="Navigate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
          </a>
          {index > 0 && <button onClick={() => dispatch({ type: 'REORDER_CLIENTS', teamId: team.id, fromIndex: index, toIndex: index - 1 })} className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors" title="Move up"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg></button>}
          {index < totalClients - 1 && <button onClick={() => dispatch({ type: 'REORDER_CLIENTS', teamId: team.id, fromIndex: index, toIndex: index + 1 })} className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors" title="Move down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg></button>}
          <button onClick={() => dispatch({ type: 'REMOVE_CLIENT', teamId: team.id, clientId: client.id })} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
      </div>

      {/* Fixed start time editor */}
      <AnimatePresence>
        {editingStartTime && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-3">
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-indigo-50 border border-indigo-100">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span className="text-xs font-medium text-primary">Pin start time:</span>
              <input type="time" defaultValue={client.fixedStartTime || client.startTime || '09:00'} onChange={(e) => handleFixedTimeChange(e.target.value)}
                className="text-sm font-medium bg-white border border-indigo-200 rounded-lg px-2 py-1 outline-none focus:border-primary" />
              {client.fixedStartTime && <button onClick={clearFixedTime} className="text-xs text-text-tertiary hover:text-danger transition-colors ml-auto">Clear</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Address */}
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <div className="flex-1">
            <PlacesAutocomplete key={`addr-${client.id}-${addressVersion}`}
              onPlaceSelect={(loc) => { dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { location: loc } }); setHasEdited(false); setAddressText(''); }}
              onTextChange={(text) => { setAddressText(text); setHasEdited(text !== client.location.address); }}
              defaultValue={client.location.address} placeholder="Enter client address..." className="text-sm" />
          </div>
          <AnimatePresence>
            {hasEdited && addressText.trim().length > 0 && (
              <motion.div initial={{ opacity: 0, scale: 0.8, width: 0 }} animate={{ opacity: 1, scale: 1, width: 'auto' }} exit={{ opacity: 0, scale: 0.8, width: 0 }} className="flex items-center gap-1 shrink-0 overflow-hidden">
                <button onClick={handleConfirmAddress} disabled={isResolving} className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50" title="Confirm">
                  {isResolving ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
                <button onClick={handleCancelEdit} className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors" title="Cancel">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Duration + Staff + Times */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <input type="number" value={durationHours} onChange={(e) => { const h = parseFloat(e.target.value) || 0; dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { jobDurationMinutes: Math.round(h * 60) } }); }}
            className="w-16 text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary text-center" min={0.25} step={0.25} />
          <span className="text-xs text-text-tertiary">hrs</span>
          <div className="flex items-center gap-1 ml-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            <select value={client.staffCount || 1} onChange={(e) => dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { staffCount: Number(e.target.value) } })}
              className="text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary cursor-pointer">
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
            </select>
          </div>
          {(client.staffCount || 1) > 1 && <span className="text-xs text-text-tertiary ml-1">= {(effectiveDuration / 60).toFixed(1)}h each</span>}
        </div>
        {client.startTime && client.endTime && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 text-sm">
            {client.fixedStartTime && <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-primary shrink-0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>}
            <span className="font-medium" style={{ color: team.color.primary }}>{formatTimeDisplay(client.startTime)}</span>
            <span className="text-text-tertiary">–</span>
            <span className="font-medium" style={{ color: team.color.primary }}>{formatTimeDisplay(client.endTime)}</span>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {showChecklist && <Suspense fallback={null}><StaffChecklistView clientId={client.savedClientId || client.id} clientName={client.name} onClose={() => setShowChecklist(false)} /></Suspense>}
      </AnimatePresence>
    </motion.div>
  );
}
