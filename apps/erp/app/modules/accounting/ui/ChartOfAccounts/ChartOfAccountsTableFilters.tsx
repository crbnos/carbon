// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuContent,
  DropdownMenuItem,
  HStack,
  Input,
  InputGroup,
  InputLeftElement
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuPlus, LuSearch, LuWallet, LuX } from "react-icons/lu";
import { Link } from "react-router";
import { New, PeriodSelector } from "~/components";
import { AppBarAction } from "~/components/New";
import { usePermissions, useUrlParams } from "~/hooks";

type ChartOfAccountsTableFiltersProps = {
  fiscalStartMonth?: number;
  search: string;
  onSearchChange: (value: string) => void;
  openingBalanceMode: boolean;
  canEnterOpeningBalances: boolean;
  hasOpeningBalanceEntries: boolean;
  onEnterOpeningBalances: () => void;
  onCancelOpeningBalances: () => void;
  onPostOpeningBalances: () => void;
};

const ChartOfAccountsTableFilters = ({
  fiscalStartMonth,
  search,
  onSearchChange,
  openingBalanceMode,
  canEnterOpeningBalances,
  hasOpeningBalanceEntries,
  onEnterOpeningBalances,
  onCancelOpeningBalances,
  onPostOpeningBalances
}: ChartOfAccountsTableFiltersProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();
  const permissions = usePermissions();
  const newGroupTo = `new-group?${params.toString()}`;
  const newAccountTo = `new?${params.toString()}`;

  return (
    <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full max-md:flex-wrap max-md:gap-y-1 max-md:space-x-0 max-md:px-0 max-md:py-1.5">
      <HStack className="max-md:w-full max-md:flex-nowrap max-md:overflow-x-auto max-md:scrollbar-hide max-md:scroll-fade-x max-md:whitespace-nowrap max-md:px-4 max-md:py-1.5 max-md:[&>*]:shrink-0">
        <InputGroup size="sm" className="w-64 max-md:w-48">
          <InputLeftElement>
            <LuSearch className="h-4 w-4 text-muted-foreground" />
          </InputLeftElement>
          <Input
            placeholder={t`Search accounts...`}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </InputGroup>
        <PeriodSelector variant="range" fiscalStartMonth={fiscalStartMonth} />
        {[...params.entries()].length > 0 && (
          <Button
            variant="secondary"
            rightIcon={<LuX />}
            onClick={() =>
              setParams({
                startDate: undefined,
                endDate: undefined
              })
            }
          >
            <Trans>Reset</Trans>
          </Button>
        )}
      </HStack>
      <HStack className="max-md:ml-auto max-md:mr-4">
        {openingBalanceMode ? (
          // Entering opening balances: Add Group / Add Account are hidden; only
          // Cancel + Post remain.
          <>
            <Button variant="secondary" onClick={onCancelOpeningBalances}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="primary"
              leftIcon={<LuCheckCheck />}
              isDisabled={!hasOpeningBalanceEntries}
              onClick={onPostOpeningBalances}
            >
              <Trans>Post</Trans>
            </Button>
          </>
        ) : (
          <>
            {permissions.can("create", "accounting") && (
              // Phones: one app bar "+" opens both Add actions, instead of
              // two identical "+" icons.
              <AppBarAction
                icon={<LuPlus />}
                label={t`Add`}
                menu={
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to={newGroupTo}>{t`Add Group`}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to={newAccountTo}>{t`Add Account`}</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                }
              >
                <New label={t`Group`} to={newGroupTo} />
                <New label={t`Account`} to={newAccountTo} />
              </AppBarAction>
            )}
            {canEnterOpeningBalances && (
              <Button
                variant="secondary"
                leftIcon={<LuWallet />}
                onClick={onEnterOpeningBalances}
              >
                <Trans>Opening Balances</Trans>
              </Button>
            )}
          </>
        )}
      </HStack>
    </div>
  );
};

export default ChartOfAccountsTableFilters;
