// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  FORM_FIELD_BUDGET,
  findUnselectedListColumns,
  formFieldBudget,
  LIST_TABLES,
  linguiMacroMisuse,
  noDefaultOnEffects,
  noInlineSensorOptions,
  noNoopOpenChange,
  noRawRevalidator,
  noUnguardedSubmit,
  noUnmountingDialog
} from "./ui";

const scanNoopOpenChange = (contents: string) =>
  noNoopOpenChange.scan("apps/erp/app/components/X.tsx", contents);

describe("noNoopOpenChange", () => {
  it("flags a handler that does nothing", () => {
    expect(
      scanNoopOpenChange(`<Modal open onOpenChange={() => {}}>
<Drawer
  open
  onOpenChange={() => {
    /* intentionally non-dismissable */
  }}
>
<Modal open onOpenChange={() => undefined}>`).map((v) => v.line)
    ).toEqual([1, 4, 8]);
  });

  it("accepts a real handler and no handler", () => {
    expect(
      scanNoopOpenChange(`<Modal open>
<Modal open onOpenChange={(open) => { if (!open) onClose(); }}>
<Drawer open onOpenChange={setOpen}>`)
    ).toEqual([]);
  });
});

const scanUnmountingDialog = (
  contents: string,
  file = "apps/erp/app/modules/x/ui/X.tsx"
) => noUnmountingDialog.scan(file, contents).map((v) => v.line);

describe("noUnmountingDialog", () => {
  it("flags a dialog that a condition removes", () => {
    expect(
      scanUnmountingDialog(`{deleteModal.isOpen && <ConfirmDelete name="x" onCancel={close} />}
{selected && (
  <PartDrawer item={selected} />
)}
{isOpen && <Modal open onOpenChange={close}>
{isOpen && (
  <IssueModal
    {/* the method's materials */}
    onClose={close}
  />
)}`)
    ).toEqual([1, 3, 5, 7]);
  });

  it("flags a dialog whose condition is its own open state, even with an open prop", () => {
    expect(
      scanUnmountingDialog(`{deleteModal.isOpen && (
  <ConfirmDelete isOpen={deleteModal.isOpen} onCancel={close} />
)}
{open && selected && <Modal open={open}>
{d.openCount > 0 && <PartModal key={d.openCount} open={d.isOpen} />}
{selected && <Drawer open={isOpen} />}
{showDelete && <ConfirmDelete isOpen={showDelete} />}
{d.isOpen === true && <XModal open={d.isOpen} />}
{showDeleteAll && <ConfirmDelete isOpen={showDelete} />}
{sel && <ConfirmDelete isOpen={!!sel} />}
{row.item && <EditModal open={Boolean(row.item)} />}`)
    ).toEqual([2, 4, 7, 8, 10, 11]);
  });

  it("flags a dialog under an open state other than the one it passes", () => {
    expect(
      scanUnmountingDialog(
        `{drawer.isOpen && <PartDrawer open={ready} item={selected} />}`
      )
    ).toEqual([1]);
  });

  it("flags a dialog whose condition is the same compound expression as its open prop", () => {
    expect(
      scanUnmountingDialog(`{count > 0 && <XModal open={count > 0} onClose={close} />}
{count>0 && <XModal open={count > 0} onClose={close} />}
{a && b ? <XModal open={Boolean(a && b)} /> : null}
{count > 0 && ready && <XModal open={count > 0} />}
{ready && <XModal open={count > 0} />}
{count > 10 && <XModal open={count > 1} />}
{d.isOpen && <XModal open={count > 0} />}`)
    ).toEqual([1, 2, 3, 7]);
  });

  it("reads an opening tag to its end past JSX text in a prop, quotes included", () => {
    expect(
      scanUnmountingDialog(`{d.isOpen && <XModal title={<b>Don't</b>} onClose={close} />}
{d.isOpen && <XModal title={<b>Say "hi"</b>} onClose={close} />}
{d.isOpen && <XModal title={x ? <b>Don't</b> : null} onClose={close} />}
{d.isOpen && <XModal limit={count <max} onClose={close} />}
{d.isOpen && <XModal title={<><b>Note</b> it's <br /> {x}</>} onClose={close} />}
{d.isOpen && <XModal limit={1 << bits} onClose={close} />}`)
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("does not end an opening tag at a > inside a string", () => {
    expect(
      scanUnmountingDialog(`{selected && <XModal title="it's > here" open={d.isOpen} />}
{selected && <XModal title={'a /> b'} open={d.isOpen} />}
{selected && <XModal title={\`a > \${b}\`} open={d.isOpen} />}
{selected && <XModal title={<b title="x > y">Don't</b>} open={d.isOpen} />}`)
    ).toEqual([]);
  });

  it("flags a dialog in a ternary's empty branch or after ||, ignores data-open, and reads a braced open prop whole", () => {
    expect(
      scanUnmountingDialog(`{!deleteModal.isOpen ? null : <ConfirmDelete isOpen={deleteModal.isOpen} />}
{hidden || <EditModal onClose={close} />}
{x.isOpen && <ModalCard onClose={close}>}
{newGauge.isOpen && <GaugeForm type="modal" onClose={close} />}
{tab && <GaugeForm type="card" />}
{sel && <XModal data-open={sel.id} />}
{x && <XDrawer open={rows.some((r) => { return r.id === x; })} />}`)
    ).toEqual([1, 2, 3, 4, 6]);
  });

  it("flags a dialog whose own close clears the record it is guarded on", () => {
    expect(
      scanUnmountingDialog(`{selectedCustomer && selectedCustomer.id && (
  <ConfirmDelete
    isOpen={deleteModal.isOpen}
    onCancel={() => {
      deleteModal.onClose();
      setSelectedCustomer(null);
    }}
  />
)}
{loading ? <Spinner /> : <ConfirmDelete name="x" onCancel={close} />}
{selected && <ConfirmDelete isOpen={d.isOpen} onCancel={d.onClose} />}
{show && <XModal open={d.isOpen} onClose={() => { d.onClose(); setShow(false); }} />}
{deleteLine && <DeleteLine isOpen={d.isOpen} onCancel={onDeleteCancel} />}
const onDeleteCancel = () => {
  d.onClose();
  setDeleteLine(null);
};`)
    ).toEqual([2, 10, 12, 13]);
  });

  it("reads a ternary as a condition too", () => {
    expect(
      scanUnmountingDialog(`{issueModal.isOpen ? (
  <IssueMaterialModal onClose={close} />
) : null}
{pending ? <LeaseModal open={isOpen} /> : null}
const isOpen = d.isOpen;
const modals = pending?.action === "end" ? (
  <LeaseModal open={isOpen} />
) : pending?.action === "buy" ? (
  <BuyModal open={isOpen} />
) : null;
const render = () =>
  d.openCount > 0 ? <IssueModal open={d.isOpen} /> : null;`)
    ).toEqual([2]);
  });

  it("accepts a dialog driven by its open prop, under a condition or not", () => {
    expect(
      scanUnmountingDialog(`<ConfirmDelete isOpen={deleteModal.isOpen} onCancel={close} />
{selected && <PartDrawer open={drawer.isOpen} item={selected} />}
{rows.length > 0 && <Table rows={rows} />}
{isOpen && <ModalBody>text</ModalBody>}`)
    ).toEqual([]);
  });

  it("treats Confirm* and Delete* components as dialogs", () => {
    expect(
      scanUnmountingDialog(`{d.isOpen && <DeleteProcedureStep attribute={a} onCancel={close} />}
{d.isOpen && <ConfirmMaterialIdChange onClose={close} />}`)
    ).toEqual([1, 2]);
  });

  it("flags an early return that removes a dialog, not one in a component with no dialog", () => {
    expect(
      scanUnmountingDialog(
        `if (!isOpen) return null;\nreturn <Modal open={isOpen} />;`
      )
    ).toEqual([1]);
    expect(
      scanUnmountingDialog(`if (!open) return null;\nreturn <div />;`)
    ).toEqual([]);
  });

  it("flags a route closed with useCloseRoute", () => {
    expect(scanUnmountingDialog(`const closeRoute = useCloseRoute();`)).toEqual(
      [1]
    );
  });

  it("leaves the files that define the hooks alone", () => {
    expect(
      scanUnmountingDialog(
        `const closeRoute = useCloseRoute();`,
        "packages/react/src/hooks/useRouteDialog.tsx"
      )
    ).toEqual([]);
  });
});

const scanUnguardedSubmit = (
  contents: string,
  file = "apps/erp/app/modules/x/ui/Y.tsx"
) => noUnguardedSubmit.scan(file, contents);

describe("noUnguardedSubmit", () => {
  it("flags a bare submit button inside a fetcher.Form", () => {
    const found = scanUnguardedSubmit(`
      <fetcher.Form method="post" action={path.to.newReceipt}>
        <Button type="submit">New</Button>
      </fetcher.Form>
    `);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
    expect(found[0]?.snippet).toBe('<Button type="submit">');
  });

  // The regression this check exists for: `loading` was the modal's data-fetch
  // flag, not its submission state, so the button stayed live for the seconds
  // the action spent rendering a PDF and emailing the customer.
  it("flags isDisabled bound to something that is not an in-flight signal", () => {
    expect(
      scanUnguardedSubmit('<Button isDisabled={loading} type="submit">')
    ).toHaveLength(1);
  });

  it.each([
    [
      '<Button isDisabled={fetcher.state !== "idle"} type="submit">',
      "fetcher state"
    ],
    [
      '<Button isDisabled={statusFetcher.state !== "idle"} type="submit">',
      "named fetcher"
    ],
    [
      '<Button isLoading={isLoading} isDisabled={isLoading} type="submit">',
      "isLoading"
    ],
    [
      '<Button isDisabled={navigation.state !== "idle"} type="submit">',
      "navigation"
    ],
    ['<Button isDisabled={isSubmitting} type="submit">', "isSubmitting"],
    [
      '<Button disabled={fetcher.state !== "idle"} type="submit">',
      "the plain disabled prop"
    ]
  ])("accepts a guarded button (%s)", (tag) => {
    expect(scanUnguardedSubmit(tag)).toHaveLength(0);
  });

  it("ignores buttons inside a ValidatedForm — the form refuses a re-entrant submit", () => {
    expect(
      scanUnguardedSubmit(`
        <ValidatedForm validator={v} method="post">
          <Button type="submit">Save</Button>
        </ValidatedForm>
      `)
    ).toHaveLength(0);
  });

  it("flags a button after a ValidatedForm has closed", () => {
    expect(
      scanUnguardedSubmit(`
        <ValidatedForm validator={v}><Button type="submit">A</Button></ValidatedForm>
        <fetcher.Form><Button type="submit">B</Button></fetcher.Form>
      `)
    ).toHaveLength(1);
  });

  it("handles a multi-line tag and a > inside an expression", () => {
    const found = scanUnguardedSubmit(`
      <Button
        isDisabled={count > 0}
        type="submit"
      >
        Go
      </Button>
    `);
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toBe(
      '<Button isDisabled={count > 0} type="submit" >'
    );
  });

  it("flags a lowercase <button> too", () => {
    expect(
      scanUnguardedSubmit('<button type="submit">Log out</button>')
    ).toHaveLength(1);
  });

  // A signal that only changes a tooltip disables nothing.
  it("rejects an in-flight signal on a prop that does not disable", () => {
    expect(
      scanUnguardedSubmit(
        '<Button title={isSubmitting ? "Saving" : "Save"} type="submit">'
      )
    ).toHaveLength(1);
  });

  // A guard is routinely held in a local, so the scanner resolves one hop.
  it("resolves a guard held in a local variable", () => {
    expect(
      scanUnguardedSubmit(`
        const busy = fetcher.state !== "idle";
        <Button isLoading={busy} type="submit">Go</Button>
      `)
    ).toHaveLength(0);
  });

  it("rejects a local that names no submit state", () => {
    expect(
      scanUnguardedSubmit(`
        const loading = !data;
        <Button isDisabled={loading} type="submit">Go</Button>
      `)
    ).toHaveLength(1);
  });

  it("rejects isLoading bound to a constant — it disables nothing", () => {
    expect(
      scanUnguardedSubmit('<Button isLoading={false} type="submit">')
    ).toHaveLength(1);
  });

  it("accepts a bare isLoading — always true, so always disabled", () => {
    expect(
      scanUnguardedSubmit('<Button isLoading type="submit">')
    ).toHaveLength(0);
  });

  it("matches type at an attribute boundary, both quote styles", () => {
    expect(scanUnguardedSubmit("<Button type='submit'>")).toHaveLength(1);
    expect(
      scanUnguardedSubmit('<Button data-type="submit" type="button">')
    ).toHaveLength(0);
  });

  it("does not let a ValidatedForm-prefixed component grant the exemption", () => {
    expect(
      scanUnguardedSubmit(`
        <ValidatedFormProvider>
          <Button type="submit">Save</Button>
        </ValidatedFormProvider>
      `)
    ).toHaveLength(1);
  });

  it("ignores a non-submit button", () => {
    expect(
      scanUnguardedSubmit("<Button onClick={go}>Go</Button>")
    ).toHaveLength(0);
  });

  it("does not scan .ts files or the Submit component itself", () => {
    expect(
      scanUnguardedSubmit('<Button type="submit">', "apps/erp/app/x.ts")
    ).toHaveLength(0);
    expect(
      scanUnguardedSubmit(
        '<Button type="submit">',
        "packages/form/src/components/Submit.tsx"
      )
    ).toHaveLength(0);
  });
});

const FILE = "apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx";
const fields = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `      <Input name="field${index}" label="Field" />`
  ).join("\n");
const form = (body: string) =>
  `export function X() {\n  return (\n    <ValidatedForm validator={v}>\n${body}\n    </ValidatedForm>\n  );\n}\n`;
const scanFieldBudget = (contents: string, file = FILE) =>
  formFieldBudget.scan(file, contents);

describe("formFieldBudget", () => {
  it("flags a flat form over the budget, at its ValidatedForm", () => {
    const violations = scanFieldBudget(form(fields(FORM_FIELD_BUDGET + 1)));
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(3);
    expect(violations[0]!.snippet).toBe("<ValidatedForm>");
  });

  it("accepts a form within the budget, and does not count hidden fields", () => {
    expect(scanFieldBudget(form(fields(FORM_FIELD_BUDGET)))).toEqual([]);
    expect(
      scanFieldBudget(
        form(
          `${fields(FORM_FIELD_BUDGET)}\n      <Hidden name="id" />\n      <Hidden name="type" />`
        )
      )
    ).toEqual([]);
  });

  it("accepts a long form that is grouped or stepped", () => {
    const long = fields(FORM_FIELD_BUDGET + 6);
    expect(
      scanFieldBudget(
        form(`      <FormGroup title="What">\n${long}\n      </FormGroup>`)
      )
    ).toEqual([]);
    expect(
      scanFieldBudget(
        form(`      <FormStepPanel isCurrent>\n${long}\n      </FormStepPanel>`)
      )
    ).toEqual([]);
  });

  it("leaves files without a form, files outside the app UI and Properties panels alone", () => {
    expect(scanFieldBudget(fields(30))).toEqual([]);
    expect(
      scanFieldBudget(
        form(fields(30)),
        "packages/form/src/components/Input.tsx"
      )
    ).toEqual([]);
    expect(
      scanFieldBudget(
        form(fields(30)),
        "apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx"
      )
    ).toEqual([]);
  });
});

describe("no-default-on-effects", () => {
  it("flags .default() after a transform", () => {
    const src = `const v = z.string().transform(Number).default(5);`;
    const violations = noDefaultOnEffects.scan("a.ts", src);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
  });

  it("flags .default() on a z.preprocess pipe", () => {
    const src = `const v = z.preprocess((s) => String(s).trim(), z.string()).default(" padded ");`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(1);
  });

  it("flags .default() after refine and pipe across a multi-line chain", () => {
    const src = [
      "const v = z",
      "  .object({ a: z.string() })",
      "  .refine((d) => d.a.length > 0)",
      "  .default({ a: 'x' });",
      "const w = z.string().pipe(z.coerce.number()).default(1);"
    ].join("\n");
    const violations = noDefaultOnEffects.scan("a.ts", src);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.line)).toEqual([4, 5]);
  });

  it("allows .default() on plain schemas, records, and coercions", () => {
    const src = [
      `const a = z.string().default("x");`,
      `const b = z.record(z.string(), z.number().min(0)).default({});`,
      `const c = z.coerce.boolean().default(false);`,
      `const d = z.enum(values).default("Draft");`
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("allows .prefault() on effect-bearing schemas (that is the fix)", () => {
    const src = `const v = z.string().transform(Number).prefault("5");`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("does not cross into a previous statement's effects", () => {
    // The receiver walk stops at the statement boundary, so a transform in an
    // earlier statement never taints an innocent .default().
    const src = [
      `const other = z.string().transform(Number);`,
      `const v = z.string().default("x");`
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("stops at a block boundary instead of leaking a previous block", () => {
    const src = [
      "if (x) { register(z.string().transform(Number)); }",
      `return z.string().default("x");`
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("flags an inner-shape transform too — the default bypasses it as well", () => {
    // `.default({a: 1})` on this object returns the literal as-is; the shape's
    // transform never runs on it. That is the same v4 bypass, so it counts.
    const src = `const v = z.object({ a: z.string().transform(Number) }).default({ a: 1 });`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(1);
  });

  it("uses the trimmed .default line as the snippet", () => {
    const src = [
      "const v = z.string().transform(Number)",
      "  .default(5);"
    ].join("\n");
    const [violation] = noDefaultOnEffects.scan("a.ts", src);
    expect(violation?.snippet).toBe(".default(5);");
    expect(violation?.line).toBe(2);
  });
  it("ignores a chain written inside a string literal", () => {
    const src = `const msg = "use z.string().transform(f).default(1) instead";`;
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("ignores a chain written inside a comment", () => {
    const src = [
      "// z.string().transform(Number).default(5) is the bad shape",
      "/* also z.string().transform(Number).default(5) */",
      "const v = z.string();"
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(0);
  });

  it("still flags a violation when a comment sits between the effect and .default()", () => {
    // Regression: `receiverBefore` stops at `/`, so an unmasked comment here
    // hid the violation entirely — the silent direction.
    const src = [
      "const v = z.string().transform(Number)",
      "  // explain the default",
      "  .default(5);"
    ].join("\n");
    expect(noDefaultOnEffects.scan("a.ts", src)).toHaveLength(1);
  });

  it("reports the real line number despite a preceding block comment", () => {
    const src = [
      "/* a",
      "   multi-line",
      "   comment */",
      "const v = z.string().transform(Number).default(5);"
    ].join("\n");
    const [violation] = noDefaultOnEffects.scan("a.ts", src);
    expect(violation?.line).toBe(4);
  });
});

const scanRevalidator = (
  contents: string,
  file = "apps/erp/app/components/Documents.tsx"
) => noRawRevalidator.scan(file, contents);

describe("noRawRevalidator", () => {
  it("flags React Router's hook, alone or among other imports", () => {
    expect(
      scanRevalidator(`import { useRevalidator } from "react-router";\n`)
    ).toHaveLength(1);
    const violations = scanRevalidator(
      `import { z } from "zod";\nimport {\n  useFetcher,\n  useRevalidator\n} from "react-router";\n`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(2);
  });

  it("accepts the held one, and other react-router imports", () => {
    expect(
      scanRevalidator(
        `import { useRevalidator } from "@carbon/query";\nimport { useFetcher, useNavigate } from "react-router";\n`
      )
    ).toEqual([]);
  });

  it("lets the wrapper take React Router's", () => {
    expect(
      scanRevalidator(
        `import { useRevalidator as useRouterRevalidator } from "react-router";\n`,
        "packages/react/src/hooks/useRevalidator.ts"
      )
    ).toEqual([]);
  });
});

const scanLingui = (contents: string) =>
  linguiMacroMisuse.scan("apps/erp/app/x.tsx", contents).map((v) => v.line);

describe("linguiMacroMisuse", () => {
  it.each([
    ['import { t } from "@lingui/core/macro";'],
    ["import { msg, t } from '@lingui/core/macro';"],
    ["const label = i18n._(msg`Scrap`);"],
    ["const label = _( msg`Scrap`);"],
    ["const label = t(msg({ message: 'Scrap' }));"]
  ])("flags %s", (source) => {
    expect(scanLingui(source)).toEqual([1]);
  });

  it.each([
    ['import { msg } from "@lingui/core/macro";'],
    ['import { t, Trans, useLingui } from "@lingui/react/macro";'],
    ["const label = i18n._(descriptors[status]);"],
    ["const { t } = useLingui(); const label = t`Scrap`;"]
  ])("accepts %s", (source) => {
    expect(scanLingui(source)).toEqual([]);
  });
});

const scanSensorOptions = (contents: string) =>
  noInlineSensorOptions.scan(
    "apps/erp/app/modules/production/ui/Schedule/Kanban/Kanban.tsx",
    contents
  );

describe("noInlineSensorOptions", () => {
  it("flags an inline options object, on one line or several", () => {
    expect(
      scanSensorOptions(
        `const sensors = useSensors(\n  useSensor(PointerSensor, { activationConstraint: { distance: 8 } })\n);\n`
      )
    ).toHaveLength(1);
    const violations = scanSensorOptions(
      `const sensors = useSensors(\n  useSensor(MouseSensor),\n  useSensor(KeyboardSensor, {\n    coordinateGetter\n  })\n);\n`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(3);
  });

  it("accepts a sensor with no options or a module constant", () => {
    expect(
      scanSensorOptions(
        `const sensors = useSensors(\n  useSensor(MouseSensor),\n  useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)\n);\n`
      )
    ).toEqual([]);
  });
});

const PARTS_TABLE = LIST_TABLES.PARTS_LIST_COLUMNS as string;

const ID_PAGING = `{ defaultSorts: [{ column: "id", ascending: true }] }`;

// Each constant with an `X_PAGING` beside it; `paging` overrides its body.
const service = (
  constants: Record<string, string>,
  paging: Record<string, string> = {}
) => ({
  file: "apps/erp/app/modules/items/items.service.ts",
  contents: Object.entries(constants)
    .map(([name, list]) => {
      const pagingName = name.replace(/_LIST_COLUMNS$/, "_PAGING");
      const body = paging[pagingName] ?? ID_PAGING;
      return `const ${name} =\n  "${list}" as const;\nexport const ${pagingName}: Paging = ${body};`;
    })
    .join("\n")
});

const table = (body: string) => ({ file: PARTS_TABLE, contents: body });

// Every other mapped constant, defined and with an empty table, so a case
// only reports what it is about.
const others = () => {
  const rest = Object.entries(LIST_TABLES).filter(
    ([name]) => name !== "PARTS_LIST_COLUMNS"
  );
  return {
    services: [service(Object.fromEntries(rest.map(([name]) => [name, "id"])))],
    tables: rest.map(([, file]) => ({ file, contents: "" }))
  };
};

const snippets = (partsList: string | null, partsTable: string) => {
  const { services, tables } = others();
  const constants: Record<string, string> =
    partsList === null ? {} : { PARTS_LIST_COLUMNS: partsList };
  return findUnselectedListColumns(
    [...services, service(constants)],
    [...tables, table(partsTable)]
  ).map((v) => v.snippet);
};

describe("findUnselectedListColumns", () => {
  it("accepts a table whose accessorKeys are all selected", () => {
    expect(
      snippets(
        "id,name,customFields",
        `accessorKey: "id", accessorKey: "name", accessorKey: "customFields->>abc", useCustomColumns`
      )
    ).toEqual([]);
  });

  it("flags an accessorKey the select dropped", () => {
    expect(snippets("id", `accessorKey: "id", accessorKey: "mpn"`)).toEqual([
      "PARTS_LIST_COLUMNS lacks mpn"
    ]);
  });

  it("flags custom columns rendered without selecting customFields", () => {
    expect(snippets("id", `accessorKey: "id", useCustomColumns`)).toEqual([
      "PARTS_LIST_COLUMNS lacks customFields"
    ]);
  });

  it("flags a new list constant with no table mapped", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          service({ PARTS_LIST_COLUMNS: "id", KITS_LIST_COLUMNS: "id" })
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual(["KITS_LIST_COLUMNS"]);
  });

  it("flags a mapped constant that no service defines any more", () => {
    expect(snippets(null, "")).toEqual(["PARTS_LIST_COLUMNS"]);
  });

  it("flags a sort or id column of X_PAGING the select dropped", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          service(
            { PARTS_LIST_COLUMNS: "id,name" },
            {
              PARTS_PAGING: `{
                defaultSorts: [
                  { column: "createdAt", ascending: false },
                  { column: "name", foreignTable: "supplier", ascending: true }
                ],
                idColumn: "readableIdWithRevision"
              }`
            }
          )
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual([
      "PARTS_LIST_COLUMNS lacks cursor column createdAt",
      "PARTS_LIST_COLUMNS lacks cursor column readableIdWithRevision"
    ]);
  });

  it("flags a list constant with no X_PAGING beside it", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          {
            file: "apps/erp/app/modules/items/items.service.ts",
            contents: `const PARTS_LIST_COLUMNS = "id" as const;`
          }
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual(["PARTS_LIST_COLUMNS has no PARTS_PAGING"]);
  });

  it("checks a sort-only list for its cursor columns but not its table", () => {
    const { services, tables } = others();
    expect(
      findUnselectedListColumns(
        [
          ...services,
          service(
            { PARTS_LIST_COLUMNS: "id", FIXED_ASSETS_LIST_COLUMNS: "id" },
            {
              FIXED_ASSETS_PAGING: `{ defaultSorts: [{ column: "fixedAssetId", ascending: true }] }`
            }
          )
        ],
        [...tables, table("")]
      ).map((v) => v.snippet)
    ).toEqual(["FIXED_ASSETS_LIST_COLUMNS lacks cursor column fixedAssetId"]);
  });
});
