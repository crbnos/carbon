// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { CarbonEdition, isAuthProviderEnabled } from "@carbon/env";
import { Edition } from "@carbon/utils";

/**
 * The ONE flag for SAML SSO availability: Enterprise edition AND `sso` in
 * AUTH_PROVIDERS. Every SSO entry point checks this — the login button, the
 * settings screen/action, the public sso.check endpoint, and the callbacks'
 * SSO branch — and the connection lookups in this module self-gate on it, so
 * a Community/Cloud deployment behaves as if SSO does not exist even when an
 * operator has enabled GoTrue SAML.
 */
export function isSsoEnabled(): boolean {
  return CarbonEdition === Edition.Enterprise && isAuthProviderEnabled("sso");
}
