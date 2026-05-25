// ─── Field types ─────────────────────────────────────────────────────────────
export type FieldType =
  | 'heading'     // visual section title / divider
  | 'paragraph'   // plain body text for staff to read
  | 'logic'       // conditional logic rule block
  | 'checkbox'    // simple tick item
  | 'text'        // open text input
  | 'yesno'       // Yes / No toggle
  | 'dropdown'    // single-select from admin-defined options
  | 'multiselect' // multi-select from admin-defined options
  | 'date'        // date picker
  | 'time'        // time picker
  | 'photo'       // image upload
  | 'video';      // video upload

// Condition for a logic block
export interface LogicCondition {
  fieldId: string;
  operator: 'equals' | 'not_equals' | 'is_answered' | 'is_empty' | 'contains';
  value?: string;
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  logic: 'Logic',
  heading: 'Heading',
  paragraph: 'Text',
  checkbox: 'Checkbox',
  text: 'Open Text',
  yesno: 'Yes / No',
  dropdown: 'Dropdown',
  multiselect: 'Checkbox',
  date: 'Date',
  time: 'Time',
  photo: 'Photo',
  video: 'Video',
};

export const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  logic: '⚡',
  heading: '𝖴',
  paragraph: '📝',
  checkbox: '☑',
  text: '📝',
  yesno: '👍',
  dropdown: '🔽',
  multiselect: '☰',
  date: '📅',
  time: '🕐',
  photo: '📷',
  video: '🎥',
};

// ─── Template structure (stored in client_checklists.sections) ────────────────
export interface ChecklistField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required?: boolean;
  allowNA?: boolean;
  options?: string[];         // for dropdown / multiselect
  conditionalOn?: string;     // LEGACY: field.id of a yesno field
  conditionalValue?: 'yes' | 'no'; // LEGACY: show this field when parent equals this

  // ── Logic block fields (type === 'logic') ─────────────────────────────────
  logicConditions?: LogicCondition[];
  logicOperator?: 'and' | 'or';   // how to combine multiple conditions
  logicAction?: 'show' | 'hide';  // what to do when conditions are met
  logicTargets?: string[];         // field IDs affected by this logic
}

export interface ChecklistSection {
  id: string;
  title: string;
  description?: string;
  fields: ChecklistField[];
}

// ─── Completion responses (stored in checklist_completions.items) ─────────────
export interface FieldResponse {
  field_id: string;
  value: string | string[] | boolean | null;
  na: boolean;
  media_urls?: string[]; // public URLs for photo/video fields
}

// ─── Pre-fill metadata (stored in checklist_completions.pre_fill) ─────────────
export interface PreFillMeta {
  date: string;
  time: string;
  staff_name: string;
  client_name: string;
  client_address: string;
}

// ─── Backward-compat: convert old ChecklistItem shape → ChecklistField ────────
export function migrateOldItem(item: Record<string, unknown>): ChecklistField {
  if (item.type) return item as unknown as ChecklistField;
  return {
    id: item.id as string,
    type: 'checkbox',
    label: (item.text as string) || '',
    required: (item.required as boolean) || false,
  };
}

export function migrateOldSection(sec: Record<string, unknown>): ChecklistSection {
  const rawItems = (sec.items || sec.fields || []) as Record<string, unknown>[];
  return {
    id: sec.id as string,
    title: sec.title as string,
    description: sec.description as string | undefined,
    fields: rawItems.map(migrateOldItem),
  };
}
