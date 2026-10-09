// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ButtonProps } from "@carbon/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  IconButton,
  useViewport
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactElement, ReactNode } from "react";
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
  /** Accessible name of the phone icon. */
  label: string;
  isDisabled?: boolean;
  /** The desktop control, rendered unchanged everywhere but the app bar. */
  children: ReactNode;
} & (
  | { to: string; onClick?: never; menu?: never }
  | { onClick: () => void; to?: never; menu?: never }
  | { menu: ReactNode; to?: never; onClick?: never }
);

type AppBarActionProps =
  | (NewActionProps & { icon: ReactElement })
  | { icon?: never; children: ReactNode };

/**
 * A page action that moves to the app bar on phones, as `icon`: a link to
 * `to`, a button calling `onClick`, or a trigger opening `menu` (a
 * `DropdownMenuContent`). Without `icon`, `children` move there unchanged.
 * Elsewhere it renders `children`.
 */
export function AppBarAction(props: AppBarActionProps) {
  const { isPhone } = useViewport();
  if (!isPhone) return <>{props.children}</>;
  if (props.icon === undefined) {
    return <AppBarActions>{props.children}</AppBarActions>;
  }

  const { icon, label, isDisabled, to, onClick, menu } = props;
  if (to) {
    return (
      <AppBarActions>
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
      </AppBarActions>
    );
  }

  const button = (
    <IconButton
      icon={icon}
      variant="ghost"
      size="lg"
      aria-label={label}
      isDisabled={isDisabled}
      onClick={onClick}
    />
  );
  return (
    <AppBarActions>
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      ) : (
        button
      )}
    </AppBarActions>
  );
}

/**
 * A page's create action. On phones it becomes the app bar "+" unless an
 * ancestor places it inline, e.g. as an empty state's primary action.
 */
export function NewAction(props: NewActionProps) {
  const placement = useContext(NewPlacementContext);
  if (placement !== "appBar") return <>{props.children}</>;
  return <AppBarAction icon={<LuPlus className="size-6" />} {...props} />;
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
