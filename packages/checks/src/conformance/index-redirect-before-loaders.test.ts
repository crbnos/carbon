// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { indexRedirectBeforeLoaders } from "./index-redirect-before-loaders";

const INDEX = "apps/erp/app/routes/x+/issue+/$id._index.tsx";
const scan = (contents: string, file = INDEX) =>
  indexRedirectBeforeLoaders.scan(file, contents);

const REDIRECT_ONLY = `import { redirect } from "react-router";

export async function loader({ params }: LoaderFunctionArgs) {
  throw redirect(path.to.issueDetails(params.id));
}
`;

describe("indexRedirectBeforeLoaders", () => {
  it("flags the shape that ran the issue layout for every hovered link", () => {
    const violations = scan(REDIRECT_ONLY);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(3);
  });

  it("accepts the route once the redirect is exported as middleware", () => {
    expect(
      scan(
        `${REDIRECT_ONLY}\nexport const middleware = [redirectBeforeLoaders(loader)];\n`
      )
    ).toEqual([]);
  });

  it("covers a module root and a const loader that returns its redirect", () => {
    expect(
      scan(
        `export const loader: LoaderFunction = async () => {\n  return redirect(path.to.operations);\n};\n`,
        "apps/mes/app/routes/x+/_index.tsx"
      )
    ).toHaveLength(1);
  });

  it("ignores an index route that renders a page", () => {
    expect(
      scan(
        `${REDIRECT_ONLY}\nexport default function Page() {\n  return null;\n}\n`
      )
    ).toEqual([]);
  });

  it("ignores a resource route, and any file that is not an index route", () => {
    expect(
      scan(`export async function loader() {\n  return { ok: true };\n}\n`)
    ).toEqual([]);
    expect(
      scan(REDIRECT_ONLY, "apps/erp/app/routes/x+/issue+/$id.tsx")
    ).toEqual([]);
  });

  it("is not satisfied by a middleware export that does something else", () => {
    expect(
      scan(`${REDIRECT_ONLY}\nexport const middleware = [authMiddleware];\n`)
    ).toHaveLength(1);
  });
});
