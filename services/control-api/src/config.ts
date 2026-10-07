import { fileURLToPath } from 'node:url';

import { ValidationError, type ActivityPolicy } from '@persona/core';
import { loadPoliciesFromFile } from '@persona/persona-engine';

/** `config/policies.yaml` at the root of the repository (this file lives in `services/control-api/{src,dist}`). */
export const DEFAULT_POLICIES_PATH = fileURLToPath(
  new URL('../../../config/policies.yaml', import.meta.url),
);

export interface PolicySourceOptions {
  policies?: Record<string, ActivityPolicy>;
  configPath?: string;
}

/**
 * Picks the activity policies the service runs with: the ones passed in, otherwise the YAML file at
 * `configPath` (by default `config/policies.yaml` of the repository). A missing file yields an
 * empty set, so the service still starts; a file that exists but is invalid is an error.
 */
export async function loadPolicies(
  options: PolicySourceOptions = {},
): Promise<Record<string, ActivityPolicy>> {
  if (options.policies !== undefined) {
    return options.policies;
  }

  try {
    return await loadPoliciesFromFile(options.configPath ?? DEFAULT_POLICIES_PATH);
  } catch (error) {
    if (isFileNotFound(error)) {
      return {};
    }
    throw error;
  }
}

export interface ServerConfig {
  host: string;
  port: number;
}

/** Reads `HOST` (default `127.0.0.1`) and `PORT` (default `3000`). */
export function resolveServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const host = env.HOST === undefined || env.HOST === '' ? '127.0.0.1' : env.HOST;

  const rawPort = env.PORT;
  const port = rawPort === undefined || rawPort === '' ? 3000 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ValidationError(
      `PORT must be an integer between 0 and 65535: ${String(rawPort)}`,
      'PORT',
    );
  }

  return { host, port };
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
