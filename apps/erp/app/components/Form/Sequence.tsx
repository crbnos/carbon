// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
import type { getSequencesList } from "~/modules/settings";
import { path } from "~/utils/path";

type SequenceSelectProps = Omit<SelectProps, "options"> & {
  table: string;
};

const Sequence = (props: SequenceSelectProps) => {
  const sequenceFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getSequencesList>>
  >(path.to.api.sequences(props.table));

  const options = useMemo(
    () =>
      sequenceFetcher.data?.data
        ? sequenceFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.id
          }))
        : [],
    [sequenceFetcher.data]
  );

  return (
    <Select options={options} {...props} label={props?.label ?? "Sequence"} />
  );
};

export default Sequence;
