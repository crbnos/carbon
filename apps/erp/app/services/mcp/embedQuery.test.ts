import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetSingleFlightForTesting,
  __setEmbedFetcherForTesting,
  embedQuery
} from "./embedQuery";

afterEach(() => {
  __setEmbedFetcherForTesting(null);
  __resetSingleFlightForTesting();
});

function fakeOk(embedding: number[]): Response {
  return new Response(JSON.stringify({ embedding }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("embedQuery", () => {
  it("returns the parsed embedding array on success", async () => {
    __setEmbedFetcherForTesting(async () => fakeOk([0.1, 0.2, 0.3]));
    const out = await embedQuery("hello");
    expect(out).toEqual([0.1, 0.2, 0.3]);
  });

  it("single-flights identical concurrent queries (one upstream call)", async () => {
    const fetcher = vi.fn(async () => fakeOk([0.5]));
    __setEmbedFetcherForTesting(fetcher);
    const [a, b, c] = await Promise.all([
      embedQuery("same"),
      embedQuery("same"),
      embedQuery("same")
    ]);
    expect(a).toEqual([0.5]);
    expect(b).toEqual([0.5]);
    expect(c).toEqual([0.5]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not collapse distinct queries", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return fakeOk([body.prompt.length]);
    });
    __setEmbedFetcherForTesting(fetcher);
    const [a, b] = await Promise.all([embedQuery("ab"), embedQuery("abcd")]);
    expect(a).toEqual([2]);
    expect(b).toEqual([4]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight slot so subsequent identical queries re-issue", async () => {
    const fetcher = vi.fn(async () => fakeOk([1]));
    __setEmbedFetcherForTesting(fetcher);
    await embedQuery("hi");
    await embedQuery("hi");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws when Ollama returns a non-2xx", async () => {
    __setEmbedFetcherForTesting(
      async () => new Response("nope", { status: 503 })
    );
    await expect(embedQuery("x")).rejects.toThrow(/503/);
  });

  it("throws when response has no embedding array", async () => {
    __setEmbedFetcherForTesting(
      async () => new Response(JSON.stringify({}), { status: 200 })
    );
    await expect(embedQuery("x")).rejects.toThrow(/missing/);
  });
});
