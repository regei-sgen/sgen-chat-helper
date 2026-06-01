import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { env } from './lib/env.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { closeQueue } from './lib/queue.js';
import { errorHandler } from './middleware/errorHandler.js';

import { authRoutes } from './routes/auth.js';
import { inviteRoutes } from './routes/invites.js';
import { articleRoutes } from './routes/articles.js';
import { graphRoutes } from './routes/graph.js';
import { apiKeyRoutes } from './routes/apiKeys.js';
import { botRoutes } from './routes/bot.js';
import { analyticsRoutes } from './routes/analytics.js';
import { userRoutes } from './routes/users.js';
import { categoryRoutes } from './routes/categories.js';
import { settingsRoutes } from './routes/settings.js';
import { chatTestRoutes } from './routes/chat.js';

async function buildServer() {
  const app = Fastify({
    logger: {
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    bodyLimit: 10 * 1024 * 1024,
  });

  app.setErrorHandler(errorHandler);

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 50 },
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  await app.register(rateLimit, {
    global: false,
    max: 1000,
    timeWindow: '1 minute',
  });

  app.get('/health', async () => ({
    status: 'ok',
    env: env.NODE_ENV,
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(inviteRoutes, { prefix: '/invites' });
  await app.register(articleRoutes, { prefix: '/articles' });
  await app.register(graphRoutes, { prefix: '/graph' });
  await app.register(apiKeyRoutes, { prefix: '/api-keys' });
  await app.register(analyticsRoutes, { prefix: '/analytics' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(categoryRoutes, { prefix: '/categories' });
  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(chatTestRoutes, { prefix: '/chat' });

  await app.register(
    async (botApp) => {
      await botApp.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
        keyGenerator: (req) =>
          (Array.isArray(req.headers['x-api-key'])
            ? req.headers['x-api-key'][0]
            : req.headers['x-api-key']) ?? req.ip,
      });
      await botApp.register(botRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(
      `API listening on port ${env.PORT}; CORS allows ${env.FRONTEND_URL.join(', ')}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);
    try {
      await app.close();
      await closeQueue();
      await disconnectPrisma();
      await disconnectRedis();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
