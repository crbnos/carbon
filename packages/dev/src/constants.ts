/** File names + paths used across the CLI. */
export const COMPOSE_DEV_FILE = "docker-compose.dev.yml";

/** Apps the CLI knows how to spawn through portless. */
export const APP_CHOICES = [
  { value: "erp", label: "ERP", hint: "main app" },
  { value: "mes", label: "MES", hint: "shop floor" }
] as const;
export type AppId = (typeof APP_CHOICES)[number]["value"];

/** Compose services that get registered as portless aliases (host TCP). */
export const ALIAS_SERVICES = ["api", "studio", "mail", "inngest"] as const;

/** Minimum portless version that supports bare invocation + package.json config. */
export const PORTLESS_MIN_VERSION = "0.11.0";

/** Hostname TLD portless serves under. */
export const TLD = "dev";
