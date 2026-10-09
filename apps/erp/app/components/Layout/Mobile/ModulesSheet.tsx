// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  PrefetchLink,
  sheetRowClassName
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ModuleCard } from "~/components/ModuleCard";
import {
  getImplementationNavItem,
  ImplementationData
} from "~/hooks/useImplementationNavItem";
import { useModules, useSettingsModule } from "~/hooks/useModules";
import { SheetRowContent } from "./SheetRow";

/**
 * The tab bar's Modules sheet: the desktop rail's items in rail order —
 * Get Started while onboarding, the module tiles, then Settings.
 */
export function ModulesSheet({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { i18n } = useLingui();
  const modules = useModules();
  const settingsModule = useSettingsModule();
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent>
        <BottomSheetHeader>
          <BottomSheetTitle>
            <Trans>Modules</Trans>
          </BottomSheetTitle>
        </BottomSheetHeader>
        <BottomSheetBody>
          {/* A tap closes the sheet even when the module is the current page,
              where navigating leaves the path (and so the sheet) unchanged. */}
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) {
                onOpenChange(false);
              }
            }}
          >
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              <ImplementationData>
                {(data) => {
                  const item = getImplementationNavItem(data, i18n);
                  return item ? <ModuleCard module={item} /> : null;
                }}
              </ImplementationData>
              {modules.map((module) => (
                <ModuleCard key={module.key} module={module} />
              ))}
            </div>
            {settingsModule ? (
              <div className="mt-4 border-t border-border pt-2">
                <PrefetchLink
                  to={settingsModule.to}
                  className={sheetRowClassName}
                >
                  <SheetRowContent
                    icon={<settingsModule.icon />}
                    label={settingsModule.name}
                    trailing="drill"
                  />
                </PrefetchLink>
              </div>
            ) : null}
          </div>
        </BottomSheetBody>
      </BottomSheetContent>
    </BottomSheet>
  );
}
