// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { formFieldBudget } from "./form-field-budget";

// The budget the check states in its description.
const FORM_FIELD_BUDGET = 14;

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
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.snippet).toBe("<ValidatedForm>");
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
