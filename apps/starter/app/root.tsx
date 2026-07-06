import { CONTROLLED_ENVIRONMENT, error, getBrowserEnv } from "@carbon/auth";
import { flashClientMiddleware } from "@carbon/auth/middleware/flash.client";
import {
  flashHeadersContext,
  flashMiddleware,
  flashResultContext
} from "@carbon/auth/middleware/flash.server";
import { validator } from "@carbon/form";
import { Button, Heading, Toaster, useMode } from "@carbon/react";
import type { Theme } from "@carbon/utils";
import { modeValidator, themes } from "@carbon/utils";
import { Analytics } from "@vercel/analytics/react";
import type React from "react";
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
  useLoaderData
} from "react-router";
import { getMode, setMode } from "~/services/mode.server";
import Background from "~/styles/background.css?url";
import NProgress from "~/styles/nprogress.css?url";
import Tailwind from "~/styles/tailwind.css?url";
import { getTheme } from "./services/theme.server";

export const middleware = [flashMiddleware];
export const clientMiddleware = [flashClientMiddleware];

export const links: LinksFunction = () => [
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
      title: "Carbon | Starter"
    }
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const {
    CARBON_EDITION,
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  } = getBrowserEnv();

  return data(
    {
      env: {
        CARBON_EDITION,
        POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY,
        SUPABASE_URL,
        SUPABASE_ANON_KEY
      },
      mode: getMode(request),
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
  theme = "zinc"
}: {
  children: React.ReactNode;
  title?: string;
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
      lang="en"
      className={`${mode} h-full overflow-x-hidden`}
      style={themeStyle}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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

  /* Dark/Light Mode */
  const mode = useMode();

  return (
    <Document mode={mode} theme={theme}>
      <Outlet />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.env = ${JSON.stringify(env)}`
        }}
      />
    </Document>
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
