// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../check";
import { type Banned, type Bans, findBanned } from "../sources/matches";
import { loadServerFiles } from "../sources/server-files";

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
 *
 * A `rule()`, not data: a local assigned the current instant
 * (`const now = new Date()`) adds a banned pattern for that file.
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
    // Text every banned pattern contains. A file without any is skipped whole:
    // nowLocal needs `new Date(` too.
    const mayContain = /getLocalTimeZone|new Date\(|\.setHours\(/;
    const plain: Bans = {
      within: "line",
      snippet: "match",
      banned,
      mayContain
    };
    // A local assigned the current instant: `const now = new Date();`.
    const nowLocal = /\b(?:const|let|var)\s+(\w+)\s*=\s*new Date\(\s*\)\s*;/g;
    return (file, contents) => {
      if (!mayContain.test(contents)) return [];
      const nowNames = [...contents.matchAll(nowLocal)].map((m) => m[1]);
      if (nowNames.length === 0) return findBanned(file, contents, plain);
      // `const now = new Date(); now.getDay()` is the same date part of "now",
      // split over two lines, so its second line has none of mayContain.
      const nowPart = String.raw`\b(?:${nowNames.join("|")})\s*\.get(?:Day|Date|Month|FullYear|Hours|Minutes)\(`;
      return findBanned(file, contents, {
        within: "line",
        snippet: "match",
        banned: [
          ...banned,
          { pattern: new RegExp(nowPart, "g"), message: nowMessage }
        ],
        mayContain: new RegExp(`${mayContain.source}|${nowPart}`)
      });
    };
  }
});
