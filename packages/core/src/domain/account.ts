import type { Platform } from './platform.js';

export const ACCOUNT_STATUSES = [
  'connected',
  'onboarding',
  'warming',
  'active',
  'limited',
  'review',
  'dead',
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

export interface Account {
  id: string;
  platform: Platform;
  status: AccountStatus;
  personaId: string | null;
  deviceProfileId: string | null;
  proxyBindingId: string | null;
  /** ISO 8601 */
  createdAt: string;
  connectedAt: string | null;
  statusChangedAt: string;
  metadata: Record<string, unknown>;
}
