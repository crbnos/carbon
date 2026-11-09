// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "pathe";
import { describe, expect, it } from "vitest";
import {
  ISOLATED_STORAGE_TENANT,
  ISOLATED_VOLUMES,
  PG_MAJOR,
  REDIS_DB_MAX,
  SHARED_CONTAINERS,
  SHARED_DB_PORT,
  SHARED_INBUCKET_PORT,
  SHARED_POOLER_PORT,
  SHARED_POSTGRES_VOLUME,
  SHARED_PROJECT,
  SHARED_REDIS_IMAGE,
  SHARED_REDIS_PORT,
  SHARED_REDIS_VOLUME,
  SHARED_STORAGE_ADMIN_PORT,
  SHARED_STORAGE_FILES,
  stackHosts
} from "./topology.js";

// The CLI and the compose files must name the same containers and ports:
// a drift boots fine and then connects to nothing.
const compose = (file: string) =>
  readFileSync(join(__dirname, "../docker", file), "utf8");
const shared = compose("docker-compose.shared.yml");
const isolated = compose("docker-compose.isolated.yml");
const dev = compose("docker-compose.dev.yml");

describe("docker-compose.shared.yml", () => {
  it("publishes the host ports the CLI connects to", () => {
    for (const port of [
      SHARED_DB_PORT,
      SHARED_POOLER_PORT,
      SHARED_INBUCKET_PORT,
      SHARED_STORAGE_ADMIN_PORT,
      SHARED_REDIS_PORT
    ]) {
      expect(shared).toMatch(new RegExp(`"127\\.0\\.0\\.1:${port}:\\d+"`));
    }
  });

  it("names the containers the CLI execs into", () => {
    for (const name of Object.values(SHARED_CONTAINERS)) {
      expect(shared).toMatch(new RegExp(`^ {4}container_name: ${name}$`, "m"));
    }
  });

  it("declares the volumes the CLI checks and creates", () => {
    for (const name of [SHARED_POSTGRES_VOLUME, SHARED_REDIS_VOLUME]) {
      expect(shared).toMatch(new RegExp(`^ {2}${name}:`, "m"));
    }
  });

  it("keeps a Storage tenant's files where the CLI deletes them", () => {
    const [backend, bucket] = [
      shared.match(/FILE_STORAGE_BACKEND_PATH: (\S+)/)?.[1],
      shared.match(/GLOBAL_S3_BUCKET: (\S+)/)?.[1]
    ];
    expect(`${backend}/${bucket}`).toBe(SHARED_STORAGE_FILES);
  });

  it("runs the redis image the CLI reads its volume with", () => {
    expect(shared).toContain(`image: ${SHARED_REDIS_IMAGE}\n`);
  });

  it("starts redis with the slot pool's database count", () => {
    expect(shared).toContain(`\${REDIS_DATABASES:-${REDIS_DB_MAX}}`);
  });
});

describe("docker-compose.isolated.yml", () => {
  it("declares exactly the volumes prune counts as a private stack's", () => {
    const block = isolated.slice(isolated.indexOf("\nvolumes:"));
    const declared = [...block.matchAll(/^ {2}([a-z-]+):/gm)].map((m) => m[1]);
    expect(declared).toEqual(ISOLATED_VOLUMES);
  });

  it("serves the one Storage tenant the env names", () => {
    expect(isolated).toContain(`TENANT_ID: ${ISOLATED_STORAGE_TENANT}\n`);
  });

  it("gives the private services the aliases the env points at", () => {
    const hosts = stackHosts("isolated", "x");
    for (const alias of [hosts.db, hosts.storage, hosts.smtp]) {
      expect(isolated).toMatch(new RegExp(`^ {10}- ${alias}$`, "m"));
    }
  });
});

describe("docker-compose.dev.yml", () => {
  it("aliases the gateway and Inngest the way shared-mode hosts name them", () => {
    // The compose file names them after the slug it interpolates.
    const hosts = stackHosts("shared", ["$", "{CARBON_WORKTREE}"].join(""));
    for (const alias of [hosts.api, hosts.inngest]) {
      expect(dev).toContain(`- ${alias}\n`);
    }
  });
});

describe("PG_MAJOR", () => {
  it("is the Postgres image of the shared and isolated stacks", () => {
    for (const text of [shared, isolated]) {
      expect(text).toMatch(
        new RegExp(`image: supabase/postgres:${PG_MAJOR}\\.`)
      );
    }
  });
});

describe("SHARED_PROJECT", () => {
  it("is outside the carbon-* names orphan cleanup removes", () => {
    expect(SHARED_PROJECT.startsWith("carbon-")).toBe(false);
  });
});
