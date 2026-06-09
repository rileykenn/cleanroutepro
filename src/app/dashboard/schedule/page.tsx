'use client';

import { useReducer, useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AnimatePresence, motion } from 'framer-motion';

import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';

import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { calculateScheduleTimes } from '@/lib/routeEngine';
import { getTodayISO, getWeekDates, getWeekLabel, addDays, generateId } from '@/lib/timeUtils';
import { TravelSegment, Client, TeamSchedule, TEAM_COLORS, DaySchedule, StaffMember, getNextColorIndex, Location as AppLocation } from '@/lib/types';
import { computeDayWarnings } from '@/lib/scheduleWarnings';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { SavedClient } from '@/lib/hooks/useClients';

import TeamTabs from '@/components/TeamTabs';
import WeekView from '@/components/WeekView';
import WeekClientSidebar from '@/components/WeekClientSidebar';
import MonthOverlay from '@/components/MonthOverlay';
import SaveTemplateModal from '@/components/SaveTemplateModal';
import LoadTemplateModal from '@/components/LoadTemplateModal';
import DayEditor from '@/components/DayEditor';
import ConfirmModal from '@/components/ConfirmModal';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

/** Called by DayEditor after every autosave — kept as a no-op export so DayEditor import doesn't break. */
export function invalidateScheduleCache() {}

// ─── Delete drop zone ─────────────────────────────────────────────────────────
function DeleteZone() {
  const { isOver, setNodeRef } = useDroppable({ id: 'delete-zone' });
  return (
    <motion.div
      ref={setNodeRef}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className={`fixed bottom-20 lg:bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-8 py-4 rounded-2xl border-2 transition-colors duration-100 pointer-events-none ${
        isOver
          ? 'bg-red-500 border-red-400 shadow-[0_0_40px_rgba(239,68,68,0.5)]'
          : 'bg-white/95 border-red-300 backdrop-blur-xl shadow-xl'
      }`}
    >
      <svg
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke={isOver ? 'white' : '#ef4444'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4h6v2" />
      </svg>
      <span className={`text-sm font-bold ${isOver ? 'text-white' : 'text-red-500'}`}>
        {isOver ? 'Release to delete' : 'Drop here to remove'}
      </span>
    </motion.div>
  );
}

export default function SchedulePage() {
  const [state, dispatch] = useReducer(scheduleReducer, null, createInitialState);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [showMonth, setShowMonth] = useState(false);
  const [showClearWeek, setShowClearWeek] = useState(false);
  const [activeDragClient, setActiveDragClient] = useState<SavedClient | null>(null);
  const [activeDragJob, setActiveDragJob] = useState<Client | null>(null);
  const [loadedTemplateName, setLoadedTemplateName] = useState<{ name: string; weekStart: string } | null>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('crp_loaded_template') : null;
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  // Persist template badge across refreshes
  useEffect(() => {
    try {
      if (loadedTemplateName) localStorage.setItem('crp_loaded_template', JSON.stringify(loadedTemplateName));
      else localStorage.removeItem('crp_loaded_template');
    } catch { /* ignore */ }
  }, [loadedTemplateName]);
  const [templateToast, setTemplateToast] = useState<string | null>(null);

  const [weekSchedules, setWeekSchedules] = useState<Map<string, Map<string, DaySchedule>>>(new Map());
  const [publishedDates, setPublishedDates] = useState<Set<string>>(new Set());
  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const [teamStaffMap, setTeamStaffMap] = useState<Map<string, { id: string; name: string; hourly_rate: number }[]>>(new Map());
  const selectedDateRef = useRef(state.selectedDate);
  selectedDateRef.current = state.selectedDate;

  const activeTeamIdRef = useRef(state.activeTeamId);
  activeTeamIdRef.current = state.activeTeamId;
  const viewModeRef = useRef(state.viewMode);
  viewModeRef.current = state.viewMode;
  const stateRef = useRef(state);
  stateRef.current = state;
  const [pendingDeleteTeam, setPendingDeleteTeam] = useState<{ id: string; name: string; weekJobCount: number } | null>(null);
  const allOrgTeamsRef = useRef<TeamSchedule[]>([]);
  // Teams active for the CURRENT WEEK only (those with a schedules row this week).
  // loadDayForEdit uses this so day view shows the same teams as week view.
  const weekTeamsRef = useRef<TeamSchedule[]>([]);
  // Tracks which week start is currently cached in allOrgTeamsRef so we only
  // clear it when actually navigating to a different week.
  const cachedWeekStartRef = useRef<string>('');
  // Increments after every loadDayForEdit/loadDayFromCache so DayEditor re-records
  // its autosave baseline and doesn't mistake the load for a user edit.
  const [dayLoadGen, setDayLoadGen] = useState(0);
  const daySaveRef = useRef<(() => Promise<void>) | null>(null);
  // Set to true just before an explicit flush so DayEditor's unmount cleanup
  // doesn't double-save and race with the following loadWeekSchedules read.
  const skipUnmountSaveRef = useRef<boolean>(false);
  // Guards against stale loadDayForEdit responses when the user rapidly cycles days.
  // Each call increments this; if the value changed by the time the DB responds, discard.
  const dayLoadRequestRef = useRef(0);

  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id || null;
  const isStaff = profile?.role === 'staff';

  const weekDates = useMemo(() => getWeekDates(state.focusedDate), [state.focusedDate]);
  const weekLabel = useMemo(() => getWeekLabel(weekDates[0], weekDates[6]), [weekDates]);

  // ─── Drag and Drop sensors ───
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // ─── Drag and Drop Handler ───
  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === 'job') {
      setActiveDragJob(data.job as Client);
    } else {
      setActiveDragClient(data?.client || null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const dragType = active.data.current?.type;

    // ─── Job card drag (move between days or delete) ───────────────────────
    if (dragType === 'job') {
      setActiveDragJob(null);
      if (!orgId) return;

      const jobData = active.data.current?.job as Client;
      const fromDate = active.data.current?.date as string;

      // ── Delete zone ──
      if (over?.id === 'delete-zone') {
        setWeekSchedules(prev => {
          const next = new Map(prev);
          const teamMap = next.get(state.activeTeamId);
          if (!teamMap) return next;
          const nextTeamMap = new Map(teamMap);
          const day = nextTeamMap.get(fromDate);
          if (day) nextTeamMap.set(fromDate, { ...day, clients: day.clients.filter(c => c.id !== jobData.id) });
          next.set(state.activeTeamId, nextTeamMap);
          return next;
        });
        await supabase.from('schedule_jobs').delete().eq('id', jobData.id);
        return;
      }

      // ── Move to a different day ──
      if (!over) return;
      const targetDate = over.id as string;
      if (targetDate === fromDate) return; // same day — no-op
      if (state.activeTeamId === 'all') return;

      // Ensure schedule row exists for target date
      let { data: targetSched } = await supabase
        .from('schedules').select('id')
        .eq('team_id', state.activeTeamId).eq('schedule_date', targetDate)
        .maybeSingle();

      if (!targetSched) {
        const { data: newSched } = await supabase
          .from('schedules')
          .insert({ org_id: orgId, team_id: state.activeTeamId, schedule_date: targetDate })
          .select('id').single();
        targetSched = newSched;
      }
      if (!targetSched) return;

      const { count } = await supabase
        .from('schedule_jobs').select('id', { count: 'exact', head: true })
        .eq('schedule_id', targetSched.id).eq('is_break', false);

      // Optimistic move
      setWeekSchedules(prev => {
        const next = new Map(prev);
        const teamMap = next.get(state.activeTeamId) || new Map<string, DaySchedule>();
        const nextTeamMap = new Map(teamMap);

        // Remove from source day
        const srcDay = nextTeamMap.get(fromDate);
        if (srcDay) nextTeamMap.set(fromDate, { ...srcDay, clients: srcDay.clients.filter(c => c.id !== jobData.id) });

        // Add to target day
        const tgtDay = nextTeamMap.get(targetDate) || {
          date: targetDate,
          dayOfWeek: new Date(targetDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
          scheduleId: targetSched!.id,
          clients: [],
          breaks: [],
          isPublished: false,
        };
        const movedJob = { ...jobData, startTime: undefined, endTime: undefined };
        nextTeamMap.set(targetDate, { ...tgtDay, clients: [...tgtDay.clients, movedJob] });

        next.set(state.activeTeamId, nextTeamMap);
        return next;
      });

      await supabase.from('schedule_jobs').update({
        schedule_id: targetSched.id,
        position: count || 0,
        start_time: null,
        end_time: null,
      }).eq('id', jobData.id);

      return;
    }

    // ─── Client roster drag (from sidebar) ────────────────────────────────
    setActiveDragClient(null);
    if (!over || !orgId) return;
    
    // Cannot drop clients in "All Teams" view (need a specific team)
    if (state.activeTeamId === 'all') return;

    const targetDate = over.id as string;
    const clientData = active.data.current?.client as SavedClient;
    if (!clientData || !targetDate) return;

    // 1. Ensure schedule row exists for this team/date
    let { data: scheduleRow } = await supabase
      .from('schedules')
      .select('id')
      .eq('team_id', state.activeTeamId)
      .eq('schedule_date', targetDate)
      .maybeSingle();

    if (!scheduleRow) {
      const { data: newRow } = await supabase
        .from('schedules')
        .insert({ org_id: orgId, team_id: state.activeTeamId, schedule_date: targetDate })
        .select('id')
        .single();
      scheduleRow = newRow;
    }

    if (!scheduleRow) return;

    // 2. Get current job count for position
    const { count } = await supabase
      .from('schedule_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_id', scheduleRow.id);

    const position = count || 0;
    
    const newJob = {
      id: crypto.randomUUID(),
      org_id: orgId,
      schedule_id: scheduleRow.id,
      client_id: clientData.id,
      name: clientData.name,
      address: clientData.address || '',
      lat: clientData.lat ?? 0,
      lng: clientData.lng ?? 0,
      place_id: clientData.place_id || null,
      duration_minutes: clientData.default_duration_minutes,
      staff_count: clientData.default_staff_count,
      is_locked: false,
      is_break: false,
      position: position,
      notes: '',
      fixed_start_time: null,
      assigned_staff_ids: [],
    };

    // Optimistic UI update — show immediately before the DB round-trip
    setWeekSchedules((prev) => {
      const next = new Map(prev);
      const teamMap = next.get(state.activeTeamId) || new Map<string, DaySchedule>();
      const nextTeamMap = new Map(teamMap);
      const day = nextTeamMap.get(targetDate) || {
        date: targetDate,
        dayOfWeek: new Date(targetDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
        scheduleId: scheduleRow!.id,
        clients: [],
        breaks: [],
        isPublished: false,
      };
      // Build a properly shaped Client object for the optimistic UI so the
      // DayEditor doesn't crash on client.location.address before the DB reloads.
      const optimisticClient: Client = {
        id: newJob.id,
        name: clientData.name,
        location: {
          address: clientData.address || '',
          lat: clientData.lat ?? 0,
          lng: clientData.lng ?? 0,
          placeId: clientData.place_id || undefined,
        },
        jobDurationMinutes: clientData.default_duration_minutes ?? 60,
        staffCount: clientData.default_staff_count ?? 1,
        isLocked: false,
        notes: '',
        savedClientId: clientData.id,
        clientColor: clientData.color || undefined,
        assignedStaffIds: [],
        checklistId: undefined,
      };
      nextTeamMap.set(targetDate, { ...day, clients: [...day.clients, optimisticClient] });
      next.set(state.activeTeamId, nextTeamMap);
      return next;
    });

    // Persist to DB — await so we can catch failures and reload to correct state
    const { error: insertError } = await supabase.from('schedule_jobs').insert(newJob);
    if (insertError) {
      console.error('Failed to save dropped client:', insertError);
      // Roll back the optimistic update by reloading from DB
      loadWeekSchedules(weekDates);
    }
  };

  // Cache removed — always load fresh from DB on mount to avoid stale-state conflicts with autosave.

  // ─── Load teams, applying any per-week overrides ───
  // weekStart: Monday ISO date of the week being loaded (e.g. '2026-06-09').
  // When provided, fetches weekly_team_configs for that week and overlays
  // name/color so each week can have independent team identities.
  const loadTeams = useCallback(async (weekStart?: string) => {
    if (!orgId) return null;
    const { data: dbTeams } = await supabase
      .from('teams').select('*').eq('org_id', orgId).order('sort_order');
    if (!dbTeams || dbTeams.length === 0) return null;
    const teams = dbTeams.map((row: Record<string, unknown>): TeamSchedule => ({
      id: row.id as string,
      name: row.name as string,
      color: TEAM_COLORS[(row.color_index as number) % TEAM_COLORS.length],
      colorIndex: (row.color_index as number) % TEAM_COLORS.length,
      baseAddress: row.base_address ? {
        address: row.base_address as string,
        lat: (row.base_lat as number) || 0,
        lng: (row.base_lng as number) || 0,
        placeId: (row.base_place_id as string) || undefined,
      } : null,
      returnAddress: row.return_disabled
        ? 'none'
        : row.return_address
          ? { address: row.return_address as string, lat: (row.return_lat as number) || 0, lng: (row.return_lng as number) || 0, placeId: (row.return_place_id as string) || undefined }
          : null,
      clients: [],
      travelSegments: new Map<string, TravelSegment>(),
      dayStartTime: (row.day_start_time as string) || '08:00',
      breaks: [],
      hourlyRate: Number(row.hourly_rate) || 38,
      calculateFuel: Boolean(row.calculate_fuel),
      fuelEfficiency: row.fuel_efficiency != null ? Number(row.fuel_efficiency) : 10,
      fuelPrice: row.fuel_price != null ? Number(row.fuel_price) : 1.85,
      perKmRate: row.per_km_rate != null ? Number(row.per_km_rate) : 0,
      staffIds: [],
      driverStaffId: null,
    }));

    // ── Apply per-week name/color overrides ──
    // These take priority over the global teams defaults so each week
    // can have its own team labels and colours.
    if (weekStart) {
      const { data: weekConfigs } = await supabase
        .from('weekly_team_configs')
        .select('team_id, name, color_index')
        .eq('org_id', orgId)
        .eq('week_start', weekStart);
      if (weekConfigs && weekConfigs.length > 0) {
        const cfgMap = new Map<string, Record<string, unknown>>(weekConfigs.map((c: Record<string, unknown>) => [c.team_id as string, c]));
        for (const team of teams) {
          const cfg = cfgMap.get(team.id);
          if (cfg) {
            if (cfg.name != null) team.name = cfg.name as string;
            if (cfg.color_index != null) {
              const idx = (cfg.color_index as number) % TEAM_COLORS.length;
              team.colorIndex = idx;
              team.color = TEAM_COLORS[idx];
            }
          }
        }
      }
    }

    // ── Overlay in-memory name/color to guard against async race conditions ──
    // allOrgTeamsRef is updated synchronously on every user change so it is
    // authoritative for the current session between page reloads.
    if (allOrgTeamsRef.current.length > 0) {
      const memMap = new Map(allOrgTeamsRef.current.map(t => [t.id, t]));
      for (const team of teams) {
        const mem = memMap.get(team.id);
        if (mem) {
          team.name = mem.name;
          team.color = mem.color;
          team.colorIndex = mem.colorIndex;
        }
      }
    }

    return teams;
  }, [orgId, supabase]);


  // ─── Load week schedules for overview ───
  // skipDispatch=true: update cache/refs but don't re-render teams in state.
  // Used by handleBackToWeek's background sync to avoid a second LOAD_STATE
  // dispatch after the UI has already been updated from the local cache patch.
  const loadWeekSchedules = useCallback(async (dates: string[], { skipDispatch = false }: { skipDispatch?: boolean } = {}) => {
    if (!orgId) return;
    try {
      // Only clear the in-memory ref when actually moving to a different week.
      // Clearing it on every call (even same-week reloads) destroys the race-
      // condition protection that keeps user changes visible between DB reads.
      if (cachedWeekStartRef.current !== dates[0]) {
        allOrgTeamsRef.current = [];
        cachedWeekStartRef.current = dates[0];
      }
      const teamsList = await loadTeams(dates[0]);

      // No teams found — create a default one and finish
      if (!teamsList || teamsList.length === 0) {
        const { data: newTeam } = await supabase.from('teams').insert({ org_id: orgId, name: 'Team 1', color_index: 0, sort_order: 0 }).select().single();
        if (newTeam) {
          const defaultTeam: TeamSchedule = {
            id: newTeam.id, name: newTeam.name, color: TEAM_COLORS[0], colorIndex: 0,
            baseAddress: null, returnAddress: null, clients: [], travelSegments: new Map(), dayStartTime: '08:00',
            breaks: [], hourlyRate: 38, calculateFuel: false, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
            staffIds: [], driverStaffId: null,
          };
          if (!skipDispatch) dispatch({ type: 'LOAD_STATE', teams: [defaultTeam], activeTeamId: defaultTeam.id, selectedDate: state.selectedDate });
        }
        setDbLoaded(true);
        return;
      }

      const allTeamMaps = new Map<string, Map<string, DaySchedule>>();

      // Load all client colors + rates for this org
      const { data: clientMetaRows } = await supabase.from('clients').select('id, color, rate').eq('org_id', orgId);
      const clientColorMap = new Map<string, string>();
      const clientRateMap = new Map<string, number>();
      if (clientMetaRows) {
        for (const row of clientMetaRows) {
          if (row.color) clientColorMap.set(row.id, row.color);
          if (row.rate != null) clientRateMap.set(row.id, Number(row.rate));
        }
      }
      const newPublished = new Set<string>();

      // ── Bulk fetch: all schedules for all teams this week in ONE query ──
      const teamIds = teamsList.map((t: TeamSchedule) => t.id);
      const { data: allScheduleRows } = await supabase
        .from('schedules')
        .select('id, team_id, schedule_date, is_published, template_code, base_address, base_lat, base_lng, base_place_id, return_address, return_lat, return_lng, return_place_id, has_start_base, has_return_base, driver_staff_id, staff_ids')
        .in('team_id', teamIds)
        .in('schedule_date', dates);

      // Index schedules by team_id → date for O(1) lookup
      const scheduleIndex = new Map<string, typeof allScheduleRows[0]>();
      for (const row of allScheduleRows || []) {
        scheduleIndex.set(`${row.team_id}::${row.schedule_date}`, row);
      }

      // ── Bulk fetch: all jobs for all those schedules in ONE query ──
      const allScheduleIds = (allScheduleRows || []).map((s: { id: string }) => s.id);
      let jobIndex = new Map<string, typeof allScheduleRows>();
      if (allScheduleIds.length > 0) {
        const { data: allJobRows } = await supabase
          .from('schedule_jobs')
          .select('*')
          .in('schedule_id', allScheduleIds)
          .order('position');
        // Index jobs by schedule_id
        for (const job of allJobRows || []) {
          const list = jobIndex.get(job.schedule_id) || [];
          list.push(job);
          jobIndex.set(job.schedule_id, list);
        }
      }

      // ── Assemble results in JS — no more DB round trips ──
      for (const team of teamsList) {
        const teamMap = new Map<string, DaySchedule>();

        for (const date of dates) {
          const dayClients: Client[] = [];
          const dayBreaks: import('@/lib/types').ScheduleBreak[] = [];

          const schedule = scheduleIndex.get(`${team.id}::${date}`);
          let schedId: string | null = schedule?.id ?? null;
          let templateCode: string | undefined = schedule?.template_code ?? undefined;
          let isPublished = schedule?.is_published ?? false;
          let hasStartBase = schedule?.has_start_base !== false;
          let hasReturnBase = schedule?.has_return_base !== false;
          let dayDriverStaffId: string | null = (schedule?.driver_staff_id as string) || null;
          let dayStaffIds: string[] = (schedule?.staff_ids as string[]) || [];

          // Per-day base address (from schedule row, or fallback to team default)
          let dayBaseAddress: AppLocation | null = team.baseAddress;
          let dayReturnAddress: AppLocation | null | 'none' = team.returnAddress;

          if (schedule) {
            if (schedule.base_address) {
              dayBaseAddress = {
                address: String(schedule.base_address), lat: Number(schedule.base_lat) || 0,
                lng: Number(schedule.base_lng) || 0, placeId: schedule.base_place_id ? String(schedule.base_place_id) : undefined,
              } as AppLocation;
            }
            if (!hasStartBase) dayBaseAddress = null;

            if (!hasReturnBase) {
              dayReturnAddress = 'none';
            } else if (schedule.return_address) {
              dayReturnAddress = {
                address: String(schedule.return_address), lat: Number(schedule.return_lat) || 0,
                lng: Number(schedule.return_lng) || 0, placeId: schedule.return_place_id ? String(schedule.return_place_id) : undefined,
              } as AppLocation;
            }

            const jobs = jobIndex.get(schedule.id) || [];
            const breakRows: typeof jobs = [];
            for (const j of jobs) {
              if (j.is_break) { breakRows.push(j); continue; }
              const assignedIds = (j.assigned_staff_ids as string[]) || [];
              dayClients.push({
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
                fixedStartTime: (j.fixed_start_time as string) || undefined,
                startTime: (j.start_time as string) || undefined,
                endTime: (j.end_time as string) || undefined,
                notes: (j.notes as string) || undefined,
                savedClientId: (j.client_id as string) || undefined,
                assignedStaffIds: assignedIds,
                clientColor: j.client_id ? clientColorMap.get(j.client_id as string) || undefined : undefined,
                rate: j.client_id ? clientRateMap.get(j.client_id as string) ?? undefined : undefined,
                checklistId: (j.checklist_id as string) || undefined,
              });
            }
            for (const j of breakRows) {
              try {
                const meta = JSON.parse((j.notes as string) || '{}');
                const clientIds = new Set(dayClients.map(c => c.id));
                if (!meta.afterClientId || !clientIds.has(meta.afterClientId)) continue;
                dayBreaks.push({
                  id: meta.breakId || (j.id as string),
                  afterClientId: meta.afterClientId,
                  durationMinutes: Number(j.duration_minutes) || 30,
                  label: meta.label || (j.name as string) || 'Break',
                });
              } catch { /* skip malformed break row */ }
            }
          }

          if (isPublished) newPublished.add(date);

          teamMap.set(date, {
            date,
            dayOfWeek: new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
            scheduleId: schedId,
            clients: dayClients,
            breaks: dayBreaks,
            templateCode,
            isPublished,
            baseAddress: dayBaseAddress,
            returnAddress: dayReturnAddress,
            hasStartBase,
            hasReturnBase,
            driverStaffId: dayDriverStaffId,
            staffIds: dayStaffIds,
          });
        }

        allTeamMaps.set(team.id, teamMap);
      }

      // ── Compute start/end times for every team/day that has clients ──────────
      // calculateScheduleTimes is pure JS (no Maps API). It uses job durations
      // and dayStartTime, treating travel time as 0 (approximation until day view
      // calculates real drive times). This makes times appear immediately in week
      // view after a template load or drag-drop without needing to open each day.
      const timeUpdateRows: { id: string; start_time: string; end_time: string }[] = [];

      for (const team of teamsList) {
        const teamMap = allTeamMaps.get(team.id);
        if (!teamMap) continue;

        for (const [date, dayData] of teamMap) {
          if (dayData.clients.length === 0) continue;

          // Only recalculate if any client is missing a startTime
          const needsCalc = dayData.clients.some(c => !c.startTime);
          if (!needsCalc) continue;

          // Build a minimal TeamSchedule for the calculation
          const teamForCalc: TeamSchedule = {
            ...team,
            clients: dayData.clients,
            breaks: dayData.breaks,
            travelSegments: new Map(), // no travel data yet → times stack sequentially
            dayStartTime: team.dayStartTime,
            baseAddress: dayData.baseAddress !== undefined ? dayData.baseAddress : team.baseAddress,
            staffIds: dayData.staffIds || [],
          };

          const { clients: timedClients } = calculateScheduleTimes(teamForCalc);

          // Patch the allTeamMaps cache with calculated times
          teamMap.set(date, { ...dayData, clients: timedClients });

          // Collect rows for background DB update
          for (const c of timedClients) {
            if (c.startTime && c.endTime) {
              timeUpdateRows.push({ id: c.id, start_time: c.startTime, end_time: c.endTime });
            }
          }
        }

        allTeamMaps.set(team.id, teamMap);
      }

      // Fire-and-forget: persist calculated times to DB so they survive a reload
      if (timeUpdateRows.length > 0) {
        (async () => {
          for (const row of timeUpdateRows) {
            supabase.from('schedule_jobs')
              .update({ start_time: row.start_time, end_time: row.end_time })
              .eq('id', row.id)
              .then(() => {});
          }
        })();
      }

      setWeekSchedules(allTeamMaps);
      setPublishedDates(newPublished);

      // Store ALL org teams — used by addTeam, template save, template load, etc.
      allOrgTeamsRef.current = teamsList;

      // ── Only show teams that have at least one schedule row this week ──
      const teamsThisWeek = teamsList.filter((team: TeamSchedule) => {
        const teamMap = allTeamMaps.get(team.id);
        if (!teamMap) return false;
        for (const [, day] of teamMap) {
          if (day.scheduleId !== null) return true;
        }
        return false;
      });
      weekTeamsRef.current = teamsThisWeek;

      // skipDispatch=true: cache and refs are updated above; skip the LOAD_STATE
      // dispatch to avoid a second render when the UI is already showing correct data.
      if (!skipDispatch && viewModeRef.current !== 'day') {
        const today = selectedDateRef.current;
        const teamsWithClients = teamsThisWeek.map((team: TeamSchedule) => {
          const teamMap = allTeamMaps.get(team.id);
          const dayData = teamMap?.get(today);
          return {
            ...team,
            clients: dayData?.clients || [],
            breaks: dayData?.breaks || [],
            driverStaffId: dayData?.driverStaffId || null,
            staffIds: dayData?.staffIds || [],
            baseAddress: dayData?.baseAddress !== undefined ? dayData.baseAddress : team.baseAddress,
            returnAddress: dayData?.returnAddress !== undefined ? dayData.returnAddress : team.returnAddress,
          };
        });

        if (teamsWithClients.length === 0) {
          dispatch({ type: 'LOAD_STATE', teams: [], activeTeamId: '', selectedDate: today });
        } else {
          dispatch({
            type: 'LOAD_STATE',
            teams: teamsWithClients,
            activeTeamId: teamsWithClients.find((t: TeamSchedule) => t.id === activeTeamIdRef.current)?.id || teamsWithClients[0].id,
            selectedDate: today,
          });
        }
      }
      setDbLoaded(true);
    } catch (err) {
      console.error('[Schedule] Failed to load week schedules:', err);
      setDbLoaded(true);
    }
  }, [orgId, supabase, loadTeams]);

  const loadStaffMembers = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from('staff_members').select('id, name, role, hourly_rate, available_days').eq('org_id', orgId).order('name');
    if (data) {
      setAllStaff(data as StaffMember[]);
      // (cache removed)
    }
  }, [orgId, supabase]);

  // Derive teamStaffMap from team-level staffIds (for TeamTabs badges)
  const deriveTeamStaffMap = useCallback(() => {
    const map = new Map<string, { id: string; name: string; hourly_rate: number }[]>();
    const staffLookup = new Map(allStaff.map(s => [s.id, { name: s.name, hourly_rate: s.hourly_rate }]));
    for (const team of state.teams) {
      const list: { id: string; name: string; hourly_rate: number }[] = [];
      for (const staffId of team.staffIds || []) {
        const s = staffLookup.get(staffId);
        if (s) list.push({ id: staffId, name: s.name, hourly_rate: s.hourly_rate });
      }
      map.set(team.id, list);
    }
    setTeamStaffMap(map);
  }, [state.teams, allStaff]);


  // Initial load
  useEffect(() => {
    if (orgId && !dbLoaded) { loadWeekSchedules(weekDates); loadStaffMembers(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Reload on week change
  useEffect(() => {
    if (orgId && dbLoaded) loadWeekSchedules(weekDates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDates[0]]);

  // Persist view context to localStorage so navigating away and back restores the same day/view
  useEffect(() => {
    try {
      localStorage.setItem('crp_schedule_view', JSON.stringify({
        viewMode: state.viewMode,
        focusedDate: state.focusedDate,
        activeTeamId: state.activeTeamId,
      }));
    } catch { /* ignore */ }
  }, [state.viewMode, state.focusedDate, state.activeTeamId]);

  // If the page mounts restored to day view (from localStorage), trigger a fresh DB load
  // for that day once the initial week load completes. Patch activeTeamIdRef before the call
  // so loadDayForEdit selects the right team (it already uses activeTeamIdRef.current).
  const didRestoreDayView = useRef(false);
  useEffect(() => {
    if (dbLoaded && state.viewMode === 'day' && !didRestoreDayView.current) {
      didRestoreDayView.current = true;
      try {
        const saved = localStorage.getItem('crp_schedule_view');
        if (saved) {
          const { activeTeamId } = JSON.parse(saved) as { activeTeamId?: string };
          if (activeTeamId) activeTeamIdRef.current = activeTeamId;
        }
      } catch { /* ignore */ }
      loadDayForEdit(state.focusedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbLoaded]);

  // Derive team badges when teams or staff change
  useEffect(() => {
    if (dbLoaded && allStaff.length > 0) deriveTeamStaffMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.teams, allStaff]);

  // ─── Load specific day into reducer for Day View (bulk queries) ───
  const loadDayForEdit = useCallback(async (date: string) => {
    if (!orgId) return;
    // Capture a unique token for this request. If a newer call starts before this
    // one resolves, the check at the bottom will discard the stale response.
    const requestToken = ++dayLoadRequestRef.current;
    // Use week-active teams (same set shown in week view) so day view always shows
    // exactly the same teams. Fallback to allOrgTeamsRef only on first load before
    // loadWeekSchedules has populated weekTeamsRef.
    const allTeams = weekTeamsRef.current.length > 0
      ? weekTeamsRef.current
      : allOrgTeamsRef.current.length > 0
        ? allOrgTeamsRef.current
        : (await loadTeams(weekDates[0]) || []);
    if (allTeams.length === 0) return;

    const teamIds = allTeams.map((t: TeamSchedule) => t.id);

    // ── 1 bulk query: all schedules for these teams on this date ──
    const { data: schedules } = await supabase
      .from('schedules')
      .select('id, team_id, base_address, base_lat, base_lng, base_place_id, return_address, return_lat, return_lng, return_place_id, has_start_base, has_return_base, driver_staff_id, staff_ids')
      .eq('schedule_date', date)
      .in('team_id', teamIds);

    const scheduleByTeam = new Map<string, Record<string, unknown>>();
    const scheduleIds: string[] = [];
    if (schedules) {
      for (const s of schedules) {
        scheduleByTeam.set(s.team_id as string, s as Record<string, unknown>);
        scheduleIds.push(s.id as string);
      }
    }

    // ── 1 bulk query: all jobs for those schedules ──
    const jobsBySchedule = new Map<string, Record<string, unknown>[]>();
    if (scheduleIds.length > 0) {
      const { data: jobs } = await supabase
        .from('schedule_jobs').select('*')
        .in('schedule_id', scheduleIds)
        .order('position');
      if (jobs) {
        for (const j of jobs as Record<string, unknown>[]) {
          const sid = j.schedule_id as string;
          const list = jobsBySchedule.get(sid) || [];
          list.push(j);
          jobsBySchedule.set(sid, list);
        }
      }
    }

    // ── 1 bulk query: client rates ──
    const clientRateMap = new Map<string, number>();
    const { data: rateRows } = await supabase.from('clients').select('id, rate').eq('org_id', orgId).not('rate', 'is', null);
    if (rateRows) {
      for (const r of rateRows) clientRateMap.set(r.id, Number(r.rate));
    }

    // ── Build teams from bulk results ──
    const teamsList: TeamSchedule[] = [];
    const teamsWithSchedule = new Set<string>();

    for (const t of allTeams) {
      const team = {
        ...t,
        clients: [] as Client[],
        travelSegments: new Map<string, TravelSegment>(),
        breaks: [] as typeof t.breaks,
      };

      const schedule = scheduleByTeam.get(team.id);
      if (schedule) {
        teamsWithSchedule.add(team.id);
        const hasStartBase = schedule.has_start_base !== false;
        const hasReturnBase = schedule.has_return_base !== false;

        if (schedule.base_address) {
          team.baseAddress = {
            address: String(schedule.base_address), lat: Number(schedule.base_lat) || 0,
            lng: Number(schedule.base_lng) || 0, placeId: schedule.base_place_id ? String(schedule.base_place_id) : undefined,
          };
        }
        if (!hasStartBase) team.baseAddress = null;

        if (!hasReturnBase) {
          team.returnAddress = 'none';
        } else if (schedule.return_address) {
          team.returnAddress = {
            address: String(schedule.return_address), lat: Number(schedule.return_lat) || 0,
            lng: Number(schedule.return_lng) || 0, placeId: schedule.return_place_id ? String(schedule.return_place_id) : undefined,
          };
        }
        // Restore driver and team staff roster for this day
        team.driverStaffId = (schedule.driver_staff_id as string) || null;
        team.staffIds = (schedule.staff_ids as string[]) || [];

        const jobs = jobsBySchedule.get(schedule.id as string) || [];
        team.clients = jobs
          .filter((j) => !j.is_break)
          .map((j): Client => {
            const assignedIds = (j.assigned_staff_ids as string[]) || [];
            return {
              id: j.id as string, name: (j.name as string) || '',
              location: { address: (j.address as string) || '', lat: (j.lat as number) || 0, lng: (j.lng as number) || 0, placeId: (j.place_id as string) || undefined },
              jobDurationMinutes: Number(j.duration_minutes) || 90,
              staffCount: (j.staff_count as number) || 1,
              isLocked: (j.is_locked as boolean) || false,
              fixedStartTime: (j.fixed_start_time as string) || undefined,
              startTime: (j.start_time as string) || undefined,
              endTime: (j.end_time as string) || undefined,
              notes: (j.notes as string) || undefined,
              savedClientId: (j.client_id as string) || undefined,
              assignedStaffIds: assignedIds,
              rate: j.client_id ? clientRateMap.get(j.client_id as string) ?? undefined : undefined,
              checklistId: (j.checklist_id as string) || undefined,
            };
          });
        // Reconstruct breaks from is_break=true rows.
        // Prefer afterClientId (stable UUID stored since the save fix) over
        // afterPosition (legacy index-based anchor, kept as fallback).
        const clientIdSet = new Set(team.clients.map((c: Client) => c.id));
        team.breaks = jobs
          .filter((j) => j.is_break)
          .reduce((acc: typeof team.breaks, j) => {
            try {
              const meta = JSON.parse((j.notes as string) || '{}');
              // Resolve by stable ID first, then by position index as fallback.
              let resolvedClientId: string | undefined;
              if (meta.afterClientId && clientIdSet.has(meta.afterClientId)) {
                resolvedClientId = meta.afterClientId;
              } else {
                const afterPos = typeof meta.afterPosition === 'number' ? meta.afterPosition : -1;
                const afterClient = afterPos >= 0 ? team.clients[afterPos] : null;
                if (afterClient) resolvedClientId = afterClient.id;
              }
              // Skip orphaned breaks — client was deleted but break row persists in DB.
              if (!resolvedClientId) return acc;
              acc.push({
                id: meta.breakId || (j.id as string),
                afterClientId: resolvedClientId,
                durationMinutes: Number(j.duration_minutes) || 30,
                label: meta.label || (j.name as string) || 'Break',
              });
            } catch {
              // Skip malformed break rows entirely rather than inserting a bad anchor.
            }
            return acc;
          }, []);
      }
      teamsList.push(team);
    }

    // Guard: if a newer loadDayForEdit was started while we were awaiting the DB,
    // discard this stale response so we don't overwrite the correct state.
    if (requestToken !== dayLoadRequestRef.current) return;

    // Day view always shows ALL org teams (not just those with a schedules row).
    // Teams without a schedule row on this day appear empty — they still exist.
    // The "only show teams with rows" filter belongs in WEEK view only, where it
    // hides teams that were never added to a particular historical week.
    // Filtering here caused phantom team duplication: as autosave created rows
    // while cycling between days, more teams appeared with each navigation.
    dispatch({ type: 'LOAD_STATE', teams: teamsList, activeTeamId: teamsList.find((t: TeamSchedule) => t.id === activeTeamIdRef.current)?.id || teamsList[0].id, selectedDate: date });
    setDayLoadGen(g => g + 1);
  }, [orgId, supabase, loadTeams]);

  // ─── Instant day switch from weekSchedules cache ───
  const loadDayFromCache = useCallback((date: string): boolean => {
    if (weekSchedules.size === 0) return false;
    // Use week-active teams (same as week view) so day view is consistent.
    const allTeams = weekTeamsRef.current.length > 0 ? weekTeamsRef.current : allOrgTeamsRef.current;
    if (allTeams.length === 0) return false;

    // Only use cache for dates within the currently loaded week
    let hasDate = false;
    for (const [, teamMap] of weekSchedules) {
      if (teamMap.has(date)) { hasDate = true; break; }
    }
    if (!hasDate) return false;

    const teamsWithClients = allTeams.map(team => {
      const teamMap = weekSchedules.get(team.id);
      const dayData = teamMap?.get(date);
      return {
        ...team,
        clients: dayData?.clients || [],
        travelSegments: new Map<string, TravelSegment>(),
        breaks: dayData?.breaks || [] as typeof team.breaks,
        baseAddress: dayData?.baseAddress !== undefined ? dayData.baseAddress : team.baseAddress,
        returnAddress: dayData?.returnAddress !== undefined ? dayData.returnAddress : team.returnAddress,
        driverStaffId: dayData?.driverStaffId !== undefined ? dayData.driverStaffId : null,
        staffIds: dayData?.staffIds || [],
      };
    });

    // Show week-active teams in day view — teams with no jobs on this day appear empty.
    dispatch({
      type: 'LOAD_STATE',
      teams: teamsWithClients,
      activeTeamId: teamsWithClients.find(t => t.id === activeTeamIdRef.current)?.id || teamsWithClients[0].id,
      selectedDate: date,
    });
    setDayLoadGen(g => g + 1);

    return true;
  }, [weekSchedules]);

  // ─── Week Navigation ───
  const goToPrevWeek = () => {
    const newDate = addDays(state.focusedDate, -7);
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
  };
  const goToNextWeek = () => {
    const newDate = addDays(state.focusedDate, 7);
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
  };

  // ─── Day Navigation (instant cache → fallback to bulk fetch) ───
  const switchToDay = useCallback(async (newDate: string) => {
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
    // Try instant load from weekSchedules cache
    if (!loadDayFromCache(newDate)) {
      // Cross-week or no cache: immediately clear client lists so the UI doesn't
      // show stale jobs while we await the DB. Use allOrgTeamsRef (not the stale
      // state.teams closure) so team count stays correct.
      const currentTeams = allOrgTeamsRef.current.length > 0
        ? allOrgTeamsRef.current
        : stateRef.current.teams;
      dispatch({
        type: 'LOAD_STATE',
        teams: currentTeams.map(t => ({ ...t, clients: [], travelSegments: new Map<string, TravelSegment>(), breaks: [] as typeof t.breaks })),
        activeTeamId: activeTeamIdRef.current || currentTeams[0]?.id || '',
        selectedDate: newDate,
      });
      await loadDayForEdit(newDate);
    }
  }, [loadDayFromCache, loadDayForEdit]);

  const atWeekStart = state.viewMode === 'day' && state.focusedDate <= weekDates[0];
  const atWeekEnd   = state.viewMode === 'day' && state.focusedDate >= weekDates[6];

  const goToPrevDay = () => {
    if (atWeekStart) return; // already on Monday — don't cross into last week
    const newDate = addDays(state.focusedDate, -1);
    navigateDayInstant(newDate);
  };
  const goToNextDay = () => {
    if (atWeekEnd) return; // already on Sunday — don't cross into next week
    const newDate = addDays(state.focusedDate, 1);
    navigateDayInstant(newDate);
  };

  /**
   * Instantly switch to newDate in day view by:
   * 1. Patching weekSchedules from reducer state (so the cache is up-to-date for this day)
   * 2. Loading newDate from the (freshly patched) cache — no DB wait
   * 3. Saving the current day's changes to DB in the background
   */
  const navigateDayInstant = useCallback((newDate: string) => {
    const editedDate = stateRef.current.selectedDate;

    // ── 1. Patch weekSchedules with the latest state for the day we're leaving ──
    setWeekSchedules(prev => {
      const next = new Map(prev);
      for (const team of stateRef.current.teams) {
        const teamMap = new Map(next.get(team.id) || new Map<string, DaySchedule>());
        const existing = teamMap.get(editedDate);
        teamMap.set(editedDate, {
          date: editedDate,
          dayOfWeek: existing?.dayOfWeek ||
            new Date(editedDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
          scheduleId: existing?.scheduleId || null,
          clients: team.clients,
          breaks: team.breaks,
          templateCode: existing?.templateCode,
          isPublished: existing?.isPublished || false,
          baseAddress: team.baseAddress,
          returnAddress: team.returnAddress,
          driverStaffId: team.driverStaffId || null,
          staffIds: team.staffIds || [],
        });
        next.set(team.id, teamMap);
      }
      return next;
    });

    // ── 2. Switch to the new day immediately — cache load or cross-week fetch ──
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
    // loadDayFromCache reads weekSchedules via its closure, but the setWeekSchedules
    // above is async. We use a ref-patched fallback: build teamsForNewDay inline
    // from the already-correct weekSchedules for newDate (which hasn't changed).
    const hit = loadDayFromCache(newDate);
    if (!hit) {
      // Cross-week navigation — show blank immediately then fetch
      const currentTeams = allOrgTeamsRef.current.length > 0
        ? allOrgTeamsRef.current : stateRef.current.teams;
      dispatch({
        type: 'LOAD_STATE',
        teams: currentTeams.map(t => ({ ...t, clients: [], travelSegments: new Map<string, TravelSegment>(), breaks: [] as typeof t.breaks })),
        activeTeamId: activeTeamIdRef.current || currentTeams[0]?.id || '',
        selectedDate: newDate,
      });
      loadDayForEdit(newDate);
    }

    // ── 3. Save current day in the background (no UI blocking) ──────────────
    skipUnmountSaveRef.current = true;
    (async () => {
      if (daySaveRef.current) await daySaveRef.current();
      skipUnmountSaveRef.current = false;
    })();
  }, [loadDayFromCache, loadDayForEdit, setWeekSchedules]);

  const dayLabel = useMemo(() => {
    const parts = state.focusedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }, [state.focusedDate]);

  const handleDayClick = (date: string) => {
    if (state.activeTeamId === 'all' && state.teams.length > 0) {
      dispatch({ type: 'SET_ACTIVE_TEAM', teamId: state.teams[0].id });
    }
    dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' });
    dispatch({ type: 'SET_FOCUSED_DATE', date });
    // Try the week cache first — instant render, no DB round-trip, no map pin flicker.
    // Falls back to a DB fetch only for cross-week navigation where cache has no data.
    if (!loadDayFromCache(date)) {
      loadDayForEdit(date);
    }
  };

  const handleBackToWeek = () => {
    // ── 1. Instantly patch weekSchedules from the reducer state ──────────────
    // The reducer already holds the ground truth for the day being edited —
    // every client add/remove/edit is already in state.teams. Write it straight
    // into weekSchedules so the week view renders with correct data immediately,
    // with no DB round-trip and no flicker at all.
    const editedDate = stateRef.current.selectedDate;
    setWeekSchedules(prev => {
      const next = new Map(prev);
      for (const team of stateRef.current.teams) {
        const teamMap = new Map(next.get(team.id) || new Map<string, DaySchedule>());
        const existing = teamMap.get(editedDate);
        teamMap.set(editedDate, {
          date: editedDate,
          dayOfWeek: existing?.dayOfWeek ||
            new Date(editedDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
          scheduleId: existing?.scheduleId || null,
          clients: team.clients,
          breaks: team.breaks,
          templateCode: existing?.templateCode,
          isPublished: existing?.isPublished || false,
          baseAddress: team.baseAddress,
          returnAddress: team.returnAddress,
          driverStaffId: team.driverStaffId || null,
          staffIds: team.staffIds || [],
        });
        next.set(team.id, teamMap);
      }
      return next;
    });

    // ── 2. Switch view immediately ─────────────────────────────────────────
    dispatch({ type: 'SET_VIEW_MODE', viewMode: 'week' });

    // ── 3. Persist to DB in the background (no UI blocking) ───────────────
    // Signal DayEditor to skip its unmount-cleanup flush — we flush explicitly.
    skipUnmountSaveRef.current = true;
    (async () => {
      if (daySaveRef.current) await daySaveRef.current();
      // Silently reconcile DB → weekSchedules after save completes.
      // skipDispatch:true ensures no LOAD_STATE is fired, so the week job cards
      // that are already showing the correct state won't remount or re-animate.
      await loadWeekSchedules(weekDates, { skipDispatch: true });
      skipUnmountSaveRef.current = false;
    })();
  };



  // ─── Publish / Unpublish Week ───
  const handlePublishWeek = async () => {
    if (!orgId) return;
    for (const date of weekDates) {
      const { data: schedules } = await supabase
        .from('schedules').select('id').eq('org_id', orgId).eq('schedule_date', date);
      if (schedules) {
        for (const s of schedules) {
          await supabase.from('schedules').update({ is_published: true }).eq('id', s.id);
        }
      }
    }
    setPublishedDates(new Set(weekDates));
    loadWeekSchedules(weekDates);
    loadPublishHistory();
  };

  const handleUnpublishWeek = async () => {
    if (!orgId) return;
    for (const date of weekDates) {
      const { data: schedules } = await supabase
        .from('schedules').select('id').eq('org_id', orgId).eq('schedule_date', date);
      if (schedules) {
        for (const s of schedules) {
          await supabase.from('schedules').update({ is_published: false }).eq('id', s.id);
        }
      }
    }
    setPublishedDates(new Set());
    loadWeekSchedules(weekDates);
    loadPublishHistory();
  };

  // Only consider dates that have at least one schedule row for any team.
  // Days with no jobs have no schedule row — they should not count as "unpublished".
  const datesWithSchedules = useMemo(() => {
    const s = new Set<string>();
    weekSchedules.forEach((teamMap) => {
      teamMap.forEach((day) => { if (day.scheduleId) s.add(day.date); });
    });
    return s;
  }, [weekSchedules]);

  const weekIsPublished = datesWithSchedules.size > 0 && [...datesWithSchedules].every((d) => publishedDates.has(d));
  const weekPartiallyPublished = !weekIsPublished && [...datesWithSchedules].some((d) => publishedDates.has(d));

  // Check if current week has any jobs across all teams
  const weekHasJobs = useMemo(() => {
    let total = 0;
    weekSchedules.forEach((teamMap) => {
      teamMap.forEach((d) => {
        total += d.clients.length;
      });
    });
    return total > 0;
  }, [weekSchedules]);

  // ─── Publish History ───
  const [publishHistory, setPublishHistory] = useState<{ weekStart: string; weekEnd: string; label: string; dates: string[]; jobCount: number }[]>([]);
  const [showPublishedWeeks, setShowPublishedWeeks] = useState(false);
  const [unpublishingWeek, setUnpublishingWeek] = useState<string | null>(null);

  // Timezone-safe date formatter (avoids toISOString UTC shift)
  const formatLocalDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const loadPublishHistory = useCallback(async () => {
    if (!orgId) return;
    // Get all published schedules with job counts
    const { data: published } = await supabase
      .from('schedules')
      .select('id, schedule_date, team_id')
      .eq('org_id', orgId)
      .eq('is_published', true)
      .order('schedule_date', { ascending: false });

    if (!published) return;

    // Get job counts for each schedule
    const scheduleIds = published.map((p: { id: string }) => p.id);
    let jobCounts = new Map<string, number>();
    if (scheduleIds.length > 0) {
      const { data: jobs } = await supabase
        .from('schedule_jobs')
        .select('schedule_id')
        .in('schedule_id', scheduleIds)
        .eq('is_break', false);
      if (jobs) {
        for (const j of jobs as { schedule_id: string }[]) {
          jobCounts.set(j.schedule_id, (jobCounts.get(j.schedule_id) || 0) + 1);
        }
      }
    }

    // Group by week (Mon-Sun) using the same logic as getWeekDates
    const allDates = Array.from(new Set(published.map((p: { schedule_date: string }) => p.schedule_date))) as string[];
    const weeks = new Map<string, { dates: string[]; jobCount: number }>();

    for (const dateStr of allDates) {
      const mondayStr = getWeekDates(dateStr)[0]; // Use the same function the week view uses
      if (!weeks.has(mondayStr)) weeks.set(mondayStr, { dates: [], jobCount: 0 });
      const w = weeks.get(mondayStr)!;
      w.dates.push(dateStr);

      // Sum job counts for schedules on this date
      const dateSchedules = published.filter((p: { schedule_date: string }) => p.schedule_date === dateStr);
      for (const ds of dateSchedules as { id: string }[]) {
        w.jobCount += jobCounts.get(ds.id) || 0;
      }
    }

    const history = Array.from(weeks.entries())
      .map(([mondayStr, data]) => {
        const sundayStr = addDays(mondayStr, 6);
        return {
          weekStart: mondayStr,
          weekEnd: sundayStr,
          label: getWeekLabel(mondayStr, sundayStr),
          dates: data.dates,
          jobCount: data.jobCount,
        };
      })
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

    setPublishHistory(history);
  }, [orgId, supabase]);

  useEffect(() => { loadPublishHistory(); }, [loadPublishHistory]);

  const handleUnpublishHistoryWeek = async (weekStart: string) => {
    if (!orgId) return;
    setUnpublishingWeek(weekStart);
    // Get all 7 dates for this week using the same function as the week view
    const dates = getWeekDates(weekStart);
    for (const date of dates) {
      const { data: schedules } = await supabase
        .from('schedules').select('id').eq('org_id', orgId).eq('schedule_date', date);
      if (schedules) {
        for (const s of schedules) {
          await supabase.from('schedules').update({ is_published: false }).eq('id', s.id);
        }
      }
    }
    setUnpublishingWeek(null);
    await loadPublishHistory();
    // Refresh the current week's published state
    loadWeekSchedules(weekDates);
  };

  // ─── Team handlers ───
  const handleAddTeam = useCallback(async () => {
    if (!orgId) return;

    const shownTeamIds = new Set(state.teams.map(t => t.id));

    let unusedTeam: TeamSchedule | null = null;
    if (state.teams.length === 0) {
      // Fresh/cleared week — reuse the first org team (Team 1) so we don't keep
      // creating "Team 8", "Team 9" etc. from accumulated history.
      unusedTeam = allOrgTeamsRef.current[0] || null;
    } else {
      // Week already has teams — pick the next org team not yet shown this week.
      unusedTeam = allOrgTeamsRef.current.find(t => !shownTeamIds.has(t.id)) || null;
    }

    let teamToAdd: TeamSchedule;

    if (unusedTeam) {
      // Reuse an existing team that's not in this week
      teamToAdd = unusedTeam;
    } else {
      // Create a brand new team
      const usedIndices = state.teams.map(t => t.colorIndex);
      const colorIndex = getNextColorIndex(usedIndices);
      const baseAddr = state.teams[0]?.baseAddress;
      const { data } = await supabase.from('teams').insert({
        org_id: orgId, name: `Team ${allOrgTeamsRef.current.length + 1}`, color_index: colorIndex, sort_order: allOrgTeamsRef.current.length,
        ...(baseAddr ? { base_address: baseAddr.address, base_lat: baseAddr.lat, base_lng: baseAddr.lng, base_place_id: baseAddr.placeId || null } : {}),
      }).select().single();
      if (!data) return;
      teamToAdd = {
        id: data.id, name: data.name, color: TEAM_COLORS[colorIndex], colorIndex,
        baseAddress: baseAddr ? { ...baseAddr } : null, returnAddress: null,
        clients: [], travelSegments: new Map(), dayStartTime: '08:00',
        breaks: [], hourlyRate: 38, calculateFuel: false, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
        staffIds: [], driverStaffId: null,
      };
      allOrgTeamsRef.current = [...allOrgTeamsRef.current, teamToAdd];
    }

    // ── Update UI immediately — show the new team tab before any DB work ──
    const newTeamEntry = { ...teamToAdd, clients: [], travelSegments: new Map(), breaks: [], staffIds: [] };
    const updatedWeekTeams = [...weekTeamsRef.current, newTeamEntry];
    weekTeamsRef.current = updatedWeekTeams;
    dispatch({ type: 'LOAD_STATE', teams: updatedWeekTeams, activeTeamId: teamToAdd.id, selectedDate: state.selectedDate });

    // ── Create schedule rows for all days of the week (1 bulk select + 1 insert) ──
    // Previously: 7 sequential per-day SELECTs — very slow.
    // Now: 1 SELECT to find already-existing rows, then 1 INSERT for the missing ones.
    const { data: existingRows } = await supabase
      .from('schedules')
      .select('schedule_date')
      .eq('team_id', teamToAdd.id)
      .in('schedule_date', weekDates);
    const existingDates = new Set((existingRows || []).map((r: { schedule_date: string }) => r.schedule_date));
    const scheduleInserts = weekDates
      .filter(date => !existingDates.has(date))
      .map(date => ({ org_id: orgId, team_id: teamToAdd.id, schedule_date: date }));
    if (scheduleInserts.length > 0) {
      await supabase.from('schedules').insert(scheduleInserts);
    }

    // Reload to sync fully
    await loadWeekSchedules(weekDates);
  }, [orgId, supabase, state.teams, state.selectedDate, weekDates, loadWeekSchedules]);

  const handleRemoveTeam = useCallback(async (teamId: string) => {
    if (state.teams.length <= 1) return;
    const team = state.teams.find(t => t.id === teamId);
    // Count ALL jobs for this team across the entire week
    const { data: weekScheds } = await supabase
      .from('schedules').select('id').eq('team_id', teamId).in('schedule_date', weekDates);
    let weekJobCount = 0;
    if (weekScheds) {
      for (const s of weekScheds) {
        const { count } = await supabase
          .from('schedule_jobs').select('id', { count: 'exact', head: true })
          .eq('schedule_id', s.id).eq('is_break', false);
        weekJobCount += count || 0;
      }
    }
    setPendingDeleteTeam({ id: teamId, name: team?.name || 'this team', weekJobCount });
  }, [state.teams, weekDates, supabase]);

  const confirmDeleteTeam = useCallback(async () => {
    if (!pendingDeleteTeam) return;
    const teamId = pendingDeleteTeam.id;
    setPendingDeleteTeam(null);
    // Remove from local state immediately so the UI reflects the deletion right away
    dispatch({ type: 'REMOVE_TEAM', teamId });
    // Invalidate the cache so auto-save doesn't race and re-create the deleted schedule
    invalidateScheduleCache();
    // Delete ALL schedule rows (and their jobs) for this team across the whole week
    const { data: weekScheds } = await supabase
      .from('schedules').select('id').eq('team_id', teamId).in('schedule_date', weekDates);
    if (weekScheds) {
      for (const s of weekScheds) {
        await supabase.from('schedule_jobs').delete().eq('schedule_id', s.id);
        await supabase.from('schedules').delete().eq('id', s.id);
      }
    }
    // Reload week and bump load generation so DayEditor re-records its baseline
    await loadWeekSchedules(weekDates);
    setDayLoadGen(g => g + 1);
  }, [supabase, pendingDeleteTeam, weekDates, loadWeekSchedules]);

  // ─── Week template loading ───
  const handleLoadWeekTemplate = useCallback(async (weekData: Record<string, { teamName: string; teamId: string; dayStartTime?: string; baseAddress?: unknown; returnAddress?: unknown; hasStartBase?: boolean; hasReturnBase?: boolean; driverStaffId?: string | null; staffIds?: string[]; breaks?: { afterClientIndex: number; durationMinutes: number; label: string }[]; clients: Client[] }[]>, templateName?: string, templateLabel?: string) => {
    // First save any pending day edits
    if (daySaveRef.current) await daySaveRef.current();

    if (!orgId) return;

    // Use ALL org teams (not just the week-view subset in state.teams)
    const allTeams = allOrgTeamsRef.current.length > 0 ? allOrgTeamsRef.current : state.teams;

    // Build lookup maps
    const teamByName = new Map(allTeams.map(t => [t.name, t]));
    const teamById   = new Map(allTeams.map(t => [t.id,   t]));

    // ── Step 1: Resolve template teams → DB teams ──
    const claimedTeamIds = new Set<string>();
    const resolvedTeams = new Map<string, typeof allTeams[0]>();

    const templateTeamEntries: { teamName: string; teamId: string }[] = [];
    const seenNames = new Set<string>();
    for (let i = 0; i < 7; i++) {
      for (const tt of weekData[String(i)] || []) {
        if (!seenNames.has(tt.teamName)) {
          seenNames.add(tt.teamName);
          templateTeamEntries.push({ teamName: tt.teamName, teamId: tt.teamId });
        }
      }
    }

    for (const { teamName, teamId: savedTeamId } of templateTeamEntries) {
      let matched: typeof allTeams[0] | null = null;

      // Priority 1: Match by saved teamId
      if (savedTeamId && teamById.has(savedTeamId) && !claimedTeamIds.has(savedTeamId)) {
        matched = teamById.get(savedTeamId)!;
      }
      // Priority 2: Match by name
      if (!matched && teamByName.has(teamName) && !claimedTeamIds.has(teamByName.get(teamName)!.id)) {
        matched = teamByName.get(teamName)!;
      }

      if (matched) {
        claimedTeamIds.add(matched.id);
        resolvedTeams.set(teamName, matched);
      } else {
        const colorIdx = allTeams.length + resolvedTeams.size;
        const { data: newTeam } = await supabase
          .from('teams')
          .insert({ org_id: orgId, name: teamName, color_index: colorIdx % 10, sort_order: allTeams.length + resolvedTeams.size })
          .select()
          .single();
        if (newTeam) {
          const t = {
            id: newTeam.id as string, name: newTeam.name as string,
            color: (await import('@/lib/types')).TEAM_COLORS[colorIdx % 10],
            colorIndex: colorIdx % 10,
            baseAddress: null, returnAddress: null, clients: [],
            travelSegments: new Map(), dayStartTime: '08:00', breaks: [],
            hourlyRate: 38, calculateFuel: false, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
            staffIds: [], driverStaffId: null,
          };
          claimedTeamIds.add(t.id);
          resolvedTeams.set(teamName, t as typeof allTeams[0]);
          allOrgTeamsRef.current = [...allOrgTeamsRef.current, t as typeof allTeams[0]];
        }
      }
    }

    // ── Step 2: Clear ALL schedule rows for this week (org-scoped) ──
    // We wipe the entire week — same as "Clear Week" — so leftover teams from
    // a previous schedule don't survive the load and cause phantom extra teams.
    const { data: existingScheds } = await supabase
      .from('schedules').select('id').eq('org_id', orgId).in('schedule_date', weekDates);
    if (existingScheds && existingScheds.length > 0) {
      const schedIds = existingScheds.map((r: { id: string }) => r.id);
      await supabase.from('schedule_jobs').delete().in('schedule_id', schedIds);
      await supabase.from('schedules').delete().eq('org_id', orgId).in('id', schedIds);
    }

    // ── Step 3: Clean stale staff references (both per-client and team-level staffIds) ──
    const { data: currentStaff } = await supabase.from('staff_members').select('id').eq('org_id', orgId);
    const validStaffIds = new Set((currentStaff || []).map((s: { id: string }) => s.id));
    let removedStaffCount = 0;

    for (let i = 0; i < 7; i++) {
      for (const tt of weekData[String(i)] || []) {
        // Clean per-client assigned staff
        for (const client of tt.clients) {
          if (client.assignedStaffIds && client.assignedStaffIds.length > 0) {
            const cleaned = client.assignedStaffIds.filter((id: string) => validStaffIds.has(id));
            if (cleaned.length < client.assignedStaffIds.length) {
              removedStaffCount += client.assignedStaffIds.length - cleaned.length;
              client.assignedStaffIds = cleaned;
            }
          }
        }
        // Clean team-level staffIds
        if (tt.staffIds && tt.staffIds.length > 0) {
          const cleaned = tt.staffIds.filter((id: string) => validStaffIds.has(id));
          if (cleaned.length < tt.staffIds.length) {
            removedStaffCount += tt.staffIds.length - cleaned.length;
            tt.staffIds = cleaned;
          }
        }
        // Clean driverStaffId
        if (tt.driverStaffId && !validStaffIds.has(tt.driverStaffId)) {
          removedStaffCount++;
          tt.driverStaffId = null;
        }
      }
    }
    if (removedStaffCount > 0) {
      setTemplateToast(`${removedStaffCount} former staff assignment${removedStaffCount !== 1 ? 's' : ''} removed.`);
      setTimeout(() => setTemplateToast(null), 6000);
    }

    // ── Step 4: Write template data to DB ──
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const dayTeams = weekData[String(dayIdx)];
      if (!dayTeams || dayTeams.length === 0) continue;

      const date = weekDates[dayIdx];

      for (const templateTeam of dayTeams) {
        const matchedTeam = resolvedTeams.get(templateTeam.teamName);
        if (!matchedTeam) continue;

        if (templateTeam.dayStartTime) {
          await supabase.from('teams').update({ day_start_time: templateTeam.dayStartTime }).eq('id', matchedTeam.id);
        }

        type SavedAddress = { address: string; lat: number; lng: number; placeId?: string } | null;
        const tBase   = templateTeam.baseAddress   as SavedAddress;
        // returnAddress can be a location object, null (not set), or the string 'none' (explicitly cleared)
        const tReturnRaw = templateTeam.returnAddress;
        const tReturn = (tReturnRaw === 'none' || tReturnRaw === null || tReturnRaw === undefined)
          ? null
          : tReturnRaw as SavedAddress;
        const returnIsNone = tReturnRaw === 'none';

        // Determine has_start_base / has_return_base.
        // Prefer the explicit saved flags (new templates); fall back to inferring from address presence.
        const hasStartBase  = typeof templateTeam.hasStartBase  === 'boolean'
          ? templateTeam.hasStartBase
          : tBase !== null;
        const hasReturnBase = typeof templateTeam.hasReturnBase === 'boolean'
          ? templateTeam.hasReturnBase
          : !returnIsNone && tReturn !== null;

        // Build schedule row data matching the autosaver's scheduleData shape exactly
        const scheduleRowData: Record<string, unknown> = {
          org_id:          orgId,
          team_id:         matchedTeam.id,
          schedule_date:   date,
          has_start_base:  hasStartBase,
          has_return_base: hasReturnBase,
          driver_staff_id: templateTeam.driverStaffId || null,
          staff_ids:       templateTeam.staffIds || [],
        };

        // Base address
        if (tBase) {
          scheduleRowData.base_address  = tBase.address;
          scheduleRowData.base_lat      = tBase.lat;
          scheduleRowData.base_lng      = tBase.lng;
          scheduleRowData.base_place_id = tBase.placeId || null;
        } else {
          scheduleRowData.base_address  = null;
          scheduleRowData.base_lat      = null;
          scheduleRowData.base_lng      = null;
          scheduleRowData.base_place_id = null;
        }

        // Return address
        if (returnIsNone || !tReturn) {
          scheduleRowData.return_address  = null;
          scheduleRowData.return_lat      = null;
          scheduleRowData.return_lng      = null;
          scheduleRowData.return_place_id = null;
        } else {
          scheduleRowData.return_address  = tReturn.address;
          scheduleRowData.return_lat      = tReturn.lat;
          scheduleRowData.return_lng      = tReturn.lng;
          scheduleRowData.return_place_id = tReturn.placeId || null;
        }

        const { data: created } = await supabase
          .from('schedules').insert(scheduleRowData).select('id').single();
        if (!created) continue;
        const scheduleId = created.id;

        if (templateTeam.clients.length > 0) {
          const breakByIndex = new Map<number, { durationMinutes: number; label: string }>();
          for (const b of templateTeam.breaks || []) {
            breakByIndex.set(b.afterClientIndex, { durationMinutes: b.durationMinutes, label: b.label });
          }

          // Use crypto.randomUUID to explicitly assign IDs, preventing the Postgres RETURNING order bug.
          const clientRows: Record<string, unknown>[] = [];
          const insertedClientIds: string[] = [];
          
          for (let ci = 0; ci < templateTeam.clients.length; ci++) {
            const c = templateTeam.clients[ci] as Client;
            const newId = crypto.randomUUID();
            insertedClientIds.push(newId);
            clientRows.push({
              id:                newId,
              schedule_id:       scheduleId,
              org_id:            orgId,
              client_id:         c.savedClientId || null,
              position:          ci,
              name:              c.name,
              address:           c.location?.address || '',
              lat:               c.location?.lat || 0,
              lng:               c.location?.lng || 0,
              place_id:          c.location?.placeId || null,
              duration_minutes:  c.jobDurationMinutes || 90,
              staff_count:       c.staffCount || 1,
              is_locked:         c.isLocked || false,
              is_break:          false,
              notes:             c.notes || '',
              assigned_staff_ids: c.assignedStaffIds || [],
              fixed_start_time:  c.fixedStartTime || null,
              checklist_id:      c.checklistId || null,
            });
          }

          if (clientRows.length > 0) {
            await supabase.from('schedule_jobs').insert(clientRows);
          }

          const breakRows: Record<string, unknown>[] = [];
          let position = clientRows.length;
          for (const [clientIdx, breakData] of breakByIndex) {
            const afterClientId = insertedClientIds[clientIdx] || '';
            breakRows.push({
              id:                crypto.randomUUID(),
              schedule_id:       scheduleId,
              org_id:            orgId,
              client_id:         null,
              position:          position++,
              name:              breakData.label || 'Break',
              address:           '',
              lat:               0,
              lng:               0,
              place_id:          null,
              duration_minutes:  breakData.durationMinutes,
              staff_count:       1,
              is_locked:         false,
              is_break:          true,
              notes: JSON.stringify({
                afterClientId,
                afterPosition: clientIdx,
                breakId: `${scheduleId}-brk-${clientIdx}`,
                label: breakData.label || 'Break',
              }),
              assigned_staff_ids: [],
            });
          }
          if (breakRows.length > 0) {
            await supabase.from('schedule_jobs').insert(breakRows);
          }
        }
      }
    }

    await loadWeekSchedules(weekDates);
    setLoadedTemplateName(templateName ? { name: templateName, weekStart: weekDates[0] } : null);
    setShowLoadTemplate(false);
  }, [orgId, supabase, state.teams, weekDates, loadWeekSchedules]);

  // ─── Clear entire week ───
  const handleClearWeek = useCallback(async () => {
    if (!orgId) return;
    // Scope strictly to this org's teams to avoid touching other orgs' data
    const { data: schedRows } = await supabase
      .from('schedules')
      .select('id')
      .eq('org_id', orgId)          // ⚠️ Critical: must be scoped to this org
      .in('schedule_date', weekDates);
    if (schedRows && schedRows.length > 0) {
      const ids = schedRows.map((r: { id: string }) => r.id);
      await supabase.from('schedule_jobs').delete().in('schedule_id', ids);
      await supabase.from('schedules').delete().eq('org_id', orgId).in('id', ids);
    }
    setShowClearWeek(false);
    setLoadedTemplateName(null); // Dismiss the template badge — week data is gone
    await loadWeekSchedules(weekDates);
  }, [orgId, supabase, weekDates, loadWeekSchedules]);

  // ─── Month overlay data ───

  // Derive the active team's week schedule for the week view
  const activeWeekSchedules = useMemo(() => {
    return weekSchedules.get(state.activeTeamId) || new Map<string, DaySchedule>();
  }, [weekSchedules, state.activeTeamId]);

  const monthData = useMemo(() => {
    const m = new Map<string, { clientCount: number; isPublished: boolean; templateCode?: string }>();
    // Aggregate across all teams for month overlay
    weekSchedules.forEach((teamMap) => {
      teamMap.forEach((d, date) => {
        if (d.clients.length > 0 || d.isPublished) {
          const existing = m.get(date);
          m.set(date, {
            clientCount: (existing?.clientCount || 0) + d.clients.length,
            isPublished: existing?.isPublished || d.isPublished,
            templateCode: d.templateCode || existing?.templateCode,
          });
        }
      });
    });
    return m;
  }, [weekSchedules]);

  // Compute per-day warnings from weekSchedules for week view badges.
  // We reconstruct a minimal TeamSchedule[] for each date so the warning
  // engine can check time overlaps and staff assignments.
  const weekDayWarnings = useMemo(() => {
    const result = new Map<string, ReturnType<typeof computeDayWarnings>>();
    if (allStaff.length === 0 || weekSchedules.size === 0) return result;

    // Build the set of teams (shape + metadata) from allOrgTeamsRef for this week
    const baseTeams = weekTeamsRef.current.length > 0 ? weekTeamsRef.current : state.teams;
    if (baseTeams.length === 0) return result;

    // Live state lookup: for the currently selected day, state.teams has the
    // most up-to-date driver/staff data (weekSchedules cache lags until day-switch).
    const liveTeamMap = new Map(state.teams.map(t => [t.id, t]));

    for (const date of weekDates) {
      const teamsForDay: TeamSchedule[] = baseTeams.map(team => {
        const teamMap = weekSchedules.get(team.id);
        const dayData = teamMap?.get(date);
        // For the active date prefer live reducer state so driver changes reflect immediately
        const isActiveDate = date === state.selectedDate;
        const liveTeam = isActiveDate ? liveTeamMap.get(team.id) : undefined;
        return {
          ...team,
          clients: dayData?.clients || [],
          breaks: dayData?.breaks || [] as typeof team.breaks,
          staffIds: liveTeam?.staffIds ?? dayData?.staffIds ?? [],
          driverStaffId: liveTeam?.driverStaffId ?? dayData?.driverStaffId ?? null,
          travelSegments: new Map(),
        };
      });
      // Only compute if at least one team has jobs this day
      if (teamsForDay.some(t => t.clients.length > 0)) {
        result.set(date, computeDayWarnings(teamsForDay, allStaff));
      }
    }
    return result;
  }, [weekSchedules, weekDates, allStaff, state.teams, state.selectedDate]);


  // Filter weekDayWarnings to the active team unless "All" is selected.
  // Each warning has a teamIds array — keep a warning if it touches the active team,
  // or if it has no teamIds (global warning).
  const filteredWeekDayWarnings = useMemo(() => {
    if (state.activeTeamId === 'all') return weekDayWarnings;
    const filtered = new Map<string, ReturnType<typeof computeDayWarnings>>();
    for (const [date, warnings] of weekDayWarnings) {
      const relevant = warnings.filter(w =>
        !w.teamIds || w.teamIds.length === 0 || w.teamIds.includes(state.activeTeamId)
      );
      if (relevant.length > 0) filtered.set(date, relevant);
    }
    return filtered;
  }, [weekDayWarnings, state.activeTeamId]);


  // Guard: state.teams may be empty for an untouched week
  const activeTeam = useMemo(
    () => state.teams.find((t) => t.id === state.activeTeamId) ?? state.teams[0] ?? null,
    [state.teams, state.activeTeamId]
  );

  if (!dbLoaded) {
    return (
      <APIProvider apiKey={MAPS_KEY} libraries={['places', 'routes']}>
        <div className="h-full flex flex-col">
          {/* Header skeleton */}
          <div className="shrink-0 h-14 border-b border-border-light bg-white px-4 lg:px-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="shimmer w-6 h-6 rounded-md" />
              <div className="shimmer w-40 h-5 rounded-md" />
              <div className="shimmer w-6 h-6 rounded-md" />
            </div>
            <div className="flex items-center gap-2">
              <div className="shimmer w-20 h-8 rounded-lg" />
              <div className="shimmer w-20 h-8 rounded-lg" />
            </div>
          </div>
          {/* Team tabs skeleton */}
          <div className="shrink-0 h-10 border-b border-border-light bg-white px-4 flex items-center gap-2">
            {[80, 72, 76].map((w, i) => <div key={i} className="shimmer h-6 rounded-full" style={{ width: w }} />)}
          </div>
          {/* Content — neutral shimmer, no viewMode branch (avoids SSR/localStorage mismatch) */}
          <div className="flex-1 shimmer" />
        </div>
      </APIProvider>
    );
  }

  return (
    <APIProvider apiKey={MAPS_KEY} libraries={['places', 'routes']}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <header className="shrink-0 z-20 px-4 lg:px-6 border-b border-border-light bg-white">
          {/* ── Top row: date nav + view toggle ── */}
          <div className="flex items-center justify-between h-12 lg:h-14">
            {/* Date navigation */}
            <div className="flex items-center gap-1">
              {state.viewMode === 'day' && (
                <button onClick={handleBackToWeek} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors" title="Back to week view">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
              )}
              <button
                onClick={state.viewMode === 'day' ? goToPrevDay : goToPrevWeek}
                disabled={state.viewMode === 'day' && atWeekStart}
                className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-text-secondary transition-colors ${
                  state.viewMode === 'day' && atWeekStart ? 'opacity-25 cursor-not-allowed pointer-events-none' : ''
                }`}
                title={state.viewMode === 'day' && atWeekStart ? 'Already at start of week' : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <span className="text-sm font-semibold text-text-primary text-center px-1 lg:min-w-[180px]">
                {state.viewMode === 'day' ? dayLabel : weekLabel}
              </span>
              <button
                onClick={state.viewMode === 'day' ? goToNextDay : goToNextWeek}
                disabled={state.viewMode === 'day' && atWeekEnd}
                className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-text-secondary transition-colors ${
                  state.viewMode === 'day' && atWeekEnd ? 'opacity-25 cursor-not-allowed pointer-events-none' : ''
                }`}
                title={state.viewMode === 'day' && atWeekEnd ? 'Already at end of week' : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-1">

              {/* Template badge — left of the calendar icon */}
              {loadedTemplateName && loadedTemplateName.weekStart === weekDates[0] && state.viewMode === 'week' && (
                <span className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-primary bg-primary/8 border border-primary/15 px-2.5 py-1 rounded-full">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Loaded from {loadedTemplateName.name}
                </span>
              )}

              <button onClick={() => setShowMonth(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-text-secondary transition-colors" title="Month view">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </button>

              {state.viewMode === 'week' && !isStaff && (
                <>
                  <button onClick={() => setShowSaveTemplate(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-text-secondary transition-colors" title="Save week as template">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                  </button>
                  <button onClick={() => setShowLoadTemplate(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-text-secondary transition-colors" title="Load week template">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  </button>
                  <button onClick={() => setShowClearWeek(true)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-text-tertiary hover:text-danger transition-colors" title="Clear all jobs from this week">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </>
              )}

              {state.viewMode === 'week' && !isStaff && (
                <div className="flex items-center gap-1">
                  {weekIsPublished ? (
                    <button
                      onClick={handleUnpublishWeek}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors bg-success-light text-success hover:bg-red-50 hover:text-red-600 group"
                    >
                      <span className="group-hover:hidden">✓</span>
                      <span className="hidden group-hover:inline">Unpub</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePublishWeek}
                      disabled={!weekHasJobs}
                      title={!weekHasJobs ? 'Add jobs before publishing' : ''}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                        !weekHasJobs
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : weekPartiallyPublished
                            ? 'bg-amber-50 text-amber-700 hover:bg-primary hover:text-white'
                            : 'bg-primary text-white hover:bg-primary-hover'
                      }`}
                    >
                      {weekPartiallyPublished ? 'Partial' : 'Publish'}
                    </button>
                  )}

                  {/* Published Weeks button */}
                  <button
                    onClick={() => setShowPublishedWeeks(true)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors bg-surface-elevated text-text-secondary hover:bg-surface-hover"
                    title="Published Weeks"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>


          {/* Team tabs — only render when there are teams */}
          {state.teams.length > 0 && (
            <div className="pb-3 -mx-1 overflow-x-auto">
              <TeamTabs
                state={state}
                dispatch={dispatch}
                onSelectTeam={(teamId) => dispatch({ type: 'SET_ACTIVE_TEAM', teamId })}
                onAddTeam={isStaff ? undefined : handleAddTeam}
                onRemoveTeam={isStaff ? undefined : handleRemoveTeam}
                onChangeTeamColor={isStaff ? undefined : (teamId, colorIndex) => {
                  dispatch({ type: 'SET_TEAM_COLOR', teamId, colorIndex });
                  // Read existing row first so we don't null out the name field,
                  // then upsert the full merged record for this week.
                  supabase
                    .from('weekly_team_configs')
                    .select('name')
                    .eq('team_id', teamId)
                    .eq('week_start', weekDates[0])
                    .maybeSingle()
                    .then(({ data }: { data: { name: string | null } | null }) => {
                      supabase.from('weekly_team_configs').upsert(
                        { org_id: orgId, team_id: teamId, week_start: weekDates[0], color_index: colorIndex, name: data?.name ?? null },
                        { onConflict: 'team_id,week_start' }
                      ).then(() => {});
                    });
                  const applyColor = (t: TeamSchedule) =>
                    t.id === teamId ? { ...t, colorIndex, color: TEAM_COLORS[colorIndex % TEAM_COLORS.length] } : t;
                  allOrgTeamsRef.current = allOrgTeamsRef.current.map(applyColor);
                  weekTeamsRef.current = weekTeamsRef.current.map(applyColor);
                }}
                onChangeTeamName={isStaff ? undefined : (teamId, name) => {
                  dispatch({ type: 'RENAME_TEAM', teamId, name });
                  // Read existing row first so we don't null out the color_index field.
                  supabase
                    .from('weekly_team_configs')
                    .select('color_index')
                    .eq('team_id', teamId)
                    .eq('week_start', weekDates[0])
                    .maybeSingle()
                    .then(({ data }: { data: { color_index: number | null } | null }) => {
                      supabase.from('weekly_team_configs').upsert(
                        { org_id: orgId, team_id: teamId, week_start: weekDates[0], name, color_index: data?.color_index ?? null },
                        { onConflict: 'team_id,week_start' }
                      ).then(() => {});
                    });
                  const applyName = (t: TeamSchedule) => t.id === teamId ? { ...t, name } : t;
                  allOrgTeamsRef.current = allOrgTeamsRef.current.map(applyName);
                  weekTeamsRef.current = weekTeamsRef.current.map(applyName);
                }}
                teamStaffMap={teamStaffMap}
              />
            </div>
          )}
        </header>

        {/* Content */}
        {/* Content */}
        <div className="flex-1 min-h-0">
          {state.viewMode === 'week' && state.teams.length === 0 ? (
            // ── Empty week state ──
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-surface-elevated flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">Nothing planned for this week</h3>
                <p className="text-sm text-text-tertiary mt-1 max-w-xs">Add a team to start building your schedule, or load a saved template.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddTeam}
                  className="btn-primary text-sm px-4 py-2 flex items-center gap-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Start Planning This Week
                </button>
                {!isStaff && (
                  <button onClick={() => setShowLoadTemplate(true)} className="btn-ghost text-sm px-4 py-2 flex items-center gap-2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Load Template
                  </button>
                )}
              </div>

            </div>
          ) : state.viewMode === 'week' ? (
            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="flex h-full min-w-0 bg-gradient-to-br from-transparent to-surface-hover/30">
                <AnimatePresence initial={false}>
                  {state.activeTeamId !== 'all' && (
                    <motion.div
                      key="client-sidebar"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                      className="shrink-0 h-full overflow-hidden"
                    >
                      <div className="pl-4 pb-4 lg:pl-6 lg:pb-6 pt-1 h-full">
                        <WeekClientSidebar />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex-1 min-w-0 h-full">
                  <WeekView
                    weekDates={weekDates}
                    daySchedules={activeWeekSchedules}
                    teamColor={activeTeam?.color || TEAM_COLORS[0]}
                    activeDate={state.focusedDate}
                    onDayClick={handleDayClick}
                    allTeamsMode={state.activeTeamId === 'all'}
                    allTeams={state.teams}
                    allTeamSchedules={weekSchedules}
                    staffNameMap={Object.fromEntries(allStaff.map(s => [s.id, s.name]))}
                    dayWarnings={filteredWeekDayWarnings}
                  />
                </div>
              </div>
              {/* ── Delete drop zone — floats up when dragging ── */}
              <AnimatePresence>
                {(activeDragClient || activeDragJob) && <DeleteZone />}
              </AnimatePresence>


              <DragOverlay dropAnimation={null}>
                {activeDragClient ? (
                  <div className="group relative p-3 rounded-[14px] bg-white border border-primary cursor-grabbing shadow-dropdown scale-105 ring-2 ring-primary">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[13px] font-bold text-primary leading-tight truncate">{activeDragClient.name}</h4>
                        <p className="text-[11px] text-text-secondary mt-1.5 truncate">{activeDragClient.address}</p>
                      </div>
                      {activeDragClient.color && (
                        <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: activeDragClient.color }} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[10px] font-semibold text-text-secondary bg-surface-hover px-2 py-1 rounded-md flex items-center gap-1.5">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {activeDragClient.default_duration_minutes}m
                      </span>
                      <span className="text-[10px] font-semibold text-text-secondary bg-surface-hover px-2 py-1 rounded-md flex items-center gap-1.5">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        {activeDragClient.default_staff_count}
                      </span>
                    </div>
                  </div>
                ) : activeDragJob ? (
                  <div className="rounded-lg p-2.5 bg-white border border-primary shadow-dropdown cursor-grabbing ring-2 ring-primary scale-105 min-w-[130px]">
                    <p className="text-[12px] font-semibold text-text-primary leading-tight truncate">{activeDragJob.name || 'Unnamed'}</p>
                    <p className="text-[10px] text-text-tertiary mt-0.5">{activeDragJob.jobDurationMinutes}m</p>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <DayEditor
              state={state}
              dispatch={dispatch}
              orgId={orgId}
              dbLoaded={dbLoaded}
              supabase={supabase}
              saveRef={daySaveRef}
              allStaff={allStaff}
              loadGeneration={dayLoadGen}
              skipUnmountSaveRef={skipUnmountSaveRef}
            />
          )}
        </div>
      </div>

      {/* ========== PUBLISHED WEEKS MODAL ========== */}
      {showPublishedWeeks && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPublishedWeeks(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-[520px] max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border-light flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Published Weeks</h2>
                <p className="text-xs text-text-tertiary mt-0.5">{publishHistory.length} week{publishHistory.length !== 1 ? 's' : ''} published</p>
              </div>
              <button onClick={() => setShowPublishedWeeks(false)} className="p-2 rounded-xl hover:bg-surface-hover text-text-tertiary transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {publishHistory.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-4xl mb-3">📅</div>
                  <p className="text-sm text-text-secondary">No weeks have been published yet</p>
                  <p className="text-xs text-text-tertiary mt-1">Publish a week to make schedules visible to staff</p>
                </div>
              ) : (
                <div className="divide-y divide-border-light">
                  {publishHistory.map((week) => {
                    const isCurrent = week.weekStart === weekDates[0];
                    const isUnpublishing = unpublishingWeek === week.weekStart;
                    const today = getTodayISO();
                    const isPast = week.weekEnd < today;
                    const isFuture = week.weekStart > today;

                    return (
                      <div key={week.weekStart} className={`px-6 py-4 ${isCurrent ? 'bg-primary/[0.03]' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className={`text-sm font-semibold ${isCurrent ? 'text-primary' : 'text-text-primary'}`}>
                                {week.label}
                              </h3>
                              {isCurrent && <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">Current</span>}
                              {isPast && !isCurrent && <span className="text-[10px] font-medium text-text-tertiary bg-surface-elevated px-1.5 py-0.5 rounded">Past</span>}
                              {isFuture && <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Upcoming</span>}
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-text-tertiary">
                              <span>{week.dates.length} day{week.dates.length !== 1 ? 's' : ''}</span>
                              <span>·</span>
                              <span>{week.jobCount} job{week.jobCount !== 1 ? 's' : ''}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Edit (jump to week) */}
                            <button
                              onClick={() => {
                                dispatch({ type: 'SET_FOCUSED_DATE', date: week.weekStart });
                                setShowPublishedWeeks(false);
                              }}
                              className="p-2 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-primary transition-colors"
                              title="Edit this week"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>

                            {/* Unpublish */}
                            <button
                              onClick={() => handleUnpublishHistoryWeek(week.weekStart)}
                              disabled={isUnpublishing}
                              className="p-2 rounded-lg hover:bg-red-50 text-text-tertiary hover:text-red-600 transition-colors disabled:opacity-40"
                              title="Unpublish this week"
                            >
                              {isUnpublishing ? (
                                <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showSaveTemplate && (
          <SaveTemplateModal teams={allOrgTeamsRef.current.length > 0 ? allOrgTeamsRef.current : state.teams} selectedDate={state.selectedDate} weekSchedules={weekSchedules} orgId={orgId} onClose={() => setShowSaveTemplate(false)} />
        )}
        {showLoadTemplate && (
          <LoadTemplateModal orgId={orgId} onLoadWeek={handleLoadWeekTemplate} onClose={() => setShowLoadTemplate(false)} />
        )}
        {showMonth && (
          <MonthOverlay
            scheduledDates={monthData}
            onDayClick={(date) => { dispatch({ type: 'SET_FOCUSED_DATE', date }); }}
            onClose={() => setShowMonth(false)}
          />
        )}
        {pendingDeleteTeam && (
          <ConfirmModal
            title={`Delete ${pendingDeleteTeam.name}?`}
            message={
              pendingDeleteTeam.weekJobCount > 0
                ? `This will permanently delete ${pendingDeleteTeam.name} and its ${pendingDeleteTeam.weekJobCount} scheduled job${pendingDeleteTeam.weekJobCount !== 1 ? 's' : ''} across the entire week. This cannot be undone.`
                : `This will permanently delete ${pendingDeleteTeam.name} from the entire week. This cannot be undone.`
            }
            confirmLabel="Delete Team"
            onConfirm={confirmDeleteTeam}
            onCancel={() => setPendingDeleteTeam(null)}
            danger
          />
        )}
        {showClearWeek && (
          <ConfirmModal
            title={`Clear entire week?`}
            message={`This will permanently delete all jobs across all teams for the week of ${new Date(weekDates[0] + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${new Date(weekDates[6] + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}. This cannot be undone.`}
            confirmLabel="Clear Entire Week"
            onConfirm={handleClearWeek}
            onCancel={() => setShowClearWeek(false)}
            danger
          />
        )}
      </AnimatePresence>

      {/* Template-load toast: shown when former staff are stripped */}
      <AnimatePresence>
        {templateToast && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)]"
          >
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 shadow-lg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
              </svg>
              <p className="text-sm text-amber-800 font-medium leading-snug">{templateToast}</p>
              <button onClick={() => setTemplateToast(null)} className="ml-auto shrink-0 text-amber-500 hover:text-amber-700 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </APIProvider>
  );
}
