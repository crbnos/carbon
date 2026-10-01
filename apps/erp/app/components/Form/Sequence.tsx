// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SelectProps } from "@carbon/form";
import { Select } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getSequencesList } from "~/modules/settings";
import { path } from "~/utils/path";

type SequenceSelectProps = Omit<SelectProps, "options"> & {
  table: string;
};

const Sequence = (props: SequenceSelectProps) => {
  const sequenceFetcher =
    useFetcher<Awaited<ReturnType<typeof getSequencesList>>>();

  useMount(() => {
    sequenceFetcher.load(path.to.api.sequences(props.table));
  });

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
