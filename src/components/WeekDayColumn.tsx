'use client';

import { motion } from 'framer-motion';
import { DaySchedule, TeamColor } from '@/lib/types';
import { formatTimeDisplay, isToday, getShortDayLabel } from '@/lib/timeUtils';

interface WeekDayColumnProps {
  daySchedule: DaySchedule;
  teamColor: TeamColor;
  isActive: boolean;
  onDayClick: () => void;
}

export default function WeekDayColumn({ daySchedule, teamColor, isActive, onDayClick }: WeekDayColumnProps) {
  const today = isToday(daySchedule.date);
  const clients = daySchedule.clients;
  const hasJobs = clients.length > 0;

  return (
    <div
      className={`flex flex-col min-w-[140px] flex-1 rounded-xl border transition-all cursor-pointer ${
        isActive
          ? 'border-primary shadow-glow-primary bg-white'
          : today
            ? 'border-primary-border bg-primary-light/30'
            : 'border-border-light bg-white hover:border-border hover:shadow-card'
      }`}
      onClick={onDayClick}
    >
      {/* Day header */}
      <div className="px-3 py-2.5 border-b border-border-light shrink-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-bold ${today ? 'text-primary' : 'text-text-primary'}`}>
              {getShortDayLabel(daySchedule.date)}
            </span>
            {today && (
              <span className="text-[9px] font-bold bg-primary text-white px-1.5 py-0.5 rounded-full">TODAY</span>
            )}
          </div>
          {daySchedule.isPublished && (
            <span className="w-2 h-2 rounded-full bg-success shrink-0" title="Published" />
          )}
        </div>
      </div>

      {/* Jobs list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1 min-h-[120px]">
        {!hasJobs ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[10px] text-text-tertiary">No jobs</p>
          </div>
        ) : (
          clients.map((client, i) => (
            <motion.div
              key={client.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="rounded-lg p-2 border border-border-light hover:border-border transition-colors"
              style={{ borderLeftWidth: 3, borderLeftColor: teamColor.primary }}
            >
              <div className="flex items-center justify-between gap-1 mb-0.5">
                {client.startTime && (
                  <span className="text-[10px] font-bold text-text-secondary">
                    {formatTimeDisplay(client.startTime)}
                  </span>
                )}
                <span className="text-[9px] text-text-tertiary">{client.jobDurationMinutes}m</span>
              </div>
              <p className="text-[11px] font-medium text-text-primary leading-tight truncate">{client.name || 'Unnamed'}</p>
              {client.startTime && client.endTime && (
                <p className="text-[9px] text-text-tertiary mt-0.5">
                  {formatTimeDisplay(client.startTime)} – {formatTimeDisplay(client.endTime)}
                </p>
              )}
            </motion.div>
          ))
        )}
      </div>

      {/* Footer summary */}
      {hasJobs && (
        <div className="px-3 py-1.5 border-t border-border-light shrink-0">
          <span className="text-[10px] font-medium text-text-tertiary">{clients.length} client{clients.length !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
