// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getMESUrl } from "@carbon/auth";
import { requireAuthSession } from "@carbon/auth/session.server";
import { TooltipProvider } from "@carbon/react";
import { redirectExternal } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request, { verify: true });

  // Console terminals are MES-only — never let them reach the ERP picker.
  // Mirrors the guard in x+/_layout.tsx.
  if (authSession.console) {
    throw redirectExternal(getMESUrl());
  }

  return {};
}

export default function SelectCompanyLayout() {
  return (
    <TooltipProvider>
      <div className="min-h-screen w-full bg-card">
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
