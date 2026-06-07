'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import PlacesAutocomplete from './PlacesAutocomplete';
import { formatTimeDisplay, parseTime } from '@/lib/timeUtils';
import { Client, Location, ScheduleAction, TeamSchedule, StaffMember } from '@/lib/types';
import { SavedClient } from '@/lib/hooks/useClients';
import { createClient as createSupabaseClient } from '@/lib/supabase/client';

export type StaffBusyPeriod = { start: number; end: number; teamName: string; clientName: string; clientId: string };



interface ClientCardProps {
  client: Client;
  index: number;
  totalClients: number;
  team: TeamSchedule;
  dispatch: React.Dispatch<ScheduleAction>;
  availableStaff?: StaffMember[];
  staffBusyPeriods?: Map<string, StaffBusyPeriod[]>;
  /** Staff driving for other teams today — staffId → teamName */
  driverAssignments?: Map<string, string>;
  savedClients?: SavedClient[];
  onOpenChecklist?: (client: Client) => void;
}

export default function ClientCard({ client, index, totalClients, team, dispatch, availableStaff, staffBusyPeriods, driverAssignments, savedClients, onOpenChecklist }: ClientCardProps) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [addressText, setAddressText] = useState('');
  const [hasEdited, setHasEdited] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [addressVersion, setAddressVersion] = useState(0);
  const [editingStartTime, setEditingStartTime] = useState(false);
  const [showStaffPicker, setShowStaffPicker] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [swapQuery, setSwapQuery] = useState('');
  const swapInputRef = useRef<HTMLInputElement>(null);
  const placesLib = useMapsLibrary('places');
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);

  // ── Checklist picker state ──────────────────────────────────────────────────
  const [showChecklistPicker, setShowChecklistPicker] = useState(false);
  const [availableChecklists, setAvailableChecklists] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(false);
  const checklistPickerRef = useRef<HTMLDivElement>(null);

  // Close checklist picker on outside click
  useEffect(() => {
    if (!showChecklistPicker) return;
    const handler = (e: MouseEvent) => {
      if (checklistPickerRef.current && !checklistPickerRef.current.contains(e.target as Node)) {
        setShowChecklistPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showChecklistPicker]);

  const handleChecklistButtonClick = useCallback(async () => {
    if (!client.savedClientId || !onOpenChecklist) return;

    // If only one checklist or already know them, open directly
    if (availableChecklists.length === 1) {
      const cl = availableChecklists[0];
      if (client.checklistId !== cl.id) {
        dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { checklistId: cl.id } });
      }
      onOpenChecklist({ ...client, checklistId: cl.id });
      return;
    }
    if (availableChecklists.length > 1) {
      setShowChecklistPicker(prev => !prev);
      return;
    }

    // First click — fetch checklists
    setChecklistsLoading(true);
    const { data } = await supabase
      .from('client_checklists')
      .select('id, name, is_default')
      .eq('client_id', client.savedClientId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    setChecklistsLoading(false);
    const list = data || [];
    setAvailableChecklists(list);

    if (list.length <= 1) {
      // Zero or one checklist — open the panel immediately
      const selectedId = list[0]?.id || client.checklistId || null;
      if (selectedId && client.checklistId !== selectedId) {
        dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { checklistId: selectedId } });
      }
      onOpenChecklist({ ...client, checklistId: selectedId ?? undefined });
    } else {
      // Multiple — show picker
      setShowChecklistPicker(true);
    }
  }, [client, team.id, dispatch, onOpenChecklist, availableChecklists, supabase]);

  const handleSelectChecklist = useCallback((checklistId: string) => {
    dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { checklistId } });
    setShowChecklistPicker(false);
    if (onOpenChecklist) onOpenChecklist({ ...client, checklistId });
  }, [client, team.id, dispatch, onOpenChecklist]);

  // Close staff picker on outside click
  useEffect(() => {
    if (!showStaffPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
          pickerBtnRef.current && !pickerBtnRef.current.contains(e.target as Node)) {
        setShowStaffPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showStaffPicker]);

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
  const assignedIds = client.assignedStaffIds || [];
  const effectiveStaffCount = client.staffCount || 1;

  const handleFixedTimeChange = (time: string) => { dispatch({ type: 'SET_FIXED_START_TIME', teamId: team.id, clientId: client.id, time: time || undefined }); };
  const clearFixedTime = () => { dispatch({ type: 'SET_FIXED_START_TIME', teamId: team.id, clientId: client.id, time: undefined }); setEditingStartTime(false); };

  // Staff assignment helpers
  const assignedStaffMembers = (availableStaff || []).filter(s => assignedIds.includes(s.id));
  // Separate staff into available vs busy (for this job's time window) vs driving-other-team
  const { freeStaff, busyStaff, drivingOtherStaff } = (() => {
    const notAssigned = (availableStaff || []).filter(s => !assignedIds.includes(s.id));
    // First, pull out staff driving for other teams
    const driving: { staff: StaffMember; teamName: string }[] = [];
    const remaining: StaffMember[] = [];
    for (const s of notAssigned) {
      const drivingTeam = driverAssignments?.get(s.id);
      if (drivingTeam) {
        driving.push({ staff: s, teamName: drivingTeam });
      } else {
        remaining.push(s);
      }
    }
    if (!client.startTime || !client.endTime || !staffBusyPeriods) {
      return { freeStaff: remaining, busyStaff: [] as { staff: StaffMember; conflict: StaffBusyPeriod }[], drivingOtherStaff: driving };
    }
    const jobStart = parseTime(client.startTime);
    const jobEnd = parseTime(client.endTime);
    const free: StaffMember[] = [];
    const busy: { staff: StaffMember; conflict: StaffBusyPeriod }[] = [];
    for (const s of remaining) {
      const periods = staffBusyPeriods.get(s.id) || [];
      // Find the first overlapping period (excluding this same job)
      const conflict = periods.find(p => p.clientId !== client.id && p.start < jobEnd && p.end > jobStart);
      if (conflict) busy.push({ staff: s, conflict });
      else free.push(s);
    }
    return { freeStaff: free, busyStaff: busy, drivingOtherStaff: driving };
  })();


  // Focus swap search input when panel opens
  useEffect(() => {
    if (showSwap) {
      setTimeout(() => swapInputRef.current?.focus(), 50);
    } else {
      setSwapQuery('');
    }
  }, [showSwap]);

  // Filtered swap results
  const swapResults = useMemo(() => {
    if (!savedClients || swapQuery.trim().length < 1) return savedClients?.slice(0, 6) ?? [];
    const q = swapQuery.toLowerCase();
    return savedClients.filter(
      (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [swapQuery, savedClients]);

  const handleSwapClient = (saved: SavedClient) => {
    dispatch({
      type: 'UPDATE_CLIENT',
      teamId: team.id,
      clientId: client.id,
      updates: {
        name: saved.name,
        location: {
          address: saved.address,
          lat: saved.lat || 0,
          lng: saved.lng || 0,
          placeId: saved.place_id || undefined,
        },
        jobDurationMinutes: saved.default_duration_minutes || client.jobDurationMinutes,
        staffCount: 1,
        savedClientId: saved.id,
        notes: saved.notes || undefined,
        clientColor: saved.color || undefined,
        rate: saved.rate ?? undefined,
        assignedStaffIds: [],
      },
    });
    setShowSwap(false);
    setAddressVersion((v) => v + 1);

    // Background geocode if coordinates are missing
    if (!saved.lat || !saved.lng) {
      resolveAddress(saved.address).then((resolved) => {
        if (resolved) {
          dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { location: resolved } });
        }
      });
    }
  };

  // Use client color if set, otherwise fall back to team color
  const cardColor = client.clientColor || team.color.primary;

  return (
    <motion.div layout initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`card p-4 group ${client.isLocked ? 'ring-2 ring-amber-300' : ''}`}
      style={{
        borderLeft: `3px solid ${cardColor}`,
        backgroundColor: client.clientColor ? `${client.clientColor}08` : undefined,
      }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Reorder arrows — stacked vertically to keep the right toolbar slim */}
          <div className="flex flex-col gap-0.5 shrink-0">
            <button
              onClick={() => dispatch({ type: 'REORDER_CLIENTS', teamId: team.id, fromIndex: index, toIndex: index - 1 })}
              disabled={index === 0}
              className="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-0 disabled:pointer-events-none"
              title="Move up"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button
              onClick={() => dispatch({ type: 'REORDER_CLIENTS', teamId: team.id, fromIndex: index, toIndex: index + 1 })}
              disabled={index === totalClients - 1}
              className="p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-0 disabled:pointer-events-none"
              title="Move down"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
          {/* Index badge */}
          <div className="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold text-white shrink-0 relative" style={{ backgroundColor: cardColor }}>
            {index + 1}
            {client.isLocked && <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center text-[8px]">🔒</div>}
          </div>
          <input type="text" value={client.name} onChange={(e) => dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { name: e.target.value } })}
            className="font-semibold text-sm bg-transparent border-none outline-none flex-1 min-w-0 text-text-primary hover:bg-surface-elevated focus:bg-surface-elevated px-2 py-1 -ml-2 rounded-md transition-colors" placeholder="Client name" />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Swap client button */}
          {savedClients && savedClients.length > 0 && (
            <button
              onClick={() => setShowSwap(!showSwap)}
              className={`p-1.5 rounded-lg transition-colors ${
                showSwap ? 'bg-primary/10 text-primary' : 'hover:bg-surface-elevated text-text-tertiary hover:text-text-primary'
              }`}
              title="Swap client from database"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 16V4m0 0L3 8m4-4l4 4"/>
                <path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
              </svg>
            </button>
          )}
          <button onClick={() => setEditingStartTime(!editingStartTime)} className={`p-1.5 rounded-lg transition-colors ${client.fixedStartTime ? 'bg-indigo-50 text-primary' : 'hover:bg-surface-elevated text-text-tertiary hover:text-text-primary'}`} title="Override start time">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          <button onClick={() => dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { isLocked: !client.isLocked } })} className={`p-1.5 rounded-lg transition-colors ${client.isLocked ? 'bg-amber-50 text-amber-600' : 'hover:bg-surface-elevated text-text-tertiary hover:text-text-primary'}`} title="Lock position">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{client.isLocked ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></> : <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>}</svg>
          </button>
          {/* Checklist picker — only shown for saved clients */}
          {client.savedClientId && onOpenChecklist && (
            <div className="relative" ref={checklistPickerRef}>
              <button
                onClick={handleChecklistButtonClick}
                disabled={checklistsLoading}
                className={`relative p-1.5 rounded-lg transition-colors ${
                  client.checklistId
                    ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                    : 'hover:bg-surface-elevated text-text-tertiary hover:text-primary'
                }`}
                title={client.checklistId ? 'Change checklist for this job' : 'Select checklist for this job'}
              >
                {checklistsLoading ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                    <path d="M9 12h6M9 16h4"/>
                  </svg>
                )}
                {client.checklistId && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
                )}
              </button>

              {/* Multi-checklist picker dropdown */}
              <AnimatePresence>
                {showChecklistPicker && availableChecklists.length > 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 bottom-full mb-1.5 z-40 w-56 bg-white rounded-xl shadow-lg border border-border-light p-2"
                  >
                    <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 py-1 mb-1">
                      Select checklist for this job
                    </div>
                    {availableChecklists.map(cl => (
                      <button
                        key={cl.id}
                        onClick={() => handleSelectChecklist(cl.id)}
                        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors text-left ${
                          client.checklistId === cl.id
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'hover:bg-surface-hover text-text-primary'
                        }`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                          <rect x="9" y="3" width="6" height="4" rx="1"/>
                        </svg>
                        <span className="flex-1 font-medium truncate">{cl.name}</span>
                        {cl.is_default && (
                          <span className="text-[9px] font-bold text-text-tertiary uppercase shrink-0">default</span>
                        )}
                        {client.checklistId === cl.id && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-emerald-500 shrink-0">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          <a href={mapsNavUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-primary transition-colors" title="Navigate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
          </a>
          <button onClick={() => dispatch({ type: 'REMOVE_CLIENT', teamId: team.id, clientId: client.id })} className="p-1.5 rounded-lg hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
      </div>

      {/* Swap client panel */}
      <AnimatePresence>
        {showSwap && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden mb-3"
          >
            <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
              <div className="flex items-center gap-2 mb-2">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary shrink-0">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
                <span className="text-xs font-semibold text-primary">Swap Client</span>
                <button onClick={() => setShowSwap(false)} className="ml-auto p-0.5 rounded hover:bg-red-50 text-text-tertiary hover:text-red-400 transition-colors">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
              {/* Search input */}
              <div className="relative mb-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  ref={swapInputRef}
                  type="text"
                  value={swapQuery}
                  onChange={(e) => setSwapQuery(e.target.value)}
                  placeholder={`Search ${savedClients?.length ?? 0} clients...`}
                  className="input-field text-xs py-2"
                  style={{ paddingLeft: '2.5rem' }}
                />
              </div>
              {/* Results */}
              <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-0.5">
                {swapResults.length === 0 && swapQuery.length > 0 ? (
                  <p className="text-xs text-text-tertiary text-center py-3">No clients found</p>
                ) : (
                  swapResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSwapClient(c)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg hover:bg-white transition-colors border border-transparent hover:border-border-light group/swap ${
                        c.id === client.savedClientId ? 'bg-white border-primary/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {c.color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                        <span className="text-xs font-semibold text-text-primary truncate flex-1">{c.name}</span>
                        {c.id === client.savedClientId && (
                          <span className="text-[10px] text-primary font-bold shrink-0">current</span>
                        )}
                      </div>
                      <div className="text-[11px] text-text-tertiary truncate mt-0.5">{c.address}</div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-text-secondary">
                        <span>{(c.default_duration_minutes / 60).toFixed(1)}h</span>
                        <span>·</span>
                        <span>{c.default_staff_count} staff</span>
                        {c.phone && <><span>·</span><span>{c.phone}</span></>}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        {client.savedClientId ? (
          // Saved client — address is locked to what's in the database
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-elevated border border-border-light">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="text-sm text-text-secondary flex-1 truncate">{client.location.address}</span>
            <span className="text-[10px] text-text-tertiary shrink-0 italic">Edit in Clients tab</span>
          </div>
        ) : (
          // Manual / unsaved client — allow address editing
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
        )}
      </div>

      {/* Duration + Staff Count + Times */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <input type="number" value={durationHours} onChange={(e) => { const h = parseFloat(e.target.value) || 0; dispatch({ type: 'UPDATE_CLIENT', teamId: team.id, clientId: client.id, updates: { jobDurationMinutes: Math.round(h * 60) } }); }}
              className="w-16 text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary text-center" min={0.25} step={0.25} />
            <span className="text-xs text-text-tertiary">hrs</span>
          </div>
          {/* Staff count indicator */}
          {effectiveStaffCount > 1 && (
            <div className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg" style={{ backgroundColor: `${cardColor}10`, color: cardColor }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>{effectiveStaffCount}</span>
              <span className="text-text-tertiary font-normal">({(client.jobDurationMinutes / effectiveStaffCount / 60).toFixed(1)}h eff.)</span>
            </div>
          )}
          {/* Client rate badge */}
          {client.rate != null && client.rate > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">
              <span>${client.rate}/hr</span>
            </div>
          )}
        </div>
        {client.startTime && client.endTime && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 text-sm">
            {client.fixedStartTime && <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-primary shrink-0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>}
            <span className="font-medium" style={{ color: cardColor }}>{formatTimeDisplay(client.startTime)}</span>
            <span className="text-text-tertiary">–</span>
            <span className="font-medium" style={{ color: cardColor }}>{formatTimeDisplay(client.endTime)}</span>
          </motion.div>
        )}
      </div>

      {/* Revenue from client rate */}
      {client.rate != null && client.rate > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 pl-6">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span>{(client.jobDurationMinutes / 60).toFixed(1)}hrs × ${client.rate}/hr = <strong>${(client.jobDurationMinutes / 60 * client.rate).toFixed(2)}</strong></span>
        </div>
      )}


    </motion.div>
  );
}
