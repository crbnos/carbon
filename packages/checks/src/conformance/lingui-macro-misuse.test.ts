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
});
