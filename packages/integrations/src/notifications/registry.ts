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