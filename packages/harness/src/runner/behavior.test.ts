import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureStack, parseBehaviorResult, reachable } from "./behavior";
import type { Shell } from "./types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "behavior-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A shell where curl to specific URLs returns a chosen HTTP code; others refuse. */
function curlShell(codes: Record<string, string>): Shell {
  return (cmd: string) => {
    const m = cmd.match(/curl .*'([^']+)'/);
    const url = m?.[1];
    if (url && codes[url]) return { ok: true, output: codes[url] };
    return { ok: false, output: "000" }; // connection refused
  };
}

describe("reachable", () => {
  it("treats 2xx/3xx/4xx as serving and a refused connection as down", () => {
    expect(
      reachable("https://erp.x.dev", curlShell({ "https://erp.x.dev": "200" }))
    ).toBe(true);
    expect(
      reachable("https://erp.x.dev", curlShell({ "https://erp.x.dev": "401" }))
    ).toBe(true);
    expect(
      reachable("https://erp.x.dev", curlShell({ "https://erp.x.dev": "302" }))
    ).toBe(true);
    expect(reachable("https://erp.x.dev", curlShell({}))).toBe(false);
    expect(
      reachable("https://erp.x.dev", curlShell({ "https://erp.x.dev": "503" }))
    ).toBe(false);
  });
});

describe("ensureStack", () => {
  const log = () => undefined;

  it("returns the live portless URL when it answers", () => {
    writeFileSync(
      join(dir, ".env.local"),
      "ERP_URL=https://erp.x.dev\nPORT_ERP=61934\n"
    );
    const out = ensureStack(
      dir,
      curlShell({ "https://erp.x.dev": "200" }),
      log
    );
    expect(out).toEqual({ baseUrl: "https://erp.x.dev" });
  });

  it("falls back to the localhost backend when portless is unreachable", () => {
    writeFileSync(
      join(dir, ".env.local"),
      "ERP_URL=https://erp.x.dev\nPORT_ERP=61934\n"
    );
    const out = ensureStack(
      dir,
      curlShell({ "http://localhost:61934": "200" }),
      log
    );
    expect(out).toEqual({ baseUrl: "http://localhost:61934" });
  });

  it("blocks when no URL answers even after a boot attempt", () => {
    writeFileSync(join(dir, ".env.local"), "ERP_URL=https://erp.x.dev\n");
    const out = ensureStack(dir, curlShell({}), log);
    expect("blocked" in out && out.blocked).toContain("not reachable");
  });

  it("blocks when .env.local has no ERP URL at all", () => {
    writeFileSync(join(dir, ".env.local"), "SOMETHING=else\n");
    const out = ensureStack(dir, curlShell({}), log);
    expect("blocked" in out && out.blocked).toContain("Carbon worktree");
  });
});

describe("parseBehaviorResult", () => {
  it("parses the fenced json verdict", () => {
    const text =
      'verified.\n```json\n{"passed":true,"screenshots":["/a/01.png"],"notes":"saw it"}\n```';
    expect(parseBehaviorResult(text)).toEqual({
      passed: true,
      screenshots: ["/a/01.png"],
      notes: "saw it"
    });
  });

  it("defaults missing fields safely", () => {
    expect(parseBehaviorResult('```json\n{"passed":false}\n```')).toEqual({
      passed: false,
      screenshots: [],
      notes: ""
    });
  });
});
