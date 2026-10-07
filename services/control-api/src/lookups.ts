import type { Account, Persona } from '@persona/core';

import type { ControlApiContainer } from './container.js';
import { NotFoundError, RequestValidationError } from './errors.js';

/** The account addressed by the path of a request; unknown ids are a 404. */
export async function requireAccount(
  container: ControlApiContainer,
  accountId: string,
): Promise<Account> {
  const account = await container.accounts.getById(accountId);
  if (account === null) {
    throw new NotFoundError('account', accountId);
  }
  return account;
}

export async function requirePersona(
  container: ControlApiContainer,
  personaId: string,
): Promise<Persona> {
  const persona = await container.personas.getById(personaId);
  if (persona === null) {
    throw new NotFoundError('persona', personaId);
  }
  return persona;
}

/**
 * Checks a persona id that arrives in a request body. The request itself is what is wrong when it
 * points at a persona that does not exist, so this is a 400 rather than a 404.
 */
export async function ensurePersonaReferenced(
  container: ControlApiContainer,
  personaId: string,
): Promise<void> {
  if ((await container.personas.getById(personaId)) === null) {
    throw new RequestValidationError('Invalid body', [
      { path: ['body', 'personaId'], message: `persona not found: ${personaId}` },
    ]);
  }
}
