'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface OrgMembership {
  org_id: string;
  role: string;
  org_name: string;
}

interface Props {
  orgs: OrgMembership[];
  activeOrgId: string;
  activeOrgName: string;
  onSwitch: (orgId: string) => void;
  onCreate: () => void;
  onDelete: (orgId: string, orgName: string) => void;
  switching: boolean;
}

export default function OrgSwitcher({ orgs, activeOrgId, activeOrgName, onSwitch, onCreate, onDelete, switching }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left hover:bg-surface-hover rounded-lg px-2 py-1.5 -mx-2 transition-colors">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
          {(activeOrgName || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-text-primary truncate">{activeOrgName || 'No Organisation'}</p>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`text-text-tertiary shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-xl border border-border-light shadow-lg overflow-hidden">
              <div className="p-1.5 max-h-[240px] overflow-y-auto">
                {orgs.map((org) => {
                  const isActive = org.org_id === activeOrgId;
                  return (
                    <button key={org.org_id} onClick={() => { onSwitch(org.org_id); setOpen(false); }}
                      disabled={switching || isActive}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${isActive ? 'bg-primary-light' : 'hover:bg-surface-hover'} disabled:opacity-70`}>
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${isActive ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary'}`}>
                        {org.org_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : 'text-text-primary'}`}>{org.org_name}</p>
                        <p className="text-[10px] text-text-tertiary capitalize">{org.role}</p>
                      </div>
                      {isActive && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3" className="shrink-0">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-border-light p-1.5">
                <button onClick={() => { onCreate(); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-surface-hover transition-colors">
                  <div className="w-7 h-7 rounded-md bg-surface-elevated flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </div>
                  <span className="text-sm text-text-secondary font-medium">Create Organisation</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DeleteOrgModal({ orgName, onConfirm, onCancel, deleting }: {
  orgName: string; onConfirm: () => void; onCancel: () => void; deleting: boolean;
}) {
  const [confirmText, setConfirmText] = useState('');
  const isValid = confirmText === 'delete my organisation';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="relative bg-white rounded-2xl w-full max-w-[440px] overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-bold text-text-primary mb-2">Delete Organisation</h2>
          <p className="text-sm text-text-secondary mb-5">
            This will permanently delete <span className="font-semibold text-text-primary">{orgName}</span> and all related data including staff, clients, schedules, and templates.
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">
                To confirm, type "<span className="font-bold text-text-primary">delete my organisation</span>"
              </label>
              <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                className="input-field w-full text-sm" placeholder="delete my organisation" autoFocus />
            </div>
          </div>
        </div>
        <div className="bg-danger/5 border-t border-danger/10 px-6 py-3 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className="text-xs text-danger font-medium">Deleting {orgName} cannot be undone.</span>
        </div>
        <div className="p-4 flex justify-between border-t border-border-light">
          <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={!isValid || deleting}
            className="bg-danger text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-danger/90 transition-colors disabled:opacity-40">
            {deleting ? 'Deleting...' : 'Delete Organisation'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
