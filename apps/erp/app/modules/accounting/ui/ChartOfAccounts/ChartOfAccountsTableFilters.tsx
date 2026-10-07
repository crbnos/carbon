// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  useCompact
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuPlus, LuSearch, LuWallet, LuX } from "react-icons/lu";
import { Link } from "react-router";
import { New, PeriodSelector } from "~/components";
import { AppBarActions } from "~/components/Layout/Mobile/ChromeSlots";
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
  const isCompact = useCompact();
  const newGroupTo = `new-group?${params.toString()}`;
  const newAccountTo = `new?${params.toString()}`;

  return (
    <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full compact:flex-wrap compact:gap-y-1 compact:space-x-0 compact:px-0 compact:py-1.5">
      <HStack className="compact:w-full compact:flex-nowrap compact:overflow-x-auto compact:scrollbar-hide compact:scroll-fade-x compact:whitespace-nowrap compact:px-4 compact:py-1.5 compact:[&>*]:shrink-0">
        <InputGroup size="sm" className="w-64 compact:w-48">
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
      <HStack className="compact:ml-auto compact:mr-4">
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
            {permissions.can("create", "accounting") &&
              (isCompact ? (
                // Phones: one app bar "+" opens both Add actions, instead of
                // two identical "+" icons.
                <AppBarActions>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label={t`Add`}
                        icon={<LuPlus />}
                        variant="ghost"
                        size="lg"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={newGroupTo}>{t`Add Group`}</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={newAccountTo}>{t`Add Account`}</Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </AppBarActions>
              ) : (
                <>
                  <New label={t`Group`} to={newGroupTo} />
                  <New label={t`Account`} to={newAccountTo} />
                </>
              ))}
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
