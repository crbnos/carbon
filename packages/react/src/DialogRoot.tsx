// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { createContext, useContext } from "react";
import { DialogDepthContext } from "./RouteDialogScope";

// A dialog held open with no `onOpenChange` cannot be closed by the X, Escape
// or a click outside, so it does not offer the X. Leave `onOpenChange` off to
// say "this cannot be dismissed" rather than passing a handler that does nothing.
const DismissableContext = createContext(true);
export const useDialogDismissable = () => useContext(DismissableContext);

export const DialogRoot = ({
  open,
  onOpenChange,
  ...props
}: DialogPrimitive.DialogProps) => {
  const depth = useContext(DialogDepthContext);
  return (
    <DialogDepthContext.Provider value={depth + 1}>
      <DismissableContext.Provider
        value={open === undefined || onOpenChange !== undefined}
      >
        <DialogPrimitive.Root
          open={open}
          onOpenChange={onOpenChange}
          {...props}
        />
      </DismissableContext.Provider>
    </DialogDepthContext.Provider>
  );
};
