// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import http from "node:http";
import type { AddressInfo } from "node:net";
import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { webhookTransport } from "./webhook-body.ts";

const servers: http.Server[] = [];

function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port)
    )
  );
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(r)))
  );
});

describe("webhookTransport", () => {
  it("refuses at connect time a name that resolves to loopback", async () => {
    let received = 0;
    const port = await listen((_req, res) => {
      received++;
      res.end("{}");
    });

    await expect(
      axios.post(`http://localhost:${port}/hook`, "{}", webhookTransport)
    ).rejects.toThrow("That address is inside a private network.");
    expect(received).toBe(0);
  });

  it("ignores a proxy from the environment", async () => {
    let proxied = 0;
    const proxy = await listen((_req, res) => {
      proxied++;
      res.end("{}");
    });
    const saved = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxy}`;
    try {
      await expect(
        axios.post("http://localhost:1/hook", "{}", webhookTransport)
      ).rejects.toThrow("That address is inside a private network.");
    } finally {
      if (saved === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = saved;
    }
    expect(proxied).toBe(0);
  });

  it("does not follow a redirect", async () => {
    let reached = 0;
    const target = await listen((_req, res) => {
      reached++;
      res.end("{}");
    });
    const bounce = await listen((_req, res) => {
      res.writeHead(302, {
        location: `http://127.0.0.1:${target}/latest/meta-data/`
      });
      res.end();
    });

    // The agents are swapped out only so the test can reach its own loopback
    // listener; the redirect setting under test is the transport's.
    await expect(
      axios.post(`http://127.0.0.1:${bounce}/bounce`, "{}", {
        ...webhookTransport,
        httpAgent: undefined,
        httpsAgent: undefined
      })
    ).rejects.toMatchObject({ response: { status: 302 } });
    expect(reached).toBe(0);
  });
});
