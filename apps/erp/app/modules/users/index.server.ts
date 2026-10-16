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
import {
  deleteGroupTool,
  getConsoleOperatorsTool,
  getCustomersTool,
  getEmployeesTool,
  getEmployeeTool,
  getEmployeeTypesTool,
  getEmployeeTypeTool,
  getGroupEmailsTool,
  getGroupMembersTool,
  getGroupsTool,
  getGroupTool,
  getInvitableTool,
  getItarCertificationReportTool,
  getItarCertificationStatusTool,
  getItarEntityCertificationTool,
  getModulesTool,
  getPermissionsByEmployeeTypeTool,
  getSuppliersTool,
  getUnrevokedInviteEmailsTool,
  getUserSelectGroupMembersTool,
  getUserSelectGroupsTool,
  getUsersWithVerifiedMfaTool,
  resolveUserSelectIdsTool,
  searchUsersForSelectTool
} from "./users.tools.server";

/** The users module's operations, by entity. */
export const users = {
  employee: {
    invite: inviteEmployee,
    update: updateEmployeePermissions,
    get: getEmployeeTool
  },
  customerAccount: { invite: inviteCustomerContact },
  supplierAccount: { invite: inviteSupplierContact },
  invite: { resend: resendInvites, revoke: revokeInvites },
  user: { deactivate: deactivateUsers },
  permissions: { bulkUpdate: bulkUpdatePermissions },
  employeeType: {
    create: createEmployeeType,
    update: updateEmployeeType,
    get: getEmployeeTypeTool
  },
  group: {
    create: createGroup,
    update: updateGroup,
    delete: deleteGroupTool,
    get: getGroupTool
  },
  operator: { create: addConsoleOperator, resetPin: resetConsoleOperatorPin },
  itarCertification: {
    certifyEntity: certifyItarEntity,
    certifyUser: certifyItarUser
  },
  itarCertificationStatus: {
    get: getItarCertificationStatusTool
  },
  itarEntityCertification: {
    get: getItarEntityCertificationTool
  },
  itarCertificationReport: {
    get: getItarCertificationReportTool
  },
  customers: {
    get: getCustomersTool
  },
  unrevokedInviteEmails: {
    get: getUnrevokedInviteEmailsTool
  },
  usersWithVerifiedMfa: {
    get: getUsersWithVerifiedMfaTool
  },
  employees: {
    get: getEmployeesTool
  },
  consoleOperators: {
    get: getConsoleOperatorsTool
  },
  employeeTypes: {
    get: getEmployeeTypesTool
  },
  invitable: {
    get: getInvitableTool
  },
  modules: {
    get: getModulesTool
  },
  groupMembers: {
    get: getGroupMembersTool
  },
  groups: {
    get: getGroupsTool
  },
  groupEmails: {
    get: getGroupEmailsTool
  },
  userSelectGroups: {
    get: getUserSelectGroupsTool
  },
  userSelectGroupMembers: {
    get: getUserSelectGroupMembersTool
  },
  usersForSelect: {
    search: searchUsersForSelectTool
  },
  userSelectIds: {
    resolve: resolveUserSelectIdsTool
  },
  permissionsByEmployeeType: {
    get: getPermissionsByEmployeeTypeTool
  },
  suppliers: {
    get: getSuppliersTool
  }
};
