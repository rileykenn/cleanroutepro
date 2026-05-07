'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TeamSchedule, TEAM_COLORS, TravelSegment } from '@/lib/types';

interface DbTeam {
  id: string; org_id: string; name: string; color_index: number;
  base_address: string | null; base_lat: number | null; base_lng: number | null; base_place_id: string | null;
  return_address: string | null; return_lat: number | null; return_lng: number | null; return_place_id: string | null; return_disabled: boolean | null;
  day_start_time: string; hourly_rate: number; fuel_efficiency: number; fuel_price: number; per_km_rate: number; sort_order: number;
}

export function useTeams(authOrgId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [teams, setTeams] = useState<TeamSchedule[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync orgId from auth context
  useEffect(() => {
    if (authOrgId) setOrgId(authOrgId);
  }, [authOrgId]);

  const dbToTeam = useCallback((row: DbTeam): TeamSchedule => ({
    id: row.id, name: row.name,
    color: TEAM_COLORS[row.color_index % TEAM_COLORS.length],
    baseAddress: row.base_address ? { address: row.base_address, lat: row.base_lat || 0, lng: row.base_lng || 0, placeId: row.base_place_id || undefined } : null,
    returnAddress: row.return_disabled ? 'none' : row.return_address ? { address: row.return_address, lat: row.return_lat || 0, lng: row.return_lng || 0, placeId: row.return_place_id || undefined } : null,
    clients: [], travelSegments: new Map<string, TravelSegment>(),
    dayStartTime: row.day_start_time || '08:00', breaks: [],
    hourlyRate: Number(row.hourly_rate) || 38, fuelEfficiency: Number(row.fuel_efficiency) || 10,
    fuelPrice: Number(row.fuel_price) || 1.85, perKmRate: Number(row.per_km_rate) || 0,
  }), []);

  const loadTeams = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from('teams').select('*').eq('org_id', orgId).order('sort_order');
    if (data && data.length > 0) {
      setTeams(data.map(dbToTeam));
      setLoading(false);
    } else {
      // Auto-create a default team for new orgs
      const { data: newTeam } = await supabase.from('teams').insert({
        org_id: orgId, name: 'Team 1', color_index: 0, sort_order: 0,
        day_start_time: '08:00', hourly_rate: 38, fuel_efficiency: 10, fuel_price: 1.85, per_km_rate: 0,
      }).select().single();
      if (newTeam) setTeams([dbToTeam(newTeam)]);
      setLoading(false);
    }
  }, [supabase, orgId, dbToTeam]);

  useEffect(() => { if (orgId) loadTeams(); }, [orgId, loadTeams]);

  const addTeam = useCallback(async () => {
    if (!orgId) return null;
    const colorIndex = teams.length % TEAM_COLORS.length;
    const { data, error } = await supabase.from('teams').insert({
      org_id: orgId, name: `Team ${teams.length + 1}`, color_index: colorIndex, sort_order: teams.length,
      ...(teams[0]?.baseAddress ? { base_address: teams[0].baseAddress.address, base_lat: teams[0].baseAddress.lat, base_lng: teams[0].baseAddress.lng, base_place_id: teams[0].baseAddress.placeId || null } : {}),
    }).select().single();
    if (data && !error) { const nt = dbToTeam(data); setTeams((p) => [...p, nt]); return nt; }
    return null;
  }, [supabase, orgId, teams, dbToTeam]);

  const removeTeam = useCallback(async (teamId: string) => {
    if (teams.length <= 1) return;
    await supabase.from('teams').delete().eq('id', teamId);
    setTeams((p) => p.filter((t) => t.id !== teamId));
  }, [supabase, teams.length]);

  const updateTeam = useCallback(async (teamId: string, updates: Partial<TeamSchedule>) => {
    setTeams((p) => p.map((t) => t.id === teamId ? { ...t, ...updates } : t));
    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.dayStartTime !== undefined) dbUpdates.day_start_time = updates.dayStartTime;
    if (updates.hourlyRate !== undefined) dbUpdates.hourly_rate = updates.hourlyRate;
    if (updates.fuelEfficiency !== undefined) dbUpdates.fuel_efficiency = updates.fuelEfficiency;
    if (updates.fuelPrice !== undefined) dbUpdates.fuel_price = updates.fuelPrice;
    if (updates.perKmRate !== undefined) dbUpdates.per_km_rate = updates.perKmRate;
    if (updates.baseAddress !== undefined) {
      if (updates.baseAddress) {
        dbUpdates.base_address = updates.baseAddress.address;
        dbUpdates.base_lat = updates.baseAddress.lat;
        dbUpdates.base_lng = updates.baseAddress.lng;
        dbUpdates.base_place_id = updates.baseAddress.placeId || null;
      } else { dbUpdates.base_address = null; dbUpdates.base_lat = null; dbUpdates.base_lng = null; dbUpdates.base_place_id = null; }
    }
    if (Object.keys(dbUpdates).length > 0) await supabase.from('teams').update(dbUpdates).eq('id', teamId);
  }, [supabase]);

  return { teams, setTeams, orgId, loading, addTeam, removeTeam, updateTeam, reloadTeams: loadTeams };
}
