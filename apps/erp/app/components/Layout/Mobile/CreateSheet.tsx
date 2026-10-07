// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  PrefetchLink
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useCreate } from "../Topbar/CreateMenu";
import { SheetRowContent, sheetRowClassName } from "./SheetRow";

/** The tab bar's Create sheet: the desktop Create menu's items, same order. */
export function CreateSheet({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const items = useCreate();
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent>
        <BottomSheetHeader>
          <BottomSheetTitle>
            <Trans>Create</Trans>
          </BottomSheetTitle>
        </BottomSheetHeader>
        <BottomSheetBody className="px-2">
          {items.map((item) => (
            <PrefetchLink
              key={item.to}
              to={item.to}
              className={sheetRowClassName}
              onClick={() => onOpenChange(false)}
            >
              <SheetRowContent icon={item.icon} label={item.name} />
            </PrefetchLink>
          ))}
        </BottomSheetBody>
      </BottomSheetContent>
    </BottomSheet>
  );
}
