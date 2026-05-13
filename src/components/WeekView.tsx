'use client';

import { DaySchedule, TeamColor, TeamSchedule } from '@/lib/types';
import WeekDayColumn from './WeekDayColumn';

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
}

export default function WeekView({ weekDates, daySchedules, teamColor, activeDate, onDayClick, allTeamsMode, allTeams, allTeamSchedules, staffNameMap }: WeekViewProps) {
  return (
    <div className="flex gap-3 h-full overflow-x-auto custom-scrollbar p-4 lg:p-5">
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
            />
          );
        }

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
            staffNameMap={staffNameMap}
          />
        );
      })}
    </div>
  );
}
