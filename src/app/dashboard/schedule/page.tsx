'use client';

import { useReducer, useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { APIProvider } from '@vis.gl/react-google-maps';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTeams } from '@/lib/hooks/useTeams';
import { useClients } from '@/lib/hooks/useClients';
import { useScheduleJobs } from '@/lib/hooks/useScheduleJobs';
import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { calculateScheduleTimes, calculateAllTravel, calculateDaySummary } from '@/lib/routeEngine';
import { getTodayISO, formatDateDisplay } from '@/lib/timeUtils';
import TeamTabs from '@/components/TeamTabs';
import ClientCard from '@/components/ClientCard';
import AddClientButton from '@/components/AddClientButton';
import TravelSegmentComponent from '@/components/TravelSegment';
import DailySummaryPanel from '@/components/DailySummary';
import RouteMap from '@/components/RouteMap';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';

export default function SchedulePage() {
  const { profile } = useAuth();
  const { teams: dbTeams, orgId, loading: teamsLoading, addTeam, removeTeam, updateTeam } = useTeams(profile?.org_id ?? null);
  const { clients: savedClients, searchClients } = useClients(orgId);
  const [state, dispatch] = useReducer(scheduleReducer, createInitialState());
  const [selectedDate, setSelectedDate] = useState(getTodayISO());
  const [isCalculating, setIsCalculating] = useState(false);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
  const calcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTeam = state.teams.find((t) => t.id === state.activeTeamId) || state.teams[0];
  const { initialClients, loading: jobsLoading, saveClients } = useScheduleJobs(activeTeam?.id || null, selectedDate, orgId);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  // Sync DB teams to state
  useEffect(() => {
    if (dbTeams.length > 0 && !teamsLoading) {
      dispatch({ type: 'LOAD_STATE', teams: dbTeams, activeTeamId: dbTeams[0].id, selectedDate });
    }
  }, [dbTeams, teamsLoading, selectedDate]);

  // Sync loaded jobs to active team
  useEffect(() => {
    if (!jobsLoading && activeTeam && initialClients.length > 0) {
      dispatch({ type: 'SET_CLIENTS_ORDER', teamId: activeTeam.id, clients: initialClients });
    }
  }, [jobsLoading, initialClients, activeTeam?.id]);

  // Auto-save when clients change
  const prevClientsRef = useRef<string>('');
  useEffect(() => {
    if (!activeTeam) return;
    const key = JSON.stringify(activeTeam.clients.map(c => ({ id: c.id, name: c.name, addr: c.location.address, dur: c.jobDurationMinutes, staff: c.staffCount, locked: c.isLocked, fixed: c.fixedStartTime })));
    if (key !== prevClientsRef.current && prevClientsRef.current !== '') {
      saveClients(activeTeam.clients);
    }
    prevClientsRef.current = key;
  }, [activeTeam?.clients, saveClients]);

  // Calculate times when travel or clients change
  useEffect(() => {
    if (!activeTeam) return;
    const updated = calculateScheduleTimes(activeTeam);
    if (JSON.stringify(updated.map(c=>c.startTime)) !== JSON.stringify(activeTeam.clients.map(c=>c.startTime))) {
      dispatch({ type: 'SET_CLIENT_TIMES', teamId: activeTeam.id, clients: updated });
    }
  }, [activeTeam?.travelSegments, activeTeam?.clients?.length, activeTeam?.dayStartTime, activeTeam?.breaks]);

  // Auto-calculate travel
  const recalculateTravel = useCallback(async () => {
    if (!activeTeam?.baseAddress || activeTeam.clients.length === 0 || !directionsServiceRef.current) return;
    setIsCalculating(true);
    dispatch({ type: 'CLEAR_TRAVEL', teamId: activeTeam.id });
    await calculateAllTravel(directionsServiceRef.current, activeTeam, (seg) => {
      dispatch({ type: 'UPDATE_TRAVEL', teamId: activeTeam.id, segment: seg });
    });
    setIsCalculating(false);
  }, [activeTeam]);

  // Debounced recalc
  useEffect(() => {
    if (!activeTeam?.baseAddress || activeTeam.clients.length === 0) return;
    if (calcTimerRef.current) clearTimeout(calcTimerRef.current);
    calcTimerRef.current = setTimeout(() => recalculateTravel(), 800);
    return () => { if (calcTimerRef.current) clearTimeout(calcTimerRef.current); };
  }, [activeTeam?.clients?.length, activeTeam?.baseAddress]);

  const summary = useMemo(() => activeTeam ? calculateDaySummary(activeTeam) : { totalJobMinutes: 0, totalTravelMinutes: 0, totalDistanceKm: 0, totalWorkMinutes: 0, wageAmount: 0, fuelCost: 0, perKmCost: 0, clientCount: 0 }, [activeTeam]);

  const handleAddTeam = async () => { const t = await addTeam(); if (t) dispatch({ type: 'LOAD_STATE', teams: [...state.teams, t], activeTeamId: t.id, selectedDate }); };
  const handleRemoveTeam = async (id: string) => { await removeTeam(id); dispatch({ type: 'REMOVE_TEAM', teamId: id }); };
  const handleDateChange = (days: number) => { const d = new Date(selectedDate); d.setDate(d.getDate() + days); setSelectedDate(d.toISOString().split('T')[0]); };

  if (teamsLoading) return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center"><div className="shimmer w-48 h-6 rounded-lg mb-3 mx-auto" /><div className="shimmer w-32 h-4 rounded mb-2 mx-auto" /><div className="shimmer w-24 h-4 rounded mx-auto" /></div>
    </div>
  );

  return (
    <APIProvider apiKey={apiKey} libraries={['places']}>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 p-4 lg:p-6 pb-0 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-text-primary">Schedule</h2>
              <div className="flex items-center gap-2 mt-1">
                <button onClick={() => handleDateChange(-1)} className="p-1 rounded-lg hover:bg-surface-hover text-text-tertiary">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button onClick={() => setSelectedDate(getTodayISO())} className="text-sm font-medium text-text-secondary hover:text-primary transition-colors">{formatDateDisplay(selectedDate)}</button>
                <button onClick={() => handleDateChange(1)} className="p-1 rounded-lg hover:bg-surface-hover text-text-tertiary">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isCalculating && <span className="text-xs text-text-tertiary flex items-center gap-1"><span className="animate-pulse-dot inline-block w-2 h-2 rounded-full bg-primary" /> Calculating...</span>}
              <button onClick={recalculateTravel} disabled={isCalculating || !activeTeam?.baseAddress || (activeTeam?.clients.length || 0) === 0}
                className="btn-secondary text-sm disabled:opacity-40">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Recalculate
              </button>
            </div>
          </div>
          <TeamTabs teams={state.teams} activeTeamId={state.activeTeamId} dispatch={dispatch} onAddTeam={handleAddTeam} onRemoveTeam={handleRemoveTeam} />
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
          {/* Left panel — schedule list */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar lg:max-w-[560px] space-y-3">
            {activeTeam && (
              <>
                {/* Base address + Day start */}
                <div className="card p-4 space-y-3" style={{ borderLeft: `3px solid ${activeTeam.color.primary}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm" style={{ backgroundColor: activeTeam.color.primary }}>🏠</div>
                    <span className="text-sm font-semibold text-text-primary">Base Address</span>
                  </div>
                  <PlacesAutocomplete onPlaceSelect={(loc) => {
                    dispatch({ type: 'SET_BASE_ADDRESS', teamId: activeTeam.id, location: loc });
                    updateTeam(activeTeam.id, { baseAddress: loc });
                  }} defaultValue={activeTeam.baseAddress?.address || ''} placeholder="Set team base address..." className="text-sm" />
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-tertiary">Start:</span>
                      <input type="time" value={activeTeam.dayStartTime} onChange={(e) => {
                        dispatch({ type: 'SET_START_TIME', teamId: activeTeam.id, time: e.target.value });
                        updateTeam(activeTeam.id, { dayStartTime: e.target.value });
                      }} className="text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-tertiary">Rate:</span>
                      <div className="flex items-center">
                        <span className="text-xs text-text-tertiary mr-1">$</span>
                        <input type="number" value={activeTeam.hourlyRate} onChange={(e) => {
                          const rate = Number(e.target.value) || 0;
                          dispatch({ type: 'SET_HOURLY_RATE', teamId: activeTeam.id, rate });
                          updateTeam(activeTeam.id, { hourlyRate: rate });
                        }} className="w-16 text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary text-center" step={1} />
                        <span className="text-xs text-text-tertiary ml-1">/hr</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Travel from base */}
                {activeTeam.clients.length > 0 && (
                  <TravelSegmentComponent segment={activeTeam.travelSegments.get(`base->${activeTeam.clients[0].id}`)} teamColor={activeTeam.color.primary} />
                )}

                {/* Client list */}
                <AnimatePresence mode="popLayout">
                  {activeTeam.clients.map((client, i) => (
                    <div key={client.id}>
                      <ClientCard client={client} index={i} totalClients={activeTeam.clients.length} team={activeTeam} dispatch={dispatch} />
                      {i < activeTeam.clients.length - 1 && (
                        <TravelSegmentComponent segment={activeTeam.travelSegments.get(`${client.id}->${activeTeam.clients[i + 1].id}`)} teamColor={activeTeam.color.primary} />
                      )}
                      {i === activeTeam.clients.length - 1 && (
                        <TravelSegmentComponent segment={activeTeam.travelSegments.get(`${client.id}->base-return`)} teamColor={activeTeam.color.primary} />
                      )}
                    </div>
                  ))}
                </AnimatePresence>

                {/* Add client button */}
                <AddClientButton teamId={activeTeam.id} dispatch={dispatch} savedClients={savedClients} searchClients={searchClients} />
              </>
            )}
          </div>

          {/* Right panel — Map + Summary */}
          <div className="hidden lg:flex flex-col flex-1 min-h-0 p-6 pl-0 gap-4">
            <div className="flex-1 card overflow-hidden min-h-[300px]">
              {activeTeam && (
                <div className="h-full" ref={(el) => {
                  if (el && !directionsServiceRef.current && window.google?.maps) {
                    directionsServiceRef.current = new google.maps.DirectionsService();
                  }
                }}>
                  <RouteMap team={activeTeam} />
                </div>
              )}
            </div>
            {activeTeam && <DailySummaryPanel summary={summary} team={activeTeam} selectedDate={selectedDate} />}
          </div>
        </div>
      </div>
      {/* Init DirectionsService */}
      <div className="hidden" ref={(el) => {
        if (el && !directionsServiceRef.current && window.google?.maps) {
          directionsServiceRef.current = new google.maps.DirectionsService();
        }
      }} />
    </APIProvider>
  );
}
