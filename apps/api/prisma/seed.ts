import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { generateEmbedding, toPgVector } from '../src/services/embedding.js';
import { generateApiKey } from '../src/lib/token.js';
import { baseSlug } from '../src/lib/slug.js';

const prisma = new PrismaClient();

interface SeedArticle {
  title: string;
  summary: string;
  content: string;
  feature: string;
  productArea: 'SG_CORE' | 'SG_MODULES' | 'SG_DASHBOARD';
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  tags: string[];
  steps: { order: number; title: string; content: string }[];
  prerequisites?: string[];
  related?: string[];
}

const SEED_ARTICLES: SeedArticle[] = [
  {
    title: 'Create your first SGEN page',
    summary: 'Add a new page to your SGEN site using the Pages & Posts module.',
    content:
      'Pages in SGEN are the building blocks of your site. This walkthrough shows you how to create one from the dashboard.',
    feature: 'Pages & Posts',
    productArea: 'SG_CORE',
    difficulty: 'BEGINNER',
    tags: ['pages', 'getting-started', 'content'],
    steps: [
      {
        order: 0,
        title: 'Open Pages & Posts',
        content: 'From the SGEN dashboard, click **Content → Pages & Posts** in the sidebar.',
      },
      {
        order: 1,
        title: 'Click "New page"',
        content: 'Top-right of the listing screen, click the red **New page** button.',
      },
      {
        order: 2,
        title: 'Pick a layout',
        content: 'Choose a starter layout, or click **Blank** to start with an empty canvas.',
      },
      {
        order: 3,
        title: 'Save and publish',
        content:
          'Give your page a title and URL slug, then click **Save** to keep it as a draft, or **Publish** to make it live.',
      },
    ],
  },
  {
    title: 'Build a contact form with the Forms module',
    summary: 'Drop a contact form onto any page and route submissions to your inbox.',
    content:
      'The Forms module ships with a flexible form builder. You can create contact forms, surveys, and lead-gen forms without writing code.',
    feature: 'Forms',
    productArea: 'SG_MODULES',
    difficulty: 'BEGINNER',
    tags: ['forms', 'lead-capture', 'modules'],
    steps: [
      {
        order: 0,
        title: 'Enable the Forms module',
        content: 'Navigate to **Modules → Forms** and toggle it on.',
      },
      {
        order: 1,
        title: 'Create a new form',
        content: 'Click **New form**, give it a name, and add Name, Email, Message fields.',
      },
      {
        order: 2,
        title: 'Set the recipient email',
        content:
          'Under **Notifications**, enter the email address where submissions should be sent.',
      },
      {
        order: 3,
        title: 'Drop it on a page',
        content: 'Open the Page Builder, drag the **Form** block in, and pick your form.',
      },
    ],
    related: ['Create your first SGEN page'],
  },
  {
    title: 'Configure your site domain in Site Manager',
    summary: 'Point a custom domain at your SGEN site.',
    content:
      'Once you have purchased a domain from your registrar, you can connect it to your SGEN site in a few minutes from Site Manager.',
    feature: 'Site Manager',
    productArea: 'SG_DASHBOARD',
    difficulty: 'INTERMEDIATE',
    tags: ['domains', 'dns', 'site-manager'],
    steps: [
      {
        order: 0,
        title: 'Open Site Manager',
        content: 'From the dashboard sidebar, click **Site Manager**.',
      },
      {
        order: 1,
        title: 'Go to the Domains tab',
        content: 'Click the **Domains** tab and then **Add domain**.',
      },
      {
        order: 2,
        title: 'Add CNAME and A records',
        content:
          'Copy the CNAME and A record values SGEN provides and add them to your DNS provider.',
      },
      {
        order: 3,
        title: 'Wait for propagation',
        content:
          'DNS changes take up to 24 hours. SGEN auto-provisions an SSL certificate once the records resolve.',
      },
    ],
  },
  {
    title: 'Upload and organize images in the Media Library',
    summary: 'Store, search, and tag images so you can reuse them across pages.',
    content:
      'The SGEN Media Library is a centralized store for images, videos, and documents. Anything you upload is available to use on any page or post.',
    feature: 'Media Library',
    productArea: 'SG_CORE',
    difficulty: 'BEGINNER',
    tags: ['media', 'images', 'assets'],
    steps: [
      {
        order: 0,
        title: 'Open Media Library',
        content: 'Click **Content → Media Library** in the sidebar.',
      },
      {
        order: 1,
        title: 'Drag and drop files',
        content: 'Drop files anywhere on the library grid, or click **Upload** to browse.',
      },
      {
        order: 2,
        title: 'Tag for search',
        content:
          'Click a file thumbnail, then add tags in the right panel so you can find it later.',
      },
    ],
  },
  {
    title: 'Set up SEO meta tags on a page',
    summary: 'Control how your pages appear in Google and social previews.',
    content:
      'The SEO & Performance module lets you set per-page titles, descriptions, and Open Graph metadata.',
    feature: 'SEO & Performance',
    productArea: 'SG_MODULES',
    difficulty: 'INTERMEDIATE',
    tags: ['seo', 'metadata', 'open-graph'],
    steps: [
      {
        order: 0,
        title: 'Open the page editor',
        content: 'Open the page you want to edit from **Content → Pages & Posts**.',
      },
      {
        order: 1,
        title: 'Click the SEO tab',
        content: 'In the right inspector, click **SEO**.',
      },
      {
        order: 2,
        title: 'Fill in title and description',
        content:
          'Set the SEO title (50-60 chars) and meta description (150-160 chars). Add an OG image too.',
      },
    ],
    prerequisites: ['Create your first SGEN page'],
  },
  {
    title: 'Promote a stage build to live',
    summary: 'Test changes on stage and ship them when ready.',
    content:
      'SGEN keeps a separate Stage environment so you can preview changes before customers see them.',
    feature: 'Stage & Live',
    productArea: 'SG_DASHBOARD',
    difficulty: 'ADVANCED',
    tags: ['stage', 'deploy', 'live'],
    steps: [
      {
        order: 0,
        title: 'Switch to the Stage environment',
        content: 'Top-right of the dashboard, use the env switcher to pick **Stage**.',
      },
      {
        order: 1,
        title: 'Make and review changes',
        content: 'Edit pages, content, settings — everything is scoped to Stage.',
      },
      {
        order: 2,
        title: 'Promote to Live',
        content:
          'Open **Site Manager → Stage & Live**, click **Promote**, and review the diff before confirming.',
      },
    ],
    prerequisites: ['Configure your site domain in Site Manager'],
  },
  {
    title: 'Track conversions with Attributions',
    summary: 'Tie form submissions and purchases back to traffic sources.',
    content:
      'Attributions captures UTM parameters and referrers across the customer journey so you know which campaigns drive results.',
    feature: 'Attributions',
    productArea: 'SG_MODULES',
    difficulty: 'ADVANCED',
    tags: ['analytics', 'attribution', 'utm'],
    steps: [
      {
        order: 0,
        title: 'Enable Attributions',
        content: 'Go to **Modules → Attributions** and toggle it on.',
      },
      {
        order: 1,
        title: 'Tag your campaigns',
        content: 'Use UTM links in your campaigns. SGEN records them on first touch.',
      },
      {
        order: 2,
        title: 'Review reports',
        content:
          'In **Dashboard → Analytics → Attributions** see source, medium, and campaign breakdowns.',
      },
    ],
    related: ['Build a contact form with the Forms module'],
  },
  {
    title: 'Invite team members to your SGEN site',
    summary: 'Add editors with scoped permissions.',
    content:
      'You can invite teammates to collaborate on your SGEN site without giving them full admin access.',
    feature: 'Users',
    productArea: 'SG_CORE',
    difficulty: 'BEGINNER',
    tags: ['users', 'permissions', 'team'],
    steps: [
      {
        order: 0,
        title: 'Open Users',
        content: 'From the dashboard, click **Users**.',
      },
      {
        order: 1,
        title: 'Invite by email',
        content: 'Click **Invite** and enter the teammate\'s email and role.',
      },
      {
        order: 2,
        title: 'They accept the email',
        content:
          'Your teammate clicks the link in the email to set their password and finish signup.',
      },
    ],
  },
];

const CATEGORIES = [
  { name: 'Getting Started', slug: 'getting-started' },
  { name: 'Content Management', slug: 'content-management' },
  { name: 'Modules', slug: 'modules' },
  { name: 'Dashboard & Admin', slug: 'dashboard-admin' },
  { name: 'Advanced', slug: 'advanced' },
];

async function setEmbeddingRaw(articleId: string, text: string) {
  const { vector, model } = await generateEmbedding(text);
  await prisma.$executeRawUnsafe(
    `UPDATE "Article" SET "embedding" = $1::vector, "embeddingModel" = $2 WHERE id = $3`,
    toPgVector(vector),
    model,
    articleId,
  );
}

async function main() {
  console.log('[seed] Cleaning existing data...');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "_ArticleTags" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "_Prerequisites" CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "_RelatedArticles" CASCADE');
  await prisma.step.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.botQuery.deleteMany();
  await prisma.uploadJob.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.user.deleteMany();

  console.log('[seed] Creating admin user...');
  const hashed = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@sgen.local',
      password: hashed,
      name: 'SGEN Admin',
      role: 'SUPER_ADMIN',
    },
  });

  console.log('[seed] Creating categories...');
  for (const cat of CATEGORIES) {
    await prisma.category.create({ data: cat });
  }

  console.log('[seed] Creating articles (with embeddings — this calls OpenAI)...');
  const titleToId = new Map<string, string>();

  for (const seed of SEED_ARTICLES) {
    const slug = baseSlug(seed.title);
    const tagRecords = await Promise.all(
      seed.tags.map((name) =>
        prisma.tag.upsert({ where: { name }, create: { name }, update: {} }),
      ),
    );

    const article = await prisma.article.create({
      data: {
        title: seed.title,
        slug,
        summary: seed.summary,
        content: seed.content,
        feature: seed.feature,
        productArea: seed.productArea,
        difficulty: seed.difficulty,
        status: 'PUBLISHED',
        authorId: admin.id,
        reviewedAt: new Date(),
        reviewedBy: admin.id,
        tags: { connect: tagRecords.map((t) => ({ id: t.id })) },
        steps: { create: seed.steps },
      },
    });
    titleToId.set(seed.title, article.id);

    await setEmbeddingRaw(
      article.id,
      [seed.title, seed.summary, seed.content, seed.tags.join(' ')].join('\n\n'),
    );

    console.log(`  ✓ ${seed.title}`);
  }

  console.log('[seed] Wiring prerequisites and related links...');
  for (const seed of SEED_ARTICLES) {
    const id = titleToId.get(seed.title);
    if (!id) continue;

    const prereqIds = (seed.prerequisites ?? [])
      .map((t) => titleToId.get(t))
      .filter((x): x is string => Boolean(x));
    const relIds = (seed.related ?? [])
      .map((t) => titleToId.get(t))
      .filter((x): x is string => Boolean(x));

    if (prereqIds.length || relIds.length) {
      await prisma.article.update({
        where: { id },
        data: {
          prerequisites: { connect: prereqIds.map((pid) => ({ id: pid })) },
          relatedTo: { connect: relIds.map((pid) => ({ id: pid })) },
        },
      });
    }
  }

  console.log('[seed] Creating one API key...');
  const { plaintext, hashed: hashedKey, prefix } = generateApiKey();
  await prisma.apiKey.create({
    data: {
      name: 'Default bot key (seed)',
      hashedKey,
      prefix,
    },
  });

  console.log('');
  console.log('===========================================');
  console.log(' Admin login: admin@sgen.local / admin123');
  console.log(' API key (save now — shown once):');
  console.log(' ', plaintext);
  console.log('===========================================');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
