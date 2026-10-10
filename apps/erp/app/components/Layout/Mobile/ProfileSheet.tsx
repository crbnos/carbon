// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import {
  Avatar as AvatarBase,
  BottomSheet,
  BottomSheetBack,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  cn,
  ItarDisclosure,
  PrefetchLink,
  SheetSectionLabel,
  sheetRowClassName,
  useMode
} from "@carbon/react";
import { themes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { LuBell, LuBuilding2 } from "react-icons/lu";
import { Form } from "react-router";
import { Avatar } from "~/components";
import type { AccountMenuItem } from "~/components/AvatarMenu";
import { useAccountMenu } from "~/components/AvatarMenu";
import { useUser } from "~/hooks";
import type { useNotifications } from "~/hooks/useNotifications";
import { path } from "~/utils/path";
import {
  useCompanyGroups,
  useCompanySwitchRedirect
} from "../Topbar/CompanySwitcher";
import { NotificationsPanel } from "../Topbar/Notifications";
import { SheetRowButton, SheetRowContent, SheetRowGroup } from "./SheetRow";

/** Consecutive items with the same `group`, as the desktop separators split them. */
function groupItems(items: AccountMenuItem[]) {
  const groups: AccountMenuItem[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.group === item.group) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

type Screen =
  | { id: "root" }
  | { id: "notifications" }
  | { id: "companies" }
  | { id: "submenu"; item: AccountMenuItem };

/**
 * The dock menu's Profile sheet: the desktop account menu's items in order,
 * plus Notifications and the company switcher, which live in the desktop top
 * bar. Sub-menus drill in within the sheet. The dock owns the notifications
 * subscription and shares it with its menu's bell.
 */
export function ProfileSheet({
  open,
  onOpenChange,
  notifications,
  initialScreen = "root"
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: ReturnType<typeof useNotifications>;
  /** The screen the sheet opens on; Back always returns to the root. */
  initialScreen?: "root" | "notifications";
}) {
  const { t } = useLingui();
  const menu = useAccountMenu();
  const user = useUser();
  const mode = useMode();
  const companyGroups = useCompanyGroups();
  const switchRedirect = useCompanySwitchRedirect();
  const unread = notifications.notifications.filter((n) => !n.read).length;
  const companyCount = companyGroups.reduce(
    (sum, group) => sum + group.companies.length,
    0
  );

  const [screen, setScreen] = useState<Screen>({ id: initialScreen });
  const [notificationsTab, setNotificationsTab] = useState("inbox");

  // Each opening starts on the screen it was opened for.
  useEffect(() => {
    if (open) setScreen({ id: initialScreen });
  }, [open, initialScreen]);

  const back = () => setScreen({ id: "root" });

  const renderItem = (item: AccountMenuItem) => {
    switch (item.kind) {
      case "link":
        return (
          <PrefetchLink to={item.to!} className={sheetRowClassName}>
            <SheetRowContent
              icon={item.icon}
              label={item.label}
              trailing="drill"
            />
          </PrefetchLink>
        );
      case "external":
        return (
          <a
            href={item.to}
            target="_blank"
            rel="noreferrer"
            className={sheetRowClassName}
          >
            <SheetRowContent
              icon={item.icon}
              label={item.label}
              trailing="external"
            />
          </a>
        );
      case "mode":
        return (
          <div className="flex min-h-12 items-center gap-3 px-3">
            <SheetRowContent icon={item.icon} label={item.label} />
            <div
              role="radiogroup"
              aria-label={t`Appearance`}
              className="flex shrink-0 rounded-lg bg-muted p-0.5"
            >
              {menu.modeOptions.map((option) => {
                const selected = menu.modePreference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => menu.onModeChange(option.value)}
                    className={cn(
                      "hit-area flex h-9 min-w-11 items-center justify-center rounded-md px-2 text-sm text-muted-foreground",
                      selected &&
                        "bg-background text-foreground shadow-button-base"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      case "submenu":
        return (
          <SheetRowButton
            onClick={() => setScreen({ id: "submenu", item })}
            disabled={
              item.id === "language" && menu.localeFetcher.state !== "idle"
            }
          >
            <SheetRowContent
              icon={item.icon}
              label={item.label}
              trailing="drill"
            />
          </SheetRowButton>
        );
      case "action":
        if (item.id === "account") {
          return (
            <SheetRowButton
              onClick={() => {
                onOpenChange(false);
                menu.openAccountSettings();
              }}
            >
              <SheetRowContent icon={item.icon} label={item.label} />
            </SheetRowButton>
          );
        }
        if (item.id === "signOut") {
          return (
            <Form method="post" action={path.to.logout}>
              <SheetRowButton type="submit">
                <SheetRowContent icon={item.icon} label={item.label} />
              </SheetRowButton>
            </Form>
          );
        }
        return (
          <SheetRowButton onClick={menu.itarDisclosure.onOpen}>
            <SheetRowContent icon={item.icon} label={item.label} />
          </SheetRowButton>
        );
    }
  };

  const renderSubmenu = (item: AccountMenuItem): ReactNode => {
    if (item.id === "theme") {
      return themes.map((theme) => (
        <SheetRowButton
          key={theme.name}
          onClick={() => menu.onThemeChange(theme.name)}
        >
          <span
            className="size-5 shrink-0 rounded-full"
            style={{
              background: `hsl(${theme.activeColor[mode === "dark" ? "dark" : "light"]})`
            }}
          />
          <SheetRowContent
            label={theme.label}
            trailing={menu.optimisticTheme === theme.name ? "check" : null}
          />
        </SheetRowButton>
      ));
    }
    if (item.id === "language") {
      return (
        <menu.localeFetcher.Form method="post" action="/api/locale">
          {menu.languageOptions.map((option) => (
            <SheetRowButton
              key={option.value}
              type="submit"
              name="locale"
              value={option.value}
              disabled={
                menu.localeFetcher.state !== "idle" ||
                option.value === menu.resolvedLocale
              }
              className="disabled:opacity-100"
            >
              <SheetRowContent
                label={option.label}
                trailing={option.value === menu.resolvedLocale ? "check" : null}
              />
            </SheetRowButton>
          ))}
        </menu.localeFetcher.Form>
      );
    }
    return item.children?.map((child) => (
      <a key={child.id} href={child.to} className={sheetRowClassName}>
        <SheetRowContent
          icon={child.icon}
          label={child.label}
          trailing="external"
        />
      </a>
    ));
  };

  const title =
    screen.id === "notifications" ? (
      <Trans>Notifications</Trans>
    ) : screen.id === "companies" ? (
      <Trans>Switch company</Trans>
    ) : screen.id === "submenu" ? (
      screen.item.label
    ) : (
      <Trans>Profile</Trans>
    );

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent>
          <BottomSheetHeader>
            {screen.id !== "root" && <BottomSheetBack onClick={back} />}
            <BottomSheetTitle>{title}</BottomSheetTitle>
          </BottomSheetHeader>
          <BottomSheetBody
            className={cn("px-2", screen.id === "notifications" && "px-0")}
          >
            {screen.id === "root" && (
              <>
                <div className="flex items-center gap-3 px-3 pb-3">
                  <Avatar path={menu.user.avatarUrl} name={menu.name} />
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {menu.signedInAs}
                  </span>
                </div>
                <SheetRowGroup>
                  <SheetRowButton
                    onClick={() => setScreen({ id: "notifications" })}
                  >
                    <SheetRowContent
                      icon={<LuBell />}
                      label={<Trans>Notifications</Trans>}
                      detail={unread > 0 ? unread : undefined}
                      trailing="drill"
                    />
                  </SheetRowButton>
                  {companyCount > 1 && (
                    <SheetRowButton
                      onClick={() => setScreen({ id: "companies" })}
                    >
                      <SheetRowContent
                        icon={<LuBuilding2 />}
                        label={<Trans>Switch company</Trans>}
                        detail={user.company.name}
                        trailing="drill"
                      />
                    </SheetRowButton>
                  )}
                </SheetRowGroup>
                {groupItems(menu.items).map((group) => (
                  <SheetRowGroup key={group[0]!.group}>
                    {group.map((item) => (
                      <Fragment key={item.id}>{renderItem(item)}</Fragment>
                    ))}
                  </SheetRowGroup>
                ))}
              </>
            )}
            {screen.id === "submenu" && renderSubmenu(screen.item)}
            {screen.id === "notifications" && (
              <NotificationsPanel
                isOpen={open}
                onClose={() => onOpenChange(false)}
                activeTab={notificationsTab}
                onActiveTabChange={setNotificationsTab}
                notifications={notifications}
              />
            )}
            {screen.id === "companies" &&
              companyGroups.map((group) => (
                <SheetRowGroup key={group.name}>
                  <SheetSectionLabel>{group.name}</SheetSectionLabel>
                  {group.companies.map((company) => {
                    const logo =
                      mode === "dark"
                        ? company.logoDarkIcon
                        : company.logoLightIcon;
                    const isCurrent = company.companyId === user.company.id;
                    return (
                      <Form
                        key={company.companyId}
                        method="post"
                        action={path.to.companySwitch(company.companyId!)}
                      >
                        {switchRedirect && (
                          <input
                            type="hidden"
                            name="redirectTo"
                            value={switchRedirect}
                          />
                        )}
                        <SheetRowButton
                          type="submit"
                          disabled={isCurrent}
                          className="disabled:opacity-100"
                        >
                          <AvatarBase
                            size="xs"
                            name={company.name ?? undefined}
                            src={logo ?? undefined}
                          />
                          <SheetRowContent
                            label={company.name}
                            detail={company.employeeType}
                            trailing={isCurrent ? "check" : null}
                          />
                        </SheetRowButton>
                      </Form>
                    );
                  })}
                </SheetRowGroup>
              ))}
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>
      {CONTROLLED_ENVIRONMENT && (
        <ItarDisclosure disclosure={menu.itarDisclosure} />
      )}
    </>
  );
}
