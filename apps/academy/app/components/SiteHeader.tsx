import type { ReactNode } from "react";
import { LuFingerprint } from "react-icons/lu";
import { Link } from "react-router";
import { useOptionalUser } from "~/hooks/useUser";
import { path } from "~/utils/path";
import AvatarMenu from "./AvatarMenu";
import { MobileNav } from "./MobileNav";
import { SearchCommand } from "./SearchCommand";

const NAV = [
  { key: "courses", label: "Lessons", href: path.to.root, external: false },
  { key: "docs", label: "Docs", href: path.to.docs, external: true },
  { key: "glossary", label: "Glossary", href: path.to.glossary, external: true }
] as const;

const navLinkClass = (isActive: boolean) =>
  `nav-link rounded-[7px] px-2.5 py-1.5 text-ed-15 leading-normal tracking-[0.15px] no-underline transition-colors ${
    isActive
      ? "text-ink-ui font-demi"
      : "text-ink-faint font-book hover:text-ink-ui hover:bg-ed-hairline/55"
  }`;

/** Site-wide header — warm-paper, fixed, docs-style. Carbon wordmark · Courses,
 *  with the login CTA / avatar on the right. `mobileNav` is the course tree,
 *  surfaced in the hamburger drawer below `lg`. */
export function SiteHeader({ mobileNav }: { mobileNav?: ReactNode }) {
  const user = useOptionalUser();
  const active = "courses" as const;

  return (
    <header
      className="fixed inset-x-0 top-0 z-[60] h-16"
      style={{
        background: "#F5F5F2",
        borderBottom: "1px solid #E8E7E6",
        boxShadow: "0 1px 0 0 #fff"
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-370 items-center justify-between px-6 md:px-8">
        <div className="flex items-center gap-[26px]">
          <Link
            to={path.to.root}
            className="flex shrink-0 items-center no-underline"
            aria-label="Carbon Academy home"
          >
            <img
              src="/carbon-word-light.svg"
              alt="Carbon"
              width={99}
              height={24}
              className="block"
            />
          </Link>
          <nav className="hidden items-center gap-0.5 lg:flex">
            {NAV.map((item) =>
              item.external ? (
                <a
                  key={item.key}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={navLinkClass(false)}
                >
                  {item.label}
                </a>
              ) : (
                <Link
                  key={item.key}
                  to={item.href}
                  aria-current={active === item.key ? "page" : undefined}
                  className={navLinkClass(active === item.key)}
                >
                  {item.label}
                </Link>
              )
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <SearchCommand />
          {user ? (
            <AvatarMenu />
          ) : (
            <Link
              to={path.to.login}
              className="group relative hidden h-10 items-center justify-center rounded-lg px-4 no-underline sm:inline-flex"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-lg btn-dark-hover opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100"
              />
              <span className="text-on-dark relative z-10 inline-flex items-center gap-1.5 text-ed-14 font-book tracking-[0.15px]">
                <LuFingerprint className="size-3.5" />
                Login
              </span>
            </Link>
          )}
          <MobileNav active={active}>{mobileNav}</MobileNav>
        </div>
      </div>
    </header>
  );
}
