'use client';

import { useReducer, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { APIProvider, Map as GoogleMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { AnimatePresence, motion } from 'framer-motion';

import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { calculateAllTravel, calculateScheduleTimes, calculateDaySummary } from '@/lib/routeEngine';
import { formatDateDisplay, generateId, getTodayISO } from '@/lib/timeUtils';
import { TravelSegment, Client, TeamSchedule, TEAM_COLORS } from '@/lib/types';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

import TeamTabs from '@/components/TeamTabs';
import ClientCard from '@/components/ClientCard';
import AddClientButton from '@/components/AddClientButton';
import TravelSegmentComponent from '@/components/TravelSegment';
import DailySummaryCard from '@/components/DailySummary';
import RouteMap from '@/components/RouteMap';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export default function SchedulePage() {
  const [state, dispatch] = useReducer(scheduleReducer, null, createInitialState);
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);
  const [mobileShowMap, setMobileShowMap] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);

  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id || null;

  // ─── DB Persistence: Load teams + jobs on mount ───
  const loadFromDb = useCallback(async () => {
    if (!orgId) return;
    const today = getTodayISO();

    // Load teams
    const { data: dbTeams } = await supabase
      .from('teams')
      .select('*')
      .eq('org_id', orgId)
      .order('sort_order');

    if (!dbTeams || dbTeams.length === 0) {
      setDbLoaded(true);
      return;
    }

    const teams: TeamSchedule[] = dbTeams.map((row: Record<string, unknown>, idx: number) => ({
      id: row.id as string,
      name: row.name as string,
      color: TEAM_COLORS[(row.color_index as number) % TEAM_COLORS.length],
      baseAddress: row.base_address ? {
        address: row.base_address as string,
        lat: (row.base_lat as number) || 0,
        lng: (row.base_lng as number) || 0,
        placeId: (row.base_place_id as string) || undefined,
      } : null,
      clients: [],
      travelSegments: new Map<string, TravelSegment>(),
      dayStartTime: (row.day_start_time as string) || '08:00',
      breaks: [],
      hourlyRate: Number(row.hourly_rate) || 38,
      fuelEfficiency: Number(row.fuel_efficiency) || 10,
      fuelPrice: Number(row.fuel_price) || 1.85,
      perKmRate: Number(row.per_km_rate) || 0,
    }));

    // Load schedule jobs for each team for today
    for (const team of teams) {
      const { data: schedule } = await supabase
        .from('schedules')
        .select('id')
        .eq('team_id', team.id)
        .eq('schedule_date', today)
        .single();

      if (schedule) {
        const { data: jobs } = await supabase
          .from('schedule_jobs')
          .select('*')
          .eq('schedule_id', schedule.id)
          .order('position');

        if (jobs) {
          team.clients = jobs
            .filter((j: Record<string, unknown>) => !j.is_break)
            .map((j: Record<string, unknown>): Client => ({
              id: j.id as string,
              name: (j.name as string) || '',
              location: {
                address: (j.address as string) || '',
                lat: (j.lat as number) || 0,
                lng: (j.lng as number) || 0,
                placeId: (j.place_id as string) || undefined,
              },
              jobDurationMinutes: Number(j.duration_minutes) || 90,
              staffCount: (j.staff_count as number) || 1,
              isLocked: (j.is_locked as boolean) || false,
              startTime: (j.start_time as string) || undefined,
              endTime: (j.end_time as string) || undefined,
              notes: (j.notes as string) || undefined,
              savedClientId: (j.client_id as string) || undefined,
            }));
        }
      }
    }

    dispatch({
      type: 'LOAD_STATE',
      teams,
      activeTeamId: teams[0].id,
      selectedDate: today,
    });
    setDbLoaded(true);
  }, [orgId, supabase]);

  useEffect(() => {
    if (orgId && !dbLoaded) loadFromDb();
  }, [orgId, dbLoaded, loadFromDb]);

  // ─── DB Persistence: Auto-save on state changes ───
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStateRef = useRef<string>('');

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

    saveTimerRef.current = setTimeout(async () => {
      const today = state.selectedDate;

      for (const team of state.teams) {
        const teamUpdate: Record<string, unknown> = {
          name: team.name,
          day_start_time: team.dayStartTime,
          hourly_rate: team.hourlyRate,
          fuel_efficiency: team.fuelEfficiency,
          fuel_price: team.fuelPrice,
          per_km_rate: team.perKmRate,
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
          .from('schedules')
          .select('id')
          .eq('team_id', team.id)
          .eq('schedule_date', today)
          .maybeSingle();

        if (existing) {
          scheduleId = existing.id;
        } else {
          const { data: created } = await supabase
            .from('schedules')
            .insert({ org_id: orgId, team_id: team.id, schedule_date: today })
            .select('id')
            .single();
          if (!created) continue;
          scheduleId = created.id;
        }

        await supabase.from('schedule_jobs').delete().eq('schedule_id', scheduleId);

        if (team.clients.length > 0) {
          const rows = team.clients.map((c, i) => ({
            schedule_id: scheduleId,
            org_id: orgId,
            client_id: c.savedClientId || null,
            position: i,
            name: c.name,
            address: c.location.address,
            lat: c.location.lat,
            lng: c.location.lng,
            place_id: c.location.placeId || null,
            duration_minutes: c.jobDurationMinutes,
            staff_count: c.staffCount || 1,
            is_locked: c.isLocked || false,
            is_break: false,
            notes: c.notes || '',
            start_time: c.startTime || null,
            end_time: c.endTime || null,
          }));
          await supabase.from('schedule_jobs').insert(rows);
        }
      }
    }, 2000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, dbLoaded, orgId, supabase]);

  // ─── Handle ADD_TEAM to also create in DB ───
  const handleAddTeam = useCallback(async () => {
    if (!orgId) return;
    const colorIndex = state.teams.length % TEAM_COLORS.length;
    const baseAddr = state.teams[0]?.baseAddress;
    const { data } = await supabase
      .from('teams')
      .insert({
        org_id: orgId,
        name: `Team ${state.teams.length + 1}`,
        color_index: colorIndex,
        sort_order: state.teams.length,
        ...(baseAddr ? {
          base_address: baseAddr.address,
          base_lat: baseAddr.lat,
          base_lng: baseAddr.lng,
          base_place_id: baseAddr.placeId || null,
        } : {}),
      })
      .select()
      .single();

    if (data) {
      await loadFromDb();
    }
  }, [orgId, supabase, state.teams, loadFromDb]);

  // ─── Handle REMOVE_TEAM to also delete from DB ───
  const handleRemoveTeam = useCallback(async (teamId: string) => {
    if (state.teams.length <= 1) return;
    const { data: schedules } = await supabase
      .from('schedules')
      .select('id')
      .eq('team_id', teamId);
    if (schedules) {
      for (const s of schedules) {
        await supabase.from('schedule_jobs').delete().eq('schedule_id', s.id);
      }
      await supabase.from('schedules').delete().eq('team_id', teamId);
    }
    await supabase.from('teams').delete().eq('id', teamId);
    dispatch({ type: 'REMOVE_TEAM', teamId });
  }, [supabase, state.teams.length]);

  const activeTeam = useMemo(
    () => state.teams.find((t) => t.id === state.activeTeamId) || state.teams[0],
    [state.teams, state.activeTeamId]
  );

  const clientsWithTimes = useMemo(
    () => calculateScheduleTimes(activeTeam),
    [activeTeam]
  );

  useEffect(() => {
    if (clientsWithTimes.length > 0) {
      const hasChanges = clientsWithTimes.some((c, i) => {
        const original = activeTeam.clients[i];
        return original && (c.startTime !== original.startTime || c.endTime !== original.endTime);
      });
      if (hasChanges) {
        dispatch({ type: 'SET_CLIENT_TIMES', teamId: activeTeam.id, clients: clientsWithTimes });
      }
    }
  }, [clientsWithTimes, activeTeam.id, activeTeam.clients]);

  const summary = useMemo(() => calculateDaySummary(activeTeam), [activeTeam]);

  const routeKey = useMemo(() => {
    const base = activeTeam.baseAddress
      ? `${activeTeam.baseAddress.lat},${activeTeam.baseAddress.lng}`
      : 'none';
    const clients = activeTeam.clients
      .map((c) => `${c.id}:${c.location.lat},${c.location.lng}`)
      .join('|');
    return `${activeTeam.id}::${base}::${clients}`;
  }, [activeTeam.id, activeTeam.baseAddress, activeTeam.clients]);

  const activeTeamRef = useRef(activeTeam);
  activeTeamRef.current = activeTeam;

  // Recalculate travel
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
  }, [routeKey, directionsService]);

  // Optimize route
  const optimizeRoute = () => {
    if (!directionsService || !activeTeam.baseAddress || activeTeam.clients.length < 2) return;
    const lockedPositions: Record<number, Client> = {};
    const unlocked: Client[] = [];
    activeTeam.clients.forEach((c, i) => {
      if (c.isLocked) lockedPositions[i] = c;
      else unlocked.push(c);
    });
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
    <APIProvider apiKey={MAPS_KEY} libraries={['places', 'routes']}>
      <MapsInitializer onServiceReady={setDirectionsService} />
      <div className="h-full flex flex-col">
        {/* Schedule Header */}
        <header className="shrink-0 z-20 px-4 lg:px-6 border-b border-border-light bg-white">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="text-sm font-medium text-text-primary">
                {formatDateDisplay(state.selectedDate)}
              </span>
              {dbLoaded && (
                <span className="text-[10px] text-text-tertiary ml-1">· Auto-saving</span>
              )}
            </div>
            <button onClick={() => setMobileShowMap(!mobileShowMap)} className="md:hidden btn-ghost">
              {mobileShowMap ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                  <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
                </svg>
              )}
            </button>
          </div>
          <div className="pb-3 -mx-1 overflow-x-auto">
            <TeamTabs
              state={state}
              dispatch={dispatch}
              onSelectTeam={(teamId) => dispatch({ type: 'SET_ACTIVE_TEAM', teamId })}
              onAddTeam={handleAddTeam}
              onRemoveTeam={handleRemoveTeam}
            />
          </div>
        </header>

        {/* Main content */}
        <div className="flex-1 flex min-h-0">
          {/* Schedule Panel */}
          <div className={`${mobileShowMap ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[420px] lg:w-[460px] shrink-0 border-r border-border-light bg-white/50`}>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
              {/* Base Address */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-elevated flex items-center justify-center text-lg">🏠</div>
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Base Address</h3>
                    <p className="text-xs text-text-tertiary">Starting & return point</p>
                  </div>
                </div>
                <PlacesAutocomplete
                  onPlaceSelect={(location) => dispatch({ type: 'SET_BASE_ADDRESS', teamId: activeTeam.id, location })}
                  defaultValue={activeTeam.baseAddress?.address || ''}
                  placeholder="Enter your base address..."
                  className="text-sm"
                />
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-text-secondary">Day starts at</span>
                  <input
                    type="time"
                    value={activeTeam.dayStartTime}
                    onChange={(e) => dispatch({ type: 'SET_START_TIME', teamId: activeTeam.id, time: e.target.value })}
                    className="text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                  />
                </div>
              </motion.div>

              {/* Optimize Route Button */}
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

              {/* Client Cards with Travel Segments */}
              <AnimatePresence mode="popLayout">
                {activeTeam.clients.map((client, index) => {
                  const prevId = index === 0 ? 'base' : activeTeam.clients[index - 1].id;
                  const segment = getTravelSegment(prevId, client.id);
                  const breakAfterThis = activeTeam.breaks.find((b) => b.afterClientId === client.id);
                  return (
                    <motion.div key={client.id} layout>
                      {activeTeam.baseAddress && (
                        <TravelSegmentComponent segment={segment} teamColor={activeTeam.color.primary} />
                      )}
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
                    teamColor={activeTeam.color.primary}
                  />
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-3 flex items-center gap-3 opacity-70">
                    <div className="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center text-sm">🏠</div>
                    <span className="text-sm text-text-secondary font-medium">Return to Base</span>
                  </motion.div>
                </>
              )}

              {/* Add Client */}
              <div className="pt-1">
                <AddClientButton teamId={activeTeam.id} teamColor={activeTeam.color.primary} dispatch={dispatch} />
              </div>

              {/* Daily Summary */}
              {activeTeam.clients.length > 0 && (
                <div className="pt-2">
                  <DailySummaryCard team={activeTeam} summary={summary} dispatch={dispatch} />
                </div>
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
      </div>
    </APIProvider>
  );
}

// Helper component to initialize DirectionsService
function MapsInitializer({ onServiceReady }: { onServiceReady: (service: google.maps.DirectionsService) => void }) {
  const routesLibrary = useMapsLibrary('routes');
  useEffect(() => {
    if (!routesLibrary) return;
    const service = new routesLibrary.DirectionsService();
    onServiceReady(service);
  }, [routesLibrary, onServiceReady]);
  return null;
}
