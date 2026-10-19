// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request);

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const isGroupParam = searchParams.get("isGroup");
  const classes = searchParams.getAll("class");
  const incomeBalance = searchParams.get("incomeBalance");

  const isGroup =
    isGroupParam === "true" ? true : isGroupParam === "false" ? false : null;

  const result = await api.accounting.getAccountsList({
    isGroup,
    incomeBalance: incomeBalance as "Balance Sheet" | "Income Statement" | null,
    classes: classes as (
      | "Asset"
      | "Equity"
      | "Expense"
      | "Liability"
      | "Revenue"
    )[]
  });

  return result;
}
