'use client';

import { useReducer, useEffect, useMemo, useState, useCallback, useRef, use } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { motion, AnimatePresence } from 'framer-motion';

import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { getWeekDates } from '@/lib/timeUtils';
import { TravelSegment, Client, TeamSchedule, TEAM_COLORS, DaySchedule, StaffMember, getNextColorIndex, Location as AppLocation } from '@/lib/types';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { generateId } from '@/lib/timeUtils';

import TeamTabs from '@/components/TeamTabs';
import WeekView from '@/components/WeekView';
import DayEditor from '@/components/DayEditor';
import { useRouter } from 'next/navigation';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Reference week: a fixed Monday so day-based components work with real ISO dates
const REFERENCE_MONDAY = '2024-01-01'; // This is a Monday

interface TeamTemplateData {
  teamName: string;
  teamId: string;
  dayStartTime?: string;
  baseAddress?: AppLocation | null;
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

  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id || null;
  const router = useRouter();

  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const allOrgTeamsRef = useRef<TeamSchedule[]>([]);

  // Reference week dates: Mon Jan 1 2024 → Sun Jan 7 2024
  const weekDates = useMemo(() => getWeekDates(REFERENCE_MONDAY), []);

  // ── Week cache: day index (0-6) → teams state for that day ──
  const weekCacheRef = useRef<Map<number, TeamSchedule[]>>(new Map());
  const [currentDayIndex, setCurrentDayIndex] = useState(0);
  const activeTeamIdRef = useRef(state.activeTeamId);
  activeTeamIdRef.current = state.activeTeamId;

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
      fuelEfficiency: Number(row.fuel_efficiency) || 10,
      fuelPrice: Number(row.fuel_price) || 1.85,
      perKmRate: Number(row.per_km_rate) || 0,
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
  useEffect(() => {
    if (!orgId || loaded) return;
    (async () => {
      const orgTeams = await loadOrgTeams();
      if (orgTeams.length === 0) { setLoaded(true); return; }

      if (isNew) {
        // New template: empty state with org teams
        const emptyTeams = orgTeams.map(t => ({
          ...t,
          clients: [],
          travelSegments: new Map<string, TravelSegment>(),
          breaks: [] as typeof t.breaks,
        }));
        // Initialize weekCache with empty states for all 7 days
        for (let i = 0; i < 7; i++) {
          weekCacheRef.current.set(i, emptyTeams.map(t => ({ ...t })));
        }
        dispatch({
          type: 'LOAD_STATE',
          teams: emptyTeams,
          activeTeamId: emptyTeams[0].id,
          selectedDate: weekDates[0],
        });
        setLoaded(true);
        return;
      }

      // Edit existing: load template data
      const { data: templateData } = await supabase
        .from('schedule_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (!templateData) {
        setLoaded(true);
        return;
      }

      const template = templateData as ScheduleTemplate;
      setTemplateName(template.name);
      setTemplateLabel(template.label);

      const weekData = template.week_data || {};

      // Build week cache from template data
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayTeamsData = weekData[String(dayIdx)] || [];
        
        if (dayTeamsData.length === 0) {
          // No data for this day: empty teams
          weekCacheRef.current.set(dayIdx, orgTeams.map(t => ({
            ...t,
            clients: [],
            travelSegments: new Map<string, TravelSegment>(),
            breaks: [] as typeof t.breaks,
          })));
          continue;
        }

        // Build teams from template data
        const dayTeams: TeamSchedule[] = orgTeams.map(orgTeam => {
          // Find matching template team data
          const templateTeam = dayTeamsData.find(
            (tt: TeamTemplateData) => tt.teamId === orgTeam.id || tt.teamName === orgTeam.name
          );

          if (!templateTeam || !templateTeam.clients || templateTeam.clients.length === 0) {
            return {
              ...orgTeam,
              clients: [],
              travelSegments: new Map<string, TravelSegment>(),
              breaks: [] as typeof orgTeam.breaks,
            };
          }

          // Convert template clients to Client objects with generated IDs
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
          }));

          // Convert break indices to break objects with afterClientId
          const breaks = (templateTeam.breaks || [])
            .map((b: { afterClientIndex: number; durationMinutes: number; label: string }) => {
              const afterClient = clients[b.afterClientIndex];
              if (!afterClient) return null;
              return {
                id: generateId(),
                afterClientId: afterClient.id,
                durationMinutes: b.durationMinutes,
                label: b.label,
              };
            })
            .filter(Boolean) as typeof orgTeam.breaks;

          return {
            ...orgTeam,
            dayStartTime: templateTeam.dayStartTime || orgTeam.dayStartTime,
            baseAddress: templateTeam.baseAddress !== undefined ? templateTeam.baseAddress : orgTeam.baseAddress,
            clients,
            travelSegments: new Map<string, TravelSegment>(),
            breaks,
          };
        });

        weekCacheRef.current.set(dayIdx, dayTeams);
      }

      // Load Monday (day 0) into reducer
      const mondayTeams = weekCacheRef.current.get(0) || orgTeams.map(t => ({
        ...t, clients: [], travelSegments: new Map<string, TravelSegment>(), breaks: [] as typeof t.breaks,
      }));
      dispatch({
        type: 'LOAD_STATE',
        teams: mondayTeams,
        activeTeamId: mondayTeams.find(t => t.id === activeTeamIdRef.current)?.id || mondayTeams[0].id,
        selectedDate: weekDates[0],
      });
      setLoaded(true);
    })();
  }, [orgId, loaded, isNew, templateId, supabase, loadOrgTeams, weekDates]);

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
        if (team.clients.length === 0) continue;

        // Convert breaks: afterClientId → afterClientIndex
        const breaks = team.breaks
          .map(b => {
            const idx = team.clients.findIndex(c => c.id === b.afterClientId);
            return idx >= 0 ? { afterClientIndex: idx, durationMinutes: b.durationMinutes, label: b.label } : null;
          })
          .filter(Boolean) as { afterClientIndex: number; durationMinutes: number; label: string }[];

        dayTeamsData.push({
          teamName: team.name,
          teamId: team.id,
          dayStartTime: team.dayStartTime,
          baseAddress: team.baseAddress,
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
          })),
        });
      }

      if (dayTeamsData.length > 0) {
        weekData[String(dayIdx)] = dayTeamsData;
      }
    }

    return weekData;
  }, [saveDayToCache]);

  // ── Save template ──
  const handleSave = useCallback(async () => {
    if (!orgId || !templateName.trim()) return;
    setSaving(true);
    setSaved(false);

    const weekData = serializeWeekData();

    if (existingTemplateId) {
      await supabase
        .from('schedule_templates')
        .update({ name: templateName.trim(), label: templateLabel, week_data: weekData })
        .eq('id', existingTemplateId);
    } else {
      const { data } = await supabase
        .from('schedule_templates')
        .insert({ org_id: orgId, name: templateName.trim(), label: templateLabel, week_data: weekData })
        .select('id')
        .single();
      if (data) setExistingTemplateId(data.id);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [orgId, templateName, templateLabel, existingTemplateId, supabase, serializeWeekData]);

  // ── Build week schedules map for WeekView ──
  const templateWeekSchedules = useMemo(() => {
    // Make sure current day is always up-to-date in the cache
    const currentCache = new Map(weekCacheRef.current);
    currentCache.set(currentDayIndex, state.teams);

    const allTeamMaps = new Map<string, Map<string, DaySchedule>>();

    for (const team of allOrgTeamsRef.current) {
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

  // ── Day schedules for single-team WeekView ──
  const activeTeamWeekSchedules = useMemo(() => {
    const teamMap = templateWeekSchedules.get(state.activeTeamId);
    return teamMap || new Map<string, DaySchedule>();
  }, [templateWeekSchedules, state.activeTeamId]);

  // Total job count across entire template
  const totalJobs = useMemo(() => {
    let count = 0;
    // Save current day to cache for accurate count
    const allCache = new Map(weekCacheRef.current);
    allCache.set(currentDayIndex, state.teams);
    for (const [, teams] of allCache) {
      for (const team of teams) {
        count += team.clients.length;
      }
    }
    return count;
  }, [state.teams, currentDayIndex]);

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
      fuelEfficiency: 10,
      fuelPrice: 1.85,
      perKmRate: 0,
    };

    // Add to all cached days
    for (const [dayIdx, teams] of weekCacheRef.current) {
      if (dayIdx !== currentDayIndex) {
        weekCacheRef.current.set(dayIdx, [...teams, {
          ...newTeam,
          clients: [],
          travelSegments: new Map<string, TravelSegment>(),
          breaks: [],
        }]);
      }
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

    // Remove from all cached days
    for (const [dayIdx, teams] of weekCacheRef.current) {
      if (dayIdx !== currentDayIndex) {
        weekCacheRef.current.set(dayIdx, teams.filter(t => t.id !== teamId));
      }
    }

    // Remove from current state
    dispatch({ type: 'REMOVE_TEAM', teamId });
  }, [state.teams, currentDayIndex]);

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
        <div className="shrink-0 bg-white border-b border-border-light">
          {/* Top row: back + name + save */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            {/* Back */}
            <button
              onClick={() => router.push('/dashboard/templates')}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-elevated transition-colors shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>

            {/* Template name input */}
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={templateName}
                onChange={e => setTemplateName(e.target.value)}
                placeholder="Template name…"
                className="text-base font-bold text-text-primary bg-transparent border-none outline-none w-full placeholder:text-text-tertiary"
              />
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-text-tertiary">
                  {totalJobs} job{totalJobs !== 1 ? 's' : ''} · {state.teams.length} team{state.teams.length !== 1 ? 's' : ''}
                </span>
                {/* Rotation label chips */}
                <div className="flex gap-1">
                  {['A1','A2','A3','A4','B1','B2','B3','B4'].map(label => (
                    <button
                      key={label}
                      onClick={() => setTemplateLabel(templateLabel === label ? null : label)}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded transition-all"
                      style={
                        templateLabel === label
                          ? { backgroundColor: 'var(--color-primary)', color: '#fff' }
                          : { backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-tertiary)' }
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Save */}
            <div className="flex items-center gap-2 shrink-0">
              <AnimatePresence>
                {saved && (
                  <motion.span
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
                className="btn-primary text-sm py-2 px-4 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    Saving…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                      <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
                    </svg>
                    Save Template
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Second row: view mode + team tabs + day nav */}
          <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border-light/50">
            {/* View mode toggle */}
            <div className="flex items-center bg-surface-elevated rounded-lg p-0.5 shrink-0">
              <button
                onClick={() => { saveDayToCache(); dispatch({ type: 'SET_VIEW_MODE', viewMode: 'week' }); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  state.viewMode === 'week' ? 'bg-white shadow-sm text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                Week
              </button>
              <button
                onClick={() => dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  state.viewMode === 'day' ? 'bg-white shadow-sm text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                Day
              </button>
            </div>

            {/* Day navigation (day view only) */}
            {state.viewMode === 'day' && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={handlePrevDay}
                  disabled={currentDayIndex === 0}
                  className="p-1 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary disabled:opacity-30 transition-all"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span className="text-sm font-semibold text-text-primary min-w-[80px] text-center">
                  {DAY_LABELS[currentDayIndex]}
                </span>
                <button
                  onClick={handleNextDay}
                  disabled={currentDayIndex === 6}
                  className="p-1 rounded-lg hover:bg-surface-hover text-text-tertiary hover:text-text-primary disabled:opacity-30 transition-all"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            )}

            {/* Separator */}
            <div className="w-px h-5 bg-border-light shrink-0"/>

            {/* Team tabs */}
            <div className="flex-1 overflow-x-auto">
              <TeamTabs
                state={state}
                dispatch={dispatch}
                onSelectTeam={(teamId) => dispatch({ type: 'SET_ACTIVE_TEAM', teamId })}
                onAddTeam={handleAddTeam}
                onRemoveTeam={handleRemoveTeam}
              />
            </div>
          </div>
        </div>

        {/* ══ Content ══════════════════════════════════════════════════════════ */}
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {state.viewMode === 'week' ? (
              <motion.div
                key="week"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full"
              >
                <WeekView
                  weekDates={weekDates}
                  daySchedules={activeTeamWeekSchedules}
                  teamColor={activeTeam?.color || TEAM_COLORS[0]}
                  activeDate={weekDates[currentDayIndex]}
                  onDayClick={handleDayClick}
                  allTeamsMode={state.activeTeamId === 'all'}
                  allTeams={state.teams}
                  allTeamSchedules={templateWeekSchedules}
                />
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
        </div>
      </div>
    </APIProvider>
  );
}
