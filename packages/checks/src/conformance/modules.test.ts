// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { ModuleDir } from "../check";
import {
  declaresSideEffects,
  findDuplicatedAppFiles,
  findUndeclaredSideEffectImports,
  moduleShapeCheck,
  noServerCodeInClient,
  serviceFnFile
} from "./modules";

const mod = (name: string, entries: string[]): ModuleDir => ({
  name,
  dir: `/x/${name}`,
  entries
});

const COMPLIANT = [
  "sales.service.ts",
  "sales.models.ts",
  "types.ts",
  "ui",
  "sales.server.ts"
];

const inspect = (module: ModuleDir) =>
  moduleShapeCheck.find({ modules: [module] });

describe("moduleShape", () => {
  it("passes a compliant module", () => {
    expect(inspect(mod("sales", COMPLIANT))).toHaveLength(0);
  });

  it("flags a missing required entry (types.ts)", () => {
    const v = inspect(
      mod("sales", ["sales.service.ts", "sales.models.ts", "ui"])
    );
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("missing:types.ts");
  });

  it("flags an extra service file", () => {
    const v = inspect(
      mod("settings", [
        ...COMPLIANT.map((e) => e.replace("sales", "settings")),
        "backups.service.ts"
      ])
    );
    expect(v.map((x) => x.snippet)).toContain(
      "extra-service:backups.service.ts"
    );
  });

  it("accepts the .ee-licensed service/server variant as the primary file", () => {
    const v = inspect(
      mod("widget", [
        "widget.ee.service.ts",
        "widget.models.ts",
        "types.ts",
        "ui",
        "widget.ee.server.ts"
      ])
    );
    expect(v).toHaveLength(0);
  });

  it("still flags a second service file alongside the .ee variant", () => {
    const v = inspect(
      mod("widget", [
        "widget.ee.service.ts",
        "widget.models.ts",
        "types.ts",
        "ui",
        "extra.service.ts"
      ])
    );
    expect(v.map((x) => x.snippet)).toContain("extra-service:extra.service.ts");
  });

  it("flags a missing primary service file", () => {
    const v = inspect(mod("sales", ["sales.models.ts", "types.ts", "ui"]));
    expect(v.map((x) => x.snippet)).toContain("missing:sales.service.ts");
  });

  it("flags a barrel", () => {
    const v = inspect(
      mod("sales", [...COMPLIANT, "index.ts", "index.server.ts"])
    );
    expect(v.map((x) => x.snippet)).toEqual([
      "barrel:index.ts",
      "barrel:index.server.ts"
    ]);
  });

  it("allows one server file, and its tests", () => {
    const v = inspect(
      mod("sales", [
        ...COMPLIANT,
        "sales.server.test.ts",
        "sales.documents.server.tsx",
        "timezone.server.ts"
      ])
    );
    expect(v.map((x) => x.snippet)).toEqual([
      "extra-server:sales.documents.server.tsx",
      "extra-server:timezone.server.ts"
    ]);
  });
});

const FILE = "apps/erp/app/modules/sales/sales.server.ts";
const scanServiceFn = (ts: string, file = FILE) =>
  serviceFnFile.scan(file, ts).map((v) => v.snippet);

describe("serviceFnFile", () => {
  it("passes service functions, types and plain constants", () => {
    expect(
      scanServiceFn(`import { z } from "zod";
type Line = { id: string };
const logger = getLogger("erp", "sales");
const CLOSED = new Set(["Closed"]);
/** Send a quote. @mcp */
export const sendQuote = defineServiceFn({ input: z.object({}), permission: "employee", async run() {} });`)
    ).toEqual([]);
  });

  it("flags a helper function, a function-valued const and a class", () => {
    expect(
      scanServiceFn(`export async function lookup() {}
function local() {}
const toRow = (x: number) => x;
class Cache {}`)
    ).toEqual(["lookup", "local", "toRow", "Cache"]);
  });

  it("flags an export that is not a service function, and an unexported one", () => {
    expect(
      scanServiceFn(`export const LIMIT = 5;
const hidden = defineServiceFn({});
export { thing } from "./x";`)
    ).toEqual(["LIMIT", "hidden", "ExportDeclaration"]);
  });

  it('flags permission {}: membership is written "employee"', () => {
    expect(
      scanServiceFn(`export const getUnits = defineServiceFn({ input: z.object({}), permission: {}, async run() {} });
export const getNames = defineServiceFn({ input: z.object({}), permission: { view: "parts" }, async run() {} });`)
    ).toEqual(["getUnits: permission {}"]);
  });

  it("passes a service function whose definition is not an object literal", () => {
    expect(
      scanServiceFn(`export const sendQuote = defineServiceFn(quoteDefinition);
export const getQuote = defineServiceFn();`)
    ).toEqual([]);
  });

  it("reads a module's own server file, .ee variant included", () => {
    const ts = "export function helper() {}";
    expect(
      scanServiceFn(ts, "apps/erp/app/modules/sales/sales.service.ts")
    ).toEqual([]);
    expect(scanServiceFn(ts, "apps/erp/app/modules/router.server.ts")).toEqual(
      []
    );
    expect(
      scanServiceFn(ts, "apps/erp/app/modules/widget/widget.ee.server.ts")
    ).toEqual(["helper"]);
  });
});

const body = "export function useThing() {\n  return 1;\n}\n";
const reExport = '// header\n\nexport { useThing } from "@carbon/react";\n';

describe("findDuplicatedAppFiles", () => {
  it("flags a file with code in both apps", () => {
    expect(
      findDuplicatedAppFiles([
        { file: "apps/erp/app/hooks/useThing.ts", contents: body },
        { file: "apps/mes/app/hooks/useThing.ts", contents: body }
      ]).map((v) => v.file)
    ).toEqual(["useThing.ts"]);
  });

  it("accepts a file in one app, a re-export, and generic names", () => {
    expect(
      findDuplicatedAppFiles([
        { file: "apps/erp/app/hooks/useOnlyErp.ts", contents: body },
        { file: "apps/erp/app/hooks/useThing.ts", contents: reExport },
        { file: "apps/mes/app/hooks/useThing.ts", contents: reExport },
        { file: "apps/erp/app/hooks/index.ts", contents: body },
        { file: "apps/mes/app/hooks/index.ts", contents: body },
        { file: "apps/erp/app/components/A/Thing.tsx", contents: body },
        { file: "apps/erp/app/components/B/Thing.tsx", contents: body }
      ])
    ).toEqual([]);
  });
});

const scanClientImports = (file: string, ts: string) =>
  noServerCodeInClient.scan(file, ts).map((v) => v.snippet);

describe("noServerCodeInClient", () => {
  it("flags a component importing a service or server file", () => {
    const ts = `import { getQuote } from "~/modules/sales/sales.service";
import { sendQuote } from "../sales.server";`;
    expect(
      scanClientImports("apps/erp/app/modules/sales/ui/Quote/QuoteForm.tsx", ts)
    ).toEqual(["~/modules/sales/sales.service", "../sales.server"]);
    expect(
      scanClientImports("apps/erp/app/components/Form/Item.tsx", ts)
    ).toHaveLength(2);
    expect(
      scanClientImports("apps/erp/app/modules/sales/sales.models.ts", ts)
    ).toHaveLength(2);
  });

  it("allows a type-only import and client-safe files", () => {
    expect(
      scanClientImports(
        "apps/erp/app/modules/sales/ui/Quote/QuoteForm.tsx",
        `import type { Quote } from "~/modules/sales/sales.service";
import { quoteValidator } from "~/modules/sales/sales.models";`
      )
    ).toEqual([]);
  });

  it("ignores server-side files", () => {
    const ts = 'import { getQuote } from "~/modules/sales/sales.service";';
    expect(
      scanClientImports("apps/erp/app/modules/sales/sales.server.ts", ts)
    ).toEqual([]);
  });

  it("allows a route to import a service file for its loader and action", () => {
    const ts = `import { getQuote } from "~/modules/sales/sales.service";

export async function loader() {
  return getQuote();
}

export default function QuoteRoute() {
  return null;
}`;
    expect(
      scanClientImports("apps/erp/app/routes/x+/quote+/$id.tsx", ts)
    ).toEqual([]);
  });

  it("flags a server-file name used in a route's browser code", () => {
    const ts = `import { getLedger, LOCK_TASK } from "~/modules/a/a.service";
import * as service from "~/modules/b/b.service";
import { getDatabaseClient } from "~/services/database.server";

export async function loader() {
  return getLedger(getDatabaseClient());
}

export default function Route() {
  const done = task.name === LOCK_TASK;
  return service.render(done);
}`;
    expect(scanClientImports("apps/erp/app/routes/x+/a+/$id.tsx", ts)).toEqual([
      "LOCK_TASK from ~/modules/a/a.service",
      "service from ~/modules/b/b.service"
    ]);
  });

  it("does not count a comment or a local of the same name", () => {
    const ts = `import { flash, setTheme, theme } from "~/services/x.server";

export default function Route() {
  // flash shows the result
  const [t, setTheme] = useState();
  const {
    theme
  } = useLoaderData();
  return setTheme(theme);
}`;
    expect(scanClientImports("apps/erp/app/routes/x+/a+/$id.tsx", ts)).toEqual(
      []
    );
  });

  it("does not count a word in JSX text, but counts a JSX expression", () => {
    const prose = `import { authorize } from "@carbon/api/carbon.server";

export default function Route() {
  return (
    <p>
      Only authorize it if you started
      this connection.
    </p>
  );
}`;
    expect(
      scanClientImports("apps/erp/app/routes/x+/a+/$id.tsx", prose)
    ).toEqual([]);
    const used = `import { authorize } from "@carbon/api/carbon.server";

export default function Route() {
  return <Button onClick={() => authorize(request)}>Go</Button>;
}`;
    expect(
      scanClientImports("apps/erp/app/routes/x+/a+/$id.tsx", used)
    ).toEqual(["authorize from @carbon/api/carbon.server"]);
  });

  it("does not count a renamed type-only specifier", () => {
    const ts = `import { type Row as ServiceRow, getRow } from "~/modules/a/a.service";

export async function loader() {
  return getRow();
}

export default function Route({ row }: { row: ServiceRow }) {
  return row.id;
}`;
    expect(scanClientImports("apps/erp/app/routes/x+/a+/$id.tsx", ts)).toEqual(
      []
    );
  });

  it("does not count a property or a type-only specifier", () => {
    const ts = `import { type Row, getRow } from "~/modules/a/a.service";

export default function Route({ row }: { row: Row }) {
  return row.getRow;
}`;
    expect(scanClientImports("apps/erp/app/routes/x+/a+/$id.tsx", ts)).toEqual(
      []
    );
  });
});

const pkg = (sideEffects: false | string[], files: Record<string, string>) => ({
  dir: "apps/erp",
  sideEffects,
  paths: new Set(Object.keys(files)),
  files: Object.entries(files).map(([file, contents]) => ({ file, contents }))
});

describe("findUndeclaredSideEffectImports", () => {
  const files = {
    "apps/erp/app/entry.server.tsx": 'import "./modules/carbon.server";\n',
    "apps/erp/app/modules/carbon.server.ts": "registerCarbon();\n",
    "apps/erp/app/root.tsx":
      'import "~/zod.client";\nimport "./styles.css";\nimport "@carbon/lib/shims";\n',
    "apps/erp/app/zod.client.ts": "z.config({ jitless: true });\n"
  };

  it("flags a bare import of a file sideEffects does not list", () => {
    expect(
      findUndeclaredSideEffectImports([pkg(false, files)]).map((v) => v.snippet)
    ).toEqual(["./modules/carbon.server", "~/zod.client"]);
  });

  it("passes once the files are listed, and ignores css and other packages", () => {
    expect(
      findUndeclaredSideEffectImports([
        pkg(["./app/modules/carbon.server.ts", "**/zod.client.ts"], files)
      ])
    ).toEqual([]);
  });

  it("ignores a css import whose file is in the package", () => {
    expect(
      findUndeclaredSideEffectImports([
        pkg(false, {
          "apps/erp/app/root.tsx": 'import "./styles.css";\n',
          "apps/erp/app/styles.css": ""
        })
      ])
    ).toEqual([]);
  });
});

describe("declaresSideEffects", () => {
  it("matches a path, a glob, and a bare file name anywhere", () => {
    expect(declaresSideEffects(["./src/shims.ts"], "src/shims.ts")).toBe(true);
    expect(declaresSideEffects(["src/*.css"], "src/a.css")).toBe(true);
    expect(declaresSideEffects(["shims.ts"], "src/deep/shims.ts")).toBe(true);
    expect(declaresSideEffects(["./src/shims.ts"], "src/other.ts")).toBe(false);
    expect(declaresSideEffects(false, "src/shims.ts")).toBe(false);
  });
});
