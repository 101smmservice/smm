import { ValidationError } from '@persona/core';
import type { LifecycleEvent, LifecycleEventType } from '@persona/core';
import { describe, expect, it } from 'vitest';

import { calculatePublicationMetrics, createAnalyticsSnapshot } from '../src/index.js';

let counter = 0;

function makeEvent(
  type: LifecycleEventType,
  createdAt: string,
  payload: Record<string, unknown> = {},
): LifecycleEvent {
  counter += 1;
  return { id: `evt_${String(counter)}`, accountId: 'acc_1', type, payload, createdAt };
}

const published = (createdAt: string, contentId = 'content_1') =>
  makeEvent('action_performed', createdAt, { action: 'post', contentId });
const failed = (createdAt: string, contentId = 'content_1') =>
  makeEvent('action_failed', createdAt, { action: 'post', contentId });

describe('calculatePublicationMetrics', () => {
  it('returns zeros when there are no events', () => {
    expect(calculatePublicationMetrics([])).toEqual({ total: 0, published: 0, failed: 0 });
  });

  it('counts published and failed publications', () => {
    const events = [
      published('2026-07-01T10:00:00.000Z', 'a'),
      published('2026-07-01T11:00:00.000Z', 'b'),
      failed('2026-07-02T12:00:00.000Z', 'c'),
    ];

    expect(calculatePublicationMetrics(events)).toEqual({ total: 3, published: 2, failed: 1 });
  });

  it('does not count a post action that has no content item', () => {
    const events = [
      makeEvent('action_performed', '2026-07-01T10:00:00.000Z', { action: 'post' }),
      makeEvent('action_failed', '2026-07-01T10:00:00.000Z', { action: 'post', contentId: 7 }),
      published('2026-07-01T11:00:00.000Z'),
    ];

    expect(calculatePublicationMetrics(events)).toEqual({ total: 1, published: 1, failed: 0 });
  });

  it('does not count other actions, even with a content id', () => {
    const events = [
      makeEvent('action_performed', '2026-07-01T10:00:00.000Z', { action: 'like', contentId: 'a' }),
      makeEvent('action_performed', '2026-07-01T10:00:00.000Z', { contentId: 'a' }),
    ];

    expect(calculatePublicationMetrics(events).total).toBe(0);
  });

  it('ignores events of other types', () => {
    const events = [
      makeEvent('state_changed', '2026-07-01T10:00:00.000Z', { action: 'post', contentId: 'a' }),
      makeEvent('session_started', '2026-07-01T10:00:00.000Z', { action: 'post', contentId: 'a' }),
      makeEvent('restriction_detected', '2026-07-01T10:00:00.000Z', {
        action: 'post',
        contentId: 'a',
      }),
    ];

    expect(calculatePublicationMetrics(events).total).toBe(0);
  });

  it('counts only the events of the dates in the range, ends included', () => {
    const events = [
      published('2026-06-30T23:59:59.000Z'),
      published('2026-07-01T00:00:00.000Z'),
      failed('2026-07-02T23:59:59.000Z'),
      published('2026-07-03T00:00:00.000Z'),
    ];

    expect(
      calculatePublicationMetrics(events, { startDate: '2026-07-01', endDate: '2026-07-02' }),
    ).toEqual({ total: 2, published: 1, failed: 1 });
  });

  it('rejects a range that has a date that does not exist', () => {
    expect(() =>
      calculatePublicationMetrics([], { startDate: '2026-02-30', endDate: '2026-03-01' }),
    ).toThrow(ValidationError);
  });

  it('does not change the events', () => {
    const events = [published('2026-07-01T10:00:00.000Z')];
    const copy = structuredClone(events);

    calculatePublicationMetrics(events);

    expect(events).toEqual(copy);
  });
});

describe('the snapshot', () => {
  it('contains the publication metrics, limited by the range', () => {
    const events = [published('2026-07-01T10:00:00.000Z'), failed('2026-07-02T10:00:00.000Z')];
    const now = new Date('2026-07-31T12:00:00.000Z');

    expect(createAnalyticsSnapshot([], events, { now }).publicationMetrics).toEqual({
      total: 2,
      published: 1,
      failed: 1,
    });
    expect(
      createAnalyticsSnapshot([], events, {
        now,
        range: { startDate: '2026-07-02', endDate: '2026-07-02' },
      }).publicationMetrics,
    ).toEqual({ total: 1, published: 0, failed: 1 });
  });
});
