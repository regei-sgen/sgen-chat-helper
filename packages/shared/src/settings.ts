import { z } from 'zod';

export const EmbeddingProviderSchema = z.enum(['local', 'openai', 'gemini']);
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderSchema>;

// 'claude-code' runs the locally-installed Claude Code CLI (no API key; local machine only).
export const StructuringProviderSchema = z.enum(['anthropic', 'openai', 'gemini', 'claude-code']);
export type StructuringProvider = z.infer<typeof StructuringProviderSchema>;

// All fields optional: omitted = leave unchanged; empty string = clear / use default.
export const SettingsUpdateSchema = z
  .object({
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    structuringProvider: StructuringProviderSchema.optional(),
    structuringModel: z.string().optional(),
    autolinkProvider: StructuringProviderSchema.optional(),
    embeddingProvider: EmbeddingProviderSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No settings provided' });
export type SettingsUpdateInput = z.infer<typeof SettingsUpdateSchema>;

export const ProviderStatusSchema = z.object({
  configured: z.boolean(),
  hint: z.string().nullable(),
  source: z.enum(['settings', 'env']).nullable(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const SettingsStatusSchema = z.object({
  anthropic: ProviderStatusSchema,
  openai: ProviderStatusSchema,
  gemini: ProviderStatusSchema,
  structuringProvider: StructuringProviderSchema,
  structuringModel: z.string(),
  autolinkProvider: StructuringProviderSchema,
  autolinkModel: z.string(),
  embeddingProvider: EmbeddingProviderSchema,
  activeEmbeddingModel: z.string(),
  embeddings: z.object({
    total: z.number(),
    matchingActive: z.number(),
    needsReembed: z.number(),
  }),
});
export type SettingsStatus = z.infer<typeof SettingsStatusSchema>;

export const ProviderTestSchema = z.object({ ok: z.boolean(), message: z.string() }).nullable();

export const SettingsTestResultSchema = z.object({
  anthropic: ProviderTestSchema,
  openai: ProviderTestSchema,
  gemini: ProviderTestSchema,
  claudeCode: ProviderTestSchema,
});
export type SettingsTestResult = z.infer<typeof SettingsTestResultSchema>;

export const ReembedResultSchema = z.object({
  reembedded: z.number(),
  failed: z.number(),
  model: z.string(),
});
export type ReembedResult = z.infer<typeof ReembedResultSchema>;
