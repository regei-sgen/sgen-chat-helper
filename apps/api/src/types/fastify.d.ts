import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      role: 'SUPER_ADMIN' | 'EDITOR';
      type?: 'refresh';
    };
    user: {
      sub: string;
      email: string;
      role: 'SUPER_ADMIN' | 'EDITOR';
      type?: 'refresh';
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: { id: string };
  }
}
