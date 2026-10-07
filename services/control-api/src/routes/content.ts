import { requiresManualConfirmation, type ContentItem } from '@persona/publisher';
import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';
import { ManualConfirmationRequiredError, NotFoundError } from '../errors.js';
import { ensurePersonaReferenced, requireAccount } from '../lookups.js';
import { parseRequest } from '../schemas/common.js';
import {
  confirmPublishedBody,
  contentParams,
  contentPlanParams,
  contentPlanQuery,
  createContentBody,
  markFailedBody,
  transitionContentBody,
} from '../schemas/content.js';

export function registerContentRoutes(app: FastifyInstance, container: ControlApiContainer): void {
  const { contentPipeline } = container;

  async function requireContent(contentId: string): Promise<ContentItem> {
    const item = await contentPipeline.getItem(contentId);
    if (item === null) {
      throw new NotFoundError('content', contentId);
    }
    return item;
  }

  function confirmationRequired(item: ContentItem, to: string): ManualConfirmationRequiredError {
    return new ManualConfirmationRequiredError(
      `Moving content from ${item.status} to ${to} records a publication that happened outside ` +
        'this service and has to be confirmed with confirm: true',
      [{ from: item.status, to }],
    );
  }

  app.post('/content', async (request, reply) => {
    const body = parseRequest('body', createContentBody, request.body);
    const account = await requireAccount(container, body.accountId);

    if (body.personaId !== undefined && body.personaId !== null) {
      await ensurePersonaReferenced(container, body.personaId);
    }
    const item = await contentPipeline.createDraft({
      ...body,
      personaId: body.personaId === undefined ? account.personaId : body.personaId,
    });

    return reply.code(201).send(item);
  });

  app.get('/content/:contentId', async (request) => {
    const { contentId } = parseRequest('params', contentParams, request.params);
    return requireContent(contentId);
  });

  app.post('/content/:contentId/transition', async (request) => {
    const { contentId } = parseRequest('params', contentParams, request.params);
    const { confirm, ...transition } = parseRequest('body', transitionContentBody, request.body);
    const item = await requireContent(contentId);

    if (requiresManualConfirmation(item.status, transition.to) && confirm !== true) {
      throw confirmationRequired(item, transition.to);
    }
    return contentPipeline.transition({
      id: contentId,
      ...transition,
      at: transition.at === undefined ? undefined : new Date(transition.at),
    });
  });

  app.post('/content/:contentId/published', async (request) => {
    const { contentId } = parseRequest('params', contentParams, request.params);
    const body = parseRequest('body', confirmPublishedBody, request.body ?? {});
    const item = await requireContent(contentId);

    if (body.confirm !== true) {
      throw confirmationRequired(item, 'published');
    }
    return contentPipeline.markPublished(contentId, {
      at: body.at === undefined ? undefined : new Date(body.at),
      externalId: body.externalId,
    });
  });

  app.post('/content/:contentId/failed', async (request) => {
    const { contentId } = parseRequest('params', contentParams, request.params);
    const body = parseRequest('body', markFailedBody, request.body);
    await requireContent(contentId);

    return contentPipeline.markFailed(contentId, body.reason, {
      at: body.at === undefined ? undefined : new Date(body.at),
    });
  });

  app.get('/accounts/:accountId/content-plan', async (request) => {
    const { accountId } = parseRequest('params', contentPlanParams, request.params);
    const query = parseRequest('query', contentPlanQuery, request.query);
    await requireAccount(container, accountId);

    return contentPipeline.planForDate(accountId, query.date);
  });
}
