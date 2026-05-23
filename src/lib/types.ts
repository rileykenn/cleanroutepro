export interface StaffMember {
  id: string;
  name: string;
  role: string;
  hourly_rate: number;
  available_days: number[] | null;
}

export interface Location {
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

export interface Client {
  id: string;
  name: string;
  location: Location;
  jobDurationMinutes: number;
  staffCount: number;
  isLocked: boolean;
  startTime?: string;
  endTime?: string;
  fixedStartTime?: string;
  notes?: string;
  savedClientId?: string;
  email?: string;
  phone?: string;
  assignedStaffIds?: string[];
  clientColor?: string;
  /** ID of the client_checklists row linked to this scheduled job */
  checklistId?: string | null;
  /** One-time override sections for "save for this job only" */
  checklistOverride?: ChecklistSection[] | null;
}

// ─── Checklist types ───
export interface ChecklistItem {
  id: string;
  text: string;
  required?: boolean;
}

export interface ChecklistSection {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface ClientChecklist {
  id: string;
  org_id: string;
  client_id: string;
  name: string;
  is_default: boolean;
  sections: ChecklistSection[];
  created_at: string;
  updated_at: string;
}

export interface ChecklistItemCompletion {
  item_id: string;
  checked: boolean;
  checked_by_name?: string;
  checked_at?: string;
}

export interface ChecklistCompletion {
  id: string;
  org_id: string;
  client_id: string;
  schedule_job_id: string | null;
  checklist_id: string | null;
  items: ChecklistItemCompletion[];
  notes: string | null;
  completed_by: string | null;
  completed_at: string;
}

export interface TravelSegment {
  fromId: string;
  toId: string;
  durationMinutes: number;
  distanceKm: number;
  durationText: string;
  distanceText: string;
  isCalculating: boolean;
}

export interface ScheduleBreak {
  id: string;
  afterClientId: string;
  durationMinutes: number;
  label: string;
}

export interface TeamSchedule {
  id: string;
  name: string;
  color: TeamColor;
  colorIndex: number;
  baseAddress: Location | null;
  returnAddress: Location | null | 'none';
  clients: Client[];
  travelSegments: Map<string, TravelSegment>;
  dayStartTime: string;
  breaks: ScheduleBreak[];
  hourlyRate: number;
  fuelEfficiency: number;
  fuelPrice: number;
  perKmRate: number;
  /** Staff member assigned as driver for this day */
  driverStaffId?: string | null;
}

export interface TeamColor {
  name: string;
  primary: string;
  light: string;
  border: string;
  text: string;
  marker: string;
}

export interface DaySummary {
  totalJobMinutes: number;
  totalTravelMinutes: number;
  totalDistanceKm: number;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  payableMinutes: number;
  wageAmount: number;
  fuelCost: number;
  perKmCost: number;
  clientCount: number;
}

export interface DaySchedule {
  date: string;
  dayOfWeek: string;
  scheduleId: string | null;
  clients: Client[];
  /** Per-day breaks, parallel to clients, stored here so loadDayFromCache can restore them */
  breaks: ScheduleBreak[];
  templateCode?: string;
  isPublished: boolean;
  /** Per-day base address override */
  baseAddress?: Location | null;
  returnAddress?: Location | null | 'none';
  hasStartBase?: boolean;
  hasReturnBase?: boolean;
  /** Driver assigned for this day */
  driverStaffId?: string | null;
}

export const TEAM_COLORS: TeamColor[] = [
  {
    name: 'Indigo',
    primary: '#4F46E5',
    light: '#EEF2FF',
    border: '#C7D2FE',
    text: '#3730A3',
    marker: '#4F46E5',
  },
  {
    name: 'Emerald',
    primary: '#059669',
    light: '#ECFDF5',
    border: '#A7F3D0',
    text: '#065F46',
    marker: '#059669',
  },
  {
    name: 'Amber',
    primary: '#D97706',
    light: '#FFFBEB',
    border: '#FDE68A',
    text: '#92400E',
    marker: '#D97706',
  },
  {
    name: 'Rose',
    primary: '#E11D48',
    light: '#FFF1F2',
    border: '#FECDD3',
    text: '#9F1239',
    marker: '#E11D48',
  },
  {
    name: 'Cyan',
    primary: '#0891B2',
    light: '#ECFEFF',
    border: '#A5F3FC',
    text: '#155E75',
    marker: '#0891B2',
  },
  {
    name: 'Purple',
    primary: '#7C3AED',
    light: '#F5F3FF',
    border: '#DDD6FE',
    text: '#5B21B6',
    marker: '#7C3AED',
  },
  {
    name: 'Teal',
    primary: '#0D9488',
    light: '#F0FDFA',
    border: '#99F6E4',
    text: '#115E59',
    marker: '#0D9488',
  },
  {
    name: 'Orange',
    primary: '#EA580C',
    light: '#FFF7ED',
    border: '#FED7AA',
    text: '#9A3412',
    marker: '#EA580C',
  },
];

/**
 * Find the first color index not already used by the given teams.
 * Falls back to (teams.length % total) if all colors are exhausted.
 */
export function getNextColorIndex(usedColorIndices: number[]): number {
  const used = new Set(usedColorIndices);
  for (let i = 0; i < TEAM_COLORS.length; i++) {
    if (!used.has(i)) return i;
  }
  // All 8 colors used — wrap around to next available
  return usedColorIndices.length % TEAM_COLORS.length;
}

/** Manual client color tags */
export const CLIENT_COLORS = [
  // Original colours
  { name: 'Red', value: '#EF4444' },
  { name: 'Orange', value: '#F97316' },
  { name: 'Yellow', value: '#EAB308' },
  { name: 'Green', value: '#22C55E' },
  { name: 'Blue', value: '#3B82F6' },
  { name: 'Purple', value: '#8B5CF6' },
  { name: 'Pink', value: '#EC4899' },
  { name: 'Teal', value: '#14B8A6' },
  // New colours
  { name: 'Grey', value: '#6B7280' },
  { name: 'Black', value: '#1F2937' },
  { name: 'Navy', value: '#1E40AF' },
  { name: 'Brown', value: '#92400E' },
  { name: 'Tan', value: '#B45309' },
  { name: 'Rose', value: '#F472B6' },
  { name: 'Violet', value: '#7C3AED' },
  // Extra colours
  { name: 'Coral', value: '#F97066' },
  { name: 'Lime', value: '#84CC16' },
  { name: 'Cyan', value: '#06B6D4' },
  { name: 'Indigo', value: '#6366F1' },
  { name: 'Slate', value: '#475569' },
];

export type ScheduleAction =
  | { type: 'SET_ACTIVE_TEAM'; teamId: string }
  | { type: 'SET_BASE_ADDRESS'; teamId: string; location: Location }
  | { type: 'ADD_CLIENT'; teamId: string; client: Client }
  | { type: 'REMOVE_CLIENT'; teamId: string; clientId: string }
  | { type: 'UPDATE_CLIENT'; teamId: string; clientId: string; updates: Partial<Client> }
  | { type: 'REORDER_CLIENTS'; teamId: string; fromIndex: number; toIndex: number }
  | { type: 'SET_START_TIME'; teamId: string; time: string }
  | { type: 'SET_HOURLY_RATE'; teamId: string; rate: number }
  | { type: 'SET_FUEL_SETTINGS'; teamId: string; fuelEfficiency: number; fuelPrice: number }
  | { type: 'SET_PER_KM_RATE'; teamId: string; rate: number }
  | { type: 'ADD_TEAM' }
  | { type: 'REMOVE_TEAM'; teamId: string }
  | { type: 'UPDATE_TRAVEL'; teamId: string; segment: TravelSegment }
  | { type: 'ADD_BREAK'; teamId: string; afterClientId: string; breakItem: ScheduleBreak }
  | { type: 'REMOVE_BREAK'; teamId: string; breakId: string }
  | { type: 'UPDATE_BREAK'; teamId: string; breakId: string; updates: Partial<ScheduleBreak> }
  | { type: 'CLEAR_TRAVEL'; teamId: string }
  | { type: 'SET_CLIENT_TIMES'; teamId: string; clients: Client[] }
  | { type: 'SET_CLIENTS_ORDER'; teamId: string; clients: Client[] }
  | { type: 'SET_FIXED_START_TIME'; teamId: string; clientId: string; time: string | undefined }
  | { type: 'LOAD_STATE'; teams: TeamSchedule[]; activeTeamId: string; selectedDate: string }
  | { type: 'SET_VIEW_MODE'; viewMode: 'week' | 'day' }
  | { type: 'SET_FOCUSED_DATE'; date: string }
  | { type: 'ASSIGN_STAFF_TO_JOB'; teamId: string; clientId: string; staffIds: string[] }
  | { type: 'SET_RETURN_ADDRESS'; teamId: string; location: Location }
  | { type: 'CLEAR_RETURN_ADDRESS'; teamId: string }
  | { type: 'CLEAR_BASE_ADDRESS'; teamId: string }
  | { type: 'SET_DRIVER'; teamId: string; staffId: string | null };


export interface AppState {
  teams: TeamSchedule[];
  activeTeamId: string;
  selectedDate: string;
  viewMode: 'week' | 'day';
  focusedDate: string;
}

// ─── Checklist / Form Builder Types ───────────────────────────────────────────

export type FormFieldType =
  | 'section_heading'
  | 'text'
  | 'yes_no'
  | 'dropdown'
  | 'multi_select'
  | 'date'
  | 'time'
  | 'image'
  | 'video';

export interface FormFieldConditional {
  /** ID of the yes_no parent field */
  parentId: string;
  /** Only show this field when parent answer equals this value */
  showWhen: 'yes' | 'no';
}

export interface FormField {
  id: string;
  type: FormFieldType;
  /** Label / question text */
  label: string;
  /** Optional description / sub-instruction shown below label */
  description?: string;
  /** Whether staff must answer before submitting */
  required?: boolean;
  /** Options for dropdown / multi_select */
  options?: string[];
  /** Conditional visibility rule */
  conditional?: FormFieldConditional;
}

/** Legacy simple checklist item — auto-upgraded to yes_no on read */
export interface LegacyChecklistItem {
  id: string;
  text: string;
}

/** Union stored in checklist_templates.items */
export type AnyFormField = FormField | LegacyChecklistItem;

/** Normalise a raw item from DB into a FormField */
export function normaliseField(raw: AnyFormField): FormField {
  if ('type' in raw) return raw as FormField;
  // Legacy text item → treat as yes_no checkbox
  return {
    id: (raw as LegacyChecklistItem).id,
    type: 'yes_no',
    label: (raw as LegacyChecklistItem).text,
    required: false,
  };
}

/** Answer values stored in checklist_completions.items */
export interface FieldAnswer {
  fieldId: string;
  value: string | string[] | boolean | null;
  /** true if staff marked this N/A */
  na?: boolean;
}

/** Per-field media URLs stored in checklist_completions.media_urls */
export type MediaUrls = Record<string, string[]>;

export interface RichChecklistTemplate {
  id: string;
  org_id: string;
  name: string;
  items: FormField[];
  created_at?: string;
  updated_at?: string;
}

export interface RichChecklistCompletion {
  id: string;
  org_id: string;
  client_id: string;
  schedule_job_id?: string;
  checklist_template_id: string;
  items: FieldAnswer[];
  media_urls: MediaUrls;
  notes: string;
  completed_by: string;
  completed_at: string;
  created_at?: string;
  // Enriched
  clientName?: string;
  templateName?: string;
  completedByName?: string;
}
