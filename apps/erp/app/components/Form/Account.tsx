// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { Badge, Combobox as ComboboxBase } from "@carbon/react";
import { useMemo } from "react";
import type { AccountClass, getAccountsList } from "~/modules/accounting";
import { path } from "~/utils/path";

type AccountData = {
  id: string;
  number: string;
  name: string;
  class: AccountClass | null;
  incomeBalance: string | null;
};

const NO_ACCOUNTS: AccountData[] = [];

export function useAccounts(classes?: AccountClass[]): AccountData[] {
  const { data } = useLoaderQuery<Awaited<ReturnType<typeof getAccountsList>>>(
    `${path.to.api.accounts}?isGroup=false`
  );
  const accounts = (data?.data ?? NO_ACCOUNTS) as AccountData[];

  return useMemo(() => {
    if (!classes || classes.length === 0) return accounts;
    return accounts.filter(
      (a) => a.class && classes.includes(a.class as AccountClass)
    );
  }, [accounts, classes]);
}

const badgeColors: Record<
  string,
  "green" | "red" | "blue" | "yellow" | "orange"
> = {
  Asset: "green",
  Liability: "red",
  Equity: "blue",
  Revenue: "yellow",
  Expense: "orange"
};

function useAccountOptions(classes?: AccountClass[]) {
  const accounts = useAccounts(classes);

  return useMemo(
    () =>
      accounts.map((c) => ({
        value: c.id,
        label: (
          <div className="flex items-center justify-between w-full gap-2">
            <span className="truncate">
              <span className="text-muted-foreground">{c.number}</span> {c.name}
            </span>
            {c.class && <Badge variant={badgeColors[c.class]}>{c.class}</Badge>}
          </div>
        )
      })),
    [accounts]
  );
}

type AccountSelectProps = Omit<ComboboxProps, "options"> & {
  classes?: AccountClass[];
};

const Account = ({ classes, ...props }: AccountSelectProps) => {
  const options = useAccountOptions(classes);

  return (
    <Combobox options={options} {...props} label={props?.label ?? "Account"} />
  );
};

Account.displayName = "Account";

export default Account;

type AccountControlledProps = {
  classes?: AccountClass[];
  value?: string;
  onChange?: (selected: string) => void;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
  isReadOnly?: boolean;
};

export const AccountControlled = ({
  classes,
  ...props
}: AccountControlledProps) => {
  const options = useAccountOptions(classes);

  return <ComboboxBase options={options} {...props} />;
};

AccountControlled.displayName = "AccountControlled";
