// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/* biome-ignore-all lint: dev harness, not shipped */
import { LocaleProvider } from "@carbon/locale";
import {
  NavRail,
  NavRailGroup,
  NavRailLink,
  OperatingSystemContextProvider,
  SidebarProvider,
  TooltipProvider,
  ViewportProvider
} from "@carbon/react";
import { themeByName } from "@carbon/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { LuFileText } from "react-icons/lu";
import { createMemoryRouter, RouterProvider } from "react-router";
import CompanySwitcher from "~/components/Layout/Navigation/CompanySwitcher";
import "./harness.css";

/**
 * Renders the real ERP rail header (CompanySwitcher) with stubbed data, no
 * backend. Query parameters (see README.md): long=1, multi=0, dark=1, open=1.
 */
const q = new URLSearchParams(location.search);
const long = q.get("long") === "1";
const dark = q.get("dark") === "1";

const companyName = long
  ? "Northwind Precision Aerospace & Defense Manufacturing Holdings, Inc."
  : "Acme Manufacturing";
const mk = (id: string, name: string) => ({
  id,
  companyId: id,
  name,
  logoDarkIcon: null,
  logoLightIcon: null,
  logoDark: null,
  logoLight: null,
  countryCode: "US",
  baseCurrencyCode: "USD",
  ownerId: "u1",
  employeeType: "Admin",
  companyGroupName: null
});
const company = mk("c1", companyName);
const companies =
  q.get("multi") === "0" ? [company] : [company, mk("c2", "Globex Industrial")];

// The app injects its theme as CSS variables at runtime (root.tsx).
if (dark) document.documentElement.classList.add("dark");
const theme = themeByName(undefined as any);
for (const [k, v] of Object.entries(
  (dark ? theme.cssVars.dark : theme.cssVars.light) as Record<string, string>
)) {
  document.documentElement.style.setProperty(`--${k}`, String(v));
}
document.documentElement.style.setProperty("--radius", "0.4375rem");
document.body.style.background = "hsl(var(--background))";

const data = {
  company,
  companies,
  user: {
    id: "u1",
    email: "dane@example.com",
    firstName: "Dane",
    lastName: "Albaugh",
    avatarUrl: null,
    admin: true
  },
  groups: [],
  defaults: { locationId: null }
};

function Shell() {
  return (
    <SidebarProvider defaultOpen={q.get("open") === "1"}>
      <TooltipProvider delayDuration={0}>
        <NavRail header={<CompanySwitcher />}>
          <NavRailGroup label="Sales">
            <NavRailLink to="/x/quotes" icon={<LuFileText />} label="Quotes" />
          </NavRailGroup>
        </NavRail>
        <main className="m-2 flex-1 rounded-2xl border bg-card p-6">
          ERP page content
        </main>
      </TooltipProvider>
    </SidebarProvider>
  );
}

// useUser and useRouteData read the route at /x, as in the real app.
const router = createMemoryRouter(
  [{ id: "/x", path: "/x", loader: () => data, element: <Shell /> }],
  { initialEntries: ["/x"] }
);

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <OperatingSystemContextProvider platform="mac">
      <ViewportProvider initialViewport="desktop">
        <LocaleProvider locale="en">
          <RouterProvider router={router} />
        </LocaleProvider>
      </ViewportProvider>
    </OperatingSystemContextProvider>
  </QueryClientProvider>
);
