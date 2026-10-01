// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

export {
  addSsoDomain,
  deactivateSsoConnection,
  getSsoAwareInviteLink,
  getSsoConnection,
  getSsoConnectionByDomain,
  getSsoConnectionByProviderId,
  getSsoDomains,
  isSsoRequiredForEmail,
  removeSsoDomain,
  updateSsoRequireSso,
  upsertSsoConnection,
  verifySsoDomain
} from "./connections.server";
export { isSsoEnabled } from "./gate";
export {
  createGoTrueSsoProvider,
  deleteGoTrueSsoProvider,
  getGoTrueSsoProvider,
  getSamlSpUrls,
  updateGoTrueSsoProvider
} from "./provider.server";
export {
  backfillSsoIdentitiesForDomain,
  buildArchivedEmail,
  deleteJitSsoUser,
  emailDomain,
  linkSsoIdentityToUser,
  mergeInvitePermissions,
  migrateUserToSso,
  removeSsoIdentitiesForDomain,
  seedSsoIdentityForUser,
  ssoProviderColumn,
  uncoveredSsoDomainError
} from "./provisioning.server";
export {
  getSsoProviderIdFromSession,
  getSsoProviderIdFromUser
} from "./session.server";
export {
  checkDomainVerification,
  generateVerificationToken,
  getTxtRecord,
  TXT_HOST_PREFIX,
  TXT_VALUE_PREFIX
} from "./verification.server";
