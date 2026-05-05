'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { TeamSchedule, Client } from '@/lib/types';
import { getWeekDates, getShortDayLabel } from '@/lib/timeUtils';

interface SaveTemplateModalProps {
  teams: TeamSchedule[];
  selectedDate: string;
  weekSchedules: Map<string, Map<string, { clients: Client[]; isPublished: boolean; templateCode?: string }>>;
  orgId: string | null;
  onClose: () => void;
}

export default function SaveTemplateModal({ teams, selectedDate, weekSchedules, orgId, onClose }: SaveTemplateModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  // Build a preview of what will be saved: { dayIndex: 0-6, teams: [ { teamName, clients[] } ] }
  const weekPreview = useMemo(() => {
    return weekDates.map((date, dayIdx) => {
      const dayTeams: { teamName: string; teamColor: string; clientCount: number; clientNames: string[] }[] = [];
      for (const team of teams) {
        const teamDayData = weekSchedules.get(team.id)?.get(date);
        const clients = teamDayData?.clients || [];
        if (clients.length > 0) {
          dayTeams.push({
            teamName: team.name,
            teamColor: team.color.primary,
            clientCount: clients.length,
            clientNames: clients.slice(0, 3).map(c => c.name),
          });
        }
      }
      return { date, dayLabel: getShortDayLabel(date), dayIdx, teams: dayTeams };
    });
  }, [weekDates, teams, weekSchedules]);

  const totalJobs = weekPreview.reduce((sum, d) => sum + d.teams.reduce((s, t) => s + t.clientCount, 0), 0);
  const daysWithJobs = weekPreview.filter(d => d.teams.length > 0).length;

  const handleSave = async () => {
    if (!orgId || !name.trim()) return;
    setSaving(true);

    // Build week_data: keyed by day index (0=Mon, 6=Sun), each containing team data
    const weekData: Record<string, { teamName: string; teamId: string; dayStartTime: string; baseAddress: unknown; clients: Partial<Client>[] }[]> = {};

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const date = weekDates[dayIdx];
      const dayTeams: { teamName: string; teamId: string; dayStartTime: string; baseAddress: unknown; clients: Partial<Client>[] }[] = [];

      for (const team of teams) {
        const teamDayData = weekSchedules.get(team.id)?.get(date);
        const clients = teamDayData?.clients || [];
        if (clients.length > 0) {
          dayTeams.push({
            teamName: team.name,
            teamId: team.id,
            dayStartTime: team.dayStartTime,
            baseAddress: team.baseAddress,
            clients: clients.map((c) => ({
              name: c.name,
              location: c.location,
              jobDurationMinutes: c.jobDurationMinutes,
              staffCount: c.staffCount,
              isLocked: c.isLocked,
              fixedStartTime: c.fixedStartTime,
              savedClientId: c.savedClientId,
              notes: c.notes,
            })),
          });
        }
      }

      if (dayTeams.length > 0) {
        weekData[String(dayIdx)] = dayTeams;
      }
    }

    await supabase.from('schedule_templates').insert({
      org_id: orgId,
      name: name.trim(),
      label: null,
      week_data: weekData,
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => onClose(), 1200);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-text-primary">Save Week Template</h3>
              <p className="text-xs text-text-tertiary">{totalJobs} jobs across {daysWithJobs} days</p>
            </div>
          </div>

          {saved ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
              <div className="text-4xl mb-2">✅</div>
              <p className="text-sm font-semibold text-text-primary">Week template saved!</p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Template Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className="input-field text-sm" placeholder="e.g. Standard Week, Week A Rotation" autoFocus />
              </div>

              {/* Week preview */}
              <div className="bg-surface-elevated rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">Week Preview</p>
                {weekPreview.map((day) => (
                  <div key={day.date} className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold w-10 shrink-0 ${day.teams.length > 0 ? 'text-text-primary' : 'text-text-tertiary'}`}>
                      {day.dayLabel.split(' ')[0]}
                    </span>
                    {day.teams.length === 0 ? (
                      <span className="text-[11px] text-text-tertiary">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                        {day.teams.map((t, i) => (
                          <span key={i} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                            style={{ backgroundColor: `${t.teamColor}12`, color: t.teamColor }}>
                            {t.clientCount} job{t.clientCount !== 1 ? 's' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleSave} disabled={saving || !name.trim() || totalJobs === 0}
                  className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Week Template'}
                </button>
                <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
