'use client';

import { useEffect, useMemo, useState, useRef, useCallback, Dispatch, MutableRefObject } from 'react';
import { Map as GoogleMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { AnimatePresence, motion } from 'framer-motion';

import { calculateAllTravel, calculateScheduleTimes, calculateDaySummary, ScheduleTimesResult } from '@/lib/routeEngine';
import { formatDateDisplay, generateId, parseTime } from '@/lib/timeUtils';
import { TravelSegment, Client, AppState, ScheduleAction, StaffMember } from '@/lib/types';
import { SupabaseClient } from '@supabase/supabase-js';
import { useClients } from '@/lib/hooks/useClients';

import ClientCard from '@/components/ClientCard';
import AddClientButton from '@/components/AddClientButton';
import TravelSegmentComponent from '@/components/TravelSegment';
import DailySummaryCard from '@/components/DailySummary';
import RouteMap from '@/components/RouteMap';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';
import { invalidateScheduleCache } from '@/app/dashboard/schedule/page';
import { lazy, Suspense } from 'react';
const ClientChecklistPanel = lazy(() => import('@/components/ClientChecklistPanel'));

import type { TeamSchedule } from '@/lib/types';

// ─── Driver Picker Card ────────────────────────────────────────────────────────
interface DriverPickerCardProps {
  activeTeam: TeamSchedule;
  currentDriver: StaffMember | null;
  freeStaff: StaffMember[];
  drivingOther: { staff: StaffMember; teamName: string }[];
  unavailableToday: StaffMember[];
  dispatch: Dispatch<ScheduleAction>;
}

function DriverPickerCard({ activeTeam, currentDriver, freeStaff, drivingOther, unavailableToday, dispatch }: DriverPickerCardProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectDriver = (staffId: string) => {
    dispatch({ type: 'SET_DRIVER', teamId: activeTeam.id, staffId });
    setOpen(false);
  };

  const clearDriver = () => {
    dispatch({ type: 'SET_DRIVER', teamId: activeTeam.id, staffId: null });
    setOpen(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }}
      className="card p-3 relative">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={activeTeam.color.primary} strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          </svg>
          <span className="text-xs font-bold text-text-primary">Driver for Today</span>
        </div>
        {currentDriver && (
          <button
            onClick={clearDriver}
            className="text-[10px] text-text-tertiary hover:text-danger transition-colors px-1.5 py-0.5 rounded-md hover:bg-red-50"
            title="Remove driver"
          >✕ Clear</button>
        )}
      </div>

      {/* Current driver display / trigger button */}
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className={`mt-2 w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border-2 transition-all text-left ${
          currentDriver
            ? 'border-transparent'
            : 'border-dashed border-border-light hover:border-primary hover:bg-primary-light/20'
        }`}
        style={currentDriver ? {
          backgroundColor: `${activeTeam.color.primary}08`,
          borderColor: `${activeTeam.color.primary}30`,
        } : {}}
      >
        {currentDriver ? (
          <>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: activeTeam.color.primary }}>
              {currentDriver.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary truncate">{currentDriver.name}</div>
              <div className="text-[11px] text-text-tertiary capitalize">{currentDriver.role} · ${currentDriver.hourly_rate}/hr</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-elevated shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </div>
            <span className="text-xs font-medium text-text-tertiary">Assign a driver…</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0 ml-auto">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </>
        )}
      </button>

      {/* Picker popover */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-full mt-1.5 z-40 bg-white rounded-xl shadow-xl border border-border-light p-2 mx-3"
          >
            {/* Available staff */}
            <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 py-1">Available</div>
            {freeStaff.length === 0 && drivingOther.length === 0 && unavailableToday.length === 0 ? (
              <div className="text-xs text-text-tertiary px-2 py-4 text-center">No staff found</div>
            ) : (
              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                {freeStaff.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectDriver(s.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-xs text-left transition-all ${
                      currentDriver?.id === s.id
                        ? 'bg-primary-light/40'
                        : 'hover:bg-surface-hover'
                    }`}
                    style={currentDriver?.id === s.id ? { outline: `2px solid ${activeTeam.color.primary}40`, outlineOffset: '-2px' } : {}}
                  >
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: activeTeam.color.primary }}>
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-text-primary block truncate">{s.name}</span>
                      <span className="text-[10px] text-text-tertiary capitalize">{s.role} · ${s.hourly_rate}/hr</span>
                    </div>
                    {currentDriver?.id === s.id && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={activeTeam.color.primary} strokeWidth="2.5" className="shrink-0">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                ))}

                {/* Driving for another team (greyed out) */}
                {drivingOther.length > 0 && (
                  <>
                    <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 pt-2.5 pb-1 mt-1 border-t border-border-light">Driving Another Team</div>
                    {drivingOther.map(({ staff: s, teamName }) => (
                      <div
                        key={s.id}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-xs text-left opacity-45 cursor-not-allowed"
                        title={`Driving for ${teamName} today`}
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-gray-400">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-text-tertiary block truncate">{s.name}</span>
                          <span className="text-[10px] text-red-400 flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                              <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                            </svg>
                            Driving for {teamName}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {/* Unavailable today (greyed out) */}
                {unavailableToday.length > 0 && (
                  <>
                    <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 pt-2.5 pb-1 mt-1 border-t border-border-light">Not Available Today</div>
                    {unavailableToday.map((s) => (
                      <div
                        key={s.id}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-xs text-left opacity-40 cursor-not-allowed"
                        title={`${s.name} is not available on this day`}
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-gray-300">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-text-tertiary block truncate">{s.name}</span>
                          <span className="text-[10px] text-text-tertiary">Not available today · ${s.hourly_rate}/hr</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface DayEditorProps {
  state: AppState;
  dispatch: Dispatch<ScheduleAction>;
  orgId: string | null;
  dbLoaded: boolean;
  supabase: SupabaseClient;
  saveRef?: MutableRefObject<(() => Promise<void>) | null>;
  allStaff?: StaffMember[];
  isAdmin?: boolean;
  /** Increments each time loadDayForEdit completes — signals a fresh DB load so
   *  the autosave baseline is re-recorded and no spurious save fires. */
  loadGeneration?: number;
  /** When true, disables all auto-save DB persistence. Used by the schedule
   *  template editor so the same DayEditor UI operates on in-memory state only.
   *  All future UI additions to DayEditor automatically appear in template mode. */
  disableAutoSave?: boolean;
}

export default function DayEditor({ state, dispatch, orgId, dbLoaded, supabase, saveRef, allStaff, isAdmin = true, loadGeneration = 0, disableAutoSave = false }: DayEditorProps) {
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);
  const [mobileShowMap, setMobileShowMap] = useState(false);
  const [activeChecklistClient, setActiveChecklistClient] = useState<Client | null>(null);

  // Saved client database — used for the swap-client feature on each card
  const { clients: savedClients } = useClients(orgId ?? null);

  const activeTeam = useMemo(
    () => state.teams.find((t) => t.id === state.activeTeamId) || state.teams[0],
    [state.teams, state.activeTeamId]
  );

  // Filter staff available on this day-of-week
  const availableStaff = useMemo(() => {
    if (!allStaff) return [];
    const parts = state.selectedDate.split('-').map(Number);
    const dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
    return allStaff.filter((s) => {
      if (!s.available_days || s.available_days.length === 0) return true;
      return s.available_days.includes(dayOfWeek);
    });
  }, [allStaff, state.selectedDate]);

  // Build busy schedule for ALL staff across ALL teams (for conflict detection)
  const staffBusyPeriods = useMemo(() => {
    const periods = new Map<string, { start: number; end: number; teamName: string; clientName: string; clientId: string }[]>();
    for (const team of state.teams) {
      for (const client of team.clients) {
        if (!client.startTime || !client.endTime) continue;
        for (const staffId of client.assignedStaffIds || []) {
          const existing = periods.get(staffId) || [];
          existing.push({
            start: parseTime(client.startTime),
            end: parseTime(client.endTime),
            teamName: team.name,
            clientName: client.name,
            clientId: client.id,
          });
          periods.set(staffId, existing);
        }
      }
    }
    return periods;
  }, [state.teams]);

  // Build cross-team driver assignments map (staffId → teamName)
  // Used by both the driver picker and per-job staff pickers
  const crossTeamDrivers = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of state.teams) {
      if (team.driverStaffId && team.id !== activeTeam.id) {
        map.set(team.driverStaffId, team.name);
      }
    }
    return map;
  }, [state.teams, activeTeam.id]);

  // ─── Auto-save ───
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStateRef = useRef<string>('');
  const prevClientCountRef = useRef<number>(-1);
  const prevBreakCountRef = useRef<number>(-1);
  const prevBaseRef = useRef<string>('');
  const stateRef = useRef(state);
  stateRef.current = state;
  // After a day load (date changes), the first effect run should just initialize
  // the baseline refs without triggering a save.
  const justLoadedRef = useRef(true);
  // Reset baseline whenever selectedDate changes OR a fresh DB load completes
  useEffect(() => { justLoadedRef.current = true; }, [state.selectedDate, loadGeneration]);

  const isSavingRef = useRef(false);
  const needsSaveRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }

    // If a save is already running, flag it and return — the running save will
    // loop again with the latest state once it finishes.
    if (isSavingRef.current) {
      needsSaveRef.current = true;
      return;
    }

    do {
      needsSaveRef.current = false;
      isSavingRef.current = true;
      setSaveStatus('saving');
      let attempt = 0;
      let success = false;
      while (attempt < 2 && !success) {
        attempt++;
        try {
        if (!orgId) break;
        const currentState = stateRef.current;
        const today = currentState.selectedDate;
        for (const team of currentState.teams) {
          const teamUpdate: Record<string, unknown> = {
            name: team.name, day_start_time: team.dayStartTime,
            hourly_rate: team.hourlyRate, fuel_efficiency: team.fuelEfficiency,
            fuel_price: team.fuelPrice, per_km_rate: team.perKmRate,
          };
          await supabase.from('teams').update(teamUpdate).eq('id', team.id);

          const hasClients = team.clients.length > 0;
          const hasBaseAddress = team.baseAddress !== null;
          const hasReturnAddress = team.returnAddress !== null && team.returnAddress !== 'none';
          const hasBreaks = team.breaks.length > 0;
          const hasDriver = !!team.driverStaffId;
          const { data: existingSched } = await supabase
            .from('schedules').select('id').eq('team_id', team.id).eq('schedule_date', today).maybeSingle();

          if (!hasClients && !hasBaseAddress && !hasReturnAddress && !hasBreaks && !hasDriver && !existingSched) continue;

          const scheduleData: Record<string, unknown> = {
            org_id: orgId, team_id: team.id, schedule_date: today,
            has_start_base: team.baseAddress !== null,
            // null = not set → false; 'none' = explicitly cleared → false; Location = set → true
            has_return_base: team.returnAddress !== null && team.returnAddress !== 'none',
            driver_staff_id: team.driverStaffId || null,
          };
          if (team.baseAddress) {
            scheduleData.base_address = team.baseAddress.address;
            scheduleData.base_lat = team.baseAddress.lat;
            scheduleData.base_lng = team.baseAddress.lng;
            scheduleData.base_place_id = team.baseAddress.placeId || null;
          } else {
            scheduleData.base_address = null; scheduleData.base_lat = null;
            scheduleData.base_lng = null; scheduleData.base_place_id = null;
          }
          if (team.returnAddress === 'none') {
            scheduleData.return_address = null; scheduleData.return_lat = null;
            scheduleData.return_lng = null; scheduleData.return_place_id = null;
          } else if (team.returnAddress) {
            scheduleData.return_address = team.returnAddress.address;
            scheduleData.return_lat = team.returnAddress.lat;
            scheduleData.return_lng = team.returnAddress.lng;
            scheduleData.return_place_id = team.returnAddress.placeId || null;
          } else {
            scheduleData.return_address = null; scheduleData.return_lat = null;
            scheduleData.return_lng = null; scheduleData.return_place_id = null;
          }

          let scheduleId: string;
          if (existingSched) {
            scheduleId = existingSched.id;
            await supabase.from('schedules').update(scheduleData).eq('id', scheduleId);
          } else {
            const { data: created } = await supabase
              .from('schedules').insert(scheduleData).select('id').single();
            if (!created) continue;
            scheduleId = created.id;
          }
          await supabase.from('schedule_jobs').delete().eq('schedule_id', scheduleId);
          // Build rows: regular clients first, then breaks
          const allRows: Record<string, unknown>[] = [
            ...team.clients.map((c, i) => ({
              schedule_id: scheduleId, org_id: orgId, client_id: c.savedClientId || null,
              position: i, name: c.name, address: c.location.address,
              lat: c.location.lat, lng: c.location.lng, place_id: c.location.placeId || null,
              duration_minutes: c.jobDurationMinutes, staff_count: c.staffCount || 1,
              is_locked: c.isLocked || false, is_break: false, notes: c.notes || '',
              start_time: c.startTime || null, end_time: c.endTime || null,
              fixed_start_time: c.fixedStartTime || null,
              assigned_staff_ids: c.assignedStaffIds || [],
            })),
            // Breaks stored with is_break=true; afterClientId encoded in notes.
            // Only persist breaks whose afterClientId still exists in the current client list —
            // this prevents ghost breaks accumulating when clients are removed.
            ...(() => {
              const validClientIds = new Set(team.clients.map(c => c.id));
              return team.breaks
                .filter(b => validClientIds.has(b.afterClientId))
                .map((b, i) => ({
                  schedule_id: scheduleId, org_id: orgId, client_id: null,
                  position: team.clients.length + i, name: b.label || 'Break',
                  address: '', lat: 0, lng: 0, place_id: null,
                  duration_minutes: b.durationMinutes, staff_count: 1,
                  is_locked: false, is_break: true,
                  // Store BOTH afterClientId (stable) and afterPosition (fallback) in notes.
                  // afterClientId is preferred on reload; afterPosition is a fallback for old rows.
                  notes: JSON.stringify({
                    afterClientId: b.afterClientId,
                    afterPosition: team.clients.findIndex(c => c.id === b.afterClientId),
                    breakId: b.id, label: b.label || 'Break',
                  }),
                  start_time: null, end_time: null, fixed_start_time: null,
                  assigned_staff_ids: [] as string[],
                }));
            })(),
          ];

          // Insert clients and breaks as separate operations so a break-specific
          // DB error can't silently wipe the client rows too.
          const clientRows = allRows.filter(r => !r.is_break);
          const breakRows = allRows.filter(r => r.is_break);
          if (clientRows.length > 0) {
            const { error: clientErr } = await supabase.from('schedule_jobs').insert(clientRows);
            if (clientErr) throw new Error(`Client insert: ${clientErr.message}`);
          }
          if (breakRows.length > 0) {
            const { error: breakErr } = await supabase.from('schedule_jobs').insert(breakRows);
            if (breakErr) throw new Error(`Break insert: ${breakErr.message}`);
          }
        }
        success = true;
        } catch (err) {
          if (attempt >= 2) {
            console.error('[AutoSave] Failed after retry:', err);
          }
          // brief pause before retry
          if (attempt < 2) await new Promise(r => setTimeout(r, 800));
        }
      } // end while retry
      isSavingRef.current = false;
      if (success) {
        invalidateScheduleCache(); // Expire the page cache so tab-switching re-fetches fresh data
        setSaveStatus('saved');
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        setSaveStatus('error');
      }
    } while (needsSaveRef.current);
  }, [orgId, supabase]);

  // Expose saveNow to parent
  const saveNowRef = useRef(saveNow);
  useEffect(() => { saveNowRef.current = saveNow; }, [saveNow]);

  useEffect(() => {
    if (disableAutoSave) return; // Template mode: parent handles persistence
    if (saveRef) saveRef.current = saveNow;
    return () => { if (saveRef) saveRef.current = null; };
  }, [saveRef, saveNow, disableAutoSave]);

  // Flush any pending debounced save when navigating away (sidebar, browser back, etc.)
  // saveNow reads stateRef.current so it always has fresh data even in this closure.
  useEffect(() => {
    if (disableAutoSave) return; // Template mode: no flush needed
    return () => { saveNowRef.current(); };
  }, [disableAutoSave]);

  useEffect(() => {
    if (disableAutoSave) return; // Template mode: skip auto-save entirely
    if (!dbLoaded || !orgId) return;

    const totalClients = state.teams.reduce((sum, t) => sum + t.clients.length, 0);
    const fingerprint = JSON.stringify(
      state.teams.map((t) => ({
        id: t.id, name: t.name, base: t.baseAddress, ret: t.returnAddress, start: t.dayStartTime,
        rate: t.hourlyRate, fuel: t.fuelEfficiency, price: t.fuelPrice, km: t.perKmRate,
        driver: t.driverStaffId || null,
        clients: t.clients.map((c) => ({
          id: c.id, name: c.name, addr: c.location.address,
          lat: c.location.lat, lng: c.location.lng,
          dur: c.jobDurationMinutes, notes: c.notes || '',
          staff: c.staffCount, locked: c.isLocked, fixed: c.fixedStartTime,
          assignedStaff: c.assignedStaffIds, color: c.clientColor,
        })),
        breaks: t.breaks,
      }))
    );

    // First run after a day load — just record the baseline, don't save.
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      prevStateRef.current = fingerprint;
      prevClientCountRef.current = totalClients;
      prevBreakCountRef.current = state.teams.reduce((sum, t) => sum + t.breaks.length, 0);
      prevBaseRef.current = JSON.stringify(state.teams.map(t => ({ base: t.baseAddress, ret: t.returnAddress })));
      return;
    }

    if (fingerprint === prevStateRef.current) return;
    prevStateRef.current = fingerprint;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    // Structural = client/break count changed OR base/return address changed → save immediately.
    // Detail change (duration, notes, staff etc.) → 800ms debounce.
    const totalBreaks = state.teams.reduce((sum, t) => sum + t.breaks.length, 0);
    const curBase = JSON.stringify(state.teams.map(t => ({ base: t.baseAddress, ret: t.returnAddress })));
    const isStructural =
      totalClients !== prevClientCountRef.current ||
      totalBreaks !== prevBreakCountRef.current ||
      curBase !== prevBaseRef.current;
    prevClientCountRef.current = totalClients;
    prevBreakCountRef.current = totalBreaks;
    prevBaseRef.current = curBase;

    if (isStructural) {
      saveNow();
    } else {
      saveTimerRef.current = setTimeout(() => { saveNow(); }, 800);
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [state, dbLoaded, orgId, saveNow]);

  // ─── Background geocoding for zero-coordinate clients ───
  // When clients load from DB with lat=0/lng=0 (ocean pin), resolve their
  // address via Google Places and patch the location in state + save.
  const geocodedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!dbLoaded || !window.google?.maps) return;
    for (const team of state.teams) {
      for (const client of team.clients) {
        if (geocodedIdsRef.current.has(client.id)) continue;
        if (client.location.lat !== 0 || client.location.lng !== 0) continue;
        if (!client.location.address) continue;
        geocodedIdsRef.current.add(client.id);
        const address = client.location.address;
        const clientId = client.id;
        const teamId = team.id;
        // Resolve best-match address via Places API
        const svc = new google.maps.places.AutocompleteService();
        svc.getPlacePredictions(
          { input: address, componentRestrictions: { country: 'au' }, types: ['address'] },
          (predictions, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions?.length) return;
            const div = document.createElement('div');
            const ps = new google.maps.places.PlacesService(div);
            ps.getDetails(
              { placeId: predictions[0].place_id, fields: ['formatted_address', 'geometry', 'place_id'] },
              (place, s) => {
                if (s === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                  dispatch({
                    type: 'UPDATE_CLIENT', teamId, clientId,
                    updates: {
                      location: {
                        address: place.formatted_address || address,
                        lat: place.geometry.location.lat(),
                        lng: place.geometry.location.lng(),
                        placeId: place.place_id,
                      },
                    },
                  });
                }
              }
            );
          }
        );
      }
    }
  }, [dbLoaded, state.teams, dispatch]);

  // ─── Schedule calculations ───
  const scheduleResult = useMemo(() => calculateScheduleTimes(activeTeam), [activeTeam]);
  const baseDepartureTime = scheduleResult.baseDepartureTime;
  useEffect(() => {
    if (scheduleResult.clients.length > 0) {
      const hasChanges = scheduleResult.clients.some((c, i) => {
        const original = activeTeam.clients[i];
        return original && (c.startTime !== original.startTime || c.endTime !== original.endTime);
      });
      if (hasChanges) dispatch({ type: 'SET_CLIENT_TIMES', teamId: activeTeam.id, clients: scheduleResult.clients });
    }
  }, [scheduleResult, activeTeam.id, activeTeam.clients, dispatch]);

  const summary = useMemo(() => calculateDaySummary(activeTeam), [activeTeam]);

  const routeKey = useMemo(() => {
    const base = activeTeam.baseAddress ? `${activeTeam.baseAddress.lat},${activeTeam.baseAddress.lng}` : 'none';
    const ret = activeTeam.returnAddress === 'none' ? 'no-return' : (activeTeam.returnAddress ? `${activeTeam.returnAddress.lat},${activeTeam.returnAddress.lng}` : 'default');
    const clients = activeTeam.clients.map((c) => `${c.id}:${c.location.lat},${c.location.lng}`).join('|');
    return `${activeTeam.id}::${base}::${ret}::${clients}`;
  }, [activeTeam.id, activeTeam.baseAddress, activeTeam.returnAddress, activeTeam.clients]);

  const activeTeamRef = useRef(activeTeam);
  activeTeamRef.current = activeTeam;

  useEffect(() => {
    if (!directionsService || activeTeamRef.current.clients.length === 0) return;
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
    if (!directionsService || activeTeam.clients.length < 2) return;
    const lockedPositions: Record<number, Client> = {};
    const unlocked: Client[] = [];
    activeTeam.clients.forEach((c, i) => { if (c.isLocked) lockedPositions[i] = c; else unlocked.push(c); });
    if (unlocked.length < 2) return;
    // Use base if available, otherwise use the first unlocked client as origin
    const origin = activeTeam.baseAddress
      ? { lat: activeTeam.baseAddress.lat, lng: activeTeam.baseAddress.lng }
      : { lat: unlocked[0].location.lat, lng: unlocked[0].location.lng };
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

  // Build per-job staff rates for DailySummary
  const jobStaffRates = useMemo(() => {
    if (!allStaff || allStaff.length === 0) return [];
    const staffMap = new Map(allStaff.map(s => [s.id, s]));
    const rates: { id: string; name: string; hourly_rate: number }[] = [];
    const seen = new Set<string>();
    for (const c of activeTeam.clients) {
      for (const sid of c.assignedStaffIds || []) {
        if (!seen.has(sid)) {
          seen.add(sid);
          const s = staffMap.get(sid);
          if (s) rates.push({ id: s.id, name: s.name, hourly_rate: s.hourly_rate });
        }
      }
    }
    return rates;
  }, [activeTeam.clients, allStaff]);

  // ─── Auto-assign driver to newly-added jobs ───
  // When a driver is already set and new clients are added (e.g. via Add Client
  // or template load), ensure the driver appears in their assignedStaffIds.
  const prevClientCountRef2 = useRef(activeTeam.clients.length);
  useEffect(() => {
    if (!activeTeam.driverStaffId) {
      prevClientCountRef2.current = activeTeam.clients.length;
      return;
    }
    // Only run when client count increased (new job added)
    if (activeTeam.clients.length <= prevClientCountRef2.current) {
      prevClientCountRef2.current = activeTeam.clients.length;
      return;
    }
    prevClientCountRef2.current = activeTeam.clients.length;
    const driverId = activeTeam.driverStaffId;
    for (const client of activeTeam.clients) {
      const ids = client.assignedStaffIds || [];
      if (!ids.includes(driverId)) {
        dispatch({
          type: 'ASSIGN_STAFF_TO_JOB',
          teamId: activeTeam.id,
          clientId: client.id,
          staffIds: [...ids, driverId],
        });
      }
    }
  }, [activeTeam.clients.length, activeTeam.driverStaffId, activeTeam.id, activeTeam.clients, dispatch]);

  return (
    <>
      <MapsInitializer onServiceReady={setDirectionsService} />
      <div className="flex-1 flex min-h-0 h-full">
        {/* Schedule Panel */}
        <div className={`${mobileShowMap ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[420px] lg:w-[460px] shrink-0 border-r border-border-light bg-white/50`}>
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-light bg-white">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{formatDateDisplay(state.selectedDate)}</span>
              {disableAutoSave ? (
                <span className="text-[10px] text-primary font-medium flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Template Mode
                </span>
              ) : (
                <>
                  {saveStatus === 'saving' && (
                    <span className="text-[10px] text-text-tertiary flex items-center gap-1">
                      <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                      Saving…
                    </span>
                  )}
                  {saveStatus === 'saved' && (
                    <span className="text-[10px] text-emerald-500 flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                      Saved
                    </span>
                  )}
                  {saveStatus === 'error' && (
                    <span className="text-[10px] text-red-500 flex items-center gap-1" title="Save failed — check connection">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      Save failed
                    </span>
                  )}
                </>
              )}
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
            {activeTeam.baseAddress !== null ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ backgroundColor: activeTeam.color.light }}>🏠</div>
                    <span className="text-xs font-bold text-text-primary">Start Base</span>
                  </div>
                  <button
                    onClick={() => { dispatch({ type: 'CLEAR_BASE_ADDRESS', teamId: activeTeam.id }); requestAnimationFrame(() => saveNow()); }}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-text-tertiary hover:text-red-500 transition-colors"
                    title="Remove start base — day starts at first client"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>
                <PlacesAutocomplete
                  key={`base-${activeTeam.id}`}
                  defaultValue={activeTeam.baseAddress?.address || ''}
                  onPlaceSelect={(place) => {
                    dispatch({
                      type: 'SET_BASE_ADDRESS', teamId: activeTeam.id,
                      location: { address: place.address, lat: place.lat, lng: place.lng, placeId: place.placeId },
                    });
                  }}
                />
              </motion.div>
            ) : (
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                onClick={() => {
                  // Restore base with a prompt to enter address
                  dispatch({
                    type: 'SET_BASE_ADDRESS', teamId: activeTeam.id,
                    location: { address: '', lat: 0, lng: 0 },
                  });
                }}
                className="w-full card p-3 text-center border-dashed border-2 border-border-light text-text-tertiary hover:text-primary hover:border-primary transition-colors text-xs font-medium"
              >
                + Add Start Base
              </motion.button>
            )}

            {/* Start Time */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Day starts at</span>
                <input type="time" value={activeTeam.dayStartTime}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Only dispatch when browser provides a complete HH:MM value.
                    // While typing manually the field may emit "" or partial strings.
                    if (v && /^\d{2}:\d{2}$/.test(v)) {
                      dispatch({ type: 'SET_START_TIME', teamId: activeTeam.id, time: v });
                    }
                  }}
                  className="text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-3 py-1.5 outline-none focus:border-primary" />
              </div>
              {baseDepartureTime !== activeTeam.dayStartTime && (
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border-light">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary shrink-0">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span className="text-[11px] text-text-secondary">Leave base at</span>
                  <span className="text-[11px] font-bold text-primary ml-auto">{baseDepartureTime}</span>
                </div>
              )}
            </motion.div>

            {/* Driver for Today — Rich Picker */}
            {allStaff && allStaff.length > 0 && (() => {
              // Partition staff: available, driving-other-team, unavailable-today
              const parts = state.selectedDate.split('-').map(Number);
              const dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
              const freeForDriver: StaffMember[] = [];
              const drivingOther: { staff: StaffMember; teamName: string }[] = [];
              const unavailableToday: StaffMember[] = [];
              for (const s of allStaff) {
                const availDays = s.available_days;
                const isAvailableToday = !availDays || availDays.length === 0 || availDays.includes(dayOfWeek);
                if (!isAvailableToday) {
                  unavailableToday.push(s);
                } else if (crossTeamDrivers.has(s.id)) {
                  drivingOther.push({ staff: s, teamName: crossTeamDrivers.get(s.id)! });
                } else {
                  freeForDriver.push(s);
                }
              }
              const currentDriver = allStaff.find(s => s.id === activeTeam.driverStaffId);
              return (
                <DriverPickerCard
                  activeTeam={activeTeam}
                  currentDriver={currentDriver || null}
                  freeStaff={freeForDriver}
                  drivingOther={drivingOther}
                  unavailableToday={unavailableToday}
                  dispatch={dispatch}
                />
              );
            })()}

            {/* Available staff summary */}
            {(() => {
              const teamAvailableStaff = availableStaff.filter(s => !crossTeamDrivers.has(s.id));
              return teamAvailableStaff.length > 0 ? (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
                className="card p-3">
                <div className="flex items-center gap-2 mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={activeTeam.color.primary} strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
                  </svg>
                  <span className="text-xs font-bold text-text-primary">Available Today</span>
                  <span className="text-[10px] text-text-tertiary">{teamAvailableStaff.length} staff</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {teamAvailableStaff.map((s) => {
                    const isDriver = activeTeam.driverStaffId === s.id;
                    return (
                      <span key={s.id}
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1 transition-colors ${
                          isDriver
                            ? 'text-white'
                            : 'bg-surface-elevated text-text-secondary'
                        }`}
                        style={isDriver ? { backgroundColor: activeTeam.color.primary } : {}}
                      >
                        {isDriver && (
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                            <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                          </svg>
                        )}
                        {s.name}
                      </span>
                    );
                  })}
                </div>
              </motion.div>
              ) : null;
            })()}

            {/* Optimize */}
            {activeTeam.clients.length >= 2 && (
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
                const hasBase = activeTeam.baseAddress && activeTeam.baseAddress.lat !== 0;
                const prevId = index === 0 ? (hasBase ? 'base' : null) : activeTeam.clients[index - 1].id;
                const segment = prevId ? getTravelSegment(prevId, client.id) : undefined;
                const breakAfterThis = activeTeam.breaks.find((b) => b.afterClientId === client.id);
                return (
                  <motion.div key={client.id} layout>
                    {segment && <TravelSegmentComponent segment={segment} teamColor={activeTeam.color.primary} />}
                    <ClientCard client={client} index={index} totalClients={activeTeam.clients.length}
                      team={activeTeam} dispatch={dispatch} availableStaff={availableStaff}
                      staffBusyPeriods={staffBusyPeriods} driverAssignments={crossTeamDrivers}
                      savedClients={savedClients}
                      onOpenChecklist={setActiveChecklistClient} />
                    {breakAfterThis ? (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                        className="mx-2 my-1 p-3 rounded-xl bg-amber-50/80 border border-amber-200/60">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0">
                              <path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
                              <line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" />
                            </svg>
                            <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Break</span>
                          </div>
                          <button onClick={() => dispatch({ type: 'REMOVE_BREAK', teamId: activeTeam.id, breakId: breakAfterThis.id })}
                            className="p-1 rounded-md hover:bg-red-100 text-amber-400 hover:text-red-500 transition-colors" title="Remove break">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={breakAfterThis.label}
                            onChange={(e) => dispatch({ type: 'UPDATE_BREAK', teamId: activeTeam.id, breakId: breakAfterThis.id, updates: { label: e.target.value } })}
                            className="flex-1 text-xs bg-white border border-amber-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-amber-400 text-text-primary placeholder:text-text-tertiary min-w-0"
                            placeholder="Break label"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => dispatch({ type: 'UPDATE_BREAK', teamId: activeTeam.id, breakId: breakAfterThis.id, updates: { durationMinutes: Math.max(5, breakAfterThis.durationMinutes - 5) } })}
                              className="w-6 h-6 rounded-md bg-white border border-amber-200 flex items-center justify-center text-amber-600 hover:bg-amber-100 transition-colors text-xs font-bold"
                            >−</button>
                            <span className="text-xs font-bold text-amber-700 w-10 text-center">{breakAfterThis.durationMinutes}m</span>
                            <button
                              onClick={() => dispatch({ type: 'UPDATE_BREAK', teamId: activeTeam.id, breakId: breakAfterThis.id, updates: { durationMinutes: breakAfterThis.durationMinutes + 5 } })}
                              className="w-6 h-6 rounded-md bg-white border border-amber-200 flex items-center justify-center text-amber-600 hover:bg-amber-100 transition-colors text-xs font-bold"
                            >+</button>
                          </div>
                        </div>
                      </motion.div>
                    ) : index < activeTeam.clients.length - 1 ? (
                      <div className="flex justify-center py-2 -my-1">
                        <button onClick={() => addBreak(client.id)}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-transparent hover:text-amber-600 transition-all px-3 py-1.5 rounded-full hover:bg-amber-50 border border-transparent hover:border-amber-200">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                          Add Break
                        </button>
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Return destination */}
            {activeTeam.clients.length > 0 && activeTeam.returnAddress !== 'none' && (
              <>
                {activeTeam.baseAddress && (
                  <TravelSegmentComponent
                    segment={getTravelSegment(activeTeam.clients[activeTeam.clients.length - 1].id, 'base-return')}
                    teamColor={activeTeam.color.primary} />
                )}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-surface-elevated flex items-center justify-center text-sm">🏠</div>
                      <span className="text-xs font-bold text-text-primary">
                        {activeTeam.returnAddress ? 'Return To' : 'Return to Base'}
                      </span>
                    </div>
                    <button
                      onClick={() => { dispatch({ type: 'CLEAR_RETURN_ADDRESS', teamId: activeTeam.id }); requestAnimationFrame(() => saveNow()); }}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-text-tertiary hover:text-red-500 transition-colors"
                      title="Remove return — day ends at last client"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <PlacesAutocomplete
                    key={`return-${activeTeam.id}`}
                    defaultValue={
                      activeTeam.returnAddress
                        ? activeTeam.returnAddress.address
                        : activeTeam.baseAddress?.address || ''
                    }
                    onPlaceSelect={(place) => {
                      dispatch({
                        type: 'SET_RETURN_ADDRESS',
                        teamId: activeTeam.id,
                        location: { address: place.address, lat: place.lat, lng: place.lng, placeId: place.placeId },
                      });
                    }}
                  />
                  {activeTeam.returnAddress && activeTeam.baseAddress && (
                    <button
                      onClick={() => dispatch({ type: 'SET_RETURN_ADDRESS', teamId: activeTeam.id, location: activeTeam.baseAddress! })}
                      className="mt-2 text-[11px] text-text-tertiary hover:text-primary transition-colors"
                    >
                      ↩ Reset to base address
                    </button>
                  )}
                </motion.div>
              </>
            )}

            {/* Add return if removed */}
            {activeTeam.clients.length > 0 && activeTeam.returnAddress === 'none' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center pt-2">
                <button
                  onClick={() => {
                    if (activeTeam.baseAddress) {
                      dispatch({ type: 'SET_RETURN_ADDRESS', teamId: activeTeam.id, location: activeTeam.baseAddress });
                    } else {
                      // No base — set return with empty address so the autocomplete appears
                      dispatch({ type: 'SET_RETURN_ADDRESS', teamId: activeTeam.id, location: { address: '', lat: 0, lng: 0 } });
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary hover:text-primary transition-colors px-3 py-2 rounded-lg hover:bg-surface-hover border border-dashed border-border-light"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add return destination
                </button>
              </motion.div>
            )}

            {/* Add Client */}
            <div className="pt-1">
              <AddClientButton teamId={activeTeam.id} teamColor={activeTeam.color.primary} dispatch={dispatch} orgId={orgId} />
            </div>

            {/* Daily Summary */}
            {activeTeam.clients.length > 0 && (
              <div className="pt-2">
                <DailySummaryCard
                  team={activeTeam}
                  summary={summary}
                  dispatch={dispatch}
                  staffNames={jobStaffRates.map(s => s.name)}
                  staffRates={jobStaffRates}
                />
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

        {/* Map Panel or Checklist Panel */}
        <div className={`${mobileShowMap || activeChecklistClient ? 'flex' : 'hidden md:flex'} flex-1 relative`}>
          <AnimatePresence mode="wait">
            {activeChecklistClient ? (
              <motion.div key="checklist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 p-2 overflow-hidden">
                <Suspense fallback={<div className="h-full flex items-center justify-center"><div className="shimmer w-full h-full rounded-2xl" /></div>}>
                  <ClientChecklistPanel
                    client={activeChecklistClient}
                    orgId={orgId || ''}
                    isAdmin={isAdmin}
                    scheduleJobId={activeChecklistClient.id}
                    onClose={() => { setActiveChecklistClient(null); setMobileShowMap(false); }}
                  />
                </Suspense>
              </motion.div>
            ) : (
              <motion.div key="map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
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
              </motion.div>
            )}
          </AnimatePresence>
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

