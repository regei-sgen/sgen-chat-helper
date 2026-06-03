import { z } from 'zod';
import { ArticleStatusSchema, DifficultySchema, ProductAreaSchema } from './enums.js';

export const GraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  slug: z.string(),
  productArea: ProductAreaSchema.nullable(),
  // Free-form reference pillar (e.g. "SG-Admin", "SG-Dashboard"). The graph colors by this because
  // it's the populated field — productArea (the strict enum) is null for reference KB cards.
  productPillar: z.string().nullable(),
  difficulty: DifficultySchema.nullable(),
  status: ArticleStatusSchema,
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(['prerequisite', 'related']),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type GraphResponse = z.infer<typeof GraphResponseSchema>;
