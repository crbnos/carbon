// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  useDisclosure
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuSlidersHorizontal } from "react-icons/lu";

export type InspectionParameter = { id: string; key: string; value: string };

// The inspection plan's parameters, read-only: what the inspector sets up or
// checks before measuring. A meta-bar chip opens them in a bottom sheet; the
// chip is not drawn when the plan has none.
export function InspectionParametersButton({
  parameters
}: {
  parameters: InspectionParameter[];
}) {
  const disclosure = useDisclosure();
  if (parameters.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={disclosure.onOpen}
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-foreground transition-[background-color,transform] hover:bg-accent active:scale-[0.98] max-md:min-h-11"
      >
        <LuSlidersHorizontal className="size-3.5" />
        <Trans>Parameters</Trans>
        <span className="tabular-nums text-muted-foreground">
          {parameters.length}
        </span>
      </button>
      <BottomSheet
        open={disclosure.isOpen}
        onOpenChange={(open) => {
          if (!open) disclosure.onClose();
        }}
      >
        <BottomSheetContent className="mx-auto max-w-md">
          <BottomSheetHeader>
            <BottomSheetTitle>
              <Trans>Parameters</Trans>
            </BottomSheetTitle>
          </BottomSheetHeader>
          <BottomSheetBody>
            <dl className="divide-y divide-border">
              {parameters.map((parameter) => (
                <div
                  key={parameter.id}
                  className="flex min-h-12 items-center justify-between gap-4 py-2"
                >
                  <dt className="text-sm text-muted-foreground">
                    {parameter.key}
                  </dt>
                  <dd
                    className={
                      parameter.value.length > 8
                        ? "text-right text-sm font-medium"
                        : "text-right text-xl font-semibold tabular-nums tracking-tight"
                    }
                  >
                    {parameter.value}
                  </dd>
                </div>
              ))}
            </dl>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
