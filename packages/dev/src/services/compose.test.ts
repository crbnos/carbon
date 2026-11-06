// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, describe, expect, it } from "vitest";
import { REDIS_DB_MAX, writeStackMode } from "../worktree.js";
import {
  buildDownArgs,
  buildUpArgs,
  PG_MAJOR,
  redisDatabasesNeeded,
  redisDatabasesOf,
  SHARED_PROJECT,
  sharedComposeEnv,
  teardownExitCode
} from "./compose.js";

// The teardown itself talks to Docker and isn't unit-testable. The argv is.
// A `down` missing a profile exits 0 having left those containers running;
// they accumulate until a Docker restart turns them into a stale-network boot
// failure ("network <id> not found").

const ROOT = "/tmp/carbon-worktree";
const SLUG = "carbon-test";

/** Values of every `--profile <name>` pair in an argv array. */
function profilesIn(args: string[]): string[] {
  return args.flatMap((arg, i) => {
    const value = args[i + 1];
    return arg === "--profile" && value !== undefined ? [value] : [];
  });
}

describe("buildDownArgs", () => {
  it("enables every profile that buildUpArgs can enable", () => {
    const bootable = new Set([
      ...profilesIn(buildUpArgs(ROOT, SLUG)),
      ...profilesIn(buildUpArgs(ROOT, SLUG, { full: true })),
      ...profilesIn(buildUpArgs(ROOT, SLUG, { studio: true })),
      ...profilesIn(buildUpArgs(ROOT, SLUG, { minimal: true }))
    ]);
    const tearable = new Set(profilesIn(buildDownArgs(ROOT, SLUG, false)));

    for (const profile of bootable) {
      expect(
        tearable.has(profile),
        `up can boot --profile ${profile} but down never enables it — those containers would survive teardown`
      ).toBe(true);
    }
  });

  it("covers the profile-gated services by name", () => {
    // Stops the union test passing vacuously. full = studio/meta/inbucket.
    expect(profilesIn(buildDownArgs(ROOT, SLUG, false))).toEqual(
      expect.arrayContaining(["full"])
    );
  });

  it("preserves volumes unless explicitly asked to remove them", () => {
    // A stray -v destroys a developer's local database.
    expect(buildDownArgs(ROOT, SLUG, false)).not.toContain("-v");
    expect(buildDownArgs(ROOT, SLUG, true)).toContain("-v");
  });

  it("still removes orphans", () => {
    expect(buildDownArgs(ROOT, SLUG, false)).toContain("--remove-orphans");
  });
});

describe("teardownExitCode", () => {
  it("reports success once nothing remains, even if compose failed", () => {
    // The sweep cleaned up — warning that containers may still be running
    // would be false.
    expect(teardownExitCode(1, 0)).toBe(0);
    expect(teardownExitCode(0, 0)).toBe(0);
  });

  it("reports failure when containers survive a compose success", () => {
    // destroyProject ignores docker errors, so a failed sweep would otherwise
    // be indistinguishable from a clean teardown.
    expect(teardownExitCode(0, 2)).toBe(1);
  });

  it("preserves compose's code when it failed and containers remain", () => {
    expect(teardownExitCode(137, 1)).toBe(137);
  });

  it("never returns 0 with containers remaining on an unknown exit", () => {
    expect(teardownExitCode(undefined, 1)).toBe(1);
  });
});

describe("buildUpArgs", () => {
  it("starts mail but nothing from the full profile by default", () => {
    expect(profilesIn(buildUpArgs(ROOT, SLUG))).toEqual(["mail"]);
  });

  it("adds the full profile under --full", () => {
    expect(profilesIn(buildUpArgs(ROOT, SLUG, { full: true }))).toEqual([
      "full",
      "mail"
    ]);
  });

  it("adds only the studio profile when Studio is picked", () => {
    expect(profilesIn(buildUpArgs(ROOT, SLUG, { studio: true }))).toEqual([
      "studio",
      "mail"
    ]);
  });

  it("lets --full cover Studio without a second profile", () => {
    expect(
      profilesIn(buildUpArgs(ROOT, SLUG, { full: true, studio: true }))
    ).toEqual(["full", "mail"]);
  });

  it("enables no profile under --minimal", () => {
    expect(profilesIn(buildUpArgs(ROOT, SLUG, { minimal: true }))).toEqual([]);
  });

  it("activates no profiles when specific services are named", () => {
    // Compose starts named services + deps regardless; enabling profiles here
    // would pull in unrelated containers.
    const args = buildUpArgs(ROOT, SLUG, { services: ["postgres"] });
    expect(profilesIn(args)).toEqual([]);
    expect(args).toContain("postgres");
  });
});

describe("compose files per mode", () => {
  const home = process.env.HOME;
  const tmp = mkdtempSync(join(tmpdir(), "crbn-compose-"));
  const root = join(tmp, "repo");
  mkdirSync(join(root, "packages/dev/docker"), { recursive: true });
  for (const f of ["docker-compose.dev.yml", "docker-compose.isolated.yml"]) {
    writeFileSync(join(root, "packages/dev/docker", f), "services: {}\n");
  }
  afterAll(() => {
    process.env.HOME = home;
    rmSync(tmp, { recursive: true, force: true });
  });
  const files = (args: string[]) =>
    args.flatMap((a, i) => (a === "-f" ? [args[i + 1]] : []));
  const dev = join(root, "packages/dev/docker/docker-compose.dev.yml");
  const isolated = join(
    root,
    "packages/dev/docker/docker-compose.isolated.yml"
  );

  it("uses the dev file alone in shared mode, both in isolated mode", () => {
    process.env.HOME = tmp;
    writeStackMode("shared-slug", "shared");
    writeStackMode("isolated-slug", "isolated");
    expect(files(buildUpArgs(root, "shared-slug"))).toEqual([dev]);
    expect(files(buildUpArgs(root, "isolated-slug"))).toEqual([dev, isolated]);
  });

  it("tears down with both files whatever the mode", () => {
    process.env.HOME = tmp;
    expect(files(buildDownArgs(root, "shared-slug", true))).toEqual([
      dev,
      isolated
    ]);
    expect(files(buildDownArgs(root, "isolated-slug", true))).toEqual([
      dev,
      isolated
    ]);
  });
});

describe("redisDatabasesOf", () => {
  it("reads --databases from the container command", () => {
    expect(
      redisDatabasesOf([
        "redis-server",
        "--appendonly",
        "yes",
        "--databases",
        "25"
      ])
    ).toBe(25);
  });

  it("is redis's default 16 when the command does not set it", () => {
    // The container every host had before the pool grew: it gets recreated.
    const old = redisDatabasesOf(["redis-server", "--appendonly", "yes"]);
    expect(old).toBe(16);
    expect(old).toBeLessThan(REDIS_DB_MAX);
  });
});

describe("SHARED_PROJECT", () => {
  it("is outside the carbon-* projects that orphan cleanup force-removes", () => {
    // reset and prune (in this and older crbn versions) remove every carbon-*
    // project with no slot; the shared containers have none.
    expect(SHARED_PROJECT.startsWith("carbon-")).toBe(false);
  });
});

describe("sharedComposeEnv", () => {
  it("keeps what docker needs and drops the worktree's .env.local", () => {
    const env = sharedComposeEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      DOCKER_HOST: "unix:///var/run/docker.sock",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      PG_MAX_CONNECTIONS: "100",
      MEM_POSTGRES: "1g",
      COMPOSE_FILE: "other.yml",
      SUPABASE_DB_URL: "postgresql://localhost/x"
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      DOCKER_HOST: "unix:///var/run/docker.sock",
      SSH_AUTH_SOCK: "/tmp/agent.sock"
    });
  });
});

describe("redisDatabasesNeeded", () => {
  it("is the pool, or one past the highest index a slot holds", () => {
    expect(redisDatabasesNeeded([])).toBe(REDIS_DB_MAX);
    expect(redisDatabasesNeeded([{ redisDb: 3 }])).toBe(REDIS_DB_MAX);
    expect(redisDatabasesNeeded([{ redisDb: 3 }, { redisDb: 40 }])).toBe(41);
  });
});

describe("PG_MAJOR", () => {
  it("matches the Postgres image of the shared and isolated stacks", () => {
    for (const file of [
      "docker-compose.shared.yml",
      "docker-compose.isolated.yml"
    ]) {
      const text = readFileSync(join(__dirname, "../../docker", file), "utf8");
      expect(text).toMatch(
        new RegExp(`image: supabase/postgres:${PG_MAJOR}\\.`)
      );
    }
  });
});
