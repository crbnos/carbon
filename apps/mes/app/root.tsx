import { CONTROLLED_ENVIRONMENT, error, getBrowserEnv } from "@carbon/auth";
import { flashClientMiddleware } from "@carbon/auth/middleware/flash.client";
import {
  flashHeadersContext,
  flashMiddleware,
  flashResultContext
} from "@carbon/auth/middleware/flash.server";
import { validator } from "@carbon/form";
import { LocaleProvider, resolveLanguage } from "@carbon/locale";
import {
  Button,
  Heading,
  OperatingSystemContextProvider,
  Toaster,
  TooltipProvider,
  useMode
} from "@carbon/react";
import type { Theme } from "@carbon/utils";
import { getPreferenceHeaders, modeValidator, themes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { I18nProvider } from "@react-aria/i18n";
import { Analytics } from "@vercel/analytics/react";
import type React from "react";
import type {
  ActionFunctionArgs,
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
  useLoaderData,
  useRouteLoaderData
} from "react-router";
import { loadLinguiCatalogForRequest } from "~/services/lingui.server";
import { getMode, setMode } from "~/services/mode.server";
import Background from "~/styles/background.css?url";
import NProgress from "~/styles/nprogress.css?url";
import Tailwind from "~/styles/tailwind.css?url";
import type { Route } from "./+types/root";
import { getTheme } from "./services/theme.server";

export const middleware = [flashMiddleware];
export const clientMiddleware = [flashClientMiddleware];

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: Tailwind },
  { rel: "stylesheet", href: Background },
  { rel: "stylesheet", href: NProgress },
  {
    rel: "icon",
    type: "image/svg+xml",
    href: "/carbon-mark-light.svg",
    media: "(prefers-color-scheme: light)"
  },
  {
    rel: "icon",
    type: "image/svg+xml",
    href: "/carbon-mark-dark.svg",
    media: "(prefers-color-scheme: dark)"
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "32x32",
    href: "/favicon-32x32.png"
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "16x16",
    href: "/favicon-16x16.png"
  },
  {
    rel: "apple-touch-icon",
    sizes: "180x180",
    href: "/apple-touch-icon.png"
  },
  { rel: "manifest", href: "/site.webmanifest" }
];

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon | MES"
    }
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const {
    AUTH_PROVIDERS,
    CARBON_EDITION,
    CARBON_API_URL,
    CONTROLLED_ENVIRONMENT,
    ERP_URL,
    MES_URL,
    NODE_ENV,
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    VERCEL_ENV,
    VERCEL_URL
  } = getBrowserEnv();

  const preferences = getPreferenceHeaders(request);
  const appLanguage = resolveLanguage(preferences.locale);
  const linguiCatalog = await loadLinguiCatalogForRequest(request, appLanguage);

  return data(
    {
      env: {
        AUTH_PROVIDERS,
        CARBON_EDITION,
        CARBON_API_URL,
        CONTROLLED_ENVIRONMENT,
        ERP_URL,
        MES_URL,
        NODE_ENV,
        POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        VERCEL_ENV,
        VERCEL_URL
      },
      mode: getMode(request),
      theme: getTheme(request),
      preferences,
      linguiCatalog,
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
  lang = "en",
  mode = "light",
  theme = "zinc"
}: {
  children: React.ReactNode;
  title?: string;
  lang?: string;
  mode?: "light" | "dark";
  theme?: string;
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
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
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
        {!CONTROLLED_ENVIRONMENT && <Analytics />}
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

  /* Dark/Light Mode */
  const mode = useMode();

  return (
    <OperatingSystemContextProvider platform={prefs.platform}>
      <LocaleProvider locale={appLanguage} catalog={linguiCatalog}>
        <I18nProvider locale={prefs.locale}>
          <TooltipProvider delayDuration={200}>
            <Document mode={mode} theme={theme} lang={appLanguage}>
              <Outlet />
              <script
                dangerouslySetInnerHTML={{
                  __html: `window.env = ${JSON.stringify(env)};`
                }}
              />
            </Document>
          </TooltipProvider>
        </I18nProvider>
      </LocaleProvider>
    </OperatingSystemContextProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // The ErrorBoundary renders in place of <App />, so it is outside the
  // LocaleProvider mounted there. Re-establish it from the root loader data
  // (falling back to defaults if the loader itself threw) so the boundary can
  // use the same lingui catalog as the rest of the app.
  const rootLoaderData = useRouteLoaderData<typeof loader>("root");

  return (
    <LocaleProvider
      locale={rootLoaderData?.preferences?.locale}
      catalog={rootLoaderData?.linguiCatalog}
    >
      <ErrorBoundaryContent error={error} />
    </LocaleProvider>
  );
}

function ErrorBoundaryContent({ error }: { error: unknown }) {
  const { t } = useLingui();
  const message = isRouteErrorResponse(error)
    ? (error.data.message ?? error.data)
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <Document title={t`Error!`}>
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
          <Heading size="h1">
            <Trans>Something went wrong</Trans>
          </Heading>
          <p className="text-muted-foreground max-w-2xl">{message}</p>
          <Button onClick={() => (window.location.href = "/")}>
            <Trans>Back Home</Trans>
          </Button>
        </div>
      </div>
    </Document>
  );
}
