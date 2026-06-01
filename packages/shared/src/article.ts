import { z } from 'zod';
import {
  ArticleStatusSchema,
  DifficultySchema,
  ProductAreaSchema,
} from './enums.js';

// Optional URL field with friendly normalization:
//  - undefined stays undefined (field left unchanged on PATCH)
//  - blank / null becomes null (cleared)
//  - a scheme-less value like "docs.sgen.com/x" gets "https://" prepended
// so users don't have to type the protocol; genuinely malformed values still fail `.url()`.
export const OptionalUrlSchema = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  }
  return v;
}, z.string().url().nullable().optional());

export const StepSchema = z.object({
  id: z.string().optional(),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  content: z.string(),
  imageUrl: OptionalUrlSchema,
});
export type Step = z.infer<typeof StepSchema>;

export const StepInputSchema = StepSchema.omit({ id: true });
export type StepInput = z.infer<typeof StepInputSchema>;

export const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type Tag = z.infer<typeof TagSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  parentId: z.string().nullable(),
});
export type Category = z.infer<typeof CategorySchema>;

export const ArticleRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  productArea: ProductAreaSchema.nullable(),
  status: ArticleStatusSchema,
});
export type ArticleRef = z.infer<typeof ArticleRefSchema>;

export const ArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  content: z.string(),
  feature: z.string().nullable(),
  productArea: ProductAreaSchema.nullable(),
  difficulty: DifficultySchema.nullable(),
  sgenUrl: z.string().url().nullable(),
  status: ArticleStatusSchema,
  reviewedAt: z.coerce.date().nullable(),
  reviewedBy: z.string().nullable(),
  categoryId: z.string().nullable(),
  duplicateOf: z.string().nullable().optional(),
  duplicateScore: z.number().nullable().optional(),
  authorId: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  steps: z.array(StepSchema).default([]),
  tags: z.array(TagSchema).default([]),
  category: CategorySchema.nullable().optional(),
  prerequisites: z.array(ArticleRefSchema).default([]),
  relatedTo: z.array(ArticleRefSchema).default([]),
});
export type Article = z.infer<typeof ArticleSchema>;

export const ArticleCreateSchema = z.object({
  title: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes')
    .optional(),
  summary: z.string().nullable().optional(),
  content: z.string(),
  feature: z.string().nullable().optional(),
  productArea: ProductAreaSchema.nullable().optional(),
  difficulty: DifficultySchema.nullable().optional(),
  sgenUrl: OptionalUrlSchema,
  status: ArticleStatusSchema.default('DRAFT'),
  categoryId: z.string().nullable().optional(),
  steps: z.array(StepInputSchema).default([]),
  tags: z.array(z.string()).default([]),
  prerequisiteIds: z.array(z.string()).default([]),
  relatedIds: z.array(z.string()).default([]),
});
export type ArticleCreateInput = z.infer<typeof ArticleCreateSchema>;

export const ArticleUpdateSchema = ArticleCreateSchema.partial();
export type ArticleUpdateInput = z.infer<typeof ArticleUpdateSchema>;

export const ArticleListQuerySchema = z.object({
  status: ArticleStatusSchema.optional(),
  productArea: ProductAreaSchema.optional(),
  feature: z.string().optional(),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  duplicates: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ArticleListQuery = z.infer<typeof ArticleListQuerySchema>;

export const ArticleListResponseSchema = z.object({
  items: z.array(ArticleSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type ArticleListResponse = z.infer<typeof ArticleListResponseSchema>;

// ---- Bulk actions on the article list ----
export const BulkArticleActionSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(['publish', 'draft', 'archive', 'delete']),
});
export type BulkArticleAction = z.infer<typeof BulkArticleActionSchema>;
export type BulkAction = BulkArticleAction['action'];

export const BulkArticleResultSchema = z.object({
  action: z.string(),
  requested: z.number(),
  succeeded: z.number(),
  failed: z.array(z.object({ id: z.string(), message: z.string() })),
});
export type BulkArticleResult = z.infer<typeof BulkArticleResultSchema>;
