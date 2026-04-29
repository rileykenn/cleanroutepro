'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { TeamSchedule } from '@/lib/types';

interface RouteMapProps { team: TeamSchedule; }

export default function RouteMap({ team }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const polylineRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // These hooks ensure the libraries are loaded before we use google.maps.*
  const mapsLib = useMapsLibrary('maps');
  const routesLib = useMapsLibrary('routes');

  useEffect(() => {
    if (!mapRef.current || !mapsLib || mapInstance.current) return;
    mapInstance.current = new google.maps.Map(mapRef.current, {
      center: { lat: -33.8688, lng: 151.2093 },
      zoom: 10, disableDefaultUI: true, zoomControl: true,
      styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
    });
    setMapReady(true);
  }, [mapsLib]);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }
  }, []);

  useEffect(() => {
    if (!mapReady || !mapInstance.current || !mapsLib || !routesLib) return;
    clearMarkers();

    if (!team.baseAddress || team.clients.length === 0) {
      if (team.baseAddress) mapInstance.current.setCenter({ lat: team.baseAddress.lat, lng: team.baseAddress.lng });
      return;
    }

    // Base marker
    const baseMarker = new google.maps.Marker({
      position: { lat: team.baseAddress.lat, lng: team.baseAddress.lng },
      map: mapInstance.current, title: 'Base',
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: team.color.primary, fillOpacity: 1, strokeColor: 'white', strokeWeight: 2, scale: 10 },
      label: { text: '🏠', fontSize: '14px' },
    });
    markersRef.current.push(baseMarker);

    // Client markers
    team.clients.forEach((client, i) => {
      const marker = new google.maps.Marker({
        position: { lat: client.location.lat, lng: client.location.lng },
        map: mapInstance.current!, title: client.name,
        label: { text: String(i + 1), color: 'white', fontWeight: 'bold', fontSize: '12px' },
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: team.color.primary, fillOpacity: 1, strokeColor: 'white', strokeWeight: 2, scale: 14 },
      });
      markersRef.current.push(marker);
    });

    // Directions
    const directionsService = new google.maps.DirectionsService();
    const directionsRenderer = new google.maps.DirectionsRenderer({
      map: mapInstance.current, suppressMarkers: true,
      polylineOptions: { strokeColor: team.color.primary, strokeWeight: 4, strokeOpacity: 0.7 },
    });
    polylineRef.current = directionsRenderer;

    const waypoints = team.clients.map((c) => ({ location: { lat: c.location.lat, lng: c.location.lng }, stopover: true }));
    directionsService.route({
      origin: { lat: team.baseAddress.lat, lng: team.baseAddress.lng },
      destination: { lat: team.baseAddress.lat, lng: team.baseAddress.lng },
      waypoints, travelMode: google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === google.maps.DirectionsStatus.OK && result) directionsRenderer.setDirections(result);
    });

    // Fit bounds
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: team.baseAddress.lat, lng: team.baseAddress.lng });
    team.clients.forEach((c) => bounds.extend({ lat: c.location.lat, lng: c.location.lng }));
    mapInstance.current.fitBounds(bounds, 60);
  }, [mapReady, mapsLib, routesLib, team.baseAddress, team.clients, team.color.primary, clearMarkers]);

  return <div ref={mapRef} className="w-full h-full rounded-xl" style={{ minHeight: 300 }} />;
}
