import { z } from 'zod';

export const RoleSchema = z.enum(['SUPER_ADMIN', 'EDITOR']);
export type Role = z.infer<typeof RoleSchema>;

export const ProductAreaSchema = z.enum(['SG_CORE', 'SG_MODULES', 'SG_DASHBOARD']);
export type ProductArea = z.infer<typeof ProductAreaSchema>;

export const DifficultySchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const ArticleStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export type ArticleStatus = z.infer<typeof ArticleStatusSchema>;

export const JobStatusSchema = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const PRODUCT_AREA_LABELS: Record<ProductArea, string> = {
  SG_CORE: 'SG Core',
  SG_MODULES: 'SG Modules',
  SG_DASHBOARD: 'SG Dashboard',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
};

export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};
