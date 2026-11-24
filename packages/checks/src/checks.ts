// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Check } from "./check";
import {
  accountFkClassifiedCheck,
  accountFkRestrict
} from "./conformance/account-fk-restrict";
import { counterWriteRelativeCheck } from "./conformance/counter-write-relative";
import { deploymentsSetRequiredEnv } from "./conformance/deployments-set-required-env";
import { documentSequenceSynced } from "./conformance/document-sequence-synced";
import { edgeFunctionAuthorizesCaller } from "./conformance/edge-function-authorizes-caller";
import { eventIgnoredColumns } from "./conformance/event-ignored-columns";
import { formFieldBudget } from "./conformance/form-field-budget";
import { functionRedefinitionKeepsChanges } from "./conformance/function-redefinition-keeps-changes";
import { indexRedirectBeforeLoaders } from "./conformance/index-redirect-before-loaders";
import { journalStatusFilter } from "./conformance/journal-status-filter";
import { linguiMacroMisuse } from "./conformance/lingui-macro-misuse";
import { listSelectCoversColumns } from "./conformance/list-select-covers-columns";
import { loaderReadsThroughApiCheck } from "./conformance/loader-reads-through-api";
import { mesUnitWriteResolvesUnit } from "./conformance/mes-unit-write-resolves-unit";
import { migrationReplaySafe } from "./conformance/migration-replay-safe";
import { moduleShapeCheck } from "./conformance/module-shape";
import { movedTablesCovered } from "./conformance/moved-tables-covered";
import { noAuthzDdlInMigrationsCheck } from "./conformance/no-authz-ddl-in-migrations";
import { noBareOutlet } from "./conformance/no-bare-outlet";
import { noDbClientInService } from "./conformance/no-db-client-in-service";
import { noDefaultOnEffects } from "./conformance/no-default-on-effects";
import { noDerivedPercentColumn } from "./conformance/no-derived-percent-column";
import { noDiscardedQueryError } from "./conformance/no-discarded-query-error";
import { noDuplicatedAppFile } from "./conformance/no-duplicated-app-file";
import { noForeignKeyWithoutOnDelete } from "./conformance/no-foreign-key-without-on-delete";
import { noInlineFractionDigits } from "./conformance/no-inline-fraction-digits";
import { noInlineSensorOptions } from "./conformance/no-inline-sensor-options";
import { noInlineUniqueViolation } from "./conformance/no-inline-unique-violation";
import { noIntegrationIdBranching } from "./conformance/no-integration-id-branching";
import { noInterpolatedErrorLog } from "./conformance/no-interpolated-error-log";
import { noLegacyRls } from "./conformance/no-legacy-rls";
import { noLocalTimezone } from "./conformance/no-local-timezone";
import { noMissingAuditColumnCheck } from "./conformance/no-missing-audit-column";
import { noModulePermissionKey } from "./conformance/no-module-permission-key";
import { noNoopOpenChange } from "./conformance/no-noop-open-change";
import { noNumericPrecision } from "./conformance/no-numeric-precision";
import { noPostgresChanges } from "./conformance/no-postgres-changes";
import { noRawForwardedHeaders } from "./conformance/no-raw-forwarded-headers";
import { noRawOrSearch } from "./conformance/no-raw-or-search";
import { noRawRedirect } from "./conformance/no-raw-redirect";
import { noRawRevalidator } from "./conformance/no-raw-revalidator";
import { noRawRounding } from "./conformance/no-raw-rounding";
import { noRequiredColumnWithoutDefault } from "./conformance/no-required-column-without-default";
import { noServerCodeInClient } from "./conformance/no-server-code-in-client";
import { noSilentTestPassCheck } from "./conformance/no-silent-test-pass";
import { noStateCopyOfLoaderData } from "./conformance/no-state-copy-of-loader-data";
import { noUnguardedSubmit } from "./conformance/no-unguarded-submit";
import { noUnmountingDialog } from "./conformance/no-unmounting-dialog";
import { noUnroundedTrackedQuantity } from "./conformance/no-unrounded-tracked-quantity";
import { noUnscopedKyselyWrite } from "./conformance/no-unscoped-kysely-write";
import { noViewWithoutInvoker } from "./conformance/no-view-without-invoker";
import { noZeroConcurrency } from "./conformance/no-zero-concurrency";
import { offlinePageCacheBumped } from "./conformance/offline-page-cache-bumped";
import { providerRoleBackfilled } from "./conformance/provider-role-backfilled";
import { registryHelpersFresh } from "./conformance/registry-helpers-fresh";
import { routeActionShape } from "./conformance/route-action-shape";
import { routeGateNamesPageCheck } from "./conformance/route-gate-names-page";
import { routeMapsToPage } from "./conformance/route-maps-to-page";
import { scheduledSqlConstants } from "./conformance/scheduled-sql-constants";
import { serviceFnFile } from "./conformance/service-fn-file";
import { sideEffectImportDeclared } from "./conformance/side-effect-import-declared";
import { spdxLicenseHeader } from "./conformance/spdx-license-header";
import { stampMatchesColumns } from "./conformance/stamp-matches-columns";
import { statusWriteGuardedCheck } from "./conformance/status-write-guarded";
import { testMocksOwnModule } from "./conformance/test-mocks-own-module";
import { testReadsSource } from "./conformance/test-reads-source";

/** Every conformance check. Adding one is its file and its line here. */
export const CHECKS: Check[] = [
  accountFkClassifiedCheck,
  accountFkRestrict,
  counterWriteRelativeCheck,
  deploymentsSetRequiredEnv,
  documentSequenceSynced,
  edgeFunctionAuthorizesCaller,
  eventIgnoredColumns,
  formFieldBudget,
  functionRedefinitionKeepsChanges,
  indexRedirectBeforeLoaders,
  journalStatusFilter,
  linguiMacroMisuse,
  listSelectCoversColumns,
  loaderReadsThroughApiCheck,
  mesUnitWriteResolvesUnit,
  migrationReplaySafe,
  moduleShapeCheck,
  movedTablesCovered,
  noAuthzDdlInMigrationsCheck,
  noBareOutlet,
  noDbClientInService,
  noDefaultOnEffects,
  noDerivedPercentColumn,
  noDiscardedQueryError,
  noDuplicatedAppFile,
  noForeignKeyWithoutOnDelete,
  noInlineFractionDigits,
  noInlineSensorOptions,
  noInlineUniqueViolation,
  noIntegrationIdBranching,
  noInterpolatedErrorLog,
  noLegacyRls,
  noLocalTimezone,
  noMissingAuditColumnCheck,
  noModulePermissionKey,
  noNoopOpenChange,
  noNumericPrecision,
  noPostgresChanges,
  noRawForwardedHeaders,
  noRawOrSearch,
  noRawRedirect,
  noRawRevalidator,
  noRawRounding,
  noRequiredColumnWithoutDefault,
  noServerCodeInClient,
  noSilentTestPassCheck,
  noStateCopyOfLoaderData,
  noUnguardedSubmit,
  noUnmountingDialog,
  noUnroundedTrackedQuantity,
  noUnscopedKyselyWrite,
  noViewWithoutInvoker,
  noZeroConcurrency,
  offlinePageCacheBumped,
  providerRoleBackfilled,
  registryHelpersFresh,
  routeActionShape,
  routeGateNamesPageCheck,
  routeMapsToPage,
  scheduledSqlConstants,
  serviceFnFile,
  sideEffectImportDeclared,
  spdxLicenseHeader,
  stampMatchesColumns,
  statusWriteGuardedCheck,
  testMocksOwnModule,
  testReadsSource
];
