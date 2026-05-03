'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { TeamSchedule } from '@/lib/types';

interface StaffMember {
  id: string; name: string; role: string;
  available_days: number[] | null;
}

interface StaffAssignment {
  id: string; staff_id: string; team_id: string | null;
  assignment_date: string; is_available: boolean;
}

interface StaffRosterPanelProps {
  orgId: string | null;
  selectedDate: string;
  teams: TeamSchedule[];
  activeTeamId: string;
  onRosterChange: () => void;
}

export default function StaffRosterPanel({ orgId, selectedDate, teams, activeTeamId, onRosterChange }: StaffRosterPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [sickSwapStaffId, setSickSwapStaffId] = useState<string | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const activeTeam = teams.find((t) => t.id === activeTeamId);

  const dayOfWeek = useMemo(() => {
    const parts = selectedDate.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  }, [selectedDate]);

  const loadData = useCallback(async () => {
    if (!orgId) return;
    const [{ data: staffData }, { data: assignData }] = await Promise.all([
      supabase.from('staff_members').select('id, name, role, available_days').eq('org_id', orgId).order('name'),
      supabase.from('staff_assignments').select('*').eq('org_id', orgId).eq('assignment_date', selectedDate),
    ]);
    if (staffData) setStaff(staffData);
    if (assignData) setAssignments(assignData);
    setLoaded(true);
  }, [orgId, supabase, selectedDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // Close picker on outside click
  useEffect(() => {
    if (!showAddPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
          addBtnRef.current && !addBtnRef.current.contains(e.target as Node)) {
        setShowAddPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddPicker]);

  // Helpers
  const getAssignment = (staffId: string) => assignments.find((a) => a.staff_id === staffId);
  const isNormallyAvailable = (s: StaffMember) => {
    if (!s.available_days || s.available_days.length === 0) return true;
    return s.available_days.includes(dayOfWeek);
  };

  // Staff assigned to THIS team
  const thisTeamStaff = staff.filter((s) => {
    const a = getAssignment(s.id);
    return a && a.team_id === activeTeamId && a.is_available !== false;
  });

  // Staff who are sick (on this team — were assigned here)
  const sickOnThisTeam = staff.filter((s) => {
    const a = getAssignment(s.id);
    return a && a.team_id === activeTeamId && a.is_available === false;
  });

  // Available unassigned staff (for the add picker)
  const availableUnassigned = staff.filter((s) => {
    if (!isNormallyAvailable(s)) return false;
    const a = getAssignment(s.id);
    if (a && a.is_available === false) return false; // sick
    if (a && a.team_id) return false; // assigned to some team
    return true;
  });

  // Actions
  const assignToThisTeam = async (staffId: string) => {
    if (!orgId) return;
    const existing = getAssignment(staffId);
    if (existing) {
      await supabase.from('staff_assignments').update({ team_id: activeTeamId, is_available: true }).eq('id', existing.id);
      setAssignments((p) => p.map((a) => a.id === existing.id ? { ...a, team_id: activeTeamId, is_available: true } : a));
    } else {
      const { data } = await supabase.from('staff_assignments').insert({
        org_id: orgId, staff_id: staffId, team_id: activeTeamId, assignment_date: selectedDate, is_available: true,
      }).select().single();
      if (data) setAssignments((p) => [...p, data]);
    }
    onRosterChange();
  };

  const removeFromTeam = async (staffId: string) => {
    if (!orgId) return;
    const existing = getAssignment(staffId);
    if (existing) {
      await supabase.from('staff_assignments').delete().eq('id', existing.id);
      setAssignments((p) => p.filter((a) => a.id !== existing.id));
    }
    onRosterChange();
  };

  const markSick = async (staffId: string) => {
    if (!orgId) return;
    const existing = getAssignment(staffId);
    if (existing) {
      await supabase.from('staff_assignments').update({ is_available: false }).eq('id', existing.id);
      setAssignments((p) => p.map((a) => a.id === existing.id ? { ...a, is_available: false } : a));
    } else {
      const { data } = await supabase.from('staff_assignments').insert({
        org_id: orgId, staff_id: staffId, team_id: activeTeamId, assignment_date: selectedDate, is_available: false,
      }).select().single();
      if (data) setAssignments((p) => [...p, data]);
    }
    setSickSwapStaffId(staffId);
    onRosterChange();
  };

  const markAvailable = async (staffId: string) => {
    if (!orgId) return;
    const existing = getAssignment(staffId);
    if (existing) {
      await supabase.from('staff_assignments').update({ is_available: true }).eq('id', existing.id);
      setAssignments((p) => p.map((a) => a.id === existing.id ? { ...a, is_available: true } : a));
    }
    setSickSwapStaffId(null);
    onRosterChange();
  };

  const quickSwap = async (replacementId: string) => {
    await assignToThisTeam(replacementId);
    setSickSwapStaffId(null);
  };

  if (!loaded || !orgId || staff.length === 0) return null;

  const sickPerson = sickSwapStaffId ? staff.find((s) => s.id === sickSwapStaffId) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
      className="card p-3">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: activeTeam?.color.primary }} />
        <span className="text-xs font-bold text-text-primary">{activeTeam?.name || 'Team'} Crew</span>
        <span className="text-[10px] text-text-tertiary">{thisTeamStaff.length} staff</span>
      </div>

      {/* Assigned staff chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {thisTeamStaff.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-border-light group/chip"
          >
            <span className="text-text-primary">{s.name}</span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover/chip:opacity-100 transition-opacity">
              <button
                onClick={() => markSick(s.id)}
                className="p-0.5 rounded hover:bg-red-50 text-text-tertiary hover:text-red-500 transition-colors"
                title="Mark sick"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                </svg>
              </button>
              <button
                onClick={() => removeFromTeam(s.id)}
                className="p-0.5 rounded hover:bg-red-50 text-text-tertiary hover:text-red-500 transition-colors"
                title="Remove from team"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        ))}

        {/* Sick staff chips */}
        {sickOnThisTeam.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-100"
          >
            <span className="text-red-400 line-through">{s.name}</span>
            <span className="text-[9px] text-red-400">Sick</span>
            <button
              onClick={() => markAvailable(s.id)}
              className="p-0.5 rounded hover:bg-emerald-50 text-red-300 hover:text-emerald-600 transition-colors"
              title="Mark available"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>
        ))}

        {/* Add button */}
        <div className="relative">
          <button
            ref={addBtnRef}
            onClick={() => setShowAddPicker(!showAddPicker)}
            className="flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-primary px-2 py-1.5 rounded-lg border border-dashed border-border-light hover:border-primary hover:bg-primary-light/30 transition-all"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>

          {/* Add Staff Popover */}
          <AnimatePresence>
            {showAddPicker && (
              <motion.div
                ref={pickerRef}
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 mt-1.5 z-30 w-52 bg-white rounded-xl shadow-lg border border-border-light p-2"
              >
                <div className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider px-2 py-1">Available Staff</div>
                {availableUnassigned.length === 0 ? (
                  <div className="text-xs text-text-tertiary px-2 py-3 text-center">No available staff</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                    {availableUnassigned.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { assignToThisTeam(s.id); setShowAddPicker(false); }}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-xs hover:bg-surface-hover transition-colors text-left"
                      >
                        <div className="w-6 h-6 rounded-full bg-primary-light flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                          {s.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-text-primary block truncate">{s.name}</span>
                          <span className="text-[10px] text-text-tertiary capitalize">{s.role}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Sick swap banner */}
      <AnimatePresence>
        {sickPerson && availableUnassigned.filter((s) => s.id !== sickSwapStaffId).length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 pt-2 border-t border-border-light">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-amber-700">🔄 Replace {sickPerson.name}?</span>
                <button onClick={() => setSickSwapStaffId(null)} className="text-[10px] text-text-tertiary hover:text-text-secondary">Skip</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {availableUnassigned.filter((s) => s.id !== sickSwapStaffId).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => quickSwap(s.id)}
                    className="text-[11px] font-medium px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {thisTeamStaff.length === 0 && sickOnThisTeam.length === 0 && (
        <div className="text-[11px] text-text-tertiary mt-1">No staff assigned. Tap + Add to assign.</div>
      )}
    </motion.div>
  );
}
