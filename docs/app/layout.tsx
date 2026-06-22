import "./global.css";
import "./editorial.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import { DM_Sans, Fira_Code } from "next/font/google";
import type { ReactNode } from "react";
import { ScrollToTop } from "@/components/scroll-to-top";
import { SiteFooter } from "@/components/site-footer";
import { ogImage, SEO, SITE } from "@/lib/seo";

// next/font self-hosts DM Sans + Fira Code at build time: no render-blocking request
// to fonts.googleapis.com, automatic `font-display: swap`, and a size-adjusted fallback
// face so swapping in the web font causes ~no layout shift (CLS). Exposed as CSS vars
// the design tokens (--font-sans/--font-mono in global.css) point at.
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  variable: "--font-dm-sans"
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fira-code"
});

const defaultOg = ogImage({ title: SEO.site.title, eyebrow: "Documentation" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  // Child routes set their own full <title>; this is the fallback for the home route.
  title: SEO.site.title,
  description: SEO.site.description,
  applicationName: "Carbon",
  keywords: [
    "Carbon",
    "manufacturing system",
    "ERP",
    "MES",
    "MRP",
    "manufacturing software",
    "REST API",
    "MCP"
  ],
  authors: [{ name: "Carbon" }],
  // Favicon comes from the app/icon.svg file convention.
  openGraph: {
    title: SEO.site.title,
    description: SEO.site.description,
    siteName: "Carbon",
    url: SITE.url,
    type: "website",
    locale: "en_US",
    images: [defaultOg]
  },
  twitter: {
    card: "summary_large_image",
    title: SEO.site.title,
    description: SEO.site.description,
    images: [defaultOg.url]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5F5F2"
};

// Prerender likely-next pages on hover (~200ms) so in-site navigation feels instant.
// Scoped to same-origin doc paths; excludes the /api search endpoint. Chromium-only,
// ignored elsewhere (progressive enhancement). The app fires no on-load analytics, so
// prerendering has no early side effects to guard against.
// Organization + WebSite structured data, so search engines and AI crawlers resolve
// the brand, logo, and site identity consistently across every page.
const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE.url}/#organization`,
      name: "Carbon",
      url: SITE.url,
      logo: `${SITE.url}/carbon-mark-light.svg`
    },
    {
      "@type": "WebSite",
      "@id": `${SITE.url}/#website`,
      url: SITE.url,
      name: SEO.site.title,
      description: SEO.site.description,
      publisher: { "@id": `${SITE.url}/#organization` },
      inLanguage: "en-US"
    }
  ]
});

const speculationRules = JSON.stringify({
  prerender: [
    {
      where: {
        and: [{ href_matches: "/*" }, { not: { href_matches: "/api/*" } }]
      },
      eagerness: "moderate"
    }
  ]
});

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${firaCode.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href="/carbon-mark-light.svg"
          media="(prefers-color-scheme: light)"
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href="/carbon-mark-dark.svg"
          media="(prefers-color-scheme: dark)"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon-16x16.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon.png"
        />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <script
          type="speculationrules"
          dangerouslySetInnerHTML={{ __html: speculationRules }}
        />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <ScrollToTop />
        {/* Light-only — the editorial design is a warm paper theme, no dark mode */}
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
