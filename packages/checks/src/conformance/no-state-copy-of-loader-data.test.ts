// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noStateCopyOfLoaderData } from "./no-state-copy-of-loader-data";

const scan = (contents: string) =>
  noStateCopyOfLoaderData.scan("apps/erp/app/routes/x+/thing.tsx", contents);

describe("noStateCopyOfLoaderData", () => {
  it("flags state seeded from loader data, directly or in an initialiser", () => {
    expect(
      scan(
        `const { rows, total: count } = useLoaderData<typeof loader>();\nconst [list, setList] = useState(rows);\nconst [n] = useState<number>(() => count + 1);\n`
      ).map((v) => v.line)
    ).toEqual([2, 3]);
  });

  it("flags state seeded from route data", () => {
    const violations = scan(
      `const routeData = useRouteData<{ lines: Line[] }>(path.to.quote(id));\nconst [selected, setSelected] = useState(() =>\n  routeData?.lines.reduce(toSelection, {})\n);\n`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("routeData");
  });

  it("accepts state that does not read the loaded data", () => {
    expect(
      scan(
        `const { rows } = useLoaderData<typeof loader>();\nconst [open, setOpen] = useState(false);\nconst [picks, setPicks] = useState<Record<string, number>>({});\nconst [draft, setDraft] = useState({ rows: [] });\nconst total = useMemo(() => sum(rows), [rows]);\n`
      )
    ).toEqual([]);
  });

  it("does not take a property of the same name for the data", () => {
    expect(
      scan(
        `const { rows } = useLoaderData<typeof loader>();\nconst [view, setView] = useState(settings.rows);\n`
      )
    ).toEqual([]);
  });

  it("ignores a file that loads nothing", () => {
    expect(scan(`const [list, setList] = useState(props.rows);\n`)).toEqual([]);
  });
});
