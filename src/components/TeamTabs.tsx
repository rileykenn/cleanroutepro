'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TEAM_COLORS, ScheduleAction, AppState } from '@/lib/types';

interface TeamTabsProps {
  state: AppState;
  dispatch: React.Dispatch<ScheduleAction>;
  onSelectTeam: (teamId: string) => void;
  onAddTeam?: () => void;
  onRemoveTeam?: (teamId: string) => void;
  onChangeTeamColor?: (teamId: string, colorIndex: number) => void;
  onChangeTeamName?: (teamId: string, name: string) => void;
  teamStaffMap?: Map<string, { id: string; name: string; hourly_rate: number }[]>;
}

export default function TeamTabs({
  state, dispatch, onSelectTeam, onAddTeam, onRemoveTeam,
  onChangeTeamColor, onChangeTeamName, teamStaffMap,
}: TeamTabsProps) {
  const { teams, activeTeamId } = state;
  const [colorPickerTeamId, setColorPickerTeamId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Close colour picker on outside click
  useEffect(() => {
    if (!colorPickerTeamId) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setColorPickerTeamId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickerTeamId]);

  // Auto-focus name input
  useEffect(() => {
    if (editingNameId && nameInputRef.current) nameInputRef.current.focus();
  }, [editingNameId]);

  const handleColorDotClick = (e: React.MouseEvent, teamId: string) => {
    e.stopPropagation();
    setColorPickerTeamId(prev => prev === teamId ? null : teamId);
  };

  const handleColorSelect = (teamId: string, colorIndex: number) => {
    if (onChangeTeamColor) {
      onChangeTeamColor(teamId, colorIndex);
    } else {
      dispatch({ type: 'SET_TEAM_COLOR', teamId, colorIndex });
    }
    setColorPickerTeamId(null);
  };

  const handleNameDoubleClick = (e: React.MouseEvent, teamId: string, currentName: string) => {
    e.stopPropagation();
    setEditingNameId(teamId);
    setEditingNameValue(currentName);
  };

  const handleNameCommit = (teamId: string) => {
    const trimmed = editingNameValue.trim();
    if (trimmed) {
      if (onChangeTeamName) {
        onChangeTeamName(teamId, trimmed);
      } else {
        dispatch({ type: 'RENAME_TEAM', teamId, name: trimmed });
      }
    }
    setEditingNameId(null);
  };

  return (
    <div className="flex items-center gap-1.5 px-1">
      {/* View All tab — always visible in week view */}
      {state.viewMode === 'week' && (
        <motion.div
          onClick={() => onSelectTeam('all')}
          className="relative flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all cursor-pointer select-none"
          style={{
            backgroundColor: activeTeamId === 'all' ? '#F3F4F6' : 'transparent',
            color: activeTeamId === 'all' ? '#111827' : '#6B7280',
            border: activeTeamId === 'all' ? '1px solid #E5E7EB' : '1px solid transparent',
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
          <span>All</span>
          {(() => {
            const total = teams.reduce((s, t) => s + t.clients.length, 0);
            return total > 0 ? (
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                style={{ backgroundColor: activeTeamId === 'all' ? '#374151' : '#E5E7EB', color: activeTeamId === 'all' ? 'white' : '#6B7280' }}>
                {total}
              </span>
            ) : null;
          })()}
        </motion.div>
      )}

      {/* Team tabs — deduplicate by ID as a safety net against race-condition duplicates */}
      {teams.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i).map((team) => {
        const isActive = team.id === activeTeamId;
        const assignedStaff = teamStaffMap?.get(team.id) || [];
        const showPicker = colorPickerTeamId === team.id;

        return (
          <div key={team.id} className="relative">
            <motion.div
              onClick={() => onSelectTeam(team.id)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all cursor-pointer select-none"
              style={{
                backgroundColor: isActive ? team.color.light : 'transparent',
                color: isActive ? team.color.text : '#6B7280',
                border: isActive ? `1px solid ${team.color.border}` : '1px solid transparent',
              }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {/* Colour dot — click to open colour picker */}
              <button
                onClick={(e) => handleColorDotClick(e, team.id)}
                title="Change team colour"
                className="team-dot hover:scale-125 transition-transform shrink-0"
                style={{ backgroundColor: team.color.primary }}
              />

              {/* Team name — double-click to rename */}
              {editingNameId === team.id ? (
                <input
                  ref={nameInputRef}
                  value={editingNameValue}
                  onChange={e => setEditingNameValue(e.target.value)}
                  onBlur={() => handleNameCommit(team.id)}
                  onKeyDown={e => { if (e.key === 'Enter') handleNameCommit(team.id); if (e.key === 'Escape') setEditingNameId(null); }}
                  onClick={e => e.stopPropagation()}
                  className="text-sm font-medium bg-transparent border-b border-current outline-none w-20"
                  style={{ color: team.color.text }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => handleNameDoubleClick(e, team.id, team.name)}
                  title="Double-click to rename"
                >
                  {team.name}
                </span>
              )}

              {/* Client count badge */}
              {team.clients.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                  style={{
                    backgroundColor: isActive ? team.color.primary : '#E5E7EB',
                    color: isActive ? 'white' : '#6B7280',
                  }}>
                  {team.clients.length}
                </span>
              )}

              {/* Staff headcount */}
              {assignedStaff.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: isActive ? `${team.color.primary}20` : '#F3F4F6',
                    color: isActive ? team.color.text : '#9CA3AF',
                  }}
                  title={assignedStaff.map(s => s.name).join(', ')}>
                  👤 {assignedStaff.length}
                </span>
              )}

              {/* Remove team button */}
              {teams.length > 1 && isActive && onRemoveTeam && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRemoveTeam) onRemoveTeam(team.id);
                    else dispatch({ type: 'REMOVE_TEAM', teamId: team.id });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      if (onRemoveTeam) onRemoveTeam(team.id);
                      else dispatch({ type: 'REMOVE_TEAM', teamId: team.id });
                    }
                  }}
                  className="ml-0.5 p-0.5 rounded hover:bg-white/60 opacity-50 hover:opacity-100 transition-opacity"
                  title="Delete team"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </span>
              )}
            </motion.div>

            {/* ── Colour Picker Popover ────────────────────────────────── */}
            <AnimatePresence>
              {showPicker && (
                <motion.div
                  ref={pickerRef}
                  initial={{ opacity: 0, y: -4, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.96 }}
                  transition={{ duration: 0.12 }}
                  className="absolute left-0 top-full mt-2 bg-white rounded-2xl border border-border-light shadow-[0_8px_32px_rgba(0,0,0,0.14)] p-3 z-50"
                  style={{ minWidth: '160px' }}
                  onClick={e => e.stopPropagation()}
                >
                  <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Team Colour</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {TEAM_COLORS.map((color, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleColorSelect(team.id, idx)}
                        title={color.name}
                        className="w-8 h-8 rounded-full transition-transform hover:scale-110 active:scale-95 flex items-center justify-center"
                        style={{ backgroundColor: color.primary }}
                      >
                        {team.colorIndex === idx && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Add team button */}
      {onAddTeam && (
        <motion.button
          onClick={() => { if (onAddTeam) onAddTeam(); else dispatch({ type: 'ADD_TEAM' }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-text-tertiary
                   hover:text-text-secondary hover:bg-surface-hover transition-all cursor-pointer"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Team
        </motion.button>
      )}

    </div>
  );
}
