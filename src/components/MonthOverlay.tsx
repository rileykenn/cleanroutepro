'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { getMonthCalendarDates, isToday, getTodayISO } from '@/lib/timeUtils';

interface MonthOverlayProps {
  scheduledDates: Map<string, { clientCount: number; isPublished: boolean; templateCode?: string }>;
  onDayClick: (date: string) => void;
  onClose: () => void;
}

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MonthOverlay({ scheduledDates, onDayClick, onClose }: MonthOverlayProps) {
  const today = getTodayISO();
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const weeks = useMemo(() => getMonthCalendarDates(viewDate.year, viewDate.month), [viewDate.year, viewDate.month]);

  const monthLabel = new Date(viewDate.year, viewDate.month, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    setViewDate((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
  };
  const nextMonth = () => {
    setViewDate((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h3 className="text-base font-bold text-text-primary">{monthLabel}</h3>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {/* Calendar grid */}
        <div className="p-4">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAY_HEADERS.map((d) => (
              <div key={d} className="text-center text-[10px] font-bold text-text-tertiary uppercase">{d}</div>
            ))}
          </div>

          {/* Week rows */}
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((date) => {
                  const d = new Date(date + 'T00:00:00');
                  const isCurrentMonth = d.getMonth() === viewDate.month;
                  const isTodayDate = isToday(date);
                  const info = scheduledDates.get(date);

                  return (
                    <button
                      key={date}
                      onClick={() => { onDayClick(date); onClose(); }}
                      className={`relative aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-sm transition-all ${
                        isTodayDate
                          ? 'bg-primary text-white font-bold'
                          : isCurrentMonth
                            ? info
                              ? 'bg-primary-light text-primary font-medium hover:bg-primary hover:text-white'
                              : 'text-text-primary hover:bg-surface-hover'
                            : 'text-text-tertiary/40'
                      }`}
                    >
                      <span className="text-xs">{d.getDate()}</span>
                      {info && (
                        <div className="flex items-center gap-0.5">
                          {info.isPublished && <span className="w-1.5 h-1.5 rounded-full bg-success" />}
                          <span className={`text-[8px] font-bold ${isTodayDate ? 'text-white/80' : 'text-primary/60'}`}>
                            {info.clientCount}
                          </span>
                          {info.templateCode && (
                            <span className={`text-[7px] font-bold ${isTodayDate ? 'text-white/60' : 'text-primary/40'}`}>
                              {info.templateCode}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="px-5 py-3 border-t border-border-light flex items-center gap-4 text-[10px] text-text-tertiary">
          <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> Today</div>
          <div className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-primary-light" /> Scheduled</div>
          <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Published</div>
        </div>
      </motion.div>
    </motion.div>
  );
}
