import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuBuilding2 } from "react-icons/lu";
import { useUrlParams } from "~/hooks";

type Company = {
  id: string;
  name: string;
};

type CompanySelectorProps = {
  companies: Company[];
  selectedCompanyIds: string[];
};

const ALL = "__all__";

const CompanySelector = ({
  companies,
  selectedCompanyIds
}: CompanySelectorProps) => {
  const { t } = useLingui();
  const [, setParams] = useUrlParams();

  if (companies.length <= 1) return null;

  const allSelected = selectedCompanyIds.length === companies.length;
  const value = allSelected ? ALL : selectedCompanyIds[0];

  const label = allSelected
    ? t`All Companies`
    : (companies.find((c) => c.id === value)?.name ?? t`All Companies`);

  const onChange = (next: string) => {
    setParams({ companies: next === ALL ? "all" : next });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" leftIcon={<LuBuilding2 />}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          <DropdownMenuRadioItem value={ALL}>
            <Trans>All Companies</Trans>
          </DropdownMenuRadioItem>
          {companies.map((company) => (
            <DropdownMenuRadioItem key={company.id} value={company.id}>
              {company.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default CompanySelector;
