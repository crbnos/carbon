import type { McpCatalog } from "../catalog";
import { Authentication } from "./Authentication";
import { Cta } from "./Cta";
import { Faq } from "./Faq";
import { Footer } from "./Footer";
import { Lede } from "./Lede";
import { Nav } from "./Nav";
import { OnThisPageNav } from "./OnThisPageNav";
import { Quickstart } from "./Quickstart";
import { Safety } from "./Safety";
import { Section } from "./Section";
import { ToolDiscovery } from "./ToolDiscovery";
import { Tools } from "./Tools";
import { WaveScrollRail } from "./WaveScrollRail";
import { WhatIsMcp } from "./WhatIsMcp";
import { WhatYouCanAsk } from "./WhatYouCanAsk";

export function McpPage({ catalog }: { catalog: McpCatalog }) {
  return (
    <div className="MCP bg-[var(--canvas)] text-foreground antialiased min-h-screen">
      <Nav />
      <WaveScrollRail />
      <div className="container">
        <div className="grid grid-cols-1 min-[880px]:grid-cols-[200px_minmax(0,720px)] gap-12 pt-[52px] pb-10">
          <OnThisPageNav />
          <main>
            <Lede total={catalog.total} />
            <Section
              id="whatis"
              fig="FIG.01"
              label="OVERVIEW"
              title="What is MCP?"
            >
              <WhatIsMcp />
            </Section>
            <WhatYouCanAsk />
            <Section
              id="quickstart"
              fig="FIG.03"
              label="QUICKSTART"
              title="Quickstart"
            >
              <Quickstart />
            </Section>
            <Section
              id="discovery"
              fig="FIG.04"
              label="ARCHITECTURE"
              title="How tool discovery works"
            >
              <ToolDiscovery total={catalog.total} />
            </Section>
            <Section id="tools" fig="FIG.05" label="REFERENCE" title="Tools">
              <Tools catalog={catalog} />
            </Section>
            <Section
              id="auth"
              fig="FIG.06"
              label="SECURITY"
              title="Authentication"
            >
              <Authentication />
            </Section>
            <Section id="safety" fig="FIG.07" label="SAFETY" title="Safety">
              <Safety />
            </Section>
            <Section id="faq" fig="FIG.08" label="FAQ" title="FAQ">
              <Faq />
            </Section>
            <Cta />
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
