// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ButtonProps } from "@carbon/react";
import { Button, IconButton, useViewport } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore
} from "react";
import { LuCirclePlus, LuPlus } from "react-icons/lu";
import { Link } from "react-router";
import { SHORTCUTS } from "~/shortcuts";
import { AppBarActions } from "./Layout/Mobile/ChromeSlots";

/**
 * On phones a New button moves to the app bar as "+" unless the
 * caller renders it inline, e.g. as an empty state's primary action.
 */
export const NewPlacementContext = createContext<"appBar" | "inline">("appBar");

// `n` means "the New action" only while a screen shows exactly one New
// button. With two visible Add buttons (e.g. Chart of Accounts renders
// Add Group AND Add Account) one key cannot name both, so every instance
// drops the binding and the badge instead of racing for it.
let mountedCount = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getCount = () => mountedCount;
const getServerCount = () => 1;

type NewActionProps = {
  /** Accessible name of the phone "+". */
  label: string;
  isDisabled?: boolean;
  /** The desktop control, rendered unchanged everywhere but the app bar. */
  children: ReactNode;
} & ({ to: string; onClick?: never } | { onClick: () => void; to?: never });

/**
 * A page's create action. On phones it becomes the app bar "+" (a link to
 * `to`, or a button calling `onClick`) unless an ancestor places it inline,
 * e.g. as an empty state's primary action. Elsewhere it renders `children`.
 */
export function NewAction({
  label,
  isDisabled,
  to,
  onClick,
  children
}: NewActionProps) {
  const { isPhone } = useViewport();
  const placement = useContext(NewPlacementContext);
  if (!isPhone || placement !== "appBar") return <>{children}</>;

  const icon = <LuPlus className="size-6" />;
  return (
    <AppBarActions>
      {to ? (
        <Button
          asChild
          isIcon
          variant="ghost"
          size="lg"
          aria-label={label}
          isDisabled={isDisabled}
        >
          <Link to={to}>{icon}</Link>
        </Button>
      ) : (
        <IconButton
          icon={icon}
          variant="ghost"
          size="lg"
          aria-label={label}
          isDisabled={isDisabled}
          onClick={onClick}
        />
      )}
    </AppBarActions>
  );
}

type NewProps = {
  label?: string;
  to: string;
  variant?: ButtonProps["variant"];
};

const New = ({ label, to, variant = "primary" }: NewProps) => {
  const { t } = useLingui();

  useEffect(() => {
    mountedCount++;
    listeners.forEach((listener) => {
      listener();
    });
    return () => {
      mountedCount--;
      listeners.forEach((listener) => {
        listener();
      });
    };
  }, []);
  const isSoleNew =
    useSyncExternalStore(subscribe, getCount, getServerCount) <= 1;
  const text = label ? `${t`Add`} ${label}` : t`Add`;

  return (
    <NewAction label={text} to={to}>
      <Button
        asChild
        leftIcon={<LuCirclePlus />}
        variant={variant}
        shortcut={isSoleNew ? SHORTCUTS.newRecord : undefined}
      >
        <Link to={to}>{text}</Link>
      </Button>
    </NewAction>
  );
};

export default New;
