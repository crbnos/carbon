import type { ReactNode } from "react";
import { ApiConfigProvider } from "@/components/api/config-context";
import { Configurator } from "@/components/api/configurator";
import { McpNav } from "@/components/api/mcp-nav";
import { TableOfContents } from "@/components/api/toc";
import { MainHeader } from "@/components/main-header";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
import { toolsNavTree } from "@/lib/tools-data";

export default function McpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-[#FBFBF9]">
      <MainHeader
        active="mcp"
        mobileNav={
          <>
            <Configurator />
            <McpNav tools={toolsNavTree} />
          </>
        }
      />

      <ApiConfigProvider>
        <div className="mx-auto flex w-full max-w-[1480px] pt-[64px]">
          <aside className="sticky top-[64px] hidden h-[calc(100dvh-64px)] w-[280px] shrink-0 overflow-y-auto border-r border-[#E7E7E3] px-[20px] py-[28px] scrollbar-hidden-until-scroll nav-scroll-fade lg:block">
            <Configurator />
            <McpNav tools={toolsNavTree} />
            <NavScrollChevron />
          </aside>
          <main className="min-w-0 flex-1 px-[24px] pb-[140px] pt-[40px] lg:px-[56px]">
            {children}
          </main>
          <aside className="hidden w-[232px] shrink-0 px-[28px] pt-[40px] xl:block">
            <TableOfContents />
          </aside>
        </div>
      </ApiConfigProvider>
    </div>
  );
}
