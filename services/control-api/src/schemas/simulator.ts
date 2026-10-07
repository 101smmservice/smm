import { z } from 'zod';

/** All parameters are optional; what is left out takes the default of the simulator. */
export const startSimulatorBody = z.strictObject({
  /** Simulated seconds per real second. */
  speed: z.number().positive().max(10_000).optional(),
  tickIntervalMs: z.number().int().min(10).max(60_000).optional(),
  maxTicks: z.number().int().positive().optional(),
});

export const stopSimulatorBody = z.strictObject({});

export type StartSimulatorBody = z.infer<typeof startSimulatorBody>;
