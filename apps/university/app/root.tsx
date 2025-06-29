import { error, getBrowserEnv, getCarbon } from "@carbon/auth";
import {
  getOrRefreshAuthSession,
  getSessionFlash,
} from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  Button,
  Heading,
  IconButton,
  Progress,
  toast,
  Toaster,
  TooltipProvider,
} from "@carbon/react";
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import { Analytics } from "@vercel/analytics/react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { json } from "@vercel/remix";
import React, { useEffect } from "react";
import { sections } from "~/config";
import { getMode, setMode } from "~/services/mode.server";
import Background from "~/styles/background.css?url";
import NProgress from "~/styles/nprogress.css?url";
import Tailwind from "~/styles/tailwind.css?url";

import { LuFingerprint, LuMoon, LuSun } from "react-icons/lu";
import AvatarMenu from "./components/AvatarMenu";
import { useMode } from "./hooks/useMode";
import { useOptionalUser } from "./hooks/useUser";
import { getTheme } from "./services/theme.server";
import { modeValidator } from "./types/validators";
import { path } from "./utils/path";

export const config = { runtime: "edge", regions: ["iad1"] };

export function links() {
  return [
    { rel: "stylesheet", href: Tailwind },
    { rel: "stylesheet", href: Background },
    { rel: "stylesheet", href: NProgress },
  ];
}

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon University",
    },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const {
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
  } = getBrowserEnv();

  let session = await getOrRefreshAuthSession(request);

  let user = null;
  let completedChallenges: {
    courseId: string;
    topicId: string;
  }[] = [];

  if (session) {
    const client = getCarbon(session.accessToken);

    const [authUser, challengeAttempts] = await Promise.all([
      client.from("user").select("*").eq("id", session.userId).single(),
      client
        .from("challengeAttempt")
        .select("courseId, topicId")
        .eq("userId", session.userId)
        .eq("passed", true),
    ]);

    if (authUser.data) {
      user = authUser.data;
    }

    completedChallenges = challengeAttempts.data ?? [];
  }

  const sessionFlash = await getSessionFlash(request);

  return json(
    {
      completedChallenges,
      env: {
        POSTHOG_API_HOST,
        POSTHOG_PROJECT_PUBLIC_KEY,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
      },
      mode: getMode(request),
      theme: getTheme(request),
      result: sessionFlash?.result,
      user,
      session,
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
  title = "Carbon",
  mode = "light",
  theme = "blue",
}: {
  children: React.ReactNode;
  title?: string;
  mode?: "light" | "dark";
  theme?: string;
}) {
  return (
    <html lang="en" className={`${mode} h-full overflow-x-hidden`}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <title>{title}</title>
        <Links />
      </head>
      <body className="h-full bg-background antialiased selection:bg-primary/10 selection:text-primary">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-right" visibleToasts={5} />
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
  const theme = loaderData?.theme ?? "zinc";
  const completedChallenges = loaderData?.completedChallenges ?? [];

  /* Toast Messages */
  useEffect(() => {
    if (result?.success === true) {
      toast.success(result.message);
    } else if (result?.message) {
      toast.error(result.message);
    }
  }, [result]);

  /* Dark/Light Mode */
  const mode = useMode();

  const fetcher = useFetcher<typeof action>();
  const user = useOptionalUser();

  // Calculate total challenges from sections config
  const totalChallenges = sections.reduce((total, section) => {
    return (
      total +
      section.courses.reduce((courseTotal, course) => {
        return (
          courseTotal +
          course.topics.reduce((topicTotal, topic) => {
            return topicTotal + (topic.challenge ? 1 : 0);
          }, 0)
        );
      }, 0)
    );
  }, 0);

  const completionPercentage = Math.round(
    (completedChallenges.length / totalChallenges) * 100
  );

  return (
    <Document mode={mode} theme={theme}>
      <header className="flex select-none items-center py-4 pl-5 pr-2 h-[var(--header-height)]">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between gap-2 z-logo text-foreground w-full">
          <Link
            to="/"
            className="cursor-pointer flex flex-row items-end gap-2 flex-shrink-0 font-display"
          >
            <img
              src="/carbon-word-light.svg"
              alt="Carbon"
              className="h-7 w-auto block dark:hidden"
            />
            <img
              src="/carbon-word-dark.svg"
              alt="Carbon"
              className="h-7 w-auto hidden dark:block"
            />
          </Link>
          <div className="flex items-center">
            <div className="items-center gap-1 hidden md:flex">
              <Button variant="ghost" asChild>
                <NavLink to={path.to.about}>About</NavLink>
              </Button>
              {user ? (
                <AvatarMenu />
              ) : (
                <>
                  <Button
                    variant="ghost"
                    className="cursor-pointer"
                    rightIcon={<LuFingerprint className="size-4" />}
                    asChild
                  >
                    <NavLink to={path.to.login}>Login</NavLink>
                  </Button>
                  <fetcher.Form action={path.to.root} method="post">
                    <input
                      type="hidden"
                      name="mode"
                      value={mode === "light" ? "dark" : "light"}
                    />
                    <IconButton
                      aria-label="Toggle Light Mode and Dark Mode"
                      type="submit"
                      variant="ghost"
                      icon={mode === "light" ? <LuMoon /> : <LuSun />}
                      className="cursor-pointer"
                    />
                  </fetcher.Form>
                </>
              )}
            </div>
          </div>
        </div>
      </header>
      {user && (
        <div className="w-full bg-primary dark:bg-[#6041d0]">
          <div className="max-w-5xl mx-auto px-3 py-4 flex flex-col gap-2 z-logo text-white w-full">
            <Progress value={completionPercentage} />
          </div>
        </div>
      )}
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
      <div className="light">
        <div className="flex flex-col w-full h-screen  items-center justify-center space-y-4 ">
          <img
            src="/carbon-logo-mark.svg"
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
