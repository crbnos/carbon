// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { livePolicies } from "./rls-policies";

describe("livePolicies", () => {
  it("reads only public tables, and a policy with no FOR clause as ALL", () => {
    const live = livePolicies([
      {
        file: "1_ship.sql",
        contents: [
          'CREATE POLICY "Bucket read" ON storage.objects FOR SELECT USING (true);',
          'CREATE POLICY "Everything" ON "demandForecast" USING (true);'
        ].join("\n")
      }
    ]);
    expect([...live.keys()]).toEqual(["demandForecast"]);
    expect(live.get("demandForecast")?.map((p) => p.command)).toEqual(["ALL"]);
  });
});
