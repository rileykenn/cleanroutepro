'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { calculateDaySummary } from '@/lib/routeEngine';
import { TeamSchedule, DaySchedule, DaySummary, StaffMember } from '@/lib/types';
import { formatDuration, formatDistance } from '@/lib/timeUtils';

interface WeeklySummaryPanelProps {
  weekSchedules: Map<string, Map<string, DaySchedule>>;
  teams: TeamSchedule[];
  weekDates: string[];
  weekLabel: string;
  allStaff: StaffMember[];
  onClose: () => void;
}

interface TeamWeekTotals {
  team: TeamSchedule;
  clientCount: number;
  totalJobMinutes: number;
  totalTravelMinutes: number;
  totalDistanceKm: number;
  wageAmount: number;
  fuelCost: number;
  perKmCost: number;
  totalRevenue: number;
}

export default function WeeklySummaryPanel({
  weekSchedules,
  teams,
  weekDates,
  weekLabel,
  onClose,
}: WeeklySummaryPanelProps) {
  const { teamTotals, grandTotals } = useMemo(() => {
    const teamTotals: TeamWeekTotals[] = [];

    let grandClients = 0;
    let grandJobMinutes = 0;
    let grandTravelMinutes = 0;
    let grandDistanceKm = 0;
    let grandWages = 0;
    let grandFuel = 0;
    let grandPerKm = 0;
    let grandRevenue = 0;

    for (const team of teams) {
      const teamMap = weekSchedules.get(team.id);
      if (!teamMap) continue;

      let tClients = 0;
      let tJobMinutes = 0;
      let tTravelMinutes = 0;
      let tDistanceKm = 0;
      let tWages = 0;
      let tFuel = 0;
      let tPerKm = 0;
      let tRevenue = 0;

      for (const date of weekDates) {
        const dayData = teamMap.get(date);
        if (!dayData || dayData.clients.length === 0) continue;

        const teamForCalc: TeamSchedule = {
          ...team,
          clients: dayData.clients,
          breaks: dayData.breaks,
          travelSegments: new Map(),
          staffIds: dayData.staffIds || [],
          baseAddress: dayData.baseAddress !== undefined ? dayData.baseAddress : team.baseAddress,
        };
        const daySummary: DaySummary = calculateDaySummary(teamForCalc);

        tClients += daySummary.clientCount;
        tJobMinutes += daySummary.totalJobMinutes;
        tTravelMinutes += daySummary.totalTravelMinutes;
        tDistanceKm += daySummary.totalDistanceKm;
        tWages += daySummary.wageAmount;
        tFuel += daySummary.fuelCost;
        tPerKm += daySummary.perKmCost;
        tRevenue += daySummary.totalRevenue;
      }

      if (tClients > 0) {
        teamTotals.push({
          team,
          clientCount: tClients,
          totalJobMinutes: tJobMinutes,
          totalTravelMinutes: tTravelMinutes,
          totalDistanceKm: tDistanceKm,
          wageAmount: tWages,
          fuelCost: tFuel,
          perKmCost: tPerKm,
          totalRevenue: tRevenue,
        });

        grandClients += tClients;
        grandJobMinutes += tJobMinutes;
        grandTravelMinutes += tTravelMinutes;
        grandDistanceKm += tDistanceKm;
        grandWages += tWages;
        grandFuel += tFuel;
        grandPerKm += tPerKm;
        grandRevenue += tRevenue;
      }
    }

    return {
      teamTotals,
      grandTotals: {
        clientCount: grandClients,
        totalJobMinutes: grandJobMinutes,
        totalTravelMinutes: grandTravelMinutes,
        totalDistanceKm: grandDistanceKm,
        wageAmount: grandWages,
        fuelCost: grandFuel,
        perKmCost: grandPerKm,
        totalRevenue: grandRevenue,
        profit: grandRevenue - (grandWages + grandFuel + grandPerKm),
      },
    };
  }, [weekSchedules, teams, weekDates]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-hidden"
    >
      <div className="card-elevated p-5 mx-4 lg:mx-6 mt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6" />
              </svg>
              Weekly Summary
            </h3>
            <p className="text-xs text-text-tertiary mt-0.5">{weekLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-surface-hover text-text-tertiary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {teamTotals.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-text-tertiary">No scheduled jobs this week</p>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-light">
                    <th className="text-left py-2 px-2 font-semibold text-text-secondary">Team</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Jobs</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Job Hours</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Travel</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Distance</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Wages</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Fuel</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Revenue</th>
                    <th className="text-right py-2 px-2 font-semibold text-text-secondary">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {teamTotals.map((t) => {
                    const totalCosts = t.wageAmount + t.fuelCost + t.perKmCost;
                    const profit = t.totalRevenue - totalCosts;
                    return (
                      <tr key={t.team.id} className="border-b border-border-light/50 hover:bg-surface-hover/50 transition-colors">
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.team.color.primary }} />
                            <span className="font-medium text-text-primary">{t.team.name}</span>
                          </div>
                        </td>
                        <td className="text-right py-2.5 px-2 text-text-primary">{t.clientCount}</td>
                        <td className="text-right py-2.5 px-2 text-text-primary">{formatDuration(t.totalJobMinutes)}</td>
                        <td className="text-right py-2.5 px-2 text-text-secondary">{formatDuration(t.totalTravelMinutes)}</td>
                        <td className="text-right py-2.5 px-2 text-text-secondary">{formatDistance(t.totalDistanceKm)}</td>
                        <td className="text-right py-2.5 px-2 text-text-primary">${t.wageAmount.toFixed(2)}</td>
                        <td className="text-right py-2.5 px-2 text-text-secondary">${(t.fuelCost + t.perKmCost).toFixed(2)}</td>
                        <td className="text-right py-2.5 px-2 font-medium text-emerald-600">${t.totalRevenue.toFixed(2)}</td>
                        <td className={`text-right py-2.5 px-2 font-medium ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {profit >= 0 ? '' : '-'}${Math.abs(profit).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totals row */}
                  <tr className="border-t-2 border-border-light">
                    <td className="py-2.5 px-2 font-bold text-text-primary">Total</td>
                    <td className="text-right py-2.5 px-2 font-bold text-text-primary">{grandTotals.clientCount}</td>
                    <td className="text-right py-2.5 px-2 font-bold text-text-primary">{formatDuration(grandTotals.totalJobMinutes)}</td>
                    <td className="text-right py-2.5 px-2 font-bold text-text-secondary">{formatDuration(grandTotals.totalTravelMinutes)}</td>
                    <td className="text-right py-2.5 px-2 font-bold text-text-secondary">{formatDistance(grandTotals.totalDistanceKm)}</td>
                    <td className="text-right py-2.5 px-2 font-bold text-text-primary">${grandTotals.wageAmount.toFixed(2)}</td>
                    <td className="text-right py-2.5 px-2 font-bold text-text-secondary">${(grandTotals.fuelCost + grandTotals.perKmCost).toFixed(2)}</td>
                    <td className="text-right py-2.5 px-2 font-bold text-emerald-600">${grandTotals.totalRevenue.toFixed(2)}</td>
                    <td className={`text-right py-2.5 px-2 font-bold ${grandTotals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {grandTotals.profit >= 0 ? '' : '-'}${Math.abs(grandTotals.profit).toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              <div className="bg-surface-elevated rounded-xl p-3">
                <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">Jobs</div>
                <div className="text-lg font-bold text-text-primary mt-1">{grandTotals.clientCount}</div>
              </div>
              <div className="bg-surface-elevated rounded-xl p-3">
                <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">Job Hours</div>
                <div className="text-lg font-bold text-text-primary mt-1">{formatDuration(grandTotals.totalJobMinutes)}</div>
              </div>
              <div className="bg-surface-elevated rounded-xl p-3">
                <div className="text-[10px] font-medium text-text-tertiary uppercase tracking-wide">Total Wages</div>
                <div className="text-lg font-bold text-text-primary mt-1">${grandTotals.wageAmount.toFixed(2)}</div>
              </div>
              <div className={`rounded-xl p-3 ${grandTotals.profit >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                <div className={`text-[10px] font-medium uppercase tracking-wide ${grandTotals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Profit</div>
                <div className={`text-lg font-bold mt-1 ${grandTotals.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {grandTotals.profit >= 0 ? '' : '-'}${Math.abs(grandTotals.profit).toFixed(2)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
