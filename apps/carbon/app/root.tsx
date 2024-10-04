import { error, getBrowserEnv } from "@carbon/auth";
import { getSessionFlash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { Button, Heading, toast } from "@carbon/react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import { Analytics } from "@vercel/analytics/react";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { json } from "@vercel/remix";
import React, { useEffect } from "react";
import { getMode, setMode } from "~/services/mode.server";
import Background from "~/styles/background.css?url";
import NProgress from "~/styles/nprogress.css?url";
import Tailwind from "~/styles/tailwind.css?url";
import { useMode } from "./hooks/useMode";
import { getTheme } from "./services/theme.server";
import { modeValidator } from "./types/validators";

// export const config = { runtime: "edge" };

export const links: LinksFunction = () => {
  return [
    { rel: "stylesheet", href: Tailwind },
    { rel: "stylesheet", href: Background },
    { rel: "stylesheet", href: NProgress },
    { rel: "stylesheet", href: "/assets/theme.css" },
  ];
};

export const meta: MetaFunction = () => {
  return [
    {
      title: "CarbonOS",
    },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const {
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    SUPABASE_API_URL,
    SUPABASE_ANON_PUBLIC,
  } = getBrowserEnv();

  const sessionFlash = await getSessionFlash(request);

  return json(
    {
      env: {
        POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY,
        SUPABASE_API_URL,
        SUPABASE_ANON_PUBLIC,
      },
      mode: getMode(request),
      theme: getTheme(request),
      result: sessionFlash?.result,
    },
    {
      headers: sessionFlash?.headers,
    }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const validation = await validator(modeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(error(validation.error, "Invalid mode"), {
      status: 400,
    });
  }

  return json(
    {},
    {
      headers: { "Set-Cookie": setMode(validation.data.mode) },
    }
  );
}

function Document({
  children,
  title = "CarbonOS",
  mode = "dark",
}: {
  children: React.ReactNode;
  title?: string;
  mode?: "light" | "dark";
}) {
  return (
    <html lang="en" className={`${mode} h-full overflow-x-hidden`}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <title>{title}</title>
        <link rel="manifest" href="/site.webmanifest" />
        <Links />
        <script
          defer
          src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js"
        ></script>
      </head>
      <body className="h-full bg-background antialiased selection:bg-primary/10 selection:text-primary">
        {children}

        <ScrollRestoration />
        <Scripts />
        <Analytics />
      </body>
    </html>
  );
}

export default function App() {
  const loaderData = useLoaderData<typeof loader>();
  const env = loaderData?.env ?? {};
  const result = loaderData?.result;

  /* Toast Messages */
  useEffect(() => {
    if (result?.success === true) {
      toast.success(result.message);
    } else if (result?.message) {
      toast.error(result.message);
    }
  }, [result]);

  const mode = useMode();

  return (
    <Document mode={mode}>
      <Outlet />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.env = ${JSON.stringify(env)}`,
        }}
      />
    </Document>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  const message = isRouteErrorResponse(error)
    ? error.data.message ?? error.data
    : error instanceof Error
    ? error.message
    : String(error);

  return (
    <Document title="Error!">
      <div className="dark">
        <div className="flex flex-col w-full h-screen bg-zinc-900 items-center justify-center space-y-4 ">
          <img
            src="/carbon-logo-light.png"
            alt="Carbon Logo"
            className="block max-w-[60px]"
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
