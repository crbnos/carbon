// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getOnshapeIntegration,
  ONSHAPE_INTEGRATION_IDS
} from "@carbon/ee/onshape";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { trigger } from "@carbon/jobs";
import { inngest } from "@carbon/lib/inngest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

// Inbound receiver for Onshape lifecycle webhooks (mirrors
// webhook.jira.$companyId.ts / webhook.linear.$companyId.ts).
//
//   Onshape ──POST──▶ /api/webhook/onshape/:companyId
//                        │  resolve companyId + its active Onshape connection
//                        │  (public app or Government private app)
//                        │  validate minimal envelope, log the event
//                        ▼
//     onshape.revision.created ──▶ trigger("onshape-revision-sync")
//     onshape.model.translation.complete
//                              ──▶ carbon/onshape-translation-complete (wakes
//                                  the element sync waiting on it)
//     everything else          ──▶ ack 200 (logged, no dispatch)
//
// The translation webhook is registered by the element sync for any Onshape
// connection, the panel's included, so it and Onshape's own webhook.* events
// are answered before the sync connection's checks: a webhook answered with an
// error is dropped by Onshape.
//
// AUTH: like the jira/linear receivers, no signature verification — the endpoint
// relies on the callback URL + the active-integration check. A forged event can't
// inject content: the sync job re-resolves the released revision against the
// Onshape API, so at worst it triggers a sync of a genuinely released revision.

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
    revisionId: z.string().optional()
  })
  .passthrough();

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

  let body: unknown;
  try {
    body = await request.json();
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

  const serviceRole = getCarbonServiceRole();

  if (
    parsed.data.event === "onshape.model.translation.complete" ||
    parsed.data.event.startsWith("webhook.")
  ) {
    const connection = await serviceRole
      .from("companyIntegration")
      .select("id")
      .in("id", [...ONSHAPE_INTEGRATION_IDS, ONSHAPE_V2_INTEGRATION_ID])
      .eq("companyId", companyId)
      .eq("active", true)
      .limit(1);
    if (connection.error) {
      console.error(
        "Onshape webhook: integration query failed",
        connection.error
      );
      return data(
        { success: false, error: "Integration query failed" },
        { status: 400 }
      );
    }
    if (connection.data.length === 0) {
      return data(
        { success: false, error: "Integration not active" },
        { status: 400 }
      );
    }
    // Only a wake-up: the sync reads the translation from Onshape itself.
    if (parsed.data.translationId) {
      await inngest.send({
        name: "carbon/onshape-translation-complete",
        data: { companyId, translationId: parsed.data.translationId }
      });
    }
    return { success: true };
  }

  const integration = await getOnshapeIntegration(serviceRole, companyId);

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

  // Defense-in-depth: only process events while asset sync is enabled. If a
  // deregister failed when the toggle was turned off, the subscription can
  // linger — drop (ack 200 so Onshape doesn't retry) rather than dispatch.
  const integrationMetadata = (integration.data.metadata ?? {}) as Record<
    string,
    unknown
  >;
  if (integrationMetadata.assetSyncEnabled !== true) {
    console.log("Onshape webhook: asset sync disabled; ignoring event", {
      companyId
    });
    return { success: true };
  }

  const {
    event,
    messageId,
    documentId,
    elementId,
    versionId,
    partNumber,
    elementType,
    revisionId
  } = parsed.data;

  console.log("Onshape webhook received", {
    companyId,
    event,
    messageId,
    partNumber,
    documentId,
    versionId,
    elementId,
    elementType
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
      await trigger("onshape-revision-sync", {
        companyId,
        userId: installerUserId,
        messageId,
        partNumber,
        documentId,
        versionId,
        elementId,
        elementType,
        revisionId
      });
      break;
    }
    case "onshape.workflow.transition":
      // The release-workflow wrapper — thin (only a release-package objectId + the
      // transition name). We act on the per-element onshape.revision.created events
      // that follow a release instead, so there is nothing to dispatch here.
      break;
    default:
      // Anything we don't handle: ack so Onshape doesn't retry-storm; the log
      // above captures it.
      break;
  }

  // Always ack a well-formed, authorized event so Onshape does not retry.
  return { success: true };
}
