// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noNoopOpenChange } from "./no-noop-open-change";

const scan = (contents: string) =>
  noNoopOpenChange.scan("apps/erp/app/components/X.tsx", contents);

describe("noNoopOpenChange", () => {
  it("flags a handler that does nothing", () => {
    expect(
      scan(`<Modal open onOpenChange={() => {}}>
<Drawer
  open
  onOpenChange={() => {
    /* intentionally non-dismissable */
  }}
>
<Modal open onOpenChange={() => undefined}>`).map((v) => v.line)
    ).toEqual([1, 4, 8]);
  });

  it("accepts a real handler and no handler", () => {
    expect(
      scan(`<Modal open>
<Modal open onOpenChange={(open) => { if (!open) onClose(); }}>
<Drawer open onOpenChange={setOpen}>`)
    ).toEqual([]);
  });
});
