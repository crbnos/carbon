import type { ReactNode } from "react";
import { ApiNav } from "@/components/api/api-nav";
import { ApiSurfaceNav } from "@/components/api/api-surface-nav";
import { ApiConfigProvider } from "@/components/api/config-context";
import { Configurator } from "@/components/api/configurator";
import { MainHeader } from "@/components/main-header";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
import { navTree } from "@/lib/api-data";
import { toolsNavTree } from "@/lib/tools-data";

/**
 * One layout for the whole API surface. Both APIs are the same product from a
 * reader's side — the Carbon API (service operations, the primary way to write) and
 * the Data API (raw PostgREST tables and views — the escape hatch) — so they share a
 * header entry, a sidebar and one host/API-key configurator instead of sitting in
 * two disconnected roots.
 */
function ApiSidebar() {
  return (
    <>
      <Configurator />
      <ApiSurfaceNav operations={toolsNavTree} />
      <div className="mt-5 border-t border-ed-hairline pt-4">
        <ApiNav tree={navTree} />
      </div>
    </>
  );
}

export default function ApiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-ed-paper">
      <ApiConfigProvider>
        <MainHeader active="api" mobileNav={<ApiSidebar />} />

        <div className="mx-auto flex w-full max-w-370 pt-16">
          <aside className="sticky top-16 hidden h-[calc(100dvh-64px)] w-70 shrink-0 overflow-y-auto border-r border-ed-hairline px-5 py-7 scrollbar-hidden-until-scroll nav-scroll-fade lg:block">
            <ApiSidebar />
            <NavScrollChevron />
          </aside>
          <main className="min-w-0 flex-1 px-6 pb-35 pt-10 lg:px-14">
            {children}
          </main>
        </div>
      </ApiConfigProvider>
    </div>
  );
}
