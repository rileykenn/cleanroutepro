'use client';

import { motion } from 'framer-motion';
import { TEAM_COLORS, ScheduleAction, AppState } from '@/lib/types';

interface TeamTabsProps {
  state: AppState;
  dispatch: React.Dispatch<ScheduleAction>;
  onSelectTeam: (teamId: string) => void;
  onAddTeam?: () => void;
  onRemoveTeam?: (teamId: string) => void;
  teamStaffMap?: Map<string, { id: string; name: string; hourly_rate: number }[]>;
}

export default function TeamTabs({ state, dispatch, onSelectTeam, onAddTeam, onRemoveTeam, teamStaffMap }: TeamTabsProps) {
  const { teams, activeTeamId } = state;

  return (
    <div className="flex items-center gap-2 px-1">
      {teams.map((team, index) => {
        const isActive = team.id === activeTeamId;
        const assignedStaff = teamStaffMap?.get(team.id) || [];
        return (
          <motion.div
            key={team.id}
            onClick={() => onSelectTeam(team.id)}
            className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer"
            style={{
              backgroundColor: isActive ? team.color.light : 'transparent',
              color: isActive ? team.color.text : '#6B7280',
              border: isActive ? `1px solid ${team.color.border}` : '1px solid transparent',
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div
              className="team-dot"
              style={{ backgroundColor: team.color.primary }}
            />
            <span>Team {index + 1}</span>
            {team.clients.length > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                style={{
                  backgroundColor: isActive ? team.color.primary : '#E5E7EB',
                  color: isActive ? 'white' : '#6B7280',
                }}
              >
                {team.clients.length}
              </span>
            )}

            {/* Staff headcount from roster */}
            {assignedStaff.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: isActive ? `${team.color.primary}20` : '#F3F4F6',
                  color: isActive ? team.color.text : '#9CA3AF',
                }}
                title={assignedStaff.map(s => s.name).join(', ')}
              >
                👤 {assignedStaff.length}
              </span>
            )}

            {/* Remove team button */}
            {teams.length > 1 && isActive && (
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
                className="ml-1 p-0.5 rounded hover:bg-white/60 text-current opacity-50 hover:opacity-100 transition-opacity"
                title="Remove team"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </span>
            )}
          </motion.div>
        );
      })}

      {/* Add team button — unlimited teams per scope */}
      <motion.button
        onClick={() => { if (onAddTeam) onAddTeam(); else dispatch({ type: 'ADD_TEAM' }); }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-text-tertiary
                 hover:text-text-secondary hover:bg-surface-hover transition-all cursor-pointer"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add Team
      </motion.button>
    </div>
  );
}
