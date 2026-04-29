'use client';

import { motion } from 'framer-motion';
import { formatDuration, formatDistance, formatTimeDisplay } from '@/lib/timeUtils';
import { DaySummary, ScheduleAction, TeamSchedule } from '@/lib/types';
import { exportScheduleCSV } from '@/lib/routeEngine';

interface DailySummaryProps {
  team: TeamSchedule;
  summary: DaySummary;
  dispatch: React.Dispatch<ScheduleAction>;
}

export default function DailySummaryCard({ team, summary, dispatch }: DailySummaryProps) {
  const handleExport = () => {
    const csv = exportScheduleCSV(team, summary);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${team.name.replace(/\s+/g, '-')}-schedule.csv`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Calculate end time (finish after return to base)
  const lastClient = team.clients[team.clients.length - 1];
  const returnSegKey = lastClient ? `${lastClient.id}->base-return` : null;
  const returnSeg = returnSegKey ? team.travelSegments.get(returnSegKey) : null;
  const endTimeParts = lastClient?.endTime ? lastClient.endTime.split(':').map(Number) : null;
  let finishTime = '';
  if (endTimeParts && returnSeg && !returnSeg.isCalculating) {
    const totalMin = endTimeParts[0] * 60 + endTimeParts[1] + returnSeg.durationMinutes;
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    finishTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="card-elevated p-5"
      style={{ borderTop: `3px solid ${team.color.primary}` }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={team.color.primary} strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          Daily Summary
        </h3>
        <button
          onClick={handleExport}
          className="btn-ghost text-xs"
          title="Export as CSV"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Clients */}
        <div className="bg-surface-elevated rounded-xl p-3">
          <div className="text-xs text-text-tertiary mb-1">Clients</div>
          <div className="text-xl font-bold text-text-primary">{summary.clientCount}</div>
        </div>

        {/* Job Time */}
        <div className="bg-surface-elevated rounded-xl p-3">
          <div className="text-xs text-text-tertiary mb-1">Job Time</div>
          <div className="text-xl font-bold text-text-primary">{formatDuration(summary.totalJobMinutes)}</div>
          <div className="text-[11px] text-text-tertiary mt-0.5">{(summary.totalJobMinutes / 60).toFixed(2)} hrs</div>
        </div>

        {/* Travel Time */}
        <div className="bg-surface-elevated rounded-xl p-3">
          <div className="text-xs text-text-tertiary mb-1">Travel Time</div>
          <div className="text-xl font-bold" style={{ color: team.color.primary }}>
            {formatDuration(summary.totalTravelMinutes)}
          </div>
        </div>

        {/* Distance */}
        <div className="bg-surface-elevated rounded-xl p-3">
          <div className="text-xs text-text-tertiary mb-1">Distance</div>
          <div className="text-xl font-bold" style={{ color: team.color.primary }}>
            {formatDistance(summary.totalDistanceKm)}
          </div>
        </div>

        {/* Total Work */}
        <div className="bg-surface-elevated rounded-xl p-3">
          <div className="text-xs text-text-tertiary mb-1">Total Work</div>
          <div className="text-xl font-bold text-text-primary">{formatDuration(summary.totalWorkMinutes)}</div>
          <div className="text-[11px] text-text-tertiary mt-0.5">{(summary.totalWorkMinutes / 60).toFixed(2)} hrs</div>
        </div>

        {/* Wage */}
        <div className="rounded-xl p-3" style={{ backgroundColor: team.color.light }}>
          <div className="text-xs mb-1" style={{ color: team.color.text }}>
            Wages
          </div>
          <div className="text-xl font-bold" style={{ color: team.color.text }}>
            ${summary.wageAmount.toFixed(2)}
          </div>
        </div>

        {/* Fuel Cost — spans full width */}
        <div className="col-span-2 rounded-xl p-3 bg-surface-elevated border border-border-light">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={team.color.primary} strokeWidth="2">
                <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
                <path d="M15 10h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2v0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 4" />
                <path d="M3 22h12" />
                <path d="M7 10h4" />
              </svg>
              <span className="text-xs font-semibold text-text-primary">Fuel Cost</span>
            </div>
            <div className="text-lg font-bold" style={{ color: team.color.primary }}>
              ${summary.fuelCost.toFixed(2)}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-text-tertiary">L/100km</span>
              <input
                type="number"
                value={team.fuelEfficiency}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  dispatch({
                    type: 'SET_FUEL_SETTINGS',
                    teamId: team.id,
                    fuelEfficiency: val,
                    fuelPrice: team.fuelPrice,
                  });
                }}
                className="w-16 text-center font-medium bg-white border border-border-light rounded-lg px-2 py-1 outline-none focus:border-primary"
                min={0}
                step={0.5}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-text-tertiary">$/L</span>
              <input
                type="number"
                value={team.fuelPrice}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  dispatch({
                    type: 'SET_FUEL_SETTINGS',
                    teamId: team.id,
                    fuelEfficiency: team.fuelEfficiency,
                    fuelPrice: val,
                  });
                }}
                className="w-16 text-center font-medium bg-white border border-border-light rounded-lg px-2 py-1 outline-none focus:border-primary"
                min={0}
                step={0.01}
              />
            </label>
          </div>
        </div>

        {/* Per-KM Allowance — spans full width */}
        <div className="col-span-2 rounded-xl p-3 bg-surface-elevated border border-border-light">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={team.color.primary} strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-xs font-semibold text-text-primary">Per-KM Allowance</span>
            </div>
            <div className="text-lg font-bold" style={{ color: team.color.primary }}>
              ${summary.perKmCost.toFixed(2)}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-text-tertiary">$/km</span>
            <input
              type="number"
              value={team.perKmRate}
              onChange={(e) => {
                const val = parseFloat(e.target.value) || 0;
                dispatch({ type: 'SET_PER_KM_RATE', teamId: team.id, rate: val });
              }}
              className="w-16 text-center font-medium bg-white border border-border-light rounded-lg px-2 py-1 outline-none focus:border-primary"
              min={0}
              step={0.01}
            />
          </label>
        </div>
      </div>

      {/* Day range */}
      {finishTime && (
        <div className="mt-3 pt-3 border-t border-border-light flex items-center justify-between text-sm">
          <span className="text-text-secondary">Day Range</span>
          <span className="font-semibold text-text-primary">
            {formatTimeDisplay(team.dayStartTime)} – {formatTimeDisplay(finishTime)}
          </span>
        </div>
      )}

      {/* Hourly rate — editable */}
      <div className="mt-3 pt-3 border-t border-border-light">
        <label className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Hourly Rate</span>
          <div className="flex items-center gap-1">
            <span className="text-text-tertiary">$</span>
            <input
              type="number"
              value={team.hourlyRate}
              onChange={(e) =>
                dispatch({
                  type: 'SET_HOURLY_RATE',
                  teamId: team.id,
                  rate: parseFloat(e.target.value) || 0,
                })
              }
              className="w-16 text-right text-sm font-medium bg-surface-elevated border border-border-light rounded-lg px-2 py-1 outline-none focus:border-primary"
              min={0}
              step={0.5}
            />
            <span className="text-text-tertiary text-xs">/hr</span>
          </div>
        </label>
      </div>
    </motion.div>
  );
}
