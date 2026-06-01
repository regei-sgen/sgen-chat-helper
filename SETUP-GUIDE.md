# SGEN Knowledge Base + AI Help Bot — Complete Setup Guide

> A monorepo that runs: an **internal dashboard** for managing structured SGEN documentation, a **public Bot API** an extension/widget can call, an **AI chat** that answers questions with interactive step-by-step walkthroughs, and an **animated knowledge graph**. Markdown is structured into articles, embedded **locally** (MiniLM, no API key), and served via hybrid (vector + full‑text) search with an AI rerank.
>
> This guide takes a brand‑new machine from zero to a running app, and bakes in every gotcha we actually hit.

**Default login after seeding:** `admin@sgen.local` / `admin123`

---

## 0. For a Claude Code agent following this

You can run every numbered shell step below. Three steps need a **human** (flagged 👤):
- Installing **Docker Desktop** and **Node 20+**
- **Logging in** the `claude` CLI (`claude` provider login — the bot's AI runs through it)
- The **hosts‑file** step (Windows Administrator) — only if you want the custom domain

Do **not** select "Gemini" anywhere in Settings → AI Providers (see §6) — its free quota is exhausted and it silently breaks answers. Keep the AI provider on **`claude-code`**.

---

## 1. Architecture & ports

| Piece | Tech | Where | Port |
|---|---|---|---|
| **API** | Fastify (`apps/api`) | local Node | `:3001` |
| **Dashboard** | Vue 3 + Vite (`apps/web`) | local Node | `:5173` |
| **Upload worker** | BullMQ (`apps/api`) | local Node | — |
| **Postgres + pgvector** | `pgvector/pgvector:pg16` | Docker | `127.0.0.1:5433` |
| **Redis** | `redis:7-alpine` | Docker | `127.0.0.1:6379` |
| **Adminer** (DB UI) | `adminer:4` | Docker | `127.0.0.1:8090` |
| **Prisma Studio** (optional) | `prisma studio` | local Node | `:5555` |

- **Embeddings run locally** (`@xenova/transformers`, MiniLM‑L6‑v2, 384‑dim). First seed/upload downloads a ~25 MB model into `node_modules`, then it's fully offline. **No embedding API key needed.**
- **The chat AI** (router/rerank/compose) runs through the **local `claude` CLI** (`claude-code` provider) — no API key, no rate limit.

---

## 2. Prerequisites (👤 install these first)

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20** | `node -v`. Use the Windows installer or `nvm`. |
| **Docker Desktop** | Must be **running** before setup. Provides Postgres + Redis. https://www.docker.com/products/docker-desktop |
| **Claude Code CLI** (`claude`) | Required for the AI. Install it and **log in** (`claude` uses `~/.claude/.credentials.json`). Verify: `claude --version`. This is how the bot gets unlimited, key‑free AI. |
| **Git** | To clone the repo. |
| **GNU make** *(optional)* | Enables the `make …` shortcuts. Everything also works with plain `npm`. Windows: install via Chocolatey/Scoop, or skip it. |
| **Chrome ≥ 116** | To use the dashboard. |

---

## 3. Choose your environment

### ✅ Path A — Windows native (recommended; this is what's tested)

Run **everything from a Windows terminal** (PowerShell or `cmd`). Docker Desktop supplies the database. **Do not run the app from inside WSL/Ubuntu** — the installed `node_modules` (e.g. `sharp`, the ONNX embedding runtime) are compiled for **Windows** and will crash under Linux, and WSL won't see your Windows hosts file or `make`.

### Path B — Linux or WSL2 (Ubuntu)

Fully supported, but it's a **separate, fresh install** (you cannot reuse Windows `node_modules`):
1. Clone into the **Linux filesystem** (`~/projects/...`, **not** `/mnt/c/...` — `/mnt/c` is slow and causes file‑watch issues).
2. Install Docker (Docker Desktop's WSL integration, or Docker Engine inside WSL).
3. Install **Node 20+** and the **`claude` CLI inside WSL** and log it in there.
4. Run a fresh `npm install` inside WSL (gets Linux binaries).
5. The DB is reachable at `127.0.0.1:5433` from WSL2.
6. The hosts file is Linux's `/etc/hosts` (the Windows `.bat` doesn't apply).

> **Rule:** pick ONE environment and do `npm install` there. Never share `node_modules` between Windows and WSL.

---

## 4. Install — step by step

All commands run from the repo root unless noted. They're identical in PowerShell and bash.

### 4.1 Get the code
```bash
git clone <your-fork> knowledge-base
cd knowledge-base
```

### 4.2 Create the env files
Copy the example and (optionally) edit. The shipped placeholders are fine for **local** use.

PowerShell:
```powershell
Copy-Item .env.example .env
```
macOS/Linux/Git Bash:
```bash
cp .env.example .env
```

`.env` (root) — already-correct defaults; the API actually reads **`apps/api/.env`**, so make sure that one matches:
```ini
DATABASE_URL=postgresql://kb:kb@127.0.0.1:5433/knowledge_base
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<32+ random chars>           # any 16+ chars locally; generate a real one for shared envs
JWT_REFRESH_SECRET=<32+ random chars>
ANTHROPIC_API_KEY=sk-ant-...            # leave the placeholder — the claude-code provider does NOT use a key
OPENAI_API_KEY=sk-...                   # not needed (embeddings are local)
PORT=3001
FRONTEND_URL=http://localhost:5173      # CORS origin(s), comma-separated
NODE_ENV=development
```
> If `apps/api/.env` doesn't exist, copy `.env` to it: the API process loads its env from `apps/api/.env`.
> `apps/web/.env` is optional — by default the dashboard talks to the API on **whatever host it's loaded from**, port 3001.

### 4.3 Install dependencies
```bash
npm install
```

### 4.4 Start the database (Docker) 👤 *(Docker Desktop must be running)*
```bash
docker compose up -d --wait     # or:  make up
```
This starts Postgres (pgvector), Redis, and Adminer, all bound to `127.0.0.1`. Confirm:
```bash
docker compose ps
```

### 4.5 Apply migrations
```bash
npm run db:migrate              # prisma migrate deploy  (or: make migrate)
```

### 4.6 Seed
```bash
npm run db:seed                 # or: make seed
```
This creates the **admin user** (`admin@sgen.local` / `admin123`), sample articles, and **one API key** (printed once — copy it; it's for the public Bot API). The **first run downloads the MiniLM model (~25 MB)** — this is normal and one‑time.

### 4.7 ⭐ Set the AI provider to `claude-code` (CRITICAL)
The bot's smarts (article reranking + answer composition) need a working AI. Use the local Claude CLI:
```bash
npx tsx apps/api/scripts/set-provider.ts claude-code
```
Expected output:
```
[set-provider] structuring = claude-code / sonnet | embeddings = local / Xenova/all-MiniLM-L6-v2
```
> This also resets embeddings to **local MiniLM**. **Do not use Gemini** (see §6).

### 4.8 Run it 👤
```bash
npm run dev                     # API :3001 + dashboard :5173 + upload worker  (or: make run)
```
Leave it running (Ctrl+C stops it). Then open **http://localhost:5173** and sign in with `admin@sgen.local` / `admin123`.

### 4.9 First‑time setup in one shot (optional)
```bash
make setup                      # install + up + migrate + seed
npx tsx apps/api/scripts/set-provider.ts claude-code
make run
```

---

## 5. Publish your content (required for the bot to answer)

**Uploaded/seeded articles land as `DRAFT`, and the bot only searches `PUBLISHED` articles.** If the chat says *"I don't have anything in the knowledge base"* for topics you know exist, your articles are probably drafts.

- **Per article:** open it in the dashboard → **Publish**.
- **Bulk (dashboard):** Articles list → select → bulk **Publish**.
- **Bulk (SQL, local only):**
  ```bash
  docker exec kb-postgres psql -U kb -d knowledge_base -c "UPDATE \"Article\" SET status='PUBLISHED', \"reviewedAt\"=now() WHERE status='DRAFT';"
  ```

---

## 6. The AI provider — read this (it's the #1 source of "it's inaccurate")

The provider is stored in the DB (`Setting` table). Three values matter:
`structuring_provider`, `structuring_model`, `embedding_provider`.

| Provider | Use it? | Why |
|---|---|---|
| **`claude-code`** ✅ | **Yes** | Runs the local `claude` CLI using your Claude login. No API key, no rate limit, unlimited. **This is the correct setting.** |
| `gemini` ❌ | **No** | Free‑tier quota is **exhausted (HTTP 429)**. When selected, the rerank/compose throw and the bot silently falls back to a dumb keyword match → wrong/"no answer" results. |
| `anthropic` / `openai` | Only with a real, funded key | Needs a valid API key in `apps/api/.env` or Settings. |

**Embeddings must stay `local`** (MiniLM). If you switch the embedding provider, the stored 384‑dim article vectors won't match → vector search returns nothing. If that happens, switch back to local and re‑embed:
```bash
npx tsx apps/api/scripts/set-provider.ts claude-code   # resets embeddings to local
npx tsx apps/api/scripts/reembed-once.ts                # re-embeds all articles with MiniLM
```

**Check the live provider any time:**
```bash
docker exec kb-postgres psql -U kb -d knowledge_base -c "SELECT key, value FROM \"Setting\" WHERE key LIKE '%provider%' OR key LIKE '%model%';"
```

> ⚠️ The dashboard **Settings → AI Providers** page lets you change this. If someone flips it to Gemini, the bot breaks. Re‑run the `set-provider` command to fix it.

---

## 7. Optional — custom local domain `sg-help-admin.test`

To serve the app at `http://sg-help-admin.test:5173` instead of `localhost`:

**Windows (👤 Administrator):** double‑click **`map-domain.bat`** in the repo (or run `make hosts` in an elevated terminal). It adds `127.0.0.1  sg-help-admin.test` to your hosts file and flushes DNS. Then open `http://sg-help-admin.test:5173`.

The Vite dev server already allows this host (`apps/web/vite.config.ts` → `allowedHosts`). Verify resolution with `ping sg-help-admin.test` (no `http://`).

**Linux/WSL:** add `127.0.0.1  sg-help-admin.test` to `/etc/hosts` (`sudo`).

---

## 8. Helper scripts (in this repo)

| Script | What it does |
|---|---|
| `npx tsx apps/api/scripts/set-provider.ts claude-code` | Sets the chat AI to the local Claude CLI + resets embeddings to local MiniLM. **Run this once after seeding.** |
| `npx tsx apps/api/scripts/reembed-once.ts` | Re‑embeds every article with local MiniLM (run after changing the embedding provider, or if vector search goes quiet). |
| `map-domain.bat` / `scripts/add-host.ps1` | (Windows, admin) maps `sg-help-admin.test` → `127.0.0.1`. |
| `make help` | Lists all `make` shortcuts. |

---

## 9. Verify it works

1. **API health:** `curl http://localhost:3001/health` → `{"status":"ok",...}`
2. **Dashboard:** http://localhost:5173 → log in (`admin@sgen.local` / `admin123`).
3. **Publish** your articles (§5) if you haven't.
4. **Chat tester** (sidebar → Chat tester): ask *"how do I create a blog post"* → you should get a step‑by‑step walkthrough sourced from a real article. (First AI reply takes a few seconds — the local `claude` CLI is warming up.)
5. **Knowledge graph** (sidebar → Graph → Full screen): edges flow like data in transit; use **"Ask the graph"** and the source article node lights up.
6. **Public Bot API** (uses the seeded `X-API-Key`):
   ```bash
   curl -X POST http://localhost:3001/api/v1/chat \
     -H "X-API-Key: kb_XXXXXXXX" -H "Content-Type: application/json" \
     -d '{"message":"how do I create a page?"}'
   ```

---

## 10. Troubleshooting (every real failure we hit)

| Symptom | Cause → Fix |
|---|---|
| **Chat says "I don't have anything"** for known topics | Articles are **DRAFT**. → Publish them (§5). The bot only searches `PUBLISHED`. |
| **Answers are wrong / pick the wrong article** | AI provider is **Gemini (429)**, so the rerank failed and it fell back to keyword match. → `npx tsx apps/api/scripts/set-provider.ts claude-code` |
| **Vector search returns nothing / weak matches** | Embedding provider was switched away from `local`, so query vectors don't match stored ones. → re‑run `set-provider` then `reembed-once` (§6). |
| **`claude` errors in API logs / `write EOF` on Windows** | The `claude` CLI couldn't launch. Ensure `claude --version` works **and you're logged in**; on Windows set `CLAUDE_CODE_GIT_BASH_PATH` to your Git‑for‑Windows `bash.exe`. |
| **`relation "Article" does not exist`** | Migrations not applied. → `npm run db:migrate` |
| **`extension "vector" is not available`** | Wrong Postgres image. → Ensure Docker uses `pgvector/pgvector:pg16` (it's in `docker-compose.yml`); `docker compose up -d` again. |
| **First embedding/seed is slow** | One‑time ~25 MB MiniLM model download. Subsequent calls are instant. |
| **`make: command not found`** | `make` isn't installed (esp. in WSL). → Use the plain `npm`/`npx`/`docker compose` commands instead. |
| **App crashes when run from WSL (sharp/onnx errors)** | Windows `node_modules` under Linux. → Run from a **Windows** terminal, OR do a fresh `npm install` **inside** WSL (Path B). |
| **`sg-help-admin.test` won't load** | Hosts entry missing. → Run `map-domain.bat` as Administrator; test with `ping sg-help-admin.test` (no `http://`). Until then use `localhost:5173`. |
| **CORS errors from a widget/extension** | The calling origin isn't allowed. → Add it to `FRONTEND_URL` (comma‑separated) in `apps/api/.env` and restart the API. |
| **Port already in use** | Change `PORT` (API) / Vite port, or stop the conflicting process. DB ports are set in `docker-compose.yml`. |

---

## 11. Quick reference

```bash
# Database (Docker)
docker compose up -d --wait      # start Postgres + Redis (+ Adminer)
docker compose down              # stop (keeps data)
docker compose down -v           # DESTROY data volume

# App
npm install                      # install deps (per environment!)
npm run db:migrate               # apply migrations
npm run db:seed                  # admin + sample articles + API key
npm run dev                      # run API + dashboard + worker
npm run db:studio                # Prisma Studio (DB browser :5555)

# AI provider (DO THIS after seed)
npx tsx apps/api/scripts/set-provider.ts claude-code
npx tsx apps/api/scripts/reembed-once.ts        # if vectors get out of sync

# make shortcuts (if installed)
make setup   make run   make up   make down   make migrate   make seed
make studio  make db-ui make hosts(admin)      make help
```

| URL | What |
|---|---|
| http://localhost:5173 | Dashboard (login `admin@sgen.local` / `admin123`) |
| http://localhost:3001/health | API health |
| http://localhost:8090 | Adminer (System PostgreSQL · Server `postgres` · User `kb` · Pass `kb` · DB `knowledge_base`) |

**Golden rules:** (1) run the app from the **same OS** you `npm install`ed in; (2) keep the AI provider on **`claude-code`** and embeddings on **`local`**; (3) **publish** articles before expecting answers.
