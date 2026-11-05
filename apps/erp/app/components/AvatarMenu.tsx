// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAccountSettings } from "@carbon/account";
import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import {
  getSortedLanguageSelectOptions,
  resolveLanguage
} from "@carbon/locale";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  ItarDisclosure,
  useDisclosure,
  useEdition,
  useMode
} from "@carbon/react";
import { Edition } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactElement, ReactNode } from "react";
import { Fragment, useMemo, useState } from "react";
import {
  LuCheck,
  LuCreditCard,
  LuFileText,
  LuHouse,
  LuLanguages,
  LuLogOut,
  LuMoon,
  LuShieldCheck,
  LuSun,
  LuTimer,
  LuUser
} from "react-icons/lu";
import { Form, Link, useFetcher } from "react-router";
import { Avatar } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";

export type AccountMenuItem = {
  id:
    | "dashboard"
    | "timesheet"
    | "apiDocs"
    | "appearance"
    | "language"
    | "account"
    | "billing"
    | "legal"
    | "about"
    | "signOut";
  /** Items in the same group sit between the same separators. */
  group: number;
  kind: "link" | "external" | "action" | "submenu";
  label: ReactNode;
  icon: ReactElement;
  to?: string;
  children?: { id: string; label: ReactNode; icon: ReactElement; to: string }[];
};

/**
 * The account menu's items, in desktop order, with every handler they need.
 * The desktop AvatarMenu and the compact Profile sheet both render from this,
 * so the two cannot drift.
 */
export function useAccountMenu() {
  const { t } = useLingui();
  const user = useUser();
  const name = `${user.firstName} ${user.lastName}`;
  const permissions = usePermissions();
  const { isOwner } = permissions;
  const edition = useEdition();

  const mode = useMode();
  const localeFetcher = useFetcher<{ ok?: boolean }>();

  const { locale } = useLocale();
  const resolvedLocale = resolveLanguage(locale);

  const languageOptions = useMemo(
    () => getSortedLanguageSelectOptions(locale),
    [locale]
  );

  const itarDisclosure = useDisclosure();
  const openAccountSettings = useAccountSettings((s) => s.open);

  const items: AccountMenuItem[] = [
    {
      id: "dashboard",
      group: 0,
      kind: "link",
      label: <Trans>Dashboard</Trans>,
      icon: <LuHouse />,
      to: path.to.authenticatedRoot
    },
    ...(permissions.is("employee")
      ? [
          {
            id: "timesheet",
            group: 0,
            kind: "link",
            label: <Trans>My Time</Trans>,
            icon: <LuTimer />,
            to: path.to.timesheet
          } satisfies AccountMenuItem
        ]
      : []),
    {
      id: "apiDocs",
      group: 1,
      kind: "external",
      label: <Trans>API Documentation</Trans>,
      icon: <LuFileText />,
      to: path.to.apiDocs
    },
    {
      id: "appearance",
      group: 2,
      kind: "action",
      label: <Trans>Appearance</Trans>,
      icon: mode === "dark" ? <LuMoon /> : <LuSun />
    },
    {
      id: "language",
      group: 3,
      kind: "submenu",
      label: <Trans>Language</Trans>,
      icon: <LuLanguages />
    },
    {
      id: "account",
      group: 4,
      kind: "action",
      label: <Trans>Account Settings</Trans>,
      icon: <LuUser />
    },
    ...(edition === Edition.Cloud && isOwner()
      ? [
          {
            id: "billing",
            group: 4,
            kind: "link",
            label: <Trans>Manage Subscription</Trans>,
            icon: <LuCreditCard />,
            to: path.to.billing
          } satisfies AccountMenuItem
        ]
      : []),
    {
      id: "legal",
      group: 4,
      kind: "submenu",
      label: <Trans>Terms and Privacy</Trans>,
      icon: <LuFileText />,
      children: [
        {
          id: "terms",
          label: <Trans>Terms of Service</Trans>,
          icon: <LuFileText />,
          to: path.to.legal.termsAndConditions
        },
        {
          id: "privacy",
          label: <Trans>Privacy Policy</Trans>,
          icon: <LuShieldCheck />,
          to: path.to.legal.privacyPolicy
        }
      ]
    },
    ...(CONTROLLED_ENVIRONMENT
      ? [
          {
            id: "about",
            group: 5,
            kind: "action",
            label: <Trans>About</Trans>,
            icon: <LuShieldCheck />
          } satisfies AccountMenuItem
        ]
      : []),
    {
      id: "signOut",
      group: 5,
      kind: "action",
      label: <Trans>Sign Out</Trans>,
      icon: <LuLogOut />
    }
  ];

  return {
    user,
    name,
    signedInAs: t`Signed in as ${name}`,
    items,
    languageOptions,
    resolvedLocale,
    localeFetcher,
    itarDisclosure,
    openAccountSettings
  };
}

const AvatarMenu = () => {
  const {
    user,
    name,
    signedInAs,
    items,
    languageOptions,
    resolvedLocale,
    localeFetcher,
    itarDisclosure,
    openAccountSettings
  } = useAccountMenu();
  const [isOpen, setIsOpen] = useState(false);

  const renderItem = (item: AccountMenuItem) => {
    switch (item.id) {
      case "account":
        return (
          <DropdownMenuItem onClick={() => openAccountSettings()}>
            <DropdownMenuIcon icon={item.icon} />
            {item.label}
          </DropdownMenuItem>
        );
      case "dashboard":
        return (
          <DropdownMenuItem asChild>
            <Link to={item.to!}>
              <DropdownMenuIcon icon={item.icon} />
              {item.label}
            </Link>
          </DropdownMenuItem>
        );
      case "timesheet":
      case "billing":
        return (
          <DropdownMenuItem asChild>
            <Link to={item.to!}>
              <DropdownMenuIcon icon={item.icon} />
              <span>{item.label}</span>
            </Link>
          </DropdownMenuItem>
        );
      case "apiDocs":
        return (
          <DropdownMenuItem asChild>
            <a href={item.to} target="_blank" rel="noreferrer">
              <DropdownMenuIcon icon={item.icon} />
              {item.label}
            </a>
          </DropdownMenuItem>
        );
      case "appearance":
        return (
          <DropdownMenuItem onClick={() => openAccountSettings("appearance")}>
            <DropdownMenuIcon icon={item.icon} />
            {item.label}
          </DropdownMenuItem>
        );
      case "language":
        return (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={localeFetcher.state !== "idle"}>
              <DropdownMenuIcon icon={item.icon} />
              {item.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <localeFetcher.Form method="post" action="/api/locale">
                {languageOptions.map((opt) => (
                  <DropdownMenuItem key={opt.value} asChild>
                    <button
                      type="submit"
                      name="locale"
                      value={opt.value}
                      disabled={
                        localeFetcher.state !== "idle" ||
                        opt.value === resolvedLocale
                      }
                      className="flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none focus:bg-accent data-[highlighted]:bg-accent"
                    >
                      <span
                        className={
                          opt.value === resolvedLocale
                            ? "font-medium"
                            : undefined
                        }
                      >
                        {opt.label}
                      </span>
                      {opt.value === resolvedLocale ? (
                        <LuCheck className="ml-auto h-4 w-4 shrink-0" />
                      ) : null}
                    </button>
                  </DropdownMenuItem>
                ))}
              </localeFetcher.Form>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        );
      case "legal":
        return (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DropdownMenuIcon icon={item.icon} />
              {item.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {item.children?.map((child) => (
                <DropdownMenuItem key={child.id} asChild>
                  <a href={child.to}>
                    <DropdownMenuIcon icon={child.icon} />
                    {child.label}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        );
      case "about":
        return (
          <DropdownMenuItem onClick={itarDisclosure.onOpen}>
            <DropdownMenuIcon icon={item.icon} />
            {item.label}
          </DropdownMenuItem>
        );
      case "signOut":
        return (
          <DropdownMenuItem asChild>
            <Form method="post" action={path.to.logout}>
              <button type="submit" className="w-full h-full flex items-center">
                <DropdownMenuIcon icon={item.icon} />
                <span>{item.label}</span>
              </button>
            </Form>
          </DropdownMenuItem>
        );
    }
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger
          data-user-menu
          className="outline-none focus-visible:outline-none"
        >
          <Avatar path={user.avatarUrl} name={name} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{signedInAs}</DropdownMenuLabel>
          {items.map((item, index) => (
            <Fragment key={item.id}>
              {item.group !== items[index - 1]?.group && (
                <DropdownMenuSeparator />
              )}
              {renderItem(item)}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {CONTROLLED_ENVIRONMENT && <ItarDisclosure disclosure={itarDisclosure} />}
    </>
  );
};

export default AvatarMenu;
