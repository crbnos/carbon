// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Ramp's thin layer over the shared spend push core.
 *
 * Everything Carbon-side — the push-only contract, the supplier/contact load,
 * the document loaders, the eligibility gates — lives in `../../spend`. What is
 * left here is the one thing a second platform would NOT share: reaching Ramp's
 * API client.
 */

import type { Json } from "@carbon/database";
import type { SpendPushOnlyEntitySyncer as SpendBase } from "../../spend/push-only-syncer";
import { SpendPushOnlyEntitySyncer } from "../../spend/push-only-syncer";
import type { RampClient } from "../lib/client";
import type { RampProjectCodeSelection } from "../lib/coding";
import {
  type RampProjectCodeMapping,
  readProjectCode
} from "../lib/project-code";
import type { RampProvider } from "../lib/provider";

export function projectCodeSelection(
  mapping: RampProjectCodeMapping | undefined,
  source: "purchaseOrderField" | "purchaseInvoiceField",
  customFields: Json
): RampProjectCodeSelection | undefined {
  if (!mapping) return undefined;
  const code = readProjectCode(customFields, mapping[source]);
  if (!code) return undefined;
  return mapping.valueType === "text"
    ? { field_external_id: mapping.fieldExternalId, free_form_text: code }
    : {
        field_external_id: mapping.fieldExternalId,
        field_option_external_id: code
      };
}

export abstract class RampPushOnlyEntitySyncer<
  TLocal,
  TRemote,
  TOmit extends string | symbol | number
> extends SpendPushOnlyEntitySyncer<TLocal, TRemote, TOmit> {
  protected get spendPlatformLabel(): string {
    return "Ramp";
  }

  protected get rampProvider(): RampProvider {
    return this.provider as RampProvider;
  }

  protected get ramp(): RampClient {
    return this.rampProvider.client;
  }
}

export type { SpendBase };
