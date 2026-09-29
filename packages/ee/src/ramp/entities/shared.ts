/**
 * Ramp's thin layer over the shared spend push core.
 *
 * Everything Carbon-side — the push-only contract, the supplier/contact load,
 * the document loaders, the eligibility gates — lives in `../../spend`. What is
 * left here is the one thing a second platform would NOT share: reaching Ramp's
 * API client.
 */

import type { SpendPushOnlyEntitySyncer as SpendBase } from "../../spend/push-only-syncer";
import { SpendPushOnlyEntitySyncer } from "../../spend/push-only-syncer";
import type { RampClient } from "../lib/client";
import type { RampProvider } from "../lib/provider";

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
