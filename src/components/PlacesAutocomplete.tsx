'use client';

import { useRef, useEffect } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Location } from '@/lib/types';

interface PlacesAutocompleteProps {
  onPlaceSelect: (location: Location) => void;
  onTextChange?: (text: string) => void;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}

export default function PlacesAutocomplete({ onPlaceSelect, onTextChange, defaultValue = '', placeholder = 'Search address...', className = '' }: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const placesLib = useMapsLibrary('places');

  // Keep a stable ref to the latest onPlaceSelect so the Google listener
  // never captures a stale closure when teams switch.
  const onPlaceSelectRef = useRef(onPlaceSelect);
  useEffect(() => { onPlaceSelectRef.current = onPlaceSelect; }, [onPlaceSelect]);

  useEffect(() => {
    if (!inputRef.current || !placesLib) return;
    if (autocompleteRef.current) return;

    autocompleteRef.current = new placesLib.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'au' },
      types: ['address'],
      fields: ['formatted_address', 'geometry', 'place_id', 'name'],
    });

    // Always call via ref so we get the current team's handler, never a stale one.
    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace();
      if (place?.geometry?.location) {
        onPlaceSelectRef.current({
          address: place.formatted_address || place.name || '',
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          placeId: place.place_id,
        });
      }
    });
  }, [placesLib]);

  // Sync the input's displayed value whenever the active team changes.
  // We can't use a controlled <input> with Google Autocomplete (it fights over
  // the value), so we imperatively update the DOM when defaultValue changes,
  // but only when the input isn't currently focused (don't interrupt typing).
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = defaultValue;
    }
  }, [defaultValue]);

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={defaultValue}
      placeholder={placeholder}
      onChange={(e) => onTextChange?.(e.target.value)}
      className={`input-field ${className}`}
    />
  );
}
