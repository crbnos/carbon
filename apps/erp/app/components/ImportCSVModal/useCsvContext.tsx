// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createContext, useContext } from "react";

export const ImportCsvContext = createContext<{
  filePath: string | null;
  file: File | null;
  fileColumns: string[] | null;
  firstRows: Record<string, string>[] | null;
  setFile: (file: File | null) => void;
  setFileColumns: (columns: string[] | null) => void;
  setFirstRows: (rows: Record<string, string>[] | null) => void;
  setFilePath: (filePath: string | null) => void;
} | null>(null);

export function useCsvContext() {
  const context = useContext(ImportCsvContext);

  if (!context)
    throw new Error(
      "useCsvContext must be used within an ImportCsvContext.Provider"
    );

  return context;
}
