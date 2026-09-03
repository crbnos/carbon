import {
  Button,
  HStack,
  Input,
  InputGroup,
  InputLeftElement
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheckCheck, LuSearch, LuWallet, LuX } from "react-icons/lu";
import { New, PeriodSelector } from "~/components";
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

  return (
    <div className="flex px-4 py-3 items-center space-x-4 justify-between bg-card border-b border-border w-full">
      <HStack>
        <InputGroup size="sm" className="w-64">
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
      <HStack>
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
              <>
                <New label={t`Group`} to={`new-group?${params.toString()}`} />
                <New label={t`Account`} to={`new?${params.toString()}`} />
              </>
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
