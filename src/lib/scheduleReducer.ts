import { AppState, ScheduleAction, TeamSchedule, TEAM_COLORS, TravelSegment } from './types';
import { generateId, getTodayISO } from './timeUtils';

function createDefaultTeam(index: number): TeamSchedule {
  return {
    id: generateId(),
    name: `Team ${index + 1}`,
    color: TEAM_COLORS[index % TEAM_COLORS.length],
    baseAddress: null,
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
  return { teams: [team1], activeTeamId: team1.id, selectedDate: today, viewMode: 'week', focusedDate: today };
}

export function scheduleReducer(state: AppState, action: ScheduleAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_TEAM':
      return { ...state, activeTeamId: action.teamId };
    case 'SET_BASE_ADDRESS':
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, baseAddress: action.location, travelSegments: new Map() } : t) };
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
      const nt = createDefaultTeam(state.teams.length);
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
      return { ...state, teams: state.teams.map((t) => t.id === action.teamId ? { ...t, clients: action.clients } : t) };
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
    default:
      return state;
  }
}

