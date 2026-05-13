import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterAll, describe, expect, it } from "vitest";
import { sameWorktreePath, slugify } from "./worktree.js";

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

describe("sameWorktreePath", () => {
  const real = mkdtempSync(join(tmpdir(), "carbon-worktree-"));
  const link = `${real}-link`;
  symlinkSync(real, link);

  afterAll(() => {
    rmSync(link, { force: true });
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
