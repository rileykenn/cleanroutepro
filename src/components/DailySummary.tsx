'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration, formatDistance, formatTimeDisplay } from '@/lib/timeUtils';
import { DaySummary, ScheduleAction, TeamSchedule } from '@/lib/types';
import { exportScheduleXLSX } from '@/lib/xlsxExport';
import { exportStaffScheduleXLSX } from '@/lib/staffXlsxExport';

interface StaffWithRate {
  id: string;
  name: string;
  hourly_rate: number;
}

interface DailySummaryProps {
  team: TeamSchedule;
  summary: DaySummary;
  dispatch: React.Dispatch<ScheduleAction>;
  staffNames?: string[];
  staffRates?: StaffWithRate[];
  hideFinancials?: boolean;
  date?: string;
  driverName?: string;
  templateCode?: string;
}

export default function DailySummaryCard({ team, summary, dispatch, staffNames, staffRates, hideFinancials, date, driverName, templateCode }: DailySummaryProps) {
  const [showRevenueBreakdown, setShowRevenueBreakdown] = useState(false);
  const [csvMenuOpen, setCsvMenuOpen] = useState(false);
  const csvMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!csvMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (csvMenuRef.current && !csvMenuRef.current.contains(e.target as Node)) {
        setCsvMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [csvMenuOpen]);

  const handleExport = async () => {
    const blob = await exportScheduleXLSX(team, summary, date || '', staffNames);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${team.name.replace(/\s+/g, '-')}-schedule.xlsx`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleStaffExport = async () => {
    const blob = await exportStaffScheduleXLSX(team, summary, date || '', staffNames, driverName, templateCode);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${team.name.replace(/\s+/g, '-')}-staff-schedule.xlsx`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Calculate end time (finish after return to base, or last client end if no return)
  const lastClient = team.clients[team.clients.length - 1];
  const returnSegKey = lastClient ? `${lastClient.id}->base-return` : null;
  const returnSeg = returnSegKey ? team.travelSegments.get(returnSegKey) : null;
  const endTimeParts = lastClient?.endTime ? lastClient.endTime.split(':').map(Number) : null;
  let finishTime = '';
  if (endTimeParts && returnSeg && !returnSeg.isCalculating) {
    // Return destination exists — add return travel time
    const totalMin = endTimeParts[0] * 60 + endTimeParts[1] + returnSeg.durationMinutes;
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    finishTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  } else if (endTimeParts && lastClient?.endTime) {
    // No return destination — use last client's end time
    finishTime = lastClient.endTime;
  }

  // Calculate wages from individual staff rates using exact computed labor minutes
  const staffWages = (staffRates && staffRates.length > 0)
    ? staffRates.map((s) => {
        const exactMinutes = summary.staffLaborMinutes?.get(s.id) || 0;
        return { 
          name: s.name, 
          rate: s.hourly_rate, 
          wage: (exactMinutes / 60) * s.hourly_rate,
          minutes: exactMinutes 
        };
      }).filter(s => s.minutes > 0) // Only show staff who actually worked on this team today
    : [];

  const totalWages = staffWages.length > 0
    ? staffWages.reduce((sum, s) => sum + s.wage, 0)
    : summary.wageAmount; // fallback to route total if no staff configured

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
        {/* CSV Export */}
        {hideFinancials ? (
          <button
            onClick={handleStaffExport}
            className="btn-ghost text-xs flex items-center gap-1"
            title="Export as CSV"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        ) : (
          <div className="relative" ref={csvMenuRef}>
            <button
              onClick={() => setCsvMenuOpen(v => !v)}
              className="btn-ghost text-xs flex items-center gap-1"
              title="Export as CSV"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {csvMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-border-light shadow-[0_8px_30px_rgba(0,0,0,0.12)] py-1 z-50">
                <button
                  onClick={() => { handleExport(); setCsvMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors flex items-center gap-2"
                >
                  📊 Admin XLSX
                  <span className="text-[10px] text-text-tertiary ml-auto">Full data</span>
                </button>
                <button
                  onClick={() => { handleStaffExport(); setCsvMenuOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors flex items-center gap-2"
                >
                  📋 Staff XLSX
                  <span className="text-[10px] text-text-tertiary ml-auto">Schedule only</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {/* ── Time breakdown ── */}
        {(() => {
          const effectiveJobMins = summary.payableMinutes - summary.totalTravelMinutes;
          const divisor = summary.totalJobMinutes > 0 && effectiveJobMins > 0
            ? Math.round(summary.totalJobMinutes / effectiveJobMins)
            : 1;

          return (
            <>
              {/* 1. Job total */}
              <div className="flex items-center justify-between bg-surface-elevated rounded-xl p-3">
                <div className="text-xs font-medium text-text-secondary">Job Total</div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-text-primary">{formatDuration(summary.totalJobMinutes)}</span>
                  <span className="text-xs text-text-tertiary bg-white px-2 py-0.5 rounded-md border border-border-light">{(summary.totalJobMinutes / 60).toFixed(2)} hrs</span>
                </div>
              </div>

              {/* 2. Per staff split — always shown, badge shows ÷1 / ÷2 / ÷3 etc */}
              <div className="flex items-center justify-between bg-surface-elevated rounded-xl p-3">
                <div className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                  Per Staff
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white border border-border-light text-text-tertiary">÷{divisor}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-text-primary">{formatDuration(effectiveJobMins)}</span>
                  <span className="text-xs text-text-tertiary bg-white px-2 py-0.5 rounded-md border border-border-light">{(effectiveJobMins / 60).toFixed(2)} hrs</span>
                </div>
              </div>

              {/* 3. Travel */}
              <div className="flex items-center justify-between bg-surface-elevated rounded-xl p-3">
                <div className="text-xs font-medium text-text-secondary">Travel</div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold" style={{ color: team.color.primary }}>{formatDuration(summary.totalTravelMinutes)}</span>
                  <span className="text-xs text-text-tertiary bg-white px-2 py-0.5 rounded-md border border-border-light">{(summary.totalTravelMinutes / 60).toFixed(2)} hrs</span>
                </div>
              </div>

              {/* Break (if any) */}
              {summary.totalBreakMinutes > 0 && (
                <div className="flex items-center justify-between bg-amber-50 rounded-xl p-3 border border-amber-100">
                  <div className="text-xs font-medium text-amber-700">Break <span className="text-[10px] font-normal text-amber-500">(excl. payroll)</span></div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold text-amber-700">{formatDuration(summary.totalBreakMinutes)}</span>
                    <span className="text-xs text-amber-500 bg-white px-2 py-0.5 rounded-md border border-amber-100">{(summary.totalBreakMinutes / 60).toFixed(2)} hrs</span>
                  </div>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-border-light" />

              {/* 4. Job split + Travel — payable total per person */}
              <div className="flex items-center justify-between rounded-xl p-3" style={{ backgroundColor: team.color.light }}>
                <div className="text-xs font-bold" style={{ color: team.color.text }}>Job Split + Travel</div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold" style={{ color: team.color.text }}>{formatDuration(summary.payableMinutes)}</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-white/60" style={{ color: team.color.text }}>{(summary.payableMinutes / 60).toFixed(2)} hrs</span>
                </div>
              </div>
            </>
          );
        })()}

        {/* Driver Km */}
        <div className="flex items-center justify-between bg-surface-elevated rounded-xl p-3">
          <div className="text-xs font-medium text-text-secondary">Driver Km</div>
          <span className="text-base font-bold" style={{ color: team.color.primary }}>{formatDistance(summary.totalDistanceKm)}</span>
        </div>

        {/* Fuel Cost */}
        {!hideFinancials && summary.fuelCost > 0 && (
          <div className="flex items-center justify-between bg-surface-elevated rounded-xl p-3">
            <div className="text-xs font-medium text-text-secondary">Fuel Cost</div>
            <span className="text-base font-bold text-text-primary">${summary.fuelCost.toFixed(2)}</span>
          </div>
        )}

        {/* Per-KM Allowance */}
        {!hideFinancials && summary.perKmCost > 0 && (
          <div className="flex items-center justify-between bg-surface-elevated rounded-xl p-3">
            <div className="text-xs font-medium text-text-secondary">KM Allowance (${team.perKmRate.toFixed(2)}/km)</div>
            <span className="text-base font-bold text-text-primary">${summary.perKmCost.toFixed(2)}</span>
          </div>
        )}

        {/* Staff with rates */}
        {!hideFinancials && staffWages.length > 0 && (
          <div className="rounded-xl p-3 bg-surface-elevated border border-border-light">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-text-secondary">Staff</div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: team.color.light, color: team.color.text }}>
                {staffWages.length}
              </span>
            </div>
            <div className="space-y-1.5">
              {staffWages.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{s.name}</span>
                    <span className="text-text-tertiary">${s.rate}/hr</span>
                  </div>
                  <span className="font-bold text-emerald-600">${s.wage.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clients */}
        <div className="flex items-center justify-between bg-surface-elevated rounded-xl p-3">
          <div className="text-xs font-medium text-text-secondary">Clients</div>
          <span className="text-base font-bold text-text-primary">{summary.clientCount}</span>
        </div>

        {/* Wage Total */}
        {!hideFinancials && (
          <div className="flex items-center justify-between rounded-xl p-3" style={{ backgroundColor: team.color.light }}>
            <div className="text-xs font-bold" style={{ color: team.color.text }}>
              Wages {staffWages.length > 1 && <span className="font-normal text-[10px]">({staffWages.length} staff)</span>}
            </div>
            <span className="text-lg font-bold" style={{ color: team.color.text }}>${totalWages.toFixed(2)}</span>
          </div>
        )}


        {/* Divider before financials */}
        {!hideFinancials && team.clients.some(c => c.rate) && (
          <>
            <div className="border-t border-border-light" />

            {/* Revenue */}
            <div className="rounded-xl bg-emerald-50 border border-emerald-100">
              <div className="flex items-center justify-between p-3">
                <div className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                  Revenue
                  <span className="font-normal text-[10px] text-emerald-500">({team.clients.filter(c => c.rate).length} clients with rates)</span>
                  <button
                    onClick={() => setShowRevenueBreakdown(!showRevenueBreakdown)}
                    className="text-emerald-400 hover:text-emerald-600 transition-colors ml-1"
                    title="Toggle breakdown"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      style={{ transform: showRevenueBreakdown ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
                <span className="text-lg font-bold text-emerald-700">${summary.totalRevenue.toFixed(2)}</span>
              </div>

              {/* Per-client revenue breakdown */}
              <AnimatePresence>
                {showRevenueBreakdown && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 space-y-1 border-t border-emerald-100 pt-2">
                      {team.clients.filter(c => c.rate).map(c => {
                        const hrs = c.jobDurationMinutes / 60;
                        const rev = hrs * (c.rate || 0);
                        return (
                          <div key={c.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-emerald-600 truncate flex-1 mr-2">
                              {c.name} · {hrs.toFixed(1)}hrs × ${c.rate}/hr
                            </span>
                            <span className="font-bold text-emerald-700 shrink-0">${rev.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Total Costs */}
            {(() => {
              const totalCosts = totalWages + summary.fuelCost + summary.perKmCost;
              const profit = summary.totalRevenue - totalCosts;
              return (
                <>
                  <div className="flex items-center justify-between rounded-xl p-3 bg-surface-elevated">
                    <div className="text-xs font-medium text-text-secondary">Total Costs</div>
                    <span className="text-base font-bold text-text-primary">${totalCosts.toFixed(2)}</span>
                  </div>

                  {/* Profit */}
                  <div className={`flex items-center justify-between rounded-xl p-3 border ${profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                    <div className={`text-xs font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      Profit
                    </div>
                    <span className={`text-lg font-bold ${profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {profit >= 0 ? '' : '-'}${Math.abs(profit).toFixed(2)}
                    </span>
                  </div>
                </>
              );
            })()}
          </>
        )}
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
    </motion.div>
  );
}
