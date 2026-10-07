import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACTION_TYPES, ValidationError, type ActivityPolicy } from '@persona/core';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
  getPolicyKey,
  loadPoliciesFromFile,
  parsePoliciesYaml,
  type PolicyProvider,
} from '../src/index.js';

const POLICIES_PATH = fileURLToPath(new URL('../../../config/policies.yaml', import.meta.url));

function makePolicy(): ActivityPolicy {
  return {
    stage: 'active',
    maxSessionMinutes: 30,
    sessionsPerDay: [2, 4],
    actions: {
      view: { maxPerDay: 100, probabilityPerEncounter: 1 },
      like: { maxPerDay: 25, probabilityPerEncounter: 0.15 },
      follow: { maxPerDay: 8, probabilityPerEncounter: 0.06 },
      post: { maxPerDay: 2, probabilityPerEncounter: 0.5 },
      comment: { maxPerDay: 5, probabilityPerEncounter: 0.1 },
    },
    minIntervalMinutes: [2, 10],
    skipDayProbability: 0.05,
  };
}

/** Serialises `{ active: <policy after mutate> }` and parses it with the loader. */
function parseWith(mutate: (policy: Record<string, unknown>) => void): unknown {
  const policy = structuredClone(makePolicy()) as unknown as Record<string, unknown>;
  mutate(policy);
  return parsePoliciesYaml(stringify({ active: policy }));
}

function actionOf(policy: Record<string, unknown>, action: string): Record<string, unknown> {
  return (policy.actions as Record<string, Record<string, unknown>>)[action] ?? {};
}

describe('parsePoliciesYaml', () => {
  it('turns a valid document into a record of ActivityPolicy', () => {
    const yaml = stringify({ active: makePolicy(), onboarding: { ...makePolicy(), stage: 'x' } });

    const policies = parsePoliciesYaml(yaml);

    expect(Object.keys(policies)).toEqual(['active', 'onboarding']);
    expect(policies.active).toEqual(makePolicy());
    expect(policies.onboarding?.stage).toBe('x');
  });

  it('accepts the boundary values', () => {
    const policies = parseWith((policy) => {
      policy.maxSessionMinutes = 0;
      policy.sessionsPerDay = [0, 0];
      policy.minIntervalMinutes = [0, 0];
      policy.skipDayProbability = 1;
      actionOf(policy, 'like').probabilityPerEncounter = 0;
      actionOf(policy, 'view').probabilityPerEncounter = 1;
    }) as Record<string, ActivityPolicy>;

    expect(policies.active?.skipDayProbability).toBe(1);
  });

  it('accepts fractional minIntervalMinutes', () => {
    const policies = parseWith((policy) => {
      policy.minIntervalMinutes = [0.5, 1.5];
    }) as Record<string, ActivityPolicy>;

    expect(policies.active?.minIntervalMinutes).toEqual([0.5, 1.5]);
  });

  it('ignores unknown actions and fields', () => {
    const policies = parseWith((policy) => {
      (policy.actions as Record<string, unknown>).share = { maxPerDay: 1 };
      policy.note = 'ignored';
    }) as Record<string, ActivityPolicy>;

    expect(policies.active).toEqual(makePolicy());
  });

  it.each(ACTION_TYPES)('rejects a policy without the %s action', (action) => {
    expect(() =>
      parseWith((policy) => {
        policy.actions = Object.fromEntries(
          Object.entries(policy.actions as Record<string, unknown>).filter(
            ([name]) => name !== action,
          ),
        );
      }),
    ).toThrow(ValidationError);
  });

  it('names the offending path in the error', () => {
    expect(() =>
      parseWith((policy) => {
        actionOf(policy, 'like').maxPerDay = -1;
      }),
    ).toThrow('active.actions.like.maxPerDay');
  });

  it.each([-1, 1.5, '5', null])('rejects maxPerDay %j', (value) => {
    expect(() =>
      parseWith((policy) => {
        actionOf(policy, 'follow').maxPerDay = value;
      }),
    ).toThrow(ValidationError);
  });

  it.each([1.01, -0.01, '0.5'])('rejects probabilityPerEncounter %j', (value) => {
    expect(() =>
      parseWith((policy) => {
        actionOf(policy, 'view').probabilityPerEncounter = value;
      }),
    ).toThrow(ValidationError);
  });

  it.each([-0.01, 1.01, 5, 'often'])('rejects skipDayProbability %j', (value) => {
    expect(() =>
      parseWith((policy) => {
        policy.skipDayProbability = value;
      }),
    ).toThrow(ValidationError);
  });

  it.each<[string, unknown]>([
    ['min greater than max', [5, 2]],
    ['a single element', [1]],
    ['three elements', [1, 2, 3]],
    ['fractional counts', [1.5, 2]],
    ['negative counts', [-1, 2]],
    ['a scalar', 3],
  ])('rejects sessionsPerDay with %s', (_label, value) => {
    expect(() =>
      parseWith((policy) => {
        policy.sessionsPerDay = value;
      }),
    ).toThrow(ValidationError);
  });

  it.each<[string, unknown]>([
    ['min greater than max', [10, 2]],
    ['a single element', [3]],
    ['negative values', [-1, 2]],
    ['non-numbers', ['1', '2']],
  ])('rejects minIntervalMinutes with %s', (_label, value) => {
    expect(() =>
      parseWith((policy) => {
        policy.minIntervalMinutes = value;
      }),
    ).toThrow(ValidationError);
  });

  it.each([-1, 2.5, '30'])('rejects maxSessionMinutes %j', (value) => {
    expect(() =>
      parseWith((policy) => {
        policy.maxSessionMinutes = value;
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a non-string stage', () => {
    expect(() =>
      parseWith((policy) => {
        policy.stage = 7;
      }),
    ).toThrow(ValidationError);
  });

  it('rejects non-finite numbers', () => {
    const base = stringify({ active: makePolicy() });

    expect(() =>
      parsePoliciesYaml(base.replace('skipDayProbability: 0.05', 'skipDayProbability: .nan')),
    ).toThrow(ValidationError);
    expect(() => parsePoliciesYaml(base.replace('maxPerDay: 100', 'maxPerDay: .inf'))).toThrow(
      ValidationError,
    );
  });

  it.each(['', '[]', '42', 'just text', 'active: 5', 'active: [1, 2]'])(
    'rejects the malformed document %j',
    (content) => {
      expect(() => parsePoliciesYaml(content)).toThrow(ValidationError);
    },
  );

  it('rejects syntactically invalid YAML with a ValidationError', () => {
    expect(() => parsePoliciesYaml('active: [unclosed')).toThrow(ValidationError);
  });

  it('keeps a "__proto__" key as plain data', () => {
    const yaml = stringify({ ['__proto__']: makePolicy() });

    const policies = parsePoliciesYaml(yaml);

    expect(Object.keys(policies)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(policies)).toBe(Object.prototype);
  });
});

describe('loadPoliciesFromFile', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('loads and validates the real config/policies.yaml', async () => {
    const policies = await loadPoliciesFromFile(POLICIES_PATH);

    expect(Object.keys(policies).sort()).toEqual(['active', 'onboarding', 'warming_week_1']);
    expect(policies.onboarding).toMatchObject({
      stage: 'onboarding',
      maxSessionMinutes: 5,
      sessionsPerDay: [1, 2],
      minIntervalMinutes: [2, 5],
      skipDayProbability: 0,
    });
    expect(policies.warming_week_1?.actions.like).toEqual({
      maxPerDay: 5,
      probabilityPerEncounter: 0.08,
    });
    expect(policies.active).toMatchObject({
      stage: 'active',
      maxSessionMinutes: 30,
      sessionsPerDay: [2, 4],
      skipDayProbability: 0.05,
    });
    expect(policies.active?.actions.post).toEqual({
      maxPerDay: 2,
      probabilityPerEncounter: 0.5,
    });
  });

  it('provides a policy for every key the status mapping points to', async () => {
    const policies = await loadPoliciesFromFile(POLICIES_PATH);
    const provider: PolicyProvider = { getPolicyByKey: (key) => policies[key] ?? null };

    for (const status of ['onboarding', 'warming', 'active', 'limited'] as const) {
      const key = getPolicyKey(status);
      expect(key).not.toBeNull();
      expect(provider.getPolicyByKey(key ?? '')).not.toBeNull();
    }
  });

  it('rejects an invalid file with a ValidationError', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'persona-policies-'));
    directories.push(directory);
    const path = join(directory, 'policies.yaml');
    await writeFile(path, 'active:\n  stage: active\n', 'utf8');

    await expect(loadPoliciesFromFile(path)).rejects.toThrow(ValidationError);
  });

  it('rejects when the file does not exist', async () => {
    await expect(loadPoliciesFromFile(join(tmpdir(), 'persona-no-such-file.yaml'))).rejects.toThrow(
      /ENOENT/,
    );
  });
});
