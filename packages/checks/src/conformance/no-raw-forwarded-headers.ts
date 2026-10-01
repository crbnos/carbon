// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// The client IP, protocol, host and origin come from the proxy in front of the
// app, and each proxy we run behind writes those headers differently: the ALB
// APPENDS to a caller's X-Forwarded-For, so its first entry is forgeable. Reading
// them by hand is how login rate limits and ITAR audit records ended up keyed on
// an address the caller chose. getClientIp / getRequestProtocol / getRequestHost /
// getRequestOrigin in @carbon/utils are the one reading.
const RAW_READ =
  /(?:\.(?:get|has)\(\s*|\[\s*)["'`](?:x-forwarded-(?:for|host|proto)|x-real-ip)["'`]/i;

const HELPERS = "packages/utils/src/headers.ts";

export const noRawForwardedHeaders: ConformanceCheck = {
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
  scan(file: string, contents: string): Violation[] {
    if (file === HELPERS) return [];
    const violations: Violation[] = [];
    contents.split("\n").forEach((text, i) => {
      if (!RAW_READ.test(text)) return;
      violations.push({
        file,
        line: i + 1,
        snippet: text.trim(),
        message:
          "Use getClientIp / getRequestProtocol / getRequestHost / getRequestOrigin from @carbon/utils"
      });
    });
    return violations;
  }
};
