'use client';

import { useReducer, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AnimatePresence } from 'framer-motion';

import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { getTodayISO, getWeekDates, getWeekLabel, addDays } from '@/lib/timeUtils';
import { TravelSegment, Client, TeamSchedule, TEAM_COLORS, DaySchedule } from '@/lib/types';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';

import TeamTabs from '@/components/TeamTabs';
import WeekView from '@/components/WeekView';
import MonthOverlay from '@/components/MonthOverlay';
import SaveTemplateModal from '@/components/SaveTemplateModal';
import LoadTemplateModal from '@/components/LoadTemplateModal';
import DayEditor from '@/components/DayEditor';

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

export default function SchedulePage() {
  const [state, dispatch] = useReducer(scheduleReducer, null, createInitialState);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [showMonth, setShowMonth] = useState(false);
  const [weekSchedules, setWeekSchedules] = useState<Map<string, DaySchedule>>(new Map());
  const [publishedDates, setPublishedDates] = useState<Set<string>>(new Set());
  const daySaveRef = useRef<(() => Promise<void>) | null>(null);

  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id || null;

  const weekDates = useMemo(() => getWeekDates(state.focusedDate), [state.focusedDate]);
  const weekLabel = useMemo(() => getWeekLabel(weekDates[0], weekDates[6]), [weekDates]);

  // ─── Load teams on mount ───
  const loadTeams = useCallback(async () => {
    if (!orgId) return null;
    const { data: dbTeams } = await supabase
      .from('teams').select('*').eq('org_id', orgId).order('sort_order');
    if (!dbTeams || dbTeams.length === 0) return null;
    return dbTeams.map((row: Record<string, unknown>): TeamSchedule => ({
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
  }, [orgId, supabase]);

  // ─── Load week schedules for overview ───
  const loadWeekSchedules = useCallback(async (dates: string[]) => {
    if (!orgId) return;
    const teamsList = await loadTeams();
    if (!teamsList) return;

    const newMap = new Map<string, DaySchedule>();
    const newPublished = new Set<string>();

    for (const date of dates) {
      const dayClients: Client[] = [];
      let schedId: string | null = null;
      let templateCode: string | undefined;
      let isPublished = false;

      // Get schedule for primary team for this date
      for (const team of teamsList) {
        const { data: schedule } = await supabase
          .from('schedules')
          .select('id, is_published, template_code')
          .eq('team_id', team.id)
          .eq('schedule_date', date)
          .maybeSingle();

        if (schedule) {
          schedId = schedule.id;
          isPublished = schedule.is_published || false;
          templateCode = schedule.template_code || undefined;

          const { data: jobs } = await supabase
            .from('schedule_jobs')
            .select('*')
            .eq('schedule_id', schedule.id)
            .order('position');

          if (jobs) {
            for (const j of jobs) {
              if (j.is_break) continue;
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
                startTime: (j.start_time as string) || undefined,
                endTime: (j.end_time as string) || undefined,
                notes: (j.notes as string) || undefined,
                savedClientId: (j.client_id as string) || undefined,
              });
            }
          }
        }
      }

      if (isPublished) newPublished.add(date);

      newMap.set(date, {
        date,
        dayOfWeek: new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
        scheduleId: schedId,
        clients: dayClients,
        templateCode,
        isPublished,
      });
    }

    setWeekSchedules(newMap);
    setPublishedDates(newPublished);

    // Also load the active day into the reducer
    if (teamsList.length > 0) {
      const today = state.selectedDate;
      const teamsWithClients = teamsList.map((team: TeamSchedule) => {
        const dayData = newMap.get(today);
        return { ...team, clients: dayData?.clients || [] };
      });
      dispatch({
        type: 'LOAD_STATE',
        teams: teamsWithClients,
        activeTeamId: teamsWithClients[0].id,
        selectedDate: today,
      });
      setDbLoaded(true);
    }
  }, [orgId, supabase, loadTeams, state.selectedDate]);

  // Initial load
  useEffect(() => {
    if (orgId && !dbLoaded) loadWeekSchedules(weekDates);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Reload on week change
  useEffect(() => {
    if (orgId && dbLoaded) loadWeekSchedules(weekDates);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDates[0]]);

  // ─── Load specific day into reducer for Day View ───
  const loadDayForEdit = useCallback(async (date: string) => {
    if (!orgId) return;
    const teamsList = await loadTeams();
    if (!teamsList) return;

    for (const team of teamsList) {
      const { data: schedule } = await supabase
        .from('schedules').select('id')
        .eq('team_id', team.id).eq('schedule_date', date).maybeSingle();
      if (schedule) {
        const { data: jobs } = await supabase
          .from('schedule_jobs').select('*')
          .eq('schedule_id', schedule.id).order('position');
        if (jobs) {
          team.clients = jobs
            .filter((j: Record<string, unknown>) => !j.is_break)
            .map((j: Record<string, unknown>): Client => ({
              id: j.id as string, name: (j.name as string) || '',
              location: { address: (j.address as string) || '', lat: (j.lat as number) || 0, lng: (j.lng as number) || 0, placeId: (j.place_id as string) || undefined },
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
    dispatch({ type: 'LOAD_STATE', teams: teamsList, activeTeamId: teamsList[0].id, selectedDate: date });
  }, [orgId, supabase, loadTeams]);

  // ─── Week Navigation ───
  const goToPrevWeek = () => {
    const newDate = addDays(state.focusedDate, -7);
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
  };
  const goToNextWeek = () => {
    const newDate = addDays(state.focusedDate, 7);
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
  };

  const handleDayClick = (date: string) => {
    dispatch({ type: 'SET_FOCUSED_DATE', date });
    dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' });
    loadDayForEdit(date);
  };

  const handleBackToWeek = async () => {
    // Flush pending save before switching views
    if (daySaveRef.current) await daySaveRef.current();
    dispatch({ type: 'SET_VIEW_MODE', viewMode: 'week' });
    loadWeekSchedules(weekDates);
  };

  // ─── Template Code ───
  const handleTemplateCodeChange = async (date: string, code: string) => {
    if (!orgId || !state.teams[0]) return;
    const teamId = state.teams[0].id;
    const { data: schedule } = await supabase
      .from('schedules').select('id')
      .eq('team_id', teamId).eq('schedule_date', date).maybeSingle();
    if (schedule) {
      await supabase.from('schedules').update({ template_code: code || null }).eq('id', schedule.id);
    } else {
      await supabase.from('schedules').insert({ org_id: orgId, team_id: teamId, schedule_date: date, template_code: code || null });
    }
    setWeekSchedules((prev) => {
      const nm = new Map(prev);
      const d = nm.get(date);
      if (d) nm.set(date, { ...d, templateCode: code || undefined });
      return nm;
    });
  };

  // ─── Publish Week ───
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
  };

  const weekIsPublished = weekDates.every((d) => publishedDates.has(d));

  // ─── Team handlers ───
  const handleAddTeam = useCallback(async () => {
    if (!orgId) return;
    const colorIndex = state.teams.length % TEAM_COLORS.length;
    const baseAddr = state.teams[0]?.baseAddress;
    const { data } = await supabase.from('teams').insert({
      org_id: orgId, name: `Team ${state.teams.length + 1}`, color_index: colorIndex, sort_order: state.teams.length,
      ...(baseAddr ? { base_address: baseAddr.address, base_lat: baseAddr.lat, base_lng: baseAddr.lng, base_place_id: baseAddr.placeId || null } : {}),
    }).select().single();
    if (data) {
      dispatch({ type: 'ADD_TEAM' });
      const newTeams = [...state.teams];
      const nt = newTeams[newTeams.length - 1];
      if (nt) { nt.id = data.id; }
    }
  }, [orgId, supabase, state.teams]);

  const handleRemoveTeam = useCallback(async (teamId: string) => {
    if (state.teams.length <= 1) return;
    const { data: schedules } = await supabase.from('schedules').select('id').eq('team_id', teamId);
    if (schedules) {
      for (const s of schedules) await supabase.from('schedule_jobs').delete().eq('schedule_id', s.id);
      await supabase.from('schedules').delete().eq('team_id', teamId);
    }
    await supabase.from('teams').delete().eq('id', teamId);
    dispatch({ type: 'REMOVE_TEAM', teamId });
  }, [supabase, state.teams.length]);

  // ─── Template loading (additive) ───
  const handleLoadTemplate = useCallback((data: { clients: Client[]; additive: boolean }) => {
    if (!data.clients || data.clients.length === 0) return;
    const newClients = data.clients.map((c: Client) => ({
      ...c, id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      startTime: undefined, endTime: undefined,
    }));
    const activeTeam = state.teams.find((t) => t.id === state.activeTeamId) || state.teams[0];
    if (data.additive && activeTeam) {
      dispatch({ type: 'SET_CLIENTS_ORDER', teamId: activeTeam.id, clients: [...activeTeam.clients, ...newClients] });
    } else if (activeTeam) {
      dispatch({ type: 'SET_CLIENTS_ORDER', teamId: activeTeam.id, clients: newClients });
    }
    setShowLoadTemplate(false);
  }, [state.teams, state.activeTeamId]);

  // ─── Month overlay data ───
  const monthData = useMemo(() => {
    const m = new Map<string, { clientCount: number; isPublished: boolean; templateCode?: string }>();
    weekSchedules.forEach((d, date) => {
      if (d.clients.length > 0 || d.isPublished) {
        m.set(date, { clientCount: d.clients.length, isPublished: d.isPublished, templateCode: d.templateCode });
      }
    });
    return m;
  }, [weekSchedules]);

  const activeTeam = useMemo(
    () => state.teams.find((t) => t.id === state.activeTeamId) || state.teams[0],
    [state.teams, state.activeTeamId]
  );

  return (
    <APIProvider apiKey={MAPS_KEY} libraries={['places', 'routes']}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <header className="shrink-0 z-20 px-4 lg:px-6 border-b border-border-light bg-white">
          <div className="flex items-center justify-between h-14">
            {/* Week navigation */}
            <div className="flex items-center gap-2">
              {state.viewMode === 'day' && (
                <button onClick={handleBackToWeek} className="btn-ghost text-xs mr-1" title="Back to week view">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
                  Week
                </button>
              )}
              <button onClick={goToPrevWeek} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span className="text-sm font-semibold text-text-primary min-w-[180px] text-center">{weekLabel}</span>
              <button onClick={goToNextWeek} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              {/* View mode toggle */}
              <div className="hidden sm:flex items-center gap-0.5 bg-surface-elevated rounded-lg p-0.5">
                <button
                  onClick={async () => { if (state.viewMode === 'day' && daySaveRef.current) await daySaveRef.current(); dispatch({ type: 'SET_VIEW_MODE', viewMode: 'week' }); loadWeekSchedules(weekDates); }}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${state.viewMode === 'week' ? 'bg-white shadow-card text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                >Week</button>
                <button
                  onClick={() => { dispatch({ type: 'SET_VIEW_MODE', viewMode: 'day' }); loadDayForEdit(state.focusedDate); }}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${state.viewMode === 'day' ? 'bg-white shadow-card text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                >Day</button>
              </div>

              <button onClick={() => setShowMonth(true)} className="btn-ghost text-xs" title="Month view">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </button>

              {state.viewMode === 'day' && activeTeam?.clients.length > 0 && (
                <button onClick={() => setShowSaveTemplate(true)} className="btn-ghost text-xs" title="Save as template">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  Save
                </button>
              )}
              <button onClick={() => setShowLoadTemplate(true)} className="btn-ghost text-xs" title="Load template">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Load
              </button>

              {state.viewMode === 'week' && (
                <button
                  onClick={handlePublishWeek}
                  disabled={weekIsPublished}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                    weekIsPublished
                      ? 'bg-success-light text-success cursor-default'
                      : 'bg-primary text-white hover:bg-primary-hover'
                  }`}
                >
                  {weekIsPublished ? '✓ Published' : 'Publish Week'}
                </button>
              )}
            </div>
          </div>

          {/* Team tabs */}
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

        {/* Content */}
        <div className="flex-1 min-h-0">
          {state.viewMode === 'week' ? (
            <WeekView
              weekDates={weekDates}
              daySchedules={weekSchedules}
              teamColor={activeTeam?.color || TEAM_COLORS[0]}
              activeDate={state.focusedDate}
              onDayClick={handleDayClick}
              onTemplateCodeChange={handleTemplateCodeChange}
            />
          ) : (
            <DayEditor
              state={state}
              dispatch={dispatch}
              orgId={orgId}
              dbLoaded={dbLoaded}
              supabase={supabase}
              saveRef={daySaveRef}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showSaveTemplate && activeTeam && (
          <SaveTemplateModal team={activeTeam} orgId={orgId} onClose={() => setShowSaveTemplate(false)} />
        )}
        {showLoadTemplate && (
          <LoadTemplateModal orgId={orgId} onLoad={handleLoadTemplate} onClose={() => setShowLoadTemplate(false)} />
        )}
        {showMonth && (
          <MonthOverlay
            scheduledDates={monthData}
            onDayClick={(date) => { dispatch({ type: 'SET_FOCUSED_DATE', date }); }}
            onClose={() => setShowMonth(false)}
          />
        )}
      </AnimatePresence>
    </APIProvider>
  );
}
