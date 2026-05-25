'use client';

import { useReducer, useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AnimatePresence } from 'framer-motion';

import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { getTodayISO, getWeekDates, getWeekLabel, addDays } from '@/lib/timeUtils';
import { TravelSegment, Client, TeamSchedule, TEAM_COLORS, DaySchedule, StaffMember, getNextColorIndex, Location as AppLocation } from '@/lib/types';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

import TeamTabs from '@/components/TeamTabs';
import WeekView from '@/components/WeekView';
import MonthOverlay from '@/components/MonthOverlay';
import SaveTemplateModal from '@/components/SaveTemplateModal';
import LoadTemplateModal from '@/components/LoadTemplateModal';
import DayEditor from '@/components/DayEditor';
import ConfirmModal from '@/components/ConfirmModal';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Module-level cache — persists across route changes in the same browser session.
// This eliminates the loading skeleton when switching back to the schedule tab.
type SchedulePageCache = {
  weekSchedules: Map<string, Map<string, DaySchedule>>;
  allStaff: StaffMember[];
  publishedDates: Set<string>;
  timestamp: number;
};
let _pageCache: SchedulePageCache | null = null;
const CACHE_TTL = 30_000; // 30 seconds — short enough that stale ghosts expire quickly
/** Called by DayEditor after every autosave so the next tab-switch re-fetches fresh data */
export function invalidateScheduleCache() {
  if (_pageCache) _pageCache.timestamp = 0;
}

export default function SchedulePage() {
  const [state, dispatch] = useReducer(scheduleReducer, null, createInitialState);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [showMonth, setShowMonth] = useState(false);
  const [showClearWeek, setShowClearWeek] = useState(false);

  const [weekSchedules, setWeekSchedules] = useState<Map<string, Map<string, DaySchedule>>>(new Map());
  const [publishedDates, setPublishedDates] = useState<Set<string>>(new Set());
  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const [teamStaffMap, setTeamStaffMap] = useState<Map<string, { id: string; name: string; hourly_rate: number }[]>>(new Map());
  const daySaveRef = useRef<(() => Promise<void>) | null>(null);
  const activeTeamIdRef = useRef(state.activeTeamId);
  activeTeamIdRef.current = state.activeTeamId;
  const viewModeRef = useRef(state.viewMode);
  viewModeRef.current = state.viewMode;
  const [pendingDeleteTeam, setPendingDeleteTeam] = useState<{ id: string; name: string; date: string; dayJobCount: number } | null>(null);
  const allOrgTeamsRef = useRef<TeamSchedule[]>([]);
  // Increments after every loadDayForEdit/loadDayFromCache so DayEditor re-records
  // its autosave baseline and doesn't mistake the load for a user edit.
  const [dayLoadGen, setDayLoadGen] = useState(0);

  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id || null;
  const isStaff = profile?.role === 'staff';

  const weekDates = useMemo(() => getWeekDates(state.focusedDate), [state.focusedDate]);
  const weekLabel = useMemo(() => getWeekLabel(weekDates[0], weekDates[6]), [weekDates]);

  // ─── Restore from cache on client (no SSR hydration mismatch) ───
  // useLayoutEffect runs only on the client, synchronously before paint,
  // so if the cache is fresh the user never sees the skeleton on tab switch.
  useLayoutEffect(() => {
    if (_pageCache && Date.now() - _pageCache.timestamp < CACHE_TTL) {
      setWeekSchedules(_pageCache.weekSchedules);
      setPublishedDates(_pageCache.publishedDates);
      setAllStaff(_pageCache.allStaff);
      setDbLoaded(true);
    }
  }, []);

  // ─── Load teams on mount ───
  const loadTeams = useCallback(async () => {
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
      fuelEfficiency: Number(row.fuel_efficiency) || 10,
      fuelPrice: Number(row.fuel_price) || 1.85,
      perKmRate: Number(row.per_km_rate) || 0,
    }));

    // Auto-fix duplicate color indices
    const usedIndices = new Set<number>();
    for (const team of teams) {
      if (usedIndices.has(team.colorIndex)) {
        const newIdx = getNextColorIndex(Array.from(usedIndices));
        team.colorIndex = newIdx;
        team.color = TEAM_COLORS[newIdx % TEAM_COLORS.length];
        // Persist fix to DB
        supabase.from('teams').update({ color_index: newIdx }).eq('id', team.id).then(() => {});
      }
      usedIndices.add(team.colorIndex);
    }

    return teams;
  }, [orgId, supabase]);

  // ─── Load week schedules for overview ───
  const loadWeekSchedules = useCallback(async (dates: string[]) => {
    if (!orgId) return;
    try {
      const teamsList = await loadTeams();

      // No teams found — create a default one and finish
      if (!teamsList || teamsList.length === 0) {
        const { data: newTeam } = await supabase.from('teams').insert({ org_id: orgId, name: 'Team 1', color_index: 0, sort_order: 0 }).select().single();
        if (newTeam) {
          const defaultTeam: TeamSchedule = {
            id: newTeam.id, name: newTeam.name, color: TEAM_COLORS[0], colorIndex: 0,
            baseAddress: null, returnAddress: null, clients: [], travelSegments: new Map(), dayStartTime: '08:00',
            breaks: [], hourlyRate: 38, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
          };
          dispatch({ type: 'LOAD_STATE', teams: [defaultTeam], activeTeamId: defaultTeam.id, selectedDate: state.selectedDate });
        }
        setDbLoaded(true);
        return;
      }

      const allTeamMaps = new Map<string, Map<string, DaySchedule>>();

      // Load all client colors for this org
      const { data: clientColorRows } = await supabase.from('clients').select('id, color').eq('org_id', orgId);
      const clientColorMap = new Map<string, string>();
      if (clientColorRows) {
        for (const row of clientColorRows) {
          if (row.color) clientColorMap.set(row.id, row.color);
        }
      }
      const newPublished = new Set<string>();

      for (const team of teamsList) {
        const teamMap = new Map<string, DaySchedule>();

        for (const date of dates) {
          const dayClients: Client[] = [];
          const dayBreaks: import('@/lib/types').ScheduleBreak[] = [];
          let schedId: string | null = null;
          let templateCode: string | undefined;
          let isPublished = false;

          const { data: schedule } = await supabase
            .from('schedules')
            .select('id, is_published, template_code, base_address, base_lat, base_lng, base_place_id, return_address, return_lat, return_lng, return_place_id, has_start_base, has_return_base, driver_staff_id')
            .eq('team_id', team.id)
            .eq('schedule_date', date)
            .maybeSingle();

          // Per-day base address (from schedule row, or fallback to team default)
          let dayBaseAddress: AppLocation | null = team.baseAddress;
          let dayReturnAddress: AppLocation | null | 'none' = team.returnAddress;
          let hasStartBase = true;
          let hasReturnBase = true;
          let dayDriverStaffId: string | null = null;

          if (schedule) {
            schedId = schedule.id;
            isPublished = schedule.is_published || false;
            templateCode = schedule.template_code || undefined;
            hasStartBase = schedule.has_start_base !== false;
            hasReturnBase = schedule.has_return_base !== false;
            dayDriverStaffId = (schedule.driver_staff_id as string) || null;

            // Override base from schedule if set
            if (schedule.base_address) {
              dayBaseAddress = {
                address: String(schedule.base_address), lat: Number(schedule.base_lat) || 0,
                lng: Number(schedule.base_lng) || 0, placeId: schedule.base_place_id ? String(schedule.base_place_id) : undefined,
              } as AppLocation;
            }
            if (!hasStartBase) dayBaseAddress = null;

            // Override return from schedule if set
            if (!hasReturnBase) {
              dayReturnAddress = 'none';
            } else if (schedule.return_address) {
              dayReturnAddress = {
                address: String(schedule.return_address), lat: Number(schedule.return_lat) || 0,
                lng: Number(schedule.return_lng) || 0, placeId: schedule.return_place_id ? String(schedule.return_place_id) : undefined,
              } as AppLocation;
            }

            const { data: jobs } = await supabase
              .from('schedule_jobs')
              .select('*')
              .eq('schedule_id', schedule.id)
              .order('position');

            if (jobs) {
              // First pass: build client list (needed so breaks can reference client IDs)
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
                  staffCount: assignedIds.length > 0 ? assignedIds.length : ((j.staff_count as number) || 1),
                  isLocked: (j.is_locked as boolean) || false,
                  fixedStartTime: (j.fixed_start_time as string) || undefined,
                  startTime: (j.start_time as string) || undefined,
                  endTime: (j.end_time as string) || undefined,
                  notes: (j.notes as string) || undefined,
                  savedClientId: (j.client_id as string) || undefined,
                  assignedStaffIds: assignedIds,
                  clientColor: j.client_id ? clientColorMap.get(j.client_id as string) || undefined : undefined,
                });
              }
              // Second pass: reconstruct breaks using afterPosition → client ID
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
          });
        }

        allTeamMaps.set(team.id, teamMap);
      }

      setWeekSchedules(allTeamMaps);
      setPublishedDates(newPublished);
      // Invalidate the module-level page cache so tab-switching never restores stale data.
      // We clear it here and re-set it ONLY after a successful full load.
      _pageCache = { weekSchedules: allTeamMaps, publishedDates: newPublished, allStaff: _pageCache?.allStaff || [], timestamp: Date.now() };

      // Store ALL org teams — used by addTeam, template save, template load, etc.
      allOrgTeamsRef.current = teamsList;

      // ── Only show teams that have at least one schedule row this week ──
      // Teams are global per-org, but each week is independent. A team only
      // appears in a given week if it has a `schedules` row for any day of that week.
      // Navigating to a week you've never touched shows zero teams (correct).
      if (viewModeRef.current !== 'day') {
        const today = state.selectedDate;

        // Filter: only teams with at least one non-null scheduleId this week
        const teamsThisWeek = teamsList.filter((team: TeamSchedule) => {
          const teamMap = allTeamMaps.get(team.id);
          if (!teamMap) return false;
          for (const [, day] of teamMap) {
            if (day.scheduleId !== null) return true;
          }
          return false;
        });

        const teamsWithClients = teamsThisWeek.map((team: TeamSchedule) => {
          const teamMap = allTeamMaps.get(team.id);
          const dayData = teamMap?.get(today);
          return {
            ...team,
            clients: dayData?.clients || [],
            breaks: dayData?.breaks || [],
            driverStaffId: dayData?.driverStaffId || null,
            baseAddress: dayData?.baseAddress !== undefined ? dayData.baseAddress : team.baseAddress,
            returnAddress: dayData?.returnAddress !== undefined ? dayData.returnAddress : team.returnAddress,
          };
        });

        // Empty week — dispatch empty teams array so the UI shows the "no teams" empty state
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
      setDbLoaded(true); // Unblock the UI even on error
    }
  }, [orgId, supabase, loadTeams, state.selectedDate]);

  // ─── Load staff directory once ───
  const loadStaffMembers = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from('staff_members').select('id, name, role, hourly_rate, available_days').eq('org_id', orgId).order('name');
    if (data) {
      setAllStaff(data as StaffMember[]);
      if (_pageCache) _pageCache = { ..._pageCache, allStaff: data as StaffMember[], timestamp: Date.now() };
    }
  }, [orgId, supabase]);

  // Derive teamStaffMap from per-job assignments (for TeamTabs badges)
  const deriveTeamStaffMap = useCallback(() => {
    const map = new Map<string, { id: string; name: string; hourly_rate: number }[]>();
    const staffLookup = new Map(allStaff.map(s => [s.id, { name: s.name, hourly_rate: s.hourly_rate }]));
    for (const team of state.teams) {
      const seen = new Set<string>();
      const list: { id: string; name: string; hourly_rate: number }[] = [];
      for (const c of team.clients) {
        for (const sid of c.assignedStaffIds || []) {
          if (!seen.has(sid)) {
            seen.add(sid);
            const info = staffLookup.get(sid);
            if (info) list.push({ id: sid, name: info.name, hourly_rate: info.hourly_rate });
          }
        }
      }
      if (list.length > 0) map.set(team.id, list);
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
    const allTeams = allOrgTeamsRef.current.length > 0 ? allOrgTeamsRef.current : (await loadTeams() || []);
    if (allTeams.length === 0) return;

    const teamIds = allTeams.map((t: TeamSchedule) => t.id);

    // ── 1 bulk query: all schedules for these teams on this date ──
    const { data: schedules } = await supabase
      .from('schedules')
      .select('id, team_id, base_address, base_lat, base_lng, base_place_id, return_address, return_lat, return_lng, return_place_id, has_start_base, has_return_base, driver_staff_id')
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
        // Restore driver for this day
        team.driverStaffId = (schedule.driver_staff_id as string) || null;

        const jobs = jobsBySchedule.get(schedule.id as string) || [];
        team.clients = jobs
          .filter((j) => !j.is_break)
          .map((j): Client => {
            const assignedIds = (j.assigned_staff_ids as string[]) || [];
            return {
              id: j.id as string, name: (j.name as string) || '',
              location: { address: (j.address as string) || '', lat: (j.lat as number) || 0, lng: (j.lng as number) || 0, placeId: (j.place_id as string) || undefined },
              jobDurationMinutes: Number(j.duration_minutes) || 90,
              staffCount: assignedIds.length > 0 ? assignedIds.length : ((j.staff_count as number) || 1),
              isLocked: (j.is_locked as boolean) || false,
              fixedStartTime: (j.fixed_start_time as string) || undefined,
              startTime: (j.start_time as string) || undefined,
              endTime: (j.end_time as string) || undefined,
              notes: (j.notes as string) || undefined,
              savedClientId: (j.client_id as string) || undefined,
              assignedStaffIds: assignedIds,
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

    const visibleTeams = teamsList.filter(t => teamsWithSchedule.has(t.id));
    const finalTeams = visibleTeams.length > 0 ? visibleTeams : [teamsList[0]];

    dispatch({ type: 'LOAD_STATE', teams: finalTeams, activeTeamId: finalTeams.find((t: TeamSchedule) => t.id === activeTeamIdRef.current)?.id || finalTeams[0].id, selectedDate: date });
    setDayLoadGen(g => g + 1);
  }, [orgId, supabase, loadTeams]);

  // ─── Instant day switch from weekSchedules cache ───
  const loadDayFromCache = useCallback((date: string): boolean => {
    if (weekSchedules.size === 0) return false;
    const allTeams = allOrgTeamsRef.current;
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
        // Use breaks from the week cache (populated by loadWeekSchedules)
        breaks: dayData?.breaks || [] as typeof team.breaks,
        baseAddress: dayData?.baseAddress !== undefined ? dayData.baseAddress : team.baseAddress,
        returnAddress: dayData?.returnAddress !== undefined ? dayData.returnAddress : team.returnAddress,
        driverStaffId: dayData?.driverStaffId !== undefined ? dayData.driverStaffId : null,
      };
    });

    // Always show ALL teams in day view (same as week view).
    // Teams with no jobs today appear as empty — they don't disappear.
    const finalTeams = teamsWithClients.length > 0 ? teamsWithClients : [teamsWithClients[0]];


    dispatch({
      type: 'LOAD_STATE',
      teams: finalTeams,
      activeTeamId: finalTeams.find(t => t.id === activeTeamIdRef.current)?.id || finalTeams[0].id,
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
      // Cross-week or no cache: clear stale data immediately, then fetch
      dispatch({
        type: 'LOAD_STATE',
        teams: state.teams.map(t => ({ ...t, clients: [], travelSegments: new Map<string, TravelSegment>(), breaks: [] as typeof t.breaks })),
        activeTeamId: state.activeTeamId,
        selectedDate: newDate,
      });
      await loadDayForEdit(newDate);
    }
  }, [loadDayFromCache, loadDayForEdit, state.teams, state.activeTeamId]);

  const goToPrevDay = async () => {
    if (daySaveRef.current) await daySaveRef.current();
    switchToDay(addDays(state.focusedDate, -1));
  };
  const goToNextDay = async () => {
    if (daySaveRef.current) await daySaveRef.current();
    switchToDay(addDays(state.focusedDate, 1));
  };

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
    // Always do a fresh DB read when entering day view from week view.
    // The week cache (weekSchedules) is stale at this point — handleBackToWeek
    // fires loadWeekSchedules in the background, so it may not have finished
    // by the time the user clicks a day cell. loadDayForEdit reads the DB
    // directly and will have any data that saveNow flushed before leaving day view.
    loadDayForEdit(date);
  };

  const handleBackToWeek = async () => {
    // Flush pending save before switching views
    if (daySaveRef.current) await daySaveRef.current();
    dispatch({ type: 'SET_VIEW_MODE', viewMode: 'week' });

    // Instantly restore all org teams with cached week data so tabs appear immediately
    const allTeams = allOrgTeamsRef.current;
    if (allTeams.length > 0 && weekSchedules.size > 0) {
      const today = state.selectedDate;
      const restoredTeams = allTeams.map((team: TeamSchedule) => {
        const teamMap = weekSchedules.get(team.id);
        const dayData = teamMap?.get(today);
        return {
          ...team,
          clients: dayData?.clients || [],
          travelSegments: new Map<string, TravelSegment>(),
          breaks: [] as typeof team.breaks,
          baseAddress: dayData?.baseAddress !== undefined ? dayData.baseAddress : team.baseAddress,
          returnAddress: dayData?.returnAddress !== undefined ? dayData.returnAddress : team.returnAddress,
        };
      });
      // Show only teams that have a schedule row this week — same logic as loadWeekSchedules
      const teamsWithWeekSchedule = restoredTeams.filter((t: TeamSchedule) => {
        const teamMap = weekSchedules.get(t.id);
        if (!teamMap) return false;
        for (const [, d] of teamMap) { if (d.scheduleId !== null) return true; }
        return false;
      });
      // Empty week: dispatch empty array rather than falling back to showing a random team
      if (teamsWithWeekSchedule.length === 0) {
        dispatch({ type: 'LOAD_STATE', teams: [], activeTeamId: '', selectedDate: today });
      } else {
        dispatch({
          type: 'LOAD_STATE',
          teams: teamsWithWeekSchedule,
          activeTeamId: teamsWithWeekSchedule.find((t: TeamSchedule) => t.id === activeTeamIdRef.current)?.id || teamsWithWeekSchedule[0].id,
          selectedDate: today,
        });
      }
    }

    // Background refresh to pick up any changes made during day editing
    loadWeekSchedules(weekDates);
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

  const weekIsPublished = weekDates.every((d) => publishedDates.has(d));
  const weekPartiallyPublished = !weekIsPublished && weekDates.some((d) => publishedDates.has(d));

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

    // Check if there are existing teams not currently shown this week
    const shownTeamIds = new Set(state.teams.map(t => t.id));
    const unusedTeam = allOrgTeamsRef.current.find(t => !shownTeamIds.has(t.id));

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
        breaks: [], hourlyRate: 38, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
      };
      allOrgTeamsRef.current = [...allOrgTeamsRef.current, teamToAdd];
    }

    // Create an empty schedule row for the SELECTED DATE only
    // (not the whole week — teams are per-day)
    const targetDate = state.selectedDate;
    const { data: existingSched } = await supabase
      .from('schedules').select('id').eq('team_id', teamToAdd.id).eq('schedule_date', targetDate).maybeSingle();
    if (!existingSched) {
      await supabase.from('schedules').insert({ org_id: orgId, team_id: teamToAdd.id, schedule_date: targetDate });
    }

    // Add to UI immediately
    dispatch({ type: 'LOAD_STATE', teams: [...state.teams, { ...teamToAdd, clients: [], travelSegments: new Map(), breaks: [] }], activeTeamId: teamToAdd.id, selectedDate: state.selectedDate });
    // Reload to sync fully
    loadWeekSchedules(weekDates);
  }, [orgId, supabase, state.teams, state.selectedDate, weekDates, loadWeekSchedules]);

  const handleRemoveTeam = useCallback(async (teamId: string) => {
    if (state.teams.length <= 1) return;
    const team = state.teams.find(t => t.id === teamId);
    // Count jobs for this team on the SELECTED DAY only
    const targetDate = state.selectedDate;
    let dayJobCount = 0;
    const { data: daySched } = await supabase
      .from('schedules').select('id').eq('team_id', teamId).eq('schedule_date', targetDate).maybeSingle();
    if (daySched) {
      const { count } = await supabase
        .from('schedule_jobs').select('id', { count: 'exact', head: true })
        .eq('schedule_id', daySched.id).eq('is_break', false);
      dayJobCount = count || 0;
    }
    setPendingDeleteTeam({ id: teamId, name: team?.name || 'this team', date: targetDate, dayJobCount });
  }, [state.teams, state.selectedDate, supabase]);

  const confirmDeleteTeam = useCallback(async () => {
    if (!pendingDeleteTeam) return;
    const teamId = pendingDeleteTeam.id;
    const targetDate = pendingDeleteTeam.date;
    setPendingDeleteTeam(null);
    // Remove from local state immediately so the UI reflects the deletion right away
    dispatch({ type: 'REMOVE_TEAM', teamId });
    // Delete the schedule for this SPECIFIC DAY
    const { data: daySched } = await supabase
      .from('schedules').select('id').eq('team_id', teamId).eq('schedule_date', targetDate).maybeSingle();
    if (daySched) {
      await supabase.from('schedule_jobs').delete().eq('schedule_id', daySched.id);
      await supabase.from('schedules').delete().eq('id', daySched.id);
    }
    // Also clean up any empty schedule rows (zero jobs) for this team in the week
    // These may have been created by autosave when the team was visible but had no clients
    const { data: weekScheds } = await supabase
      .from('schedules').select('id').eq('team_id', teamId).in('schedule_date', weekDates);
    if (weekScheds) {
      for (const s of weekScheds) {
        const { count } = await supabase
          .from('schedule_jobs').select('id', { count: 'exact', head: true }).eq('schedule_id', s.id);
        if (!count || count === 0) {
          await supabase.from('schedules').delete().eq('id', s.id);
        }
      }
    }
    // Reload week to refresh
    loadWeekSchedules(weekDates);
  }, [supabase, pendingDeleteTeam, weekDates, loadWeekSchedules]);

  // ─── Week template loading ───
  const handleLoadWeekTemplate = useCallback(async (weekData: Record<string, { teamName: string; teamId: string; dayStartTime?: string; breaks?: { afterClientIndex: number; durationMinutes: number; label: string }[]; clients: Client[] }[]>) => {
    // First save any pending day edits
    if (daySaveRef.current) await daySaveRef.current();

    if (!orgId) return;

    // Use ALL org teams (not just the week-view subset in state.teams)
    const allTeams = allOrgTeamsRef.current.length > 0 ? allOrgTeamsRef.current : state.teams;

    // Build a stable team lookup: name → team, id → team
    const teamByName = new Map(allTeams.map(t => [t.name, t]));
    const teamById   = new Map(allTeams.map(t => [t.id,   t]));

    // Cache of template teamName → actual DB team (created lazily if no match)
    const resolvedTeams = new Map<string, typeof allTeams[0]>();

    // Resolve or create a DB team for each unique template team name
    const collectTemplateTeams = () => {
      const names = new Set<string>();
      for (let i = 0; i < 7; i++) {
        for (const tt of weekData[String(i)] || []) names.add(tt.teamName);
      }
      return names;
    };

    for (const teamName of collectTemplateTeams()) {
      // Match: name first, then saved teamId, else the first unresolved real team
      const matched = teamByName.get(teamName)
        ?? [...teamById.values()].find(t => !resolvedTeams.has(t.name) && !teamByName.has(teamName))
        ?? null;

      if (matched) {
        resolvedTeams.set(teamName, matched);
      } else {
        // No match — create a brand-new DB team so data isn't lost on Team 1
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
            hourlyRate: 38, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
          };
          resolvedTeams.set(teamName, t as typeof allTeams[0]);
          allOrgTeamsRef.current = [...allOrgTeamsRef.current, t as typeof allTeams[0]];
        }
      }
    }

    // For each day in the template, write clients+breaks into the DB
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const dayTeams = weekData[String(dayIdx)];
      if (!dayTeams || dayTeams.length === 0) continue;

      const date = weekDates[dayIdx];

      for (const templateTeam of dayTeams) {
        const matchedTeam = resolvedTeams.get(templateTeam.teamName);
        if (!matchedTeam) continue;

        // Restore dayStartTime from template if present
        if (templateTeam.dayStartTime) {
          await supabase.from('teams').update({ day_start_time: templateTeam.dayStartTime }).eq('id', matchedTeam.id);
        }

        // Ensure schedule row exists
        let scheduleId: string;
        const { data: existing } = await supabase
          .from('schedules').select('id').eq('team_id', matchedTeam.id).eq('schedule_date', date).maybeSingle();
        if (existing) {
          scheduleId = existing.id;
        } else {
          const { data: created } = await supabase
            .from('schedules').insert({ org_id: orgId, team_id: matchedTeam.id, schedule_date: date }).select('id').single();
          if (!created) continue;
          scheduleId = created.id;
        }

        // Wipe and rewrite jobs for this schedule
        await supabase.from('schedule_jobs').delete().eq('schedule_id', scheduleId);

        const rows: Record<string, unknown>[] = [];
        let position = 0;

        if (templateTeam.clients.length > 0) {
          // Map break indices for fast lookup
          const breakByIndex = new Map<number, { durationMinutes: number; label: string }>();
          for (const b of templateTeam.breaks || []) {
            breakByIndex.set(b.afterClientIndex, { durationMinutes: b.durationMinutes, label: b.label });
          }

          // We need to know the DB job IDs for client rows so breaks can reference them.
          // Strategy: insert clients first (collect their IDs), then insert break rows.
          const clientRows: Record<string, unknown>[] = [];
          for (let ci = 0; ci < templateTeam.clients.length; ci++) {
            const c = templateTeam.clients[ci] as Client;
            clientRows.push({
              schedule_id: scheduleId, org_id: orgId, client_id: c.savedClientId || null,
              position: ci, name: c.name, address: c.location?.address || '',
              lat: c.location?.lat || 0, lng: c.location?.lng || 0,
              place_id: c.location?.placeId || null,
              duration_minutes: c.jobDurationMinutes || 90,
              staff_count: c.staffCount || 1,
              is_locked: c.isLocked || false, is_break: false,
              notes: c.notes || '',
              assigned_staff_ids: c.assignedStaffIds || [],
              fixed_start_time: c.fixedStartTime || null,
            });
          }

          let insertedClientIds: string[] = [];
          if (clientRows.length > 0) {
            const { data: inserted } = await supabase.from('schedule_jobs').insert(clientRows).select('id');
            insertedClientIds = (inserted || []).map((r: { id: string }) => r.id);
          }

          // Insert break rows — reference the inserted client's DB id via afterClientId in notes
          const breakRows: Record<string, unknown>[] = [];
          position = clientRows.length;
          for (const [clientIdx, breakData] of breakByIndex) {
            const afterClientId = insertedClientIds[clientIdx] || '';
            breakRows.push({
              schedule_id: scheduleId, org_id: orgId, client_id: null,
              position: position++,
              name: breakData.label || 'Break',
              address: '', lat: 0, lng: 0, place_id: null,
              duration_minutes: breakData.durationMinutes,
              staff_count: 1, is_locked: false, is_break: true,
              // Store afterClientId so the break-load logic can resolve it by UUID
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

          rows; // (unused — kept for reference)
        }
      }
    }

    // Reload the week to pick up all changes
    await loadWeekSchedules(weekDates);
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
          <div className="flex items-center justify-between h-14">
            {/* Date navigation */}
            <div className="flex items-center gap-2">
              {state.viewMode === 'day' && (
                <button onClick={handleBackToWeek} className="btn-ghost text-xs mr-1" title="Back to week view">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                  Week
                </button>
              )}
              <button onClick={state.viewMode === 'day' ? goToPrevDay : goToPrevWeek} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <span className="text-sm font-semibold text-text-primary min-w-[180px] text-center">
                {state.viewMode === 'day' ? dayLabel : weekLabel}
              </span>
              <button onClick={state.viewMode === 'day' ? goToNextDay : goToNextWeek} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              {/* View mode toggle */}
              <div className="hidden sm:flex items-center gap-0.5 bg-surface-elevated rounded-lg p-0.5">
                <button
                  onClick={handleBackToWeek}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${state.viewMode === 'week' ? 'bg-white shadow-card text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                >Week</button>
                <button
                  onClick={() => { dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' }); loadDayForEdit(state.focusedDate); }}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${state.viewMode === 'day' ? 'bg-white shadow-card text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                >Day</button>
              </div>

              <button onClick={() => setShowMonth(true)} className="btn-ghost text-xs" title="Month view">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </button>

              {state.viewMode === 'week' && !isStaff && (
                <>
                  <button onClick={() => setShowSaveTemplate(true)} className="btn-ghost text-xs" title="Save week as template">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    Save
                  </button>
                  <button onClick={() => setShowLoadTemplate(true)} className="btn-ghost text-xs" title="Load week template">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Load
                  </button>
                  <button onClick={() => setShowClearWeek(true)} className="btn-ghost text-xs text-danger hover:bg-red-50" title="Clear all jobs from this week">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    Clear
                  </button>
                </>
              )}


              {state.viewMode === 'week' && !isStaff && (
                <div className="flex items-center gap-1.5">
                  {weekIsPublished ? (
                    <button
                      onClick={handleUnpublishWeek}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-success-light text-success hover:bg-red-50 hover:text-red-600 group"
                    >
                      <span className="group-hover:hidden">✓ Published</span>
                      <span className="hidden group-hover:inline">Unpublish</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePublishWeek}
                      disabled={!weekHasJobs}
                      title={!weekHasJobs ? 'Add jobs before publishing' : ''}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        !weekHasJobs
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : weekPartiallyPublished
                            ? 'bg-amber-50 text-amber-700 hover:bg-primary hover:text-white'
                            : 'bg-primary text-white hover:bg-primary-hover'
                      }`}
                    >
                      {weekPartiallyPublished ? 'Partially Published' : 'Publish Week'}
                    </button>
                  )}

                  {/* Published Weeks button */}
                  <button
                    onClick={() => setShowPublishedWeeks(true)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors bg-surface-elevated text-text-secondary hover:bg-surface-hover flex items-center gap-1.5"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    Published Weeks
                    {publishHistory.length > 0 && (
                      <span className="bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full">{publishHistory.length}</span>
                    )}
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
                teamStaffMap={teamStaffMap}
              />
            </div>
          )}
        </header>

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
                <p className="text-sm text-text-tertiary mt-1 max-w-xs">Switch to Day view to start building your schedule, or load a saved template.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' }); loadDayForEdit(state.focusedDate); }}
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
            />
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
            title={`Clear ${pendingDeleteTeam.name} on ${new Date(pendingDeleteTeam.date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' })}?`}
            message={
              pendingDeleteTeam.dayJobCount > 0
                ? `This will remove ${pendingDeleteTeam.dayJobCount} scheduled job${pendingDeleteTeam.dayJobCount !== 1 ? 's' : ''} for ${pendingDeleteTeam.name} on this day only. All other days remain unaffected.`
                : `This will clear ${pendingDeleteTeam.name} from this day. All other days remain unaffected.`
            }
            confirmLabel="Clear This Day"
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

    </APIProvider>
  );
}
