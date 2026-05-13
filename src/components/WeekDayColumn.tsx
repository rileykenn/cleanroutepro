'use client';

import { motion } from 'framer-motion';
import { DaySchedule, TeamColor } from '@/lib/types';
import { formatTimeDisplay, isToday, getShortDayLabel } from '@/lib/timeUtils';

interface WeekDayColumnProps {
  daySchedule: DaySchedule;
  teamColor: TeamColor;
  isActive: boolean;
  onDayClick: () => void;
  /** Per-client color override (used in All Teams mode) */
  clientColorMap?: Record<string, string>;
  /** Staff ID → name lookup */
  staffNameMap?: Record<string, string>;
}

export default function WeekDayColumn({ daySchedule, teamColor, isActive, onDayClick, clientColorMap, staffNameMap }: WeekDayColumnProps) {
  const today = isToday(daySchedule.date);
  const clients = daySchedule.clients;
  const hasJobs = clients.length > 0;

  return (
    <div
      className={`flex flex-col min-w-[160px] flex-1 rounded-2xl border transition-all cursor-pointer ${
        isActive
          ? 'border-primary shadow-glow-primary bg-white'
          : today
            ? 'border-primary-border bg-primary-light/30'
            : 'border-border-light bg-white hover:border-border hover:shadow-card'
      }`}
      onClick={onDayClick}
    >
      {/* Day header */}
      <div className="px-4 py-3 border-b border-border-light shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-bold ${today ? 'text-primary' : 'text-text-primary'}`}>
              {getShortDayLabel(daySchedule.date)}
            </span>
            {today && (
              <span className="text-[10px] font-bold bg-primary text-white px-2 py-0.5 rounded-full uppercase tracking-wide">Today</span>
            )}
          </div>
          {daySchedule.isPublished && (
            <span className="w-2.5 h-2.5 rounded-full bg-success shrink-0" title="Published" />
          )}
        </div>
      </div>

      {/* Jobs list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5 min-h-[140px]">
        {!hasJobs ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[12px] text-text-tertiary">No jobs</p>
          </div>
        ) : (
          clients.map((client, i) => {
            const borderColor = clientColorMap?.[client.id] || teamColor.primary;
            return (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="rounded-xl p-2.5 border border-border-light hover:border-border transition-colors"
                style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  {client.startTime && (
                    <span className="text-[11px] font-bold text-text-secondary">
                      {formatTimeDisplay(client.startTime)}
                    </span>
                  )}
                  <span className="text-[10px] text-text-tertiary font-medium">{client.jobDurationMinutes}m</span>
                </div>
                <p className="text-[12px] font-semibold text-text-primary leading-tight truncate">{client.name || 'Unnamed'}</p>
                {client.startTime && client.endTime && (
                  <p className="text-[10px] text-text-tertiary mt-0.5 font-medium">
                    {formatTimeDisplay(client.startTime)} – {formatTimeDisplay(client.endTime)}
                  </p>
                )}
                {staffNameMap && client.assignedStaffIds && client.assignedStaffIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {client.assignedStaffIds.map((id) => {
                      const name = staffNameMap[id];
                      if (!name) return null;
                      return (
                        <span key={id} className="text-[9px] font-semibold text-text-tertiary bg-surface-elevated px-1.5 py-0.5 rounded-md">
                          {name.split(' ')[0]}
                        </span>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      {/* Footer summary */}
      {hasJobs && (
        <div className="px-4 py-2 border-t border-border-light shrink-0">
          <span className="text-[11px] font-semibold text-text-tertiary">{clients.length} client{clients.length !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
