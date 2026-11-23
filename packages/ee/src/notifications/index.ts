// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { notificationRegistry } from "./registry";
import { SlackNotificationService } from "./services/slack";

notificationRegistry.register(new SlackNotificationService());

export * from "./pipeline";
export * from "./registry";
export * from "./types";
export { SlackNotificationService };
