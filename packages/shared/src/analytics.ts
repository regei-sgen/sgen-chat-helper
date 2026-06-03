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

// Status mix per product PILLAR (the populated reference field; productArea is the strict enum and
// is null for reference KB cards, so the by-pillar breakdown is what actually has data).
export const CoveragePillarRowSchema = z.object({
  productPillar: z.string(),
  status: ArticleStatusSchema,
  count: z.number().int(),
});
export type CoveragePillarRow = z.infer<typeof CoveragePillarRowSchema>;

export const CoverageResponseSchema = z.object({
  byArea: z.array(CoverageRowSchema),
  byPillar: z.array(CoveragePillarRowSchema),
  totals: z.object({
    draft: z.number().int(),
    published: z.number().int(),
    archived: z.number().int(),
  }),
});
export type CoverageResponse = z.infer<typeof CoverageResponseSchema>;

// Bot-usage overview for the Analytics tab — headline KPIs + per-day volume, scoped to a date
// range (rangeDays = null means all time).
export const AnalyticsDailySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  count: z.number().int(),
  matched: z.number().int(),
});
export type AnalyticsDaily = z.infer<typeof AnalyticsDailySchema>;

export const AnalyticsSummarySchema = z.object({
  totalQueries: z.number().int(),
  matched: z.number().int(),
  answeredRate: z.number().nullable(), // matched / total
  avgConfidence: z.number().nullable(),
  withFeedback: z.number().int(),
  helpfulRate: z.number().nullable(), // helpful / withFeedback (null when no feedback yet)
  daily: z.array(AnalyticsDailySchema),
  rangeDays: z.number().int().nullable(),
});
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;
