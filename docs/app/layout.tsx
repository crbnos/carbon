import "./global.css";
import "./editorial.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { ScrollToTop } from "@/components/scroll-to-top";
import { SiteFooter } from "@/components/site-footer";
import { faviconLinks } from "@carbon/utils/favicon";
import { ogImage, SEO, SITE } from "@/lib/seo";

// next/font self-hosts Archivo + JetBrains Mono at build time: no render-blocking request
// to fonts.googleapis.com, automatic `font-display: swap`, and a size-adjusted fallback
// face so swapping in the web font causes ~no layout shift (CLS). Exposed as CSS vars
// the design tokens (--font-sans/--font-display/--font-mono in global.css) point at.
// Archivo covers body/UI text and (in bold weights) headings/display type.
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  variable: "--font-archivo"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono"
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
  // Favicons are declared as theme-aware <link> tags in the <head> below.
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
  themeColor: "#F5F5F5"
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
      className={`${archivo.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
        {faviconLinks.map((link) => (
          <link key={`${link.rel}-${link.href}`} {...link} />
        ))}
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
