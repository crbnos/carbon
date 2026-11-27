// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import { requestHandlingTypescript } from "../../sources/inputs";

// The client IP, protocol, host and origin come from the proxy in front of the
// app, and each proxy we run behind writes those headers differently: the ALB
// APPENDS to a caller's X-Forwarded-For, so its first entry is forgeable. Reading
// them by hand is how login rate limits and ITAR audit records ended up keyed on
// an address the caller chose. getClientIp / getRequestProtocol / getRequestHost /
// getRequestOrigin in @carbon/utils are the one reading.
export const noRawForwardedHeaders = defineCheck({
  files: requestHandlingTypescript,
  id: "no-raw-forwarded-headers",
  description:
    "Read the client IP / protocol / host / origin with the @carbon/utils request helpers",
  provenance: {
    deprecates:
      "reading X-Forwarded-For / -Host / -Proto or X-Real-IP at call sites",
    replacedBy:
      "getClientIp, getRequestProtocol, getRequestHost, getRequestOrigin (@carbon/utils)",
    since: "2026-09-28"
  },
  within: "line",
  snippet: "trimmed-line",
  except: ["packages/utils/src/headers.ts"],
  mayContain: /x-forwarded-|x-real-ip/i,
  banned: [
    {
      pattern:
        /(?:\.(?:get|has)\(\s*|\[\s*)["'`](?:x-forwarded-(?:for|host|proto)|x-real-ip)["'`]/gi,
      message:
        "Use getClientIp / getRequestProtocol / getRequestHost / getRequestOrigin from @carbon/utils"
    }
  ]
});
