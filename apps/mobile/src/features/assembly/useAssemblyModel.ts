// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HEADERS } from "@carbon/mes-core";
import { useQuery } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
import { useAuth } from "~/lib/auth/AuthProvider";
import { keys } from "~/lib/query/keys";

/**
 * Puts the operation's 3D model on disk and returns a `file://` uri for it.
 *
 * **Why a download rather than a url.** Filament's `source` takes a bare
 * `{ uri }` and sends no headers with it, so it cannot authenticate; and the
 * screen read deliberately carries storage PATHS, never urls or bytes. So the
 * app fetches `GET /operations/:id/assembly/model` itself with the Bearer
 * token it already holds, writes the bytes into the cache directory, and
 * hands Filament a local file.
 *
 * That is also the right shape for a shop floor: a model is two to forty
 * megabytes and never changes once converted (a re-convert is a new
 * `modelUpload` row, hence a new storage path), so this is a once-per-model
 * cost and the file survives until iOS reclaims the cache. The cache key is
 * the storage path, so a re-converted model lands beside the old one rather
 * than being served stale.
 */

const DIR = "assembly-models";

/** A storage path flattened into one safe filename, keeping the extension. */
function cacheName(storagePath: string, extension: string) {
  const safe = storagePath.replace(/[^a-zA-Z0-9]+/g, "-").slice(-120);
  return `${safe}.${extension}`;
}

async function downloadOnce(
  url: string,
  headers: Record<string, string>,
  storagePath: string,
  extension: string
) {
  const dir = new Directory(Paths.cache, DIR);
  if (!dir.exists) dir.create({ intermediates: true });

  const file = new File(dir, cacheName(storagePath, extension));
  // Already downloaded: a converted artifact is immutable for the life of its
  // path, so there is nothing to revalidate.
  if (file.exists && file.size > 0) return file.uri;

  // `idempotent` so a half-written file from a killed download is replaced
  // rather than throwing for ever.
  const written = await File.downloadFileAsync(url, file, {
    headers,
    idempotent: true
  });
  return written.uri;
}

export type AssemblyModelFiles = {
  /** `file://` uri of the GLB, with nodes named by their nodeId. */
  glbUri: string;
  /** `file://` uri of the graph JSON. */
  graphUri: string;
};

export function useAssemblyModel({
  operationId,
  glbPath,
  graphPath,
  enabled = true
}: {
  operationId: string;
  /** From `assemblyPlayback`; only used as the cache key. */
  glbPath: string | null | undefined;
  graphPath: string | null | undefined;
  enabled?: boolean;
}) {
  const { serverUrl, companyId, instanceId, getAccessToken } = useAuth();
  const scope = {
    instanceId: instanceId ?? "unknown",
    companyId: companyId ?? ""
  };
  const ready = Boolean(
    enabled && serverUrl && companyId && glbPath && graphPath
  );

  return useQuery<AssemblyModelFiles>({
    queryKey: [...keys.assemblyModel(scope, operationId), glbPath, graphPath],
    enabled: ready,
    // The bytes are on disk; the query only resolves the path to them.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const token = getAccessToken();
      if (!token || !companyId || !serverUrl || !glbPath || !graphPath) {
        throw new Error("Not signed in");
      }
      const headers = {
        authorization: `Bearer ${token}`,
        [HEADERS.company]: companyId
      };
      const base = `${serverUrl}/api/v1/operations/${operationId}/assembly/model`;

      // Sequential, not parallel: the GLB is the large one and the graph is
      // worthless without it, so there is nothing to gain by racing them and
      // a slow link is kinder to one request at a time.
      const glbUri = await downloadOnce(
        `${base}?kind=glb`,
        headers,
        glbPath,
        "glb"
      );
      const graphUri = await downloadOnce(
        `${base}?kind=graph`,
        headers,
        graphPath,
        "json"
      );
      return { glbUri, graphUri };
    }
  });
}
