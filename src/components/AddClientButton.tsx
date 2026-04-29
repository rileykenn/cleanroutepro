'use client';

import { useState, useCallback } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { motion, AnimatePresence } from 'framer-motion';
import PlacesAutocomplete from './PlacesAutocomplete';
import { JOB_DURATIONS, generateId } from '@/lib/timeUtils';
import { Client, Location, ScheduleAction } from '@/lib/types';

interface AddClientButtonProps {
  teamId: string;
  teamColor: string;
  dispatch: React.Dispatch<ScheduleAction>;
}

export default function AddClientButton({ teamId, teamColor, dispatch }: AddClientButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState<Location | null>(null);
  const [addressText, setAddressText] = useState('');
  const [duration, setDuration] = useState(90);
  const [isResolving, setIsResolving] = useState(false);
  const map = useMap();

  // Geocode fallback — resolve raw text to a valid Google address
  const geocodeAddress = useCallback(async (text: string): Promise<Location | null> => {
    if (!window.google?.maps) return null;
    
    const autocompleteService = new google.maps.places.AutocompleteService();
    
    // Step 1: Get the top autocomplete prediction (same as what appears in the dropdown)
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

          // Step 2: Get full place details (lat/lng) for the top prediction
          const topPrediction = predictions[0];
          
          // Use a temporary hidden div for PlacesService (required by Google)
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
    // If location is already set (user selected from autocomplete), use it directly
    if (location) {
      addClient(location);
      return;
    }

    // Fallback: user typed an address but didn't select from autocomplete
    const text = addressText.trim();
    if (!text) return;

    setIsResolving(true);
    const resolved = await geocodeAddress(text);
    setIsResolving(false);

    if (resolved) {
      addClient(resolved);
    } else {
      // Could not resolve — give a visual hint
      alert('Could not find that address. Please check the spelling or select from the dropdown suggestions.');
    }
  };

  const addClient = (loc: Location) => {
    const client: Client = {
      id: generateId(),
      name: name || `Client`,
      location: loc,
      jobDurationMinutes: duration,
      staffCount: 1,
      isLocked: false,
    };

    dispatch({ type: 'ADD_CLIENT', teamId, client });
    setName('');
    setLocation(null);
    setAddressText('');
    setDuration(90);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setIsOpen(false);
    setName('');
    setLocation(null);
    setAddressText('');
    setDuration(90);
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
              <span className="text-sm font-semibold text-text-primary">New Client</span>
            </div>

            <div className="space-y-3">
              {/* Client name */}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Client name (optional)"
                className="input-field text-sm"
                autoFocus
              />

              {/* Address */}
              <PlacesAutocomplete
                onPlaceSelect={(loc) => {
                  setLocation(loc);
                  setAddressText(loc.address);
                }}
                onTextChange={(text) => {
                  setAddressText(text);
                  // Clear the resolved location when they start typing something new
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
                <button onClick={handleCancel} className="btn-ghost text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
