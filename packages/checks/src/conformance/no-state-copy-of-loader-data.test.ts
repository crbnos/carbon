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

  it("flags the settings switch f18c5dad02 fixed, and passes its fix", () => {
    // apps/erp/app/routes/x+/settings+/quality.tsx before f18c5dad02: the
    // switch kept its own copy of the saved setting, so it stayed in the
    // clicked position when the save failed.
    const before = `  const { companySettings } = useLoaderData<typeof loader>();
  const toggleFetcher = useFetcher<typeof action>();

  const [fourEyesEnabled, setFourEyesEnabled] = useState(
    (companySettings as { enforceInspectionFourEyes?: boolean })
      .enforceInspectionFourEyes ?? false
  );
`;
    expect(scan(before).map((v) => v.snippet)).toEqual([
      "const [fourEyesEnabled, setFourEyesEnabled] = useState("
    ]);
    const after = `  const { companySettings } = useLoaderData<typeof loader>();
  const toggleFetcher = useFetcher<typeof action>();

  const fourEyesEnabled = useSavedToggle(
    toggleFetcher,
    "enforceInspectionFourEyes",
    (companySettings as { enforceInspectionFourEyes?: boolean })
      .enforceInspectionFourEyes ?? false
  );
`;
    expect(scan(after)).toEqual([]);
  });
});
