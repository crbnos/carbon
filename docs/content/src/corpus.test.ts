// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { stripComponents } from "./corpus";

describe("stripComponents", () => {
  it("keeps journal step actions and posting documents beside their entries", () => {
    expect(
      stripComponents(`<JournalStep number={2} title="Pay the invoice" document="Payment (post)">

| Account | DR | CR |
| --- | ---: | ---: |
| Accounts Payable | $100 | |
| Bank | | $100 |

</JournalStep>`)
    ).toBe(`**2. Pay the invoice**
Document: Payment (post)

| Account | DR | CR |
| --- | ---: | ---: |
| Accounts Payable | $100 | |
| Bank | | $100 |`);
  });
});
