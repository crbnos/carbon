// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type ClientJournalLine = {
  id: string;
  accountId: string;
  description: string;
  debit: number | null;
  credit: number | null;
  dimensions: JournalLineDimensionValue[];
};

export type DimensionWithValues = {
  dimensionId: string;
  dimensionName: string;
  entityType: string;
  required: boolean;
  values: { id: string; name: string }[];
};

export type JournalLineDimensionValue = {
  dimensionId: string;
  dimensionName: string;
  valueId: string;
  valueName: string;
};
