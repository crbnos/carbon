// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/* biome-ignore-all lint: dev harness, not shipped */
import { CarbonProvider } from "@carbon/auth";
import { LocaleProvider } from "@carbon/locale";
import {
  OperatingSystemContextProvider,
  SidebarProvider,
  TooltipProvider,
  ViewportProvider
} from "@carbon/react";
import { themeByName } from "@carbon/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppSidebar } from "~/components/AppSidebar";
import "./harness.css";

/**
 * Renders the real MES rail with stubbed data, no backend. Configure it with
 * query parameters (see README.md): long=1, multi=0, dark=1, open=1, loc=N.
 */
const q = new URLSearchParams(location.search);
const long = q.get("long") === "1";
const dark = q.get("dark") === "1";

const companyName = long
  ? "Northwind Precision Aerospace & Defense Manufacturing Holdings, Inc."
  : "Acme Manufacturing";
const mkCompany = (id: string, name: string) =>
  ({ companyId: id, id, name, logoLightIcon: null, logoDarkIcon: null }) as any;
const company = mkCompany("c1", companyName);
const companies =
  q.get("multi") === "0" ? [company] : [company, mkCompany("c2", "Globex Industrial")];
const locations = (
  long
    ? [
        "Building 4 – West Campus Heavy Fabrication & Welding Annex",
        "Building 7 – Cleanroom Assembly",
        "Warehouse"
      ]
    : ["Austin Plant", "Dallas Plant", "Warehouse"]
).map((name, i) => ({ id: `l${i}`, name })) as any;
const location_ = locations[Number(q.get("loc") ?? 0)].id;

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
  company: {
    id: "c1",
    name: companyName,
    logoDarkIcon: null,
    logoLightIcon: null,
    logoDark: null,
    logoLight: null
  },
  user: {
    id: "u1",
    email: "dane@example.com",
    firstName: "Dane",
    lastName: "Albaugh",
    avatarUrl: null
  }
};

function Shell() {
  return (
    <CarbonProvider session={{ accessToken: "harness" } as any}>
      <SidebarProvider defaultOpen={q.get("open") === "1"}>
        <TooltipProvider delayDuration={0}>
          <AppSidebar
            activeEvents={3}
            activeMaintenanceCount={1}
            openServiceJobCount={2}
            company={company}
            companies={companies}
            consoleMode={false}
            location={location_}
            locations={locations}
            pinnedInUser={null}
            moreOpen={false}
            onMoreOpenChange={() => {}}
          />
          <main className="m-2 flex-1 rounded-2xl border bg-card p-6">
            MES page content
          </main>
        </TooltipProvider>
      </SidebarProvider>
    </CarbonProvider>
  );
}

// useUser reads the route at /x, as in the real app.
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
