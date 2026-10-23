// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  DatePicker,
  Department,
  Employee,
  Hidden,
  Input,
  LaborCategory,
  Location,
  Select,
  Shift,
  Submit
} from "~/components/Form";
import { useSettings } from "~/hooks";
import { employeeJobValidator, flsaStatuses } from "../../people.models";

type PersonJobProps = {
  initialValues: z.infer<typeof employeeJobValidator>;
  /** The company logs project time: it has a labor category. */
  usesProjectTime: boolean;
};

/**
 * A person's job. The project time fields show once the company has a labor
 * category; FLSA Status and Officer only with DCAA timekeeping. A hidden one
 * still posts its saved value, so a save never clears it.
 */
const PersonJob = ({ initialValues, usesProjectTime }: PersonJobProps) => {
  const { t } = useLingui();
  const settings = useSettings();
  const isDcaa = settings.timekeepingControls === "DCAA";
  const checkbox = (value: boolean | undefined) => (value ? "on" : "");
  const flsaLabels: Record<(typeof flsaStatuses)[number], string> = {
    Exempt: t`Exempt`,
    "Non-Exempt": t`Non-Exempt`
  };
  const [location, setLocation] = useState<string | null>(
    initialValues.locationId ?? null
  );
  return (
    <ValidatedForm
      validator={employeeJobValidator}
      method="post"
      defaultValues={initialValues}
    >
      <Hidden name="intent" value="job" />
      {!usesProjectTime && (
        <>
          <Hidden
            name="laborCategoryId"
            value={initialValues.laborCategoryId ?? ""}
          />
          <Hidden
            name="timesheetRequired"
            value={checkbox(initialValues.timesheetRequired)}
          />
        </>
      )}
      {!isDcaa && (
        <>
          <Hidden name="flsaStatus" value={initialValues.flsaStatus ?? ""} />
          <Hidden name="isOfficer" value={checkbox(initialValues.isOfficer)} />
        </>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Job</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input name="title" label={t`Title`} />
            <DatePicker name="startDate" label={t`Start Date`} />
            <Location
              name="locationId"
              label={t`Location`}
              onChange={(l) => setLocation(l?.value ?? null)}
            />
            <Shift
              location={location ?? undefined}
              name="shiftId"
              label={t`Shift`}
            />
            <Department name="departmentId" label={t`Department`} />
            <Employee name="managerId" label={t`Manager`} />
            {usesProjectTime && (
              <LaborCategory
                name="laborCategoryId"
                label={t`Labor Category`}
                helperText={t`The default for time this person logs on projects`}
              />
            )}
            {isDcaa && (
              <Select
                name="flsaStatus"
                label={t`FLSA Status`}
                options={flsaStatuses.map((status) => ({
                  value: status,
                  label: flsaLabels[status]
                }))}
                helperText={t`An exempt employee's hours over the standard week dilute the cost of each hour`}
              />
            )}
            <CustomFormFields table="employeeJob" />
          </div>
          {(usesProjectTime || isDcaa) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {usesProjectTime && (
                <Boolean
                  name="timesheetRequired"
                  label={t`Timesheet Required`}
                  bordered={true}
                  description={t`On the Missing Time report`}
                />
              )}
              {isDcaa && (
                <Boolean
                  name="isOfficer"
                  bordered={true}
                  label={t`Officer`}
                  description={t`For Form 6765 Section E`}
                />
              )}
            </div>
          )}
          <div>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </div>
        </CardContent>
      </Card>
    </ValidatedForm>
  );
};

export default PersonJob;
