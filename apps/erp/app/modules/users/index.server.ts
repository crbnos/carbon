// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  addConsoleOperator,
  bulkUpdatePermissions,
  certifyItarEntity,
  certifyItarUser,
  createEmployeeType,
  createGroup,
  deactivateUsers,
  inviteCustomerContact,
  inviteEmployee,
  inviteSupplierContact,
  resendInvites,
  resetConsoleOperatorPin,
  revokeInvites,
  updateEmployeePermissions,
  updateEmployeeType,
  updateGroup
} from "./users.server";

/** The users module's operations, by entity. */
export const users = {
  employee: { invite: inviteEmployee, update: updateEmployeePermissions },
  customerAccount: { invite: inviteCustomerContact },
  supplierAccount: { invite: inviteSupplierContact },
  invite: { resend: resendInvites, revoke: revokeInvites },
  user: { deactivate: deactivateUsers },
  permissions: { bulkUpdate: bulkUpdatePermissions },
  employeeType: { create: createEmployeeType, update: updateEmployeeType },
  group: { create: createGroup, update: updateGroup },
  operator: { create: addConsoleOperator, resetPin: resetConsoleOperatorPin },
  itarCertification: {
    certifyEntity: certifyItarEntity,
    certifyUser: certifyItarUser
  }
};
