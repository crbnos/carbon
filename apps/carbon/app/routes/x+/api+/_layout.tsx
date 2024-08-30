import { swaggerDocsSchema } from "@carbon/database";
import { Button } from "@carbon/react";
import type { MetaFunction } from "@remix-run/node";
import { Outlet, useLocation, useNavigate } from "@remix-run/react";
import { GroupedContentSidebar } from "~/components/Layout";
import type { ValidLang } from "~/modules/api";
import { useSelectedLang } from "~/modules/api";
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
  module: "api",
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
    <div className="relative grid grid-cols-[auto_1fr] w-full h-full">
      <div className="flex absolute top-4 right-4 z-50 gap-2">
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
      <GroupedContentSidebar groups={groups} width={270} />
      <div className="Docs Docs--api-page w-full h-full overflow-y-auto">
        <div className="Docs--inner-wrapper pt-4">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

const tableBlacklist = new Set([
  "apiKey",
  "documentTransaction",
  "purchaseOrderTransaction",
  "salesOrderTransaction",
  "search",
  "user",
]);

function useApiDocsMenu(): RouteGroup[] {
  const selectedLang = useSelectedLang();
  const result: RouteGroup[] = [
    {
      name: "Getting Started",
      routes: [
        {
          name: "Introduction",
          to: path.to.apiIntro(selectedLang),
        },
      ],
    },
  ];

  const tables = Object.keys(swaggerDocsSchema.definitions).sort();

  result.push({
    name: "Tables and Views",
    routes: tables
      .filter((table) => !tableBlacklist.has(table))
      .map((table) => ({
        name: table,
        to: path.to.apiTable(selectedLang, table),
      })),
  });

  return result;
}
