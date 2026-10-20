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
  StorageUnit,
  Submit
} from "~/components/Form";
import { useSettings } from "~/hooks";
import { useGovernmentContracting } from "~/modules/projects/ui/useGovernmentContracting";
import { employeeJobValidator, flsaStatuses } from "../../people.models";

type PersonJobProps = {
  initialValues: z.infer<typeof employeeJobValidator>;
  /** The company logs project time: it has a labor category. */
  usesProjectTime: boolean;
  /** The company runs field service: it has a service order. */
  usesFieldService: boolean;
};

/**
 * A person's job. The fields of project time, government contracting and
 * field service show only once the company uses them; a hidden one still
 * posts its saved value, so a save never clears it.
 */
const PersonJob = ({
  initialValues,
  usesProjectTime,
  usesFieldService
}: PersonJobProps) => {
  const { t } = useLingui();
  const settings = useSettings();
  const isDcaa = settings.timekeepingControls === "DCAA";
  const isGovernmentContracting = useGovernmentContracting();
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
            {usesProjectTime ? (
              <>
                <LaborCategory
                  name="laborCategoryId"
                  label={t`Labor Category`}
                  helperText={t`The default for time this person logs on projects`}
                />
                <Boolean
                  name="timesheetRequired"
                  label={t`Timesheet Required`}
                  description={t`On the Missing Time report`}
                />
              </>
            ) : (
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
            {isDcaa ? (
              <Select
                name="flsaStatus"
                label={t`FLSA Status`}
                options={flsaStatuses.map((status) => ({
                  value: status,
                  label: flsaLabels[status]
                }))}
                helperText={t`An exempt employee's hours over the standard week dilute the cost of each hour`}
              />
            ) : (
              <Hidden
                name="flsaStatus"
                value={initialValues.flsaStatus ?? ""}
              />
            )}
            {isGovernmentContracting ? (
              <Boolean
                name="isOfficer"
                label={t`Officer`}
                description={t`For Form 6765 Section E`}
              />
            ) : (
              <Hidden
                name="isOfficer"
                value={checkbox(initialValues.isOfficer)}
              />
            )}
            {usesFieldService ? (
              <StorageUnit
                name="defaultStorageUnitId"
                label={t`Van`}
                helperText={t`Where this person's service parts are issued from first`}
                locationId={location}
                isOptional
              />
            ) : (
              <Hidden
                name="defaultStorageUnitId"
                value={initialValues.defaultStorageUnitId ?? ""}
              />
            )}
            <Hidden name="intent" value="job" />
            <CustomFormFields table="employeeJob" />
          </div>
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
