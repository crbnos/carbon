import { assertIsPost, getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationSecrets } from "@carbon/ee";
import {
  buildPunchOutSetupRequest,
  parsePunchOutSetupResponse
} from "@carbon/ee/punchout";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  createPunchoutSession,
  mcmasterIntegrationMetadataValidator,
  punchoutStartValidator,
  updatePunchoutSession
} from "~/modules/purchasing";
import { getIntegration } from "~/modules/settings/settings.service";
import { getUser } from "~/modules/users/users.server";

const INTEGRATION_ID = "mcmaster-carr";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(punchoutStartValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  const integration = await getIntegration(
    serviceRole,
    INTEGRATION_ID,
    companyId
  );
  if (!integration.data || !integration.data.active) {
    return data(
      { error: "McMaster-Carr integration is not installed" },
      { status: 400 }
    );
  }

  const resolved = await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    INTEGRATION_ID,
    integration.data.metadata,
    integration.data.secretRef
  );
  const parsedMetadata =
    mcmasterIntegrationMetadataValidator.safeParse(resolved);
  if (!parsedMetadata.success) {
    return data(
      { error: "McMaster-Carr integration is misconfigured" },
      { status: 400 }
    );
  }
  const metadata = parsedMetadata.data;

  const session = await createPunchoutSession(client, {
    companyId,
    integrationId: INTEGRATION_ID,
    supplierId: metadata.supplierId,
    purchaseOrderId: validation.data.purchaseOrderId || null,
    createdBy: userId
  });
  if (session.error || !session.data) {
    return data({ error: "Failed to start punchout session" }, { status: 500 });
  }

  // getAppUrl() is the public ERP origin (ERP_URL) — request.url resolves to the
  // internal proxied host, which McMaster must never receive as the return URL.
  const origin = getAppUrl();
  const returnUrl = `${origin}/api/punchout/${session.data.id}/return`;

  const user = await getUser(serviceRole, userId);
  const posr = buildPunchOutSetupRequest({
    credentials: {
      from: { domain: metadata.fromDomain, identity: metadata.fromIdentity },
      to: { domain: metadata.toDomain, identity: metadata.toIdentity },
      sender: { domain: metadata.fromDomain, identity: metadata.fromIdentity },
      sharedSecret: metadata.sharedSecret ?? "",
      deploymentMode:
        metadata.environment === "Production" ? "production" : "test",
      userAgent: "Carbon"
    },
    buyerCookie: session.data.buyerCookie,
    returnUrl,
    userEmail: user.data?.email ?? null,
    userName: user.data ? `${user.data.firstName} ${user.data.lastName}` : null,
    payloadId: `${session.data.id}@carbon`,
    timestamp: datetime.timestamp()
  });

  let response: Response;
  try {
    response = await fetch(metadata.punchoutUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: posr,
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    await updatePunchoutSession(client, {
      id: session.data.id,
      companyId,
      status: "Cancelled",
      updatedBy: userId
    });
    return data({ error: "Could not reach McMaster-Carr" }, { status: 502 });
  }

  const responseXml = await response.text();
  const parsed = parsePunchOutSetupResponse(responseXml);
  if (
    !parsed.data ||
    parsed.data.statusCode >= 300 ||
    !parsed.data.startPageUrl
  ) {
    await updatePunchoutSession(client, {
      id: session.data.id,
      companyId,
      status: "Cancelled",
      updatedBy: userId
    });
    return data(
      { error: "McMaster-Carr did not return a shopping session" },
      { status: 502 }
    );
  }

  return { startPageUrl: parsed.data.startPageUrl, sessionId: session.data.id };
}
