import { z } from 'zod';
import { ArticleStatusSchema, ProductAreaSchema } from './enums.js';

export const UnansweredQuerySchema = z.object({
  id: z.string(),
  question: z.string(),
  confidence: z.number().nullable(),
  matchedId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type UnansweredQuery = z.infer<typeof UnansweredQuerySchema>;

export const TopQuerySchema = z.object({
  question: z.string(),
  count: z.number().int(),
  avgConfidence: z.number().nullable(),
  helpfulRatio: z.number().nullable(),
});
export type TopQuery = z.infer<typeof TopQuerySchema>;

export const CoverageRowSchema = z.object({
  productArea: ProductAreaSchema,
  status: ArticleStatusSchema,
  count: z.number().int(),
});
export type CoverageRow = z.infer<typeof CoverageRowSchema>;

export const CoverageResponseSchema = z.object({
  byArea: z.array(CoverageRowSchema),
  totals: z.object({
    draft: z.number().int(),
    published: z.number().int(),
    archived: z.number().int(),
  }),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;
