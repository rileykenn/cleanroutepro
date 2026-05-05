'use client';

import { DaySchedule, TeamColor } from '@/lib/types';
import WeekDayColumn from './WeekDayColumn';

interface WeekViewProps {
  weekDates: string[];
  daySchedules: Map<string, DaySchedule>;
  teamColor: TeamColor;
  activeDate: string;
  onDayClick: (date: string) => void;
}

export default function WeekView({ weekDates, daySchedules, teamColor, activeDate, onDayClick }: WeekViewProps) {
  return (
    <div className="flex gap-2 h-full overflow-x-auto custom-scrollbar p-3 lg:p-4">
      {weekDates.map((date) => {
        const daySchedule: DaySchedule = daySchedules.get(date) || {
          date,
          dayOfWeek: new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
          scheduleId: null,
          clients: [],
          isPublished: false,
        };

        return (
          <WeekDayColumn
            key={date}
            daySchedule={daySchedule}
            teamColor={teamColor}
            isActive={date === activeDate}
            onDayClick={() => onDayClick(date)}
          />
        );
      })}
    </div>
  );
}
