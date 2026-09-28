import type { ButtonProps } from "@carbon/react";
import { Button } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useSyncExternalStore } from "react";
import { LuCirclePlus } from "react-icons/lu";
import { Link } from "react-router";
import { SHORTCUTS } from "~/shortcuts";

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

type NewProps = {
  label?: string;
  to: string;
  variant?: ButtonProps["variant"];
};

const New = ({ label, to, variant = "primary" }: NewProps) => {
  const { i18n, t } = useLingui();
  const translatedLabel = label ? i18n._(label) : undefined;

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

  return (
    <Button
      asChild
      leftIcon={<LuCirclePlus />}
      variant={variant}
      shortcut={isSoleNew ? SHORTCUTS.newRecord : undefined}
    >
      <Link to={to}>
        {translatedLabel ? `${t`Add`} ${translatedLabel}` : t`Add`}
      </Link>
    </Button>
  );
};

export default New;
