// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { Instance } from "./types";

/**
 * The linked-instance list, in SecureStore.
 *
 * Keys are flat and prefixed so everything belonging to one instance can be
 * removed together when it is unlinked. SecureStore caps a value at 2 KB; one
 * instance record (an address plus /me's instance block) fits comfortably,
 * which is why each is stored separately rather than as one array.
 */
const INDEX_KEY = "instances.index";
const CURRENT_KEY = "instances.current";
const instanceKey = (id: string) => `instance.${id}`;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  await SecureStore.setItemAsync(key, JSON.stringify(value));
}

export async function listInstances(): Promise<Instance[]> {
  const ids = (await readJson<string[]>(INDEX_KEY)) ?? [];
  const loaded = await Promise.all(
    ids.map((id) => readJson<Instance>(instanceKey(id)))
  );
  // Drop ids whose record is gone rather than surfacing a half-instance.
  return loaded.filter((i): i is Instance => i !== null);
}

export async function getCurrentInstanceId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CURRENT_KEY);
  } catch {
    return null;
  }
}

export async function setCurrentInstanceId(id: string | null) {
  if (id === null) {
    await SecureStore.deleteItemAsync(CURRENT_KEY);
    return;
  }
  await SecureStore.setItemAsync(CURRENT_KEY, id);
}

export async function addInstance(args: {
  serverUrl: string;
  scheme: "https" | "http";
}): Promise<Instance> {
  const existing = await listInstances();
  // Linking the same address twice is a mistake, not a second instance.
  const already = existing.find((i) => i.serverUrl === args.serverUrl);
  if (already) {
    await setCurrentInstanceId(already.id);
    return already;
  }

  const instance: Instance = {
    id: randomUUID(),
    serverUrl: args.serverUrl,
    scheme: args.scheme,
    linkedAt: new Date().toISOString(),
    details: null
  };

  await writeJson(instanceKey(instance.id), instance);
  await writeJson(INDEX_KEY, [...existing.map((i) => i.id), instance.id]);
  await setCurrentInstanceId(instance.id);
  return instance;
}

export async function saveInstance(instance: Instance) {
  await writeJson(instanceKey(instance.id), instance);
}

export async function removeInstance(id: string) {
  const remaining = (await listInstances()).filter((i) => i.id !== id);
  await writeJson(
    INDEX_KEY,
    remaining.map((i) => i.id)
  );
  await SecureStore.deleteItemAsync(instanceKey(id));

  const current = await getCurrentInstanceId();
  if (current === id) {
    await setCurrentInstanceId(remaining[0]?.id ?? null);
  }
}
