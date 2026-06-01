import slugify from 'slugify';
import { prisma } from './prisma.js';

export function baseSlug(title: string): string {
  return slugify(title, { lower: true, strict: true, trim: true }) || 'article';
}

export async function uniqueArticleSlug(title: string, ignoreId?: string): Promise<string> {
  const base = baseSlug(title);
  let candidate = base;
  let suffix = 1;
  while (true) {
    const existing = await prisma.article.findFirst({
      where: { slug: candidate, NOT: ignoreId ? { id: ignoreId } : undefined },
      select: { id: true },
    });
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}
