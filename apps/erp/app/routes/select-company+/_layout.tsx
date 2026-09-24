import { getMESUrl } from "@carbon/auth";
import { requireAuthSession } from "@carbon/auth/session.server";
import { TooltipProvider } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request, { verify: true });

  // Console terminals are MES-only — never let them reach the ERP picker.
  // Mirrors the guard in x+/_layout.tsx.
  if (authSession.console) {
    throw redirect(getMESUrl());
  }

  return {};
}

export default function SelectCompanyLayout() {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen items-center justify-center bg-background p-4">
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
