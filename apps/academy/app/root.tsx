import { CONTROLLED_ENVIRONMENT, getBrowserEnv, getCarbon } from "@carbon/auth";
import { flashClientMiddleware } from "@carbon/auth/middleware/flash.client";
import {
  flashHeadersContext,
  flashMiddleware,
  flashResultContext
} from "@carbon/auth/middleware/flash.server";
import { getOrRefreshAuthSession } from "@carbon/auth/session.server";
import { requestIdMiddleware } from "@carbon/logger/middleware.server";
import {
  OperatingSystemContextProvider,
  Toaster,
  TooltipProvider
} from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/utils";
import { faviconLinks } from "@carbon/utils/favicon";
import { I18nProvider } from "@react-aria/i18n";
import { Analytics } from "@vercel/analytics/react";
import type React from "react";
import type {
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
import NProgress from "~/styles/nprogress.css?url";
import Tailwind from "~/styles/tailwind.css?url";
import { CourseSidebarNav } from "./components/CourseSidebar";
import { SiteHeader } from "./components/SiteHeader";
import { path } from "./utils/path";

export const middleware = [requestIdMiddleware, flashMiddleware];
export const clientMiddleware = [flashClientMiddleware];

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: Tailwind },
  { rel: "stylesheet", href: NProgress },
  ...faviconLinks
];

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon Academy"
    }
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const {
    CARBON_EDITION,
    CARBON_API_URL,
    LOG_LEVEL,
    NODE_ENV,
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  } = getBrowserEnv();

  let session = await getOrRefreshAuthSession(request);

  let user = null;
  let lessonCompletions: {
    lessonId: string;
    courseId: string;
  }[] = [];
  let challengeAttempts: {
    topicId: string;
    courseId: string;
    passed: boolean;
  }[] = [];

  if (session) {
    const client = getCarbon(session.accessToken);

    const [authUser, completions, attempts] = await Promise.all([
      client.from("user").select("*").eq("id", session.userId).single(),
      client
        .from("lessonCompletion")
        .select("lessonId, courseId")
        .eq("userId", session.userId),
      client
        .from("challengeAttempt")
        .select("topicId, courseId, passed")
        .eq("userId", session.userId)
    ]);

    if (authUser.data) {
      user = authUser.data;
    }

    lessonCompletions = completions.data ?? [];
    challengeAttempts = attempts.data ?? [];
  }

  return data(
    {
      challengeAttempts,
      env: {
        CARBON_EDITION,
        CARBON_API_URL,
        LOG_LEVEL,
        NODE_ENV,
        POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY,
        SUPABASE_URL,
        SUPABASE_ANON_KEY
      },
      lessonCompletions,
      preferences: getPreferenceHeaders(request),
      result: context.get(flashResultContext),
      user,
      session
    },
    {
      headers: context.get(flashHeadersContext) ?? undefined
    }
  );
}

function Document({
  children,
  title = "Carbon"
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <html lang="en" className="overflow-x-hidden">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <title>{title}</title>
        <Links />
      </head>
      <body className="bg-background antialiased selection:bg-primary/10 selection:text-primary">
        <TooltipProvider>{children}</TooltipProvider>
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
  const prefs = loaderData?.preferences;

  return (
    <OperatingSystemContextProvider platform={prefs.platform}>
      <I18nProvider locale={prefs.locale}>
        <Document>
          <SiteHeader mobileNav={<CourseSidebarNav />} />
          <div className="pt-16 min-h-screen bg-background">
            <Outlet />
          </div>
          <script
            dangerouslySetInnerHTML={{
              __html: `window.env = ${JSON.stringify(env)}`
            }}
          />
        </Document>
      </I18nProvider>
    </OperatingSystemContextProvider>
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
      <div className="flex flex-col w-full h-screen items-center justify-center gap-5 bg-ed-paper px-6 text-center">
        <img
          src="/carbon-mark-light.svg"
          alt="Carbon"
          className="block max-w-[56px]"
        />
        <h1 className="text-ed-24 font-semi text-ed-ink">
          Something went wrong
        </h1>
        <p className="max-w-xl text-ed-15 text-ed-ink-66">{message}</p>
        <a
          href={path.to.root}
          className="group relative inline-flex h-10 items-center justify-center rounded-lg px-5 no-underline"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-lg cta-btn-dark"
          />
          <span className="text-on-dark relative z-10 text-ed-14 font-book tracking-[0.15px]">
            Back home
          </span>
        </a>
      </div>
    </Document>
  );
}
