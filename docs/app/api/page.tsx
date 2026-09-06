import {
  Code,
  DocEyebrow,
  DocLink,
  DocPage,
  DocTitle,
  H2,
  Lead,
  P,
  Row,
  Table
} from "@/components/api/doc";
import { ContentFooter } from "@/components/api/page-footer";
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
const { total: OPERATION_COUNT, modules: MODULE_COUNT } = toolCounts();

export default function ApiOverviewPage() {
  return (
    <DocPage>
      <DocEyebrow>Carbon API</DocEyebrow>
      <DocTitle>The Carbon API</DocTitle>
      <Lead>
        The Carbon API is the service layer — the same code the app runs when
        you click a button. It validates every input, recalculates derived
        state, and enforces your permissions. It's the surface to build on.
      </Lead>
      <P>
        Carbon exposes its data two ways. This is the primary one. The{" "}
        <DocLink href="/api/data">Data API</DocLink> is the escape hatch —
        direct access to the underlying tables and views, for the rare case
        this surface doesn't cover.
      </P>

      <H2 id="why">Why not the tables directly</H2>
      <P>
        The <DocLink href="/api/data">Data API</DocLink> gives you every
        table and view as a REST endpoint — and none of the service layer's
        protections. A write straight to a table skips validation and
        recalculation, so the values that depend on it — an order total, a job
        status, a ledger entry — silently drift out of sync. It exists for the
        case the Carbon API doesn't cover, when you know exactly what the
        table touches.
      </P>
      <P>
        The Carbon API runs that logic for you. Every write goes through the
        same validation, recalculation, and posting the app itself uses, so the
        data stays consistent.
      </P>

      <H2 id="operations">Operations</H2>
      <P>
        The catalog is {OPERATION_COUNT.toLocaleString()} operations across{" "}
        {MODULE_COUNT} modules — create a job, draft a quote, adjust inventory,
        post an invoice. Each carries a READ / WRITE / DESTRUCTIVE
        classification, so a client can filter or gate by risk.
      </P>
      <P>
        Browse the full catalog under{" "}
        <DocLink href="/api/operations">Operations</DocLink>.
      </P>

      <H2 id="connect">Connect</H2>
      <P>
        Carbon runs an MCP server, so any MCP client — Claude Code, Cursor,
        ChatGPT — can reach every operation and read or write in plain language.
        See <DocLink href="/api/mcp">Connect over MCP</DocLink> for the setup,
        and <DocLink href="/api/authentication">Authentication</DocLink> for how
        a client proves who it is and what it's allowed to touch.
      </P>

      <ContentFooter next={{ label: "Connect over MCP", url: "/api/mcp" }} />
    </DocPage>
  );
}
