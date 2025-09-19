# Makefile for carbon mono-repo (clean upstream boot)
SHELL := /bin/bash
NVM_DIR ?= $(HOME)/.nvm

.PHONY: help upstream-sync upstream-reset nuke install ci clean env db-start db-build dev logs-auth logs-db logs-kong doctor check setup up reset-up ensure-volta which-node db-types db-types-reset

help:
	@echo ""
	@echo "Targets:"
	@echo "  make upstream-reset FORCE=1   - HARD reset to upstream (git reset --hard + git clean -xfd)"
	@echo "  make install                  - npm install for monorepo (workspaces)"
	@echo "  make ci                       - deterministic install (npm ci)"
	@echo "  make clean                    - remove node_modules and build caches"
	@echo "  make env                      - create .env from .env.example if missing"
	@echo "  make db-start                 - start local Supabase (Docker)"
	@echo "  make db-build                 - run DB migrations/setup"
	@echo "  make dev                      - start dev servers"
	@echo "  make logs-auth|logs-db|logs-kong - tail Supabase container logs"
	@echo "  make doctor                   - basic environment diagnostics"
	@echo "  make check                    - quick checks (node/npm versions, zod duplicates)"
	@echo "  make setup                    - bin/setup-like one-shot (ci + env + db-start + db-build)"
	@echo "  make up                       - setup + dev"
	@echo "  make reset-up FORCE=1         - HARD reset + setup + dev"
	@echo "  make ensure-volta             - install Volta if missing (Darwin/Linux)"
	@echo "  make db-types                 - regenerate Supabase TS types via @carbon/database workspace"
	@echo "  make db-types-reset           - restore generated DB files to upstream"
	@echo ""

# -------------------------------------------------------------------
# Tool detection + Node env bootstrap (Volta -> nvm -> system Node)
# -------------------------------------------------------------------

HAS_VOLTA := $(shell command -v volta >/dev/null 2>&1 && echo 1 || echo 0)
HAS_NVM   := $(shell [ -s "$(NVM_DIR)/nvm.sh" ] && echo 1 || echo 0)

# Automatically install Volta if missing (for non-interactive shells)
# Set VOLTA_AUTO=0 to skip auto-install.
VOLTA_AUTO ?= 1

define _TRY_INSTALL_VOLTA
	if [ "$(VOLTA_AUTO)" = "1" ] && [ "$(HAS_VOLTA)" = "0" ]; then \
	  echo "⬇️  Installing Volta (requires curl) ..."; \
	  if command -v curl >/dev/null 2>&1; then \
	    curl https://get.volta.sh | bash; \
	  else \
	    echo "❌ curl not found. Install Volta manually: https://volta.sh"; \
	  fi; \
	fi
endef

define NODE_ENV_SETUP
	@set -e; \
	$(call _TRY_INSTALL_VOLTA); \
	# Ensure Volta bin is on PATH for THIS make process:
	export PATH="$$HOME/.volta/bin:$$PATH"; \
	if command -v volta >/dev/null 2>&1; then \
	  echo "🔧 Using Volta-pinned Node/npm"; \
	elif [ -s "$(NVM_DIR)/nvm.sh" ]; then \
	  echo "🔧 Using nvm (.nvmrc)"; \
	  . "$(NVM_DIR)/nvm.sh"; nvm use >/dev/null; \
	else \
	  echo "⚠️  No Volta/nvm detected — using system Node"; \
	fi
endef

ensure-volta:
	@$(call _TRY_INSTALL_VOLTA)
	@export PATH="$$HOME/.volta/bin:$$PATH"; \
	 command -v volta >/dev/null 2>&1 && echo "✅ Volta: $$(volta --version)" || echo "⚠️  Volta not installed"

# -------------------------------------------------------------------
# 1) Reset repo to clean upstream state
# -------------------------------------------------------------------
upstream-reset:
	@if [ "$(FORCE)" != "1" ]; then \
	  echo "❌ This operation will REMOVE LOCAL CHANGES and UNTRACKED FILES."; \
	  echo "   Run: make upstream-reset FORCE=1"; \
	  exit 1; \
	fi
	@git reset --hard
	@git clean -xfd
	@echo "✅ Repo cleaned to upstream HEAD"

# -------------------------------------------------------------------
# 1.1) Reset repo to clean upstream state
# -------------------------------------------------------------------

upstream-sync:
	@bash scripts/upstream-sync.sh

# -------------------------------------------------------------------
# 2) Deep cleanup of local artifacts
# -------------------------------------------------------------------
nuke: clean
	@rm -rf package-lock.json
	@echo "🧨 Removed package-lock.json (a fresh dependency install will require 'make install')"

clean:
	@find . -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
	@rm -rf .turbo .vite .wrangler .cache
	@echo "🧹 Removed node_modules and build caches"

which-node:
	@$(NODE_ENV_SETUP)
	@echo "node:  $$(command -v node)"
	@echo "npm:   $$(command -v npm)"
	@node -v && npm -v

# -------------------------------------------------------------------
# 3) Dependencies
# -------------------------------------------------------------------
install:
	$(NODE_ENV_SETUP)
	@npm install --workspaces --include-workspace-root
	@echo "✅ npm install (workspaces) done"

ci:
	$(NODE_ENV_SETUP)
	@npm ci
	@echo "✅ npm ci done"

# -------------------------------------------------------------------
# 4) .env
# -------------------------------------------------------------------
env:
	@test -f .env || cp .env.example .env
	@echo "ℹ️  Check your .env and fill required keys: SUPABASE_* , UPSTASH_* (or stubs/local services)."

# -------------------------------------------------------------------
# 5) Database (local Supabase)
# -------------------------------------------------------------------
db-start:
	$(NODE_ENV_SETUP)
	@npm run db:start

db-build:
	$(NODE_ENV_SETUP)
	@npm run db:build

# -------------------------------------------------------------------
# 6) Dev server
# -------------------------------------------------------------------
dev:
	$(NODE_ENV_SETUP)
	@npm run dev

# -------------------------------------------------------------------
# 7) Supabase container logs (service names may vary — use 'docker ps' to confirm)
# -------------------------------------------------------------------
logs-auth:
	@docker compose logs -f supabase-auth

logs-db:
	@docker compose logs -f supabase-db

logs-kong:
	@docker compose logs -f supabase-kong

# -------------------------------------------------------------------
# 8) Diagnostics
# -------------------------------------------------------------------
doctor:
	@echo "Node:     $$(node -v 2>/dev/null || echo 'not found')"
	@echo "npm:      $$(npm -v 2>/dev/null || echo 'not found')"
	@echo "volta:    $$(command -v volta >/dev/null 2>&1 && volta --version || echo 'not found')"
	@echo "nvm:      $$(command -v nvm >/dev/null 2>&1 && nvm --version || echo 'not found')"
	@echo "docker:   $$(command -v docker >/dev/null 2>&1 && docker -v || echo 'not found')"
	@echo "compose:  $$(command -v docker >/dev/null 2>&1 && docker compose version || echo 'not found')"

check:
	$(NODE_ENV_SETUP)
	@npm -v && node -v
	@echo "🔎 zod tree:"
	-@npm ls zod || true
	@echo "🔎 picomatch origins:"
	-@npm why picomatch || true

# -------------------------------------------------------------------
# Supabase types generation (via @carbon/database workspace)
# -------------------------------------------------------------------
DB_PKG := @carbon/database
DB_TYPES_SRC := packages/database/src/types.ts
DB_TYPES_COPY := packages/database/supabase/functions/lib/types.ts
SWAGGER_SCHEMA := packages/database/src/swagger-docs-schema.ts

db-types:
	$(NODE_ENV_SETUP)
	@echo "🛠  Generating Supabase TS types via workspace $(DB_PKG)…"
	@npm run -w $(DB_PKG) db:types
	@mkdir -p $$(dirname $(DB_TYPES_COPY))
	@cp $(DB_TYPES_SRC) $(DB_TYPES_COPY)
	@echo "✅ Regenerated types:"
	@echo "   - $(DB_TYPES_SRC)"
	@echo "   - $(DB_TYPES_COPY)"

db-types-reset:
	@git restore -- $(SWAGGER_SCHEMA) $(DB_TYPES_SRC) $(DB_TYPES_COPY)
	@echo "♻️  Reset generated DB files to upstream"

# -------------------------------------------------------------------
# bin/setup-like flows
# -------------------------------------------------------------------
setup: ci env db-start db-build
	@echo "✅ Setup done. Run 'make dev' to start servers."

up: setup
	$(MAKE) dev

reset-up:
	@if [ "$(FORCE)" != "1" ]; then \
	  echo "❌ This will wipe local changes. Run: make reset-up FORCE=1"; \
	  exit 1; \
	fi
	$(MAKE) upstream-reset FORCE=1
	$(MAKE) up
