'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { motion, AnimatePresence } from 'framer-motion';
import PlacesAutocomplete from './PlacesAutocomplete';
import { JOB_DURATIONS, generateId } from '@/lib/timeUtils';
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
  const [name, setName] = useState('');
  const [location, setLocation] = useState<Location | null>(null);
  const [addressText, setAddressText] = useState('');
  const [duration, setDuration] = useState(90);
  const [isResolving, setIsResolving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(true);
  const map = useMap();

  // Saved clients search
  const { clients: savedClients, loading: clientsLoading } = useClients(orgId ?? null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return savedClients.filter(
      (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [searchQuery, savedClients]);

  // Geocode fallback — resolve raw text to a valid Google address
  const geocodeAddress = useCallback(async (text: string): Promise<Location | null> => {
    if (!window.google?.maps) return null;
    
    const autocompleteService = new google.maps.places.AutocompleteService();
    
    return new Promise((resolve) => {
      autocompleteService.getPlacePredictions(
        {
          input: text,
          componentRestrictions: { country: 'au' },
          types: ['address'],
        },
        (predictions, status) => {
          if (
            status !== google.maps.places.PlacesServiceStatus.OK ||
            !predictions ||
            predictions.length === 0
          ) {
            resolve(null);
            return;
          }

          const topPrediction = predictions[0];
          const tempDiv = document.createElement('div');
          const placesService = new google.maps.places.PlacesService(tempDiv);

          placesService.getDetails(
            {
              placeId: topPrediction.place_id,
              fields: ['formatted_address', 'geometry', 'place_id', 'name'],
            },
            (place, detailsStatus) => {
              if (
                detailsStatus === google.maps.places.PlacesServiceStatus.OK &&
                place?.geometry?.location
              ) {
                resolve({
                  address: place.formatted_address || place.name || topPrediction.description,
                  lat: place.geometry.location.lat(),
                  lng: place.geometry.location.lng(),
                  placeId: place.place_id,
                });
              } else {
                resolve(null);
              }
            }
          );
        }
      );
    });
  }, []);

  const handleSubmit = async () => {
    if (location) {
      addClient(location);
      return;
    }

    const text = addressText.trim();
    if (!text) return;

    setIsResolving(true);
    const resolved = await geocodeAddress(text);
    setIsResolving(false);

    if (resolved) {
      addClient(resolved);
    } else {
      alert('Could not find that address. Please check the spelling or select from the dropdown suggestions.');
    }
  };

  const addClient = (loc: Location, savedClientId?: string) => {
    const client: Client = {
      id: generateId(),
      name: name || `Client`,
      location: loc,
      jobDurationMinutes: duration,
      staffCount: 1,
      isLocked: false,
      savedClientId,
    };

    dispatch({ type: 'ADD_CLIENT', teamId, client });
    resetForm();
  };

  const addSavedClient = (saved: SavedClient) => {
    const loc: Location = {
      address: saved.address,
      lat: saved.lat || 0,
      lng: saved.lng || 0,
      placeId: saved.place_id || undefined,
    };

    const client: Client = {
      id: generateId(),
      name: saved.name,
      location: loc,
      jobDurationMinutes: saved.default_duration_minutes || 90,
      staffCount: saved.default_staff_count || 1,
      isLocked: false,
      savedClientId: saved.id,
      notes: saved.notes || undefined,
      email: saved.email || undefined,
      phone: saved.phone || undefined,
    };

    dispatch({ type: 'ADD_CLIENT', teamId, client });
    resetForm();

    // If no lat/lng, resolve the address in background
    if (!saved.lat || !saved.lng) {
      geocodeAddress(saved.address).then((resolved) => {
        if (resolved) {
          dispatch({
            type: 'UPDATE_CLIENT',
            teamId,
            clientId: client.id,
            updates: { location: resolved },
          });
        }
      });
    }
  };

  const resetForm = () => {
    setIsOpen(false);
    setName('');
    setLocation(null);
    setAddressText('');
    setDuration(90);
    setSearchQuery('');
    setShowSearch(true);
  };

  const hasInput = !!location || addressText.trim().length > 0;

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
            style={{
              borderColor: `${teamColor}40`,
              color: teamColor,
            }}
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
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="card p-4"
            style={{ borderLeft: `3px solid ${teamColor}` }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-6 h-6 rounded-md flex items-center justify-center"
                style={{ backgroundColor: `${teamColor}15` }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={teamColor} strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-text-primary">Add Client</span>
              {/* Toggle between search and manual */}
              {orgId && savedClients.length > 0 && (
                <div className="ml-auto flex items-center gap-1 text-xs">
                  <button
                    onClick={() => setShowSearch(true)}
                    className={`px-2 py-1 rounded-md transition-colors ${showSearch ? 'bg-primary-light text-primary font-semibold' : 'text-text-tertiary hover:text-text-secondary'}`}
                  >
                    Search
                  </button>
                  <button
                    onClick={() => setShowSearch(false)}
                    className={`px-2 py-1 rounded-md transition-colors ${!showSearch ? 'bg-primary-light text-primary font-semibold' : 'text-text-tertiary hover:text-text-secondary'}`}
                  >
                    Manual
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {/* Saved client search */}
              {showSearch && orgId && savedClients.length > 0 && (
                <div className="relative">
                  <div className="relative">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Search ${savedClients.length} saved clients...`}
                      className="input-field text-sm pl-9"
                      autoFocus
                    />
                  </div>
                  <AnimatePresence>
                    {searchResults.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="mt-1.5 bg-white border border-border rounded-xl shadow-dropdown overflow-hidden max-h-[240px] overflow-y-auto custom-scrollbar"
                      >
                        {searchResults.map((client) => (
                          <button
                            key={client.id}
                            onClick={() => addSavedClient(client)}
                            className="w-full text-left px-3 py-2.5 hover:bg-surface-elevated transition-colors border-b border-border-light last:border-b-0"
                          >
                            <div className="text-sm font-medium text-text-primary">{client.name}</div>
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
                    )}
                  </AnimatePresence>
                  {searchQuery.length >= 2 && searchResults.length === 0 && (
                    <p className="text-xs text-text-tertiary mt-1.5 pl-1">No matching clients. Try manual entry below.</p>
                  )}
                </div>
              )}

              {/* Manual entry fields — always visible if showSearch is off, or as fallback */}
              {(!showSearch || !orgId || savedClients.length === 0) && (
                <>
                  {/* Client name */}
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Client name (optional)"
                    className="input-field text-sm"
                    autoFocus={!showSearch}
                  />

                  {/* Address */}
                  <PlacesAutocomplete
                    onPlaceSelect={(loc) => {
                      setLocation(loc);
                      setAddressText(loc.address);
                    }}
                    onTextChange={(text) => {
                      setAddressText(text);
                      if (location && text !== location.address) {
                        setLocation(null);
                      }
                    }}
                    placeholder="Enter client address..."
                    className="text-sm"
                  />

                  {/* Duration */}
                  <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary shrink-0">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="text-sm bg-surface-elevated border border-border-light rounded-lg px-3 py-1.5 outline-none 
                               focus:border-primary cursor-pointer flex-1"
                    >
                      {JOB_DURATIONS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleSubmit}
                      disabled={!hasInput || isResolving}
                      className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                      style={{
                        backgroundColor: hasInput && !isResolving ? teamColor : undefined,
                      }}
                    >
                      {isResolving ? 'Finding address...' : 'Add to Schedule'}
                    </button>
                    <button onClick={resetForm} className="btn-ghost text-sm">
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {/* Cancel button when in search mode */}
              {showSearch && orgId && savedClients.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={() => setShowSearch(false)} className="btn-secondary flex-1 text-sm py-2.5">
                    Manual Entry
                  </button>
                  <button onClick={resetForm} className="btn-ghost text-sm">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
