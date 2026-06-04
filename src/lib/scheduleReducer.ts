import { AppState, ScheduleAction, TeamSchedule, TEAM_COLORS, TravelSegment, getNextColorIndex } from './types';
import { generateId, getTodayISO } from './timeUtils';

function createDefaultTeam(colorIndex: number): TeamSchedule {
  return {
    id: generateId(),
    name: `Team ${colorIndex + 1}`,
    color: TEAM_COLORS[colorIndex % TEAM_COLORS.length],
    colorIndex,
    baseAddress: null,
    returnAddress: null,
    clients: [],
    travelSegments: new Map<string, TravelSegment>(),
    dayStartTime: '08:00',
    breaks: [],
    hourlyRate: 38,
    fuelEfficiency: 10,
    fuelPrice: 1.85,
    perKmRate: 0,
  };
}

export function createInitialState(): AppState {
  const team1 = createDefaultTeam(0);
  const today = getTodayISO();

  // Restore the last session's view context so navigating away and back
  // returns the user to exactly where they left off.
  let viewMode: 'day' | 'week' = 'week';
  let focusedDate = today;
  let activeTeamId = team1.id;
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('crp_schedule_view');
      if (saved) {
        const parsed = JSON.parse(saved) as { viewMode?: string; focusedDate?: string; activeTeamId?: string };
        if (parsed.viewMode === 'day' || parsed.viewMode === 'week') viewMode = parsed.viewMode;
        if (parsed.focusedDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.focusedDate)) focusedDate = parsed.focusedDate;
        if (parsed.activeTeamId) activeTeamId = parsed.activeTeamId;
      }
    } catch { /* ignore */ }
  }

  return { teams: [team1], activeTeamId, selectedDate: focusedDate, viewMode, focusedDate };
}

export function scheduleReducer(state: AppState, action: ScheduleAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_TEAM':
      return { ...state, activeTeamId: action.teamId };
    case 'SET_BASE_ADDRESS': {
      return { ...state, teams: state.teams.map((t) => {
        if (t.id !== action.teamId) return t;
        const same = t.baseAddress && t.baseAddress.lat === action.location.lat && t.baseAddress.lng === action.location.lng;
        return { ...t, baseAddress: action.location, travelSegments: same ? t.travelSegments : new Map() };
      }) };
    }
    case 'ADD_CLIENT':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, clients: [...t.clients, action.client] } : t) };
    case 'REMOVE_CLIENT':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, clients: t.clients.filter((c) => c.id !== action.clientId), breaks: t.breaks.filter((b) => b.afterClientId !== action.clientId) } : t) };
    case 'UPDATE_CLIENT':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, clients: t.clients.map((c) => c.id === action.clientId ? { ...c, ...action.updates } : c) } : t) };
    case 'REORDER_CLIENTS':
      return { ...state, teams: state.teams.map((t) => { if (t.id !== action.teamId) return t; const nc = [...t.clients]; const [m] = nc.splice(action.fromIndex, 1); nc.splice(action.toIndex, 0, m); return { ...t, clients: nc }; }) };
    case 'SET_START_TIME':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, dayStartTime: action.time } : t) };
    case 'SET_HOURLY_RATE':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, hourlyRate: action.rate } : t) };
    case 'ADD_TEAM': {
      const usedIndices = state.teams.map(t => t.colorIndex);
      const nextIdx = getNextColorIndex(usedIndices);
      const nt = createDefaultTeam(nextIdx);
      if (state.teams.length > 0 && state.teams[0].baseAddress) nt.baseAddress = { ...state.teams[0].baseAddress };
      return { ...state, teams: [...state.teams, nt], activeTeamId: nt.id };
    }
    case 'REMOVE_TEAM': {
      if (state.teams.length <= 1) return state;
      const f = state.teams.filter((t) => t.id !== action.teamId);
      return { ...state, teams: f, activeTeamId: state.activeTeamId === action.teamId ? f[0].id : state.activeTeamId };
    }
    case 'UPDATE_TRAVEL':
      return { ...state, teams: state.teams.map((t) => { if (t.id !== action.teamId) return t; const ns = new Map(t.travelSegments); ns.set(`${action.segment.fromId}->${action.segment.toId}`, action.segment); return { ...t, travelSegments: ns }; }) };
    case 'CLEAR_TRAVEL':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, travelSegments: new Map() } : t) };
    case 'SET_CLIENT_TIMES':
      return {
        ...state,
        teams: state.teams.map((t) => {
          if (t.id !== action.teamId) return t;
          // Merge computed times into current state to avoid erasing keystrokes
          const updatedClients = t.clients.map(c => {
            const computedClient = action.clients.find(ac => ac.id === c.id);
            if (!computedClient) return c;
            return { ...c, startTime: computedClient.startTime, endTime: computedClient.endTime };
          });
          return { ...t, clients: updatedClients };
        })
      };
    case 'ADD_BREAK':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, breaks: [...t.breaks, action.breakItem] } : t) };
    case 'REMOVE_BREAK':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, breaks: t.breaks.filter((b) => b.id !== action.breakId) } : t) };
    case 'UPDATE_BREAK':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, breaks: t.breaks.map((b) => b.id === action.breakId ? { ...b, ...action.updates } : b) } : t) };
    case 'SET_FUEL_SETTINGS':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, fuelEfficiency: action.fuelEfficiency, fuelPrice: action.fuelPrice } : t) };
    case 'SET_PER_KM_RATE':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, perKmRate: action.rate } : t) };
    case 'SET_CLIENTS_ORDER':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, clients: action.clients } : t) };
    case 'SET_FIXED_START_TIME':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, clients: t.clients.map((c) => c.id === action.clientId ? { ...c, fixedStartTime: action.time } : c) } : t) };
    case 'LOAD_STATE':
      return { ...state, teams: action.teams, activeTeamId: action.activeTeamId, selectedDate: action.selectedDate };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.viewMode };
    case 'SET_FOCUSED_DATE':
      return { ...state, focusedDate: action.date, selectedDate: action.date };
    case 'ASSIGN_STAFF_TO_JOB':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, clients: t.clients.map((c) => c.id === action.clientId ? { ...c, assignedStaffIds: action.staffIds, staffCount: Math.max(1, action.staffIds.length) } : c) } : t) };
    case 'SET_RETURN_ADDRESS': {
      return { ...state, teams: state.teams.map((t) => {
        if (t.id !== action.teamId) return t;
        const prev = t.returnAddress;
        const same = prev && prev !== 'none' &&
          (prev as { lat: number; lng: number }).lat === action.location.lat &&
          (prev as { lat: number; lng: number }).lng === action.location.lng;
        return { ...t, returnAddress: action.location, travelSegments: same ? t.travelSegments : new Map() };
      }) };
    }
    case 'CLEAR_RETURN_ADDRESS':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, returnAddress: 'none', travelSegments: new Map() } : t) };
    case 'CLEAR_BASE_ADDRESS':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, baseAddress: null, returnAddress: 'none', travelSegments: new Map() } : t) };
    case 'SET_DRIVER':
      return { ...state, teams: state.teams.map((t) => {
        if (t.id !== action.teamId) return t;
        const oldDriverId = t.driverStaffId;
        const updated = { ...t, driverStaffId: action.staffId };
        // Remove old driver from all jobs
        if (oldDriverId) {
          updated.clients = (updated.clients || t.clients).map(c => {
            const ids = c.assignedStaffIds || [];
            if (!ids.includes(oldDriverId)) return c;
            return { ...c, assignedStaffIds: ids.filter(id => id !== oldDriverId) };
          });
        }
        // Add new driver to all jobs
        if (action.staffId) {
          const sid = action.staffId;
          updated.clients = (updated.clients || t.clients).map(c => {
            const ids = c.assignedStaffIds || [];
            if (ids.includes(sid)) return c;
            return { ...c, assignedStaffIds: [...ids, sid] };
          });
        }
        return updated;
      }) };
    default:
      return state;
  }
}
