// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { z } from "zod";
import type { employeeJobValidator } from "./people.models";

type EmployeeJob = z.infer<typeof employeeJobValidator>;

/**
 * The job fields the Job form posts without showing, each with its saved value
 * so a save never clears it. A flag posts "on" only when it is on, because
 * `zfd.checkbox()` refuses "" and an absent flag reads as off.
 */
export function employeeJobHiddenFields(
  job: Pick<
    EmployeeJob,
    "laborCategoryId" | "timesheetRequired" | "flsaStatus" | "isOfficer"
  >,
  shown: { projectTime: boolean; dcaa: boolean }
): Partial<Record<keyof EmployeeJob, string>> {
  return {
    ...(!shown.projectTime && {
      laborCategoryId: job.laborCategoryId ?? "",
      ...(job.timesheetRequired && { timesheetRequired: "on" })
    }),
    ...(!shown.dcaa && {
      flsaStatus: job.flsaStatus ?? "",
      ...(job.isOfficer && { isOfficer: "on" })
    })
  };
}
