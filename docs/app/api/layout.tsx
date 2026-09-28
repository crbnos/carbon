import type { ReactNode } from "react";
import { ContextualNav } from "@/components/api/contextual-nav";
import { ApiConfigProvider } from "@/components/api/config-context";
import { Configurator } from "@/components/api/configurator";
import { MainHeader } from "@/components/main-header";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
import { navTree } from "@/lib/api-data";
import { toolsNavTree } from "@/lib/tools-data";

/**
 * One layout for the whole API surface — one header entry, one configurator, and
 * ONE tree at a time: the sidebar is contextual (see ContextualNav), showing the
 * Carbon API catalog everywhere except under /api/data, where the Data API's
 * resource tree swaps in with a way back.
 */
function ApiSidebar() {
  return (
    <>
      <Configurator />
      <ContextualNav operations={toolsNavTree} tree={navTree} />
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
