'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Client } from '@/lib/types';

interface DbJob {
  id: string; schedule_id: string; org_id: string; client_id: string | null;
  position: number; name: string; address: string; lat: number | null; lng: number | null; place_id: string | null;
  duration_minutes: number; staff_count: number; is_locked: boolean; fixed_start_time: string | null;
  is_break: boolean; break_label: string; notes: string; start_time: string | null; end_time: string | null;
}

export function useScheduleJobs(teamId: string | null, scheduleDate: string, orgId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialClients, setInitialClients] = useState<Client[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dbToClient = useCallback((row: DbJob): Client => ({
    id: row.id, name: row.name,
    location: { address: row.address || '', lat: row.lat || 0, lng: row.lng || 0, placeId: row.place_id || undefined },
    jobDurationMinutes: Number(row.duration_minutes) || 90, staffCount: row.staff_count || 1,
    isLocked: row.is_locked || false, fixedStartTime: row.fixed_start_time || undefined,
    startTime: row.start_time || undefined, endTime: row.end_time || undefined,
    notes: row.notes || undefined, savedClientId: row.client_id || undefined,
  }), []);

  const ensureSchedule = useCallback(async (): Promise<string | null> => {
    if (!teamId || !orgId) return null;
    const { data: existing } = await supabase.from('schedules').select('id').eq('team_id', teamId).eq('schedule_date', scheduleDate).single();
    if (existing) return existing.id;
    const { data: created } = await supabase.from('schedules').insert({ org_id: orgId, team_id: teamId, schedule_date: scheduleDate }).select('id').single();
    return created?.id || null;
  }, [supabase, teamId, orgId, scheduleDate]);

  const loadJobs = useCallback(async () => {
    if (!teamId || !orgId) { setLoading(false); return; }
    const sid = await ensureSchedule();
    setScheduleId(sid);
    if (!sid) { setLoading(false); return; }
    const { data } = await supabase.from('schedule_jobs').select('*').eq('schedule_id', sid).order('position');
    if (data) setInitialClients(data.filter((j: DbJob) => !j.is_break).map(dbToClient));
    setLoading(false);
  }, [supabase, teamId, orgId, ensureSchedule, dbToClient]);

  useEffect(() => { setLoading(true); loadJobs(); }, [loadJobs]);

  const saveClients = useCallback(async (clients: Client[]) => {
    if (!scheduleId || !orgId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await supabase.from('schedule_jobs').delete().eq('schedule_id', scheduleId);
      if (clients.length === 0) return;
      const rows = clients.map((c, i) => ({
        schedule_id: scheduleId, org_id: orgId, client_id: c.savedClientId || null,
        position: i, name: c.name, address: c.location.address, lat: c.location.lat, lng: c.location.lng,
        place_id: c.location.placeId || null, duration_minutes: c.jobDurationMinutes, staff_count: c.staffCount || 1,
        is_locked: c.isLocked || false, fixed_start_time: c.fixedStartTime || null,
        is_break: false, notes: c.notes || '', start_time: c.startTime || null, end_time: c.endTime || null,
      }));
      await supabase.from('schedule_jobs').insert(rows);
      await supabase.from('schedules').update({ updated_at: new Date().toISOString() }).eq('id', scheduleId);
    }, 1500);
  }, [supabase, scheduleId, orgId]);

  useEffect(() => { return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }; }, []);

  return { scheduleId, initialClients, loading, saveClients, reloadJobs: loadJobs };
}
