// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isStorageNotFound, isUnsafeStoragePath, storage } from "@carbon/files";
import { NotAGlbError, renameGlbNodesToNodeIds } from "@carbon/files/cad";
import { getLogger } from "@carbon/logger";
import {
  getAssemblyPlaybackByOperationId,
  getJobOperationForCompany
} from "~/services/operations.service";
import { apiRoute } from "./lib/route.server";

const log = getLogger("mes", "assembly-model");

/**
 * The assembly instruction's 3D artifacts: `?kind=glb` is the model,
 * `?kind=graph` is its node graph.
 *
 * **Why bytes rather than a url.** `GET /operations/:id/assembly` carries
 * `assemblyPlayback.glbPath` / `graphPath` as STORAGE PATHS, by the rule that
 * the wire never carries urls or bytes. The web player turns a path into
 * `/file/preview/...`, which authenticates by cookie — a native client has
 * none. Signing a storage url instead would need the device to hold storage
 * credentials and would put a capability url on the wire. So the app asks
 * this endpoint with the Bearer token it already has, and the bytes come back
 * through the same gate as the screen read.
 *
 * The native viewer downloads both once per model into its own cache and
 * hands Filament a local file, so this is a cold-start cost, not a per-frame
 * one. That is also why the response is `immutable`: an artifact is written
 * once per conversion and a new conversion is a new `modelUpload` row.
 *
 * Gated like the screen read it belongs to — an employee of the company —
 * because it is the same instruction the operator is already being shown.
 */
const KINDS = {
  glb: {
    pick: (p: { glbPath: string }) => p.glbPath,
    contentType: "model/gltf-binary"
  },
  graph: {
    pick: (p: { graphPath: string }) => p.graphPath,
    contentType: "application/json"
  }
} as const;

type Kind = keyof typeof KINDS;

const isKind = (value: string): value is Kind => value in KINDS;

export const loader = apiRoute(
  { method: "GET" },
  async ({ request, params, user }) => {
    if (!user) {
      throw new Error(
        "unreachable: /operations/:id/assembly/model is not public"
      );
    }

    const operationId = params.id;
    if (!operationId) {
      throw new ApiError(400, "validation_failed", "No operation was given");
    }

    const kindParam = new URL(request.url).searchParams.get("kind") ?? "glb";
    if (!isKind(kindParam)) {
      throw new ApiError(400, "validation_failed", "kind must be glb or graph");
    }
    const kind = KINDS[kindParam];

    const serviceRole = await getCarbonServiceRole();

    // The operation id comes from the URL, so this scoped read is the tenant
    // boundary: the playback lookup below runs with the service role and
    // would otherwise resolve any company's instruction.
    const operation = await getJobOperationForCompany(
      serviceRole,
      operationId,
      user.companyId
    );
    if (operation.error || !operation.data) {
      throw new ApiError(404, "not_found", "Operation not found");
    }

    const playback = await getAssemblyPlaybackByOperationId(
      serviceRole,
      operationId
    );
    if (!playback) {
      throw new ApiError(404, "not_found", "This operation has no 3D model");
    }

    const key = kind.pick(playback);

    // A dataset template's artifacts are the same bundled demo content for
    // every tenant and carry no company data, so they are allowed through by
    // name. Everything else must sit inside this company's own prefix:
    // `companyId` has to be a whole segment, since a loose `includes` would
    // admit `<otherCo>/…/<thisCo>/model.glb`.
    const isTemplate = key.startsWith("_templates/");
    const owned =
      key.startsWith(`${user.companyId}/`) ||
      key.includes(`/${user.companyId}/`);
    if (isUnsafeStoragePath(key) || !(isTemplate || owned)) {
      log.warn("Refused an assembly model path outside its company", {
        companyId: user.companyId,
        operationId,
        kind: kindParam
      });
      throw new ApiError(404, "not_found", "This operation has no 3D model");
    }

    const file = await storage(serviceRole)
      .company(user.companyId)
      .download(key);
    if (file.error || !file.data) {
      if (await isStorageNotFound(file.error)) {
        throw new ApiError(404, "not_found", "The model file is missing");
      }
      log.error("Could not read an assembly model artifact", {
        companyId: user.companyId,
        operationId,
        kind: kindParam,
        error: file.error
      });
      throw new ApiError(500, "internal", "Could not read the model");
    }

    // Widened because the rewrite below returns a freshly allocated view.
    let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(
      await file.data.arrayBuffer()
    );

    if (kindParam === "glb") {
      // Filament can only find an entity BY NAME, and the authored CAD names
      // repeat — 48 spokes share one in the demo bicycle — so a step would
      // address the wrong part. The ids the steps actually use live in each
      // node's `extras`, which Filament cannot see, so they are moved onto the
      // names here. Geometry is untouched (see `renameGlbNodesToNodeIds`), and
      // on the 43 MB bicycle this costs about 13 ms.
      try {
        bytes = renameGlbNodesToNodeIds(bytes);
      } catch (error) {
        if (!(error instanceof NotAGlbError)) throw error;
        // Serving it unrenamed would look fine and silently address the wrong
        // components, which is worse than refusing.
        log.error("Assembly model artifact is not a GLB", {
          companyId: user.companyId,
          operationId,
          error
        });
        throw new ApiError(500, "internal", "The model file is not readable");
      }
    }

    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": kind.contentType,
        "Content-Length": String(bytes.byteLength),
        // Conversion artifacts are written once and never rewritten — a
        // re-convert makes a new `modelUpload` row — so this is immutable for
        // as long as the path is. `private`: it is one company's geometry.
        "Cache-Control": "private, max-age=86400, immutable"
      }
    });
  }
);
