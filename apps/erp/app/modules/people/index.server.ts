// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addPersonTimeCardEntry,
  clockInPerson,
  clockInSelf,
  clockOutPerson,
  clockOutSelf,
  createShift,
  deletePersonTimeCardEntry,
  updatePersonJob,
  updatePersonTimeCardEntry,
  updateShift
} from "./people.server";

/** The people module's operations, by entity. */
export const people = {
  shift: { create: createShift, update: updateShift },
  job: { update: updatePersonJob },
  timecard: {
    clockIn: clockInPerson,
    clockOut: clockOutPerson,
    addEntry: addPersonTimeCardEntry,
    updateEntry: updatePersonTimeCardEntry,
    deleteEntry: deletePersonTimeCardEntry
  },
  ownTimecard: { clockIn: clockInSelf, clockOut: clockOutSelf }
};
