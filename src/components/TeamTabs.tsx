'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { TEAM_COLORS, ScheduleAction, AppState } from '@/lib/types';

interface StaffOption {
  id: string;
  name: string;
  hourly_rate: number;
}

interface TeamTabsProps {
  state: AppState;
  dispatch: React.Dispatch<ScheduleAction>;
  onSelectTeam: (teamId: string) => void;
  onAddTeam?: () => void;
  onRemoveTeam?: (teamId: string) => void;
  onChangeTeamColor?: (teamId: string, colorIndex: number) => void;
  onChangeTeamName?: (teamId: string, name: string) => void;
  teamStaffMap?: Map<string, StaffOption[]>;
}

// ── Portal Popover ─────────────────────────────────────────────────────────────
interface PopoverPortalProps {
  anchorRect: DOMRect | null;
  children: React.ReactNode;
  placement?: 'above' | 'below';
  minWidth?: number;
}

function PopoverPortal({ anchorRect, children, placement = 'below', minWidth = 180 }: PopoverPortalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || !anchorRect) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchorRect.left, window.innerWidth - minWidth - 8),
    minWidth,
    zIndex: 99999,
    pointerEvents: placement === 'below' ? 'auto' : 'none',
  };

  if (placement === 'above') {
    style.bottom = window.innerHeight - anchorRect.top + 8;
  } else {
    style.top = anchorRect.bottom + 8;
  }

  return createPortal(<div style={style}>{children}</div>, document.body);
}

export default function TeamTabs({
  state, dispatch, onSelectTeam, onAddTeam, onRemoveTeam,
  onChangeTeamColor, onChangeTeamName, teamStaffMap,
}: TeamTabsProps) {
  const { teams, activeTeamId } = state;
  const [colorPickerTeamId, setColorPickerTeamId] = useState<string | null>(null);
  const [colorPickerRect, setColorPickerRect] = useState<DOMRect | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close colour picker on outside click
  useEffect(() => {
    if (!colorPickerTeamId) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setColorPickerTeamId(null);
        setColorPickerRect(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colorPickerTeamId]);

  // Auto-focus name input
  useEffect(() => {
    if (editingNameId && nameInputRef.current) nameInputRef.current.focus();
  }, [editingNameId]);

  const handleColorDotClick = (e: React.MouseEvent<HTMLButtonElement>, teamId: string) => {
    e.stopPropagation();
    if (colorPickerTeamId === teamId) {
      setColorPickerTeamId(null);
      setColorPickerRect(null);
    } else {
      setColorPickerTeamId(teamId);
      setColorPickerRect(e.currentTarget.getBoundingClientRect());
    }
  };

  const handleColorSelect = (teamId: string, colorIndex: number) => {
    if (onChangeTeamColor) onChangeTeamColor(teamId, colorIndex);
    else dispatch({ type: 'SET_TEAM_COLOR', teamId, colorIndex });
    setColorPickerTeamId(null);
    setColorPickerRect(null);
  };

  const handleNameDoubleClick = (e: React.MouseEvent, teamId: string, currentName: string) => {
    e.stopPropagation();
    setEditingNameId(teamId);
    setEditingNameValue(currentName);
  };

  const handleNameCommit = (teamId: string) => {
    const trimmed = editingNameValue.trim();
    if (trimmed) {
      if (onChangeTeamName) onChangeTeamName(teamId, trimmed);
      else dispatch({ type: 'RENAME_TEAM', teamId, name: trimmed });
    }
    setEditingNameId(null);
  };

  const handleMouseEnter = useCallback((id: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredTabId(id);
    setHoveredRect(e.currentTarget.getBoundingClientRect());
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredTabId(null);
      setHoveredRect(null);
    }, 120);
  }, []);

  const handlePopoverEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  }, []);

  const handlePopoverLeave = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredTabId(null);
      setHoveredRect(null);
    }, 120);
  }, []);

  useEffect(() => {
    return () => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); };
  }, []);

  return (
    <div className="flex items-center gap-1.5 px-1">
      {/* View All tab — always visible in week view */}
      {state.viewMode === 'week' && (
        <div
          className="relative"
          onMouseEnter={(e) => handleMouseEnter('all', e)}
          onMouseLeave={handleMouseLeave}
        >
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
          </motion.div>

          {/* All-tab hover popover — below */}
          <AnimatePresence>
            {hoveredTabId === 'all' && hoveredRect && (
              <PopoverPortal anchorRect={hoveredRect} placement="below" minWidth={180}>
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.96 }}
                  transition={{ duration: 0.12 }}
                  className="bg-white rounded-xl border border-border-light shadow-lg p-3"
                  onMouseEnter={handlePopoverEnter}
                  onMouseLeave={handlePopoverLeave}
                >
                  <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">All Teams</p>
                  <div className="space-y-1.5">
                    {teams.map(t => (
                      <div key={t.id} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.color.primary }} />
                        <span className="text-xs font-medium text-text-primary flex-1 truncate">{t.name}</span>
                        <span className="text-[10px] text-text-tertiary font-medium shrink-0">
                          {t.clients.length} job{t.clients.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    ))}
                    {teams.length > 0 && (
                      <div className="pt-1.5 mt-1.5 border-t border-border-light flex items-center justify-between">
                        <span className="text-[10px] text-text-tertiary">Total</span>
                        <span className="text-[10px] font-bold text-text-primary">
                          {teams.reduce((s, t) => s + t.clients.length, 0)} jobs
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              </PopoverPortal>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Team tabs */}
      {teams.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i).map((team) => {
        const isActive = team.id === activeTeamId;
        const assignedStaff = teamStaffMap?.get(team.id) || [];
        const showPicker = colorPickerTeamId === team.id;

        return (
          <div
            key={team.id}
            className="relative"
            onMouseEnter={(e) => handleMouseEnter(team.id, e)}
            onMouseLeave={handleMouseLeave}
          >
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
                <span onDoubleClick={(e) => handleNameDoubleClick(e, team.id, team.name)} title="Double-click to rename">
                  {team.name}
                </span>
              )}

              {/* Remove team button */}
              {teams.length > 1 && isActive && onRemoveTeam && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); if (onRemoveTeam) onRemoveTeam(team.id); else dispatch({ type: 'REMOVE_TEAM', teamId: team.id }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); if (onRemoveTeam) onRemoveTeam(team.id); else dispatch({ type: 'REMOVE_TEAM', teamId: team.id }); } }}
                  className="ml-0.5 p-0.5 rounded hover:bg-white/60 opacity-50 hover:opacity-100 transition-opacity"
                  title="Delete team"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </span>
              )}
            </motion.div>

            {/* ── Team hover popover (below) ── */}
            <AnimatePresence>
              {hoveredTabId === team.id && !showPicker && hoveredRect && (
                <PopoverPortal anchorRect={hoveredRect} placement="below" minWidth={180}>
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.12 }}
                    className="bg-white rounded-xl border border-border-light shadow-lg p-3"
                    onMouseEnter={handlePopoverEnter}
                    onMouseLeave={handlePopoverLeave}
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: team.color.primary }} />
                      <span className="text-xs font-bold text-text-primary flex-1">{team.name}</span>
                      <span className="text-[10px] text-text-tertiary font-medium">{team.clients.length} job{team.clients.length !== 1 ? 's' : ''}</span>
                    </div>
                    {/* Staff list — only shown in day view (staff change per day so meaningless in week view) */}
                    {state.viewMode === 'day' && (
                      assignedStaff.length > 0 ? (
                        <div>
                          <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">Staff today</span>
                          <div className="mt-1 space-y-0.5">
                            {assignedStaff.map(s => (
                              <div key={s.id} className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary shrink-0" />
                                <span className="text-xs text-text-secondary truncate">{s.name}</span>
                                {s.id === team.driverStaffId && (
                                  <span className="ml-auto text-[9px] font-bold uppercase tracking-wider" style={{ color: team.color.primary }}>Driver</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-text-tertiary italic">No staff assigned today</p>
                      )
                    )}
                  </motion.div>
                </PopoverPortal>
              )}
            </AnimatePresence>

            {/* ── Colour Picker Popover ── */}
            <AnimatePresence>
              {showPicker && colorPickerRect && (
                <PopoverPortal anchorRect={colorPickerRect} placement="below" minWidth={160}>
                  <motion.div
                    ref={pickerRef}
                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.12 }}
                    className="bg-white rounded-2xl border border-border-light shadow-[0_8px_32px_rgba(0,0,0,0.14)] p-3"
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
                </PopoverPortal>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Add team button */}
      {onAddTeam && (
        <motion.button
          onClick={() => { if (onAddTeam) onAddTeam(); else dispatch({ type: 'ADD_TEAM' }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-text-tertiary hover:text-text-secondary hover:bg-surface-hover transition-all cursor-pointer"
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
