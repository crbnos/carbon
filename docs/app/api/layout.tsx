import type { ReactNode } from "react";
import { ApiSurfaceNav } from "@/components/api/api-surface-nav";
import { ApiConfigProvider } from "@/components/api/config-context";
import { Configurator } from "@/components/api/configurator";
import { TableOfContents } from "@/components/api/toc";
import { MainHeader } from "@/components/main-header";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
import { toolsNavTree } from "@/lib/tools-data";

export default function ApiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-ed-paper">
      <ApiConfigProvider>
        <MainHeader
          active="api"
          mobileNav={
            <>
              <Configurator />
              <ApiSurfaceNav operations={toolsNavTree} />
            </>
          }
        />

        <div className="mx-auto flex w-full max-w-370 pt-16">
          <aside className="sticky top-16 hidden h-[calc(100dvh-64px)] w-70 shrink-0 overflow-y-auto border-r border-ed-hairline px-5 py-7 scrollbar-hidden-until-scroll nav-scroll-fade lg:block">
            <Configurator />
            <ApiSurfaceNav operations={toolsNavTree} />
            <NavScrollChevron />
          </aside>
          <main className="min-w-0 flex-1 px-6 pb-35 pt-10 lg:px-14">
            {children}
          </main>
          <aside className="hidden w-58 shrink-0 px-7 pt-10 xl:block">
            <TableOfContents />
          </aside>
        </div>
      </ApiConfigProvider>
    </div>
  );
}
