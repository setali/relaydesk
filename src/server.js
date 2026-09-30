import { createApp } from './app.js';
import { configFromEnv } from './config.js';
const config = configFromEnv();
const { server, db } = await createApp(config);
server.listen(config.port, config.host, () =>
  console.log(`Relaydesk listening at ${config.origin} (${config.demo ? 'demo' : 'live'})`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
