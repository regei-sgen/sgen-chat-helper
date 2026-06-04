import { z } from 'zod';
import { ArticleSchema, ArticleRefSchema } from './article.js';

export const BotQuerySchema = z.object({
  id: z.string(),
  question: z.string(),
  matchedId: z.string().nullable(),
  confidence: z.number().nullable(),
  helpful: z.boolean().nullable(),
  apiKeyId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type BotQuery = z.infer<typeof BotQuerySchema>;

export const ArticleQueryRequestSchema = z.object({
  question: z.string().min(1).max(2000),
});
export type ArticleQueryRequest = z.infer<typeof ArticleQueryRequestSchema>;

export const ArticleQueryResponseSchema = z.object({
  queryId: z.string(),
  primary: ArticleSchema.nullable(),
  prerequisites: z.array(ArticleRefSchema),
  related: z.array(ArticleRefSchema),
  confidence: z.number(),
});
export type ArticleQueryResponse = z.infer<typeof ArticleQueryResponseSchema>;

export const BotFeedbackSchema = z.object({
  queryId: z.string(),
  helpful: z.boolean(),
});
export type BotFeedbackInput = z.infer<typeof BotFeedbackSchema>;

// ---- Conversational chat (AI decides whether to query the KB, then composes a reply) ----
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(ChatMessageSchema).max(20).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatSourceSchema = z.object({ title: z.string(), slug: z.string() });

// A clickable "next question" button (clicking sends `message` to /chat).
export const ChatSuggestionSchema = z.object({ label: z.string(), message: z.string() });
export type ChatSuggestion = z.infer<typeof ChatSuggestionSchema>;

// A clickable hyperlink (opens `url`).
export const ChatLinkSchema = z.object({ label: z.string(), url: z.string() });
export type ChatLink = z.infer<typeof ChatLinkSchema>;

// ---- Interactive step-by-step walkthrough ----
// Rendered ONE step at a time, each with a Next button, instead of one wall of text.
// `route`/`selector` are optional and reserved for the future live-site guided tour
// (the browser extension highlighting real elements on the user's SGEN admin); unused today.
export const WalkthroughStepSchema = z.object({
  n: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  // Topic this step belongs to (the source article). Set when a multi-topic question
  // combines steps from more than one article, so the UI can show a section header.
  group: z.string().optional(),
  // Slug of the source KB article this step came from, when available — lets the client
  // deep-link the step back to its knowledge-base article.
  slug: z.string().optional(),
  // True when this step best matches the user's question (the part they actually asked about).
  highlight: z.boolean().optional(),
  imageUrl: z.string().url().nullable().optional(),
  route: z.string().optional(),
  selector: z.string().optional(),
});
export type WalkthroughStep = z.infer<typeof WalkthroughStepSchema>;

export const WalkthroughSchema = z.object({
  title: z.string(),
  steps: z.array(WalkthroughStepSchema),
  source: z.string().optional(),
  // Step the client should reveal up to / focus first (the most relevant to the question).
  focusStep: z.number().int().positive().optional(),
  // Extra article content rendered AFTER the steps (intro/extra prose, trailing sections like
  // "### Get more from SGEN", links). The steps themselves stay in the interactive stepper.
  footer: z.string().optional(),
});
export type Walkthrough = z.infer<typeof WalkthroughSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string(),
  usedKnowledgeBase: z.boolean(),
  sources: z.array(ChatSourceSchema),
  links: z.array(ChatLinkSchema),
  followups: z.array(ChatSuggestionSchema),
  walkthrough: WalkthroughSchema.nullable().optional(),
  confidence: z.number().nullable(),
  queryId: z.string().nullable(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const SuggestionsResponseSchema = z.object({
  welcome: z.string(),
  suggestions: z.array(ChatSuggestionSchema),
});
export type SuggestionsResponse = z.infer<typeof SuggestionsResponseSchema>;
