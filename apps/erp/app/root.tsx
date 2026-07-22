import { CONTROLLED_ENVIRONMENT, error, getBrowserEnv } from "@carbon/auth";
import { flashClientMiddleware } from "@carbon/auth/middleware/flash.client";
import {
  flashHeadersContext,
  flashMiddleware,
  flashResultContext
} from "@carbon/auth/middleware/flash.server";
import { validator } from "@carbon/form";
import { LocaleProvider, resolveLanguage } from "@carbon/locale";
import { requestIdMiddleware } from "@carbon/logger/middleware.server";
import {
  OperatingSystemContextProvider,
  Toaster,
  TooltipProvider,
  useMode
} from "@carbon/react";
import { RootErrorBoundary } from "@carbon/react/ErrorBoundary";
import type { Theme } from "@carbon/utils";
import { getPreferenceHeaders, modeValidator, themes } from "@carbon/utils";
import { faviconLinks } from "@carbon/utils/favicon";
import { I18nProvider } from "@react-aria/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import type React from "react";
import { useState } from "react";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import {
  data,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData
} from "react-router";
import SonnerStyle from "sonner/dist/styles.css?url";
import { loadLinguiCatalogForRequest } from "~/services/lingui.server";
import { getMode, setMode } from "~/services/mode.server";
import Background from "~/styles/background.css?url";
import NProgress from "~/styles/nprogress.css?url";
import Tailwind from "~/styles/tailwind.css?url";
import type { Route } from "./+types/root";
import "./polyfill";
import { getTheme } from "./services/theme.server";

export const middleware = [requestIdMiddleware, flashMiddleware];
export const clientMiddleware = [flashClientMiddleware];

export const links: LinksFunction = () => {
  return [
    { href: Tailwind, rel: "stylesheet" },
    { href: Background, rel: "stylesheet" },
    { href: NProgress, rel: "stylesheet" },
    { href: SonnerStyle, rel: "stylesheet" },
    ...faviconLinks
  ];
};

export const meta: MetaFunction = ({ error }) => {
  return [
    {
      title: error ? "Carbon | Error" : "Carbon"
    }
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const {
    AUTH_PROVIDERS,
    CARBON_EDITION,
    CARBON_API_URL,
    CLOUDFLARE_TURNSTILE_SITE_KEY,
    CONTROLLED_ENVIRONMENT,
    ERP_URL,
    GOOGLE_PLACES_API_KEY,
    JIRA_CLIENT_ID,
    LOG_LEVEL,
    MES_URL,
    NODE_ENV,
    ONSHAPE_CLIENT_ID,
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    QUICKBOOKS_CLIENT_ID,
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
    DEFAULT_LANGUAGE,
    VERCEL_ENV,
    VERCEL_URL,
    XERO_CLIENT_ID
  } = getBrowserEnv();

  const preferences = getPreferenceHeaders(request);
  const appLanguage = resolveLanguage(preferences.locale);
  const linguiCatalog = await loadLinguiCatalogForRequest(request, appLanguage);

  return data(
    {
      env: {
        AUTH_PROVIDERS,
        CARBON_API_URL,
        CARBON_EDITION,
        CLOUDFLARE_TURNSTILE_SITE_KEY,
        CONTROLLED_ENVIRONMENT,
        DEFAULT_LANGUAGE,
        ERP_URL,
        GOOGLE_PLACES_API_KEY,
        JIRA_CLIENT_ID,
        LOG_LEVEL,
        MES_URL,
        NODE_ENV,
        ONSHAPE_CLIENT_ID,
        POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY,
        QUICKBOOKS_CLIENT_ID,
        SUPABASE_ANON_KEY,
        SUPABASE_URL,
        VERCEL_ENV,
        VERCEL_URL,
        XERO_CLIENT_ID
      },
      linguiCatalog,
      mode: getMode(request),
      preferences: getPreferenceHeaders(request),
      result: context.get(flashResultContext),
      theme: getTheme(request)
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

export function Document({
  children,
  lang = "en",
  mode = "light",
  theme = "zinc",
  env
}: {
  children: React.ReactNode;
  lang?: string;
  mode?: "light" | "dark";
  theme?: string;
  env?: Record<string, unknown>;
}) {
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
    ...(mode === "light" ? lightVars : darkVars),
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
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
        />
        <Meta />
        <Links />
      </head>
      <body className="h-full bg-background antialiased selection:bg-primary/10 selection:text-primary">
        {children}
        {/* Injected before <Scripts /> so `window.env` is populated before the
            client entry module loads. Rendered here (not in <App />) so error
            pages get it too — the client Supabase client reads SUPABASE_URL from
            window.env at module load and otherwise crashes hydration. */}
        {env ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.env = ${JSON.stringify(env)};`
            }}
          />
        ) : null}
        <Toaster position="bottom-right" visibleToasts={5} />
        <ScrollRestoration />
        <Scripts />
        {!CONTROLLED_ENVIRONMENT && import.meta.env.PROD && <Analytics />}
      </body>
    </html>
  );
}

export default function App() {
  const loaderData = useLoaderData<typeof loader>();
  const env = loaderData?.env ?? {};
  const theme = loaderData?.theme ?? "zinc";
  const prefs = loaderData?.preferences;
  const linguiCatalog = loaderData?.linguiCatalog;
  const appLanguage = resolveLanguage(prefs.locale);
  const mode = useMode();

  // One client for both consumers: the imperative `window.clientCache`
  // read-through convention (clientLoader/cachedApiQuery) and hook-based
  // useQuery (e.g. the viewer's useOptimizedModel) via the provider below.
  // Created in a state initializer (not useMount) so the provider has it on
  // first render; per-query options override the infinite defaults.
  const [queryClient] = useState(() => {
    if (typeof window !== "undefined" && window.clientCache) {
      return window.clientCache;
    }
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          refetchOnWindowFocus: false,
          staleTime: Infinity
        }
      }
    });
    if (typeof window !== "undefined") {
      window.clientCache = client;
    }
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <OperatingSystemContextProvider platform={prefs.platform}>
        <LocaleProvider locale={appLanguage} catalog={linguiCatalog}>
          <I18nProvider locale={prefs.locale}>
            <TooltipProvider delayDuration={200}>
              <Document mode={mode} theme={theme} lang={appLanguage} env={env}>
                <Outlet />
              </Document>
            </TooltipProvider>
          </I18nProvider>
        </LocaleProvider>
      </OperatingSystemContextProvider>
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // The ErrorBoundary renders in place of <App />, so it needs its own
  // <Document> shell (html/head/scripts + theme vars). The VOID//SYS screen is
  // dark by design, so force dark mode regardless of the user's preference.
  // Inject `window.env` so the client can hydrate: the Supabase client reads
  // SUPABASE_URL from window.env at module load and otherwise throws
  // "supabaseUrl is required", aborting hydration (leaving this screen static).
  // Use getBrowserEnv() rather than root loader data — the latter is undefined
  // in a no-match (404) boundary.
  return (
    <Document mode="dark" env={getBrowserEnv()}>
      <RootErrorBoundary error={error} />
    </Document>
  );
}
