import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ACTION_TYPES,
  isActionType,
  type ActionSequence,
  type ActionType,
  type ActivityPolicy,
  type IBehaviorEngine,
  type IPersonaEngine,
  type PolicyDecision,
} from '../src/index.js';

describe('action types', () => {
  it('lists the five supported actions', () => {
    expect([...ACTION_TYPES]).toEqual(['view', 'like', 'follow', 'post', 'comment']);
  });

  it('keeps ActivityPolicy.actions keyed by exactly the ActionType values', () => {
    expectTypeOf<keyof ActivityPolicy['actions']>().toEqualTypeOf<ActionType>();
  });

  it.each(ACTION_TYPES)('recognises %s as an action type', (action) => {
    expect(isActionType(action)).toBe(true);
  });

  it.each(['', 'share', 'VIEW', null, undefined, 1])('rejects %j', (value) => {
    expect(isActionType(value)).toBe(false);
  });
});

describe('engine contracts', () => {
  it('describe the engine method shapes', () => {
    expectTypeOf<
      IPersonaEngine['canPerformAction']
    >().returns.resolves.toEqualTypeOf<PolicyDecision>();
    expectTypeOf<IBehaviorEngine['generateSession']>().returns.toEqualTypeOf<ActionSequence>();
  });
});
