'use client';

import { useRef, useEffect } from 'react';
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

  useEffect(() => {
    if (!inputRef.current || !window.google?.maps?.places) return;
    if (autocompleteRef.current) return;

    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'au' },
      types: ['address'],
      fields: ['formatted_address', 'geometry', 'place_id', 'name'],
    });

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace();
      if (place?.geometry?.location) {
        onPlaceSelect({
          address: place.formatted_address || place.name || '',
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          placeId: place.place_id,
        });
      }
    });
  }, [onPlaceSelect]);

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
