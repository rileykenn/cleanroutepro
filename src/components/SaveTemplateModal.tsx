'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { TeamSchedule, Client } from '@/lib/types';

const ROTATION_LABELS = ['', 'A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'];

interface SaveTemplateModalProps {
  team: TeamSchedule;
  orgId: string | null;
  onClose: () => void;
}

export default function SaveTemplateModal({ team, orgId, onClose }: SaveTemplateModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState(`${team.name} Template`);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!orgId || !name.trim()) return;
    setSaving(true);

    // Serialise the team's current clients into the template
    const weekData = {
      clients: team.clients.map((c: Client) => ({
        name: c.name,
        location: c.location,
        jobDurationMinutes: c.jobDurationMinutes,
        staffCount: c.staffCount,
        isLocked: c.isLocked,
        fixedStartTime: c.fixedStartTime,
        savedClientId: c.savedClientId,
        notes: c.notes,
      })),
      dayStartTime: team.dayStartTime,
      baseAddress: team.baseAddress,
    };

    await supabase.from('schedule_templates').insert({
      org_id: orgId,
      name: name.trim(),
      label: label || null,
      week_data: weekData,
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => onClose(), 1200);
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
              <h3 className="text-base font-bold text-text-primary">Save as Template</h3>
              <p className="text-xs text-text-tertiary">{team.clients.length} clients from {team.name}</p>
            </div>
          </div>

          {saved ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
              <div className="text-4xl mb-2">✅</div>
              <p className="text-sm font-semibold text-text-primary">Template saved!</p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Template Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className="input-field text-sm" placeholder="e.g. Monday Standard" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Rotation Label (optional)</label>
                <div className="flex flex-wrap gap-1.5">
                  {ROTATION_LABELS.map((l) => (
                    <button key={l} onClick={() => setLabel(l)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                        label === l
                          ? 'bg-primary text-white'
                          : 'bg-surface-elevated text-text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      {l || 'None'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-surface-elevated rounded-xl p-3">
                <p className="text-xs text-text-tertiary mb-2">Will save:</p>
                <div className="space-y-1">
                  {team.clients.slice(0, 5).map((c, i) => (
                    <div key={c.id} className="text-xs text-text-secondary flex items-center gap-1.5">
                      <span className="font-medium" style={{ color: team.color.primary }}>{i + 1}.</span>
                      <span>{c.name}</span>
                      <span className="text-text-tertiary">· {c.jobDurationMinutes}min</span>
                    </div>
                  ))}
                  {team.clients.length > 5 && (
                    <p className="text-xs text-text-tertiary">+{team.clients.length - 5} more</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleSave} disabled={saving || !name.trim()} className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Template'}
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
