import { describe, expect, it } from "vitest";
import { noLocalTimezone } from "../conformance/no-local-timezone";
import { maskClientCode } from "./server-files";

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

  it("preserves line numbers so violations point at the real line", () => {
    const src = [
      "export default function Route() {",
      "  return null;",
      "}",
      "",
      "export async function loader() {",
      "  const d = today(getLocalTimeZone());",
      "}"
    ].join("\n");
    expect(scan(src)[0]?.line).toBe(6);
  });
});
