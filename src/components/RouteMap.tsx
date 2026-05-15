'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { TeamSchedule } from '@/lib/types';

interface RouteMapProps {
  team: TeamSchedule;
}

export default function RouteMap({ team }: RouteMapProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary('routes');
  const [renderer, setRenderer] = useState<google.maps.DirectionsRenderer | null>(null);
  const [service, setService] = useState<google.maps.DirectionsService | null>(null);
  const lastBoundsRef = useRef<string>('');
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize services
  useEffect(() => {
    if (!routesLibrary || !map) return;

    const directionsRenderer = new routesLibrary.DirectionsRenderer({
      map,
      suppressMarkers: true, // We'll use custom markers
      polylineOptions: {
        strokeColor: team.color.primary,
        strokeWeight: 4,
        strokeOpacity: 0.8,
      },
    });

    const directionsService = new routesLibrary.DirectionsService();

    setRenderer(directionsRenderer);
    setService(directionsService);

    return () => {
      directionsRenderer.setMap(null);
    };
  }, [routesLibrary, map, team.color.primary]);

  // Update route polyline color when team changes
  useEffect(() => {
    if (!renderer) return;
    renderer.setOptions({
      polylineOptions: {
        strokeColor: team.color.primary,
        strokeWeight: 4,
        strokeOpacity: 0.8,
      },
    });
  }, [renderer, team.color.primary]);

  // Calculate and render the route
  const renderRoute = useCallback(() => {
    if (!service || !renderer || !map || team.clients.length === 0) {
      renderer?.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);
      return;
    }

    const hasBase = team.baseAddress && team.baseAddress.lat !== 0;
    const returnAddr = team.returnAddress === 'none' ? null : (team.returnAddress || team.baseAddress);

    let origin: google.maps.LatLngLiteral;
    let destination: google.maps.LatLngLiteral;
    let waypoints: google.maps.DirectionsWaypoint[];

    if (hasBase) {
      // Base → clients → return (or base)
      origin = { lat: team.baseAddress!.lat, lng: team.baseAddress!.lng };
      destination = returnAddr
        ? { lat: returnAddr.lat, lng: returnAddr.lng }
        : { lat: team.baseAddress!.lat, lng: team.baseAddress!.lng };
      waypoints = team.clients.map((c) => ({
        location: { lat: c.location.lat, lng: c.location.lng },
        stopover: true,
      }));
    } else if (team.clients.length === 1) {
      // Single client, no base — nothing to route
      renderer?.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);
      return;
    } else {
      // No base: first client → intermediate clients → last client
      const first = team.clients[0];
      const last = team.clients[team.clients.length - 1];
      origin = { lat: first.location.lat, lng: first.location.lng };
      destination = returnAddr
        ? { lat: returnAddr.lat, lng: returnAddr.lng }
        : { lat: last.location.lat, lng: last.location.lng };
      // Middle clients are waypoints (skip first, and skip last if no return)
      const middleClients = returnAddr
        ? team.clients.slice(1)  // all except first become waypoints
        : team.clients.slice(1, -1); // skip first and last
      waypoints = middleClients.map((c) => ({
        location: { lat: c.location.lat, lng: c.location.lng },
        stopover: true,
      }));
    }

    service.route(
      {
        origin,
        destination,
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false, // Keep user's specified order
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          renderer.setDirections(result);
        }
      }
    );
  }, [service, renderer, map, team.baseAddress, team.returnAddress, team.clients]);

  useEffect(() => {
    renderRoute();
  }, [renderRoute]);

  // Custom markers — stable, no-animation positioning
  useEffect(() => {
    if (!map) return;

    const markers: google.maps.Marker[] = [];

    // Base marker
    if (team.baseAddress) {
      const baseMarker = new google.maps.Marker({
        position: { lat: team.baseAddress.lat, lng: team.baseAddress.lng },
        map,
        label: {
          text: '🏠',
          fontSize: '20px',
        },
        title: 'Base Address',
        zIndex: 1000,
      });
      markers.push(baseMarker);
    }

    // Client markers
    team.clients.forEach((client, index) => {
      const marker = new google.maps.Marker({
        position: { lat: client.location.lat, lng: client.location.lng },
        map,
        label: {
          text: String(index + 1),
          color: 'white',
          fontWeight: 'bold',
          fontSize: '13px',
        },
        title: client.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 16,
          fillColor: team.color.primary,
          fillOpacity: 1,
          strokeColor: 'white',
          strokeWeight: 3,
        },
        zIndex: 999 - index,
      });

      // Info window
      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="font-family: Inter, system-ui, sans-serif; padding: 4px 0;">
            <div style="font-weight: 600; font-size: 14px; color: #111827; margin-bottom: 4px;">${client.name}</div>
            <div style="font-size: 13px; color: #6B7280; margin-bottom: 4px;">${client.location.address}</div>
            <div style="font-size: 13px; color: ${team.color.primary}; font-weight: 500;">
              ${client.startTime || ''} – ${client.endTime || ''} · ${client.jobDurationMinutes} min
            </div>
          </div>
        `,
      });

      marker.addListener('click', () => {
        infoWindow.open(map, marker);
      });

      markers.push(marker);
    });

    // Build a stable fingerprint of marker positions so we only refit when positions actually change
    const boundsFingerprint = [
      team.baseAddress ? `${team.baseAddress.lat},${team.baseAddress.lng}` : '',
      ...team.clients.map(c => `${c.location.lat},${c.location.lng}`),
    ].join('|');

    // Only fit bounds if marker positions actually changed (not on every time/color re-render)
    if (markers.length > 0 && boundsFingerprint !== lastBoundsRef.current) {
      lastBoundsRef.current = boundsFingerprint;

      // Debounce: wait for data to settle, then fit once with no animation
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
      boundsTimerRef.current = setTimeout(() => {
        const bounds = new google.maps.LatLngBounds();
        markers.forEach((m) => {
          const pos = m.getPosition();
          if (pos) bounds.extend(pos);
        });
        // Use moveCamera for instant positioning — no animated panning
        map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
        // Immediately override with moveCamera to cancel any animation
        const listener = google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
          const center = map.getCenter();
          const zoom = map.getZoom();
          if (center && zoom) {
            map.moveCamera({ center, zoom });
          }
        });
        // Safety cleanup
        setTimeout(() => google.maps.event.removeListener(listener), 500);
      }, 300);
    }

    return () => {
      markers.forEach((m) => m.setMap(null));
      if (boundsTimerRef.current) clearTimeout(boundsTimerRef.current);
    };
  }, [map, team.baseAddress, team.clients, team.color.primary]);

  return null;
}

