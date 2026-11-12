// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  fileResponseHeaders,
  isStorageNotFound,
  storage,
  storageErrorStatus
} from "@carbon/files";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { getClientIp, stripSpecialCharacters } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  type CustomerPortalDocumentType,
  getActiveCustomerPortal,
  resolveCustomerPortalDocument
} from "~/modules/sales/sales.service";

const logger = getLogger("erp", "share", "customer-portal-document");
const documentTypes = new Set<CustomerPortalDocumentType>([
  "quote",
  "invoice",
  "packing-slip",
  "acknowledgement",
  "coc",
  "test-report"
]);

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id, type, documentId } = params;
  if (
    !id ||
    !type ||
    !documentId ||
    !documentTypes.has(type as CustomerPortalDocumentType)
  ) {
    return new Response(null, { status: 404 });
  }

  const serviceRole = getCarbonServiceRole();
  const portal = await getActiveCustomerPortal(serviceRole, id);
  if (portal.refusal) {
    return new Response(null, {
      status: portal.refusal === "error" ? 500 : 404
    });
  }

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    analytics: true
  });
  const limit = await ratelimit.limit(
    `customer-document:${id}:${getClientIp(request) ?? "127.0.0.1"}`
  );
  if (!limit.success) return new Response(null, { status: 429 });

  let pdf: Awaited<ReturnType<typeof resolveCustomerPortalDocument>>;
  try {
    pdf = await resolveCustomerPortalDocument(
      serviceRole,
      { companyId: portal.data.companyId, customerId: portal.data.customerId },
      type as CustomerPortalDocumentType,
      documentId
    );
  } catch (error) {
    logger.error("Failed to resolve portal document", {
      companyId: portal.data.companyId,
      documentType: type,
      documentId,
      error
    });
    return new Response(null, { status: 500 });
  }
  if (!pdf) return new Response(null, { status: 404 });

  const file = await storage(serviceRole)
    .company(portal.data.companyId)
    .download(pdf.path);
  if (file.error) {
    logger.error("Failed to download portal document", {
      companyId: portal.data.companyId,
      documentType: type,
      documentId,
      status: storageErrorStatus(file.error),
      error: file.error
    });
    return new Response(null, {
      status: (await isStorageNotFound(file.error)) ? 404 : 500
    });
  }

  const headers = fileResponseHeaders("application/pdf", "private, no-store");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${stripSpecialCharacters(pdf.name)}"`
  );
  return new Response(file.data, { status: 200, headers });
}
