// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noServerCodeInClient } from "./no-server-code-in-client";

const scan = (file: string, ts: string) =>
  noServerCodeInClient.scan(file, ts).map((v) => v.snippet);

describe("noServerCodeInClient", () => {
  it("flags a component importing a service or server file", () => {
    const ts = `import { getQuote } from "~/modules/sales/sales.service";
import { sendQuote } from "../sales.server";`;
    expect(
      scan("apps/erp/app/modules/sales/ui/Quote/QuoteForm.tsx", ts)
    ).toEqual(["~/modules/sales/sales.service", "../sales.server"]);
    expect(scan("apps/erp/app/components/Form/Item.tsx", ts)).toHaveLength(2);
    expect(scan("apps/erp/app/modules/sales/sales.models.ts", ts)).toHaveLength(
      2
    );
  });

  it("allows a type-only import and client-safe files", () => {
    expect(
      scan(
        "apps/erp/app/modules/sales/ui/Quote/QuoteForm.tsx",
        `import type { Quote } from "~/modules/sales/sales.service";
import { quoteValidator } from "~/modules/sales/sales.models";`
      )
    ).toEqual([]);
  });

  it("ignores server-side files", () => {
    const ts = 'import { getQuote } from "~/modules/sales/sales.service";';
    expect(scan("apps/erp/app/modules/sales/sales.server.ts", ts)).toEqual([]);
    expect(scan("apps/erp/app/routes/x+/quote+/$id.tsx", ts)).toEqual([]);
  });
});
