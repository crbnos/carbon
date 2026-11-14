// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The names and ports the compose files define, as the CLI uses them.
// topology.test.ts reads them back out of docker/*.yml.

export type StackMode = "shared" | "isolated";

// Relative to the repo root. Compose runs with `--project-directory .` so the
// files' `./packages/...` mounts resolve from the root.
export const COMPOSE_DEV_FILE = "packages/dev/docker/docker-compose.dev.yml";
// `crbn up --isolated`: the private Postgres, PgBouncer, Storage, imgproxy and
// Inbucket, added on top of COMPOSE_DEV_FILE.
export const COMPOSE_ISOLATED_FILE =
  "packages/dev/docker/docker-compose.isolated.yml";

// Every worktree project's name starts with it.
export const PROJECT_PREFIX = "carbon-";
export const projectName = (slug: string) => `${PROJECT_PREFIX}${slug}`;

// Not `carbon-*`: crbn's orphan cleanup removes any `carbon-*` project with
// no slot.
export const SHARED_PROJECT = "crbn-shared";
export const SHARED_NETWORK = "carbon-shared";

// docker-compose.shared.yml. Postgres and the pooler match config.toml's
// [db] and [db.pooler].
export const SHARED_DB_PORT = 54322;
export const SHARED_POOLER_PORT = 54329;
export const SHARED_INBUCKET_PORT = 54324;
export const SHARED_STORAGE_ADMIN_PORT = 54326;
export const SHARED_REDIS_PORT = 6379;

export const SHARED_CONTAINERS = {
  postgres: "carbon-postgres",
  storage: "carbon-storage",
  inbucket: "carbon-inbucket",
  redis: "carbon-redis",
  edgeRuntime: "carbon-edge-runtime"
} as const;

/** A tenant's files in the shared Storage: <backend path>/<bucket>/<tenant>. */
export const SHARED_STORAGE_FILES = "/var/lib/storage/stub";
// The image crbn-shared's redis runs, used to read its volume.
export const SHARED_REDIS_IMAGE =
  "redis:7-alpine@sha256:7f7d30b7fdd09467bac58198a1f166dd69789d348d4fe859cccb20e0cf287fbe";

export const SHARED_POSTGRES_VOLUME = "carbon-postgres-data";
export const SHARED_REDIS_VOLUME = "carbon-redis-data";

// One logical redis DB per worktree slot; crbn-shared starts redis with this
// many (REDIS_DATABASES). Redis's own default (16) filled up: a slot is held
// until `crbn remove`, `crbn down --purge` or `crbn prune` releases it.
export const REDIS_DB_MAX = 25;

// The Postgres major of docker-compose.shared.yml and docker-compose.isolated.yml:
// the one the US production project runs.
export const PG_MAJOR = 17;

// A private stack runs the image's own database.
export const ISOLATED_DATABASE = "postgres";

// A private Storage serves one tenant (docker-compose.isolated.yml TENANT_ID).
export const ISOLATED_STORAGE_TENANT = "stub";

// The volumes docker-compose.isolated.yml declares.
export const ISOLATED_VOLUMES = ["pgdata", "pgconfig", "storage", "inbucket"];

/** The hosts a stack's containers reach each other at. */
export function stackHosts(mode: StackMode, slug: string) {
  return mode === "shared"
    ? {
        // Network aliases on carbon-shared (docker-compose.dev.yml). Never a
        // bare service name there: every worktree has a "postgres".
        api: `${slug}-api-gw`,
        inngest: `${slug}-inngest`,
        db: SHARED_CONTAINERS.postgres,
        storage: SHARED_CONTAINERS.storage,
        smtp: SHARED_CONTAINERS.inbucket
      }
    : {
        api: "kong",
        inngest: "inngest",
        db: "local-postgres",
        storage: "local-storage",
        smtp: "local-inbucket"
      };
}

export type StackHosts = ReturnType<typeof stackHosts>;
