// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactElement, ReactNode } from "react";

export type ColumnFilter = {
  accessorKey: string;
  header: string;
  pluralHeader?: string;
  filter: ColumnFilterData;
  icon?: ReactElement;
};

export type Option = {
  label: string | ReactNode;
  value: string;
  helperText?: string;
};

export type ColumnFilterData =
  | {
      type: "static";
      options: Option[];
      isArray?: boolean;
    }
  | {
      type: "fetcher";
      endpoint: string;
      transform?: (result: any) => Option[];
      isArray?: boolean;
    };
