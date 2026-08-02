import { configureSync, reset } from "@logtape/logtape";
import { createLogRecorder } from "@logtape/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SYNC_CONFIG } from "./models";
import { resolveSyncConfig } from "./service";

const recorder = createLogRecorder();

describe("resolveSyncConfig", () => {
  beforeEach(() => {
    recorder.clear();
    configureSync({
      reset: true,
      sinks: { recorder: recorder.sink },
      loggers: [
        { category: ["carbon"], lowestLevel: "trace", sinks: ["recorder"] }
      ]
    });
  });

  afterEach(async () => {
    await reset();
  });

  it("returns the defaults when no config is stored", () => {
    expect(resolveSyncConfig(undefined)).toEqual(DEFAULT_SYNC_CONFIG);
    expect(resolveSyncConfig(null)).toEqual(DEFAULT_SYNC_CONFIG);
    expect(resolveSyncConfig({})).toEqual(DEFAULT_SYNC_CONFIG);
    expect(resolveSyncConfig({ syncConfig: {} })).toEqual(DEFAULT_SYNC_CONFIG);

    // Never hands back (or mutates) the shared default object
    const resolved = resolveSyncConfig(undefined);
    expect(resolved).not.toBe(DEFAULT_SYNC_CONFIG);
    expect(resolved.entities.item).not.toBe(DEFAULT_SYNC_CONFIG.entities.item);
  });

  it("merges stored per-entity overrides over the defaults", () => {
    const resolved = resolveSyncConfig({
      syncConfig: { entities: { item: { enabled: false } } }
    });

    expect(resolved.entities.item).toEqual({
      ...DEFAULT_SYNC_CONFIG.entities.item,
      enabled: false
    });

    // Every other entity keeps its default config
    for (const entityType of Object.keys(DEFAULT_SYNC_CONFIG.entities) as Array<
      keyof typeof DEFAULT_SYNC_CONFIG.entities
    >) {
      if (entityType === "item") continue;
      expect(resolved.entities[entityType]).toEqual(
        DEFAULT_SYNC_CONFIG.entities[entityType]
      );
    }
  });

  it("ignores invalid fragments with a warning and keeps the default", () => {
    const resolved = resolveSyncConfig({
      syncConfig: {
        entities: {
          customer: { direction: "sideways" },
          item: { enabled: false }
        }
      }
    });

    // Invalid fragment → default kept, warning logged
    expect(resolved.entities.customer).toEqual(
      DEFAULT_SYNC_CONFIG.entities.customer
    );
    const warnings = recorder.records.filter((r) => r.level === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message.join("")).toContain(
      "Ignoring invalid stored sync config"
    );

    // Valid fragment in the same config still applies
    expect(resolved.entities.item.enabled).toBe(false);
  });

  it("ignores unknown keys in stored fragments", () => {
    const resolved = resolveSyncConfig({
      syncConfig: {
        entities: {
          item: { enabled: false, batchSize: 500, direction: "two-way" }
        }
      }
    });

    expect(resolved.entities.item).toEqual({
      ...DEFAULT_SYNC_CONFIG.entities.item,
      enabled: false,
      direction: "two-way"
    });
    expect("batchSize" in resolved.entities.item).toBe(false);
  });
});
