/**
 * Centralized role & permission system for CleanRoute Pro.
 *
 * Roles:
 *   owner      – Full access (financials, settings, user permissions, delete)
 *   admin      – Management access, no financials
 *   supervisor – Published schedules, checklists, client cards (view)
 *   staff      – Own schedule & jobs only
 *
 * Owner is immutable — assigned when the org is created, cannot be
 * transferred or assigned via the role-change dropdown.
 */

// ── Role types ──────────────────────────────────────────────────────────────

export type Role = 'owner' | 'admin' | 'supervisor' | 'staff';

/** Ordered from highest to lowest privilege. */
export const ROLE_HIERARCHY: Role[] = ['owner', 'admin', 'supervisor', 'staff'];

/** Roles that can be assigned via the role-change dropdown (owner excluded). */
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'supervisor', 'staff'];

// ── Display metadata ────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  supervisor: 'Supervisor',
  staff: 'Staff',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full access to everything',
  admin: 'Management access, no financials',
  supervisor: 'Field supervisor / team leader',
  staff: 'Own schedule only',
};

export const ROLE_COLORS: Record<Role, string> = {
  owner: 'text-indigo-600',
  admin: 'text-sky-600',
  supervisor: 'text-amber-600',
  staff: 'text-emerald-600',
};

/** Sort order for display (lower = higher rank). */
export const ROLE_SORT_ORDER: Record<Role, number> = {
  owner: 0,
  admin: 1,
  supervisor: 2,
  staff: 3,
};

/** Permission pills shown in the role selector dropdown. */
export const ROLE_PERMISSION_PILLS: Record<Role, string[]> = {
  owner: [
    'Schedule (edit & publish)',
    'Staff management',
    'Payroll & revenue',
    'Templates',
    'Settings',
    'All pages',
  ],
  admin: [
    'Schedule (edit & publish)',
    'Staff management',
    'Checklists (create & edit)',
    'Completed checklists',
    'Client cards (no rates)',
    'Templates',
    'Staff dashboard preview',
    'Settings (limited)',
  ],
  supervisor: [
    'Published schedules (view)',
    'Client cards (view)',
    'Complete checklists',
    'View completed checklists',
  ],
  staff: [
    'My Schedule',
    'Own daily jobs & tasks',
    'Complete checklists',
  ],
};

// ── Permission map ──────────────────────────────────────────────────────────

/**
 * Maps each permission to the roles that have it.
 * All permission checks go through the `can()` helper below.
 */
export const PERMISSIONS = {
  // Schedule
  'schedule.view':       ['owner', 'admin', 'supervisor', 'staff'],
  'schedule.edit':       ['owner', 'admin'],
  'schedule.publish':    ['owner', 'admin'],
  'schedule.delete':     ['owner'],

  // Clients
  'clients.view':        ['owner', 'admin', 'supervisor'],
  'clients.add':         ['owner', 'admin'],
  'clients.edit':        ['owner', 'admin'],
  'clients.archive':     ['owner', 'admin'],
  'clients.delete':      ['owner'],

  // Staff
  'staff.view':          ['owner', 'admin'],
  'staff.add':           ['owner', 'admin'],
  'staff.edit':          ['owner', 'admin'],
  'staff.archive':       ['owner', 'admin'],
  'staff.delete':        ['owner'],
  'staff.invite':        ['owner', 'admin'],
  'staff.remove':        ['owner'],

  // Templates
  'templates.view':      ['owner', 'admin'],
  'templates.add':       ['owner', 'admin'],
  'templates.edit':      ['owner', 'admin'],
  'templates.delete':    ['owner'],

  // Checklists
  'checklists.view':     ['owner', 'admin', 'supervisor', 'staff'],
  'checklists.add':      ['owner', 'admin'],
  'checklists.edit':     ['owner', 'admin'],
  'checklists.delete':   ['owner'],
  'checklists.publish':  ['owner', 'admin'],
  'checklists.complete': ['owner', 'admin', 'supervisor', 'staff'],
  'checklists.view_completed': ['owner', 'admin', 'supervisor'],

  // Financials (owner only)
  'financials.view':     ['owner'],
  'payroll.view':        ['owner'],
  'revenue.view':        ['owner'],
  'client_rates.view':   ['owner'],
  'csv_export':          ['owner'],

  // Settings
  'settings.full':       ['owner'],
  'settings.limited':    ['owner', 'admin'],

  // Admin features
  'staff_dashboard_preview': ['owner', 'admin'],
  'user_permissions':    ['owner'],
  'org.delete':          ['owner'],
} as const;

export type Permission = keyof typeof PERMISSIONS;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a role (or the highest role) has a specific permission. */
export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

/** Returns true if the role string is a valid Role. */
export function isValidRole(role: string): role is Role {
  return ROLE_HIERARCHY.includes(role as Role);
}

/** Returns true if the role can be assigned via the dropdown (not owner). */
export function isAssignableRole(role: string): role is Role {
  return ASSIGNABLE_ROLES.includes(role as Role);
}
