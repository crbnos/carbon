import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAtLeastAsNew, requireNumberEnv, tryConnect } from "./helpers.js";

describe("tryConnect", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const addr = server.address();
    if (typeof addr === "object" && addr) port = addr.port;
    else throw new Error("no port");
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns true when the port accepts", async () => {
    expect(await tryConnect("127.0.0.1", port)).toBe(true);
  });

  it("returns false when nothing listens", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await tryConnect("127.0.0.1", port, 200)).toBe(false);
  });
});

describe("isAtLeastAsNew", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-dev-helpers-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when a is newer than b", () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    writeFileSync(b, "");
    writeFileSync(a, "");
    // bump a forward 1s
    utimesSync(a, Date.now() / 1000 + 1, Date.now() / 1000 + 1);
    expect(isAtLeastAsNew(a, b)).toBe(true);
  });

  it("returns true when a equals b mtime", () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    writeFileSync(a, "");
    writeFileSync(b, "");
    const t = Date.now() / 1000;
    utimesSync(a, t, t);
    utimesSync(b, t, t);
    expect(isAtLeastAsNew(a, b)).toBe(true);
  });

  it("returns false when a is older than b", () => {
    const a = join(dir, "a");
    const b = join(dir, "b");
    writeFileSync(a, "");
    writeFileSync(b, "");
    utimesSync(a, Date.now() / 1000 - 10, Date.now() / 1000 - 10);
    expect(isAtLeastAsNew(a, b)).toBe(false);
  });

  it("returns false when either file is missing", () => {
    expect(isAtLeastAsNew(join(dir, "no-a"), join(dir, "no-b"))).toBe(false);
  });
});

describe("requireNumberEnv", () => {
  const KEY = "CARBON_TEST_REQUIRE_NUMBER_ENV";

  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns the parsed number", () => {
    process.env[KEY] = "54321";
    expect(requireNumberEnv(KEY)).toBe(54321);
  });

  it("throws when missing", () => {
    expect(() => requireNumberEnv(KEY)).toThrow(/missing/);
  });

  it("throws when empty", () => {
    process.env[KEY] = "";
    expect(() => requireNumberEnv(KEY)).toThrow(/missing/);
  });

  it("throws on non-numeric", () => {
    process.env[KEY] = "not-a-number";
    expect(() => requireNumberEnv(KEY)).toThrow(/not a number/);
  });
});
