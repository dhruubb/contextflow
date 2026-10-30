export type Role = 'admin' | 'team_lead' | 'member' | 'viewer';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  team_lead: 'Team Lead',
  member: 'Member',
  viewer: 'Viewer',
};

/**
 * Coarse permissions. Enforced in every API route (server-side) AND mirrored by RLS in the database.
 * Finer rules (e.g. a member may only update tasks assigned to them) live in the route handlers.
 */
const MATRIX = {
  'meeting.create': ['admin', 'team_lead'],
  'meeting.edit': ['admin', 'team_lead'],
  'meeting.notes': ['admin', 'team_lead', 'member'],
  'meeting.ai_extract': ['admin', 'team_lead', 'member'],
  'meeting.ai_apply': ['admin', 'team_lead'],
  'meeting.carry_forward': ['admin', 'team_lead'],
  'task.create': ['admin', 'team_lead', 'member'],
  'task.manage_any': ['admin', 'team_lead'],
  'task.update_own': ['admin', 'team_lead', 'member'],
  'handover.any': ['admin', 'team_lead'],
  'handover.own': ['admin', 'team_lead', 'member'],
  'brief.generate': ['admin', 'team_lead', 'member'],
  'document.upload': ['admin', 'team_lead', 'member'],
  'document.link': ['admin', 'team_lead', 'member'],
  'continuity.analyze': ['admin', 'team_lead', 'member'],
  'knowledge.ask': ['admin', 'team_lead', 'member', 'viewer'],
  'members.manage': ['admin'],
  'notifications.self': ['admin', 'team_lead', 'member', 'viewer'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (MATRIX[permission] as readonly Role[]).includes(role);
}
