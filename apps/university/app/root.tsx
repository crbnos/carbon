import { error, getBrowserEnv, getCarbon } from "@carbon/auth";
import {
  getOrRefreshAuthSession,
  getSessionFlash,
} from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  Button,
  cn,
  Heading,
  IconButton,
  Progress,
  toast,
  Toaster,
  TooltipProvider,
  useDisclosure,
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

import { LuChevronDown, LuFingerprint, LuMoon, LuSun } from "react-icons/lu";
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
        .eq("userId", session.userId),
    ]);

    if (authUser.data) {
      user = authUser.data;
    }

    lessonCompletions = completions.data ?? [];
    challengeAttempts = attempts.data ?? [];
  }

  const sessionFlash = await getSessionFlash(request);

  return json(
    {
      lessonCompletions,
      challengeAttempts,
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

  const challengeAttempts = loaderData?.challengeAttempts ?? [];

  const disclosure = useDisclosure();

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

  const completionPercentage = Math.min(
    Math.round(
      (challengeAttempts.filter((attempt) => attempt.passed).length /
        totalChallenges) *
        100
    ),
    100
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
                <AvatarMenu className="ml-2" />
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
        <div className="w-full bg-primary dark:bg-[#2f31ae]">
          <div className="max-w-5xl mx-auto px-3 py-4 flex gap-8 z-logo items-center text-white w-full">
            <span className="text-xl font-display">
              {/* <span className="hidden lg:inline">Credential</span>  */}
              Progress
            </span>
            <div className="flex items-center justify-between gap-2 flex-1">
              <Progress value={completionPercentage} />
              <span className="text-xl font-display">
                {completionPercentage}%
              </span>
            </div>
            <Button
              variant="ghost"
              className="text-white hover:text-white/90"
              rightIcon={
                <LuChevronDown
                  className={`transition-transform duration-300 ${
                    disclosure.isOpen ? "rotate-180" : ""
                  }`}
                />
              }
              onClick={disclosure.onToggle}
            >
              {disclosure.isOpen ? "Less" : "More"}
            </Button>
          </div>
          <div
            className={cn(
              "w-full bg-black/20 transition-all duration-300 ease-in-out",
              disclosure.isOpen
                ? "h-auto opacity-100"
                : "h-0 opacity-0 overflow-hidden"
            )}
          >
            <div className="max-w-5xl mx-auto px-3 py-4 flex gap-8 z-logo items-center text-white w-full">
              <div className="w-full bg-white/10 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                {sections.map((section) =>
                  section.courses.map((course) => {
                    const totalChallenges = course.topics.reduce(
                      (acc, topic) => acc + (topic.challenge ? 1 : 0),
                      0
                    );

                    const completedChallenges = challengeAttempts.filter(
                      (attempt) =>
                        attempt.courseId === course.id && attempt.passed
                    ).length;

                    const percentage = Math.min(
                      Math.round((completedChallenges / totalChallenges) * 100),
                      100
                    );

                    if (totalChallenges === 0) {
                      return null;
                    }

                    return (
                      <Link
                        to={path.to.course(section.id, course.id)}
                        key={course.id}
                        className={cn(
                          "cursor-pointer flex items-center gap-2",
                          percentage === 0 && "opacity-50"
                        )}
                      >
                        <div
                          className="size-8 rounded-lg flex items-center justify-center"
                          style={{
                            backgroundColor: section.background,
                            color: section.foreground,
                          }}
                        >
                          {course.icon}
                        </div>
                        <div className="flex-1 text-xs flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{course.name}</span>
                            <span>{percentage}%</span>
                          </div>
                          <Progress value={percentage} className="h-2" />
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
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
