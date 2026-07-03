import {
  Button,
  HStack,
  Input,
  InputGroup,
  InputLeftElement
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuSearch, LuX } from "react-icons/lu";
import { New, PeriodSelector } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";

type ChartOfAccountsTableFiltersProps = {
  fiscalStartMonth?: number;
  search: string;
  onSearchChange: (value: string) => void;
};

const ChartOfAccountsTableFilters = ({
  fiscalStartMonth,
  search,
  onSearchChange
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
        {permissions.can("create", "accounting") && (
          <>
            <New label={t`Group`} to={`new-group?${params.toString()}`} />
            <New label={t`Account`} to={`new?${params.toString()}`} />
          </>
        )}
      </HStack>
    </div>
  );
};

export default ChartOfAccountsTableFilters;
