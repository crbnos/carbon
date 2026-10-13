// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { path } from "~/utils/path";

type BillingElementProps = Omit<ComboboxProps, "options"> & {
  /** The contract line's project. With none, the picker is empty. */
  projectId?: string | null;
};

type BillingElementRow = { id: string; readableId: string; name: string };

/** Picks a billing element (`isBilling`) of one Contract-treatment project:
 *  the element a Time & Materials or Cost Plus line bills, with its subtree. */
const BillingElement = ({ projectId, ...props }: BillingElementProps) => {
  const { t } = useLingui();
  const { data, isLoading } = useLoaderQuery<{ data: BillingElementRow[] }>(
    projectId ? path.to.api.projectBillingElements(projectId) : null
  );

  const options = useMemo(
    () =>
      (data?.data ?? []).map((element) => ({
        value: element.id,
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 whitespace-nowrap font-medium">
              {element.readableId}
            </span>
            <span className="truncate">{element.name}</span>
          </span>
        ),
        keywords: [element.readableId, element.name].join(" ")
      })),
    [data]
  );

  return (
    <Combobox
      options={options}
      isLoading={!!projectId && isLoading}
      isClearable
      {...props}
      label={props.label ?? t`Billing Element`}
    />
  );
};

BillingElement.displayName = "BillingElement";

export default BillingElement;
