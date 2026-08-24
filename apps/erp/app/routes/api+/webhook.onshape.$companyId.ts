import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import crypto from "crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getIntegration } from "../../modules/settings";

// Inbound receiver for Onshape lifecycle webhooks (mirrors
// webhook.jira.$companyId.ts / webhook.linear.$companyId.ts).
//
//   Onshape ──POST──▶ /api/webhook/onshape/:companyId
//                        │  resolve companyId + active onshape integration
//                        │  drop unless asset sync OR release import is on
//                        │  verify HMAC when a signing secret is configured
//                        │  validate minimal envelope, log the event
//                        ▼
//     onshape.revision.created ──▶ trigger("onshape-revision-sync")   [assetSyncEnabled]
//                              ──▶ trigger("onshape-release-import")  [releaseImportEnabled]
//                              ──▶ trigger("onshape-release")      [v2: attachAssets |
//                                                                      releaseImportMode |
//                                                                      createItemsOnRelease]
//     everything else          ──▶ ack 200 (logged, no dispatch)
//
// AUTH: signature verification is OPT-IN per company. With no
// metadata.webhookSigningSecret configured the endpoint behaves exactly as it
// always has — it relies on the callback URL + the active-integration check, and
// a forged event can't inject content because the sync job re-resolves the
// released revision against the Onshape API. Release import raises the stakes
// (a forged event creates Draft change notices, and the endpoint is enumerable),
// so a company can set a secret and have everything else rejected. Fail-open
// when absent is what keeps an existing customer's behaviour byte-identical.

// Minimal envelope — only fields confirmed against Onshape's webhook docs. Kept
// permissive (passthrough) on purpose so real events aren't rejected if Onshape
// adds fields; unhandled events are logged rather than errored.
const onshapeWebhookEnvelope = z
  .object({
    event: z.string(),
    messageId: z.string().optional(),
    webhookId: z.string().optional(),
    documentId: z.string().optional(),
    workspaceId: z.string().optional(),
    elementId: z.string().optional(),
    versionId: z.string().optional(),
    translationId: z.string().optional(),
    // onshape.revision.created carries the released element identity directly.
    partNumber: z.string().optional(),
    elementType: z.number().optional(), // 0 = part studio, 1 = assembly, 2 = drawing
    revisionId: z.string().optional(),
    // Release-package identity + the revision LETTER. Both already arrive and
    // already survive .passthrough(); they were simply never destructured.
    // releaseId is what groups the per-element events of one release — there is
    // no release-level Onshape event to key on.
    releaseId: z.string().optional(),
    releaseName: z.string().optional(),
    revision: z.string().optional()
  })
  .passthrough();

// Onshape signs each delivery as Base64(HMAC-SHA256(key, "<timestamp>.<body>")),
// sending it in BOTH a -primary and a -secondary header so a key rotation is
// zero-downtime. Accept either. Reject a timestamp older than this window so a
// captured delivery cannot be replayed indefinitely.
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function signaturesMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  // timingSafeEqual THROWS on a length mismatch, so length has to be checked
  // first — and an unequal length is already a mismatch.
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function verifyOnshapeSignature(
  request: Request,
  rawBody: string,
  secret: string
): { ok: true } | { ok: false; reason: string } {
  const timestamp = request.headers.get("x-onshape-webhook-timestamp");
  if (!timestamp) {
    return { ok: false, reason: "missing timestamp header" };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "unparseable timestamp header" };
  }
  // Absolute-instant comparison only — never rendered, never stored. This is the
  // narrow case the date-handling rule allows a raw epoch for.
  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
    return { ok: false, reason: "timestamp outside the accepted window" };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("base64");

  const matched =
    signaturesMatch(
      expected,
      request.headers.get("x-onshape-webhook-signature-primary")
    ) ||
    signaturesMatch(
      expected,
      request.headers.get("x-onshape-webhook-signature-secondary")
    );

  return matched ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

export async function loader({ params }: LoaderFunctionArgs) {
  // Onshape (and manual health checks) may GET this endpoint to validate it.
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return { success: true };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;

  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  const serviceRole = getCarbonServiceRole();
  const integration = await getIntegration(serviceRole, "onshape", companyId);

  if (integration.error) {
    console.error(
      "Onshape webhook: integration query failed",
      integration.error
    );
    return data(
      { success: false, error: "Integration query failed" },
      { status: 400 }
    );
  }

  if (!integration.data) {
    return data(
      { success: false, error: "Integration not configured" },
      { status: 400 }
    );
  }

  if (!integration.data.active) {
    return data(
      { success: false, error: "Integration not active" },
      { status: 400 }
    );
  }

  // Defense-in-depth: only process events while at least one consumer is
  // enabled. If a deregister failed when the toggles were turned off, the
  // subscription can linger — drop (ack 200 so Onshape doesn't retry) rather
  // than dispatch. Both reads stay strict `!== true`, and this gate stays
  // BEFORE the body is read, so a company that has opted into neither takes a
  // byte-identical path to before release import existed.
  const integrationMetadata = (integration.data.metadata ?? {}) as Record<
    string,
    unknown
  >;
  // Which pipeline this company runs. Strict equality against the NEW value, so
  // an absent key — every existing install — is legacy by construction.
  const isV2 = integrationMetadata.pipeline === "next";

  // The legacy consumers. On a v2 company these are DEAD regardless of their
  // stored values: a company that migrated with them left on would otherwise
  // have both pipelines act on the same release, producing duplicate change
  // notices and double the export calls. Exactly one pipeline runs.
  const assetSyncEnabled =
    !isV2 && integrationMetadata.assetSyncEnabled === true;
  const releaseImportEnabled =
    !isV2 && integrationMetadata.releaseImportEnabled === true;

  // The v2 consumers, read only when v2 is selected.
  const v2AttachAssets =
    isV2 && integrationMetadata.attachAssetsOnRelease !== false;
  const v2ReleaseImportMode = isV2
    ? ((integrationMetadata.releaseImportMode as string | undefined) ??
      "changeNotice")
    : "off";
  const v2ReleaseImportEnabled = isV2 && v2ReleaseImportMode !== "off";
  // Strict `=== true`, matching allowUnreleasedSync and NOT
  // attachAssetsOnRelease's `!== false`: an absent key must read as off, or
  // every existing v2 install starts minting parts on deploy.
  const v2CreateItems =
    isV2 && integrationMetadata.createItemsOnRelease === true;

  if (
    !assetSyncEnabled &&
    !releaseImportEnabled &&
    !v2AttachAssets &&
    !v2ReleaseImportEnabled &&
    !v2CreateItems
  ) {
    console.log("Onshape webhook: no consumer enabled; ignoring event", {
      companyId,
      pipeline: isV2 ? "next" : "legacy"
    });
    return { success: true };
  }

  // Read the body as TEXT once: HMAC verification needs the exact bytes Onshape
  // signed, so re-serialising a parsed object would not reproduce them.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (readError) {
    console.error("Onshape webhook: could not read body", readError);
    return data({ success: false, error: "Unreadable body" }, { status: 400 });
  }

  // Opt-in signature verification. An empty string counts as absent: the
  // declared-settings merge is shallow, so clearing the field on a later save
  // writes "" rather than removing the key.
  const signingSecret =
    typeof integrationMetadata.webhookSigningSecret === "string"
      ? integrationMetadata.webhookSigningSecret.trim()
      : "";
  if (signingSecret) {
    const verified = verifyOnshapeSignature(request, rawBody, signingSecret);
    if (!verified.ok) {
      console.warn("Onshape webhook: signature verification failed", {
        companyId,
        reason: verified.reason
      });
      return data(
        { success: false, error: "Invalid signature" },
        { status: 401 }
      );
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (parseError) {
    console.error("Onshape webhook: body is not valid JSON", parseError);
    return data(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = onshapeWebhookEnvelope.safeParse(body);

  if (!parsed.success) {
    return data(
      { success: false, error: parsed.error.format() },
      { status: 400 }
    );
  }

  const {
    event,
    messageId,
    documentId,
    elementId,
    versionId,
    partNumber,
    elementType,
    revisionId,
    releaseId,
    releaseName,
    revision
  } = parsed.data;

  console.log("Onshape webhook received", {
    companyId,
    event,
    messageId,
    partNumber,
    documentId,
    versionId,
    elementId,
    elementType,
    releaseId,
    revision
  });

  switch (event) {
    case "onshape.revision.created": {
      // Go-forward trigger: a part/assembly was released. This event carries the
      // released element's identity directly (documentId/versionId/elementId/
      // elementType/partNumber), so we dispatch the sync job to attach its CAD
      // model to the matching Carbon item. Idempotency is on messageId (see the
      // onshape-revision-sync function). The acting user is the integration
      // installer (the webhook itself is unauthenticated).
      const installerUserId = integration.data.updatedBy;
      if (
        !installerUserId ||
        !messageId ||
        !partNumber ||
        !documentId ||
        !versionId ||
        !elementId ||
        typeof elementType !== "number"
      ) {
        console.warn(
          "Onshape webhook: revision.created missing required fields; skipping dispatch",
          { companyId, messageId, partNumber }
        );
        break;
      }
      if (assetSyncEnabled) {
        await trigger("onshape-revision-sync", {
          companyId,
          userId: installerUserId,
          messageId,
          partNumber,
          documentId,
          versionId,
          elementId,
          elementType,
          revisionId,
          releaseId,
          revision
        });
      }

      if (isV2) {
        // ONE job for the whole event: v2 attaches assets and imports the
        // release in order, because a separate asset job would race the import
        // that creates the item it needs to attach to. The job owns the policy
        // (which consumers are on, what to do with a drawing) so the receiver
        // stays a router.
        if (v2AttachAssets || v2ReleaseImportEnabled || v2CreateItems) {
          await trigger("onshape-release", {
            companyId,
            userId: installerUserId,
            messageId,
            documentId,
            versionId,
            elementId,
            elementType,
            partNumber,
            revisionId,
            releaseId,
            releaseName,
            revision,
            // Serialize the siblings of one release. Falling back to the
            // element keeps a releaseId-less delivery in its own bucket
            // instead of sharing one with every other company's.
            groupKey: releaseId ?? elementId
          });
        }
        // Exclusive: never fall through to the legacy dispatches.
        break;
      }

      if (releaseImportEnabled) {
        // releaseId is the claim key — one change notice per release package.
        // Without it the siblings of a release cannot be grouped, so importing
        // would produce one notice per element. Skip loudly rather than that.
        if (!releaseId) {
          console.warn(
            "Onshape webhook: revision.created without releaseId; skipping release import",
            { companyId, messageId, partNumber }
          );
        } else if (elementType === 2) {
          // A released DRAWING is its own DRW-xxxx element that resolves to the
          // SAME Carbon item as the model it documents (see the elementType-2
          // branch of onshape-revision-sync). Importing it as a second affected
          // item violates UNIQUE(changeOrderId, itemId) on the FIRST import of a
          // normal release; deriving its change type from readableId instead
          // mints a junk DRW-xxxx part. The drawing PDF still reaches the item
          // through asset sync.
          console.log(
            "Onshape webhook: drawing element; skipping release import",
            { companyId, messageId, partNumber }
          );
        } else {
          await trigger("onshape-release-import", {
            companyId,
            userId: installerUserId,
            messageId,
            releaseId,
            partNumber,
            documentId,
            versionId,
            elementId,
            elementType,
            revisionId,
            revision,
            releaseName
          });
        }
      }
      break;
    }
    case "onshape.workflow.transition":
      // The release-workflow wrapper — thin (only a release-package objectId + the
      // transition name). We act on the per-element onshape.revision.created events
      // that follow a release instead, so there is nothing to dispatch here.
      break;
    default:
      // System events (webhook.register / ping) and anything we don't handle:
      // ack so Onshape doesn't retry-storm; the log above captures them.
      break;
  }

  // Always ack a well-formed, authorized event so Onshape does not retry.
  return { success: true };
}
