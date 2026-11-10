// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getQuoteDisplayId } from "@carbon/documents/utils";
import {
  fileResponseHeaders,
  storage,
  storageErrorStatus
} from "@carbon/files";
import { Ratelimit, redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { getClientIp, stripSpecialCharacters } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  getFinalizedQuotePdf,
  getQuoteByExternalId,
  isExternalQuoteExpired
} from "~/modules/sales/sales.service";

const logger = getLogger("erp", "share", "digital-quote");

// The PDF the quote was finalized with, for the customer holding its share
// link. The path comes from the quote's own document row, never the request.
export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) return new Response(null, { status: 404 });

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    analytics: true
  });
  const { success } = await ratelimit.limit(
    getClientIp(request) ?? "127.0.0.1"
  );
  if (!success) return new Response(null, { status: 429 });

  const serviceRole = getCarbonServiceRole();
  const quote = await getQuoteByExternalId(serviceRole, id);
  if (quote.error) return new Response(null, { status: 404 });

  if (isExternalQuoteExpired(quote.data)) {
    return new Response(null, { status: 404 });
  }

  const pdf = await getFinalizedQuotePdf(serviceRole, quote.data);
  if (!pdf) return new Response(null, { status: 404 });

  const file = await storage(serviceRole)
    .company(quote.data.companyId)
    .download(pdf.path);
  if (file.error) {
    logger.error("Failed to download the finalized quote PDF", {
      companyId: quote.data.companyId,
      quoteId: quote.data.id,
      status: storageErrorStatus(file.error),
      error: file.error
    });
    return new Response(null, { status: 500 });
  }

  const headers = fileResponseHeaders("application/pdf", "private, no-store");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${stripSpecialCharacters(
      getQuoteDisplayId(quote.data)
    )}.pdf"`
  );
  return new Response(file.data, { status: 200, headers });
}
