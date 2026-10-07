import { DomainError } from '@persona/core';
import { describe, expect, it } from 'vitest';

import {
  assertIntakeTransition,
  canTransitionIntake,
  INTAKE_STATUSES,
  IntakeError,
  InvalidIntakeTransitionError,
  requiresOwnershipConfirmation,
  type IntakeStatus,
} from '../src/index.js';

/** The transition table from the specification, written out independently of the implementation. */
const EXPECTED: Record<IntakeStatus, IntakeStatus[]> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['completed', 'rejected'],
  rejected: ['draft'],
  completed: [],
};

describe('canTransitionIntake', () => {
  it.each<[IntakeStatus, IntakeStatus]>([
    ['draft', 'pending_review'],
    ['pending_review', 'approved'],
    ['pending_review', 'rejected'],
    ['approved', 'completed'],
    ['approved', 'rejected'],
    ['rejected', 'draft'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransitionIntake(from, to)).toBe(true);
    expect(() => {
      assertIntakeTransition(from, to);
    }).not.toThrow();
  });

  it.each<[IntakeStatus, IntakeStatus]>([
    ['draft', 'approved'],
    ['draft', 'completed'],
    ['pending_review', 'completed'],
    ['completed', 'draft'],
  ])('forbids %s -> %s', (from, to) => {
    expect(canTransitionIntake(from, to)).toBe(false);
    expect(() => {
      assertIntakeTransition(from, to);
    }).toThrow(InvalidIntakeTransitionError);
  });

  it('allows exactly the transitions of the specification and nothing else', () => {
    for (const from of INTAKE_STATUSES) {
      for (const to of INTAKE_STATUSES) {
        expect(canTransitionIntake(from, to), `${from} -> ${to}`).toBe(EXPECTED[from].includes(to));
      }
    }
  });

  it('never allows staying in the same status', () => {
    for (const status of INTAKE_STATUSES) {
      expect(canTransitionIntake(status, status)).toBe(false);
    }
  });

  it('allows nothing out of completed', () => {
    for (const to of INTAKE_STATUSES) {
      expect(canTransitionIntake('completed', to)).toBe(false);
    }
  });

  it('allows a request to be rejected only while it is under review or approved', () => {
    expect(INTAKE_STATUSES.filter((from) => canTransitionIntake(from, 'rejected'))).toEqual([
      'pending_review',
      'approved',
    ]);
  });

  it('rejects unknown statuses at runtime', () => {
    const unknown = 'archived' as unknown as IntakeStatus;

    expect(canTransitionIntake(unknown, 'draft')).toBe(false);
    expect(canTransitionIntake('draft', unknown)).toBe(false);
  });
});

describe('assertIntakeTransition', () => {
  it('throws an InvalidIntakeTransitionError that carries both statuses', () => {
    try {
      assertIntakeTransition('draft', 'completed');
      expect.unreachable('assertIntakeTransition should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIntakeTransitionError);
      const typed = error as InvalidIntakeTransitionError;
      expect(typed.from).toBe('draft');
      expect(typed.to).toBe('completed');
      expect(typed.code).toBe('INVALID_INTAKE_TRANSITION');
      expect(typed.message).toContain('draft -> completed');
    }
  });

  it('is an intake error and a domain error', () => {
    const error = new InvalidIntakeTransitionError('draft', 'completed');

    expect(error).toBeInstanceOf(IntakeError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvalidIntakeTransitionError');
  });
});

describe('requiresOwnershipConfirmation', () => {
  it('is true for draft -> pending_review', () => {
    expect(requiresOwnershipConfirmation('draft', 'pending_review')).toBe(true);
  });

  it('is true for approved -> completed', () => {
    expect(requiresOwnershipConfirmation('approved', 'completed')).toBe(true);
  });

  it('is false for every other transition', () => {
    for (const from of INTAKE_STATUSES) {
      for (const to of INTAKE_STATUSES) {
        const expected =
          (from === 'draft' && to === 'pending_review') ||
          (from === 'approved' && to === 'completed');
        expect(requiresOwnershipConfirmation(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });
});
