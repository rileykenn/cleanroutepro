'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export default function CreateOrgModal({ onCreated, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [staffList, setStaffList] = useState<{ name: string; email: string }[]>([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const addStaff = () => {
    if (!newStaffName.trim()) return;
    setStaffList([...staffList, { name: newStaffName.trim(), email: newStaffEmail.trim() }]);
    setNewStaffName('');
    setNewStaffEmail('');
  };

  const handleCreate = async () => {
    if (!businessName.trim() || creating) return;
    setCreating(true);
    const res = await fetch('/api/org/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: businessName, staff: staffList, clients: [] }),
    });
    if (res.ok) {
      onCreated();
    }
    setCreating(false);
  };

  const labels = ['Business Name', 'Add Staff'];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="relative bg-white rounded-2xl w-full max-w-[480px] overflow-hidden">
        <div className="p-6">
          {/* Progress */}
          <div className="flex items-center gap-2 mb-6">
            {labels.map((label, i) => (
              <div key={i} className="flex-1">
                <div className={`h-1.5 rounded-full transition-colors ${i <= step ? 'bg-primary' : 'bg-border'}`} />
                <p className={`text-[10px] mt-1 ${i <= step ? 'text-primary font-medium' : 'text-text-tertiary'}`}>{label}</p>
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="s0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="text-center mb-5">
                  <div className="text-4xl mb-3">🏢</div>
                  <h2 className="text-lg font-bold text-text-primary">What's your business name?</h2>
                  <p className="text-sm text-text-secondary mt-1">This will be your new organisation</p>
                </div>
                <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)}
                  className="input-field w-full text-sm" placeholder="e.g. The Cleaning Co" autoFocus />
              </motion.div>
            )}
            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="text-center mb-5">
                  <div className="text-4xl mb-3">👥</div>
                  <h2 className="text-lg font-bold text-text-primary">Add team members</h2>
                  <p className="text-sm text-text-secondary mt-1">You can always add more later</p>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input type="text" value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)}
                      className="input-field flex-1 text-sm" placeholder="Name" onKeyDown={(e) => e.key === 'Enter' && addStaff()} />
                    <input type="email" value={newStaffEmail} onChange={(e) => setNewStaffEmail(e.target.value)}
                      className="input-field flex-1 text-sm" placeholder="Email (optional)" onKeyDown={(e) => e.key === 'Enter' && addStaff()} />
                    <button onClick={addStaff} className="btn-primary text-sm px-3 shrink-0">+</button>
                  </div>
                  {staffList.length > 0 && (
                    <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                      {staffList.map((s, i) => (
                        <div key={i} className="flex items-center justify-between bg-surface-elevated rounded-lg px-3 py-2">
                          <div>
                            <span className="text-sm font-medium text-text-primary">{s.name}</span>
                            {s.email && <span className="text-xs text-text-tertiary ml-2">{s.email}</span>}
                          </div>
                          <button onClick={() => setStaffList(staffList.filter((_, j) => j !== i))} className="text-text-tertiary hover:text-danger">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-4 border-t border-border-light flex items-center justify-between">
          <button onClick={() => step === 0 ? onCancel() : setStep(0)} className="btn-ghost text-sm">
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          <div className="flex gap-2">
            {step === 0 ? (
              <button onClick={() => setStep(1)} disabled={!businessName.trim()} className="btn-primary text-sm px-6 disabled:opacity-40">Next</button>
            ) : (
              <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm px-6 disabled:opacity-60">
                {creating ? 'Creating...' : 'Create Organisation'}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
