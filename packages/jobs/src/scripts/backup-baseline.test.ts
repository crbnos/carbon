import { describe, expect, it } from "vitest";
import type { Manifest } from "../backups/schema";
import {
  BaselineError,
  type BaselineSources,
  baselineUrl,
  parseBaseline,
  parseGithubSlug,
  resolveBaseline,
  SCHEMA_REPO_PATH
} from "./backup-baseline";

const REMOTE = "git@github.com:crbnos/carbon.git";
const REMOTE_URL = baselineUrl("crbnos/carbon");

const manifest = (name: string) =>
  JSON.stringify({ tables: [{ name, rows: 0, columns: ["id"] }] });

function sources(over: Partial<BaselineSources> = {}): BaselineSources {
  return {
    remoteUrl: () => REMOTE,
    fetchText: async () => manifest("fromMain"),
    localText: () => manifest("fromLocal"),
    ...over
  };
}

const tableName = (m: Manifest) => (m.tables[0] as { name: string }).name;

describe("parseGithubSlug", () => {
  it.each([
    ["git@github.com:crbnos/carbon.git", "crbnos/carbon"],
    ["https://github.com/crbnos/carbon.git", "crbnos/carbon"],
    ["https://github.com/crbnos/carbon", "crbnos/carbon"],
    ["  git@github.com:acme/fork.git\n", "acme/fork"],
    ["ssh://git@github.com/acme/deep-name.git", "acme/deep-name"]
  ])("parses %s", (url, expected) => {
    expect(parseGithubSlug(url)).toBe(expected);
  });

  it.each([
    ["https://gitlab.com/acme/carbon.git"],
    ["git@bitbucket.org:acme/carbon.git"],
    ["/srv/git/carbon.git"]
  ])("returns null for a non-GitHub remote: %s", (url) => {
    expect(parseGithubSlug(url)).toBeNull();
  });

  it("returns null when the remote cannot be read", () => {
    expect(parseGithubSlug(null)).toBeNull();
  });
});

describe("baselineUrl", () => {
  it("points at the file on main, not at the working tree", () => {
    expect(baselineUrl("acme/fork")).toBe(
      `https://raw.githubusercontent.com/acme/fork/main/${SCHEMA_REPO_PATH}`
    );
  });
});

describe("parseBaseline", () => {
  it("names the source when the file is present but not JSON", () => {
    expect(() => parseBaseline("{ not json", "some/source")).toThrow(
      BaselineError
    );
    expect(() => parseBaseline("{ not json", "some/source")).toThrow(
      /baseline at some\/source could not be read/
    );
  });

  // The distinction this whole class exists for: a corrupt file must not be
  // reported as a missing one, which sends the reader hunting for nothing.
  it("does not describe an unreadable file as missing", () => {
    expect(() => parseBaseline("<html>404</html>", "u")).not.toThrow(
      /could not be found/
    );
  });
});

describe("resolveBaseline", () => {
  it("prefers the copy fetched from main", async () => {
    const result = await resolveBaseline(sources());
    expect(tableName(result.manifest)).toBe("fromMain");
    expect(result.source).toBe(REMOTE_URL);
    expect(result.warnings).toEqual([]);
  });

  it("falls back to the local copy on a network failure, and says it may be stale", async () => {
    const result = await resolveBaseline(
      sources({
        fetchText: async () => {
          throw new Error("The operation was aborted due to timeout");
        }
      })
    );
    expect(tableName(result.manifest)).toBe("fromLocal");
    expect(result.source).toBe("origin/main (local copy)");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      "The operation was aborted due to timeout"
    );
    // Naming the staleness is the point — an unexplained false alarm about a
    // column a teammate removed is what earns a --no-verify.
    expect(result.warnings[0]).toContain("months old if you have not pulled");
    expect(result.warnings[0]).toContain("STRICTER check");
  });

  it("falls back when the file is not on main yet (404)", async () => {
    const result = await resolveBaseline(
      sources({ fetchText: async () => null })
    );
    expect(tableName(result.manifest)).toBe("fromLocal");
    expect(result.warnings[0]).toContain("is not on main yet (404)");
  });

  it("falls back when origin is not a GitHub remote", async () => {
    const result = await resolveBaseline(
      sources({ remoteUrl: () => "https://gitlab.com/acme/carbon.git" })
    );
    expect(tableName(result.manifest)).toBe("fromLocal");
    expect(result.warnings[0]).toContain("origin is not a GitHub remote");
  });

  it("never fetches when there is no usable remote", async () => {
    let fetched = false;
    await resolveBaseline(
      sources({
        remoteUrl: () => null,
        fetchText: async () => {
          fetched = true;
          return null;
        }
      })
    );
    expect(fetched).toBe(false);
  });

  // The one case that must not degrade to a pass: a check that silently skips
  // is indistinguishable from a check that succeeded.
  it("throws when the baseline is in neither place", async () => {
    const promise = resolveBaseline(
      sources({ fetchText: async () => null, localText: () => null })
    );
    await expect(promise).rejects.toThrow(BaselineError);
    await expect(promise).rejects.toThrow(/could not be found/);
  });

  it("tells the reader how to bootstrap the first commit", async () => {
    await expect(
      resolveBaseline(
        sources({ fetchText: async () => null, localText: () => null })
      )
    ).rejects.toThrow(/CARBON_SKIP_BACKUP_CHECK=1 git commit/);
  });

  it("refuses a corrupt fetched baseline instead of falling back to the local one", async () => {
    await expect(
      resolveBaseline(sources({ fetchText: async () => "{ not json" }))
    ).rejects.toThrow(/could not be read/);
  });

  it("refuses a corrupt local baseline instead of reporting it missing", async () => {
    await expect(
      resolveBaseline(
        sources({ fetchText: async () => null, localText: () => "{ not json" })
      )
    ).rejects.toThrow(/could not be read/);
  });
});
