// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import type { importCsvFile } from "~/modules/shared/shared.server";

// Every field but these two is a column mapping: field → CSV column.
const importForm = z.looseObject({
  filePath: z.string().min(1, { message: "Path is required" }),
  enumMappings: zfd.json(
    z.record(z.string(), z.record(z.string(), z.string())).optional()
  )
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(importForm).request(args, {
    params: ["tableId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const { filePath, enumMappings, ...columnMappings } = input.data;
  return api.shared.importCsvFile({
    // The operation refuses a table it cannot import.
    table: input.params.tableId as z.input<typeof importCsvFile.input>["table"],
    filePath,
    enumMappings,
    columnMappings: columnMappings as Record<string, string>
  });
}
