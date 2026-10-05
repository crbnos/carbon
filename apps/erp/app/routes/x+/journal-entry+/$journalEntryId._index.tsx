// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");
  throw redirect(path.to.journalEntryDetails(journalEntryId));
}

export const middleware = [redirectBeforeLoaders(loader)];
