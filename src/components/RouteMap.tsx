'use client';

import { useEffect, useState, useCallback } from 'react';
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
    if (!service || !renderer || !map || !team.baseAddress || team.clients.length === 0) {
      renderer?.setDirections({ routes: [] } as unknown as google.maps.DirectionsResult);
      return;
    }

    const origin = { lat: team.baseAddress.lat, lng: team.baseAddress.lng };
    const destination = { lat: team.baseAddress.lat, lng: team.baseAddress.lng };
    const waypoints: google.maps.DirectionsWaypoint[] = team.clients.map((c) => ({
      location: { lat: c.location.lat, lng: c.location.lng },
      stopover: true,
    }));

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
  }, [service, renderer, map, team.baseAddress, team.clients]);

  useEffect(() => {
    renderRoute();
  }, [renderRoute]);

  // Custom markers
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

    // Fit bounds
    if (markers.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      markers.forEach((m) => {
        const pos = m.getPosition();
        if (pos) bounds.extend(pos);
      });
      map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
    }

    return () => {
      markers.forEach((m) => m.setMap(null));
    };
  }, [map, team.baseAddress, team.clients, team.color.primary]);

  return null;
}
