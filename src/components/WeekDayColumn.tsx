'use client';

import { useState, useRef, useEffect } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { motion, AnimatePresence } from 'framer-motion';
import { DaySchedule, TeamColor, Client } from '@/lib/types';
import { formatTimeDisplay, isToday, getShortDayLabel } from '@/lib/timeUtils';
import { ScheduleWarning, maxWarningLevel } from '@/lib/scheduleWarnings';

interface WeekDayColumnProps {
  daySchedule: DaySchedule;
  teamColor: TeamColor;
  isActive: boolean;
  onDayClick: () => void;
  /** Per-client color override (used in All Teams mode) */
  clientColorMap?: Record<string, string>;
  /** Staff ID → name lookup */
  staffNameMap?: Record<string, string>;
  /** Warnings for this day */
  warnings?: ScheduleWarning[];
}

// ─── Warning badge + popover ──────────────────────────────────────────────────
function WarningBadge({ warnings, onOpenChange }: { warnings: ScheduleWarning[]; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const level = maxWarningLevel(warnings);

  const toggle = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) toggle(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!level) return null;

  const colors = {
    error:   { bg: 'bg-red-500',    ring: 'ring-red-300',    popBorder: 'border-red-200' },
    warning: { bg: 'bg-amber-500',  ring: 'ring-amber-300',  popBorder: 'border-amber-200' },
    info:    { bg: 'bg-blue-500',   ring: 'ring-blue-300',   popBorder: 'border-blue-200' },
  }[level];

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => toggle(!open)}
        className={`w-5 h-5 rounded-full ${colors.bg} flex items-center justify-center ring-2 ${colors.ring} transition-all hover:scale-110 shrink-0`}
        title={`${warnings.length} issue${warnings.length > 1 ? 's' : ''} — click to view`}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute left-0 top-full mt-1.5 w-72 rounded-xl border shadow-xl p-3 space-y-2 bg-white ${colors.popBorder}`}
            style={{ minWidth: '260px', zIndex: 9999 }}
          >
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-1">
              {warnings.length} Issue{warnings.length > 1 ? 's' : ''} Today
            </p>
            {warnings.map(w => {
              const wColors = {
                error:   { border: 'border-l-red-400',   title: 'text-red-700',   body: 'text-red-600' },
                warning: { border: 'border-l-amber-400', title: 'text-amber-700', body: 'text-amber-600' },
                info:    { border: 'border-l-blue-400',  title: 'text-blue-700',  body: 'text-blue-600' },
              }[w.level];
              return (
                <div key={w.id} className={`border-l-2 pl-2 ${wColors.border}`}>
                  <p className={`text-[11px] font-semibold ${wColors.title}`}>{w.title}</p>
                  <p className={`text-[10px] mt-0.5 leading-relaxed ${wColors.body}`}>{w.detail}</p>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Draggable job card ───────────────────────────────────────────────────────
function DraggableJobCard({
  client,
  borderColor,
  scheduleId,
  date,
  index,
  staffNameMap,
}: {
  client: Client;
  borderColor: string;
  scheduleId: string | null;
  date: string;
  index: number;
  staffNameMap?: Record<string, string>;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `job-${client.id}`,
    data: { type: 'job', job: client, scheduleId, date },
  });

  return (
    <motion.div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
        opacity: isDragging ? 0.35 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      {...listeners}
      {...attributes}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: isDragging ? 0.35 : 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className="rounded-lg p-2 border border-border-light hover:border-border transition-colors select-none"
    >
      <div className="flex items-center justify-between gap-1 mb-0.5">
        {client.startTime && (
          <span className="text-[10px] font-bold text-text-secondary">
            {formatTimeDisplay(client.startTime)}
          </span>
        )}
        <span className="text-[9px] text-text-tertiary">{client.jobDurationMinutes}m</span>
      </div>
      <p className="text-[11px] font-medium text-text-primary leading-tight truncate">
        {client.name || 'Unnamed'}
      </p>
      {client.startTime && client.endTime && (
        <p className="text-[9px] text-text-tertiary mt-0.5">
          {formatTimeDisplay(client.startTime)} – {formatTimeDisplay(client.endTime)}
        </p>
      )}
      {staffNameMap && client.assignedStaffIds && client.assignedStaffIds.length > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {client.assignedStaffIds.map((id) => {
            const name = staffNameMap[id];
            if (!name) return null;
            return (
              <span key={id} className="text-[8px] font-medium text-text-tertiary bg-surface-elevated px-1 py-0.5 rounded">
                {name.split(' ')[0]}
              </span>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ─── Day column ───────────────────────────────────────────────────────────────
export default function WeekDayColumn({ daySchedule, teamColor, isActive, onDayClick, clientColorMap, staffNameMap, warnings = [] }: WeekDayColumnProps) {
  const today = isToday(daySchedule.date);
  const clients = daySchedule.clients;
  const hasJobs = clients.length > 0;
  const [warningOpen, setWarningOpen] = useState(false);

  const { isOver, setNodeRef } = useDroppable({ id: daySchedule.date });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[140px] flex-1 rounded-[16px] border transition-all duration-300 cursor-pointer relative ${
        isOver
          ? 'border-primary bg-primary/5 ring-4 ring-primary/10 shadow-[0_8px_30px_rgb(79,70,229,0.12)] scale-[1.02]'
          : today
            ? 'border-primary-border bg-primary-light/30'
            : 'border-border-light bg-white hover:border-border hover:shadow-card'
      }`}
      style={{ zIndex: warningOpen ? 50 : isOver ? 10 : 0 }}
      onClick={onDayClick}
    >
      {/* Day header */}
      <div className="px-3 py-2.5 border-b border-border-light shrink-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-xs font-bold truncate ${today ? 'text-primary' : 'text-text-primary'}`}>
              {getShortDayLabel(daySchedule.date)}
            </span>
            {today && (
              <span className="text-[9px] font-bold bg-primary text-white px-1.5 py-0.5 rounded-full shrink-0">TODAY</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {daySchedule.isPublished && (
              <span className="w-2 h-2 rounded-full bg-success shrink-0" title="Published" />
            )}
            {warnings.length > 0 && <WarningBadge warnings={warnings} onOpenChange={setWarningOpen} />}
          </div>
        </div>
      </div>

      {/* Jobs list */}
      <div data-day-scroll className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1 min-h-[120px]">
        {!hasJobs ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[10px] text-text-tertiary">No jobs</p>
          </div>
        ) : (
          clients.map((client, i) => {
            const borderColor = clientColorMap?.[client.id] || teamColor.primary;
            return (
              <DraggableJobCard
                key={client.id}
                client={client}
                borderColor={borderColor}
                scheduleId={daySchedule.scheduleId}
                date={daySchedule.date}
                index={i}
                staffNameMap={staffNameMap}
              />
            );
          })
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
