// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createContext, useContext } from "react";

export type AdditionalValidateFunction = (
  data: FormData
) => Record<string, string | undefined>;

type ContextValue = {
  register: (id: string, fn: AdditionalValidateFunction) => void;
  unregister: (id: string) => void;
};

export const AdditionalValidatorsContext = createContext<ContextValue | null>(
  null
);

export function useAdditionalValidatorsContext() {
  return useContext(AdditionalValidatorsContext);
}
