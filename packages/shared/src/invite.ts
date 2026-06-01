import { z } from 'zod';
import { RoleSchema } from './enums.js';

export const InviteSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  token: z.string(),
  role: RoleSchema,
  invitedBy: z.string(),
  expiresAt: z.coerce.date(),
  usedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const InviteCreateSchema = z.object({
  email: z.string().email(),
  role: RoleSchema.default('EDITOR'),
});
export type InviteCreateInput = z.infer<typeof InviteCreateSchema>;
