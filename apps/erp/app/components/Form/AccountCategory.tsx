import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import type {
  AccountCategory as AccountCategoryType,
  getAccountCategoriesList,
} from "~/modules/accounting";
import { path } from "~/utils/path";

type AccountCategorySelectProps = Omit<
  ComboboxProps,
  "options" | "onChange"
> & {
  onChange?: (accountCategory: AccountCategoryType | null) => void;
};

const AccountCategory = (props: AccountCategorySelectProps) => {
  const accountCategoryFetcher =
    useFetcher<Awaited<ReturnType<typeof getAccountCategoriesList>>>();

  useMount(() => {
    accountCategoryFetcher.load(path.to.api.accountingCategories);
  });

  const options =
    useMemo(() => {
      return (
        accountCategoryFetcher.data?.data?.map((c) => ({
          value: c.id,
          label: c.category,
        })) ?? []
      );
    }, [accountCategoryFetcher.data]) ?? [];

  const onChange = (
    selection: {
      value: string;
      label: string;
    } | null
  ) => {
    const category =
      accountCategoryFetcher.data?.data?.find(
        (category) => category.id === selection?.value
      ) ?? null;

    props.onChange?.(category as AccountCategoryType | null);
  };

  return (
    <Combobox
      options={options}
      {...props}
      onChange={onChange}
      label={props?.label ?? "Account Category"}
    />
  );
};

AccountCategory.displayName = "AccountCategory";

export default AccountCategory;
