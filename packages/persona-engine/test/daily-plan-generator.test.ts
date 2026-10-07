import { ValidationError, type Account, type ActivityPolicy, type Persona } from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  createEmptyPolicy,
  createSeededRandom,
  DailyPlanGenerator,
  type RandomFn,
} from '../src/index.js';

// 2026-07-01 is a Wednesday, 2026-07-04 a Saturday, 2026-07-05 a Sunday.
const WEEKDAY = '2026-07-01';
const SATURDAY = '2026-07-04';
const SUNDAY = '2026-07-05';

const account: Account = {
  id: 'acc_1',
  platform: 'telegram',
  status: 'active',
  personaId: 'persona_1',
  deviceProfileId: null,
  proxyBindingId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  connectedAt: '2026-01-01T00:00:00.000Z',
  statusChangedAt: '2026-01-01T00:00:00.000Z',
  metadata: {},
};

function makePersona(window: Partial<Persona['activityWindow']> = {}): Persona {
  return {
    id: 'persona_1',
    timezone: 'UTC',
    locale: 'en',
    niche: 'cooking',
    tone: 'friendly',
    topics: ['recipes'],
    audience: 'home cooks',
    activityWindow: { startHour: 9, endHour: 21, weekendActive: true, ...window },
  };
}

function makePolicy(overrides: Partial<ActivityPolicy> = {}): ActivityPolicy {
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
    skipDayProbability: 0,
    ...overrides,
  };
}

const generator = new DailyPlanGenerator();

function generate(
  options: {
    persona?: Persona;
    policy?: ActivityPolicy;
    date?: string;
    rng?: RandomFn;
  } = {},
) {
  return generator.generate({
    account,
    persona: options.persona ?? makePersona(),
    policy: options.policy ?? makePolicy(),
    date: options.date ?? WEEKDAY,
    rng: options.rng ?? createSeededRandom(1),
  });
}

const SEEDS = Array.from({ length: 50 }, (_, index) => index + 1);

describe('DailyPlanGenerator', () => {
  it('echoes the account id and the requested date', () => {
    const plan = generate({ date: '2026-07-02' });

    expect(plan.accountId).toBe('acc_1');
    expect(plan.date).toBe('2026-07-02');
  });

  it('plans a number of sessions within sessionsPerDay', () => {
    const counts = new Set<number>();
    for (const seed of SEEDS) {
      const plan = generate({ rng: createSeededRandom(seed) });

      expect(plan.isSkipDay).toBe(false);
      expect(plan.sessions.length).toBeGreaterThanOrEqual(2);
      expect(plan.sessions.length).toBeLessThanOrEqual(4);
      counts.add(plan.sessions.length);
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it('uses the lower and upper end of sessionsPerDay for the extreme rng values', () => {
    expect(generate({ rng: () => 0.5 }).sessions.length).toBe(3);
    expect(generate({ rng: () => 0 }).sessions.length).toBe(2);
    expect(generate({ rng: () => 0.999999 }).sessions.length).toBe(4);
  });

  it('gives every session maxSessionMinutes as its maximum duration', () => {
    for (const session of generate().sessions) {
      expect(session.maxDurationMinutes).toBe(30);
    }
  });

  it('fills action budgets from maxPerDay of the policy', () => {
    expect(generate().actionBudgets).toEqual({
      view: 100,
      like: 25,
      follow: 8,
      post: 2,
      comment: 5,
    });
  });

  it('keeps every session inside the activity window', () => {
    for (const seed of SEEDS) {
      const plan = generate({
        persona: makePersona({ startHour: 9, endHour: 21 }),
        rng: createSeededRandom(seed),
      });
      const windowStart = Date.parse(`${WEEKDAY}T09:00:00.000Z`);
      const windowEnd = Date.parse(`${WEEKDAY}T21:00:00.000Z`);

      for (const session of plan.sessions) {
        const start = Date.parse(session.startAt);
        expect(start).toBeGreaterThanOrEqual(windowStart);
        expect(start + session.maxDurationMinutes * 60_000).toBeLessThanOrEqual(windowEnd);
      }
    }
  });

  it('sorts sessions by time and keeps them apart by the minimal interval', () => {
    for (const seed of SEEDS) {
      const { sessions } = generate({ rng: createSeededRandom(seed) });

      for (let index = 1; index < sessions.length; index += 1) {
        const previous = sessions[index - 1];
        const current = sessions[index];
        const previousEnd = Date.parse(previous?.startAt ?? '') + 30 * 60_000;
        const gapMinutes = (Date.parse(current?.startAt ?? '') - previousEnd) / 60_000;

        expect(gapMinutes).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('formats session starts as ISO 8601 UTC timestamps on the requested date', () => {
    for (const session of generate().sessions) {
      expect(new Date(session.startAt).toISOString()).toBe(session.startAt);
      expect(session.startAt.startsWith(WEEKDAY)).toBe(true);
    }
  });

  it('is deterministic for the same rng sequence', () => {
    expect(generate({ rng: createSeededRandom(7) })).toEqual(
      generate({ rng: createSeededRandom(7) }),
    );
  });

  it('plans fewer sessions when the window cannot hold the drawn number', () => {
    const plan = generate({
      persona: makePersona({ startHour: 9, endHour: 10 }),
      policy: makePolicy({ sessionsPerDay: [3, 4] }),
    });

    expect(plan.isSkipDay).toBe(false);
    expect(plan.sessions).toHaveLength(1);
    const start = Date.parse(plan.sessions[0]?.startAt ?? '');
    expect(start).toBeGreaterThanOrEqual(Date.parse(`${WEEKDAY}T09:00:00.000Z`));
    expect(start).toBeLessThanOrEqual(Date.parse(`${WEEKDAY}T09:30:00.000Z`));
  });

  describe('skip days', () => {
    it('returns a skip day when rng falls below skipDayProbability', () => {
      const plan = generate({
        policy: makePolicy({ skipDayProbability: 0.1 }),
        rng: () => 0.05,
      });

      expect(plan.isSkipDay).toBe(true);
      expect(plan.sessions).toEqual([]);
    });

    it('does not skip when rng is at or above skipDayProbability', () => {
      const plan = generate({
        policy: makePolicy({ skipDayProbability: 0.1 }),
        rng: () => 0.1,
      });

      expect(plan.isSkipDay).toBe(false);
    });

    it('always skips when skipDayProbability is 1 and never when it is 0', () => {
      expect(generate({ policy: makePolicy({ skipDayProbability: 1 }) }).isSkipDay).toBe(true);
      for (const seed of SEEDS) {
        const plan = generate({
          policy: makePolicy({ skipDayProbability: 0 }),
          rng: createSeededRandom(seed),
        });
        expect(plan.isSkipDay).toBe(false);
      }
    });

    it('returns an empty skip plan for the empty policy', () => {
      const plan = generate({ policy: createEmptyPolicy() });

      expect(plan.isSkipDay).toBe(true);
      expect(plan.sessions).toEqual([]);
      expect(plan.actionBudgets).toEqual({ view: 0, like: 0, follow: 0, post: 0, comment: 0 });
    });

    it('returns a skip plan when no sessions per day are allowed', () => {
      const plan = generate({ policy: makePolicy({ sessionsPerDay: [0, 0] }) });

      expect(plan.isSkipDay).toBe(true);
      expect(plan.sessions).toEqual([]);
    });

    it.each([SATURDAY, SUNDAY])('skips %s when weekendActive is false', (date) => {
      const plan = generate({ persona: makePersona({ weekendActive: false }), date });

      expect(plan.isSkipDay).toBe(true);
      expect(plan.sessions).toEqual([]);
    });

    it.each([SATURDAY, SUNDAY])('plans %s when weekendActive is true', (date) => {
      const plan = generate({ persona: makePersona({ weekendActive: true }), date });

      expect(plan.isSkipDay).toBe(false);
      expect(plan.sessions.length).toBeGreaterThan(0);
    });

    it('plans a weekday even when weekendActive is false', () => {
      const plan = generate({ persona: makePersona({ weekendActive: false }), date: WEEKDAY });

      expect(plan.isSkipDay).toBe(false);
    });
  });

  describe('validation', () => {
    it.each(['2026/07/01', '2026-7-1', '20260701', '2026-07-01T00:00:00Z', '', 'today'])(
      'rejects the malformed date %j',
      (date) => {
        expect(() => generate({ date })).toThrow(ValidationError);
      },
    );

    it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31'])(
      'rejects the non-existent date %s',
      (date) => {
        expect(() => generate({ date })).toThrow(ValidationError);
      },
    );

    it('accepts a leap day', () => {
      expect(() => generate({ date: '2028-02-29' })).not.toThrow();
      expect(() => generate({ date: '2027-02-29' })).toThrow(ValidationError);
    });

    it.each([
      { startHour: 21, endHour: 9 },
      { startHour: 9, endHour: 9 },
      { startHour: -1, endHour: 5 },
      { startHour: 0, endHour: 25 },
      { startHour: 9.5, endHour: 12 },
    ])('rejects the activity window %j', (window) => {
      expect(() => generate({ persona: makePersona(window) })).toThrow(ValidationError);
    });

    it('accepts a window that spans the whole day', () => {
      const plan = generate({ persona: makePersona({ startHour: 0, endHour: 24 }) });

      expect(plan.sessions.length).toBeGreaterThan(0);
    });
  });
});

describe('createSeededRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);

    expect(Array.from({ length: 10 }, () => first())).toEqual(
      Array.from({ length: 10 }, () => second()),
    );
  });

  it('produces different sequences for different seeds', () => {
    expect(createSeededRandom(1)()).not.toBe(createSeededRandom(2)());
  });

  it('stays within [0, 1)', () => {
    const rng = createSeededRandom(123);
    for (let index = 0; index < 1000; index += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('rejects a non-finite seed', () => {
    expect(() => createSeededRandom(Number.NaN)).toThrow(ValidationError);
  });
});
