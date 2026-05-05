'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import { Suspense, lazy } from 'react';

const StaffChecklistView = lazy(() => import('@/components/StaffChecklistView'));

interface TeamInfo {
  id: string;
  name: string;
  color_index: number;
  base_address: string | null;
  day_start_time: string;
  hourly_rate: number;
  fuel_efficiency: number;
  fuel_price: number;
  per_km_rate: number;
}

interface JobInfo {
  id: string;
  name: string;
  address: string;
  duration_minutes: number;
  staff_count: number;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  is_break: boolean;
  break_label: string | null;
  position: number;
  client_id: string | null;
  assigned_staff_ids: string[];
  lat: number;
  lng: number;
  place_id: string | null;
}

interface StaffMemberInfo {
  id: string;
  name: string;
  role: string;
  hourly_rate: number;
}

interface DaySummary {
  totalJobs: number;
  totalJobMinutes: number;
  totalTravelMinutes: number;
  totalDistanceKm: number;
  breakMinutes: number;
}

const TEAM_COLORS = [
  '#4F46E5', '#059669', '#D97706', '#DC2626', '#7C3AED',
  '#0891B2', '#C026D3', '#EA580C',
];

function formatTime(t: string | null) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')}${period}`;
}

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function StaffViewPage() {
  const { profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [teamStaff, setTeamStaff] = useState<StaffMemberInfo[]>([]);
  const [allStaff, setAllStaff] = useState<StaffMemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DaySummary>({ totalJobs: 0, totalJobMinutes: 0, totalTravelMinutes: 0, totalDistanceKm: 0, breakMinutes: 0 });
  const [checklistClientId, setChecklistClientId] = useState<string | null>(null);
  const [checklistClientName, setChecklistClientName] = useState('');
  const [checklistJobId, setChecklistJobId] = useState<string | null>(null);
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null);

  // Load teams and staff member ID
  useEffect(() => {
    if (!profile?.org_id) return;
    (async () => {
      const { data: teamsData } = await supabase
        .from('teams').select('id, name, color_index, base_address, day_start_time, hourly_rate, fuel_efficiency, fuel_price, per_km_rate')
        .eq('org_id', profile.org_id).order('sort_order');
      if (teamsData) setTeams(teamsData);

      // Find which staff_member record this user is linked to
      const { data: staffData } = await supabase
        .from('staff_members').select('id')
        .eq('user_id', profile.id).single();
      if (staffData) setStaffMemberId(staffData.id);

      // Load all staff for name lookups
      const { data: allStaffData } = await supabase
        .from('staff_members').select('id, name, role, hourly_rate')
        .eq('org_id', profile.org_id);
      if (allStaffData) setAllStaff(allStaffData);
    })();
  }, [profile?.org_id, profile?.id, supabase]);

  // Load schedule for selected date and team
  const loadSchedule = useCallback(async (teamId: string, date: string) => {
    if (!profile?.org_id) return;
    setLoading(true);

    // Get the schedule for this team + date (only published)
    const { data: schedule } = await supabase
      .from('schedules').select('id, is_published')
      .eq('team_id', teamId).eq('schedule_date', date).maybeSingle();

    if (!schedule || !schedule.is_published) {
      setJobs([]);
      setSummary({ totalJobs: 0, totalJobMinutes: 0, totalTravelMinutes: 0, totalDistanceKm: 0, breakMinutes: 0 });
      setTeamStaff([]);
      setLoading(false);
      return;
    }

    // Load jobs
    const { data: jobsData } = await supabase
      .from('schedule_jobs').select('*')
      .eq('schedule_id', schedule.id).order('position');

    const loadedJobs = (jobsData || []) as JobInfo[];
    setJobs(loadedJobs);

    // Calculate summary
    const clientJobs = loadedJobs.filter(j => !j.is_break);
    const breaks = loadedJobs.filter(j => j.is_break);
    const totalJobMinutes = clientJobs.reduce((sum, j) => sum + j.duration_minutes, 0);
    const breakMinutes = breaks.reduce((sum, j) => sum + j.duration_minutes, 0);

    setSummary({
      totalJobs: clientJobs.length,
      totalJobMinutes,
      totalTravelMinutes: 0, // Will be updated if travel data is available
      totalDistanceKm: 0,
      breakMinutes,
    });

    // Find unique staff assigned to jobs on this day for this team
    const assignedIds = new Set<string>();
    for (const j of loadedJobs) {
      for (const sid of (j.assigned_staff_ids || [])) {
        assignedIds.add(sid);
      }
    }

    const staffList = allStaff.filter(s => assignedIds.has(s.id));
    setTeamStaff(staffList);
    setLoading(false);
  }, [profile?.org_id, supabase, allStaff]);

  // Set initial team and load schedule
  useEffect(() => {
    if (teams.length > 0 && !activeTeamId) {
      setActiveTeamId(teams[0].id);
    }
  }, [teams, activeTeamId]);

  useEffect(() => {
    if (activeTeamId && selectedDate && allStaff.length > 0) {
      loadSchedule(activeTeamId, selectedDate);
    }
  }, [activeTeamId, selectedDate, loadSchedule, allStaff]);

  const activeTeam = teams.find(t => t.id === activeTeamId);
  const teamColor = activeTeam ? TEAM_COLORS[activeTeam.color_index % TEAM_COLORS.length] : TEAM_COLORS[0];
  const driverStaff = teamStaff.find(s => s.role === 'driver');

  const dateLabel = (() => {
    const parts = selectedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  })();

  const goToPrevDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };
  const goToNextDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    setSelectedDate(d.toISOString().split('T')[0]);
  };
  const goToToday = () => setSelectedDate(new Date().toISOString().split('T')[0]);

  const clientJobs = jobs.filter(j => !j.is_break);
  const breakJobs = jobs.filter(j => j.is_break);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      {/* Header / Date Nav */}
      <header className="sticky top-0 z-10 bg-white border-b border-border-light">
        <div className="px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={goToPrevDay} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <div className="text-center min-w-[200px]">
              <p className="text-sm font-semibold text-text-primary">{dateLabel}</p>
            </div>
            <button onClick={goToNextDay} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
          <button onClick={goToToday} className="btn-ghost text-xs">Today</button>
        </div>

        {/* Team tabs */}
        {teams.length > 1 && (
          <div className="px-4 lg:px-6 pb-3 flex gap-1.5 overflow-x-auto">
            {teams.map((t) => {
              const color = TEAM_COLORS[t.color_index % TEAM_COLORS.length];
              const isActive = t.id === activeTeamId;
              return (
                <button key={t.id} onClick={() => setActiveTeamId(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${isActive ? 'text-white shadow-sm' : 'bg-surface-elevated text-text-secondary hover:bg-surface-hover'}`}
                  style={isActive ? { backgroundColor: color } : {}}>
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div className="p-4 lg:p-6 max-w-[700px] mx-auto space-y-5">
        {loading ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="shimmer h-20 rounded-xl" />)}</div>
        ) : jobs.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-text-secondary font-medium">No published schedule for this day</p>
            <p className="text-sm text-text-tertiary mt-1">Check with your manager or try a different date.</p>
          </motion.div>
        ) : (
          <>
            {/* Team Info Card */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="card p-4 space-y-3" style={{ borderLeft: `3px solid ${teamColor}` }}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-text-primary">{activeTeam?.name || 'Team'}</h3>
                  <p className="text-xs text-text-tertiary mt-0.5">{teamStaff.length} member{teamStaff.length !== 1 ? 's' : ''} today</p>
                </div>
                {driverStaff && (
                  <div className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                    Driver: {driverStaff.name}
                  </div>
                )}
              </div>

              {/* Members */}
              <div className="flex flex-wrap gap-1.5">
                {teamStaff.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-border-light bg-surface-elevated">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: teamColor }}>
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-text-primary">{s.name}</span>
                    <span className="text-text-tertiary capitalize">· {s.role}</span>
                  </div>
                ))}
                {teamStaff.length === 0 && (
                  <span className="text-xs text-text-tertiary">No staff assigned to jobs yet</span>
                )}
              </div>
            </motion.div>

            {/* Summary Stats */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Total Jobs', value: String(summary.totalJobs), icon: '📍' },
                { label: 'Job Time', value: formatDuration(summary.totalJobMinutes), icon: '⏱️' },
                { label: 'Break', value: formatDuration(summary.breakMinutes), icon: '☕' },
                { label: 'Start', value: activeTeam?.day_start_time ? formatTime(activeTeam.day_start_time) : '—', icon: '🕐' },
              ].map((stat) => (
                <div key={stat.label} className="card p-3 text-center">
                  <p className="text-lg mb-0.5">{stat.icon}</p>
                  <p className="text-base font-bold text-text-primary">{stat.value}</p>
                  <p className="text-[10px] text-text-tertiary uppercase tracking-wider mt-0.5">{stat.label}</p>
                </div>
              ))}
            </motion.div>

            {/* Jobs List */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-text-tertiary uppercase tracking-wider px-1">Schedule</h4>
              {jobs.map((job, i) => {
                if (job.is_break) {
                  return (
                    <motion.div key={job.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.03 }}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
                      <span className="text-lg">☕</span>
                      <div>
                        <p className="text-sm font-medium text-amber-800">{job.break_label || 'Break'}</p>
                        <p className="text-xs text-amber-600">{formatDuration(job.duration_minutes)}{job.start_time ? ` · ${formatTime(job.start_time)}` : ''}</p>
                      </div>
                    </motion.div>
                  );
                }

                const assignedNames = (job.assigned_staff_ids || [])
                  .map(sid => allStaff.find(s => s.id === sid)?.name)
                  .filter(Boolean);

                return (
                  <motion.div key={job.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.03 }}
                    className="card p-4" style={{ borderLeft: `3px solid ${teamColor}` }}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg text-xs font-bold text-white flex items-center justify-center shrink-0" style={{ backgroundColor: teamColor }}>
                          {clientJobs.indexOf(job) + 1}
                        </div>
                        <div>
                          <h5 className="text-sm font-bold text-text-primary">{job.name || 'Unnamed'}</h5>
                          <p className="text-xs text-text-tertiary truncate max-w-[250px]">{job.address}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {job.client_id && (
                          <button onClick={() => { setChecklistClientId(job.client_id!); setChecklistClientName(job.name); setChecklistJobId(job.id); }}
                            className="p-1.5 rounded-lg hover:bg-emerald-50 text-text-tertiary hover:text-emerald-600 transition-colors" title="Checklist">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                          </button>
                        )}
                        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}&destination_place_id=${job.place_id || ''}`}
                          target="_blank" rel="noopener noreferrer"
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-text-tertiary hover:text-primary transition-colors" title="Navigate">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                        </a>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-text-secondary flex-wrap">
                      {job.start_time && job.end_time && (
                        <span className="font-medium" style={{ color: teamColor }}>
                          {formatTime(job.start_time)} – {formatTime(job.end_time)}
                        </span>
                      )}
                      <span>{formatDuration(job.duration_minutes)}</span>
                      {assignedNames.length > 0 && (
                        <>
                          <span>·</span>
                          <span>{assignedNames.join(', ')}</span>
                        </>
                      )}
                    </div>

                    {job.notes && (
                      <div className="mt-2 pt-2 border-t border-border-light">
                        <p className="text-xs text-text-secondary">
                          <span className="font-medium text-text-tertiary">Notes: </span>{job.notes}
                        </p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Checklist Modal */}
      {checklistClientId && (
        <Suspense fallback={null}>
          <StaffChecklistView
            clientId={checklistClientId}
            clientName={checklistClientName}
            scheduleJobId={checklistJobId || undefined}
            onClose={() => { setChecklistClientId(null); setChecklistJobId(null); }}
          />
        </Suspense>
      )}
    </div>
  );
}
