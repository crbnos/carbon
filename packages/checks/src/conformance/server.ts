// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../check";
import { requestHandlingTypescript, typescript } from "../sources/inputs";
import {
  type Banned,
  bannedHits,
  lineViolations,
  matchViolations
} from "../sources/matches";
import { loadServerFiles } from "../sources/server-files";

// Server: rules for code that handles requests and runs jobs. They cover where
// a redirect may go, how the client's address and the calendar day are read,
// how an error is logged, how Inngest concurrency is set, and how one
// integration is told apart from another.

// React Router's redirect goes wherever it is told. A destination read from a
// query string or a form then sends the browser off-site unless the call site
// remembered to validate it — one signup route did not. `redirect` from
// @carbon/utils only goes to a path on this origin; `redirectExternal` is the
// named way to leave it.
export const noRawRedirect = defineCheck({
  files: requestHandlingTypescript,
  id: "no-raw-redirect",
  description: "Redirect with redirect / redirectExternal from @carbon/utils",
  provenance: {
    deprecates:
      "redirect from react-router, and validating the target at the call site",
    replacedBy: "redirect, redirectExternal (@carbon/utils)",
    since: "2026-10-04"
  },
  rule() {
    const rawImport =
      /import\s*\{[^}]*?\b(redirect|redirectDocument|replace)\b[^}]*\}\s*from\s*["']react-router["']/g;
    return (file, contents) =>
      matchViolations(file, contents, rawImport, (match) => ({
        snippet: `import { ${match[1]} } from "react-router"`,
        message:
          match[1] === "redirect"
            ? "Import redirect from @carbon/utils; use redirectExternal to leave this origin"
            : `${match[1]} from react-router goes wherever it is told; use redirect from @carbon/utils`
      }));
  }
});

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
  rule() {
    const rawRead =
      /(?:\.(?:get|has)\(\s*|\[\s*)["'`](?:x-forwarded-(?:for|host|proto)|x-real-ip)["'`]/i;
    const helpers = "packages/utils/src/headers.ts";
    const message =
      "Use getClientIp / getRequestProtocol / getRequestHost / getRequestOrigin from @carbon/utils";
    return (file, contents) => {
      if (file === helpers) return [];
      return lineViolations(file, contents, rawRead, (text) => [
        { snippet: text.trim(), message }
      ]);
    };
  }
});

// An error log's message is exported as a span attribute and is what errors are
// grouped by. A value interpolated into it (`Failed to upload ${file.name}`)
// makes every occurrence a different error and puts the value in the trace.
// Name it instead: "Failed to upload {fileName}", { fileName: file.name }.
export const noInterpolatedErrorLog = defineCheck({
  files: requestHandlingTypescript,
  id: "no-interpolated-error-log",
  description:
    "Error log messages name their values as {placeholders}, never interpolate them",
  provenance: {
    deprecates: "logger.error(`… ${value}`)",
    replacedBy: 'logger.error("… {value}", { value })',
    since: "2026-10-04"
  },
  rule() {
    const interpolated = /\b\w*[lL]og(?:ger)?\.(?:error|fatal)\(\s*`[^`]*\$\{/g;
    return (file, contents) =>
      matchViolations(file, contents, interpolated, (match) => ({
        snippet: match[0].replace(/\s+/g, " "),
        message:
          'Use a {placeholder} in the message and pass the value as a property: logger.error("Failed to upload {fileName}", { fileName })'
      }));
  }
});

// `limit: 0` inside an Inngest `concurrency` block is no capacity, not
// unlimited: every run parks in QUEUED forever.
export const noZeroConcurrency = defineCheck({
  files: loadServerFiles,
  id: "no-zero-concurrency",
  description: "Inngest concurrency.limit must be >= 1.",
  provenance: {
    deprecates: "concurrency: { limit: 0 }",
    replacedBy: "concurrency: { limit: 1 }"
  },
  rule() {
    // `[^{}]*?` cannot cross a brace, so the match is confined to the
    // concurrency object itself — an unrelated `limit: 0` after it closes (a
    // query limit, a pagination default) is not flagged. A bounded `[\s\S]`
    // span would reach past the `}` and match
    // `concurrency: {}, const q = { limit: 0 }`.
    //
    // The concurrency object contains no nested braces in practice (`limit`,
    // `key`, `scope` are all scalars), so excluding braces entirely is exact
    // rather than approximate.
    const zeroConcurrency = /concurrency\s*:\s*\{[^{}]*?\blimit\s*:\s*0\b/g;
    return (file, contents) =>
      matchViolations(file, contents, zeroConcurrency, (match) => ({
        snippet: match[0].replace(/\s+/g, " "),
        message:
          "concurrency.limit 0 is no capacity, not unlimited — every run parks in QUEUED forever. Use >= 1, or omit the concurrency block."
      }));
  }
});

/**
 * Server code must not derive calendar days from the process timezone. The
 * banned idioms silently disagree with each other whenever TZ ≠ UTC:
 * - getLocalTimeZone() on a server = the server's zone, not the user's
 * - new Date().toISOString().split("T")[0] / .slice(0, 10) = the UTC day
 * - new Date().getDay()/getDate()/... = date parts of "now" in the process zone
 * - d.setHours(0, 0, 0, 0) = midnight in the process zone
 * Use datetime.today(tz) / datetime.businessDay(instant, tz) with a timezone
 * resolved from company.timezone (ledger-scoped) or location.timezone
 * (operational). Full-instant new Date().toISOString() stays allowed —
 * timestamps are timezone-free. UTC getters (getUTCDay etc.) and local getters
 * on a locally-constructed date (new Date(y, m, d).getFullYear() roundtrips)
 * are also fine and deliberately not matched.
 *
 * `loadServerFiles` (`sources/server-files.ts`) chooses the files: the server
 * roots, ERP module `.service.ts`/`.server.ts`, and both apps' route trees. A
 * route module is server and client in one file, so its browser half is
 * blanked first (`maskClientCode`). The loaders, actions and the module-level
 * helpers they call stay.
 */
export const noLocalTimezone = defineCheck({
  files: loadServerFiles,
  id: "no-local-timezone",
  description:
    "Server code derives calendar days via datetime.today(tz), never the process clock or UTC-slicing.",
  provenance: {
    deprecates: "getLocalTimeZone() / toISOString() day-slicing in server code",
    replacedBy: "@carbon/utils datetime + company/location timezone",
    since: "20260805020925_company-timezone.sql",
    // getScheduledEmployeesToday rostered the server's day of week, and
    // getWeeklyHoursForEmployees cut the payroll week at process-zone midnight.
    incidents: ["92c041c48e"]
  },
  rule() {
    const nowMessage =
      'Server code: this is a date part of "now" in the process zone — use datetime.today(tz) / getDayOfWeek with the company/location timezone.';
    const banned: Banned[] = [
      {
        pattern: /getLocalTimeZone\s*\(/g,
        message:
          "Server code: resolve company/location timezone and use datetime.today(tz) — getLocalTimeZone() is the process zone, not the user's."
      },
      {
        // [^)]* also catches supplied instants: new Date(eventAt).toISOString()
        // .slice(0, 10) is that event's UTC day, not its business day.
        pattern:
          /new Date\([^)]*\)\s*\.toISOString\(\)\s*\.(?:split\(\s*["']T["']\s*\)\s*\[0\]|slice\(\s*0,\s*10\s*\))/g,
        message:
          "Server code: this is the UTC calendar day — use datetime.today(tz) / datetime.businessDay(instant, tz) with the company/location timezone."
      },
      {
        pattern:
          /new Date\(\)\s*\.get(?:Day|Date|Month|FullYear|Hours|Minutes)\(/g,
        message: nowMessage
      },
      {
        pattern: /\.setHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/g,
        message:
          "Server code: this is midnight in the process zone — derive the day boundary via today(tz)/startOfWeek(...).toDate(tz) instead."
      }
    ];
    // Text every banned pattern contains, so a line without any is skipped. A
    // file without any is skipped whole: nowLocal needs `new Date(` too.
    const mayBeBanned = /getLocalTimeZone|new Date\(|\.setHours\(/;
    // A local assigned the current instant: `const now = new Date();`.
    const nowLocal = /\b(?:const|let|var)\s+(\w+)\s*=\s*new Date\(\s*\)\s*;/g;
    return (file, contents) => {
      if (!mayBeBanned.test(contents)) return [];
      const nowNames = [...contents.matchAll(nowLocal)].map((m) => m[1]);
      if (nowNames.length === 0) {
        return lineViolations(file, contents, mayBeBanned, (text) =>
          bannedHits(text, banned)
        );
      }
      // `const now = new Date(); now.getDay()` is the same date part of "now",
      // split over two lines, so its second line has none of mayBeBanned.
      const nowPart = String.raw`\b(?:${nowNames.join("|")})\s*\.get(?:Day|Date|Month|FullYear|Hours|Minutes)\(`;
      const withNow: Banned[] = [
        ...banned,
        { pattern: new RegExp(nowPart, "g"), message: nowMessage }
      ];
      return lineViolations(
        file,
        contents,
        new RegExp(`${mayBeBanned.source}|${nowPart}`),
        (text) => bannedHits(text, withNow)
      );
    };
  }
});

// Integration ids are DATA, not control flow. Which integrations are accounting
// providers was answered five different ways before `providerRole` existed —
// three hard-coded id arrays, a display-category string test, and an
// `.eq("id","ramp")` — and each one silently excluded any provider added later.
//
// Ask the registry instead: `getIntegrationsByRole` / `getIntegrationIdsByRole`
// (`@carbon/ee`), or the resolved `IntegrationTopology`.
export const noIntegrationIdBranching = defineCheck({
  files: typescript,
  id: "no-integration-id-branching",
  description:
    "Branch on an integration's declared providerRole or the resolved topology, never on its id",
  provenance: {
    deprecates:
      "hard-coded integration-id comparisons and ad-hoc id arrays outside the registry",
    replacedBy:
      "providerRole + getIntegrationsByRole/getIntegrationIdsByRole (@carbon/ee) or IntegrationTopology",
    since: "20260924133915_integration-provider-role.sql"
  },
  rule() {
    const quoted = [
      "xero",
      "quickbooks",
      "rillet",
      "ramp",
      "sense",
      "slack",
      "jira",
      "linear",
      "onshape",
      "onshape-government",
      "onshape-v2-government",
      "paperless-parts",
      "email",
      "sage",
      "stripe-connect"
    ]
      .map((id) => `["']${id}["']`)
      .join("|");
    const message =
      "Branching on an integration id excludes every provider added later — ask the registry for the role instead (getIntegrationIdsByRole / IntegrationTopology).";
    const branches: Banned[] = [
      // `x === "ramp"`, `x !== "ramp"` — a branch on identity.
      { pattern: new RegExp(`[!=]==?\\s*(?:${quoted})`, "g"), message },
      // `["xero", "quickbooks"]` / `new Set(["ramp", …])` — an ad-hoc membership list.
      {
        pattern: new RegExp(`(?:${quoted})\\s*,\\s*(?:${quoted})`, "g"),
        message
      }
    ];
    // Both branches need a quoted id, so a file or line without one is skipped.
    const anyId = new RegExp(quoted);
    // Files that are legitimately id-keyed: the registry itself, a provider
    // naming ITSELF, and the maps whose whole purpose is per-id data (secret
    // keys, server hooks, error copy).
    const excluded = [
      /^packages\/ee\/src\/index\.ts$/,
      /^packages\/ee\/src\/hooks\.server\.ts$/,
      /^packages\/ee\/src\/integrations\/secrets\.ts$/,
      /^packages\/ee\/src\/sync\//,
      // The issue-tracker sync engine dispatches each linked issue to its
      // tracker, as the accounting sync engine does to its provider.
      /^packages\/ee\/src\/issue-sync\//,
      /^apps\/erp\/app\/modules\/settings\/integration-errors\.ts$/,
      // A provider's own directory may name itself.
      /^packages\/ee\/src\/(xero|quickbooks|rillet|ramp|slack|jira|linear|onshape|paperless-parts|email|sage|stripe-connect|sense)\//
    ];
    return (file, contents) => {
      if (excluded.some((pattern) => pattern.test(file))) return [];
      if (!anyId.test(contents)) return [];
      return lineViolations(file, contents, anyId, (text) =>
        bannedHits(text, branches)
      );
    };
  }
});
