import { DomainError } from '@persona/core';

export class SimulatorError extends DomainError {
  constructor(message: string, code = 'SIMULATOR_ERROR', options?: ErrorOptions) {
    super(message, code, options);
    this.name = 'SimulatorError';
  }
}

/** `start` was called while the simulator was already running. */
export class SimulatorAlreadyRunningError extends SimulatorError {
  constructor() {
    super('The simulator is already running', 'SIMULATOR_ALREADY_RUNNING');
    this.name = 'SimulatorAlreadyRunningError';
  }
}

/** `stop` was called while the simulator was not running. */
export class SimulatorNotRunningError extends SimulatorError {
  constructor() {
    super('The simulator is not running', 'SIMULATOR_NOT_RUNNING');
    this.name = 'SimulatorNotRunningError';
  }
}
