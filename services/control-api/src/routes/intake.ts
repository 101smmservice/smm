import {
  assertIntakeTransition,
  INTAKE_STATUSES,
  IntakeNotFoundError,
  type IntakeRequest,
  type IntakeStatus,
} from '@persona/account-intake';
import type { FastifyInstance } from 'fastify';

import type { ControlApiContainer } from '../container.js';
import { ManualConfirmationRequiredError } from '../errors.js';
import { parseRequest } from '../schemas/common.js';
import {
  approveIntakeBody,
  completeIntakeBody,
  createIntakeBody,
  intakeParams,
  listIntakeQuery,
  rejectIntakeBody,
  reopenIntakeBody,
  submitIntakeBody,
} from '../schemas/intake.js';

/**
 * Manual intake of accounts. Nothing here registers an account anywhere: a request records that an
 * existing account is being brought into the portfolio, and completing it adds the record.
 */
export function registerIntakeRoutes(app: FastifyInstance, container: ControlApiContainer): void {
  const { intakeService, intakeRepository } = container;

  async function requireRequest(requestId: string): Promise<IntakeRequest> {
    const request = await intakeService.getRequest(requestId);
    if (request === null) {
      throw new IntakeNotFoundError(requestId);
    }
    return request;
  }

  async function listRequests(status: IntakeStatus | undefined): Promise<IntakeRequest[]> {
    const statuses = status === undefined ? INTAKE_STATUSES : [status];
    const groups = await Promise.all(
      statuses.map((candidate) => intakeRepository.findByStatus(candidate)),
    );
    return groups.flat().sort(compareByCreation);
  }

  app.post('/intake/requests', async (request, reply) => {
    const body = parseRequest('body', createIntakeBody, request.body);

    return reply.code(201).send(await intakeService.createDraft(body));
  });

  app.get('/intake/requests', async (request) => {
    const query = parseRequest('query', listIntakeQuery, request.query);
    return listRequests(query.status);
  });

  app.get('/intake/requests/:requestId', async (request) => {
    const { requestId } = parseRequest('params', intakeParams, request.params);
    return requireRequest(requestId);
  });

  app.post('/intake/requests/:requestId/submit', async (request) => {
    const { requestId } = parseRequest('params', intakeParams, request.params);
    const body = parseRequest('body', submitIntakeBody, request.body);

    return intakeService.submitForReview(requestId, body);
  });

  app.post('/intake/requests/:requestId/approve', async (request) => {
    const { requestId } = parseRequest('params', intakeParams, request.params);
    const body = parseRequest('body', approveIntakeBody, request.body ?? {});
    const intake = await requireRequest(requestId);

    assertIntakeTransition(intake.status, 'approved');
    if (body.confirmOwnership !== true) {
      throw new ManualConfirmationRequiredError(
        'Approving an intake request means the reviewer has verified that the submitter owns the ' +
          'account, and has to be confirmed with confirmOwnership: true',
        [{ from: intake.status, to: 'approved' }],
      );
    }

    return intakeService.approve(requestId, {
      confirmOwnership: true,
      reviewerNote: body.reviewerNote,
    });
  });

  app.post('/intake/requests/:requestId/reject', async (request) => {
    const { requestId } = parseRequest('params', intakeParams, request.params);
    const body = parseRequest('body', rejectIntakeBody, request.body);

    return intakeService.reject(requestId, body);
  });

  app.post('/intake/requests/:requestId/reopen', async (request) => {
    const { requestId } = parseRequest('params', intakeParams, request.params);
    parseRequest('body', reopenIntakeBody, request.body ?? {});

    return intakeService.reopen(requestId);
  });

  app.post('/intake/requests/:requestId/complete', async (request) => {
    const { requestId } = parseRequest('params', intakeParams, request.params);
    const body = parseRequest('body', completeIntakeBody, request.body ?? {});

    return intakeService.complete(requestId, body);
  });
}

function compareByCreation(a: IntakeRequest, b: IntakeRequest): number {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (byTime !== 0 && !Number.isNaN(byTime)) {
    return byTime;
  }
  if (a.id < b.id) {
    return -1;
  }
  return a.id > b.id ? 1 : 0;
}
