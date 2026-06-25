'use client';

import { useEffect, useMemo, useState, useRef, useCallback, Dispatch, MutableRefObject } from 'react';
import { Map as GoogleMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { AnimatePresence, motion } from 'framer-motion';

import { calculateAllTravel, calculateScheduleTimes, calculateDaySummary, ScheduleTimesResult } from '@/lib/routeEngine';
import { computeDayWarnings, getStaffConflict, getOtherTeamEndLabel, ScheduleWarning } from '@/lib/scheduleWarnings';
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

// ─── Team Staff Picker Card ────────────────────────────────────────────────────
// Replaces the per-job staff assignment. All staff on this card are fixed for
// ALL jobs this team handles today. Conflict detection prevents assigning staff
// who are already on another team today.
interface TeamStaffPickerCardProps {
  activeTeam: TeamSchedule;
  availableStaff: StaffMember[];     // staff available on this day-of-week (no time conflict)
  busyStaff: { staff: StaffMember; teamName: string }[];  // on another team with overlapping hours
  unavailableToday: StaffMember[];   // day-off staff
  /** staffId → label like "Shared · Team 2 ends 5:32 PM" for non-conflicting shared staff */
  sharedStaffLabels: Map<string, string>;
  dispatch: Dispatch<ScheduleAction>;
}

function TeamStaffPickerCard({ activeTeam, availableStaff, busyStaff, unavailableToday, sharedStaffLabels, dispatch }: TeamStaffPickerCardProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const currentStaffIds = activeTeam.staffIds || [];

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

  // Auto-focus search when popover opens, clear on close
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch('');
    }
  }, [open]);

  const toggleStaff = (staffId: string) => {
    const next = currentStaffIds.includes(staffId)
      ? currentStaffIds.filter(id => id !== staffId)
      : [...currentStaffIds, staffId];
    dispatch({ type: 'SET_TEAM_STAFF', teamId: activeTeam.id, staffIds: next });
    // If the removed staff member was the driver, clear the driver too
    if (!next.includes(activeTeam.driverStaffId || '')) {
      dispatch({ type: 'SET_DRIVER', teamId: activeTeam.id, staffId: null });
    }
  };

  const clearAll = () => {
    dispatch({ type: 'SET_TEAM_STAFF', teamId: activeTeam.id, staffIds: [] });
    dispatch({ type: 'SET_DRIVER', teamId: activeTeam.id, staffId: null });
  };

  // Include shared (non-conflicting) staff in the chips — they may be already assigned
  const assignedStaff = availableStaff.filter(s => currentStaffIds.includes(s.id));

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }}
      className="card p-3 relative">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={activeTeam.color.primary} strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span className="text-xs font-bold text-text-primary">Team Staff</span>
          {currentStaffIds.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: activeTeam.color.primary }}>
              {currentStaffIds.length}
            </span>
          )}
        </div>
        {currentStaffIds.length > 0 && (
          <button
            onClick={clearAll}
            className="text-[10px] text-text-tertiary hover:text-danger transition-colors px-1.5 py-0.5 rounded-md hover:bg-red-50"
          >✕ Clear all</button>
        )}
      </div>

      {/* Current staff chips */}
      {assignedStaff.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {assignedStaff.map(s => (
            <button
              key={s.id}
              onClick={() => toggleStaff(s.id)}
              className="text-[11px] font-semibold px-2 py-1 rounded-lg text-white flex items-center gap-1 transition-all hover:opacity-80"
              style={{ backgroundColor: activeTeam.color.primary }}
              title={`Remove ${s.name}`}
            >
              {s.name}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          ))}
        </div>
      )}

      {/* Driver selector — appears once at least one staff member is on the team */}
      {assignedStaff.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={activeTeam.color.primary} strokeWidth="2" className="shrink-0">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
          <span className="text-[11px] font-bold text-text-secondary shrink-0">Driver</span>
          <select
            value={activeTeam.driverStaffId || ''}
            onChange={e => dispatch({ type: 'SET_DRIVER', teamId: activeTeam.id, staffId: e.target.value || null })}
            className="flex-1 text-[11px] bg-surface-elevated border border-border-light rounded-lg px-2 py-1 outline-none focus:border-primary cursor-pointer text-text-primary"
          >
            <option value="">— No driver —</option>
            {assignedStaff.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Add staff button */}
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className="mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-xl border-dashed border-2 border-border-light hover:border-primary hover:bg-primary-light/20 transition-all text-xs text-text-tertiary font-medium"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {currentStaffIds.length === 0 ? 'Assign team staff…' : 'Add more staff…'}
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
            {/* Search input */}
            <div className="flex items-center gap-2 px-2 pb-1.5 border-b border-border-light mb-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-text-tertiary">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search staff…"
                className="flex-1 text-xs bg-transparent outline-none text-text-primary placeholder-text-tertiary py-1"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-text-tertiary hover:text-text-primary transition-colors">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
            <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 py-1">Available Today</div>
            {availableStaff.length === 0 && busyStaff.length === 0 && unavailableToday.length === 0 ? (
              <div className="text-xs text-text-tertiary px-2 py-4 text-center">No staff found</div>
            ) : (() => {
              const q = search.toLowerCase();
              const filteredAvailable = availableStaff.filter(s => s.name.toLowerCase().includes(q));
              const filteredBusy = busyStaff.filter(({ staff: s }) => s.name.toLowerCase().includes(q));
              const filteredUnavailable = unavailableToday.filter(s => s.name.toLowerCase().includes(q));
              const noResults = filteredAvailable.length === 0 && filteredBusy.length === 0 && filteredUnavailable.length === 0;
              return (
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                  {noResults ? (
                    <div className="text-xs text-text-tertiary px-2 py-4 text-center">No staff match "{search}"</div>
                  ) : (
                    <>
                      {filteredAvailable.map(s => {
                        const isSelected = currentStaffIds.includes(s.id);
                        const sharedLabel = sharedStaffLabels.get(s.id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => { toggleStaff(s.id); }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-xs text-left transition-all ${
                              isSelected ? 'bg-primary-light/40' : 'hover:bg-surface-hover'
                            }`}
                            style={isSelected ? { outline: `2px solid ${activeTeam.color.primary}40`, outlineOffset: '-2px' } : {}}
                          >
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: isSelected ? activeTeam.color.primary : '#9CA3AF' }}>
                              {s.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="font-semibold text-text-primary block truncate">{s.name}</span>
                              {sharedLabel ? (
                                <span className="text-[10px] text-amber-600 font-medium">{sharedLabel}</span>
                              ) : (
                                <span className="text-[10px] text-text-tertiary capitalize">{s.role} · ${s.hourly_rate}/hr</span>
                              )}
                            </div>
                            {isSelected && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={activeTeam.color.primary} strokeWidth="2.5" className="shrink-0">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </button>
                        );
                      })}

                      {/* Overlapping conflict — greyed out */}
                      {filteredBusy.length > 0 && (
                        <>
                          <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 pt-2.5 pb-1 mt-1 border-t border-border-light">Unavailable — Schedule Conflict</div>
                          {filteredBusy.map(({ staff: s, teamName }) => (
                            <div
                              key={s.id}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-xs text-left opacity-45 cursor-not-allowed"
                              title={`Already on ${teamName} today`}
                            >
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 bg-gray-400">
                                {s.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="font-semibold text-text-tertiary block truncate">{s.name}</span>
                                <span className="text-[10px] text-orange-400">{teamName}</span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}

                      {/* Not available today */}
                      {filteredUnavailable.length > 0 && (
                        <>
                          <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 pt-2.5 pb-1 mt-1 border-t border-border-light">Not Available Today</div>
                          {filteredUnavailable.map(s => (
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
                                <span className="text-[10px] text-text-tertiary">Not available · ${s.hourly_rate}/hr</span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Calculate Fuel Card ────────────────────────────────────────────────────────
interface TeamSettingsCardProps {
  activeTeam: TeamSchedule;
  dispatch: Dispatch<ScheduleAction>;
  dbLoaded: boolean;
  supabase: SupabaseClient;
}

function TeamSettingsCard({ activeTeam, dispatch, dbLoaded, supabase }: TeamSettingsCardProps) {
  // calcFuel is derived directly from the DB-loaded field — no local state needed
  const calcFuel = activeTeam.calculateFuel;
  // Remember the last non-zero values so toggling back ON restores them
  const prevValuesRef = useRef({ fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0 });

  // When calculate_fuel is ON, keep prevValuesRef updated with current values
  useEffect(() => {
    if (calcFuel && activeTeam.fuelEfficiency > 0) {
      prevValuesRef.current = {
        fuelEfficiency: activeTeam.fuelEfficiency,
        fuelPrice: activeTeam.fuelPrice,
        perKmRate: activeTeam.perKmRate,
      };
    }
  }, [calcFuel, activeTeam.fuelEfficiency, activeTeam.fuelPrice, activeTeam.perKmRate]);

  // Write fuel values + toggle state directly to DB
  const saveFuelToDB = useCallback(async (on: boolean, eff: number, price: number, km: number) => {
    const { error } = await supabase.from('teams').update({
      calculate_fuel: on,
      fuel_efficiency: eff,
      fuel_price: price,
      per_km_rate: km,
    }).eq('id', activeTeam.id);
    if (error) console.error('[saveFuelToDB] failed:', error);
  }, [supabase, activeTeam.id]);

  if (!dbLoaded) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
      className="card px-3 py-2.5 space-y-2.5">

      {/* Calculate Fuel toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary">
            <path d="M3 22V8l9-6 9 6v14"/><path d="M9 22V12h6v10"/><path d="M21 15h-2a2 2 0 0 0-2 2v5"/>
          </svg>
          <span className="text-xs text-text-secondary font-medium">Calculate Fuel</span>
        </div>
        <button
          onClick={() => {
            const next = !calcFuel;
            if (!next) {
              // Save current values to restore later
              prevValuesRef.current = {
                fuelEfficiency: activeTeam.fuelEfficiency > 0 ? activeTeam.fuelEfficiency : prevValuesRef.current.fuelEfficiency,
                fuelPrice: activeTeam.fuelPrice > 0 ? activeTeam.fuelPrice : prevValuesRef.current.fuelPrice,
                perKmRate: activeTeam.perKmRate,
              };
              dispatch({ type: 'SET_CALCULATE_FUEL', teamId: activeTeam.id, calculateFuel: false });
              dispatch({ type: 'SET_FUEL_SETTINGS', teamId: activeTeam.id, fuelEfficiency: 0, fuelPrice: 0 });
              dispatch({ type: 'SET_PER_KM_RATE', teamId: activeTeam.id, rate: 0 });
              saveFuelToDB(false, 0, 0, 0);
            } else {
              const prev = prevValuesRef.current;
              const eff = prev.fuelEfficiency > 0 ? prev.fuelEfficiency : 10;
              const price = prev.fuelPrice > 0 ? prev.fuelPrice : 1.85;
              dispatch({ type: 'SET_CALCULATE_FUEL', teamId: activeTeam.id, calculateFuel: true });
              dispatch({ type: 'SET_FUEL_SETTINGS', teamId: activeTeam.id, fuelEfficiency: eff, fuelPrice: price });
              dispatch({ type: 'SET_PER_KM_RATE', teamId: activeTeam.id, rate: prev.perKmRate });
              saveFuelToDB(true, eff, price, prev.perKmRate);
            }
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${calcFuel ? 'bg-primary' : 'bg-surface-elevated border border-border-light'}`}
          style={{ backgroundColor: calcFuel ? activeTeam.color.primary : undefined }}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${calcFuel ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Fuel rows — animate in/out when toggled */}
      <AnimatePresence>
        {calcFuel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden space-y-2.5 border-t border-border-light pt-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">Fuel Efficiency (L/100km)</span>
              <input type="number" value={activeTeam.fuelEfficiency}
                onChange={(e) => { const v = parseFloat(e.target.value) || 0; dispatch({ type: 'SET_FUEL_SETTINGS', teamId: activeTeam.id, fuelEfficiency: v, fuelPrice: activeTeam.fuelPrice }); }}
                onBlur={(e) => { const v = parseFloat(e.target.value) || 0; saveFuelToDB(true, v, activeTeam.fuelPrice, activeTeam.perKmRate); }}
                className="w-20 text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary text-right"
                min={0} step={0.5} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">Fuel Price ($/L)</span>
              <input type="number" value={activeTeam.fuelPrice}
                onChange={(e) => { const v = parseFloat(e.target.value) || 0; dispatch({ type: 'SET_FUEL_SETTINGS', teamId: activeTeam.id, fuelEfficiency: activeTeam.fuelEfficiency, fuelPrice: v }); }}
                onBlur={(e) => { const v = parseFloat(e.target.value) || 0; saveFuelToDB(true, activeTeam.fuelEfficiency, v, activeTeam.perKmRate); }}
                className="w-20 text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary text-right"
                min={0} step={0.01} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">Per-KM Rate ($/km)</span>
              <input type="number" value={activeTeam.perKmRate}
                onChange={(e) => { const v = parseFloat(e.target.value) || 0; dispatch({ type: 'SET_PER_KM_RATE', teamId: activeTeam.id, rate: v }); }}
                onBlur={(e) => { const v = parseFloat(e.target.value) || 0; saveFuelToDB(true, activeTeam.fuelEfficiency, activeTeam.fuelPrice, v); }}
                className="w-20 text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1.5 outline-none focus:border-primary text-right"
                min={0} step={0.01} />
            </div>
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
  /** Ref set to true by the parent just before an explicit flush + view-mode switch.
   *  When true the unmount-cleanup save is skipped to prevent a double-save race. */
  skipUnmountSaveRef?: MutableRefObject<boolean>;
  hideFinancials?: boolean;
  /** When true, the entire editor is locked — no interactions at all. Used for published weeks. */
  readOnly?: boolean;
  /** Fires when the DayEditor detects actual schedule changes (not just view transitions). */
  onModified?: () => void | Promise<void>;
  /** Template code for the current day (e.g. "Week A4") — passed through to staff export. */
  templateCode?: string;
}

export default function DayEditor({ state, dispatch, orgId, dbLoaded, supabase, saveRef, allStaff, isAdmin = true, loadGeneration = 0, disableAutoSave = false, skipUnmountSaveRef, hideFinancials, readOnly = false, onModified, templateCode }: DayEditorProps) {
  const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService | null>(null);
  const [mobileShowMap, setMobileShowMap] = useState(false);
  const [activeChecklistClient, setActiveChecklistClient] = useState<Client | null>(null);
  const checklistPanelRef = useRef<HTMLDivElement>(null);

  // Close the checklist editor on any click outside its panel
  useEffect(() => {
    if (!activeChecklistClient) return;
    const handler = (e: MouseEvent) => {
      if (checklistPanelRef.current && !checklistPanelRef.current.contains(e.target as Node)) {
        setActiveChecklistClient(null);
        setMobileShowMap(false);
      }
    };
    // Use capture so we catch clicks before any stopPropagation inside the panel
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [activeChecklistClient]);

  // Saved client database — used for the swap-client feature on each card
  const { clients: savedClients } = useClients(orgId ?? null);

  // Guard: state.teams may be empty for an untouched/cleared week
  const activeTeam = useMemo(
    () => state.teams.find((t) => t.id === state.activeTeamId) ?? state.teams[0] ?? null,
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

  // Build cross-team staff assignments map (staffId → teamName)
  // Used by the ClientCard per-job staff picker to grey out busy staff
  const crossTeamDrivers = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeTeam) return map;
    for (const team of state.teams) {
      if (team.id === activeTeam.id) continue;
      for (const sid of team.staffIds || []) {
        map.set(sid, team.name);
      }
    }
    return map;
  }, [state.teams, activeTeam]);

  // ─── Auto-save ───
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStateRef = useRef<string>('');
  // Fingerprint that excludes computed startTime/endTime — used to detect
  // when the schedule calculation ran post-load without user changes.
  const prevNoTimesRef = useRef<string>('');
  const prevClientCountRef = useRef<number>(-1);
  const prevBreakCountRef = useRef<number>(-1);
  const prevBreaksRef = useRef<string>('');
  const prevBaseRef = useRef<string>('');
  const prevStaffRef = useRef<string>('');
  // Track team-level settings (name, rates, times) separately so we only
  // UPDATE the teams table when those actually change, not on every save.
  const prevTeamSettingsRef = useRef<string>('');
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
  // Track whether there are unsaved changes (for the manual save button + beforeunload)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const hasUnsavedChangesRef = useRef(false);

  const onModifiedRef = useRef(onModified);
  onModifiedRef.current = onModified;

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

      // Fire onModified BEFORE writing data — this lets the parent set
      // is_published=false before we write the new job rows, so staff never
      // see half-edited published data.
      if (hasUnsavedChangesRef.current) {
        await onModifiedRef.current?.();
      }

      // ⚠️ SNAPSHOT state outside the retry loop so we don't accidentally save
      // a different day's data if the user switches days during a retry wait!
      const currentStateSnapshot = stateRef.current;
      const today = currentStateSnapshot.selectedDate;

      let attempt = 0;
      let success = false;
      while (attempt < 2 && !success) {
        attempt++;
        try {
        if (!orgId) break;
        for (const team of currentStateSnapshot.teams) {
          await supabase.from('teams').update({
            name: team.name, day_start_time: team.dayStartTime,
            hourly_rate: team.hourlyRate, fuel_efficiency: team.fuelEfficiency,
            fuel_price: team.fuelPrice, per_km_rate: team.perKmRate,
          }).eq('id', team.id);

          const hasClients = team.clients.length > 0;
          const hasBaseAddress = team.baseAddress !== null;
          const hasReturnAddress = team.returnAddress !== null && team.returnAddress !== 'none';
          const hasBreaks = team.breaks.length > 0;
          const hasDriver = !!team.driverStaffId;
          const hasStaff = (team.staffIds || []).length > 0;
          const { data: existingSched } = await supabase
            .from('schedules').select('id').eq('team_id', team.id).eq('schedule_date', today).maybeSingle();

          if (!hasClients && !hasBaseAddress && !hasReturnAddress && !hasBreaks && !hasDriver && !hasStaff && !existingSched) continue;

          const teamSummary = calculateDaySummary(team);
          const scheduleData: Record<string, unknown> = {
            org_id: orgId, team_id: team.id, schedule_date: today,
            has_start_base: team.baseAddress !== null,
            // null = not set → false; 'none' = explicitly cleared → false; Location = set → true
            has_return_base: team.returnAddress !== null && team.returnAddress !== 'none',
            driver_staff_id: team.driverStaffId || null,
            staff_ids: team.staffIds || [],
          };
          // Only write travel/distance when we have real data (> 0).
          // This prevents overwriting previously saved values with 0 for
          // teams whose Google Maps routes haven't loaded this session.
          if (teamSummary.totalTravelMinutes > 0) {
            scheduleData.total_travel_minutes = teamSummary.totalTravelMinutes;
          }
          if (teamSummary.totalDistanceKm > 0) {
            scheduleData.total_distance_km = teamSummary.totalDistanceKm;
          }
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

          // ── Safety guard: prevent accidental job wipe ──────────────────
          // If the in-memory state has zero clients but the DB schedule
          // already has jobs, something went wrong during load (network
          // blip, stale state, etc.). Skip the delete-and-reinsert to
          // avoid wiping live schedule data.
          if (existingSched && team.clients.length === 0) {
            const { count } = await supabase
              .from('schedule_jobs')
              .select('id', { count: 'exact', head: true })
              .eq('schedule_id', scheduleId)
              .eq('is_break', false);
            if (count && count > 0) {
              console.warn(`[AutoSave] Skipping job save for team "${team.name}" — DB has ${count} jobs but state has 0 clients (possible load failure)`);
              continue;
            }
          }

          await supabase.from('schedule_jobs').delete().eq('schedule_id', scheduleId);
          // Build rows: regular clients first, then breaks
          const allRows: Record<string, unknown>[] = [
            ...team.clients.map((c, i) => ({
              id: c.id,
              schedule_id: scheduleId, org_id: orgId, client_id: c.savedClientId || null,
              position: i, name: c.name, address: c.location.address,
              lat: c.location.lat, lng: c.location.lng, place_id: c.location.placeId || null,
              duration_minutes: c.jobDurationMinutes, staff_count: c.staffCount || 1,
              is_locked: c.isLocked || false, is_break: false, notes: c.notes || '',
              start_time: c.startTime || null, end_time: c.endTime || null,
              fixed_start_time: c.fixedStartTime || null,
              assigned_staff_ids: c.assignedStaffIds || [],
              checklist_id: c.checklistId || null,
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
        setHasUnsavedChanges(false);
        hasUnsavedChangesRef.current = false;
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
  // Skipped when the parent sets skipUnmountSaveRef (it already flushed explicitly).
  useEffect(() => {
    if (disableAutoSave) return;
    return () => {
      if (skipUnmountSaveRef?.current) return; // parent already flushed — skip to avoid race
      saveNowRef.current();
    };
  }, [disableAutoSave, skipUnmountSaveRef]);

  // Warn when closing/refreshing the browser with unsaved changes
  useEffect(() => {
    if (disableAutoSave) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges, disableAutoSave]);

  useEffect(() => {
    if (disableAutoSave) return; // Template mode: skip auto-save entirely
    if (!dbLoaded || !orgId) return;

    const totalClients = state.teams.reduce((sum, t) => sum + t.clients.length, 0);

    // Full fingerprint — used as the save baseline
    const fingerprint = JSON.stringify(
      state.teams.map((t) => ({
        id: t.id, name: t.name, base: t.baseAddress, ret: t.returnAddress, start: t.dayStartTime,
        rate: t.hourlyRate, fuel: t.fuelEfficiency, price: t.fuelPrice, km: t.perKmRate,
        driver: t.driverStaffId || null,
        staffIds: t.staffIds || [],
        clients: t.clients.map((c) => ({
          id: c.id, name: c.name, addr: c.location.address,
          lat: c.location.lat, lng: c.location.lng,
          dur: c.jobDurationMinutes, notes: c.notes || '',
          staff: c.staffCount, locked: c.isLocked, fixed: c.fixedStartTime,
          color: c.clientColor,
          checklist: c.checklistId || null,
          startTime: c.startTime, endTime: c.endTime,
        })),
        breaks: t.breaks,
      }))
    );

    // No-times fingerprint — excludes computed startTime/endTime so a
    // post-load schedule calculation doesn't look like a user change.
    const fingerprintNoTimes = JSON.stringify(
      state.teams.map((t) => ({
        id: t.id, name: t.name, base: t.baseAddress, ret: t.returnAddress, start: t.dayStartTime,
        rate: t.hourlyRate, fuel: t.fuelEfficiency, price: t.fuelPrice, km: t.perKmRate,
        driver: t.driverStaffId || null,
        staffIds: t.staffIds || [],
        clients: t.clients.map((c) => ({
          id: c.id, name: c.name, addr: c.location.address,
          lat: c.location.lat, lng: c.location.lng,
          dur: c.jobDurationMinutes, notes: c.notes || '',
          staff: c.staffCount, locked: c.isLocked, fixed: c.fixedStartTime,
          color: c.clientColor,
          checklist: c.checklistId || null,
          // startTime / endTime intentionally omitted
        })),
        breaks: t.breaks,
      }))
    );

    // First run after a day load — just record the baseline, don't save.
    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      prevStateRef.current = fingerprint;
      prevNoTimesRef.current = fingerprintNoTimes;
      prevClientCountRef.current = totalClients;
      prevBreakCountRef.current = state.teams.reduce((sum, t) => sum + t.breaks.length, 0);
      prevBaseRef.current = JSON.stringify(state.teams.map(t => ({ base: t.baseAddress, ret: t.returnAddress })));
      prevStaffRef.current = JSON.stringify(state.teams.map(t => ({ driver: t.driverStaffId, staffIds: t.staffIds || [] })));
      prevBreaksRef.current = JSON.stringify(state.teams.map(t => t.breaks));
      prevTeamSettingsRef.current = JSON.stringify(state.teams.map(t => ({
        id: t.id, name: t.name, start: t.dayStartTime,
        rate: t.hourlyRate, fuel: t.fuelEfficiency, price: t.fuelPrice, km: t.perKmRate,
      })));
      return;
    }

    if (fingerprint === prevStateRef.current) return;

    // If the only thing that changed is computed startTime/endTime (schedule calculation
    // just ran on freshly loaded data), silently update the baseline — no save needed.
    if (fingerprintNoTimes === prevNoTimesRef.current) {
      prevStateRef.current = fingerprint; // absorb the time update into baseline
      return;
    }

    prevStateRef.current = fingerprint;
    prevNoTimesRef.current = fingerprintNoTimes;
    setHasUnsavedChanges(true);
    hasUnsavedChangesRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    // Structural = client/break count changed OR base/return address changed
    //            OR staff assignments/driver changed → save immediately.
    // Detail change (duration, notes etc.) → 1500ms debounce.
    const totalBreaks = state.teams.reduce((sum, t) => sum + t.breaks.length, 0);
    const curBreaks = JSON.stringify(state.teams.map(t => t.breaks));
    const curBase = JSON.stringify(state.teams.map(t => ({ base: t.baseAddress, ret: t.returnAddress })));
    const curStaff = JSON.stringify(state.teams.map(t => ({ driver: t.driverStaffId, staffIds: t.staffIds || [] })));
    const curTeamSettings = JSON.stringify(state.teams.map(t => ({
      id: t.id, name: t.name, start: t.dayStartTime,
      rate: t.hourlyRate, fuel: t.fuelEfficiency, price: t.fuelPrice, km: t.perKmRate,
    })));
    const isStructural =
      totalClients !== prevClientCountRef.current ||
      totalBreaks !== prevBreakCountRef.current ||
      curBreaks !== prevBreaksRef.current ||
      curBase !== prevBaseRef.current ||
      curStaff !== prevStaffRef.current ||
      curTeamSettings !== prevTeamSettingsRef.current; // fuel/name/rate changes save immediately
    prevClientCountRef.current = totalClients;
    prevBreakCountRef.current = totalBreaks;
    prevBreaksRef.current = curBreaks;
    prevBaseRef.current = curBase;
    prevStaffRef.current = curStaff;
    prevTeamSettingsRef.current = curTeamSettings;

    if (isStructural) {
      saveNow();
    } else {
      // Detail changes (duration, notes, checklist, rates) — debounce to
      // avoid hammering the DB while the user is still interacting.
      saveTimerRef.current = setTimeout(() => { saveNow(); }, 1500);
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [state, dbLoaded, orgId, saveNow]);

  // ─── Background geocoding for zero-coordinate clients ───
  // When clients load from DB with lat=0/lng=0 (ocean pin), resolve their
  // address via Google Places and patch the location in state + save.
  const geocodedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!dbLoaded || !window.google?.maps?.places) return;
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

  // ─── Schedule calculations (guard: activeTeam may be null for empty weeks) ───
  const scheduleResult = useMemo(() => activeTeam ? calculateScheduleTimes(activeTeam) : { clients: [], baseDepartureTime: null }, [activeTeam]);
  const baseDepartureTime = scheduleResult.baseDepartureTime;
  useEffect(() => {
    if (!activeTeam) return;
    if (scheduleResult.clients.length > 0) {
      const hasChanges = scheduleResult.clients.some((c, i) => {
        const original = activeTeam.clients[i];
        return original && (c.startTime !== original.startTime || c.endTime !== original.endTime);
      });
      if (hasChanges) dispatch({ type: 'SET_CLIENT_TIMES', teamId: activeTeam.id, clients: scheduleResult.clients });
    }
  }, [scheduleResult, activeTeam, dispatch]);

  const summary = useMemo(() => activeTeam ? calculateDaySummary(activeTeam) : null, [activeTeam]);

  const routeKey = useMemo(() => {
    if (!activeTeam) return 'empty';
    const base = activeTeam.baseAddress ? `${activeTeam.baseAddress.lat},${activeTeam.baseAddress.lng}` : 'none';
    const ret = activeTeam.returnAddress === 'none' ? 'no-return' : (activeTeam.returnAddress ? `${activeTeam.returnAddress.lat},${activeTeam.returnAddress.lng}` : 'default');
    const clients = activeTeam.clients.map((c) => `${c.id}:${c.location?.lat ?? 0},${c.location?.lng ?? 0}`).join('|');
    return `${activeTeam.id}::${base}::${ret}::${clients}`;
  }, [activeTeam]);

  const activeTeamRef = useRef(activeTeam);
  activeTeamRef.current = activeTeam;

  useEffect(() => {
    if (!directionsService || !activeTeamRef.current || activeTeamRef.current.clients.length === 0) return;
    const teamId = activeTeamRef.current.id;
    dispatch({ type: 'CLEAR_TRAVEL', teamId });
    const timer = setTimeout(async () => {
      // ── 1. Calculate active team's routes ──
      let totalTravelMins = 0;
      let totalDistKm = 0;
      await calculateAllTravel(directionsService, activeTeamRef.current, (segment) => {
        dispatch({ type: 'UPDATE_TRAVEL', teamId, segment });
        if (!segment.isCalculating) {
          totalTravelMins += segment.durationMinutes;
          totalDistKm += segment.distanceKm;
        }
      });
      // Save active team's totals
      if (orgId && (totalTravelMins > 0 || totalDistKm > 0)) {
        const schedDate = stateRef.current.selectedDate;
        await supabase.from('schedules')
          .update({ total_travel_minutes: totalTravelMins, total_distance_km: totalDistKm })
          .eq('team_id', teamId)
          .eq('schedule_date', schedDate);
      }

      // ── 2. Background-calculate routes for all OTHER teams with clients ──
      const otherTeams = stateRef.current.teams.filter(t => t.id !== teamId && t.clients.length > 0);
      for (const otherTeam of otherTeams) {
        let otherTravelMins = 0;
        let otherDistKm = 0;
        await calculateAllTravel(directionsService, otherTeam, (segment) => {
          dispatch({ type: 'UPDATE_TRAVEL', teamId: otherTeam.id, segment });
          if (!segment.isCalculating) {
            otherTravelMins += segment.durationMinutes;
            otherDistKm += segment.distanceKm;
          }
        });
        if (orgId && (otherTravelMins > 0 || otherDistKm > 0)) {
          await supabase.from('schedules')
            .update({ total_travel_minutes: otherTravelMins, total_distance_km: otherDistKm })
            .eq('team_id', otherTeam.id)
            .eq('schedule_date', stateRef.current.selectedDate);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [routeKey, directionsService, dispatch, orgId, supabase]);

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

  // Build team staff rates for DailySummary (team-level, not per-job)
  const jobStaffRates = useMemo(() => {
    if (!activeTeam || !allStaff || allStaff.length === 0) return [];
    const staffMap = new Map(allStaff.map(s => [s.id, s]));
    const rates: { id: string; name: string; hourly_rate: number }[] = [];
    for (const sid of activeTeam.staffIds || []) {
      const s = staffMap.get(sid);
      if (s) rates.push({ id: s.id, name: s.name, hourly_rate: s.hourly_rate });
    }
    return rates;
  }, [activeTeam, allStaff]);

  // ─── Day-level warnings (cross-team conflicts, travel feasibility, no staff) ───
  const dayWarnings = useMemo(() => {
    if (!allStaff) return [] as ScheduleWarning[];
    return computeDayWarnings(state.teams, allStaff);
  }, [state.teams, allStaff]);



  // Guard: if there are no teams yet (empty/cleared week), don't attempt to render
  if (!activeTeam) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-6">
        <div>
          <p className="text-sm font-semibold text-text-primary">No teams for this day</p>
          <p className="text-xs text-text-tertiary mt-1">Use the + button in the team tabs to add a team for this week.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <MapsInitializer onServiceReady={setDirectionsService} />
      <div className={`flex-1 flex min-h-0 h-full ${readOnly ? 'pointer-events-none select-none opacity-70' : ''}`}>
        {/* Schedule Panel */}
        <div className={`${mobileShowMap ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[420px] lg:w-[460px] shrink-0 border-r border-border-light bg-white/50 relative`}>
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
            {/* ── Warning banners ── */}
            {dayWarnings.filter(w => w.level !== 'info').map(w => (
              <div
                key={w.id}
                className={`rounded-xl px-3 py-2.5 flex gap-2.5 items-start ${
                  w.level === 'error'
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-amber-50 border border-amber-200'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke={w.level === 'error' ? '#ef4444' : '#d97706'} strokeWidth="2.5"
                  className="shrink-0 mt-0.5"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-bold ${ w.level === 'error' ? 'text-red-700' : 'text-amber-700'}`}>{w.title}</p>
                  <p className={`text-[10px] mt-0.5 leading-relaxed ${ w.level === 'error' ? 'text-red-600' : 'text-amber-600'}`}>{w.detail}</p>
                </div>
              </div>
            ))}
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
            {(() => {
              const hasBaseDeparture = baseDepartureTime && baseDepartureTime !== activeTeam.dayStartTime;
              const displayTime = hasBaseDeparture ? baseDepartureTime : activeTeam.dayStartTime;
              return (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                  className="card p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={hasBaseDeparture ? 'text-primary' : 'text-text-tertiary'}>
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      <span className="text-xs text-text-secondary">Day starts at</span>
                    </div>
                    <input type="time" value={displayTime}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v && /^\d{2}:\d{2}$/.test(v)) {
                          dispatch({ type: 'SET_START_TIME', teamId: activeTeam.id, time: v });
                        }
                      }}
                      className={`text-sm font-medium bg-surface-elevated border rounded-lg px-3 py-1.5 outline-none focus:border-primary ${hasBaseDeparture ? 'border-primary/40 text-primary font-bold' : 'border-border-light'}`} />
                  </div>
                </motion.div>
              );
            })()}

            {/* Team Staff Picker (replaces driver picker + per-job assignment) */}
            {(() => {
              const parts = state.selectedDate.split('-').map(Number);
              const dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
              const todayAvail: StaffMember[] = [];
              const busyOnOtherTeam: { staff: StaffMember; teamName: string }[] = [];
              const unavailableToday: StaffMember[] = [];
              const sharedStaffLabels = new Map<string, string>();

              for (const s of allStaff || []) {
                const availDays = s.available_days;
                const isAvailableToday = !availDays || availDays.length === 0 || availDays.includes(dayOfWeek);
                if (!isAvailableToday) {
                  unavailableToday.push(s);
                  continue;
                }
                // Check whether this staff member is on another team and if so, do their hours overlap?
                const conflict = getStaffConflict(s.id, state.teams, activeTeam.id);
                if (conflict && conflict.overlapping && !(activeTeam.staffIds || []).includes(s.id)) {
                  // True time conflict → grey out
                  busyOnOtherTeam.push({ staff: s, teamName: conflict.teamName });
                } else {
                  // Available (possibly shared across non-overlapping teams)
                  todayAvail.push(s);
                  if (conflict && !conflict.overlapping) {
                    // Show a contextual label so the user knows this person is already on another team
                    const label = getOtherTeamEndLabel(s.id, state.teams, activeTeam.id);
                    if (label) sharedStaffLabels.set(s.id, label);
                  }
                }
              }
              return (
                <TeamStaffPickerCard
                  activeTeam={activeTeam}
                  availableStaff={todayAvail}
                  busyStaff={busyOnOtherTeam}
                  unavailableToday={unavailableToday}
                  sharedStaffLabels={sharedStaffLabels}
                  dispatch={dispatch}
                />
              );
            })()}

            {/* Team Settings (collapsible) */}
            <TeamSettingsCard activeTeam={activeTeam} dispatch={dispatch} dbLoaded={dbLoaded} supabase={supabase} />


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
                      savedClients={savedClients} orgId={orgId}
                      onOpenChecklist={setActiveChecklistClient} hideFinancials={hideFinancials} />
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
                  summary={summary!}
                  dispatch={dispatch}
                  staffNames={jobStaffRates.map(s => s.name)}
                  staffRates={jobStaffRates}
                  hideFinancials={hideFinancials}
                  date={state.selectedDate}
                  driverName={activeTeam.driverStaffId && allStaff ? allStaff.find(s => s.id === activeTeam.driverStaffId)?.name : undefined}
                  templateCode={templateCode}
                />
              </div>
            )}

            {/* Spacer for floating save button */}
            {!disableAutoSave && <div className="h-16" />}

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

          {/* ── Floating Save Button ── */}
          {!disableAutoSave && (
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-none">
              <button
                onClick={() => saveNow()}
                disabled={saveStatus === 'saving' || (!hasUnsavedChanges && saveStatus !== 'error')}
                className={`pointer-events-auto w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-lg ${
                  saveStatus === 'error'
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : saveStatus === 'saving'
                      ? 'bg-gray-100 text-text-tertiary cursor-wait'
                      : saveStatus === 'saved' && !hasUnsavedChanges
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : hasUnsavedChanges
                          ? 'bg-primary text-white hover:bg-primary-hover'
                          : 'bg-surface-elevated text-text-tertiary border border-border-light'
                }`}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    Saving…
                  </>
                ) : saveStatus === 'error' ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Save Failed — Tap to Retry
                  </>
                ) : saveStatus === 'saved' && !hasUnsavedChanges ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    Saved
                  </>
                ) : hasUnsavedChanges ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    Save
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    All Changes Saved
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Map Panel or Checklist Panel */}
        <div className={`${mobileShowMap || activeChecklistClient ? 'flex' : 'hidden md:flex'} flex-1 relative`}>
          <AnimatePresence mode="wait">
            {activeChecklistClient ? (
              <motion.div key="checklist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 pb-20 md:pb-0 p-2 overflow-hidden">
                {/* Click-away handled by document listener on checklistPanelRef */}
                <div ref={checklistPanelRef} className="relative h-full" onClick={(e) => e.stopPropagation()}>
                  <Suspense fallback={<div className="h-full flex items-center justify-center"><div className="shimmer w-full h-full rounded-2xl" /></div>}>
                    <ClientChecklistPanel
                      client={activeChecklistClient}
                      orgId={orgId || ''}
                      isAdmin={isAdmin}
                      scheduleJobId={activeChecklistClient.id}
                      onClose={() => { setActiveChecklistClient(null); setMobileShowMap(false); }}
                    />
                  </Suspense>
                </div>
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

