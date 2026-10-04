// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useUser } from "~/hooks";

type ContractProjectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const ProjectPreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode }[]
) => {
  const project = options.find((o) => o.value === value);
  if (!project) return null;
  return <span>{project.label}</span>;
};

/** The company's active projects (Accounting → Projects). A contract's
 *  project is carried onto every invoice line it drafts, as the Project
 *  dimension. */
const ContractProject = (props: ContractProjectProps) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!carbon || !company?.id) return;
    let cancelled = false;
    carbon
      .from("project")
      .select("id, name")
      .eq("companyId", company.id)
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        if (cancelled) return;
        setOptions(
          (data ?? []).map((project) => ({
            value: project.id,
            label: project.name
          }))
        );
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, company?.id]);

  return (
    <Combobox
      options={options}
      isLoading={isLoading}
      isClearable
      {...props}
      inline={props.inline ? ProjectPreview : undefined}
      label={props.label ?? t`Project`}
    />
  );
};

export default ContractProject;
