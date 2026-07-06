import { Toaster } from "@carbon/react";
import type React from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError
} from "react-router";
import Tailwind from "~/styles/tailwind.css?url";

export function links() {
  return [{ rel: "stylesheet", href: Tailwind }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  return {
    env: {}
  };
}

export async function action({ request }: ActionFunctionArgs) {
  return {};
}

function Document({
  children,
  title = "Configurator Example"
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <html lang="en" className="h-full overflow-x-hidden">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <title>{title}</title>
        <Links />
      </head>
      <body className="h-full bg-background antialiased selection:bg-primary/10 selection:text-primary">
        {children}
        <Toaster />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { env } = useLoaderData<typeof loader>();

  return (
    <Document>
      <Outlet />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.env = ${JSON.stringify(env)}`
        }}
      />
    </Document>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

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
            className="block max-w-[60px]"
          />
          <img
            src="/carbon-mark-dark.svg"
            alt="Carbon Logo"
            className="max-w-[60px] hidden dark:block"
          />
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-2xl">{message}</p>
        </div>
      </div>
    </Document>
  );
}
