// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, describe, expect, it } from "vitest";
import type { PortMap } from "./worktree.js";
import {
  canonicalSlug,
  readStackMode,
  recordedStackMode,
  sameWorktreePath,
  slugify,
  stackDatabase,
  stackPorts,
  worktreeDatabaseName,
  writeStackMode
} from "./worktree.js";

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("Foo")).toBe("foo");
  });

  it("collapses non-alphanumeric runs to single dash", () => {
    expect(slugify("foo/bar baz")).toBe("foo-bar-baz");
    expect(slugify("foo   bar")).toBe("foo-bar");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("--foo--")).toBe("foo");
    expect(slugify("/foo/")).toBe("foo");
  });

  it("preserves embedded dashes", () => {
    expect(slugify("feat-add-thing")).toBe("feat-add-thing");
  });

  it("collapses consecutive dashes", () => {
    expect(slugify("foo--bar")).toBe("foo-bar");
  });

  it("handles unicode by replacing with dashes", () => {
    expect(slugify("café/résumé")).toBe("caf-r-sum");
  });

  it("returns empty string when input is empty or all-symbol", () => {
    expect(slugify("")).toBe("");
    expect(slugify("///")).toBe("");
  });
});

describe("canonicalSlug", () => {
  it("derives <repoBase>-<branch> independent of the worktree path", () => {
    // Conductor codename dir (`moscow`) must NOT drive the slug — the branch does.
    expect(
      canonicalSlug({
        worktreeRoot: "/Users/x/conductor/workspaces/carbon/moscow",
        mainRoot: "/Users/x/Code/carbon",
        branch: "featuser-select"
      })
    ).toBe("carbon-featuser-select");
  });

  it("sanitizes slashes in the branch (matches `crbn new` dir naming)", () => {
    expect(
      canonicalSlug({
        worktreeRoot: "/Users/x/anything",
        mainRoot: "/Users/x/Code/carbon",
        branch: "feat/service"
      })
    ).toBe("carbon-feat-service");
  });

  it("strips a prior -<slug> suffix from the main checkout basename", () => {
    expect(
      canonicalSlug({
        worktreeRoot: "/Users/x/wt",
        mainRoot: "/Users/x/Code/carbon-standard-costing",
        branch: "fix-bug"
      })
    ).toBe("carbon-fix-bug");
  });

  it("never collides with the main checkout's bare `carbon` slug", () => {
    const slug = canonicalSlug({
      worktreeRoot: "/Users/x/conductor/workspaces/carbon/macau",
      mainRoot: "/Users/x/Code/carbon",
      branch: "some-feature"
    });
    expect(slug).not.toBe("carbon");
  });

  it("falls back to the worktree dir basename when HEAD is detached", () => {
    expect(
      canonicalSlug({
        worktreeRoot: "/Users/x/conductor/workspaces/carbon/moscow",
        mainRoot: "/Users/x/Code/carbon",
        branch: ""
      })
    ).toBe("moscow");
  });
});

describe("sameWorktreePath", () => {
  const real = mkdtempSync(join(tmpdir(), "carbon-worktree-"));
  const link = `${real}-link`;
  symlinkSync(real, link);

  afterAll(() => {
    // `link` is a symlink to a directory; unlink removes the link itself
    // (rmSync without `recursive` throws EISDIR on a dir symlink on macOS).
    unlinkSync(link);
    rmSync(real, { recursive: true, force: true });
  });

  it("treats a symlink and its real path as the same worktree", () => {
    expect(sameWorktreePath(real, link)).toBe(true);
  });

  it("ignores trailing slashes", () => {
    expect(sameWorktreePath(`${real}/`, real)).toBe(true);
  });

  it("distinguishes unrelated paths", () => {
    expect(sameWorktreePath(real, tmpdir())).toBe(false);
  });
});

describe("worktreeDatabaseName", () => {
  it("maps a slug to wt_ plus snake case", () => {
    expect(worktreeDatabaseName("carbon-chore-dev-supabase-parity")).toBe(
      "wt_carbon_chore_dev_supabase_parity"
    );
  });

  it("cuts a long name to 63 characters and adds a hash", () => {
    const name = worktreeDatabaseName("a".repeat(80));
    expect(name).toHaveLength(63);
    expect(name).toMatch(/_[0-9a-f]{6}$/);
  });

  it("gives slugs that differ only outside [a-z0-9-] different names", () => {
    expect(worktreeDatabaseName("a.b")).not.toBe(worktreeDatabaseName("a_b"));
    expect(worktreeDatabaseName("a_b")).not.toBe(worktreeDatabaseName("a-b"));
  });
});

describe("stack mode", () => {
  const home = process.env.HOME;
  const tmpHome = mkdtempSync(join(tmpdir(), "crbn-mode-"));
  afterAll(() => {
    process.env.HOME = home;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("defaults to shared, and keeps what writeStackMode wrote", () => {
    process.env.HOME = tmpHome;
    expect(readStackMode("some-slug")).toBe("shared");
    // An older crbn wrote no mode: its volumes are live, never "old".
    expect(recordedStackMode("some-slug")).toBeNull();
    writeStackMode("some-slug", "isolated");
    expect(readStackMode("some-slug")).toBe("isolated");
    writeStackMode("some-slug", "shared");
    expect(readStackMode("some-slug")).toBe("shared");
  });
});

describe("stackDatabase and stackPorts", () => {
  const ports = {
    PORT_DB: 54000,
    PORT_POOLER: 54001,
    PORT_INBUCKET: 54002,
    PORT_API: 54003
  } as unknown as PortMap;

  it("gives a shared stack the worktree database and the shared ports", () => {
    expect(stackDatabase("carbon-a", "shared")).toBe("wt_carbon_a");
    expect(stackPorts(ports, "shared")).toMatchObject({
      PORT_DB: 54322,
      PORT_POOLER: 54329,
      PORT_INBUCKET: 54324,
      PORT_API: 54003
    });
  });

  it("leaves a private stack on postgres and the slot's ports", () => {
    expect(stackDatabase("carbon-a", "isolated")).toBe("postgres");
    expect(stackPorts(ports, "isolated")).toBe(ports);
  });
});
