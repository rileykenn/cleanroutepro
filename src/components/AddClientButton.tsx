'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { generateId } from '@/lib/timeUtils';
import { Client, Location, ScheduleAction } from '@/lib/types';
import { useClients, SavedClient } from '@/lib/hooks/useClients';

interface AddClientButtonProps {
  teamId: string;
  teamColor: string;
  dispatch: React.Dispatch<ScheduleAction>;
  orgId?: string | null;
}

export default function AddClientButton({ teamId, teamColor, dispatch, orgId }: AddClientButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const { clients: savedClients } = useClients(orgId ?? null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return savedClients.filter(
      (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery, savedClients]);

  // Geocode a raw address string via the Places API best-match
  const geocodeAddress = useCallback(async (text: string): Promise<Location | null> => {
    if (!window.google?.maps) return null;
    const svc = new google.maps.places.AutocompleteService();
    return new Promise((resolve) => {
      svc.getPlacePredictions(
        { input: text, componentRestrictions: { country: 'au' }, types: ['address'] },
        (predictions, status) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions?.length) { resolve(null); return; }
          const div = document.createElement('div');
          const ps = new google.maps.places.PlacesService(div);
          ps.getDetails(
            { placeId: predictions[0].place_id, fields: ['formatted_address', 'geometry', 'place_id'] },
            (place, s) => {
              if (s === google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
                resolve({
                  address: place.formatted_address || text,
                  lat: place.geometry.location.lat(),
                  lng: place.geometry.location.lng(),
                  placeId: place.place_id,
                });
              } else resolve(null);
            }
          );
        }
      );
    });
  }, []);

  const addSavedClient = (saved: SavedClient) => {
    const clientId = generateId();
    const loc: Location = {
      address: saved.address,
      lat: saved.lat || 0,
      lng: saved.lng || 0,
      placeId: saved.place_id || undefined,
    };

    const client: Client = {
      id: clientId,
      name: saved.name,
      location: loc,
      jobDurationMinutes: saved.default_duration_minutes || 90,
      staffCount: saved.default_staff_count || 1,
      isLocked: false,
      savedClientId: saved.id,
      notes: saved.notes || undefined,
      clientColor: saved.color || undefined,
    };

    dispatch({ type: 'ADD_CLIENT', teamId, client });
    reset();

    // If the stored coordinates are missing or zero, resolve the address in the background
    // and patch the card once we have real coordinates.
    if (!saved.lat || !saved.lng) {
      geocodeAddress(saved.address).then((resolved) => {
        if (resolved) {
          dispatch({ type: 'UPDATE_CLIENT', teamId, clientId, updates: { location: resolved } });
        }
      });
    }
  };

  const reset = () => {
    setIsOpen(false);
    setSearchQuery('');
    setIsFocused(false);
  };

  return (
    <div>
      <AnimatePresence mode="wait">
        {!isOpen ? (
          <motion.button
            key="add-button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="w-full py-3 px-4 rounded-xl border-2 border-dashed transition-all text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
            style={{ borderColor: `${teamColor}40`, color: teamColor }}
            whileHover={{ scale: 1.01, borderColor: teamColor }}
            whileTap={{ scale: 0.99 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Client
          </motion.button>
        ) : (
          <motion.div
            key="add-form"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="card p-4"
            style={{ borderLeft: `3px solid ${teamColor}` }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: `${teamColor}15` }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={teamColor} strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
              <span className="text-sm font-semibold text-text-primary">Add from Client Database</span>
              <button onClick={reset} className="ml-auto p-1 rounded-lg hover:bg-surface-elevated text-text-tertiary hover:text-text-primary transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Search input */}
            <div className="relative mb-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setTimeout(() => setIsFocused(false), 150)}
                placeholder={`Search ${savedClients.length} clients...`}
                className="input-field text-sm"
                style={{ paddingLeft: '2.25rem' }}
                autoFocus
              />
            </div>

            {/* Results — only when focused and query has content */}
            <AnimatePresence>
              {savedClients.length === 0 ? (
                <p className="text-xs text-text-tertiary text-center py-4">
                  No clients in database yet.{' '}
                  <span className="text-primary">Add them in the Clients tab.</span>
                </p>
              ) : isFocused && searchQuery.trim().length > 0 && searchResults.length === 0 ? (
                <p className="text-xs text-text-tertiary text-center py-4">
                  No match — try a different name or{' '}
                  <span className="text-primary">add them in the Clients tab.</span>
                </p>
              ) : isFocused && searchResults.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white border border-border rounded-xl shadow-dropdown overflow-hidden max-h-[240px] overflow-y-auto custom-scrollbar"
                >
                  {searchResults.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => addSavedClient(client)}
                      className="w-full text-left px-3 py-2.5 hover:bg-surface-elevated transition-colors border-b border-border-light last:border-b-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-text-primary">{client.name}</span>
                        {client.color && <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: client.color }} />}
                      </div>
                      <div className="text-xs text-text-tertiary truncate mt-0.5">{client.address}</div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-text-secondary">
                        <span>{client.default_duration_minutes} min</span>
                        <span>·</span>
                        <span>{client.default_staff_count} staff</span>
                        {client.email && <><span>·</span><span>{client.email}</span></>}
                      </div>
                    </button>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
