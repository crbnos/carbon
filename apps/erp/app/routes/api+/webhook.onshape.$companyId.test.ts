import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({})
}));
vi.mock("@carbon/jobs", () => ({ trigger: vi.fn() }));

const getIntegration = vi.fn();
vi.mock("../../modules/settings", () => ({
  getIntegration: (...args: unknown[]) => getIntegration(...args)
}));

// The signing secret is vaulted, so the receiver resolves it rather than reading
// the metadata column. The default mock returns the row's metadata unchanged —
// which is the shape resolveIntegrationSecrets produces once the bag is merged
// back in — so a test says "a secret is configured" by putting it in metadata.
const resolveIntegrationSecrets = vi.fn(
  async (
    _client: unknown,
    _companyId: string,
    _integrationId: string,
    metadata: unknown
  ) => metadata
);
vi.mock("@carbon/ee/integrations/secrets", () => ({
  resolveIntegrationSecrets: (...args: unknown[]) =>
    // @ts-expect-error - test double
    resolveIntegrationSecrets(...args)
}));

import { trigger } from "@carbon/jobs";
import { action } from "./webhook.onshape.$companyId";

const COMPANY_ID = "company-1";
const INSTALLER = "user-installer";
const SECRET = "onshape-signing-key";

type Metadata = Record<string, unknown>;

function integrationRow(metadata: Metadata, active = true) {
  return {
    data: { active, metadata, updatedBy: INSTALLER },
    error: null
  };
}

/** A well-formed onshape.revision.created envelope. */
function releaseEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: "onshape.revision.created",
    messageId: "msg-1",
    partNumber: "PRT-1000",
    documentId: "doc-1",
    versionId: "ver-1",
    elementId: "el-1",
    elementType: 1,
    releaseId: "release-1",
    releaseName: "REL-001",
    revision: "B",
    ...overrides
  };
}

function makeRequest(
  bodyObj: unknown,
  opts: { timestamp?: string; primary?: string; secondary?: string } = {}
) {
  const body = JSON.stringify(bodyObj);
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.timestamp) {
    headers.set("x-onshape-webhook-timestamp", opts.timestamp);
  }
  if (opts.primary) {
    headers.set("x-onshape-webhook-signature-primary", opts.primary);
  }
  if (opts.secondary) {
    headers.set("x-onshape-webhook-signature-secondary", opts.secondary);
  }
  return new Request(`http://localhost/api/webhook/onshape/${COMPANY_ID}`, {
    method: "POST",
    body,
    headers
  });
}

function sign(bodyObj: unknown, timestamp: string, secret = SECRET) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${JSON.stringify(bodyObj)}`, "utf8")
    .digest("base64");
}

function run(request: Request) {
  return action({ request, params: { companyId: COMPANY_ID } } as never);
}

/**
 * The route rejects with react-router's `data(value, init)`, which returns a
 * `DataWithResponseInit` wrapper rather than a `Response` — the status lives on
 * `.init.status`. Accept either so the assertion does not depend on that detail.
 */
function statusOf(response: unknown): number | undefined {
  if (response instanceof Response) return response.status;
  return (response as { init?: { status?: number } } | undefined)?.init?.status;
}

/** Task ids dispatched during a call, in order. */
function dispatchedTasks() {
  return vi.mocked(trigger).mock.calls.map((call) => call[0]);
}

function payloadFor(task: string) {
  const call = vi
    .mocked(trigger)
    .mock.calls.find((candidate) => candidate[0] === task);
  return call?.[1] as Record<string, unknown> | undefined;
}

describe("onshape webhook receiver", () => {
  beforeEach(() => {
    vi.mocked(trigger).mockReset();
    getIntegration.mockReset();
  });

  describe("the consumer gate", () => {
    it("acks and dispatches nothing when every consumer is off", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          attachAssetsOnRelease: false,
          releaseImportMode: "off",
          createItemsOnRelease: false
        })
      );
      const result = await run(makeRequest(releaseEvent()));
      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });

    it("dispatches the release job when assets alone are on", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          attachAssetsOnRelease: true,
          releaseImportMode: "off",
          createItemsOnRelease: false
        })
      );
      await run(makeRequest(releaseEvent()));
      expect(dispatchedTasks()).toEqual(["onshape-release"]);
    });

    it("dispatches on a bare connected row, where every default applies", async () => {
      // attachAssetsOnRelease defaults ON and releaseImportMode defaults to
      // changeNotice, so a row with no settings written yet is a live consumer.
      getIntegration.mockResolvedValue(integrationRow({}));
      await run(makeRequest(releaseEvent()));
      expect(dispatchedTasks()).toEqual(["onshape-release"]);
    });

    it("counts auto-create as a consumer in its own right", async () => {
      // Without this term a company that turns auto-create on and everything
      // else off receives no events at all.
      getIntegration.mockResolvedValue(
        integrationRow({
          attachAssetsOnRelease: false,
          releaseImportMode: "off",
          createItemsOnRelease: true
        })
      );
      await run(makeRequest(releaseEvent()));
      expect(dispatchedTasks()).toEqual(["onshape-release"]);
    });

    it("does not treat a non-true createItemsOnRelease as a consumer", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          attachAssetsOnRelease: false,
          releaseImportMode: "off",
          createItemsOnRelease: "yes"
        })
      );
      const result = await run(makeRequest(releaseEvent()));
      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });

    it("rejects an inactive integration before reading the body", async () => {
      getIntegration.mockResolvedValue(integrationRow({}, false));
      const result = await run(makeRequest(releaseEvent()));
      expect(statusOf(result)).toBe(400);
      expect(dispatchedTasks()).toEqual([]);
    });
  });

  describe("release identity on the payload", () => {
    beforeEach(() => {
      getIntegration.mockResolvedValue(integrationRow({}));
    });

    it("forwards the whole released identity to the release job", async () => {
      await run(makeRequest(releaseEvent()));
      expect(payloadFor("onshape-release")).toMatchObject({
        companyId: COMPANY_ID,
        userId: INSTALLER,
        messageId: "msg-1",
        partNumber: "PRT-1000",
        documentId: "doc-1",
        versionId: "ver-1",
        elementId: "el-1",
        elementType: 1,
        releaseId: "release-1",
        releaseName: "REL-001",
        revision: "B"
      });
    });

    it("groups the siblings of one release on releaseId", async () => {
      await run(makeRequest(releaseEvent()));
      expect(payloadFor("onshape-release")).toMatchObject({
        groupKey: "release-1"
      });
    });

    it("falls back to the element when a delivery carries no releaseId", async () => {
      // Its own bucket, rather than one shared with every other company's.
      await run(makeRequest(releaseEvent({ releaseId: undefined })));
      expect(payloadFor("onshape-release")).toMatchObject({
        groupKey: "el-1"
      });
    });

    it("forwards a drawing, which the job's own policy handles", async () => {
      await run(makeRequest(releaseEvent({ elementType: 2 })));
      expect(dispatchedTasks()).toEqual(["onshape-release"]);
      expect(payloadFor("onshape-release")).toMatchObject({ elementType: 2 });
    });

    it("dispatches nothing when required identity fields are missing", async () => {
      const result = await run(
        makeRequest(releaseEvent({ elementId: undefined }))
      );
      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });

    it("drops a delivery with no part number", async () => {
      const result = await run(
        makeRequest(releaseEvent({ partNumber: undefined }))
      );
      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });
  });

  describe("the vaulted signing secret", () => {
    it("reads the secret from the vault, not from the metadata column", async () => {
      // The column no longer holds it. If the receiver read metadata directly it
      // would find nothing and silently drop to unsigned mode.
      getIntegration.mockResolvedValue(integrationRow({}));
      resolveIntegrationSecrets.mockResolvedValueOnce({
        webhookSigningSecret: SECRET
      });
      const result = await run(makeRequest(releaseEvent()));
      expect(statusOf(result)).toBe(401);
      expect(dispatchedTasks()).toEqual([]);
    });

    it("refuses rather than processing unverified when the vault read fails", async () => {
      // Distinct from "no secret configured": we cannot tell whether this
      // company requires a signature, so 503 and let Onshape retry.
      getIntegration.mockResolvedValue(integrationRow({}));
      resolveIntegrationSecrets.mockRejectedValueOnce(new Error("vault down"));
      const result = await run(makeRequest(releaseEvent()));
      expect(statusOf(result)).toBe(503);
      expect(dispatchedTasks()).toEqual([]);
    });
  });
  describe("other events", () => {
    beforeEach(() => {
      getIntegration.mockResolvedValue(
        integrationRow({ releaseImportEnabled: true })
      );
    });

    it("acks workflow.transition without dispatching", async () => {
      const result = await run(
        makeRequest({ event: "onshape.workflow.transition", messageId: "m" })
      );

      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });

    it("acks system events such as webhook.register", async () => {
      const result = await run(
        makeRequest({ event: "webhook.register", messageId: "m" })
      );

      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });

    it("rejects a body that is not valid JSON", async () => {
      const response = await run(
        new Request(`http://localhost/api/webhook/onshape/${COMPANY_ID}`, {
          method: "POST",
          body: "not json",
          headers: { "content-type": "application/json" }
        })
      );

      expect(statusOf(response)).toBe(400);
    });
  });

  describe("optional signature verification", () => {
    const now = () => String(Date.now());

    it("accepts an unsigned delivery when no secret is configured", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({ releaseImportEnabled: true })
      );

      const result = await run(makeRequest(releaseEvent()));

      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual(["onshape-release"]);
    });

    it("treats an empty secret as absent", async () => {
      // The declared-settings merge is shallow, so clearing the field writes ""
      // rather than removing the key.
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: "   "
        })
      );

      const result = await run(makeRequest(releaseEvent()));

      expect(result).toEqual({ success: true });
    });

    it("rejects an unsigned delivery once a secret is configured", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: SECRET
        })
      );

      const response = await run(makeRequest(releaseEvent()));

      expect(statusOf(response)).toBe(401);
      expect(dispatchedTasks()).toEqual([]);
    });

    it("accepts a valid primary signature", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: SECRET
        })
      );
      const body = releaseEvent();
      const timestamp = now();

      const result = await run(
        makeRequest(body, { timestamp, primary: sign(body, timestamp) })
      );

      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual(["onshape-release"]);
    });

    it("accepts a valid secondary signature so key rotation is zero-downtime", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: SECRET
        })
      );
      const body = releaseEvent();
      const timestamp = now();

      const result = await run(
        makeRequest(body, {
          timestamp,
          primary: "signed-with-the-retired-key",
          secondary: sign(body, timestamp)
        })
      );

      expect(result).toEqual({ success: true });
    });

    it("rejects a signature over a stale timestamp", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: SECRET
        })
      );
      const body = releaseEvent();
      const stale = String(Date.now() - 10 * 60 * 1000);

      const response = await run(
        makeRequest(body, { timestamp: stale, primary: sign(body, stale) })
      );

      expect(statusOf(response)).toBe(401);
    });

    it("rejects a tampered body", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: SECRET
        })
      );
      const timestamp = now();
      const signature = sign(releaseEvent(), timestamp);

      const response = await run(
        makeRequest(releaseEvent({ partNumber: "PRT-9999" }), {
          timestamp,
          primary: signature
        })
      );

      expect(statusOf(response)).toBe(401);
    });

    it("rejects a wrong-length signature without throwing", async () => {
      // crypto.timingSafeEqual throws on a length mismatch, so the length has
      // to be checked first or this is a 500 instead of a 401.
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: SECRET
        })
      );
      const timestamp = now();

      const response = await run(
        makeRequest(releaseEvent(), { timestamp, primary: "aa" })
      );

      expect(statusOf(response)).toBe(401);
    });

    it("rejects a signed delivery with no timestamp header", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          releaseImportEnabled: true,
          webhookSigningSecret: SECRET
        })
      );
      const body = releaseEvent();

      const response = await run(
        makeRequest(body, { primary: sign(body, "0") })
      );

      expect(statusOf(response)).toBe(401);
    });
  });
});
