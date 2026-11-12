// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Plugin, PluginOption } from "vite";

export function applyDotenvToProcessEnv(mode: string, appDir: string): void;
export function clientOnlyAlias(specifier: string, file: string): Plugin;
export function stackActivity(): Plugin;
export function iconImports(): Plugin;
export function datasetAssets(): Plugin;
export function dropStalledHmrClients(): Plugin;
export function assetModuleUrl(code: string): string | null;
export function listDatasetAssetFiles(
  directory: string
): Promise<string[] | null>;
export function inlineDatasetAssetGlob(
  code: string,
  entries: Iterable<[string, string]>
): string | null;
export function findIconImports(code: string): Map<string, Set<string>>;
export function rewriteIconImports(
  code: string,
  version: (set: string) => string
): string | null;
export function extractIcons(
  setSource: string,
  set: string,
  names: Iterable<string>
): string;
export function precompressedAssets(env: {
  command: "build" | "serve";
  mode: string;
}): Promise<Plugin[]>;
export function compressRemaining(directory: string): Promise<void>;

export function linguiWithoutIdQuery<T>(plugins: T[]): T[];

export type CarbonOptions = {
  /** What Vite hands the config function; needed for `precompress`. */
  command?: "build" | "serve";
  mode?: string;
  /** Trim react-aria's strings to the locales in the Lingui config. */
  locales?: boolean;
  /** Specifier → stub file, replaced in the browser build only. */
  clientOnly?: Record<string, string>;
  /** Split the production server build per package (see `splitServerByPackage`). */
  splitServer?: boolean;
  /** Write a Brotli `.br` beside each client asset (not on Vercel). */
  precompress?: boolean;
};

/** Every Carbon app's own Vite plugins; React Router and Tailwind stay separate. */
export function carbon(options?: CarbonOptions): Promise<PluginOption[]>;
export function splitServerByPackage(): Plugin;
