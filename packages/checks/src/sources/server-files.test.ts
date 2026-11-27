// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { noLocalTimezone } from "../conformance/server/no-local-timezone";
import { loadServerFiles, maskClientCode } from "./server-files";

/** A temp checkout holding the given repo-relative files. */
function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "server-files-"));
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  return root;
}

describe("loadServerFiles", () => {
  it("returns nothing for a checkout that has none of the server folders", () => {
    expect(loadServerFiles(checkout({ "README.md": "" }))).toEqual([]);
  });

  it("walks nested folders, skipping node_modules, dot folders and tests", () => {
    const root = checkout({
      "packages/jobs/src/a.ts": "a",
      "packages/jobs/src/tasks/deep/b.ts": "b",
      "packages/jobs/src/tasks/b.test.ts": "",
      "packages/jobs/src/node_modules/dep/index.ts": "",
      "packages/jobs/src/.cache/c.ts": "",
      "packages/jobs/src/notes.md": ""
    });
    expect(loadServerFiles(root)).toEqual([
      { file: "packages/jobs/src/a.ts", contents: "a" },
      { file: "packages/jobs/src/tasks/deep/b.ts", contents: "b" }
    ]);
  });

  it("takes only the service and server files of an ERP module", () => {
    const root = checkout({
      "apps/erp/app/modules/sales/sales.service.ts": "",
      "apps/erp/app/modules/sales/sales.server.ts": "",
      "apps/erp/app/modules/sales/sales.models.ts": "",
      "apps/erp/app/modules/sales/ui/columns.ts": ""
    });
    expect(loadServerFiles(root).map((f) => f.file)).toEqual([
      "apps/erp/app/modules/sales/sales.server.ts",
      "apps/erp/app/modules/sales/sales.service.ts"
    ]);
  });
});

/**
 * A route module is server AND client in one file. These cases pin the split:
 * loader/action (and the module-level helpers they call) are scanned; the
 * component, its hooks, and clientLoader/clientAction are not.
 */
describe("maskClientCode", () => {
  const scan = (src: string) =>
    noLocalTimezone.scan("apps/erp/app/routes/x+/r.tsx", maskClientCode(src));

  it("keeps loader bodies", () => {
    const src = [
      "export async function loader({ request }: LoaderFunctionArgs) {",
      "  const d = today(getLocalTimeZone());",
      "}"
    ].join("\n");
    expect(scan(src)).toHaveLength(1);
  });

  it("keeps action bodies, including the arrow-const form", () => {
    const src = [
      "export const action: ActionFunction = async ({ request }) => {",
      "  const d = today(getLocalTimeZone());",
      "};"
    ].join("\n");
    expect(scan(src)).toHaveLength(1);
  });

  it("keeps module-level server helpers a loader calls", () => {
    const src = [
      "export async function loader() {",
      "  return getExpired(client);",
      "}",
      "",
      "async function getExpired(client: Client) {",
      "  return client.lt('expirationDate', today(getLocalTimeZone()));",
      "}"
    ].join("\n");
    expect(scan(src)).toHaveLength(1);
  });

  it("skips the default-export component", () => {
    const src = [
      "export default function Route() {",
      "  const initialValues = { orderDate: today(getLocalTimeZone()) };",
      "  return null;",
      "}"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("masks a component whose destructured props span lines", () => {
    // `}: {` and `}) {` close the signature, not the component.
    const src = [
      "function TaskRow({",
      "  task",
      "}: {",
      "  task: Task;",
      "}) {",
      "  const d = today(getLocalTimeZone());",
      "  return null;",
      "}",
      "",
      "export async function loader() {",
      "  const d = today(getLocalTimeZone());",
      "}"
    ].join("\n");
    expect(scan(src)).toHaveLength(1);
  });

  it("skips clientLoader and clientAction, which run in the browser", () => {
    const src = [
      "export async function clientAction({ serverAction }) {",
      "  const d = today(getLocalTimeZone());",
      "  return serverAction();",
      "}"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("skips PascalCase components and use-prefixed hooks", () => {
    const src = [
      "function DatePickerCell() {",
      "  return today(getLocalTimeZone());",
      "}",
      "",
      "export function useToday() {",
      "  return today(getLocalTimeZone());",
      "}"
    ].join("\n");
    expect(scan(src)).toHaveLength(0);
  });

  it("does not swallow server code after an expression-bodied component", () => {
    const src = [
      "const Toolbar = () => null;",
      "",
      "export async function loader() {",
      "  const d = today(getLocalTimeZone());",
      "}"
    ].join("\n");
    const violations = scan(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
  });

  it("closes a paren-wrapped expression-bodied component at its `)` closer", () => {
    const src = [
      "const Header = () => (",
      "  <div>{today(getLocalTimeZone()).toString()}</div>",
      ");",
      "",
      "export async function loader() {",
      "  const d = today(getLocalTimeZone());",
      "}"
    ].join("\n");
    const violations = scan(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(6);
  });

  it("keeps masking a hook whose signature spans multiple lines", () => {
    // The `) {` that closes a multi-line parameter list must NOT end the
    // region — the body is still ahead.
    const src = [
      "function useProgressByOperation(",
      "  items: Item[]",
      ") {",
      "  return now(getLocalTimeZone());",
      "}",
      "",
      "export async function loader() {",
      "  const d = today(getLocalTimeZone());",
      "}"
    ].join("\n");
    const violations = scan(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(8);
  });

  it("resumes scanning after a client region closes", () => {
    const src = [
      "export default function Route() {",
      "  return today(getLocalTimeZone());",
      "}",
      "",
      "export async function action() {",
      "  const d = today(getLocalTimeZone());",
      "}"
    ].join("\n");
    const violations = scan(src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(6);
  });
});
