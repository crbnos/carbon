import {
  Button,
  ClientOnly,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@carbon/react";
import { useState } from "react";
import { LuEye, LuEyeOff, LuSettings2, LuTable2 } from "react-icons/lu";
import type { MetaFunction } from "react-router";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { GroupedContentSidebar } from "~/components/Layout";
import { CollapsibleSidebarProvider } from "~/components/Layout/Navigation";
import { useSwaggerDocs } from "~/hooks/useSwaggerDocs";
import type { ValidLang } from "~/modules/api";
import {
  ApiDocsProvider,
  useApiDocsConfig,
  useSelectedLang
} from "~/modules/api";
import DocsStyle from "~/styles/docs.css?url";
import type { RouteGroup } from "~/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | API Docs" }];
};

export const handle: Handle = {
  breadcrumb: "API Docs",
  to: path.to.apiIntroduction,
  module: "api"
};

export function links() {
  return [{ rel: "stylesheet", href: DocsStyle }];
}

export default function ApiDocsRoute() {
  const groups = useApiDocsMenu();
  const selectedLang = useSelectedLang();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const onChangeLanguage = (newLang: ValidLang) => {
    if (newLang === selectedLang) return;
    let newPath = "";
    switch (selectedLang) {
      case "bash":
        newPath = pathname.replace("/bash/", `/${newLang}/`);
        navigate(newPath);
        break;
      case "js":
        newPath = pathname.replace("/js/", `/${newLang}/`);
        navigate(newPath);
        break;
      default:
        throw new Error(`Invalid language: ${selectedLang}`);
    }
  };

  return (
    <ApiDocsProvider>
      <CollapsibleSidebarProvider>
        <div className="flex flex-col h-screen">
          <div className="bg-background border-b h-[var(--header-height)] col-span-full px-6 items-center flex flex-shrink-0 justify-between">
            <Link to={path.to.authenticatedRoot}>
              <img
                src="/carbon-word-light.svg"
                alt="Carbon Logo"
                className="h-6 dark:hidden z-50"
              />
              <img
                src="/carbon-word-dark.svg"
                alt="Carbon Logo"
                className="h-6 dark:block hidden z-50"
              />
            </Link>
            <ApiDocsConfigInputs />
          </div>
          <div className="relative grid grid-cols-[auto_1fr] w-full h-full">
            <div className="flex absolute top-2 right-2 z-50 gap-2">
              <Button
                variant={selectedLang === "js" ? "primary" : "secondary"}
                onClick={() => {
                  onChangeLanguage("js");
                }}
              >
                JS
              </Button>
              <Button
                variant={selectedLang === "bash" ? "primary" : "secondary"}
                onClick={() => {
                  onChangeLanguage("bash");
                }}
              >
                Bash
              </Button>
            </div>
            <GroupedContentSidebar groups={groups} width={270} exactMatch />
            <div className="Docs Docs--api-page w-full h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
              <div className="Docs--inner-wrapper pt-4">
                <ClientOnly>{() => <Outlet />}</ClientOnly>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSidebarProvider>
    </ApiDocsProvider>
  );
}

function ApiDocsConfigInputs() {
  const { apiUrl, apiKey, setApiUrl, setApiKey } = useApiDocsConfig();
  const [showKey, setShowKey] = useState(false);
  const isConfigured = !!(apiUrl || apiKey);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-1.5">
          <LuSettings2 className="h-3.5 w-3.5" />
          <span>API Settings</span>
          {isConfigured && (
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[400px] p-0">
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              API Configuration
            </h4>
            <p className="text-xs text-muted-foreground mt-1">
              Set a custom server URL and API key. Snippets will update
              automatically.
            </p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Server URL
              </label>
              <Input
                size="sm"
                placeholder="https://your-api-url.supabase.co"
                value={apiUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setApiUrl(e.target.value)
                }
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                API Key
              </label>
              <div className="relative">
                <Input
                  size="sm"
                  type={showKey ? "text" : "password"}
                  placeholder="your-api-key"
                  value={apiKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setApiKey(e.target.value)
                  }
                  className="font-mono text-xs pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                >
                  {showKey ? (
                    <LuEyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <LuEye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const tableBlacklist = new Set([
  "apiKey",
  "challengeAttempt",
  "documentTransaction",
  "feedback",
  "groups_recursive",
  "invite",
  "lessonCompletion",
  "oauthClient",
  "oauthCode",
  "oauthToken",
  "purchaseOrderTransaction",
  "salesOrderTransaction",
  "search"
]);

function useApiDocsMenu(): RouteGroup[] {
  const swaggerDocsSchema = useSwaggerDocs();
  const selectedLang = useSelectedLang();
  const result: RouteGroup[] = [
    {
      name: "Getting Started",
      routes: [
        {
          name: "Introduction",
          to: path.to.apiIntro(selectedLang)
        }
      ]
    }
  ];

  const tables = Object.keys(swaggerDocsSchema?.definitions ?? {}).sort();
  const isTable = (table: string): boolean => {
    if (!swaggerDocsSchema?.paths) return false;
    const tableKey = `/${table}`;
    return Object.keys(swaggerDocsSchema.paths[tableKey] ?? {}).some(
      (x) => x.toUpperCase() === "POST"
    );
  };

  result.push({
    name: "Tables and Views",
    routes: tables
      .filter((table) => !tableBlacklist.has(table))
      .map((table) => ({
        name: table,
        to: path.to.apiTable(selectedLang, table),
        icon: isTable(table) ? (
          <LuTable2 className="flex-shrink-0" />
        ) : (
          <LuEye className="flex-shrink-0" />
        )
      }))
  });

  return result;
}
