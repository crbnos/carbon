import { cn } from "@carbon/react";
import { useEffect, useState } from "react";
import { LuArrowDown, LuPlug, LuTerminal } from "react-icons/lu";
import { CopyButton } from "./CopyButton";
import { CLIENTS, type Client, ENDPOINT } from "./mcp-content";
import { SELECT_CLIENT_EVENT } from "./quickstart-nav";
import { Screenshot } from "./Screenshot";

const FLOW_META = {
  connector: { Icon: LuPlug, label: "OAuth · no key" },
  command: { Icon: LuTerminal, label: "API key" }
} as const;

interface PipeStep {
  num: string;
  crumb: string;
  title: string;
  caption: string;
  alt: string;
  code?: string;
  img: string;
}

// Builds the three-step walkthrough for the selected client. Steps 1 and 3 are
// shared within a flow; step 2 carries the client-specific command/config.
function stepsFor(c: Client): PipeStep[] {
  const verify: PipeStep = {
    num: "03",
    crumb: c.name,
    title: "Verify",
    caption:
      "Ask it to search Carbon. If it lists tools, you’re connected to your ERP.",
    alt: `${c.name} — “Search Carbon for sales-order tools” returning a list of tools`,
    img: `/mcp/verify-${c.slug}.png`
  };

  if (c.flow === "connector") {
    return [
      {
        num: "01",
        crumb: c.where,
        title: "Add a custom connector",
        caption: `Open ${c.where}, choose Add custom connector, then paste the endpoint.`,
        code: ENDPOINT,
        alt: `${c.name} — the “Add custom connector” dialog with the Carbon MCP URL`,
        img: `/mcp/add-${c.slug}.png`
      },
      {
        num: "02",
        crumb: "app.carbon.ms/oauth/authorize",
        title: "Authorize",
        caption:
          "Sign in, choose your company, and click Authorize. The connection inherits your Carbon permissions — no key to paste.",
        alt: "Carbon — the “Authorize Application” screen: choose your company, then Authorize",
        img: "/mcp/authorize-connector.png"
      },
      verify
    ];
  }

  return [
    {
      num: "01",
      crumb: "Carbon · Settings → API Keys",
      title: "Create an API key",
      caption:
        "Settings → API Keys → New. The modal hands you a ready-to-paste snippet — you only see the key once.",
      alt: "Carbon — Settings → API Keys → the new-key modal with the snippet",
      img: "/mcp/api-key.png"
    },
    {
      num: "02",
      crumb: c.target,
      title: c.action,
      caption: "Paste it in, swapping in the key the modal gave you:",
      code: c.code,
      alt: `${c.name} — the Carbon MCP server configured with your key`,
      img: `/mcp/add-${c.slug}.png`
    },
    verify
  ];
}

export function SetupPipeline() {
  const [name, setName] = useState("Claude Code");
  const client = CLIENTS.find((c) => c.name === name) ?? CLIENTS[0];
  const steps = stepsFor(client);

  // The hero "Connect to Claude" CTA preselects a client via this event.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const wanted = (e as CustomEvent<string>).detail;
      if (CLIENTS.some((c) => c.name === wanted)) setName(wanted);
    };
    window.addEventListener(SELECT_CLIENT_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_CLIENT_EVENT, onSelect);
  }, []);

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px] mb-[24px]">
        {CLIENTS.map((c) => {
          const { Icon, label } = FLOW_META[c.flow];
          const isActive = c.name === client.name;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => setName(c.name)}
              aria-pressed={isActive}
              className={cn(
                "flex flex-col items-start gap-[6px] text-left p-[13px] rounded-xl border cursor-pointer transition-[border-color,background,transform] duration-150 active:scale-[0.97]",
                isActive
                  ? "border-[var(--acc)] bg-[var(--acc-tint)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                  : "border-border bg-card hover:border-muted-foreground"
              )}
            >
              <Icon
                size={17}
                className={cn(
                  isActive ? "text-[var(--acc)]" : "text-muted-foreground"
                )}
              />
              <span className="font-semibold text-[0.85rem] text-foreground">
                {c.name}
              </span>
              <span className="font-[var(--mono)] text-[0.6rem] tracking-[0.04em] uppercase text-muted-foreground">
                {label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="stagger" key={client.flow}>
        {steps.map((s, i) => (
          <div key={s.num}>
            <div className="bg-card border border-border rounded-xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_26px_-20px_rgba(0,0,0,0.18)]">
              <div className="flex items-center gap-[10px] mb-[10px]">
                <span className="font-[var(--mono)] text-[0.72rem] text-[var(--acc)] font-medium">
                  {s.num}
                </span>
                <span className="font-[var(--mono)] text-[0.64rem] tracking-[0.04em] text-muted-foreground bg-muted border border-border rounded-md px-[7px] py-[2px]">
                  {s.crumb}
                </span>
              </div>
              <div className="font-semibold text-[0.98rem] tracking-[-0.01em] mb-[3px]">
                {s.title}
              </div>
              <p className="text-muted-foreground text-[0.85rem] mb-[13px] max-w-[60ch] [text-wrap:pretty]">
                {s.caption}
              </p>
              {s.code && (
                <div className="relative mb-[13px]">
                  <CopyButton
                    text={s.code}
                    className="absolute top-[8px] right-[8px] w-[28px] h-[28px] inline-flex items-center justify-center bg-zinc-800 text-zinc-500 hover:text-zinc-100 rounded-md cursor-pointer transition-[transform,color] active:scale-[0.96] [&.done]:bg-[var(--acc)] [&.done]:text-white"
                  />
                  <pre className="m-0 overflow-auto rounded-[9px] bg-zinc-900 border border-zinc-800 text-zinc-200 font-[var(--mono)] text-[0.76rem] leading-[1.6] px-[13px] py-[11px] pr-[42px] whitespace-pre">
                    {s.code}
                  </pre>
                </div>
              )}
              <Screenshot src={s.img} alt={s.alt} />
            </div>
            {i < steps.length - 1 && (
              <div
                className="flex flex-col items-center py-[7px]"
                aria-hidden="true"
              >
                <span className="w-px h-[12px] bg-border" />
                <LuArrowDown size={16} className="text-[var(--acc)]" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
