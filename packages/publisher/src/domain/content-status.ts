export const CONTENT_STATUSES = [
  'draft',
  'brief_ready',
  'planned',
  'ready',
  'scheduled',
  'published',
  'failed',
  'rejected',
  'archived',
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === 'string' && (CONTENT_STATUSES as readonly string[]).includes(value);
}
