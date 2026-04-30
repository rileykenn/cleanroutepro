'use client';

import { useEffect, useMemo, useState, useRef, useCallback, Dispatch, MutableRefObject } from 'react';
import { Map as GoogleMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { AnimatePresence, motion } from 'framer-motion';

import { calculateAllTravel, calculateScheduleTimes, calculateDaySummary } from '@/lib/routeEngine';
import { formatDateDisplay, generateId } from '@/lib/timeUtils';
import { TravelSegment, Client, AppState, ScheduleAction } from '@/lib/types';
import { SupabaseClient } from '@supabase/supabase-js';

import ClientCard from '@/components/ClientCard';
import AddClientButton from '@/components/AddClientButton';
import TravelSegmentComponent from '@/components/TravelSegment';
import DailySummaryCard from '@/components/DailySummary';
import RouteMap from '@/components/RouteMap';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';

interface DayEditorProps {
  state: AppState;
  dispatch: Dispatch<ScheduleAction>;
  orgId: string | null;
  dbLoaded: boolean;
  supabase: SupabaseClient;
  saveRef?: MutableRefObject<(() => Promise<void>) | null>;
}

export default function DayEditor({ state, dispatch, orgId, dbLoaded, supabase, saveRef }: DayEditorProps) {
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);
  const [mobileShowMap, setMobileShowMap] = useState(false);

  const activeTeam = useMemo(
    () => state.teams.find((t) => t.id === state.activeTeamId) || state.teams[0],
    [state.teams, state.activeTeamId]
  );

  // ─── Auto-save ───
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStateRef = useRef<string>('');
  const stateRef = useRef(state);
  stateRef.current = state;

  const saveNow = useCallback(async () => {
    if (!orgId) return;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const currentState = stateRef.current;
    const today = currentState.selectedDate;
    for (const team of currentState.teams) {
      const teamUpdate: Record<string, unknown> = {
        name: team.name, day_start_time: team.dayStartTime,
        hourly_rate: team.hourlyRate, fuel_efficiency: team.fuelEfficiency,
        fuel_price: team.fuelPrice, per_km_rate: team.perKmRate,
      };
      if (team.baseAddress) {
        teamUpdate.base_address = team.baseAddress.address;
        teamUpdate.base_lat = team.baseAddress.lat;
        teamUpdate.base_lng = team.baseAddress.lng;
        teamUpdate.base_place_id = team.baseAddress.placeId || null;
      }
      await supabase.from('teams').update(teamUpdate).eq('id', team.id);
      let scheduleId: string;
      const { data: existing } = await supabase
        .from('schedules').select('id').eq('team_id', team.id).eq('schedule_date', today).maybeSingle();
      if (existing) { scheduleId = existing.id; }
      else {
        const { data: created } = await supabase
          .from('schedules').insert({ org_id: orgId, team_id: team.id, schedule_date: today }).select('id').single();
        if (!created) continue;
        scheduleId = created.id;
      }
      await supabase.from('schedule_jobs').delete().eq('schedule_id', scheduleId);
      if (team.clients.length > 0) {
        const rows = team.clients.map((c, i) => ({
          schedule_id: scheduleId, org_id: orgId, client_id: c.savedClientId || null,
          position: i, name: c.name, address: c.location.address,
          lat: c.location.lat, lng: c.location.lng, place_id: c.location.placeId || null,
          duration_minutes: c.jobDurationMinutes, staff_count: c.staffCount || 1,
          is_locked: c.isLocked || false, is_break: false, notes: c.notes || '',
          start_time: c.startTime || null, end_time: c.endTime || null,
        }));
        await supabase.from('schedule_jobs').insert(rows);
      }
    }
  }, [orgId, supabase]);

  // Expose saveNow to parent
  useEffect(() => {
    if (saveRef) saveRef.current = saveNow;
    return () => { if (saveRef) saveRef.current = null; };
  }, [saveRef, saveNow]);

  useEffect(() => {
    if (!dbLoaded || !orgId) return;
    const fingerprint = JSON.stringify(
      state.teams.map((t) => ({
        id: t.id, name: t.name, base: t.baseAddress, start: t.dayStartTime,
        rate: t.hourlyRate, fuel: t.fuelEfficiency, price: t.fuelPrice, km: t.perKmRate,
        clients: t.clients.map((c) => ({
          id: c.id, name: c.name, addr: c.location.address, dur: c.jobDurationMinutes,
          staff: c.staffCount, locked: c.isLocked, fixed: c.fixedStartTime,
        })),
        breaks: t.breaks,
      }))
    );
    if (fingerprint === prevStateRef.current) return;
    prevStateRef.current = fingerprint;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { saveNow(); }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [state, dbLoaded, orgId, saveNow]);

  // ─── Schedule calculations ───
  const clientsWithTimes = useMemo(() => calculateScheduleTimes(activeTeam), [activeTeam]);
  useEffect(() => {
    if (clientsWithTimes.length > 0) {
      const hasChanges = clientsWithTimes.some((c, i) => {
        const original = activeTeam.clients[i];
        return original && (c.startTime !== original.startTime || c.endTime !== original.endTime);
      });
      if (hasChanges) dispatch({ type: 'SET_CLIENT_TIMES', teamId: activeTeam.id, clients: clientsWithTimes });
    }
  }, [clientsWithTimes, activeTeam.id, activeTeam.clients, dispatch]);

  const summary = useMemo(() => calculateDaySummary(activeTeam), [activeTeam]);

  const routeKey = useMemo(() => {
    const base = activeTeam.baseAddress ? `${activeTeam.baseAddress.lat},${activeTeam.baseAddress.lng}` : 'none';
    const clients = activeTeam.clients.map((c) => `${c.id}:${c.location.lat},${c.location.lng}`).join('|');
    return `${activeTeam.id}::${base}::${clients}`;
  }, [activeTeam.id, activeTeam.baseAddress, activeTeam.clients]);

  const activeTeamRef = useRef(activeTeam);
  activeTeamRef.current = activeTeam;

  useEffect(() => {
    if (!directionsService || !activeTeamRef.current.baseAddress || activeTeamRef.current.clients.length === 0) return;
    const teamId = activeTeamRef.current.id;
    dispatch({ type: 'CLEAR_TRAVEL', teamId });
    const timer = setTimeout(async () => {
      await calculateAllTravel(directionsService, activeTeamRef.current, (segment) => {
        dispatch({ type: 'UPDATE_TRAVEL', teamId, segment });
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [routeKey, directionsService, dispatch]);

  const optimizeRoute = () => {
    if (!directionsService || !activeTeam.baseAddress || activeTeam.clients.length < 2) return;
    const lockedPositions: Record<number, Client> = {};
    const unlocked: Client[] = [];
    activeTeam.clients.forEach((c, i) => { if (c.isLocked) lockedPositions[i] = c; else unlocked.push(c); });
    if (unlocked.length < 2) return;
    const origin = { lat: activeTeam.baseAddress.lat, lng: activeTeam.baseAddress.lng };
    const waypoints: google.maps.DirectionsWaypoint[] = unlocked.map((c) => ({
      location: { lat: c.location.lat, lng: c.location.lng }, stopover: true,
    }));
    directionsService.route({
      origin, destination: origin, waypoints,
      travelMode: google.maps.TravelMode.DRIVING, optimizeWaypoints: true,
    }, (result, status) => {
      if (status === google.maps.DirectionsStatus.OK && result) {
        const optimizedOrder = result.routes[0]?.waypoint_order;
        if (optimizedOrder) {
          const reorderedUnlocked: Client[] = optimizedOrder.map((idx) => unlocked[idx]);
          const finalOrder: Client[] = [];
          let unlockedIdx = 0;
          for (let i = 0; i < activeTeam.clients.length; i++) {
            if (lockedPositions[i]) finalOrder.push(lockedPositions[i]);
            else finalOrder.push(reorderedUnlocked[unlockedIdx++]);
          }
          dispatch({ type: 'SET_CLIENTS_ORDER', teamId: activeTeam.id, clients: finalOrder });
        }
      }
    });
  };

  const addBreak = (afterClientId: string) => {
    dispatch({
      type: 'ADD_BREAK', teamId: activeTeam.id, afterClientId,
      breakItem: { id: generateId(), afterClientId, durationMinutes: 30, label: 'Lunch Break' },
    });
  };

  const getTravelSegment = (fromId: string, toId: string): TravelSegment | undefined => {
    return activeTeam.travelSegments.get(`${fromId}->${toId}`);
  };

  return (
    <>
      <MapsInitializer onServiceReady={setDirectionsService} />
      <div className="flex-1 flex min-h-0 h-full">
        {/* Schedule Panel */}
        <div className={`${mobileShowMap ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[420px] lg:w-[460px] shrink-0 border-r border-border-light bg-white/50`}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-light bg-white">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{formatDateDisplay(state.selectedDate)}</span>
              {dbLoaded && <span className="text-[10px] text-text-tertiary">· Auto-saving</span>}
            </div>
            <button onClick={() => setMobileShowMap(!mobileShowMap)} className="md:hidden btn-ghost">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
            {/* Base Address */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ backgroundColor: activeTeam.color.light }}>🏠</div>
                <div><span className="text-xs font-bold text-text-primary">Base Address</span></div>
              </div>
              <PlacesAutocomplete
                defaultValue={activeTeam.baseAddress?.address || ''}
                onPlaceSelect={(place) => {
                  dispatch({
                    type: 'SET_BASE_ADDRESS', teamId: activeTeam.id,
                    location: { address: place.address, lat: place.lat, lng: place.lng, placeId: place.placeId },
                  });
                }}
              />
            </motion.div>

            {/* Start Time */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="card p-3 flex items-center justify-between">
              <span className="text-xs text-text-secondary">Day starts at</span>
              <input type="time" value={activeTeam.dayStartTime}
                onChange={(e) => dispatch({ type: 'SET_START_TIME', teamId: activeTeam.id, time: e.target.value })}
                className="text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-3 py-1.5 outline-none focus:border-primary" />
            </motion.div>

            {/* Optimize */}
            {activeTeam.clients.length >= 2 && activeTeam.baseAddress && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
                <button onClick={optimizeRoute} className="btn-secondary text-xs flex-1"
                  style={{ borderColor: `${activeTeam.color.primary}30`, color: activeTeam.color.primary }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M21 3l-7 7" /><path d="M3 3l7 7" />
                    <path d="M16 21h5v-5" /><path d="M8 21H3v-5" /><path d="M21 21l-7-7" /><path d="M3 21l7-7" />
                  </svg>
                  Optimize Route Order
                </button>
              </motion.div>
            )}

            {/* Client Cards */}
            <AnimatePresence mode="popLayout">
              {activeTeam.clients.map((client, index) => {
                const prevId = index === 0 ? 'base' : activeTeam.clients[index - 1].id;
                const segment = getTravelSegment(prevId, client.id);
                const breakAfterThis = activeTeam.breaks.find((b) => b.afterClientId === client.id);
                return (
                  <motion.div key={client.id} layout>
                    {activeTeam.baseAddress && <TravelSegmentComponent segment={segment} teamColor={activeTeam.color.primary} />}
                    <ClientCard client={client} index={index} totalClients={activeTeam.clients.length}
                      team={activeTeam} dispatch={dispatch} />
                    {breakAfterThis ? (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-2 py-1 pl-5 ml-4">
                        <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full bg-warning-light text-warning border border-amber-200">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
                            <line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" />
                          </svg>
                          {breakAfterThis.label} · {breakAfterThis.durationMinutes}m
                        </div>
                        <button onClick={() => dispatch({ type: 'REMOVE_BREAK', teamId: activeTeam.id, breakId: breakAfterThis.id })}
                          className="p-1 rounded hover:bg-danger-light text-text-tertiary hover:text-danger transition-colors" title="Remove break">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </motion.div>
                    ) : index < activeTeam.clients.length - 1 ? (
                      <div className="flex justify-center py-0.5">
                        <button onClick={() => addBreak(client.id)}
                          className="text-xs text-text-tertiary hover:text-warning transition-colors opacity-0 hover:opacity-100 px-2 py-0.5"
                          title="Add break after this client">+ break</button>
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Return to base */}
            {activeTeam.clients.length > 0 && activeTeam.baseAddress && (
              <>
                <TravelSegmentComponent
                  segment={getTravelSegment(activeTeam.clients[activeTeam.clients.length - 1].id, 'base-return')}
                  teamColor={activeTeam.color.primary} />
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-3 flex items-center gap-3 opacity-70">
                  <div className="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center text-sm">🏠</div>
                  <span className="text-sm text-text-secondary font-medium">Return to Base</span>
                </motion.div>
              </>
            )}

            {/* Add Client */}
            <div className="pt-1">
              <AddClientButton teamId={activeTeam.id} teamColor={activeTeam.color.primary} dispatch={dispatch} orgId={orgId} />
            </div>

            {/* Daily Summary */}
            {activeTeam.clients.length > 0 && (
              <div className="pt-2"><DailySummaryCard team={activeTeam} summary={summary} dispatch={dispatch} /></div>
            )}

            {/* Empty state */}
            {activeTeam.clients.length === 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="text-center py-12">
                <div className="w-16 h-16 rounded-2xl bg-surface-elevated flex items-center justify-center mx-auto mb-4 text-2xl">📍</div>
                <h3 className="text-sm font-semibold text-text-primary mb-1">No clients yet</h3>
                <p className="text-xs text-text-tertiary max-w-[240px] mx-auto">
                  Set your base address above, then add clients to start building your route.
                </p>
              </motion.div>
            )}
          </div>
        </div>

        {/* Map Panel */}
        <div className={`${mobileShowMap ? 'flex' : 'hidden md:flex'} flex-1 relative`}>
          <GoogleMap defaultCenter={{ lat: -33.8688, lng: 151.2093 }} defaultZoom={11} mapId="cleanroute-map"
            gestureHandling="greedy" disableDefaultUI={false} zoomControl={true} streetViewControl={false}
            mapTypeControl={false} fullscreenControl={true} className="w-full h-full">
            <RouteMap team={activeTeam} />
          </GoogleMap>
          <div className="absolute top-4 left-4 glass-panel rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <div className="team-dot animate-pulse-dot" style={{ backgroundColor: activeTeam.color.primary }} />
            <span className="text-sm font-semibold text-text-primary">{activeTeam.name}</span>
            {activeTeam.clients.length > 0 && (
              <span className="text-xs text-text-secondary">
                · {activeTeam.clients.length} stop{activeTeam.clients.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function MapsInitializer({ onServiceReady }: { onServiceReady: (service: google.maps.DirectionsService) => void }) {
  const routesLibrary = useMapsLibrary('routes');
  useEffect(() => {
    if (!routesLibrary) return;
    const service = new routesLibrary.DirectionsService();
    onServiceReady(service);
  }, [routesLibrary, onServiceReady]);
  return null;
}
