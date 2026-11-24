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

  it("flags the clock-out prompt's handler that b0437fbfe4 removed", () => {
    // apps/erp/app/components/TimeCardWarning.tsx before b0437fbfe4: the X
    // was drawn and did nothing when clicked.
    expect(
      scan(`    return (
      <Modal
        open
        onOpenChange={() => {
          /* intentionally non-dismissable */
        }}
      >
        <ModalContent>`).map((v) => v.line)
    ).toEqual([4]);
  });

  it("passes the clock-out prompt as b0437fbfe4 fixed it", () => {
    expect(
      scan(`    return (
      <Modal
        // No onOpenChange: the prompt must be answered, so it has no close button.
        open
      >
        <ModalContent>`)
    ).toHaveLength(0);
  });

  it("accepts a real handler and no handler", () => {
    expect(
      scan(`<Modal open>
<Modal open onOpenChange={(open) => { if (!open) onClose(); }}>
<Drawer open onOpenChange={setOpen}>`)
    ).toEqual([]);
  });
});
