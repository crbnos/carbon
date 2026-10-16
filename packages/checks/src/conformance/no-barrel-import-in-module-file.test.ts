// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noBarrelImportInModuleFile } from "./no-barrel-import-in-module-file";

const MODELS = "apps/erp/app/modules/sales/sales.models.ts";
const scan = (file: string, ts: string) =>
  noBarrelImportInModuleFile.scan(file, ts).map((v) => v.snippet);

describe("noBarrelImportInModuleFile", () => {
  it("flags a value import of another module's barrel", () => {
    expect(
      scan(MODELS, 'import { currencyCodes } from "../accounting";')
    ).toEqual(["../accounting"]);
    expect(
      scan(
        MODELS,
        'import {\n  getCompany,\n  type Company\n} from "~/modules/settings";'
      )
    ).toEqual(["~/modules/settings"]);
  });

  it("allows a defining file and a type-only import", () => {
    expect(
      scan(MODELS, 'import { currencyCodes } from "../accounting/types";')
    ).toEqual([]);
    expect(
      scan(MODELS, 'import type { Company } from "~/modules/settings";')
    ).toEqual([]);
  });

  it("ignores UI and route files", () => {
    const ts = 'import { getCompany } from "~/modules/settings";';
    expect(
      scan("apps/erp/app/modules/sales/ui/Quote/QuoteForm.tsx", ts)
    ).toEqual([]);
    expect(scan("apps/erp/app/routes/x+/quote+/new.tsx", ts)).toEqual([]);
  });
});
