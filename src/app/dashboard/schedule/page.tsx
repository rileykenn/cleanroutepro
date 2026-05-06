'use client';

import { useReducer, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AnimatePresence } from 'framer-motion';

import { scheduleReducer, createInitialState } from '@/lib/scheduleReducer';
import { getTodayISO, getWeekDates, getWeekLabel, addDays } from '@/lib/timeUtils';
import { TravelSegment, Client, TeamSchedule, TEAM_COLORS, DaySchedule, StaffMember } from '@/lib/types';
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

export default function SchedulePage() {
  const [state, dispatch] = useReducer(scheduleReducer, null, createInitialState);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showLoadTemplate, setShowLoadTemplate] = useState(false);
  const [showMonth, setShowMonth] = useState(false);
  const [weekSchedules, setWeekSchedules] = useState<Map<string, Map<string, DaySchedule>>>(new Map());
  const [publishedDates, setPublishedDates] = useState<Set<string>>(new Set());
  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const [teamStaffMap, setTeamStaffMap] = useState<Map<string, { id: string; name: string; hourly_rate: number }[]>>(new Map());
  const daySaveRef = useRef<(() => Promise<void>) | null>(null);
  const activeTeamIdRef = useRef(state.activeTeamId);
  activeTeamIdRef.current = state.activeTeamId;
  const [pendingDeleteTeam, setPendingDeleteTeam] = useState<{ id: string; name: string; clientCount: number } | null>(null);

  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const orgId = profile?.org_id || null;
  const isStaff = profile?.role === 'staff';

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
    try {
      const teamsList = await loadTeams();

      // No teams found — create a default one and finish
      if (!teamsList || teamsList.length === 0) {
        const { data: newTeam } = await supabase.from('teams').insert({ org_id: orgId, name: 'Team 1', color_index: 0, sort_order: 0 }).select().single();
        if (newTeam) {
          const defaultTeam: TeamSchedule = {
            id: newTeam.id, name: newTeam.name, color: TEAM_COLORS[0],
            baseAddress: null, clients: [], travelSegments: new Map(), dayStartTime: '08:00',
            breaks: [], hourlyRate: 38, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
          };
          dispatch({ type: 'LOAD_STATE', teams: [defaultTeam], activeTeamId: defaultTeam.id, selectedDate: state.selectedDate });
        }
        setDbLoaded(true);
        return;
      }

      const allTeamMaps = new Map<string, Map<string, DaySchedule>>();
      const newPublished = new Set<string>();

      for (const team of teamsList) {
        const teamMap = new Map<string, DaySchedule>();

        for (const date of dates) {
          const dayClients: Client[] = [];
          let schedId: string | null = null;
          let templateCode: string | undefined;
          let isPublished = false;

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
                  startTime: (j.start_time as string) || undefined,
                  endTime: (j.end_time as string) || undefined,
                  notes: (j.notes as string) || undefined,
                  savedClientId: (j.client_id as string) || undefined,
                  assignedStaffIds: assignedIds,
                });
              }
            }
          }

          if (isPublished) newPublished.add(date);

          teamMap.set(date, {
            date,
            dayOfWeek: new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
            scheduleId: schedId,
            clients: dayClients,
            templateCode,
            isPublished,
          });
        }

        allTeamMaps.set(team.id, teamMap);
      }

      setWeekSchedules(allTeamMaps);
      setPublishedDates(newPublished);

      // Load the active day into the reducer
      const today = state.selectedDate;
      const teamsWithClients = teamsList.map((team: TeamSchedule) => {
        const teamMap = allTeamMaps.get(team.id);
        const dayData = teamMap?.get(today);
        return { ...team, clients: dayData?.clients || [] };
      });
      dispatch({
        type: 'LOAD_STATE',
        teams: teamsWithClients,
        activeTeamId: teamsWithClients.find((t: TeamSchedule) => t.id === activeTeamIdRef.current)?.id || teamsWithClients[0].id,
        selectedDate: today,
      });
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
    if (data) setAllStaff(data as StaffMember[]);
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

  // Derive team badges when teams or staff change
  useEffect(() => {
    if (dbLoaded && allStaff.length > 0) deriveTeamStaffMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.teams, allStaff]);

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
            .map((j: Record<string, unknown>): Client => {
              const assignedIds = (j.assigned_staff_ids as string[]) || [];
              return {
                id: j.id as string, name: (j.name as string) || '',
                location: { address: (j.address as string) || '', lat: (j.lat as number) || 0, lng: (j.lng as number) || 0, placeId: (j.place_id as string) || undefined },
                jobDurationMinutes: Number(j.duration_minutes) || 90,
                staffCount: assignedIds.length > 0 ? assignedIds.length : ((j.staff_count as number) || 1),
                isLocked: (j.is_locked as boolean) || false,
                startTime: (j.start_time as string) || undefined,
                endTime: (j.end_time as string) || undefined,
                notes: (j.notes as string) || undefined,
                savedClientId: (j.client_id as string) || undefined,
                assignedStaffIds: assignedIds,
              };
            });
        }
      }
    }
    dispatch({ type: 'LOAD_STATE', teams: teamsList, activeTeamId: teamsList.find((t: TeamSchedule) => t.id === activeTeamIdRef.current)?.id || teamsList[0].id, selectedDate: date });
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

  // ─── Day Navigation ───
  const goToPrevDay = async () => {
    if (daySaveRef.current) await daySaveRef.current();
    const newDate = addDays(state.focusedDate, -1);
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
    loadDayForEdit(newDate);
  };
  const goToNextDay = async () => {
    if (daySaveRef.current) await daySaveRef.current();
    const newDate = addDays(state.focusedDate, 1);
    dispatch({ type: 'SET_FOCUSED_DATE', date: newDate });
    loadDayForEdit(newDate);
  };

  const dayLabel = useMemo(() => {
    const parts = state.focusedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }, [state.focusedDate]);

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

    // Group by week (Mon-Sun)
    const allDates = Array.from(new Set(published.map((p: { schedule_date: string }) => p.schedule_date))) as string[];
    const weeks = new Map<string, { dates: string[]; jobCount: number }>();

    for (const dateStr of allDates) {
      const parts = dateStr.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const mondayStr = monday.toISOString().split('T')[0];
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
        const parts = mondayStr.split('-').map(Number);
        const mon = new Date(parts[0], parts[1] - 1, parts[2]);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        return {
          weekStart: mondayStr,
          weekEnd: sun.toISOString().split('T')[0],
          label: `${mon.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${sun.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`,
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
    // Get all 7 dates for this week
    const dates = [];
    const parts = weekStart.split('-').map(Number);
    const mon = new Date(parts[0], parts[1] - 1, parts[2]);
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
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
    // If we just unpublished the current week, update the UI
    if (dates.some(d => weekDates.includes(d))) {
      setPublishedDates(new Set());
      loadWeekSchedules(weekDates);
    }
  };

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
      const newTeam: TeamSchedule = {
        id: data.id, name: data.name, color: TEAM_COLORS[colorIndex],
        baseAddress: baseAddr ? { ...baseAddr } : null,
        clients: [], travelSegments: new Map(), dayStartTime: '08:00',
        breaks: [], hourlyRate: 38, fuelEfficiency: 10, fuelPrice: 1.85, perKmRate: 0,
      };
      dispatch({ type: 'LOAD_STATE', teams: [...state.teams, newTeam], activeTeamId: newTeam.id, selectedDate: state.selectedDate });
    }
  }, [orgId, supabase, state.teams, state.selectedDate]);

  const handleRemoveTeam = useCallback((teamId: string) => {
    if (state.teams.length <= 1) return;
    const team = state.teams.find(t => t.id === teamId);
    setPendingDeleteTeam({ id: teamId, name: team?.name || 'this team', clientCount: team?.clients.length || 0 });
  }, [state.teams]);

  const confirmDeleteTeam = useCallback(async () => {
    if (!pendingDeleteTeam) return;
    const teamId = pendingDeleteTeam.id;
    setPendingDeleteTeam(null);
    const { data: schedules } = await supabase.from('schedules').select('id').eq('team_id', teamId);
    if (schedules) {
      for (const s of schedules) await supabase.from('schedule_jobs').delete().eq('schedule_id', s.id);
      await supabase.from('schedules').delete().eq('team_id', teamId);
    }
    await supabase.from('teams').delete().eq('id', teamId);
    dispatch({ type: 'REMOVE_TEAM', teamId });
  }, [supabase, pendingDeleteTeam]);

  // ─── Week template loading ───
  const handleLoadWeekTemplate = useCallback(async (weekData: Record<string, { teamName: string; teamId: string; clients: Client[] }[]>) => {
    // First save any pending day edits
    if (daySaveRef.current) await daySaveRef.current();

    if (!orgId) return;

    // For each day in the template, write the clients into schedule_jobs
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const dayTeams = weekData[String(dayIdx)];
      if (!dayTeams || dayTeams.length === 0) continue;

      const date = weekDates[dayIdx];

      // Match template teams to actual teams by position or name
      for (const templateTeam of dayTeams) {
        // Find best matching team: by name first, then by position
        const matchedTeam = state.teams.find(t => t.name === templateTeam.teamName)
          || state.teams.find(t => t.id === templateTeam.teamId)
          || state.teams[0];

        if (!matchedTeam) continue;

        // Ensure schedule row exists for this team+date
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

        // Delete existing jobs for this schedule and insert template clients
        await supabase.from('schedule_jobs').delete().eq('schedule_id', scheduleId);

        if (templateTeam.clients.length > 0) {
          const rows = templateTeam.clients.map((c: Client, i: number) => ({
            schedule_id: scheduleId, org_id: orgId, client_id: c.savedClientId || null,
            position: i, name: c.name, address: c.location?.address || '',
            lat: c.location?.lat || 0, lng: c.location?.lng || 0,
            place_id: c.location?.placeId || null,
            duration_minutes: c.jobDurationMinutes || 90,
            staff_count: c.staffCount || 1,
            is_locked: c.isLocked || false, is_break: false,
            notes: c.notes || '',
            assigned_staff_ids: c.assignedStaffIds || [],
          }));
          await supabase.from('schedule_jobs').insert(rows);
        }
      }
    }

    // Reload the week to pick up all changes
    await loadWeekSchedules(weekDates);
    setShowLoadTemplate(false);
  }, [orgId, supabase, state.teams, weekDates, loadWeekSchedules]);

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

  const activeTeam = useMemo(
    () => state.teams.find((t) => t.id === state.activeTeamId) || state.teams[0],
    [state.teams, state.activeTeamId]
  );

  if (!dbLoaded) {
    return (
      <APIProvider apiKey={MAPS_KEY} libraries={['places', 'routes']}>
        <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
          <div className="shimmer w-48 h-6 rounded-lg" />
          <div className="shimmer w-64 h-10 rounded-xl" />
          <div className="shimmer w-full max-w-md h-32 rounded-xl" />
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
                  onClick={async () => { if (state.viewMode === 'day' && daySaveRef.current) await daySaveRef.current(); dispatch({ type: 'SET_VIEW_MODE', viewMode: 'week' }); loadWeekSchedules(weekDates); }}
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

          {/* Team tabs */}
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
        </header>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {state.viewMode === 'week' ? (
            <WeekView
              weekDates={weekDates}
              daySchedules={activeWeekSchedules}
              teamColor={activeTeam?.color || TEAM_COLORS[0]}
              activeDate={state.focusedDate}
              onDayClick={handleDayClick}
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
                    const today = new Date().toISOString().split('T')[0];
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
          <SaveTemplateModal teams={state.teams} selectedDate={state.selectedDate} weekSchedules={weekSchedules} orgId={orgId} onClose={() => setShowSaveTemplate(false)} />
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
              pendingDeleteTeam.clientCount > 0
                ? `This will permanently delete all ${pendingDeleteTeam.clientCount} scheduled job${pendingDeleteTeam.clientCount !== 1 ? 's' : ''} and travel data for this team. This action cannot be undone.`
                : 'All scheduling data for this team will be permanently deleted. This action cannot be undone.'
            }
            confirmLabel="Delete Team"
            onConfirm={confirmDeleteTeam}
            onCancel={() => setPendingDeleteTeam(null)}
            danger
          />
        )}
      </AnimatePresence>
    </APIProvider>
  );
}
