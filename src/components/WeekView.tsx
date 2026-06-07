'use client';

import { useRef, useEffect } from 'react';
import { DaySchedule, TeamColor, TeamSchedule } from '@/lib/types';
import WeekDayColumn from './WeekDayColumn';
import { ScheduleWarning } from '@/lib/scheduleWarnings';

interface WeekViewProps {
  weekDates: string[];
  daySchedules: Map<string, DaySchedule>;
  teamColor: TeamColor;
  activeDate: string;
  onDayClick: (date: string) => void;
  // All-teams mode
  allTeamsMode?: boolean;
  allTeams?: TeamSchedule[];
  allTeamSchedules?: Map<string, Map<string, DaySchedule>>;
  /** Staff ID → name lookup */
  staffNameMap?: Record<string, string>;
  /** date → warnings for that day (shown as badges on day headers) */
  dayWarnings?: Map<string, ScheduleWarning[]>;
}

export default function WeekView({ weekDates, daySchedules, teamColor, activeDate, onDayClick, allTeamsMode, allTeams, allTeamSchedules, staffNameMap, dayWarnings }: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let velocity = 0;
    let rafId: number | null = null;
    let isHovered = false;

    const animate = () => {
      if (Math.abs(velocity) < 0.5) {
        velocity = 0;
        rafId = null;
        return;
      }
      el.scrollLeft += velocity;
      velocity *= 0.84;
      rafId = requestAnimationFrame(animate);
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      velocity += e.deltaY * 0.25;
      velocity = Math.max(-35, Math.min(35, velocity));
      if (!rafId) rafId = requestAnimationFrame(animate);
    };

    // Blur any focused button when Shift is pressed over the week view
    // so the browser doesn't light up the last-focused team tab
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && isHovered) {
        (document.activeElement as HTMLElement)?.blur();
      }
    };

    const onEnter = () => { isHovered = true; };
    const onLeave = () => { isHovered = false; };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('keydown', onKeyDown);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      data-week-container
      className="flex gap-2 h-full overflow-x-auto custom-scrollbar p-3 lg:p-4"
    >

      {weekDates.map((date) => {
        if (allTeamsMode && allTeams && allTeamSchedules) {
          // Merge all teams' clients into one DaySchedule with color info
          const mergedClients: DaySchedule['clients'] = [];
          let isPublished = false;
          const teamColorMap: Record<string, string> = {};

          for (const team of allTeams) {
            const teamMap = allTeamSchedules.get(team.id);
            const teamDay = teamMap?.get(date);
            if (teamDay) {
              if (teamDay.isPublished) isPublished = true;
              for (const client of teamDay.clients) {
                mergedClients.push(client);
                teamColorMap[client.id] = team.color.primary;
              }
            }
          }

          const mergedSchedule: DaySchedule = {
            date,
            dayOfWeek: new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
            scheduleId: null,
            clients: mergedClients,
            breaks: [],
            isPublished,
          };

          return (
            <WeekDayColumn
              key={date}
              daySchedule={mergedSchedule}
              teamColor={teamColor}
              isActive={date === activeDate}
              onDayClick={() => onDayClick(date)}
              clientColorMap={teamColorMap}
              staffNameMap={staffNameMap}
              warnings={dayWarnings?.get(date)}
            />
          );
        }

        const daySchedule: DaySchedule = daySchedules.get(date) || {
          date,
          dayOfWeek: new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short' }),
          scheduleId: null,
          clients: [],
          breaks: [],
          isPublished: false,
        };

        return (
          <WeekDayColumn
            key={date}
            daySchedule={daySchedule}
            teamColor={teamColor}
            isActive={date === activeDate}
            onDayClick={() => onDayClick(date)}
            staffNameMap={staffNameMap}
            warnings={dayWarnings?.get(date)}
          />
        );
      })}
    </div>
  );
}
