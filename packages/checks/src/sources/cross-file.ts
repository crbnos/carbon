// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";
import {
  DEPLOYMENT_ENV_FILES,
  type DeploymentEnvSources
} from "../conformance/deployments-set-required-env";
import {
  AUDIT_CONFIG_FILE,
  EVENT_FUNCTIONS_DIR
} from "../conformance/event-ignored-columns";
import {
  INTEGRATION_CONFIG_FILE,
  INTEGRATION_REGISTRY_FILE,
  INTEGRATIONS_DIR,
  type IntegrationRuleSources,
  RULES_DIR
} from "../conformance/integration-has-rule";
import { LIST_TABLES } from "../conformance/list-select-covers-columns";
import { SCHEDULED_WORK_CHECKS } from "../conformance/scheduled-sql-constants";
import { loadModules, modulesDir } from "./modules";

// The files the cross-file checks compare, read once here so each check
// stays a pure function of its inputs.

const read = (root: string, file: string): SourceFile => ({
  file,
  contents: readFileSync(join(root, file), "utf8")
});

const readIfPresent = (root: string, files: string[]): SourceFile[] =>
  files
    .filter((file) => existsSync(join(root, file)))
    .map((f) => read(root, f));

/** Every module's `<m>.service.ts`, and the list tables `LIST_TABLES` names. */
export function loadListSources(root: string) {
  return {
    services: readIfPresent(
      root,
      loadModules(modulesDir(root)).map(
        ({ name }) => `apps/erp/app/modules/${name}/${name}.service.ts`
      )
    ),
    tables: readIfPresent(root, Object.values(LIST_TABLES))
  };
}

/** Each integration descriptor: `packages/ee/src/<id>/config.ts(x)`. */
export function loadIntegrationConfigs(root: string): SourceFile[] {
  const dir = "packages/ee/src";
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name }) =>
      readIfPresent(root, [
        `${dir}/${name}/config.tsx`,
        `${dir}/${name}/config.ts`
      ])
    );
}

/**
 * Each `packages/ee/src/<dir>/` with a `config.tsx` / `config-*.tsx`, the
 * registry that lists them, and every `.claude/rules/*.md`.
 */
export function loadIntegrationRuleSources(
  root: string
): IntegrationRuleSources {
  const integrations = readdirSync(join(root, INTEGRATIONS_DIR), {
    withFileTypes: true
  })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => {
      const rel = `${INTEGRATIONS_DIR}/${name}`;
      const files = readdirSync(join(root, rel), { recursive: true })
        .map((file) => `${rel}/${String(file).split("\\").join("/")}`)
        .filter((file) => statSync(join(root, file)).isFile())
        .sort();
      const configs = readdirSync(join(root, rel))
        .filter((file) => INTEGRATION_CONFIG_FILE.test(file))
        .sort()
        .map((file) => read(root, `${rel}/${file}`));
      return { name, configs, files };
    })
    .filter((dir) => dir.configs.length > 0);
  const rulesDir = join(root, RULES_DIR);
  const rules = existsSync(rulesDir)
    ? readdirSync(rulesDir)
        .filter((file) => file.endsWith(".md"))
        .sort()
        .map((file) => read(root, `${RULES_DIR}/${file}`))
    : [];
  return {
    integrations,
    registry: read(root, INTEGRATION_REGISTRY_FILE),
    rules
  };
}

export function loadEventFunctionSources(root: string) {
  return {
    functions: readdirSync(join(root, EVENT_FUNCTIONS_DIR))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => read(root, `${EVENT_FUNCTIONS_DIR}/${file}`)),
    auditConfig: read(root, AUDIT_CONFIG_FILE)
  };
}

export function loadScheduledConstantSources(root: string): SourceFile[] {
  return readIfPresent(
    root,
    SCHEDULED_WORK_CHECKS.map(({ constants }) => constants)
  );
}

export function loadDeploymentEnvSources(root: string): DeploymentEnvSources {
  return Object.fromEntries(
    Object.entries(DEPLOYMENT_ENV_FILES).map(([key, file]) => [
      key,
      read(root, file)
    ])
  ) as DeploymentEnvSources;
}
