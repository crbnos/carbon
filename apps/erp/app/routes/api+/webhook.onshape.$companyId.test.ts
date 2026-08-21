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

  describe("the enabled gate", () => {
    it("acks and dispatches nothing when neither consumer is enabled", async () => {
      getIntegration.mockResolvedValue(integrationRow({}));

      const result = await run(makeRequest(releaseEvent()));

      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });

    it("dispatches ONLY the v2 job when the company is on the v2 pipeline", async () => {
      // A company that migrated to v2 with the legacy toggles still on would
      // otherwise have BOTH pipelines act on one release: duplicate change
      // notices, and every export run twice. Exactly one pipeline runs.
      getIntegration.mockResolvedValue(
        integrationRow({
          pipeline: "next",
          assetSyncEnabled: true,
          releaseImportEnabled: true
        })
      );

      const result = await run(makeRequest(releaseEvent()));

      expect(result).toEqual({ success: true });
      // Neither legacy job runs, whatever their stored toggles say.
      expect(dispatchedTasks()).toEqual(["onshape-release-v2"]);
    });

    it("does not drop a v2 company's event for want of the legacy flags", async () => {
      // The either-flag gate reads only the LEGACY toggles, which a v2 company
      // has off — so before pipeline routing existed, a v2 company's releases
      // were discarded at the gate and nothing said so.
      getIntegration.mockResolvedValue(integrationRow({ pipeline: "next" }));

      const result = await run(makeRequest(releaseEvent()));

      expect(result).toEqual({ success: true });
      // Reaches the v2 job on the v2 defaults alone (attach on, import
      // changeNotice) — the legacy toggles are irrelevant to it.
      expect(dispatchedTasks()).toEqual(["onshape-release-v2"]);
    });

    it("treats a v2 company with release import off as having no release consumer", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({
          pipeline: "next",
          attachAssetsOnRelease: false,
          releaseImportV2: "off"
        })
      );

      const result = await run(makeRequest(releaseEvent()));

      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual([]);
    });

    it('is unaffected by a pipeline value that is not exactly "next"', async () => {
      getIntegration.mockResolvedValue(
        integrationRow({ pipeline: "Next", assetSyncEnabled: true })
      );

      await run(makeRequest(releaseEvent()));

      // Anything that is not exactly "next" is legacy, so legacy still runs.
      expect(dispatchedTasks()).toEqual(["onshape-revision-sync"]);
    });

    it("dispatches only the asset sync when only asset sync is on", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({ assetSyncEnabled: true })
      );

      await run(makeRequest(releaseEvent()));

      expect(dispatchedTasks()).toEqual(["onshape-revision-sync"]);
    });

    it("dispatches only the release import when only release import is on", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({ releaseImportEnabled: true })
      );

      await run(makeRequest(releaseEvent()));

      expect(dispatchedTasks()).toEqual(["onshape-release-import"]);
    });

    it("dispatches both when both are on", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({ assetSyncEnabled: true, releaseImportEnabled: true })
      );

      await run(makeRequest(releaseEvent()));

      expect(dispatchedTasks()).toEqual([
        "onshape-revision-sync",
        "onshape-release-import"
      ]);
    });

    it("rejects an inactive integration before reading the body", async () => {
      getIntegration.mockResolvedValue(
        integrationRow({ releaseImportEnabled: true }, false)
      );

      const response = await run(makeRequest(releaseEvent()));

      expect(statusOf(response)).toBe(400);
      expect(dispatchedTasks()).toEqual([]);
    });
  });

  describe("release identity on the payload", () => {
    beforeEach(() => {
      getIntegration.mockResolvedValue(
        integrationRow({ assetSyncEnabled: true, releaseImportEnabled: true })
      );
    });

    it("forwards releaseId, revision and releaseName to the release import", async () => {
      await run(makeRequest(releaseEvent()));

      expect(payloadFor("onshape-release-import")).toMatchObject({
        companyId: COMPANY_ID,
        userId: INSTALLER,
        messageId: "msg-1",
        releaseId: "release-1",
        releaseName: "REL-001",
        revision: "B",
        partNumber: "PRT-1000"
      });
    });

    it("also carries releaseId and revision on the asset sync payload", async () => {
      await run(makeRequest(releaseEvent()));

      expect(payloadFor("onshape-revision-sync")).toMatchObject({
        releaseId: "release-1",
        revision: "B"
      });
    });

    it("skips the release import without a releaseId but still syncs assets", async () => {
      await run(makeRequest(releaseEvent({ releaseId: undefined })));

      // releaseId is the claim key — without it the siblings of one release
      // cannot be grouped, so importing would produce a notice per element.
      expect(dispatchedTasks()).toEqual(["onshape-revision-sync"]);
    });

    it("excludes drawings from the release import but still syncs their assets", async () => {
      await run(makeRequest(releaseEvent({ elementType: 2 })));

      // A released drawing resolves to the SAME Carbon item as the model it
      // documents, so importing it would violate UNIQUE(changeOrderId, itemId).
      expect(dispatchedTasks()).toEqual(["onshape-revision-sync"]);
    });

    it("dispatches nothing when required identity fields are missing", async () => {
      await run(makeRequest(releaseEvent({ partNumber: undefined })));

      expect(dispatchedTasks()).toEqual([]);
    });

    it("forwards a drawing to the v2 job, which owns the drawing policy", async () => {
      // Phase 7's resolver lives in onshape-release-v2, so the receiver must
      // NOT filter drawings out on the v2 pipeline the way it does on legacy.
      // This is the test that says work item 3 needed no webhook change.
      getIntegration.mockResolvedValue(integrationRow({ pipeline: "next" }));

      const result = await run(makeRequest(releaseEvent({ elementType: 2 })));

      expect(result).toEqual({ success: true });
      expect(dispatchedTasks()).toEqual(["onshape-release-v2"]);
      expect(vi.mocked(trigger).mock.calls[0]?.[1]).toMatchObject({
        elementType: 2
      });
    });

    it("still drops a drawing with no part number, on either pipeline", async () => {
      // Onshape's release dialog makes a drawing's part number REQUIRED and
      // blocks the release without one, so this gate cannot fire for a genuinely
      // released drawing. Do not relax it on the old "a drawing has no part
      // number" reasoning — that described an UNRELEASED drawing.
      getIntegration.mockResolvedValue(integrationRow({ pipeline: "next" }));

      await run(
        makeRequest(releaseEvent({ elementType: 2, partNumber: undefined }))
      );

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
      expect(dispatchedTasks()).toEqual(["onshape-release-import"]);
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
      expect(dispatchedTasks()).toEqual(["onshape-release-import"]);
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
