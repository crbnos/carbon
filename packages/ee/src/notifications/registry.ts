// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { NotificationService, NotificationServiceRegistry } from "./types";

class ServiceRegistry implements NotificationServiceRegistry {
  private services = new Map<string, NotificationService>();

  register(service: NotificationService): void {
    this.services.set(service.id, service);
  }

  getService(id: string): NotificationService | undefined {
    return this.services.get(id);
  }

  getAllServices(): NotificationService[] {
    return Array.from(this.services.values());
  }
}

export const notificationRegistry = new ServiceRegistry();
