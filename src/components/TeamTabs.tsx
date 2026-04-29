'use client';

import { motion } from 'framer-motion';
import { TeamSchedule, ScheduleAction } from '@/lib/types';

interface TeamTabsProps {
  teams: TeamSchedule[];
  activeTeamId: string;
  dispatch: React.Dispatch<ScheduleAction>;
  onAddTeam: () => void;
  onRemoveTeam: (teamId: string) => void;
}

export default function TeamTabs({ teams, activeTeamId, dispatch, onAddTeam, onRemoveTeam }: TeamTabsProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {teams.map((team) => {
        const isActive = team.id === activeTeamId;
        return (
          <motion.button key={team.id} whileTap={{ scale: 0.97 }}
            onClick={() => dispatch({ type: 'SET_ACTIVE_TEAM', teamId: team.id })}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap border ${
              isActive
                ? 'bg-white shadow-sm border-border'
                : 'bg-transparent border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
            style={isActive ? { borderLeft: `3px solid ${team.color.primary}` } : {}}>
            <div className="team-dot" style={{ backgroundColor: team.color.primary }} />
            {team.name}
            {teams.length > 1 && isActive && (
              <button onClick={(e) => { e.stopPropagation(); onRemoveTeam(team.id); }}
                className="ml-1 p-0.5 rounded hover:bg-danger-light hover:text-danger text-text-tertiary transition-colors"
                title="Remove team">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </motion.button>
        );
      })}
      <button onClick={onAddTeam}
        className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium text-text-tertiary hover:text-primary hover:bg-primary-light transition-all whitespace-nowrap"
        title="Add team">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Team
      </button>
    </div>
  );
}
