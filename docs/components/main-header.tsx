import Link from "next/link";
import type { ReactNode } from "react";
import { MobileNav } from "./mobile-nav";
import { SearchCommand } from "./search/search-command";
import { SiteLogo } from "./site-logo";

const NAV = [
  { key: "guides", label: "Guides", href: "/guides/order" },
  { key: "reference", label: "Reference", href: "/docs" },
  { key: "api", label: "API", href: "/api-reference" },
  { key: "mcp", label: "MCP", href: "/mcp" },
] as const;

type Active = (typeof NAV)[number]["key"];

/** The single site-wide header: Carbon · Guide · Reference · API · Open Carbon.
 *  `mobileNav` is the current surface's section tree, surfaced in the hamburger
 *  drawer below `lg` where the desktop sidebar is hidden. */
export function MainHeader({ active, mobileNav }: { active?: Active; mobileNav?: ReactNode }) {
  return (
    <header
      className="fixed inset-x-0 top-0 z-[60] h-16"
      style={{ background: "#F5F5F2", borderBottom: "1px solid #E8E7E6", boxShadow: "0 1px 0 0 #fff" }}
    >
      {/* Inner row capped to the content width so the logo/CTA don't drift to the
          screen edges on large displays — aligns with the docs/api/mcp containers. */}
      <div className="mx-auto flex h-full w-full max-w-370 items-center justify-between px-6 md:px-8">
        <div className="flex items-center gap-[26px]">
        <SiteLogo />
        <nav className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              className={`nav-link rounded-[7px] px-2.5 py-1.5 text-ed-15 leading-normal tracking-[0.15px] no-underline transition-colors ${
                active === item.key
                  ? "text-ink-ui font-demi"
                  : "text-ink-faint font-book hover:text-ink-ui hover:bg-ed-hairline/55"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2.5">
        <SearchCommand />
        <a
          className="group relative hidden h-10 items-center justify-center rounded-lg px-4 no-underline sm:inline-flex"
          href="https://app.carbon.ms"
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
          />
          <span className="text-on-dark relative z-10 text-ed-14 font-book tracking-[0.15px]">Open Carbon</span>
        </a>
        <MobileNav active={active}>{mobileNav}</MobileNav>
        </div>
      </div>
    </header>
  );
}
