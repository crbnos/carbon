import { useLingui } from "@lingui/react/macro";
import { LuUserCheck } from "react-icons/lu";
import { SearchLandingPage } from "~/components";
import { type ScopeOption, ScopePicker } from "./ScopePicker";

type PriceListScopeEmptyProps = {
  scopeOptions: ScopeOption[];
  value: string;
  onChange: (next: string) => void;
};

export function PriceListScopeEmpty({
  scopeOptions,
  value,
  onChange
}: PriceListScopeEmptyProps) {
  const { t } = useLingui();

  return (
    <SearchLandingPage
      icon={LuUserCheck}
      heading={t`Price Lists`}
      description={t`Pick a customer or customer type to view their pricing.`}
    >
      <div className="flex justify-center [&>[role=combobox]]:!min-w-[400px]">
        <ScopePicker
          size="md"
          value={value}
          options={scopeOptions}
          onChange={onChange}
          placeholder={t`Search customers or types...`}
        />
      </div>
    </SearchLandingPage>
  );
}
