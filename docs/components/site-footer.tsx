import { siGithub, siX } from "simple-icons";

// LinkedIn was removed from simple-icons v16, so its 24×24 glyph is inlined here.
const LINKEDIN_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

const SOCIAL = [
  { label: "X", href: "https://x.com/carbon_ms", path: siX.path },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/carbon-manufacturing-systems",
    path: LINKEDIN_PATH,
  },
  { label: "GitHub", href: "https://github.com/crbnos", path: siGithub.path },
];

const COLUMNS = [
  {
    heading: "Company",
    links: [
      { label: "Brand Assets", href: "https://carbon.ms/brand" },
      { label: "Blog", href: "https://carbon.ms/learn" },
      { label: "Contact", href: "https://carbon.ms/contact" },
      { label: "OSS Friends", href: "https://carbon.ms/oss" },
      { label: "Sales", href: "https://carbon.ms/sales" },
    ],
  },
  {
    heading: "Product",
    links: [
      { label: "Learning", href: "https://learn.carbon.ms" },
      { label: "License", href: "https://github.com/crbnos/carbon/blob/main/LICENSE" },
      { label: "Pricing", href: "https://carbon.ms/pricing" },
      { label: "Source Code", href: "https://github.com/crbnos/carbon" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "https://carbon.ms/privacy" },
      { label: "Terms", href: "https://carbon.ms/terms" },
    ],
  },
];

function SocialIcon({ label, href, path }: { label: string; href: string; path: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className="text-white/55 transition-colors hover:text-white"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    </a>
  );
}

/** Site-wide footer, mirroring carbon.ms: brand · social · status, link columns, ITAR, copyright. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="w-full border-t border-white/10 bg-ed-dark-bg text-white">
      <div className="mx-auto w-full max-w-320 px-6 py-12 md:px-8">
        <div className="flex flex-col justify-between gap-10 lg:flex-row">
          {/* Brand block */}
          <div className="flex flex-col gap-[18px]">
            <img src="/carbon-word-dark.svg" alt="Carbon" width={116} height={28} className="block" />
            <div className="flex items-center gap-4">
              {SOCIAL.map((s) => (
                <SocialIcon key={s.label} {...s} />
              ))}
            </div>
            <div className="mt-0.5">
              <p className="m-0 text-ed-13 text-white/60">System Status:</p>
              <a
                href="https://status.carbon.ms"
                target="_blank"
                rel="noreferrer noopener"
                className="mt-[3px] inline-flex items-center gap-[7px] text-ed-14 text-white/85 transition-colors hover:text-white"
              >
                Operational
                <span className="inline-block h-[7px] w-[7px] rounded-full bg-[#3FB950] shadow-[0_0_6px_rgba(63,185,80,0.7)]" />
              </a>
            </div>
          </div>

          {/* Link columns */}
          <div className="flex flex-1 flex-wrap gap-x-14 gap-y-8 lg:justify-center">
            {COLUMNS.map((col) => (
              <nav key={col.heading} className="flex min-w-30 flex-col gap-3">
                <p className="m-0 text-ed-13 font-medium text-white/60">{col.heading}</p>
                {col.links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-ed-14 text-white/70 no-underline transition-colors hover:text-white"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            ))}
          </div>

          {/* ITAR badge — the shared lockup is dark-inked (made for light backgrounds), so its text
              would vanish on the dark footer. Sit it on a light chip to keep it legible. */}
          <div className="flex items-center">
            <span className="inline-flex items-center rounded-[10px] bg-white px-4 py-[11px]">
              <img
                src="https://carbon.ms/logos/itar.svg"
                alt="ITAR Registered & Compliant"
                className="block h-9 w-auto"
              />
            </span>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-10 border-t border-white/10 pt-5">
          <p className="m-0 text-ed-13 text-white/60">
            © {year} Carbon Manufacturing Systems Corp. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
