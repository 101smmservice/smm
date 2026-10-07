export const INTAKE_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'completed',
] as const;

export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

export function isIntakeStatus(value: unknown): value is IntakeStatus {
  return typeof value === 'string' && (INTAKE_STATUSES as readonly string[]).includes(value);
}
