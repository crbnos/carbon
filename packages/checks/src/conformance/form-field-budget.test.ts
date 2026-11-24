// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { FORM_FIELD_BUDGET, formFieldBudget } from "./form-field-budget";

const FILE = "apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx";
const fields = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `      <Input name="field${index}" label="Field" />`
  ).join("\n");
const form = (body: string) =>
  `export function X() {\n  return (\n    <ValidatedForm validator={v}>\n${body}\n    </ValidatedForm>\n  );\n}\n`;
const scan = (contents: string, file = FILE) =>
  formFieldBudget.scan(file, contents);

describe("formFieldBudget", () => {
  it("flags a flat form over the budget, at its ValidatedForm", () => {
    const violations = scan(form(fields(FORM_FIELD_BUDGET + 1)));
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(3);
    expect(violations[0]!.snippet).toBe("<ValidatedForm>");
  });

  it("accepts a form within the budget, and does not count hidden fields", () => {
    expect(scan(form(fields(FORM_FIELD_BUDGET)))).toEqual([]);
    expect(
      scan(
        form(
          `${fields(FORM_FIELD_BUDGET)}\n      <Hidden name="id" />\n      <Hidden name="type" />`
        )
      )
    ).toEqual([]);
  });

  it("accepts a long form that is grouped or stepped", () => {
    const long = fields(FORM_FIELD_BUDGET + 6);
    expect(
      scan(form(`      <FormGroup title="What">\n${long}\n      </FormGroup>`))
    ).toEqual([]);
    expect(
      scan(
        form(`      <FormStepPanel isCurrent>\n${long}\n      </FormStepPanel>`)
      )
    ).toEqual([]);
  });

  it("leaves files without a form, files outside the app UI and Properties panels alone", () => {
    expect(scan(fields(30))).toEqual([]);
    expect(
      scan(form(fields(30)), "packages/form/src/components/Input.tsx")
    ).toEqual([]);
    expect(
      scan(
        form(fields(30)),
        "apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx"
      )
    ).toEqual([]);
  });

  it("flags the contract Add Line form from before f62fb04667, which put 16 fields in flat grids", () => {
    // apps/erp/app/modules/sales/ui/Contracts/ContractLineForm.tsx before
    // f62fb04667, trimmed to one line per field.
    const before = `<ValidatedForm validator={customerContractLineValidator} method="post">
  <ModalCardBody>
    <Hidden name="id" />
    <Hidden name="customerContractId" />
    <VStack spacing={4}>
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
        <Item name="itemId" label={t\`Service\`} type="Service" />
        <Select name="revenueType" label={t\`Revenue Type\`} options={revenueTypes} />
        <Input name="description" label={t\`Description\`} />
      </div>
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
        <Number name="quantity" label={t\`Quantity\`} minValue={0} />
        <Number name="rate" label={t\`Rate\`} minValue={0} />
        {revenueType === "Recurring" && (
          <Select name="rateUnit" label={t\`Per\`} options={rateUnits} />
        )}
        <Number name="discountPercent" label={t\`Discount (%)\`} minValue={0} />
        <DatePicker name="discountEndsOn" label={t\`Discount Ends On\`} />
        <Number name="taxPercent" label={t\`Tax (%)\`} minValue={0} />
      </div>
      <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3 border-t border-border pt-4">
        <DatePicker name="startDate" label={t\`Start Date\`} />
        <DatePicker name="endDate" label={t\`End Date\`} />
        <DatePicker name="goLiveDate" label={t\`Go-Live Date\`} />
        <ContractProject name="projectId" label={t\`Project\`} />
      </div>
      <div className={showRevenue ? "mt-4 grid w-full gap-x-8 gap-y-4" : "hidden"}>
        <Select name="revenueMethod" label={t\`Revenue Method\`} options={methods} />
        <DatePicker name="revenueStartDate" label={t\`Revenue Start\`} />
        <DatePicker name="revenueEndDate" label={t\`Revenue End\`} />
      </div>
    </VStack>
  </ModalCardBody>
</ValidatedForm>`;
    const violations = scan(before);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("renders 16 fields");
    // The fix put the fields in titled FormGroups.
    expect(
      scan(before.replace("<VStack spacing={4}>", '<FormGroup title="What">'))
    ).toEqual([]);
  });
});
