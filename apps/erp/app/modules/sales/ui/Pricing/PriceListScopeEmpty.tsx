// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuList } from "react-icons/lu";
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
      icon={LuList}
      heading={t`Price Lists`}
      description={t`Pick a customer or customer type to view their pricing.`}
    >
      <div className="flex justify-center [&>[role=combobox]]:!min-w-[400px] max-md:[&>[role=combobox]]:!min-w-0 max-md:[&>[role=combobox]]:w-full max-md:[&>[role=combobox]]:h-11 max-md:[&>[role=combobox]]:rounded-md max-md:[&>[role=combobox]]:text-base">
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
