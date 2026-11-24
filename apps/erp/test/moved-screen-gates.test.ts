// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { writersOf } from "@carbon/database/access";
import { describe, expect, it } from "vitest";
import { accountingActivationGate } from "~/modules/accounting/accounting.models";
import { storageTypesGate } from "~/modules/inventory/inventory.models";

const pagesOf = (gate: readonly object[]) => gate.flatMap((g) => Object.keys(g));

describe("gates of moved screens", () => {
  it("Storage Types admits its page and every page that keeps writing storageType", () => {
    expect(pagesOf(storageTypesGate("View"))).toEqual([
      "inventory.storageTypes",
      ...writersOf("storageType")
    ]);
  });

  it("the activation wizard admits its page and every page that keeps writing its table", () => {
    expect(pagesOf(accountingActivationGate("View"))).toEqual([
      "settings.accounting",
      ...writersOf("accountingCutoverIgnoredInvoice")
    ]);
  });
});
