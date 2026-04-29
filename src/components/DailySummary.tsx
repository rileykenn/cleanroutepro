'use client';

import { motion } from 'framer-motion';
import { DaySummary, TeamSchedule } from '@/lib/types';
import { formatDuration, formatDistance } from '@/lib/timeUtils';
import { exportScheduleCSV } from '@/lib/routeEngine';

interface DailySummaryProps { summary: DaySummary; team: TeamSchedule; selectedDate: string; }

export default function DailySummaryPanel({ summary, team, selectedDate }: DailySummaryProps) {
  const handleExport = () => {
    const csv = exportScheduleCSV(team, summary);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${team.name}-${selectedDate}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const stats = [
    { label: 'Clients', value: String(summary.clientCount), icon: '👥' },
    { label: 'Job Time', value: formatDuration(summary.totalJobMinutes), icon: '🧹' },
    { label: 'Travel Time', value: formatDuration(summary.totalTravelMinutes), icon: '🚗' },
    { label: 'Distance', value: formatDistance(summary.totalDistanceKm), icon: '📍' },
    { label: 'Total Work', value: formatDuration(summary.totalWorkMinutes), icon: '⏱️' },
    { label: 'Work Hours', value: `${(summary.totalWorkMinutes / 60).toFixed(2)}h`, icon: '📊' },
  ];

  return (
    <div className="card-elevated p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Daily Summary</h3>
        <button onClick={handleExport} className="btn-ghost text-xs gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-surface-elevated rounded-xl p-3 text-center">
            <div className="text-base mb-0.5">{stat.icon}</div>
            <div className="text-sm font-bold text-text-primary">{stat.value}</div>
            <div className="text-[11px] text-text-tertiary">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      <div className="space-y-2 border-t border-border-light pt-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Wages <span className="text-text-tertiary text-xs">(${team.hourlyRate}/hr)</span></span>
          <span className="font-bold text-text-primary">${summary.wageAmount.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Fuel Cost</span>
          <span className="font-bold text-text-primary">${summary.fuelCost.toFixed(2)}</span>
        </div>
        {team.perKmRate > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Per-KM <span className="text-text-tertiary text-xs">(${team.perKmRate}/km)</span></span>
            <span className="font-bold text-text-primary">${summary.perKmCost.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
