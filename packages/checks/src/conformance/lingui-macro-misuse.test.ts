// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { linguiMacroMisuse } from "./lingui-macro-misuse";

const scan = (contents: string) =>
  linguiMacroMisuse.scan("apps/erp/app/x.tsx", contents).map((v) => v.line);

describe("linguiMacroMisuse", () => {
  it.each([
    ['import { t } from "@lingui/core/macro";'],
    ["import { msg, t } from '@lingui/core/macro';"],
    ["const label = i18n._(msg`Scrap`);"],
    ["const label = _( msg`Scrap`);"],
    ["const label = t(msg({ message: 'Scrap' }));"]
  ])("flags %s", (source) => {
    expect(scan(source)).toEqual([1]);
  });

  it.each([
    ['import { msg } from "@lingui/core/macro";'],
    ['import { t, Trans, useLingui } from "@lingui/react/macro";'],
    ["const label = i18n._(descriptors[status]);"],
    ["const { t } = useLingui(); const label = t`Scrap`;"]
  ])("accepts %s", (source) => {
    expect(scan(source)).toEqual([]);
  });

  it("flags the quantity type options from before 5d8d459250", () => {
    // apps/erp/app/modules/production/ui/Jobs/ProductionQuantityForm.tsx
    // before 5d8d459250: `t` was already in scope from useLingui().
    const before = `const { t, i18n } = useLingui();
const quantityTypeOptions = [
  { label: i18n._(msg\`Production\`), value: "Production" },
  { label: i18n._(msg\`Scrap\`), value: "Scrap" },
  { label: i18n._(msg\`Rework\`), value: "Rework" }
];`;
    expect(scan(before)).toEqual([3, 4, 5]);
    // The fix: t`Scrap` from the useLingui() already in scope.
    expect(
      scan(`const { t } = useLingui();
const quantityTypeOptions = [{ label: t\`Scrap\`, value: "Scrap" }];`)
    ).toEqual([]);
  });
});
