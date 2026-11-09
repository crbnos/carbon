// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { join } from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAtLeastAsNew, lineWriter, tryConnect } from "./helpers.js";

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

describe("lineWriter", () => {
  // A sink that holds every chunk until released, like a pipe whose reader stalls.
  function stalledSink() {
    const written: string[] = [];
    const held: Array<() => void> = [];
    const sink = new Writable({
      highWaterMark: 16,
      write(chunk, _encoding, done) {
        written.push(String(chunk));
        held.push(done);
      }
    });
    const release = async () => {
      while (held.length > 0) {
        held.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    return { sink, written, release };
  }

  it("drops lines past the limit, then reports how many once the sink drains", async () => {
    const { sink, written, release } = stalledSink();
    const write = lineWriter(sink, 25);
    for (let i = 0; i < 10; i++) write(`line ${i}\n`); // 7 bytes each
    // 4 lines take 28 bytes, past 25: the other 6 are dropped, not queued.
    expect(sink.writableLength).toBe(28);
    await release();
    expect(written.slice(0, 4)).toEqual([
      "line 0\n",
      "line 1\n",
      "line 2\n",
      "line 3\n"
    ]);
    expect(written[4]).toBe(
      "crbn | 6 log lines dropped: the output fell behind\n"
    );
    expect(written).toHaveLength(5);
  });

  it("is one writer per sink, so apps writing to it share the limit", () => {
    const { sink } = stalledSink();
    expect(lineWriter(sink, 25)).toBe(lineWriter(sink, 25));
  });
});
