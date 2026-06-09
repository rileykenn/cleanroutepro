'use client';

import { useReducer, useEffect, useMemo, useState, useCallback, useRef, use } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { motion, AnimatePresence } from 'framer-motion';

import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';

import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { getWeekDates } from '@/lib/timeUtils';
import { TravelSegment, Client, TeamSchedule, TEAM_COLORS, DaySchedule, StaffMember, getNextColorIndex, Location as AppLocation } from '@/lib/types';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { generateId } from '@/lib/timeUtils';
import { SavedClient } from '@/lib/hooks/useClients';
import { calculateScheduleTimes } from '@/lib/routeEngine';
import { computeDayWarnings } from '@/lib/scheduleWarnings';

import TeamTabs from '@/components/TeamTabs';
import WeekView from '@/components/WeekView';
import WeekClientSidebar from '@/components/WeekClientSidebar';
import DayEditor from '@/components/DayEditor';
import { useRouter } from 'next/navigation';

// ─── Delete drop zone (same as main scheduler) ────────────────────────────────
function DeleteZone() {
  const { isOver, setNodeRef } = useDroppable({ id: 'delete-zone' });
  return (
    <motion.div
      ref={setNodeRef}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className={`fixed bottom-20 lg:bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-8 py-4 rounded-2xl border-2 transition-colors duration-100 ${
        isOver
          ? 'bg-red-500 border-red-400 shadow-[0_0_40px_rgba(239,68,68,0.5)]'
          : 'bg-white/95 border-red-300 backdrop-blur-xl shadow-xl'
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke={isOver ? 'white' : '#ef4444'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Reference week: a fixed Monday so day-based components work with real ISO dates
const REFERENCE_MONDAY = '2024-01-01'; // This is a Monday

interface TeamTemplateData {
  teamName: string;
  teamId: string;
  dayStartTime?: string;
  baseAddress?: AppLocation | null;
  returnAddress?: AppLocation | string | null;
  staffIds?: string[];
  driverStaffId?: string | null;
  breaks?: { afterClientIndex: number; durationMinutes: number; label: string }[];
  clients: Partial<Client>[];
}

interface WeekTemplateData {
  [dayIndex: string]: TeamTemplateData[];
}

interface ScheduleTemplate {
  id: string;
  name: string;
  label: string | null;
  week_data: WeekTemplateData;
  created_at: string;
}

export default function ScheduleTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: templateId } = use(params);
  const isNew = templateId === 'new';

  const [state, dispatch] = useReducer(scheduleReducer, null, createInitialState);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateLabel, setTemplateLabel] = useState<string | null>(null);
  const [existingTemplateId, setExistingTemplateId] = useState<string | null>(isNew ? null : templateId);
  const existingTemplateIdRef = useRef<string | null>(isNew ? null : templateId);
  const [activeDragClient, setActiveDragClient] = useState<SavedClient | null>(null);
  const [activeDragJob, setActiveDragJob] = useState<Client | null>(null);
  const isInitialLoadRef = useRef(true);

  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id || null;
  const router = useRouter();

  // ── DnD sensors (same settings as main scheduler) ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const allOrgTeamsRef = useRef<TeamSchedule[]>([]);

  // Reference week dates: Mon Jan 1 2024 → Sun Jan 7 2024
  const weekDates = useMemo(() => getWeekDates(REFERENCE_MONDAY), []);

  // ── Week cache: day index (0-6) → teams state for that day ──
  const weekCacheRef = useRef<Map<number, TeamSchedule[]>>(new Map());

  // Restore day index + view mode from localStorage so refresh lands on the right day
  const storageKey = `crp_template_view_${templateId}`;
  const [currentDayIndex, setCurrentDayIndex] = useState(() => {
    try {
      const s = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      return s ? (JSON.parse(s).dayIndex ?? 0) : 0;
    } catch { return 0; }
  });

  const activeTeamIdRef = useRef(state.activeTeamId);
  activeTeamIdRef.current = state.activeTeamId;

  // Always-current refs for state used inside handleSave (avoids stale-closure bugs)
  const stateTeamsRef = useRef(state.teams);
  stateTeamsRef.current = state.teams;
  const currentDayIndexRef = useRef(currentDayIndex);
  currentDayIndexRef.current = currentDayIndex;

  // Persist view mode + day index — only after the template is fully loaded
  // so the initial render's viewMode='week' (from the wrong localStorage key) doesn't
  // overwrite the stored 'day' value before the async init reads it.
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ dayIndex: currentDayIndex, viewMode: state.viewMode }));
    } catch { /* ignore */ }
  }, [loaded, currentDayIndex, state.viewMode, storageKey]);

  // Helper: read stored viewMode for this template
  const getStoredViewMode = useCallback((): 'day' | 'week' => {
    try {
      const s = localStorage.getItem(storageKey);
      if (!s) return 'week';
      const { viewMode } = JSON.parse(s);
      return viewMode === 'day' ? 'day' : 'week';
    } catch { return 'week'; }
  }, [storageKey]);

  // ── Load org teams ──
  const loadOrgTeams = useCallback(async (): Promise<TeamSchedule[]> => {
    if (!orgId) return [];
    const { data: dbTeams } = await supabase
      .from('teams').select('*').eq('org_id', orgId).order('sort_order');
    if (!dbTeams || dbTeams.length === 0) return [];
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
      fuelEfficiency: Number(row.fuel_efficiency) || 10,
      fuelPrice: Number(row.fuel_price) || 1.85,
      perKmRate: Number(row.per_km_rate) || 0,
      staffIds: [],
      driverStaffId: null,
    }));
    allOrgTeamsRef.current = teams;
    return teams;
  }, [orgId, supabase]);

  // ── Load staff ──
  useEffect(() => {
    if (!orgId) return;
    supabase.from('staff_members').select('id, name, role, hourly_rate, available_days')
      .eq('org_id', orgId).order('name')
      .then(({ data }: { data: StaffMember[] | null }) => { if (data) setAllStaff(data); });
  }, [orgId, supabase]);

  // ── Initialize: load org teams + template data ──
  // ── Helper: run calculateScheduleTimes on every day in the week cache ──
  const applyTimesToCache = useCallback(() => {
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const dayTeams = weekCacheRef.current.get(dayIdx);
      if (!dayTeams) continue;
      const updated = dayTeams.map(team => {
        if (team.clients.length === 0) return team;
        const { clients: timedClients } = calculateScheduleTimes(team);
        return { ...team, clients: timedClients };
      });
      weekCacheRef.current.set(dayIdx, updated);
    }
  }, []);

  useEffect(() => {
    if (!orgId || loaded) return;
    (async () => {

      if (isNew) {
        // New template: create one completely fresh standalone team.
        // Templates have nothing to do with the org's stored team records —
        // teams are ad-hoc groupings that change week to week.
        const starterTeam: TeamSchedule = {
          id: generateId(),
          name: 'Team 1',
          color: TEAM_COLORS[0],
          colorIndex: 0,
          baseAddress: null,
          returnAddress: null,
          clients: [],
          travelSegments: new Map<string, TravelSegment>(),
          dayStartTime: '08:00',
          breaks: [],
          hourlyRate: 38,
          calculateFuel: false,
          fuelEfficiency: 10,
          fuelPrice: 1.85,
          perKmRate: 0,
          staffIds: [],
          driverStaffId: null,
        };
        const starterTeams = [starterTeam];
        for (let i = 0; i < 7; i++) {
          weekCacheRef.current.set(i, [{ ...starterTeam, travelSegments: new Map<string, TravelSegment>() }]);
        }
        dispatch({ type: 'LOAD_STATE', teams: starterTeams, activeTeamId: starterTeam.id, selectedDate: weekDates[0] });
        const storedMode = getStoredViewMode();
        if (storedMode === 'day') dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' });
        isInitialLoadRef.current = false;
        setLoaded(true);
        return;
      }

      const orgTeams = await loadOrgTeams();

      // Edit existing: load template data
      const { data: templateData } = await supabase
        .from('schedule_templates').select('*').eq('id', templateId).single();

      if (!templateData) { setLoaded(true); return; }

      const template = templateData as ScheduleTemplate;
      setTemplateName(template.name);
      setTemplateLabel(template.label);
      const weekData = template.week_data || {};

      // ── Build team list from what's actually saved in the template ──
      // Teams created in the editor (via Add Team) have generated UUIDs that don't exist
      // in orgTeams — we must reconstruct them from week_data metadata, not silently drop them.
      const templateTeamIds = new Set<string>();
      // Collect per-teamId metadata from the first day that has data for it
      const teamMetaMap = new Map<string, TeamTemplateData>();
      for (const dayTeamsData of Object.values(weekData)) {
        for (const tt of (dayTeamsData as TeamTemplateData[])) {
          if (tt.teamId && !teamMetaMap.has(tt.teamId)) teamMetaMap.set(tt.teamId, tt);
          if (tt.teamId) templateTeamIds.add(tt.teamId);
        }
      }

      const orgTeamMap = new Map(orgTeams.map(t => [t.id, t]));

      // Build ordered team list: real org team if found, otherwise synthetic from saved metadata
      const templateTeams: TeamSchedule[] = templateTeamIds.size > 0
        ? Array.from(templateTeamIds).map((teamId, idx) => {
            const orgTeam = orgTeamMap.get(teamId);
            if (orgTeam) return orgTeam;
            // Template-only team — reconstruct from saved metadata
            const meta = teamMetaMap.get(teamId);
            const colorIndex = idx % TEAM_COLORS.length;
            return {
              id: teamId,
              name: meta?.teamName || `Team ${idx + 1}`,
              color: TEAM_COLORS[colorIndex],
              colorIndex,
              baseAddress: (meta?.baseAddress as AppLocation | null) ?? null,
              returnAddress: null,
              clients: [],
              travelSegments: new Map<string, TravelSegment>(),
              dayStartTime: meta?.dayStartTime || '08:00',
              breaks: [],
              hourlyRate: 38,
              calculateFuel: false,
              fuelEfficiency: 10,
              fuelPrice: 1.85,
              perKmRate: 0,
              staffIds: meta?.staffIds ?? [],
              driverStaffId: meta?.driverStaffId ?? null,
            } as TeamSchedule;
          })
        : orgTeams;

      // Build week cache — 7 days
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayTeamsData: TeamTemplateData[] = weekData[String(dayIdx)] || [];

        const dayTeams: TeamSchedule[] = templateTeams.map(orgTeam => {
          const templateTeam = dayTeamsData.find(
            tt => tt.teamId === orgTeam.id || tt.teamName === orgTeam.name
          );

          if (!templateTeam || !templateTeam.clients || templateTeam.clients.length === 0) {
            return { ...orgTeam, clients: [], travelSegments: new Map<string, TravelSegment>(), breaks: [] as typeof orgTeam.breaks };
          }

          const clients: Client[] = templateTeam.clients.map((c: Partial<Client>): Client => ({
            id: generateId(),
            name: c.name || '',
            location: c.location || { address: '', lat: 0, lng: 0 },
            jobDurationMinutes: c.jobDurationMinutes || 90,
            staffCount: c.staffCount || 1,
            isLocked: c.isLocked || false,
            fixedStartTime: c.fixedStartTime,
            savedClientId: c.savedClientId,
            notes: c.notes,
            assignedStaffIds: c.assignedStaffIds || [],
            checklistId: (c as any).checklistId,
          }));

          const breaks = (templateTeam.breaks || [])
            .map((b: { afterClientIndex: number; durationMinutes: number; label: string }) => {
              const afterClient = clients[b.afterClientIndex];
              if (!afterClient) return null;
              return { id: generateId(), afterClientId: afterClient.id, durationMinutes: b.durationMinutes, label: b.label };
            })
            .filter(Boolean) as typeof orgTeam.breaks;

          return {
            ...orgTeam,
            dayStartTime: templateTeam.dayStartTime || orgTeam.dayStartTime,
            baseAddress: templateTeam.baseAddress !== undefined ? templateTeam.baseAddress : orgTeam.baseAddress,
            // Restore staff/driver assignments saved in the template
            staffIds: templateTeam.staffIds ?? orgTeam.staffIds ?? [],
            driverStaffId: templateTeam.driverStaffId ?? orgTeam.driverStaffId ?? null,
            clients,
            travelSegments: new Map<string, TravelSegment>(),
            breaks,
          };
        });

        weekCacheRef.current.set(dayIdx, dayTeams);
      }

      // Apply time calculations to all days so week view shows times immediately
      applyTimesToCache();

      const mondayTeams = weekCacheRef.current.get(0) || templateTeams.map(t => ({
        ...t, clients: [], travelSegments: new Map<string, TravelSegment>(), breaks: [] as typeof t.breaks,
      }));
      dispatch({
        type: 'LOAD_STATE',
        teams: mondayTeams,
        activeTeamId: mondayTeams.find(t => t.id === activeTeamIdRef.current)?.id || mondayTeams[0].id,
        selectedDate: weekDates[0],
      });
      // Restore the view the user was on before refresh (day or week)
      const storedMode = getStoredViewMode();
      if (storedMode === 'day') dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' });
      isInitialLoadRef.current = false;
      setLoaded(true);
    })();
  }, [orgId, loaded, isNew, templateId, supabase, loadOrgTeams, weekDates, applyTimesToCache, getStoredViewMode]);

  // ── Save current day to cache before switching ──
  const saveDayToCache = useCallback(() => {
    weekCacheRef.current.set(currentDayIndex, state.teams.map(t => ({
      ...t,
      travelSegments: new Map(t.travelSegments),
    })));
  }, [currentDayIndex, state.teams]);

  // ── Switch to a different day ──
  const switchToDay = useCallback((dayIdx: number) => {
    if (dayIdx === currentDayIndex) return;
    
    // Save current state to cache
    saveDayToCache();

    // Load target day from cache
    const cachedTeams = weekCacheRef.current.get(dayIdx);
    const teams = cachedTeams || allOrgTeamsRef.current.map(t => ({
      ...t, clients: [], travelSegments: new Map<string, TravelSegment>(), breaks: [] as typeof t.breaks,
    }));

    dispatch({
      type: 'LOAD_STATE',
      teams,
      activeTeamId: teams.find(t => t.id === activeTeamIdRef.current)?.id || teams[0].id,
      selectedDate: weekDates[dayIdx],
    });
    setCurrentDayIndex(dayIdx);
  }, [currentDayIndex, saveDayToCache, weekDates]);

  // ── Serialize current state to week_data format ──
  const serializeWeekData = useCallback((): WeekTemplateData => {
    // Ensure current day is saved to cache
    saveDayToCache();

    const weekData: WeekTemplateData = {};

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const dayTeams = weekCacheRef.current.get(dayIdx);
      if (!dayTeams) continue;

      const dayTeamsData: TeamTemplateData[] = [];

      for (const team of dayTeams) {
        // Convert breaks: afterClientId → afterClientIndex
        const breaks = team.breaks
          .map(b => {
            const idx = team.clients.findIndex(c => c.id === b.afterClientId);
            return idx >= 0 ? { afterClientIndex: idx, durationMinutes: b.durationMinutes, label: b.label } : null;
          })
          .filter(Boolean) as { afterClientIndex: number; durationMinutes: number; label: string }[];

        // Always save the team (even if empty) so it survives a reload.
        // The teamId is what keeps empty teams alive across save/load cycles.
        dayTeamsData.push({
          teamName: team.name,
          teamId: team.id,
          dayStartTime: team.dayStartTime,
          baseAddress: team.baseAddress,
          staffIds: team.staffIds || [],
          driverStaffId: team.driverStaffId || null,
          breaks,
          clients: team.clients.map(c => ({
            name: c.name,
            location: c.location,
            jobDurationMinutes: c.jobDurationMinutes,
            staffCount: c.staffCount,
            isLocked: c.isLocked,
            fixedStartTime: c.fixedStartTime,
            savedClientId: c.savedClientId,
            notes: c.notes,
            assignedStaffIds: c.assignedStaffIds,
            checklistId: c.checklistId,
          })),
        });
      }

      // Always write this day so team presence is preserved
      if (dayTeamsData.length > 0) {
        weekData[String(dayIdx)] = dayTeamsData;
      }
    }

    return weekData;
  }, [saveDayToCache]);

  // ── Shared persist function (used by both manual save and autosave) ──
  const persistTemplate = useCallback(async (name: string, label: string | null, weekData: WeekTemplateData) => {
    if (!orgId || !name.trim()) {
      console.warn('[Template Save] Bailing — orgId:', orgId, 'name:', name);
      return;
    }
    const currentId = existingTemplateIdRef.current;
    console.log('[Template Save] Saving id:', currentId, 'weekData keys:', Object.keys(weekData), 'sample day0:', weekData['0']);
    if (currentId) {
      const { error } = await supabase.from('schedule_templates')
        .update({ name: name.trim(), label, week_data: weekData })
        .eq('id', currentId);
      if (error) console.error('[Template Save] Supabase update error:', error);
      else console.log('[Template Save] Update OK');
    } else {
      const { data, error } = await supabase.from('schedule_templates')
        .insert({ org_id: orgId, name: name.trim(), label, week_data: weekData })
        .select('id').single();
      if (error) console.error('[Template Save] Supabase insert error:', error);
      if (data) {
        existingTemplateIdRef.current = data.id;
        setExistingTemplateId(data.id);
        console.log('[Template Save] Insert OK, new id:', data.id);
      }
    }
  }, [orgId, supabase]);

  // ── Manual save — reads live values via refs, no stale-closure risk ──
  const handleSave = useCallback(async () => {
    // Read live values from refs so we always save the latest state regardless
    // of when the useCallback was last recreated.
    const liveTeams = stateTeamsRef.current;
    const liveDayIndex = currentDayIndexRef.current;

    console.log('[Save] clicked — orgId:', orgId, 'templateName:', templateName, 'existingId:', existingTemplateIdRef.current, 'liveDayIndex:', liveDayIndex, 'liveTeams:', liveTeams.length);
    if (!orgId || !templateName.trim()) {
      console.warn('[Save] bailing early — missing orgId or templateName');
      return;
    }
    setSaving(true); setSaved(false);

    try {
      // 1. Flush the currently-viewed day into the cache using LIVE values
      weekCacheRef.current.set(
        liveDayIndex,
        liveTeams.map(t => ({ ...t, travelSegments: new Map(t.travelSegments) }))
      );

      // 2. Build week_data directly from the cache
      const weekData: WeekTemplateData = {};
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayTeams = weekCacheRef.current.get(dayIdx);
        if (!dayTeams || dayTeams.length === 0) continue;
        const dayTeamsData: TeamTemplateData[] = dayTeams.map(team => {
          const breaks = team.breaks
            .map(b => {
              const idx = team.clients.findIndex(c => c.id === b.afterClientId);
              return idx >= 0 ? { afterClientIndex: idx, durationMinutes: b.durationMinutes, label: b.label } : null;
            })
            .filter(Boolean) as { afterClientIndex: number; durationMinutes: number; label: string }[];
          return {
            teamName: team.name,
            teamId: team.id,
            dayStartTime: team.dayStartTime,
            baseAddress: team.baseAddress,
            returnAddress: team.returnAddress,
            staffIds: team.staffIds || [],
            driverStaffId: team.driverStaffId || null,
            breaks,
            clients: team.clients.map(c => ({
              name: c.name,
              location: c.location,
              jobDurationMinutes: c.jobDurationMinutes,
              staffCount: c.staffCount,
              isLocked: c.isLocked,
              fixedStartTime: c.fixedStartTime,
              savedClientId: c.savedClientId,
              notes: c.notes,
              assignedStaffIds: c.assignedStaffIds,
              checklistId: (c as any).checklistId,
            })),
          };
        });
        weekData[String(dayIdx)] = dayTeamsData;
      }

      // Debug: log all days that have clients
      for (let d = 0; d < 7; d++) {
        const dt = weekData[String(d)];
        if (dt) {
          dt.forEach((t, ti) => {
            if (t.clients.length > 0) console.log(`[Save] day${d} team${ti} (${t.teamName}): ${t.clients.length} clients`);
          });
        }
      }

      // 3. Persist to Supabase
      const currentId = existingTemplateIdRef.current;
      if (currentId) {
        const { error } = await supabase
          .from('schedule_templates')
          .update({ name: templateName.trim(), label: templateLabel, week_data: weekData })
          .eq('id', currentId);
        if (error) { console.error('[Save] update error:', error); }
        else { console.log('[Save] update OK for id:', currentId); }
      } else {
        const { data, error } = await supabase
          .from('schedule_templates')
          .insert({ org_id: orgId, name: templateName.trim(), label: templateLabel, week_data: weekData })
          .select('id').single();
        if (error) { console.error('[Save] insert error:', error); }
        if (data) {
          existingTemplateIdRef.current = data.id;
          setExistingTemplateId(data.id);
          console.log('[Save] insert OK, new id:', data.id);
          // Replace the URL so refreshing loads this template instead of a blank /new editor
          router.replace(`/dashboard/templates/schedule/${data.id}`);
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[Save] Unexpected error:', err);
    } finally {
      setSaving(false);
    }
  // Only recreate when identity-level deps change; live state is read via refs above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, templateName, templateLabel, supabase]);

  // ── Build week schedules map for WeekView ──
  // Iterate state.teams (teams actually in this template) not allOrgTeamsRef
  const templateWeekSchedules = useMemo(() => {
    const currentCache = new Map(weekCacheRef.current);
    currentCache.set(currentDayIndex, state.teams);

    const allTeamMaps = new Map<string, Map<string, DaySchedule>>();

    for (const team of state.teams) {
      const teamMap = new Map<string, DaySchedule>();
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const date = weekDates[dayIdx];
        const dayTeams = currentCache.get(dayIdx) || [];
        const teamData = dayTeams.find(t => t.id === team.id);
        teamMap.set(date, {
          date,
          dayOfWeek: DAY_LABELS[dayIdx].substring(0, 3),
          scheduleId: null,
          clients: teamData?.clients || [],
          breaks: teamData?.breaks || [],
          isPublished: false,
        });
      }
      allTeamMaps.set(team.id, teamMap);
    }
    return allTeamMaps;
  }, [state.teams, currentDayIndex, weekDates]);


  // ── Per-day warnings for week view ──
  // staffIds/driverStaffId come from weekCacheRef (full TeamSchedule) not from
  // templateWeekSchedules (DaySchedule — which never stores those fields).
  // For the active day we use live reducer state so immediate edits reflect at once.
  const weekDayWarnings = useMemo(() => {
    const result = new Map<string, ReturnType<typeof computeDayWarnings>>();
    if (state.teams.length === 0) return result;
    const liveTeamMap = new Map(state.teams.map(t => [t.id, t]));

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const date = weekDates[dayIdx];
      const isActiveDate = dayIdx === currentDayIndex;

      // Source of truth for this day's full team data:
      // - active day  → live reducer state (reflects unsaved edits immediately)
      // - other days  → weekCacheRef (has staffIds / driverStaffId from load/save)
      const cachedDayTeams = isActiveDate
        ? state.teams
        : (weekCacheRef.current.get(dayIdx) || state.teams);

      const teamsForDay: TeamSchedule[] = cachedDayTeams.map(cachedTeam => {
        const liveTeam = isActiveDate ? liveTeamMap.get(cachedTeam.id) : undefined;
        return {
          ...cachedTeam,
          staffIds: liveTeam?.staffIds ?? cachedTeam.staffIds ?? [],
          driverStaffId: liveTeam?.driverStaffId ?? cachedTeam.driverStaffId ?? null,
          travelSegments: new Map(),
        };
      });

      if (teamsForDay.some(t => t.clients.length > 0)) {
        result.set(date, computeDayWarnings(teamsForDay, allStaff));
      }
    }
    return result;
  }, [weekDates, allStaff, state.teams, currentDayIndex]);

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

  // ── Day schedules for single-team WeekView ──
  const activeTeamWeekSchedules = useMemo(() => {
    const teamMap = templateWeekSchedules.get(state.activeTeamId);
    return teamMap || new Map<string, DaySchedule>();
  }, [templateWeekSchedules, state.activeTeamId]);

  // Total job count across entire template
  const totalJobs = useMemo(() => {
    let count = 0;
    const allCache = new Map(weekCacheRef.current);
    allCache.set(currentDayIndex, state.teams);
    for (const [, teams] of allCache) {
      for (const team of teams) {
        count += team.clients.length;
      }
    }
    return count;
  }, [state.teams, currentDayIndex]);

  // ── Drag handlers (cache-only — no DB writes, template saved manually) ──
  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === 'job') {
      setActiveDragJob(data.job as Client);
    } else {
      setActiveDragClient(data?.client || null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const dragType = active.data.current?.type;

    // ── Job card drag: move between days or delete ──
    if (dragType === 'job') {
      setActiveDragJob(null);
      const jobData = active.data.current?.job as Client;
      const fromDate = active.data.current?.date as string;
      const fromDayIdx = weekDates.indexOf(fromDate);
      // teamId is set by WeekDayColumn when in all-teams mode; fall back to activeTeamId
      const jobTeamId = (active.data.current?.teamId as string | undefined) || state.activeTeamId;

      if (over?.id === 'delete-zone') {
        console.log('[Delete] over.id:', over?.id, 'jobTeamId:', jobTeamId, 'fromDayIdx:', fromDayIdx, 'cacheForDay:', weekCacheRef.current.get(fromDayIdx)?.map(t => ({ id: t.id, clients: t.clients.length })));
        const srcForDelete = (weekCacheRef.current.get(fromDayIdx) || state.teams).map(t =>
          t.id === jobTeamId
            ? { ...t, clients: t.clients.filter(c => c.id !== jobData.id) }
            : t
        );
        weekCacheRef.current.set(fromDayIdx, srcForDelete);
        // Always dispatch so the useMemo recomputes from the updated cache.
        // If this is the current day use the filtered teams; otherwise keep state.teams unchanged
        // but still dispatch so the reducer returns a new object and forces a re-render.
        dispatch({
          type: 'LOAD_STATE',
          teams: fromDayIdx === currentDayIndex ? srcForDelete : state.teams,
          activeTeamId: state.activeTeamId,
          selectedDate: state.selectedDate,
        });
        return;
      }

      if (!over) return;
      const targetDate = over.id as string;
      if (targetDate === fromDate) return;
      const targetDayIdx = weekDates.indexOf(targetDate);
      if (targetDayIdx < 0) return;

      // Move: remove from source team, add to same team on target day
      const movedJob = { ...jobData, startTime: undefined, endTime: undefined };

      const srcTeams = (weekCacheRef.current.get(fromDayIdx) || state.teams).map(t =>
        t.id === jobTeamId
          ? { ...t, clients: t.clients.filter(c => c.id !== jobData.id) }
          : t
      );
      const tgtTeams = (weekCacheRef.current.get(targetDayIdx) || state.teams).map(t =>
        t.id === jobTeamId
          ? { ...t, clients: [...t.clients, movedJob] }
          : t
      );

      weekCacheRef.current.set(fromDayIdx, srcTeams);
      weekCacheRef.current.set(targetDayIdx, tgtTeams);

      // Always dispatch to force useMemo recompute; use the correct teams for the current day
      const currentDayTeamsAfterMove =
        fromDayIdx === currentDayIndex ? srcTeams :
        targetDayIdx === currentDayIndex ? tgtTeams :
        state.teams;
      dispatch({ type: 'LOAD_STATE', teams: currentDayTeamsAfterMove, activeTeamId: state.activeTeamId, selectedDate: state.selectedDate });
      return;
    }

    // ── Client sidebar drag: add to a day ──
    setActiveDragClient(null);
    if (!over) return;
    const targetDate = over.id as string;
    const clientData = active.data.current?.client as SavedClient;
    if (!clientData || !targetDate) return;
    const targetDayIdx = weekDates.indexOf(targetDate);
    if (targetDayIdx < 0) return;
    // In all-teams mode fall back to the first team in the day; otherwise use activeTeamId
    const dropTeamId = state.activeTeamId === 'all'
      ? (weekCacheRef.current.get(targetDayIdx) || state.teams)[0]?.id || state.teams[0]?.id
      : state.activeTeamId;
    if (!dropTeamId) return;

    const newClient: Client = {
      id: generateId(),
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

    const dayTeams = (weekCacheRef.current.get(targetDayIdx) || state.teams).map(t =>
      t.id === dropTeamId
        ? { ...t, clients: [...t.clients, newClient] }
        : t
    );
    weekCacheRef.current.set(targetDayIdx, dayTeams);

    // Always dispatch so useMemo recomputes from the updated cache
    dispatch({
      type: 'LOAD_STATE',
      teams: targetDayIdx === currentDayIndex ? dayTeams : state.teams,
      activeTeamId: state.activeTeamId,
      selectedDate: state.selectedDate,
    });
  };

  // ── Handle day click from week view ──
  const handleDayClick = useCallback((date: string) => {
    const dayIdx = weekDates.indexOf(date);
    if (dayIdx >= 0) {
      dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' });
      switchToDay(dayIdx);
    }
  }, [weekDates, switchToDay]);

  const handleBackToWeek = useCallback(() => {
    saveDayToCache();
    dispatch({ type: 'SET_VIEW_MODE', viewMode: 'week' });
  }, [saveDayToCache]);

  const handlePrevDay = useCallback(() => {
    if (currentDayIndex > 0) switchToDay(currentDayIndex - 1);
  }, [currentDayIndex, switchToDay]);

  const handleNextDay = useCallback(() => {
    if (currentDayIndex < 6) switchToDay(currentDayIndex + 1);
  }, [currentDayIndex, switchToDay]);

  // ── Team management (add/remove across entire template) ──
  const handleAddTeam = useCallback(() => {
    const usedIndices = state.teams.map(t => t.colorIndex);
    const colorIndex = getNextColorIndex(usedIndices);
    const newTeam: TeamSchedule = {
      id: generateId(),
      name: `Team ${state.teams.length + 1}`,
      color: TEAM_COLORS[colorIndex % TEAM_COLORS.length],
      colorIndex,
      baseAddress: state.teams[0]?.baseAddress || null,
      returnAddress: null,
      clients: [],
      travelSegments: new Map<string, TravelSegment>(),
      dayStartTime: '08:00',
      breaks: [],
      hourlyRate: 38,
      calculateFuel: false,
      fuelEfficiency: 10,
      fuelPrice: 1.85,
      perKmRate: 0,
      staffIds: [],
      driverStaffId: null,
    };

    const emptyEntry = {
      ...newTeam,
      clients: [] as TeamSchedule['clients'],
      travelSegments: new Map<string, TravelSegment>(),
      breaks: [] as TeamSchedule['breaks'],
    };

    // Add to ALL 7 days in cache (create entry if missing)
    for (let i = 0; i < 7; i++) {
      if (i === currentDayIndex) continue; // current day handled via dispatch below
      const existing = weekCacheRef.current.get(i) || state.teams.map(t => ({
        ...t, clients: [] as TeamSchedule['clients'],
        travelSegments: new Map<string, TravelSegment>(),
        breaks: [] as TeamSchedule['breaks'],
      }));
      weekCacheRef.current.set(i, [...existing, { ...emptyEntry }]);
    }

    // Add to current state via dispatcher
    dispatch({
      type: 'LOAD_STATE',
      teams: [...state.teams, newTeam],
      activeTeamId: newTeam.id,
      selectedDate: state.selectedDate,
    });
  }, [state.teams, state.selectedDate, currentDayIndex]);

  const handleRemoveTeam = useCallback((teamId: string) => {
    if (state.teams.length <= 1) return;

    // Remove from ALL 7 days in cache
    for (let i = 0; i < 7; i++) {
      if (i === currentDayIndex) continue; // current day handled via dispatch below
      const existing = weekCacheRef.current.get(i);
      if (existing) weekCacheRef.current.set(i, existing.filter(t => t.id !== teamId));
    }

    // Remove from current state
    dispatch({ type: 'REMOVE_TEAM', teamId });
  }, [state.teams.length, currentDayIndex]);

  // ── Loading state ──
  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="shimmer w-12 h-12 rounded-xl mx-auto mb-3"/>
          <p className="text-sm text-text-tertiary">Loading template editor…</p>
        </div>
      </div>
    );
  }

  const activeTeam = state.teams.find(t => t.id === state.activeTeamId) || state.teams[0];

  return (
    <APIProvider apiKey={MAPS_KEY}>
      <div className="h-full flex flex-col overflow-hidden">
        {/* ══ Header ═══════════════════════════════════════════════════════════ */}
        <header className="shrink-0 z-20 px-4 lg:px-6 border-b border-border-light bg-white">
          {/* ── Top row: back + template name + save ── */}
          <div className="flex items-center justify-between h-12 lg:h-14">

            {/* Left: back button + day nav or template label */}
            <div className="flex items-center gap-1">
              {/* Back to week (day view) or back to templates list (week view) */}
              {state.viewMode === 'day' ? (
                <button
                  onClick={handleBackToWeek}
                  className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors"
                  title="Back to week view"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
              ) : (
                <button
                  onClick={() => router.push('/dashboard/templates')}
                  className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors"
                  title="Back to templates"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
              )}

              {/* Prev arrow */}
              <button
                onClick={handlePrevDay}
                disabled={state.viewMode !== 'day' || currentDayIndex === 0}
                className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-text-secondary transition-colors ${
                  state.viewMode !== 'day' ? 'opacity-0 pointer-events-none' : ''
                } ${state.viewMode === 'day' && currentDayIndex === 0 ? 'opacity-25 cursor-not-allowed pointer-events-none' : ''}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>

              {/* Centre label: day name in day view + template name input always visible */}
              {state.viewMode === 'day' && (
                <span className="text-sm font-semibold text-text-primary text-center px-1 min-w-[90px]">
                  {DAY_LABELS[currentDayIndex]}
                </span>
              )}
              <input
                type="text"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="Template name…"
                className={`text-sm font-semibold text-text-primary bg-transparent border-none outline-none px-1 placeholder:text-text-tertiary ${
                  state.viewMode === 'day' ? 'hidden sm:block lg:min-w-[140px] text-text-secondary' : 'lg:min-w-[180px]'
                }`}
              />

              {/* Next arrow */}
              <button
                onClick={handleNextDay}
                disabled={state.viewMode !== 'day' || currentDayIndex === 6}
                className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover text-text-secondary transition-colors ${
                  state.viewMode !== 'day' ? 'opacity-0 pointer-events-none' : ''
                } ${state.viewMode === 'day' && currentDayIndex === 6 ? 'opacity-25 cursor-not-allowed pointer-events-none' : ''}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            {/* Right: job count + save */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:block text-[11px] text-text-tertiary">
                {totalJobs} job{totalJobs !== 1 ? 's' : ''} · {state.teams.length} team{state.teams.length !== 1 ? 's' : ''}
              </span>
              <AnimatePresence>
                {saved && (
                  <motion.span
                    key="manualsaved"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-xs text-emerald-500 font-semibold flex items-center gap-1"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                    Saved
                  </motion.span>
                )}
              </AnimatePresence>
              <button
                onClick={handleSave}
                disabled={saving || !templateName.trim()}
                className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    Saving…
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                    </svg>
                    Save
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ── Team tabs row ── */}
          {state.teams.length > 0 && (
            <div className="pb-3 -mx-1 overflow-x-auto">
              <TeamTabs
                state={state}
                dispatch={dispatch}
                onSelectTeam={(teamId) => dispatch({ type: 'SET_ACTIVE_TEAM', teamId })}
                onAddTeam={handleAddTeam}
                onRemoveTeam={handleRemoveTeam}
                onChangeTeamColor={(teamId, colorIndex) => {
                  dispatch({ type: 'SET_TEAM_COLOR', teamId, colorIndex });
                  for (const [dayIdx, teams] of weekCacheRef.current) {
                    if (dayIdx !== currentDayIndex) {
                      weekCacheRef.current.set(dayIdx, teams.map(t =>
                        t.id === teamId ? { ...t, color: TEAM_COLORS[colorIndex % TEAM_COLORS.length], colorIndex } : t
                      ));
                    }
                  }
                }}
                onChangeTeamName={(teamId, name) => {
                  dispatch({ type: 'RENAME_TEAM', teamId, name });
                  for (const [dayIdx, teams] of weekCacheRef.current) {
                    if (dayIdx !== currentDayIndex) {
                      weekCacheRef.current.set(dayIdx, teams.map(t =>
                        t.id === teamId ? { ...t, name } : t
                      ));
                    }
                  }
                }}
              />
            </div>
          )}
        </header>

        {/* ══ Content ══════════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-hidden">
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <AnimatePresence mode="wait">
              {state.viewMode === 'week' ? (
                <motion.div
                  key="week"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex min-w-0 bg-gradient-to-br from-transparent to-surface-hover/30"
                >
                  {/* Client sidebar — same as main scheduler, hidden in all-teams mode */}
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

                  {/* Week grid */}
                  <div className="flex-1 min-w-0 h-full">
                    <WeekView
                      weekDates={weekDates}
                      daySchedules={activeTeamWeekSchedules}
                      teamColor={activeTeam?.color || TEAM_COLORS[0]}
                      activeDate={weekDates[currentDayIndex]}
                      onDayClick={handleDayClick}
                      allTeamsMode={state.activeTeamId === 'all'}
                      allTeams={state.teams}
                      allTeamSchedules={templateWeekSchedules}
                      dayWarnings={filteredWeekDayWarnings}
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="day"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full"
                >
                  <DayEditor
                    state={state}
                    dispatch={dispatch}
                    orgId={orgId}
                    dbLoaded={loaded}
                    supabase={supabase}
                    allStaff={allStaff}
                    isAdmin={true}
                    disableAutoSave={true}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Delete drop zone — floats up when dragging */}
            <AnimatePresence>
              {(activeDragClient || activeDragJob) && <DeleteZone />}
            </AnimatePresence>

            {/* Drag overlay — ghost card while dragging */}
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
        </div>

      </div>
    </APIProvider>
  );
}
