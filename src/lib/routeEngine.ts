import { Client, TeamSchedule, TravelSegment, DaySummary } from './types';
import { parseTime, minutesToTime } from './timeUtils';
import { routeCache } from './routeCache';

export async function calculateTravel(
  directionsService: google.maps.DirectionsService,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  departureTime?: Date
): Promise<{ durationMinutes: number; distanceKm: number; durationText: string; distanceText: string } | null> {
  const cacheKey = `${origin.lat},${origin.lng}->${destination.lat},${destination.lng}`;
  const cached = routeCache.get(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    // Only include traffic data if departure time is in the future
    const useTraffic = departureTime && departureTime.getTime() > Date.now();
    const request: google.maps.DirectionsRequest = {
      origin, destination,
      travelMode: google.maps.TravelMode.DRIVING,
      ...(useTraffic ? { drivingOptions: { departureTime: departureTime!, trafficModel: google.maps.TrafficModel.BEST_GUESS } } : {}),
    };
    directionsService.route(request, (result, status) => {
      if (status === google.maps.DirectionsStatus.OK && result) {
        const leg = result.routes[0]?.legs[0];
        if (leg) {
          const durationSeconds = leg.duration_in_traffic?.value || leg.duration?.value || 0;
          const travelResult = {
            durationMinutes: Math.ceil(durationSeconds / 60),
            distanceKm: parseFloat(((leg.distance?.value || 0) / 1000).toFixed(1)),
            durationText: leg.duration_in_traffic?.text || leg.duration?.text || '',
            distanceText: leg.distance?.text || '',
          };
          routeCache.set(cacheKey, travelResult);
          resolve(travelResult);
          return;
        }
      }
      resolve(null);
    });
  });
}

export async function calculateAllTravel(
  directionsService: google.maps.DirectionsService,
  team: TeamSchedule,
  onUpdate: (segment: TravelSegment) => void
): Promise<void> {
  if (!team.baseAddress || team.clients.length === 0) return;
  const stops = [
    { id: 'base', lat: team.baseAddress.lat, lng: team.baseAddress.lng },
    ...team.clients.map((c) => ({ id: c.id, lat: c.location.lat, lng: c.location.lng })),
    { id: 'base-return', lat: team.baseAddress.lat, lng: team.baseAddress.lng },
  ];
  const today = new Date();
  const [startH, startM] = team.dayStartTime.split(':').map(Number);
  let currentMinutes = startH * 60 + startM;

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i], to = stops[i + 1];
    const departureTime = new Date(today);
    departureTime.setHours(Math.floor(currentMinutes / 60) % 24, currentMinutes % 60, 0, 0);
    onUpdate({ fromId: from.id, toId: to.id, durationMinutes: 0, distanceKm: 0, durationText: '', distanceText: '', isCalculating: true });
    const result = await calculateTravel(directionsService, { lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, departureTime);
    if (result) {
      onUpdate({ fromId: from.id, toId: to.id, ...result, isCalculating: false });
      currentMinutes += result.durationMinutes;
      if (i < team.clients.length) {
        currentMinutes += team.clients[i].jobDurationMinutes / (team.clients[i].staffCount || 1);
      }
    }
    if (i < stops.length - 2) await new Promise((r) => setTimeout(r, 200));
  }
}

export interface ScheduleTimesResult {
  clients: Client[];
  /** When the team actually needs to depart base (back-calculated if first client has a fixed start time) */
  baseDepartureTime: string;
}

export function calculateScheduleTimes(team: TeamSchedule): ScheduleTimesResult {
  if (!team.baseAddress || team.clients.length === 0) {
    return { clients: team.clients, baseDepartureTime: team.dayStartTime };
  }
  let currentTime = parseTime(team.dayStartTime);
  let baseDepartureTime = team.dayStartTime;
  const updatedClients: Client[] = [];
  for (let i = 0; i < team.clients.length; i++) {
    const client = team.clients[i];
    const prevId = i === 0 ? 'base' : team.clients[i - 1].id;
    const segment = team.travelSegments.get(`${prevId}->${client.id}`);
    if (segment && !segment.isCalculating) currentTime += segment.durationMinutes;
    if (i > 0) {
      const brk = team.breaks.find((b) => b.afterClientId === team.clients[i - 1].id);
      if (brk) currentTime += brk.durationMinutes;
    }
    let startTime: string;
    if (client.fixedStartTime) {
      startTime = client.fixedStartTime;
      // Back-calculate base departure for the first client
      if (i === 0 && segment && !segment.isCalculating) {
        const fixedMin = parseTime(client.fixedStartTime);
        baseDepartureTime = minutesToTime(fixedMin - segment.durationMinutes);
      } else if (i === 0) {
        baseDepartureTime = client.fixedStartTime;
      }
      currentTime = parseTime(client.fixedStartTime);
    } else {
      startTime = minutesToTime(currentTime);
    }
    const effectiveDuration = client.jobDurationMinutes / (client.staffCount || 1);
    currentTime += effectiveDuration;
    updatedClients.push({ ...client, startTime, endTime: minutesToTime(currentTime) });
  }
  return { clients: updatedClients, baseDepartureTime };
}

export function calculateDaySummary(team: TeamSchedule): DaySummary {
  let totalTravelMinutes = 0, totalDistanceKm = 0;
  team.travelSegments.forEach((s) => { if (!s.isCalculating) { totalTravelMinutes += s.durationMinutes; totalDistanceKm += s.distanceKm; } });
  const totalJobMinutes = team.clients.reduce((s, c) => s + c.jobDurationMinutes, 0);
  const totalBreakMinutes = team.breaks.reduce((s, b) => s + b.durationMinutes, 0);
  const effectiveJobMinutes = team.clients.reduce((s, c) => s + c.jobDurationMinutes / (c.staffCount || 1), 0);
  const totalWorkMinutes = effectiveJobMinutes + totalTravelMinutes + totalBreakMinutes;
  // Payable = jobs + travel (breaks excluded for payroll)
  const payableMinutes = effectiveJobMinutes + totalTravelMinutes;
  return {
    totalJobMinutes, totalTravelMinutes, totalDistanceKm, totalWorkMinutes,
    totalBreakMinutes, payableMinutes,
    wageAmount: (payableMinutes / 60) * team.hourlyRate,
    fuelCost: (totalDistanceKm / 100) * team.fuelEfficiency * team.fuelPrice,
    perKmCost: totalDistanceKm * team.perKmRate,
    clientCount: team.clients.length,
  };
}

export function getRouteWaypoints(team: TeamSchedule) {
  if (!team.baseAddress || team.clients.length === 0) return null;
  return {
    origin: { lat: team.baseAddress.lat, lng: team.baseAddress.lng },
    destination: { lat: team.baseAddress.lat, lng: team.baseAddress.lng },
    waypoints: team.clients.map((c) => ({ location: { lat: c.location.lat, lng: c.location.lng }, stopover: true })),
  };
}

export function exportScheduleCSV(team: TeamSchedule, summary: DaySummary, staffNames?: string[]): string {
  const h = ['Stop','Client','Address','Start','End','Duration','Staff','Effective Duration','Travel To (min)','Distance To (km)'];
  const rows: string[][] = [['0','Base',team.baseAddress?.address||'',team.dayStartTime,'','','','','','']];
  team.clients.forEach((c, i) => {
    const prevId = i === 0 ? 'base' : team.clients[i-1].id;
    const seg = team.travelSegments.get(`${prevId}->${c.id}`);
    const eff = c.jobDurationMinutes / (c.staffCount || 1);
    rows.push([String(i+1),c.name,c.location.address,c.startTime||'',c.endTime||'',`${c.jobDurationMinutes} min`,String(c.staffCount||1),`${eff.toFixed(0)} min`,seg?String(seg.durationMinutes):'',seg?String(seg.distanceKm):'']);
  });
  if (team.clients.length > 0) {
    const last = team.clients[team.clients.length-1];
    const ret = team.travelSegments.get(`${last.id}->base-return`);
    rows.push([String(team.clients.length+1),'Return to Base',team.baseAddress?.address||'',last.endTime||'','','','','',ret?String(ret.durationMinutes):'',ret?String(ret.distanceKm):'']);
  }
  rows.push([],['Summary']);
  if (staffNames && staffNames.length > 0) {
    rows.push(['Assigned Staff', staffNames.join(', ')]);
    rows.push(['Team Headcount', String(staffNames.length)]);
  }
  rows.push(['Total Clients',String(summary.clientCount)],['Total Job Time',`${summary.totalJobMinutes} min`],['Total Travel',`${summary.totalTravelMinutes} min`],['Total Distance',`${summary.totalDistanceKm.toFixed(1)} km`],['Total Work',`${summary.totalWorkMinutes.toFixed(0)} min`],['Work Hours (decimal)',`${(summary.totalWorkMinutes/60).toFixed(2)} hours`],[`Wage ($${team.hourlyRate}/hr)`,`$${summary.wageAmount.toFixed(2)}`],['Fuel Cost',`$${summary.fuelCost.toFixed(2)}`]);
  if (team.perKmRate > 0) rows.push([`Per-KM ($${team.perKmRate}/km)`,`$${summary.perKmCost.toFixed(2)}`]);
  return [h,...rows].map(r => r.join(',')).join('\n');
}
