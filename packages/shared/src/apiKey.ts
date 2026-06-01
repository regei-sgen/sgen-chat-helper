import { z } from 'zod';

export const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ApiKeyCreateSchema = z.object({
  name: z.string().min(1),
});
export type ApiKeyCreateInput = z.infer<typeof ApiKeyCreateSchema>;

export const ApiKeyCreatedResponseSchema = ApiKeySchema.extend({
  plaintext: z.string(),
});
export type ApiKeyCreatedResponse = z.infer<typeof ApiKeyCreatedResponseSchema>;
