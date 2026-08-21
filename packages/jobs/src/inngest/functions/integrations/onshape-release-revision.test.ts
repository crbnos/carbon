import { describe, expect, it, vi } from "vitest";
import { resolveReleasedRevision } from "./onshape-release-revision";

// The regression these pin: a real `onshape.revision.created` delivery carries
// `revisionId` and NOT `revision`, so requiring the letter off the event made
// every genuine release a no-op. Nine events, nine skips, no change notice.

describe("resolveReleasedRevision", () => {
  it("looks the letter up when the event omits it — the real webhook shape", async () => {
    const readRevision = vi.fn().mockResolvedValue({ revision: "D" });

    const revision = await resolveReleasedRevision(
      { revisionId: "6a885b9bd9b435cf25f4f2a3" },
      readRevision
    );

    expect(revision).toBe("D");
    expect(readRevision).toHaveBeenCalledWith("6a885b9bd9b435cf25f4f2a3");
  });

  it("prefers the event's letter and does NOT call Onshape", async () => {
    const readRevision = vi.fn();

    const revision = await resolveReleasedRevision(
      { revision: "C", revisionId: "6a885b9bd9b435cf25f4f2a3" },
      readRevision
    );

    expect(revision).toBe("C");
    expect(readRevision).not.toHaveBeenCalled();
  });

  it("returns empty when the event names no revision at all", async () => {
    const readRevision = vi.fn();

    expect(await resolveReleasedRevision({}, readRevision)).toBe("");
    expect(readRevision).not.toHaveBeenCalled();
  });

  it("returns empty rather than guessing when the lookup finds nothing", async () => {
    // An empty letter must stay empty. Falling back to the initial revision
    // resolves the family to its revision-'0' member and stamps released
    // geometry onto the item that predates every release.
    for (const response of [
      null,
      undefined,
      {},
      { revision: null },
      { revision: "  " }
    ]) {
      const revision = await resolveReleasedRevision(
        { revisionId: "rev" },
        vi.fn().mockResolvedValue(response)
      );
      expect(revision).toBe("");
    }
  });

  it("trims, so a padded letter never becomes a different revision", async () => {
    expect(await resolveReleasedRevision({ revision: " D " }, vi.fn())).toBe(
      "D"
    );
    expect(
      await resolveReleasedRevision(
        { revisionId: "rev" },
        vi.fn().mockResolvedValue({ revision: " D " })
      )
    ).toBe("D");
  });

  it("treats a blank event letter as absent and falls through to the lookup", async () => {
    // zod `.optional()` on a string lets "" through, and "" is not a revision.
    const readRevision = vi.fn().mockResolvedValue({ revision: "B" });

    const revision = await resolveReleasedRevision(
      { revision: "", revisionId: "rev" },
      readRevision
    );

    expect(revision).toBe("B");
    expect(readRevision).toHaveBeenCalledOnce();
  });
});
