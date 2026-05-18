import { describe, expect, it, vi } from "vitest";
import { notifyManifestQueue } from "./notifyManifestQueue";

describe("notifyManifestQueue", () => {
  it("reads mcp-tools.json and sends one pgmq message with its contentHash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const client = { rpc } as unknown as Parameters<
      typeof notifyManifestQueue
    >[0];
    await notifyManifestQueue(client);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("pgmq_send");
    expect(args).toMatchObject({
      queue_name: "mcp_embeddings_queue"
    });
    expect(args.message).toHaveProperty("contentHash");
    expect(args.message.contentHash).toMatch(/^sha256:/);
  });

  it("does not throw when rpc returns an error (fire-and-forget)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("nope") });
    const client = { rpc } as unknown as Parameters<
      typeof notifyManifestQueue
    >[0];
    await expect(notifyManifestQueue(client)).resolves.toBeUndefined();
  });
});
