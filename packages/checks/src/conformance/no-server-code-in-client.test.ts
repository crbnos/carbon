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
  });

  it("allows a route to import a service file for its loader and action", () => {
    const ts = `import { getQuote } from "~/modules/sales/sales.service";

export async function loader() {
  return getQuote();
}

export default function QuoteRoute() {
  return null;
}`;
    expect(scan("apps/erp/app/routes/x+/quote+/$id.tsx", ts)).toEqual([]);
  });

  it("flags a server-file name used in a route's browser code", () => {
    const ts = `import { getLedger, LOCK_TASK } from "~/modules/a/a.service";
import * as service from "~/modules/b/b.service";
import { getDatabaseClient } from "~/services/database.server";

export async function loader() {
  return getLedger(getDatabaseClient());
}

export default function Route() {
  const done = task.name === LOCK_TASK;
  return service.render(done);
}`;
    expect(scan("apps/erp/app/routes/x+/a+/$id.tsx", ts)).toEqual([
      "LOCK_TASK from ~/modules/a/a.service",
      "service from ~/modules/b/b.service"
    ]);
  });

  it("does not count a comment or a local of the same name", () => {
    const ts = `import { flash, setTheme, theme } from "~/services/x.server";

export default function Route() {
  // flash shows the result
  const [t, setTheme] = useState();
  const {
    theme
  } = useLoaderData();
  return setTheme(theme);
}`;
    expect(scan("apps/erp/app/routes/x+/a+/$id.tsx", ts)).toEqual([]);
  });

  it("does not count a property or a type-only specifier", () => {
    const ts = `import { type Row, getRow } from "~/modules/a/a.service";

export default function Route({ row }: { row: Row }) {
  return row.getRow;
}`;
    expect(scan("apps/erp/app/routes/x+/a+/$id.tsx", ts)).toEqual([]);
  });
});
