import { describe, expect, it } from "vitest";
import { buildDownArgs, buildUpArgs, teardownExitCode } from "./compose.js";

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
      ...profilesIn(buildUpArgs(ROOT, SLUG, { chrome: true })),
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
    // Stops the union test passing vacuously. full = studio/meta/inbucket,
    // chrome = the opt-in thumbnail Chromium.
    expect(profilesIn(buildDownArgs(ROOT, SLUG, false))).toEqual(
      expect.arrayContaining(["full", "chrome"])
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
  // Locks in the pre-existing boot behavior the extraction preserved.
  it("enables the full profile by default", () => {
    expect(profilesIn(buildUpArgs(ROOT, SLUG))).toEqual(["full"]);
  });

  it("drops the full profile under --minimal", () => {
    expect(profilesIn(buildUpArgs(ROOT, SLUG, { minimal: true }))).toEqual([]);
  });

  it("adds the chrome profile only when asked", () => {
    expect(profilesIn(buildUpArgs(ROOT, SLUG, { chrome: true }))).toEqual([
      "full",
      "chrome"
    ]);
  });

  it("activates no profiles when specific services are named", () => {
    // Compose starts named services + deps regardless; enabling profiles here
    // would pull in unrelated containers.
    const args = buildUpArgs(ROOT, SLUG, {
      services: ["postgres"],
      chrome: true
    });
    expect(profilesIn(args)).toEqual([]);
    expect(args).toContain("postgres");
  });
});
