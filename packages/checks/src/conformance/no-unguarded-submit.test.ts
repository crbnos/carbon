// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noUnguardedSubmit } from "./no-unguarded-submit";

const scan = (contents: string, file = "apps/erp/app/modules/x/ui/Y.tsx") =>
  noUnguardedSubmit.scan(file, contents);

describe("noUnguardedSubmit", () => {
  it("flags a bare submit button inside a fetcher.Form", () => {
    const found = scan(`
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
    expect(scan('<Button isDisabled={loading} type="submit">')).toHaveLength(1);
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
    ['<Button isDisabled={isSubmitting} type="submit">', "isSubmitting"]
  ])("accepts a guarded button (%s)", (tag) => {
    expect(scan(tag)).toHaveLength(0);
  });

  it("ignores buttons inside a ValidatedForm — the form refuses a re-entrant submit", () => {
    expect(
      scan(`
        <ValidatedForm validator={v} method="post">
          <Button type="submit">Save</Button>
        </ValidatedForm>
      `)
    ).toHaveLength(0);
  });

  it("flags a button after a ValidatedForm has closed", () => {
    expect(
      scan(`
        <ValidatedForm validator={v}><Button type="submit">A</Button></ValidatedForm>
        <fetcher.Form><Button type="submit">B</Button></fetcher.Form>
      `)
    ).toHaveLength(1);
  });

  it("handles a multi-line tag and a > inside an expression", () => {
    const found = scan(`
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
    expect(scan('<button type="submit">Log out</button>')).toHaveLength(1);
  });

  // A signal that only changes a tooltip disables nothing.
  it("rejects an in-flight signal on a prop that does not disable", () => {
    expect(
      scan('<Button title={isSubmitting ? "Saving" : "Save"} type="submit">')
    ).toHaveLength(1);
  });

  // A guard is routinely held in a local, so the scanner resolves one hop.
  it("resolves a guard held in a local variable", () => {
    expect(
      scan(`
        const busy = fetcher.state !== "idle";
        <Button isLoading={busy} type="submit">Go</Button>
      `)
    ).toHaveLength(0);
  });

  it("rejects a local that names no submit state", () => {
    expect(
      scan(`
        const [loading, setLoading] = useState(true);
        <Button isDisabled={loading} type="submit">Go</Button>
      `)
    ).toHaveLength(1);
  });

  it("rejects isLoading bound to a constant — it disables nothing", () => {
    expect(scan('<Button isLoading={false} type="submit">')).toHaveLength(1);
  });

  it("accepts a bare isLoading — always true, so always disabled", () => {
    expect(scan('<Button isLoading type="submit">')).toHaveLength(0);
  });

  it("requires isDisabled/disabled to name a submit state", () => {
    expect(
      scan('<Button isDisabled={isSubmitting} type="submit">')
    ).toHaveLength(0);
    expect(scan('<Button disabled={busy} type="submit">')).toHaveLength(1);
    expect(
      scan(
        '<Button isDisabled={!permissions.can("create", "sales")} type="submit">'
      )
    ).toHaveLength(1);
  });

  it("matches type at an attribute boundary, both quote styles", () => {
    expect(scan("<Button type='submit'>")).toHaveLength(1);
    expect(scan('<Button data-type="submit" type="button">')).toHaveLength(0);
  });

  it("does not let a ValidatedForm-prefixed component grant the exemption", () => {
    expect(
      scan(`
        <ValidatedFormProvider>
          <Button type="submit">Save</Button>
        </ValidatedFormProvider>
      `)
    ).toHaveLength(1);
  });

  it("ignores a non-submit button", () => {
    expect(scan("<Button onClick={go}>Go</Button>")).toHaveLength(0);
  });

  it("does not scan .ts files or the Submit component itself", () => {
    expect(scan('<Button type="submit">', "apps/erp/app/x.ts")).toHaveLength(0);
    expect(
      scan('<Button type="submit">', "packages/form/src/components/Submit.tsx")
    ).toHaveLength(0);
  });
});
