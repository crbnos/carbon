import baseConfig from "@carbon/config/vitest";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(baseConfig, defineConfig({ test: {} }));
