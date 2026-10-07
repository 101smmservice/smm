import { readFile } from 'node:fs/promises';

import { ValidationError, type ActionPolicy, type ActivityPolicy } from '@persona/core';
import { parse } from 'yaml';

/** Parses and validates a YAML document of the form `{ <policyKey>: ActivityPolicy }`. */
export function parsePoliciesYaml(content: string): Record<string, ActivityPolicy> {
  let document: unknown;
  try {
    document = parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`policies YAML cannot be parsed: ${reason}`);
  }

  if (!isRecord(document)) {
    throw new ValidationError('policies YAML must be a mapping of policy key to policy');
  }

  return Object.fromEntries(
    Object.entries(document).map(([key, value]) => [key, parsePolicy(value, key)]),
  );
}

export async function loadPoliciesFromFile(path: string): Promise<Record<string, ActivityPolicy>> {
  return parsePoliciesYaml(await readFile(path, 'utf8'));
}

function parsePolicy(value: unknown, path: string): ActivityPolicy {
  if (!isRecord(value)) {
    return fail(path, 'a mapping');
  }

  const { stage, actions } = value;
  if (typeof stage !== 'string') {
    return fail(`${path}.stage`, 'a string');
  }
  if (!isRecord(actions)) {
    return fail(`${path}.actions`, 'a mapping');
  }

  const [minSessions, maxSessions] = readRange(
    value.sessionsPerDay,
    `${path}.sessionsPerDay`,
    true,
  );
  const [minInterval, maxInterval] = readRange(
    value.minIntervalMinutes,
    `${path}.minIntervalMinutes`,
    false,
  );

  return {
    stage,
    maxSessionMinutes: readNonNegativeInteger(value.maxSessionMinutes, `${path}.maxSessionMinutes`),
    sessionsPerDay: [minSessions, maxSessions],
    actions: {
      view: parseActionPolicy(actions.view, `${path}.actions.view`),
      like: parseActionPolicy(actions.like, `${path}.actions.like`),
      follow: parseActionPolicy(actions.follow, `${path}.actions.follow`),
      post: parseActionPolicy(actions.post, `${path}.actions.post`),
      comment: parseActionPolicy(actions.comment, `${path}.actions.comment`),
    },
    minIntervalMinutes: [minInterval, maxInterval],
    skipDayProbability: readProbability(value.skipDayProbability, `${path}.skipDayProbability`),
  };
}

function parseActionPolicy(value: unknown, path: string): ActionPolicy {
  if (!isRecord(value)) {
    return fail(path, 'a mapping');
  }
  return {
    maxPerDay: readNonNegativeInteger(value.maxPerDay, `${path}.maxPerDay`),
    probabilityPerEncounter: readProbability(
      value.probabilityPerEncounter,
      `${path}.probabilityPerEncounter`,
    ),
  };
}

function readRange(value: unknown, path: string, integers: boolean): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    return fail(path, 'an array of two numbers [min, max]');
  }
  const items: unknown[] = value;
  const [min, max] = items;
  const read = integers ? readNonNegativeInteger : readNonNegativeNumber;
  const low = read(min, `${path}[0]`);
  const high = read(max, `${path}[1]`);
  if (low > high) {
    return fail(path, 'ordered so that min <= max');
  }
  return [low, high];
}

function readNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail(path, 'an integer >= 0');
  }
  return value;
}

function readNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(path, 'a number >= 0');
  }
  return value;
}

function readProbability(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return fail(path, 'a number between 0 and 1');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, expectation: string): never {
  throw new ValidationError(`invalid policy: ${path} must be ${expectation}`, path);
}
