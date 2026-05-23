'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useClients } from '@/lib/hooks/useClients';
import ClientProfileView from '@/components/ClientProfileView';

export default function ChecklistsPage() {
  const { profile } = useAuth();
  const orgId = profile?.org_id || null;

  const { clients } = useClients(orgId);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');

  const filteredClients = useMemo(() =>
    clients.filter(c => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())),
    [clients, clientSearch]
  );

  // Auto-select first client on load
  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  const selectedClient = useMemo(() =>
    clients.find(c => c.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── LEFT: client list ──────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col border-r border-border-light bg-surface-elevated/40">
        {/* Search */}
        <div className="shrink-0 p-3 border-b border-border-light">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              placeholder="Search clients…"
              className="input-field text-sm w-full pl-8 py-2"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-border-light/60">
          {filteredClients.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center py-8 px-4">No clients yet</p>
          ) : (
            filteredClients.map(client => {
              const isSelected = selectedClientId === client.id;
              return (
                <button
                  key={client.id}
                  onClick={() => setSelectedClientId(client.id)}
                  className={`w-full flex items-center gap-3 px-3 py-3 transition-colors text-left ${isSelected ? 'bg-primary/8 border-r-2 border-primary' : 'hover:bg-surface-elevated'}`}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: client.color || '#6366f1' }}
                  >
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                      {client.name}
                    </p>
                    {client.address && (
                      <p className="text-[11px] text-text-tertiary truncate">{client.address}</p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── RIGHT: full client profile ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedClient && orgId ? (
          <ClientProfileView
            key={selectedClient.id}
            clientId={selectedClient.id}
            orgId={orgId}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-tertiary mx-auto mb-3">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
              </svg>
              <p className="text-sm font-semibold text-text-secondary">Select a client</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
