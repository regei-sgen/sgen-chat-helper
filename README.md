# SGEN Knowledge Base + AI Documentation Assistant

A monorepo that powers (1) an internal knowledge base dashboard for managing structured documentation about the SGEN platform (a WordPress alternative) and (2) a public Bot API consumed by a browser-extension chatbot. Uploaded markdown files are processed by Claude (sonnet-4-5) into structured articles, embedded **locally** with `@xenova/transformers` (MiniLM-L6-v2, 384-dim, no API key required), and served back via hybrid (vector + full-text) search.

## Prerequisites

- Node.js 20+
- Docker Desktop (for Postgres + Redis) — https://www.docker.com/products/docker-desktop
- An Anthropic API key — https://console.anthropic.com

> Embeddings run locally in the API process via `@xenova/transformers`. The first time you seed or upload, it downloads a ~25 MB ONNX model into `node_modules/@xenova/transformers/.cache` — after that, everything is offline. No OpenAI key needed.

## Quick start

```bash
git clone <your-fork>
cd knowledge-base
# copy env file — pick the line for your shell:
cp .env.example .env                # macOS / Linux / Git Bash
copy .env.example .env              # Windows cmd
Copy-Item .env.example .env         # Windows PowerShell
# then fill in ANTHROPIC_API_KEY + OPENAI_API_KEY in .env
npm install
npm run db:up          # starts pgvector + redis via docker compose
npm run db:migrate     # applies prisma migrations
npm run db:seed        # seeds admin + sample articles + 1 api key (printed)
npm run dev            # starts api (3001) and web (5173) concurrently
```

**URLs**

| Service   | URL                              |
| --------- | -------------------------------- |
| Dashboard | http://sg-help-admin.test:5173   |
| API       | http://sg-help-admin.test:3001   |
| Healthz   | http://sg-help-admin.test:3001/health |

> **Local domain.** The app runs on `sg-help-admin.test`. Map it to your loopback **once** (Administrator terminal): `make hosts` — or add `127.0.0.1  sg-help-admin.test` to `C:\Windows\System32\drivers\etc\hosts` by hand. `localhost` still works too (CORS allows both).

**Default login**

```
Email:    admin@sgen.local
Password: admin123
```

The seed script prints a generated API key to stdout — copy it; the plaintext value is shown once.

## How the upload pipeline works

```
                    ┌───────────────────┐
   .md file(s) ───▶│  POST /articles/  │
                    │  upload or        │
                    │  upload-bulk      │
                    └────────┬──────────┘
                             │
              ┌──────────────┴───────────────┐
              │                              │
              ▼ single                       ▼ bulk
   ┌────────────────────┐         ┌────────────────────┐
   │ inline processing  │         │ BullMQ "uploads"   │
   │ (Claude → embed)   │         │ queue              │
   └────────┬───────────┘         └──────────┬─────────┘
            │                                 │
            │                                 ▼
            │              ┌──────────────────────────────┐
            │              │ upload-processor worker      │
            │              │  • Claude structureArticle() │
            │              │  • OpenAI generateEmbedding()│
            │              │  • prisma.article.create()   │
            │              │  • UploadJob.progress++      │
            │              └──────────────┬───────────────┘
            ▼                              ▼
   ┌─────────────────────────────────────────────────┐
   │  Article saved as DRAFT (with vector embedding) │
   └────────────────────┬────────────────────────────┘
                        │
                        ▼
              Editor reviews on
              /articles/:id/review
                        │
                        ▼
                   POST /publish
                        │
                        ▼
        ┌──────────────────────────────┐
        │ Hybrid search index live in  │
        │   POST /api/v1/query         │
        └──────────────────────────────┘
```

## Bot API usage

```bash
# Public query (browser extension calls this)
curl -X POST http://sg-help-admin.test:3001/api/v1/query \
  -H "X-API-Key: kb_XXXXXXXXXXXXXXXXXXXXXXXX" \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I create a new page in SGEN?"}'

# Fetch published article by slug
curl http://sg-help-admin.test:3001/api/v1/articles/create-a-page \
  -H "X-API-Key: kb_XXXXXXXXXXXXXXXXXXXXXXXX"

# Submit user feedback
curl -X POST http://sg-help-admin.test:3001/api/v1/feedback \
  -H "X-API-Key: kb_XXXXXXXXXXXXXXXXXXXXXXXX" \
  -H "Content-Type: application/json" \
  -d '{"queryId": "ckxxx...", "helpful": true}'
```

## Folder structure

```
knowledge-base/
├── apps/
│   ├── api/                       # Fastify backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── server.ts          # Fastify entry
│   │       ├── plugins/           # auth/cors/rate-limit
│   │       ├── routes/            # auth, articles, graph, …
│   │       ├── middleware/        # auth, apiKey, errors
│   │       ├── services/          # structure, embedding, search, upload-processor
│   │       ├── lib/               # prisma, redis, queue
│   │       └── worker.ts          # BullMQ worker entry
│   └── web/                       # Vue 3 dashboard
│       ├── index.html
│       └── src/
│           ├── main.ts
│           ├── App.vue
│           ├── router/
│           ├── stores/            # Pinia (auth, articles, upload, toast)
│           ├── api/               # typed fetch client
│           ├── components/        # AppLayout, Button, GraphView, …
│           ├── views/             # routed pages
│           └── styles/            # tailwind entry
├── packages/
│   └── shared/                    # Zod schemas + TS types
│       └── src/
├── docker-compose.yml
├── .env.example
├── package.json                   # workspaces root
├── tsconfig.base.json
└── README.md
```

## Scripts (root)

| Script               | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Start API (3001) and Web (5173) concurrently    |
| `npm run dev:api`    | API only                                        |
| `npm run dev:web`    | Web only                                        |
| `npm run build`      | Build all workspaces                            |
| `npm run db:up`      | docker compose up -d (postgres + redis)         |
| `npm run db:down`    | docker compose down                             |
| `npm run db:migrate` | Apply prisma migrations                         |
| `npm run db:seed`    | Seed admin user + sample articles + 1 API key   |
| `npm run db:studio`  | Open Prisma Studio                              |
| `npm run lint`       | ESLint over the whole repo                      |
| `npm run format`     | Prettier-format the whole repo                  |

## Architecture notes

- **Claude structuring** (`apps/api/src/services/structure.ts`) sends raw markdown plus a list of existing article titles, so it can suggest prerequisite / related links. Output is strict JSON.
- **Embeddings** (`apps/api/src/services/embedding.ts`) — local `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`, 384 dims. Stored on `Article.embedding` (pgvector type). Loaded lazily on first use; cached on disk thereafter.
- **Hybrid search** (`apps/api/src/services/search.ts`) — cosine similarity (pgvector `<=>` operator) combined with Postgres `ts_rank` over title+summary via Reciprocal Rank Fusion.
- **Auth** — JWT access (15 m) + refresh (7 d). bcrypt for password hashing.
- **Bot API auth** — `X-API-Key` header. Keys are SHA-256 hashed in DB; plaintext shown once at creation.
- **Rate limiting** — 100 req/min per API key on `/api/v1/*`.

## Troubleshooting

| Symptom                                       | Fix                                                    |
| --------------------------------------------- | ------------------------------------------------------ |
| `relation "Article" does not exist`           | `npm run db:migrate`                                   |
| `extension "vector" is not available`         | Ensure docker is using `pgvector/pgvector:pg16`        |
| `INVALID_API_KEY` from `/api/v1/*`            | Generate one via dashboard → API Keys (or seed output) |
| Anthropic 401                                 | Check `ANTHROPIC_API_KEY` in `.env`                    |
| First embedding is slow                       | Initial model download (~25 MB); subsequent calls fast |
