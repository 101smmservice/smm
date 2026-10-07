import type { Platform } from './platform.js';

export interface DeviceProfile {
  id: string;
  label: string;
  platform: Platform;
  properties: Record<string, unknown>;
  source: 'corpus' | 'manual' | 'generated';
}
