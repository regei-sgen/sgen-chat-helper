import { z } from 'zod';
import { ArticleStatusSchema, DifficultySchema, ProductAreaSchema } from './enums.js';

export const GraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  slug: z.string(),
  productArea: ProductAreaSchema.nullable(),
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
