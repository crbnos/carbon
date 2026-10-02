// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createContext, useContext } from "react";
import type useUserSelect from "./useUserSelect";

type ContextType = ReturnType<typeof useUserSelect>;

export const UserSelectContext = createContext<ContextType>({} as ContextType);

export default function useUserSelectContext() {
  const context = useContext(UserSelectContext);
  if (context === undefined) {
    throw new Error(
      "useUserSelectContext must be used within a UserSelectContext.Provider"
    );
  }
  return context;
}
