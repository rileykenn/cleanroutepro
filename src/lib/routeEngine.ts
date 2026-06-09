import { Client, TeamSchedule, TravelSegment, DaySummary } from './types';
import { parseTime, minutesToTime } from './timeUtils';
import { routeCache } from './routeCache';

/** Number of people on the team — all jobs are completed this many times faster */
function getTeamSize(team: TeamSchedule): number {
  const n = (team.staffIds || []).length;
  return n > 0 ? n : 1;
}

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
  if (team.clients.length === 0) return;
  // If no base, still calculate travel between consecutive clients
  const hasBase = team.baseAddress && team.baseAddress.lat !== 0;
  // Determine return destination: custom address, base address, or none
  const returnAddr = team.returnAddress === 'none' ? null : (team.returnAddress || team.baseAddress);
  const stops = [
    ...(hasBase ? [{ id: 'base', lat: team.baseAddress!.lat, lng: team.baseAddress!.lng }] : []),
    ...team.clients.map((c) => ({ id: c.id, lat: c.location.lat, lng: c.location.lng })),
    ...(hasBase && returnAddr ? [{ id: 'base-return', lat: returnAddr.lat, lng: returnAddr.lng }] : []),
  ];
  if (stops.length < 2) return;
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
      // Advance time by job duration for correct departure estimate on next leg
      const clientIndex = hasBase ? i : i; // index into stops vs clients
      const clientForThisLeg = team.clients.find(c => c.id === to.id);
      if (clientForThisLeg) {
        currentMinutes += clientForThisLeg.jobDurationMinutes / getTeamSize(team);
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
  if (team.clients.length === 0) {
    return { clients: team.clients, baseDepartureTime: team.dayStartTime };
  }
  const hasBase = team.baseAddress && team.baseAddress.lat !== 0;
  const clients = team.clients;
  const n = clients.length;

  // Helper: get travel segment between two stops
  const getTravel = (fromId: string | null, toId: string): number => {
    if (!fromId) return 0;
    const seg = team.travelSegments.get(`${fromId}->${toId}`);
    return (seg && !seg.isCalculating) ? seg.durationMinutes : 0;
  };
  const getBreakAfter = (clientId: string): number => {
    const brk = team.breaks.find(b => b.afterClientId === clientId);
    return brk ? brk.durationMinutes : 0;
  };
  const teamSize = getTeamSize(team);
  const effectiveDur = (c: Client): number => c.jobDurationMinutes / teamSize;

  // Find the last client with a fixedStartTime (anchor for backward calculation)
  let lastAnchorIdx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (clients[i].fixedStartTime) { lastAnchorIdx = i; break; }
  }

  // Build result arrays
  const startTimes: number[] = new Array(n);
  const endTimes: number[] = new Array(n);

  // --- BACKWARD PASS: from each anchor, work backwards to set times for preceding clients ---
  // We process the first anchor found (scanning from end) and backward-fill everything before it.
  if (lastAnchorIdx >= 0) {
    // Set the anchor point
    const anchorTime = parseTime(clients[lastAnchorIdx].fixedStartTime!);
    startTimes[lastAnchorIdx] = anchorTime;
    endTimes[lastAnchorIdx] = anchorTime + effectiveDur(clients[lastAnchorIdx]);

    // Walk backward from anchor to set all preceding clients
    for (let i = lastAnchorIdx - 1; i >= 0; i--) {
      // The client after this one starts at startTimes[i+1].
      // We need: endTimes[i] + break_after_i + travel(i→i+1) = startTimes[i+1]
      // So: endTimes[i] = startTimes[i+1] - travel(i→i+1) - break_after_i
      // But if client[i] also has its own fixedStartTime, use that instead
      if (clients[i].fixedStartTime) {
        startTimes[i] = parseTime(clients[i].fixedStartTime!);
        endTimes[i] = startTimes[i] + effectiveDur(clients[i]);
      } else {
        const travelToNext = getTravel(clients[i].id, clients[i + 1].id);
        const breakAfter = getBreakAfter(clients[i].id);
        endTimes[i] = startTimes[i + 1] - travelToNext - breakAfter;
        startTimes[i] = endTimes[i] - effectiveDur(clients[i]);
      }
    }

    // --- FORWARD PASS: from anchor onward ---
    let currentTime = endTimes[lastAnchorIdx];
    for (let i = lastAnchorIdx + 1; i < n; i++) {
      const travelTo = getTravel(clients[i - 1].id, clients[i].id);
      const breakBefore = getBreakAfter(clients[i - 1].id);
      currentTime += travelTo + breakBefore;

      if (clients[i].fixedStartTime) {
        currentTime = parseTime(clients[i].fixedStartTime!);
      }
      startTimes[i] = currentTime;
      currentTime += effectiveDur(clients[i]);
      endTimes[i] = currentTime;
    }
  } else {
    // --- No anchors: pure forward pass from dayStartTime ---
    let currentTime = parseTime(team.dayStartTime);
    for (let i = 0; i < n; i++) {
      const prevId = i === 0 ? (hasBase ? 'base' : null) : clients[i - 1].id;
      currentTime += getTravel(prevId, clients[i].id);
      if (i > 0) currentTime += getBreakAfter(clients[i - 1].id);
      startTimes[i] = currentTime;
      currentTime += effectiveDur(clients[i]);
      endTimes[i] = currentTime;
    }
  }

  // --- Back-calculate base departure time ---
  let baseDepartureTime = team.dayStartTime;
  if (n > 0) {
    const firstTravel = getTravel(hasBase ? 'base' : null, clients[0].id);
    baseDepartureTime = minutesToTime(startTimes[0] - firstTravel);
  }

  // Build updated clients
  const updatedClients: Client[] = clients.map((c, i) => ({
    ...c,
    startTime: minutesToTime(startTimes[i]),
    endTime: minutesToTime(endTimes[i]),
  }));

  return { clients: updatedClients, baseDepartureTime };
}

export function calculateDaySummary(team: TeamSchedule): DaySummary {
  let totalTravelMinutes = 0, totalDistanceKm = 0;
  team.travelSegments.forEach((s) => { if (!s.isCalculating) { totalTravelMinutes += s.durationMinutes; totalDistanceKm += s.distanceKm; } });
  const totalJobMinutes = team.clients.reduce((s, c) => s + c.jobDurationMinutes, 0);
  const totalBreakMinutes = team.breaks.reduce((s, b) => s + b.durationMinutes, 0);
  const effectiveJobMinutes = team.clients.reduce((s, c) => s + c.jobDurationMinutes / getTeamSize(team), 0);
  const totalWorkMinutes = effectiveJobMinutes + totalTravelMinutes + totalBreakMinutes;
  // Payable = jobs + travel (breaks excluded for payroll)
  const payableMinutes = effectiveJobMinutes + totalTravelMinutes;
  // Revenue = rate ($/hr) × booked job hours (not affected by staff count)
  const totalRevenue = team.clients.reduce((s, c) => s + (c.rate || 0) * (c.jobDurationMinutes / 60), 0);

  // Team-level staff wages: each staff member works the entire day's payable time.
  // Staff roster is fixed per-team per-day (team.staffIds). Per-job assignment
  // is no longer used for wage calculation.
  const staffLaborMinutes = new Map<string, number>();
  const staffIds = team.staffIds || [];
  if (staffIds.length > 0) {
    for (const id of staffIds) {
      staffLaborMinutes.set(id, payableMinutes);
    }
  }

  let wageAmount = 0;
  staffLaborMinutes.forEach(minutes => {
    wageAmount += (minutes / 60) * team.hourlyRate;
  });

  return {
    totalJobMinutes, totalTravelMinutes, totalDistanceKm, totalWorkMinutes,
    totalBreakMinutes, payableMinutes,
    wageAmount,
    staffLaborMinutes,
    fuelCost: (totalDistanceKm / 100) * team.fuelEfficiency * team.fuelPrice,
    perKmCost: totalDistanceKm * team.perKmRate,
    clientCount: team.clients.length,
    totalRevenue,
  };
}

export function getRouteWaypoints(team: TeamSchedule) {
  if (team.clients.length === 0) return null;
  const hasBase = team.baseAddress && team.baseAddress.lat !== 0;
  const returnAddr = team.returnAddress === 'none' ? null : (team.returnAddress || team.baseAddress);

  if (hasBase) {
    const destination = returnAddr
      ? { lat: returnAddr.lat, lng: returnAddr.lng }
      : { lat: team.baseAddress!.lat, lng: team.baseAddress!.lng };
    return {
      origin: { lat: team.baseAddress!.lat, lng: team.baseAddress!.lng },
      destination,
      waypoints: team.clients.map((c) => ({ location: { lat: c.location.lat, lng: c.location.lng }, stopover: true })),
    };
  }

  // No base: route from first client to last
  if (team.clients.length < 2) return null;
  const first = team.clients[0];
  const last = team.clients[team.clients.length - 1];
  return {
    origin: { lat: first.location.lat, lng: first.location.lng },
    destination: returnAddr
      ? { lat: returnAddr.lat, lng: returnAddr.lng }
      : { lat: last.location.lat, lng: last.location.lng },
    waypoints: team.clients.slice(1, -1).map((c) => ({ location: { lat: c.location.lat, lng: c.location.lng }, stopover: true })),
  };
}

export function exportScheduleCSV(team: TeamSchedule, summary: DaySummary, staffNames?: string[]): string {
  const hasBase = team.baseAddress && team.baseAddress.lat !== 0;
  const h = ['Stop','Client','Address','Start','End','Duration','Staff','Effective Duration','Travel To (min)','Distance To (km)'];
  const rows: string[][] = hasBase ? [['0','Base',team.baseAddress?.address||'',team.dayStartTime,'','','','','','']] : [];
  team.clients.forEach((c, i) => {
    const prevId = i === 0 ? (hasBase ? 'base' : null) : team.clients[i-1].id;
    const seg = prevId ? team.travelSegments.get(`${prevId}->${c.id}`) : null;
    const eff = c.jobDurationMinutes / getTeamSize(team);
    rows.push([String(i+1),c.name,c.location.address,c.startTime||'',c.endTime||'',`${c.jobDurationMinutes} min`,String(getTeamSize(team)),`${eff.toFixed(0)} min`,seg?String(seg.durationMinutes):'',seg?String(seg.distanceKm):'']);
  });
  if (team.clients.length > 0 && hasBase) {
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
