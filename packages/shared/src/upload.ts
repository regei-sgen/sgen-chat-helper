import { z } from 'zod';
import {
  JobStatusSchema,
  ProductAreaSchema,
  DifficultySchema,
  ArticleStatusSchema,
} from './enums.js';

export const UploadJobStatusSchema = z.object({
  id: z.string(),
  status: JobStatusSchema,
  total: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  errors: z.array(z.object({ file: z.string(), message: z.string() })).nullable(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type UploadJobStatus = z.infer<typeof UploadJobStatusSchema>;

export const UploadOptionsSchema = z.object({
  autoPublish: z.coerce.boolean().default(false),
});
export type UploadOptions = z.infer<typeof UploadOptionsSchema>;

// ---- AI-structured article (round-trips between analyze → apply) ----
export const StructuredArticleSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  feature: z.string().nullable(),
  productArea: ProductAreaSchema.nullable(),
  difficulty: DifficultySchema.nullable(),
  content: z.string(),
  steps: z
    .array(
      z.object({
        order: z.number().int().nonnegative(),
        title: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
  tags: z.array(z.string()).default([]),
  suggestedPrerequisites: z.array(z.string()).default([]),
  suggestedRelated: z.array(z.string()).default([]),
  sgenUrl: z.string().nullable(),
});
export type StructuredArticle = z.infer<typeof StructuredArticleSchema>;

// ---- Duplicate detection ----
export const DiffEntrySchema = z.object({
  field: z.string(),
  label: z.string(),
  changed: z.boolean(),
  old: z.string().nullable(),
  new: z.string().nullable(),
  note: z.string().nullable(),
});
export type DiffEntry = z.infer<typeof DiffEntrySchema>;

export const DuplicateCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  status: ArticleStatusSchema,
  similarity: z.number(),
  matchReason: z.string(),
  diff: z.array(DiffEntrySchema),
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;

export const AnalyzeResponseSchema = z.object({
  structured: StructuredArticleSchema,
  candidates: z.array(DuplicateCandidateSchema),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const ApplyActionSchema = z.enum(['create', 'override']);
export type ApplyAction = z.infer<typeof ApplyActionSchema>;

export const ApplyRequestSchema = z
  .object({
    structured: StructuredArticleSchema,
    action: ApplyActionSchema,
    targetId: z.string().optional(),
    autoPublish: z.boolean().default(false),
  })
  .refine((d) => d.action !== 'override' || Boolean(d.targetId), {
    message: 'targetId is required when action is "override"',
  });
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const ResolveDuplicateSchema = z.object({
  action: z.enum(['override', 'dismiss']),
});
export type ResolveDuplicateInput = z.infer<typeof ResolveDuplicateSchema>;

// ---- AI relationship auto-linking (prerequisites + related) ----
export const AutoLinkProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  prerequisiteIds: z.array(z.string()),
  relatedIds: z.array(z.string()),
  prerequisiteTitles: z.array(z.string()),
  relatedTitles: z.array(z.string()),
  currentPrerequisiteTitles: z.array(z.string()),
  currentRelatedTitles: z.array(z.string()),
});
export type AutoLinkProposal = z.infer<typeof AutoLinkProposalSchema>;

export const AutoLinkPreviewResponseSchema = z.object({
  proposals: z.array(AutoLinkProposalSchema),
  articleCount: z.number(),
});
export type AutoLinkPreviewResponse = z.infer<typeof AutoLinkPreviewResponseSchema>;

export const AutoLinkApplyRequestSchema = z.object({
  proposals: z
    .array(
      z.object({
        id: z.string(),
        prerequisiteIds: z.array(z.string()),
        relatedIds: z.array(z.string()),
      }),
    )
    .optional(),
});
export type AutoLinkApplyInput = z.infer<typeof AutoLinkApplyRequestSchema>;

export const AutoLinkApplyResponseSchema = z.object({
  updated: z.number(),
  proposals: z.array(AutoLinkProposalSchema).optional(),
});
export type AutoLinkApplyResponse = z.infer<typeof AutoLinkApplyResponseSchema>;
