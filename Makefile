# Makefile for the SGEN Knowledge Base
# A convenience wrapper around the npm + docker scripts.
#
# Run these from THIS folder in a Windows terminal (PowerShell / cmd) — NOT inside WSL.
# Requires: Docker Desktop running, Node 20+, and GNU make.
#
# The app is served on the custom local domain http://sg-help-admin.test
#   Dashboard -> http://sg-help-admin.test:5173    API -> http://sg-help-admin.test:3001
# Run `make hosts` ONCE from an Administrator terminal to map the domain to 127.0.0.1.
#
# Quick start:   make hosts (as admin)   →   make setup   →   make run

.DEFAULT_GOAL := help

# ---------- Day-to-day ----------

.PHONY: run
run: ## Start API (:3001) + dashboard (:5173) + upload worker — Ctrl+C to stop
	npm run dev

.PHONY: dev
dev: run ## Alias for "run"

.PHONY: api
api: ## Start only the API (:3001)
	npm run dev:api

.PHONY: web
web: ## Start only the dashboard (:5173)
	npm run dev:web

.PHONY: worker
worker: ## Start ONLY the upload worker (it is already included in `make run`)
	npm run dev:worker -w apps/api

# ---------- Database / containers ----------

.PHONY: up
up: ## Start Postgres + Redis and wait until they are healthy
	docker compose up -d --wait

.PHONY: down
down: ## Stop Postgres + Redis (data is kept)
	docker compose down

.PHONY: migrate
migrate: ## Apply database migrations
	npm run db:migrate

.PHONY: seed
seed: ## Seed admin user + sample articles + one API key
	npm run db:seed

.PHONY: studio
studio: ## Open Prisma Studio (visual DB browser, :5555)
	npm run db:studio

.PHONY: db-ui
db-ui: ## Start Adminer, the browser DB admin (http://sg-help-admin.test:8090)
	docker compose up -d adminer
	@echo Adminer is running at http://sg-help-admin.test:8090
	@echo Login -- System: PostgreSQL  Server: postgres  User: kb  Password: kb  DB: knowledge_base

.PHONY: ps
ps: ## Show container status
	docker compose ps

.PHONY: logs
logs: ## Tail container logs (Ctrl+C to stop)
	docker compose logs -f

# ---------- Bootstrap / maintenance ----------

.PHONY: hosts
hosts: ## (Run in an ADMIN terminal) Map sg-help-admin.test -> 127.0.0.1 in your hosts file
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/add-host.ps1

.PHONY: install
install: ## Install npm dependencies
	npm install

.PHONY: setup
setup: install up migrate seed ## One-shot first-time setup: install, start DB, migrate, seed
	@echo Setup complete. Now run: make run
	@echo First time on this machine? Run once as Administrator: make hosts
	@echo Then open the dashboard at http://sg-help-admin.test:5173

.PHONY: reset
reset: ## DESTRUCTIVE: wipe the DB volume, then recreate + migrate + seed
	docker compose down -v
	docker compose up -d --wait
	npm run db:migrate
	npm run db:seed

# ---------- Quality ----------

.PHONY: build
build: ## Build all workspaces
	npm run build

.PHONY: lint
lint: ## Lint the whole repo
	npm run lint

.PHONY: format
format: ## Prettier-format the whole repo
	npm run format

# ---------- Help ----------

.PHONY: help
help: ## Show this list of commands
	@echo SGEN Knowledge Base -- make targets:
	@echo   Dashboard: http://sg-help-admin.test:5173   API: http://sg-help-admin.test:3001
	@echo   make hosts      (admin, once) point sg-help-admin.test at 127.0.0.1 in your hosts file
	@echo   make setup      first-time setup: install deps, start DB, migrate, seed
	@echo   make run        start API + dashboard + upload worker (the main one)
	@echo   make up         start Postgres + Redis containers
	@echo   make down       stop the containers (keeps data)
	@echo   make migrate    apply database migrations
	@echo   make seed       load admin user + sample articles + API key
	@echo   make studio     open Prisma Studio (DB browser, :5555)
	@echo   make db-ui      start Adminer browser DB admin (:8090)
	@echo   make worker     run ONLY the upload worker (already part of make run)
	@echo   make ps         show container status
	@echo   make logs       tail container logs
	@echo   make reset      DESTRUCTIVE wipe + rebuild the database
	@echo   make build      build all workspaces
	@echo   make lint       lint the repo
	@echo   make format     format the repo
