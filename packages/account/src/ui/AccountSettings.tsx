// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  Modal,
  ModalContent,
  ModalTitle,
  Subheading
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactElement } from "react";
import { useEffect } from "react";
import { CgProfile } from "react-icons/cg";
import { LuBell, LuShieldCheck, LuSunMoon } from "react-icons/lu";
import { useSearchParams } from "react-router";
import type { AccountSettingsTab } from "../models";
import { isAccountSettingsTab } from "../models";
import { useAccountSettings } from "../store";
import AccountAvatar from "./AccountAvatar";
import AppearanceSettings from "./AppearanceSettings";
import type { AccountSettingsConfig } from "./context";
import { AccountSettingsProvider, useAccountSettingsConfig } from "./context";
import NotificationSettings from "./NotificationSettings";
import ProfileSettings from "./ProfileSettings";
import SecuritySettings from "./SecuritySettings";

const PANES: Record<AccountSettingsTab, () => ReactElement> = {
  profile: ProfileSettings,
  appearance: AppearanceSettings,
  notifications: NotificationSettings,
  security: SecuritySettings
};

/**
 * The account settings modal, mounted once in an app's shell so it opens over
 * any page: `useAccountSettings().open(tab)`. A `?account=<tab>` link opens it
 * too — the ERP's old /x/account/* pages redirect to one.
 */
export default function AccountSettings(config: AccountSettingsConfig) {
  const tab = useAccountSettings((s) => s.tab);
  const openAccountSettings = useAccountSettings((s) => s.open);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedTab = searchParams.get("account");

  // The param only opens the modal; it is dropped at once, so closing the
  // modal and reloading the page do not fight over it.
  useEffect(() => {
    if (linkedTab === null) return;
    if (isAccountSettingsTab(linkedTab)) openAccountSettings(linkedTab);
    setSearchParams(
      (prev) => {
        prev.delete("account");
        return prev;
      },
      { replace: true, preventScrollReset: true }
    );
  }, [linkedTab, openAccountSettings, setSearchParams]);

  if (!tab) return null;
  return (
    <AccountSettingsProvider value={config}>
      <AccountSettingsModal tab={tab} />
    </AccountSettingsProvider>
  );
}

function AccountSettingsModal({ tab }: { tab: AccountSettingsTab }) {
  const { t } = useLingui();
  const { user } = useAccountSettingsConfig();
  const openAccountSettings = useAccountSettings((s) => s.open);
  const closeAccountSettings = useAccountSettings((s) => s.close);
  const name = `${user.firstName} ${user.lastName}`;

  const tabs: { id: AccountSettingsTab; name: string; icon: ReactElement }[] = [
    { id: "profile", name: t`Profile`, icon: <CgProfile /> },
    { id: "appearance", name: t`Appearance`, icon: <LuSunMoon /> },
    { id: "notifications", name: t`Notifications`, icon: <LuBell /> },
    { id: "security", name: t`Security`, icon: <LuShieldCheck /> }
  ];
  const Pane = PANES[tab];

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) closeAccountSettings();
      }}
    >
      <ModalContent
        size="xxlarge"
        aria-describedby={undefined}
        className={cn(
          "gap-0 p-0 overflow-hidden max-w-5xl h-[min(760px,calc(100dvh-4rem))] md:flex-row",
          "max-md:h-[calc(100dvh-env(safe-area-inset-top)-12px)] max-md:max-h-none max-md:pt-4"
        )}
      >
        {/* The sidebar is the visible chrome; the title is for screen readers. */}
        <ModalTitle className="sr-only">
          <Trans>Account settings</Trans>
        </ModalTitle>
        <aside className="flex shrink-0 flex-col gap-4 border-border bg-muted/40 px-3 py-4 md:w-60 md:border-r max-md:border-b max-md:pb-2">
          <div className="flex min-w-0 items-center gap-3 px-2 max-md:pr-12">
            <AccountAvatar size="md" path={user.avatarUrl} name={name} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
          <nav
            aria-label={t`Account settings`}
            className="flex flex-col gap-0.5 max-md:flex-row max-md:overflow-x-auto max-md:scrollbar-hide"
          >
            <Subheading
              as="h4"
              variant="light"
              className="px-2 py-1 max-md:hidden"
            >
              <Trans>Account</Trans>
            </Subheading>
            {tabs.map((item) => {
              const active = item.id === tab;
              return (
                <Button
                  key={item.id}
                  type="button"
                  leftIcon={item.icon}
                  variant={active ? "active" : "ghost"}
                  aria-current={active ? "page" : undefined}
                  onClick={() => openAccountSettings(item.id)}
                  className={cn(
                    "justify-start shrink-0",
                    active
                      ? "shadow-none dark:shadow-button-base"
                      : "hover:bg-transparent hover:text-active-foreground hover:scale-100 focus-visible:scale-100"
                  )}
                >
                  {item.name}
                </Button>
              );
            })}
          </nav>
        </aside>
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-9 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent max-md:px-4 max-md:py-4">
          <Pane />
        </section>
      </ModalContent>
    </Modal>
  );
}
