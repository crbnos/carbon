// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import "./zod.client";
import { CONTROLLED_ENVIRONMENT, error, getBrowserEnv } from "@carbon/auth";
import { flashClientMiddleware } from "@carbon/auth/middleware/flash.client";
import {
  flashHeadersContext,
  flashMiddleware,
  flashResultContext
} from "@carbon/auth/middleware/flash.server";
import { formBodyMiddleware } from "@carbon/auth/middleware/form-body.server";
import { securityMiddleware } from "@carbon/auth/middleware/security.server";
import { validator } from "@carbon/form";
import { LocaleProvider, resolveLanguage } from "@carbon/locale";
import { requestIdMiddleware } from "@carbon/logger/middleware.server";
import { createInvalidationMiddleware } from "@carbon/query/cache";
import { Button, Heading, Toaster, useMode } from "@carbon/react";
import type { Theme } from "@carbon/utils";
import {
  colorSchemeHintScript,
  getPreferenceHeaders,
  modeValidator,
  prefetchCacheMiddleware,
  themes
} from "@carbon/utils";
import { faviconLinks } from "@carbon/utils/favicon";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import type React from "react";
import { useContext, useState } from "react";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  UNSAFE_FrameworkContext,
  useLoaderData
} from "react-router";
import { preloadCatalog, useCatalog } from "~/services/lingui";
import { getMode, setMode } from "~/services/mode.server";
import Background from "~/styles/background.css?url";
import NProgress from "~/styles/nprogress.css?url";
import Tailwind from "~/styles/tailwind.css?url";
import { getTheme } from "./services/theme.server";

export const middleware = [
  requestIdMiddleware,
  securityMiddleware,
  formBodyMiddleware,
  flashMiddleware,
  prefetchCacheMiddleware
];
export const clientMiddleware = [
  flashClientMiddleware,
  // After every action, cached API reads (the account settings panes) refetch.
  createInvalidationMiddleware({ getCache: () => window.clientCache })
];

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: Tailwind },
  { rel: "stylesheet", href: Background },
  { rel: "stylesheet", href: NProgress },
  ...faviconLinks
];

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon | Starter"
    }
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const {
    CARBON_EDITION,
    LOG_LEVEL,
    NODE_ENV,
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  } = getBrowserEnv();

  // The starter shares the ERP's catalog: the account settings modal and the
  // @carbon/react components it renders are extracted into it.
  const appLanguage = resolveLanguage(getPreferenceHeaders(request).locale);
  await preloadCatalog(appLanguage);

  return data(
    {
      env: {
        CARBON_EDITION,
        LOG_LEVEL,
        NODE_ENV,
        POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY,
        SUPABASE_URL,
        SUPABASE_ANON_KEY
      },
      appLanguage,
      ...getMode(request),
      theme: getTheme(request),
      result: context.get(flashResultContext)
    },
    {
      headers: context.get(flashHeadersContext) ?? undefined
    }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes("multipart/form-data") &&
    !contentType.includes("application/x-www-form-urlencoded")
  ) {
    return data({ error: "Invalid content type" }, { status: 400 });
  }

  const validation = await validator(modeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(error(validation.error, "Invalid mode"), {
      status: 400
    });
  }

  return data(
    {},
    {
      headers: { "Set-Cookie": setMode(validation.data.mode) }
    }
  );
}

function Document({
  children,
  title = "Carbon",
  mode = "light",
  theme = "zinc",
  lang = "en"
}: {
  children: React.ReactNode;
  title?: string;
  mode?: "light" | "dark";
  theme?: string;
  lang?: string;
}) {
  const nonce = useContext(UNSAFE_FrameworkContext)?.nonce;
  const selectedTheme = themes.find((t) => t.name === theme) as
    | Theme
    | undefined;

  // Create style objects for both light and dark modes
  const lightVars: Record<string, string> = {};
  const darkVars: Record<string, string> = {};

  if (selectedTheme) {
    // Set light mode variables
    Object.entries(selectedTheme.cssVars.light).forEach(([key, value]) => {
      const cssKey = `--${key}`;
      lightVars[cssKey] = `${value}`;
    });

    // Set dark mode variables
    Object.entries(selectedTheme.cssVars.dark).forEach(([key, value]) => {
      const cssKey = `--${key}`;
      darkVars[cssKey] = `${value}`;
    });
  }

  // Combine the styles with proper selectors
  const themeStyle = {
    ...(mode === "dark" ? darkVars : lightVars),
    "--radius": "0.675rem"
  } as React.CSSProperties;

  return (
    <html
      lang={lang}
      className={`${mode} h-full overflow-x-hidden`}
      style={themeStyle}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Before any paint: records the OS color scheme for a `system` user
            and reloads once if the server rendered the wrong mode. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: colorSchemeHintScript }}
        />
        <Meta />
        <title>{title}</title>
        <Links />
      </head>
      <body className="h-full bg-background antialiased selection:bg-primary/10 selection:text-primary">
        {children}
        <Toaster position="bottom-right" visibleToasts={5} />
        <ScrollRestoration />
        <Scripts />
        {!CONTROLLED_ENVIRONMENT && import.meta.env.PROD && <Analytics />}
      </body>
    </html>
  );
}

export default function App() {
  const nonce = useContext(UNSAFE_FrameworkContext)?.nonce;
  const loaderData = useLoaderData<typeof loader>();
  const env = loaderData?.env ?? {};
  const theme = loaderData?.theme ?? "zinc";
  const appLanguage = loaderData?.appLanguage ?? "en";
  const catalog = useCatalog(appLanguage);

  /* Dark/Light Mode */
  const mode = useMode();

  // One client for useQuery and for the invalidation middleware, which
  // reaches it as window.clientCache.
  const [queryClient] = useState(() => {
    if (typeof window !== "undefined" && window.clientCache) {
      return window.clientCache;
    }
    const client = new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: false } }
    });
    if (typeof window !== "undefined") {
      window.clientCache = client;
    }
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider locale={appLanguage} catalog={catalog}>
        <Document mode={mode} theme={theme} lang={appLanguage}>
          <Outlet />
          <script
            // Server render only: on the client the nonce is undefined (and browsers hide it).
            nonce={nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{
              __html: `window.env = ${JSON.stringify(env)}`
            }}
          />
        </Document>
      </LocaleProvider>
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  const message = isRouteErrorResponse(error)
    ? (error.data.message ?? error.data)
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <Document title="Error!">
      <div className="light">
        <div className="flex flex-col w-full h-screen  items-center justify-center space-y-4 ">
          <img
            src="/carbon-mark-light.svg"
            alt="Carbon Logo"
            className="block max-w-[60px] dark:hidden"
          />
          <img
            src="/carbon-mark-dark.svg"
            alt="Carbon Logo"
            className="max-w-[60px] hidden dark:block"
          />
          <Heading size="h1">Something went wrong</Heading>
          <p className="text-muted-foreground max-w-2xl">{message}</p>
          <Button onClick={() => (window.location.href = "/")}>
            Back Home
          </Button>
        </div>
      </div>
    </Document>
  );
}
