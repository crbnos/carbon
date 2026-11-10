// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ITEM_PAGES,
  pageById,
  pageOfUrl,
  pagesOf
} from "@carbon/database/access";
import ts from "typescript5";
import type { ConformanceCheck, SourceFile, Violation } from "../check";

export const ROUTE_GATE_NAMES_PAGE = "route-gate-names-page";

const ROUTE = /^apps\/erp\/app\/routes\/x\+\/(.+)\.tsx?$/;
const CONSTANT = /^[A-Z][A-Z0-9_]*$/;

type Exception = { pages: readonly string[]; reason: string };

const INSPECTION_PLAN_ASSIGNMENT: Exception = {
  pages: ["quality.inspectionPlans"],
  reason:
    "the item's Quality tab assigns inspection plans: it writes itemInspectionDocumentAssignment, an Inspection Plans table"
};

const RENTAL_RATES: Exception = {
  pages: ["sales.rentalAgreements"],
  reason:
    "the item's rental rates are Rental Agreements tables (itemRentalRate, customerItemRentalRate), edited from the item's Sales tab"
};

const WORK_CENTER_RULES: Exception = {
  pages: ["inventory.storageRules"],
  reason:
    "assigning a storage rule to a work center writes enforcementRuleWorkCenterAssignment, a Storage Rules table"
};

/**
 * Routes whose gate may name other pages than the one their URL maps to, and
 * why. Keyed by the route file under `apps/erp/app/routes/x+/`. A gate passes
 * when it names the URL's page or one of `pages`.
 */
export const ROUTE_GATE_EXCEPTIONS: Readonly<Record<string, Exception>> = {
  "part+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "material+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "tool+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "consumable+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "service+/$itemId.quality.tsx": INSPECTION_PLAN_ASSIGNMENT,
  "part+/$itemId.sales.tsx": RENTAL_RATES,
  "part+/$itemId.sales.rental-rates.new.tsx": RENTAL_RATES,
  "part+/$itemId.sales.rental-rates.$rateId.tsx": RENTAL_RATES,
  "part+/$itemId.sales.rental-rates.delete.$rateId.tsx": RENTAL_RATES,
  "resources+/work-centers.rules.assign.$workCenterId.tsx": WORK_CENTER_RULES,
  "resources+/work-centers.rules.unassign.$workCenterId.$ruleId.tsx":
    WORK_CENTER_RULES,
  "projects+/timesheets.$employeeId.tsx": {
    pages: ["projects.approvals"],
    reason:
      "an approver reviews one person's time here: an Approvals screen, opened under /x/projects/timesheets"
  },
  "users+/operators.reset-pin.$operatorId.tsx": {
    pages: ["settings.people"],
    reason:
      "resetting the PIN of an employee who is not a console operator is a People setting, as resetConsoleOperatorPin checks"
  }
};

/** The URL of a route file under `routes/x+/`, as the registry test builds it. */
export function routeUrl(file: string): string {
  const segments = file
    .replace(/\.(tsx?|jsx?)$/, "")
    .split("/")
    .flatMap((part) => part.replace(/\+$/, "").split("."))
    .filter((segment) => !segment.startsWith("_"))
    .map((segment) => segment.replace(/_$/, ""));
  return ["/x", ...segments].join("/");
}

const isPage = (text: string) => pageById(text) !== undefined;

/**
 * The pages a gate expression names; undefined when part of it cannot be
 * read (a variable, a property of a row, a call other than `anyOf`/`pagesOf`).
 */
function pagesNamed(
  node: ts.Node,
  constants: ReadonlyMap<string, readonly string[]>
): string[] | undefined {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
    return pagesNamed(node.expression, constants);
  if (ts.isSatisfiesExpression(node))
    return pagesNamed(node.expression, constants);
  if (ts.isStringLiteralLike(node)) return isPage(node.text) ? [node.text] : [];
  if (ts.isIdentifier(node)) {
    if (node.text === "ITEM_PAGES") return [...ITEM_PAGES];
    return constants.get(node.text)
      ? [...constants.get(node.text)!]
      : undefined;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: string[] = [];
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = property.name;
        if (ts.isStringLiteralLike(name) || ts.isIdentifier(name)) {
          if (isPage(name.text)) out.push(name.text);
          // `{ anyOf: [...] }`
          else if (name.text === "anyOf") {
            const inner = pagesNamed(property.initializer, constants);
            if (!inner) return undefined;
            out.push(...inner);
          }
        } else return undefined;
      } else if (ts.isSpreadAssignment(property)) {
        const inner = pagesNamed(property.expression, constants);
        if (!inner) return undefined;
        out.push(...inner);
      } else return undefined;
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out: string[] = [];
    for (const element of node.elements) {
      const inner = pagesNamed(
        ts.isSpreadElement(element) ? element.expression : element,
        constants
      );
      if (!inner) return undefined;
      out.push(...inner);
    }
    return out;
  }
  if (ts.isConditionalExpression(node)) {
    const a = pagesNamed(node.whenTrue, constants);
    const b = pagesNamed(node.whenFalse, constants);
    return a && b ? [...a, ...b] : undefined;
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const [first] = node.arguments;
    if (!first) return undefined;
    if (node.expression.text === "anyOf") return pagesNamed(first, constants);
    if (node.expression.text === "pagesOf" && ts.isStringLiteralLike(first))
      return pagesOf(first.text);
  }
  return undefined;
}

const parse = (file: string, contents: string) =>
  ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true);

/**
 * The exported upper-case constants of the ERP's non-route files that name
 * pages (`export const CONTRACT_READ_GATE = anyOf([...], "View")`), so a
 * route may gate on one by name.
 */
export function gateConstants(
  files: readonly SourceFile[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { file, contents } of files) {
    if (!file.startsWith("apps/erp/app/") || ROUTE.test(file)) continue;
    if (!/export const [A-Z]/.test(contents)) continue;
    for (const statement of parse(file, contents).statements) {
      if (
        !ts.isVariableStatement(statement) ||
        !statement.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword
        )
      )
        continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !CONSTANT.test(declaration.name.text) ||
          !declaration.initializer
        )
          continue;
        const pages = pagesNamed(declaration.initializer, out);
        if (pages?.length) out.set(declaration.name.text, pages);
      }
    }
  }
  return out;
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isParenthesizedExpression(node)
    ? unwrap(node.expression)
    : node;

/**
 * The pages each exported list of the list registry gates on, by the list's
 * name: `export const receiptsList = searchList({ gate, … })` or
 * `export const paymentsList = { key, gate, … }`. A route that loads a list
 * with `loadListPage(request, receiptsList)` gates on it.
 */
export function listGates(files: readonly SourceFile[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { file, contents } of files) {
    if (!contents.includes("gate:")) continue;
    for (const statement of parse(file, contents).statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
          continue;
        const value = unwrap(declaration.initializer);
        const definition = ts.isCallExpression(value)
          ? value.arguments[0] && unwrap(value.arguments[0])
          : value;
        if (!definition || !ts.isObjectLiteralExpression(definition)) continue;
        const gate = definition.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "gate"
        );
        const pages = gate && pagesNamed(gate.initializer, new Map());
        if (pages?.length) out.set(declaration.name.text, pages);
      }
    }
  }
  return out;
}

/** The gate argument of an `authorize` call, or the list of a `loadListPage` call. */
function gateOfCall(
  node: ts.CallExpression,
  constants: ReadonlyMap<string, readonly string[]>,
  lists: ReadonlyMap<string, readonly string[]>
): string[] | undefined {
  if (!ts.isIdentifier(node.expression) || node.arguments.length < 2)
    return undefined;
  const argument = node.arguments[1]!;
  if (node.expression.text === "authorize")
    return pagesNamed(argument, constants);
  if (node.expression.text === "loadListPage" && ts.isIdentifier(argument)) {
    const pages = lists.get(argument.text);
    return pages ? [...pages] : undefined;
  }
  return undefined;
}

/**
 * A route's gate, the `authorize` gate or the gate of the list it loads with
 * `loadListPage`, names the page its URL belongs to (`pageOfUrl`), or a list
 * of pages that holds it, so the sidebar, the registry `paths` and the gate
 * agree on whose screen it is.
 */
export function routeGateNamesPage(
  constants: ReadonlyMap<string, readonly string[]>,
  lists: ReadonlyMap<string, readonly string[]> = new Map()
): ConformanceCheck {
  return {
    id: ROUTE_GATE_NAMES_PAGE,
    description:
      "An ERP route's authorize gate names the page its URL maps to in the access registry",
    provenance: {
      deprecates:
        "a route gate that names another page than the registry `paths` give its URL",
      replacedBy:
        "gate on `pageOfUrl(route)`, move the URL in the registry, or list the route in ROUTE_GATE_EXCEPTIONS with the reason",
      since: "2026-11-10"
    },
    scan(file: string, contents: string): Violation[] {
      const route = ROUTE.exec(file)?.[1];
      if (
        !route ||
        !(contents.includes("authorize(") || contents.includes("loadListPage("))
      )
        return [];
      const page = pageOfUrl(routeUrl(route));
      if (!page) return [];
      const allowed = new Set([
        page,
        ...(ROUTE_GATE_EXCEPTIONS[file.slice(file.indexOf("x+/") + 3)]?.pages ??
          [])
      ]);
      const out: Violation[] = [];
      const source = parse(file, contents);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const pages = gateOfCall(node, constants, lists);
          if (pages?.length && !pages.some((named) => allowed.has(named))) {
            const line =
              source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            out.push({
              file,
              line,
              snippet: contents.split("\n")[line - 1]?.trim() ?? "",
              message: `The gate names ${[...new Set(pages)].join(", ")}, but the registry maps ${routeUrl(route)} to ${page}. Gate on ${page}, move the URL to the right page's \`paths\`, or add the route to ROUTE_GATE_EXCEPTIONS with the reason.`
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      return out;
    }
  };
}
