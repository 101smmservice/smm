import { buildApp } from './app.js';
import { resolveServerConfig } from './config.js';

const { host, port } = resolveServerConfig(process.env);
const app = await buildApp({ logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'failed to shut down cleanly');
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
