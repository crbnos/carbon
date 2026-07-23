import { useLocation, useParams } from "react-router";
import type { BrowsingContext } from "../types";

function titleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Derives browsing context from the current route. Heuristic but bounded:
 *   /x/part/:itemId        -> { object: "part", id, type: "record", label: "Part <id>" }
 *   /x/job/:jobId          -> { object: "job",  id, type: "record", label: "Job <id>" }
 *   /x/sales/quotes        -> { object: "sales", type: "list",      label: "Sales quotes list" }
 */
export function useBrowsingContext(): BrowsingContext {
  const { pathname } = useLocation();
  const params = useParams();

  const segments = pathname.split("/").filter(Boolean);
  const afterX = segments[0] === "x" ? segments.slice(1) : segments;
  const object = afterX[0];

  // The last non-empty route param is the record id, if any.
  const idValues = Object.values(params).filter(Boolean) as string[];
  const id = idValues[idValues.length - 1];
  const type: "record" | "list" = id ? "record" : "list";

  const readable = object ? object.replace(/-/g, " ") : "app";
  const label =
    type === "record"
      ? `${titleCase(readable)} ${id}`
      : titleCase(
          [readable, afterX[1]?.replace(/-/g, " "), "list"]
            .filter(Boolean)
            .join(" ")
        );

  return { route: pathname, object, id, type, label };
}
