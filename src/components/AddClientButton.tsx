'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PlacesAutocomplete from './PlacesAutocomplete';
import { Client, Location, ScheduleAction } from '@/lib/types';
import { generateId } from '@/lib/timeUtils';
import { SavedClient } from '@/lib/hooks/useClients';

interface AddClientButtonProps {
  teamId: string;
  dispatch: React.Dispatch<ScheduleAction>;
  savedClients: SavedClient[];
  searchClients: (query: string) => SavedClient[];
}

export default function AddClientButton({ teamId, dispatch, savedClients, searchClients }: AddClientButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const results = searchQuery.trim() ? searchClients(searchQuery) : savedClients.slice(0, 8);

  const addFromSaved = (sc: SavedClient) => {
    const client: Client = {
      id: generateId(), name: sc.name,
      location: { address: sc.address, lat: sc.lat || 0, lng: sc.lng || 0, placeId: sc.place_id || undefined },
      jobDurationMinutes: sc.default_duration_minutes || 90, staffCount: sc.default_staff_count || 1,
      isLocked: false, savedClientId: sc.id, email: sc.email, phone: sc.phone,
    };
    dispatch({ type: 'ADD_CLIENT', teamId, client });
    setIsOpen(false); setSearchQuery('');
  };

  const addNewClient = (location: Location) => {
    const client: Client = {
      id: generateId(), name: '', location, jobDurationMinutes: 90, staffCount: 1, isLocked: false,
    };
    dispatch({ type: 'ADD_CLIENT', teamId, client });
    setIsOpen(false); setSearchQuery('');
  };

  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)}
        className="btn-primary w-full py-3 text-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Client
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="absolute left-0 right-0 top-full mt-2 card-elevated p-4 z-30">
            <div className="mb-3">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Search saved clients</label>
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field text-sm" placeholder="Search by name or address..." autoFocus />
            </div>

            {results.length > 0 && (
              <div className="space-y-1 mb-3 max-h-[200px] overflow-y-auto custom-scrollbar">
                {results.map((sc) => (
                  <button key={sc.id} onClick={() => addFromSaved(sc)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-primary-light transition-colors">
                    <div className="text-sm font-medium text-text-primary">{sc.name}</div>
                    <div className="text-xs text-text-tertiary truncate">{sc.address}</div>
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-border-light pt-3">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Or add new address</label>
              <PlacesAutocomplete onPlaceSelect={addNewClient} placeholder="Type an address..." className="text-sm" />
            </div>

            <button onClick={() => { setIsOpen(false); setSearchQuery(''); }}
              className="btn-ghost w-full mt-2 text-xs">Cancel</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
