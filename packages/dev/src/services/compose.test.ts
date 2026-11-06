// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, describe, expect, it } from "vitest";
import { REDIS_DB_MAX, writeStackMode } from "../worktree.js";
import {
  buildDownArgs,
  buildUpArgs,
  missingSharedServices,
  PG_MAJOR,
  planSharedFiles,
  REDIS_CONTAINER,
  redisDatabasesNeeded,
  renderSharedEnv,
  SHARED_PROJECT,
  sharedComposeEnv,
  sharedDirName,
  staleSharedDirs,
  teardownExitCode,
  treeDigest
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

describe("shared redis", () => {
  const shared = readFileSync(
    join(__dirname, "../../docker/docker-compose.shared.yml"),
    "utf8"
  );

  it("is a crbn-shared service under the name flushDb execs into", () => {
    expect(missingSharedServices(shared)).toEqual([]);
    expect(shared).toMatch(
      new RegExp(`^ {4}container_name: ${REDIS_CONTAINER}$`, "m")
    );
  });

  it("keeps the volume the docker-run container wrote, as external", () => {
    // Not external, compose would warn on every boot about a volume it did
    // not create; renamed, every worktree's keys would be left behind.
    expect(shared).toMatch(
      /^ {2}carbon-redis-data:\n {4}name: carbon-redis-data\n {4}external: true$/m
    );
  });

  it("takes its database count from REDIS_DATABASES", () => {
    expect(shared).toContain(`"$\{REDIS_DATABASES:-25}"`);
  });

  it("tells a file from before redis and the edge runtime moved in", () => {
    // That file is replaced even while crbn-shared runs, or they never start.
    expect(
      missingSharedServices("services:\n  postgres:\n    image: x\n")
    ).toEqual(["redis", "edge-runtime"]);
    expect(
      missingSharedServices("services:\n  redis:\n    image: x\n")
    ).toEqual(["edge-runtime"]);
  });

  it("writes the keys, database count and edge runtime directories into the shared .env", () => {
    const env = renderSharedEnv(
      { secret: "s", anonKey: "a", serviceKey: "k" },
      41,
      {
        EDGE_MAIN_DIR: "edge-main-111111111111",
        FUNCTIONS_DIR: "functions-222222222222"
      }
    );
    expect(env).toBe(
      "SUPABASE_JWT_SECRET=s\nSUPABASE_ANON_KEY=a\nSUPABASE_SERVICE_ROLE_KEY=k\nREDIS_DATABASES=41\nEDGE_MAIN_DIR=edge-main-111111111111\nFUNCTIONS_DIR=functions-222222222222\n"
    );
  });
});

describe("planSharedFiles", () => {
  it("keeps a running project's complete files and warns", () => {
    const plan = planSharedFiles({
      running: true,
      changed: ["init.sql"],
      missing: []
    });
    expect(plan.copy).toBe(false);
    expect(plan.warning).toContain("init.sql");
  });

  it("replaces a running project's file when it lacks a later service", () => {
    // Else redis or the edge runtime would never start on that machine.
    expect(
      planSharedFiles({
        running: true,
        changed: ["docker-compose.shared.yml"],
        missing: ["edge-runtime"]
      })
    ).toEqual({ copy: true, warning: null });
  });

  it("copies when nothing runs, when nothing changed, or when there is no file", () => {
    for (const state of [
      { running: false, changed: ["init.sql"], missing: [] },
      { running: true, changed: [], missing: [] },
      { running: true, changed: ["docker-compose.shared.yml"], missing: null }
    ]) {
      expect(planSharedFiles(state)).toEqual({ copy: true, warning: null });
    }
  });
});

describe("shared edge runtime", () => {
  const docker = join(__dirname, "../../docker");
  const read = (f: string) => readFileSync(join(docker, f), "utf8");

  it("takes the API URL from the gateway's header, with a pool per worktree", () => {
    const shared = read("docker-compose.shared.yml");
    expect(shared).toMatch(/^ {4}container_name: carbon-edge-runtime$/m);
    expect(shared).toContain('API_URL_FROM_HEADER: "true"');
    // A new copy is a new mount path, which recreates the runtime.
    expect(shared).toContain(
      `./$\{FUNCTIONS_DIR:-functions}:/home/deno/functions:ro`
    );
    expect(shared).toContain(
      `./$\{EDGE_MAIN_DIR:-edge-main}:/home/deno/main:ro`
    );
    const main = read("edge-main/index.ts");
    expect(main).toContain('req.headers.get("x-carbon-api")');
    expect(main).toMatch(/poolKey,/);
  });

  it("is reached through every worktree's gateway, after a private one by its alias", () => {
    const cds = read("envoy/cds.template.yaml");
    // Not the bare "edge-runtime": on carbon-shared it names crbn-shared's.
    expect(cds).toMatch(
      /- priority: 0[\s\S]*?address: local-edge-runtime\n[\s\S]*?- priority: 1[\s\S]*?address: carbon-edge-runtime\n/
    );
    expect(cds).not.toMatch(/address: edge-runtime\b/);
    const dev = read("docker-compose.dev.yml");
    expect(dev).toMatch(
      /^ {2}edge-runtime:\n[\s\S]*?aliases:\n {10}- local-edge-runtime$/m
    );
    // The gateway overwrites the header, so a client can't name another API.
    expect(read("envoy/lds.template.yaml")).toMatch(
      /key: x-carbon-api\n\s+value: \$\{FUNCTIONS_API_URL\}\n\s+append_action: OVERWRITE_IF_EXISTS_OR_ADD/
    );
    expect(read("envoy/docker-entrypoint.sh")).toContain("FUNCTIONS_API_URL");
    expect(dev).toMatch(
      /FUNCTIONS_API_URL: http:\/\/\$\{CARBON_WORKTREE\}-api-gw:8000/
    );
  });

  it("names a copy after its content", () => {
    const dir = mkdtempSync(join(tmpdir(), "crbn-digest-"));
    try {
      mkdirSync(join(dir, "fn"));
      writeFileSync(join(dir, "fn/index.ts"), "a");
      const first = sharedDirName("functions", treeDigest(dir));
      writeFileSync(join(dir, "fn/index.ts"), "b");
      const second = sharedDirName("functions", treeDigest(dir));
      expect(first).toMatch(/^functions-[0-9a-f]{12}$/);
      expect(second).not.toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves dotfiles and symlinks out of the name", () => {
    // crbn's env sync links .env.local into supabase/functions; counted, every
    // rewrite of it would recreate the shared runtime.
    const root = mkdtempSync(join(tmpdir(), "crbn-digest-"));
    const dir = join(root, "functions");
    const envFile = join(root, ".env.local");
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "index.ts"), "a");
      const plain = treeDigest(dir);
      writeFileSync(envFile, "PORT=1");
      symlinkSync(envFile, join(dir, ".env.local"));
      symlinkSync(join(dir, "index.ts"), join(dir, "linked.ts"));
      mkdirSync(join(dir, ".vscode"));
      writeFileSync(join(dir, ".vscode/settings.json"), "{}");
      expect(treeDigest(dir)).toBe(plain);
      writeFileSync(envFile, "PORT=2");
      expect(treeDigest(dir)).toBe(plain);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prunes old copies, never a kept one, a live copy in progress or other files", () => {
    const stale = staleSharedDirs(
      [
        "functions-aaaaaaaaaaaa", // this boot's
        "functions-bbbbbbbbbbbb", // what the runtime mounts
        "functions-cccccccccccc", // old
        "functions", // the first layout's copy
        "edge-main-dddddddddddd.tmp-111", // another crbn copying
        "edge-main-eeeeeeeeeeee.tmp-222", // left by a crash
        "docker-compose.shared.yml",
        ".env"
      ],
      new Set(["functions-aaaaaaaaaaaa", "functions-bbbbbbbbbbbb"]),
      (pid) => pid === 111
    );
    expect(stale).toEqual([
      "functions-cccccccccccc",
      "functions",
      "edge-main-eeeeeeeeeeee.tmp-222"
    ]);
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
