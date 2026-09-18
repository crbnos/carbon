import {
  Code,
  DocEyebrow,
  DocLink,
  DocPage,
  DocTitle,
  H2,
  Lead,
  P
} from "@/components/api/doc";
import { ContentFooter } from "@/components/api/page-footer";
import { SdkCardGrid } from "@/components/api/sdk-cards";
import { sdkLanguageCards } from "@/components/api/sdk-languages";
import { pageSeo, SEO } from "@/lib/seo";
import { toolCounts } from "@/lib/tools-data";

export const metadata = pageSeo({
  title: `${SEO.carbonApi.intro.title} — Carbon`,
  ogTitle: SEO.carbonApi.intro.title,
  description: SEO.carbonApi.intro.description,
  path: "/api",
  eyebrow: "Carbon API"
});

// Counts are read from the generated catalog so the copy can never go stale.
const {
  total: OPERATION_COUNT,
  modules: MODULE_COUNT,
  byClass: BY_CLASS
} = toolCounts();

/* Scale, at a glance. The overview's first job is orientation, and three numbers
 * do it faster than the sentence they replace — the sections below then explain
 * each one in order (operations, transports). Chrome matches `Table`. */
function StatStrip({ stats }: { stats: [string, string][] }) {
  return (
    <div className="mt-6 grid grid-cols-3 overflow-hidden rounded-[10px] border border-ed-warm-300">
      {stats.map(([value, label], i) => (
        <div
          key={label}
          className={`px-4 py-[13px] ${i > 0 ? "border-l border-ed-warm-300" : ""}`}
        >
          <p className="m-0 text-ed-24 font-semibold leading-[120%] tracking-tight text-ed-ink tabular-nums">
            {value}
          </p>
          <p className="m-0 mt-1 font-mono text-ed-12 uppercase tracking-[0.06em] text-ed-ink/60">
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function ApiOverviewPage() {
  return (
    <DocPage>
      <DocEyebrow>Carbon API</DocEyebrow>
      <DocTitle>The Carbon API</DocTitle>
      <Lead>
        The Carbon API is the service layer — the same code the app runs when
        you click a button. Every call validates its input, recalculates what
        depends on it, and enforces your permissions. It's the surface to build
        on.
      </Lead>

      <StatStrip
        stats={[
          [OPERATION_COUNT.toLocaleString(), "Operations"],
          [String(MODULE_COUNT), "Modules"],
          ["2", "Transports"]
        ]}
      />

      <H2 id="operations">What you can call</H2>
      <P>
        Create a job, draft a quote, adjust inventory, post an invoice —{" "}
        {OPERATION_COUNT.toLocaleString()} operations across {MODULE_COUNT}{" "}
        modules, the same set the app itself calls. Each carries a{" "}
        <Code>READ</Code> / <Code>WRITE</Code> / <Code>DESTRUCTIVE</Code>{" "}
        classification — {BY_CLASS.READ.toLocaleString()} read,{" "}
        {BY_CLASS.WRITE.toLocaleString()} write,{" "}
        {BY_CLASS.DESTRUCTIVE.toLocaleString()} destructive — so a client can
        filter or gate by risk.
      </P>
      <P>
        Every operation has a page of its own with a copyable sample in six
        languages — browse them by module in the sidebar, or search from
        anywhere in these docs.
      </P>

      <H2 id="connect">How you connect</H2>
      <P>
        Every operation is reachable two ways, with the same arguments and the
        same permissions: over plain HTTP as{" "}
        <Code>POST /api/v1/&#123;module&#125;/&#123;operation&#125;</Code>, and
        as a tool over MCP — so any MCP client, Claude Code, Cursor or ChatGPT,
        can read and write in plain language.
      </P>
      <P>
        <DocLink href="/api/mcp">Connect over MCP</DocLink> covers the setup,
        and <DocLink href="/api/authentication">Authentication</DocLink> covers
        how a client proves who it is and what it's allowed to touch.
      </P>

      <H2 id="sdks">Build in your language</H2>
      <P>
        Carbon publishes an OpenAPI spec for all{" "}
        {OPERATION_COUNT.toLocaleString()} operations, with input schemas taken
        from the validators the server runs and response shapes reflected from
        the service functions. A typed client is one generator command away —
        nothing hand-maintained to fall behind.
      </P>
      <SdkCardGrid cards={sdkLanguageCards("/api/sdks")} />
      <P>
        Full commands, the spec URL, and how to authenticate a generated client
        are on <DocLink href="/api/sdks">Client SDKs</DocLink>.
      </P>

      <H2 id="data">The Data API</H2>
      <P>
        The <DocLink href="/api/data">Data API</DocLink> is the escape hatch —
        every table and view as a REST endpoint, for the rare case this surface
        doesn't cover. It skips the service layer, so a write there skips the
        validation and recalculation with it. Reach for it when you know
        exactly what the table touches.
      </P>

      <ContentFooter next={{ label: "Connect over MCP", url: "/api/mcp" }} />
    </DocPage>
  );
}
