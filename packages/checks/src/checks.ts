// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Check } from "./check";
import { accountFkClassified } from "./conformance/accounting/account-fk-classified";
import { accountFkRestrict } from "./conformance/accounting/account-fk-restrict";
import { journalStatusFilter } from "./conformance/accounting/journal-status-filter";
import { edgeFunctionAuthorizesCaller } from "./conformance/authz/edge-function-authorizes-caller";
import { movedTablesCovered } from "./conformance/authz/moved-tables-covered";
import { noAuthzDdlInMigrations } from "./conformance/authz/no-authz-ddl-in-migrations";
import { noLegacyRls } from "./conformance/authz/no-legacy-rls";
import { noModulePermissionKey } from "./conformance/authz/no-module-permission-key";
import { registryHelpersFresh } from "./conformance/authz/registry-helpers-fresh";
import { routeGateNamesPage } from "./conformance/authz/route-gate-names-page";
import { routeMapsToPage } from "./conformance/authz/route-maps-to-page";
import { counterWriteRelative } from "./conformance/data-access/counter-write-relative";
import { mesUnitWriteResolvesUnit } from "./conformance/data-access/mes-unit-write-resolves-unit";
import { noDbClientInService } from "./conformance/data-access/no-db-client-in-service";
import { noDiscardedQueryError } from "./conformance/data-access/no-discarded-query-error";
import { noInlineUniqueViolation } from "./conformance/data-access/no-inline-unique-violation";
import { noMissingAuditColumn } from "./conformance/data-access/no-missing-audit-column";
import { noPostgresChanges } from "./conformance/data-access/no-postgres-changes";
import { noRawOrSearch } from "./conformance/data-access/no-raw-or-search";
import { noUnscopedKyselyWrite } from "./conformance/data-access/no-unscoped-kysely-write";
import { stampMatchesColumns } from "./conformance/data-access/stamp-matches-columns";
import { statusWriteGuarded } from "./conformance/data-access/status-write-guarded";
import { deploymentsSetRequiredEnv } from "./conformance/drift/deployments-set-required-env";
import { documentSequenceSynced } from "./conformance/drift/document-sequence-synced";
import { eventIgnoredColumns } from "./conformance/drift/event-ignored-columns";
import { offlinePageCacheBumped } from "./conformance/drift/offline-page-cache-bumped";
import { providerRoleBackfilled } from "./conformance/drift/provider-role-backfilled";
import { scheduledSqlConstants } from "./conformance/drift/scheduled-sql-constants";
import { spdxLicenseHeader } from "./conformance/licensing/spdx-license-header";
import { functionRedefinitionKeepsChanges } from "./conformance/migrations/function-redefinition-keeps-changes";
import { migrationReplaySafe } from "./conformance/migrations/migration-replay-safe";
import { noDerivedPercentColumn } from "./conformance/migrations/no-derived-percent-column";
import { noForeignKeyWithoutOnDelete } from "./conformance/migrations/no-foreign-key-without-on-delete";
import { noNumericPrecision } from "./conformance/migrations/no-numeric-precision";
import { noRequiredColumnWithoutDefault } from "./conformance/migrations/no-required-column-without-default";
import { noViewWithoutInvoker } from "./conformance/migrations/no-view-without-invoker";
import { moduleShape } from "./conformance/modules/module-shape";
import { noDuplicatedAppFile } from "./conformance/modules/no-duplicated-app-file";
import { noServerCodeInClient } from "./conformance/modules/no-server-code-in-client";
import { serviceFnFile } from "./conformance/modules/service-fn-file";
import { sideEffectImportDeclared } from "./conformance/modules/side-effect-import-declared";
import { noInlineFractionDigits } from "./conformance/numbers/no-inline-fraction-digits";
import { noRawRounding } from "./conformance/numbers/no-raw-rounding";
import { noUnroundedTrackedQuantity } from "./conformance/numbers/no-unrounded-tracked-quantity";
import { indexRedirectBeforeLoaders } from "./conformance/routes/index-redirect-before-loaders";
import { loaderReadsThroughApi } from "./conformance/routes/loader-reads-through-api";
import { noBareOutlet } from "./conformance/routes/no-bare-outlet";
import { noStateCopyOfLoaderData } from "./conformance/routes/no-state-copy-of-loader-data";
import { routeActionShape } from "./conformance/routes/route-action-shape";
import { noIntegrationIdBranching } from "./conformance/server/no-integration-id-branching";
import { noInterpolatedErrorLog } from "./conformance/server/no-interpolated-error-log";
import { noLocalTimezone } from "./conformance/server/no-local-timezone";
import { noRawForwardedHeaders } from "./conformance/server/no-raw-forwarded-headers";
import { noRawRedirect } from "./conformance/server/no-raw-redirect";
import { noZeroConcurrency } from "./conformance/server/no-zero-concurrency";
import { noSilentTestPass } from "./conformance/tests/no-silent-test-pass";
import { testMocksOwnModule } from "./conformance/tests/test-mocks-own-module";
import { testReadsSource } from "./conformance/tests/test-reads-source";
import { formFieldBudget } from "./conformance/ui/form-field-budget";
import { linguiMacroMisuse } from "./conformance/ui/lingui-macro-misuse";
import { listSelectCoversColumns } from "./conformance/ui/list-select-covers-columns";
import { noDefaultOnEffects } from "./conformance/ui/no-default-on-effects";
import { noInlineSensorOptions } from "./conformance/ui/no-inline-sensor-options";
import { noNoopOpenChange } from "./conformance/ui/no-noop-open-change";
import { noRawRevalidator } from "./conformance/ui/no-raw-revalidator";
import { noUnguardedSubmit } from "./conformance/ui/no-unguarded-submit";
import { noUnmountingDialog } from "./conformance/ui/no-unmounting-dialog";

/** Every conformance check, by subject. A new check is one import and one line here. */
export const CHECKS: Check[] = [
  accountFkRestrict,
  accountFkClassified,
  journalStatusFilter,
  edgeFunctionAuthorizesCaller,
  registryHelpersFresh,
  noAuthzDdlInMigrations,
  noLegacyRls,
  noModulePermissionKey,
  movedTablesCovered,
  routeMapsToPage,
  routeGateNamesPage,
  noInlineUniqueViolation,
  noRawOrSearch,
  noPostgresChanges,
  noDbClientInService,
  noUnscopedKyselyWrite,
  noMissingAuditColumn,
  stampMatchesColumns,
  noDiscardedQueryError,
  mesUnitWriteResolvesUnit,
  statusWriteGuarded,
  counterWriteRelative,
  eventIgnoredColumns,
  providerRoleBackfilled,
  scheduledSqlConstants,
  documentSequenceSynced,
  deploymentsSetRequiredEnv,
  offlinePageCacheBumped,
  spdxLicenseHeader,
  noNumericPrecision,
  noDerivedPercentColumn,
  noRequiredColumnWithoutDefault,
  noForeignKeyWithoutOnDelete,
  noViewWithoutInvoker,
  functionRedefinitionKeepsChanges,
  migrationReplaySafe,
  moduleShape,
  serviceFnFile,
  noDuplicatedAppFile,
  noServerCodeInClient,
  sideEffectImportDeclared,
  noRawRounding,
  noInlineFractionDigits,
  noUnroundedTrackedQuantity,
  routeActionShape,
  indexRedirectBeforeLoaders,
  noStateCopyOfLoaderData,
  loaderReadsThroughApi,
  noBareOutlet,
  noRawRedirect,
  noRawForwardedHeaders,
  noInterpolatedErrorLog,
  noZeroConcurrency,
  noLocalTimezone,
  noIntegrationIdBranching,
  testMocksOwnModule,
  testReadsSource,
  noSilentTestPass,
  noNoopOpenChange,
  noUnmountingDialog,
  noUnguardedSubmit,
  formFieldBudget,
  noDefaultOnEffects,
  noRawRevalidator,
  linguiMacroMisuse,
  noInlineSensorOptions,
  listSelectCoversColumns
];
