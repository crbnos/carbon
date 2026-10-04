// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Prepares a GLB for the native viewer: node NAMES become the assembler's
 * `extras.nodeId`, and every material is marked blendable.
 *
 * **Why this exists.** A step of an assembly instruction addresses the parts
 * it installs by `componentNodeIds`, and the assembler writes that id into
 * each glTF node's `extras.nodeId`. three.js surfaces extras as
 * `object.userData`, so the web player looks a component up directly — but a
 * renderer that can only find an entity BY NAME (Filament, which the native
 * app uses) cannot see extras at all.
 *
 * Names are not a usable substitute as authored: they come from the CAD
 * assembly, so they are human labels and they repeat. In the bicycle model
 * that ships with the demo data, 706 nodes carry only 626 distinct names and
 * the spoke `levyjarrupinna` appears 48 times. Looking a component up by its
 * authored name would therefore resolve the FIRST spoke for all 48 of them,
 * and every step that fits one would light up the wrong part — silently, and
 * only on the parts where it matters most.
 *
 * So the server hands the native client the same geometry with each node
 * named by its id. `extras` is left exactly as it was, which keeps the id
 * readable to a client that CAN see extras and keeps this transform
 * reversible; the authored label moves to `extras.authoredName` so a native
 * BOM can still show it.
 *
 * **Only the JSON chunk is rewritten.** A GLB is a header plus a JSON chunk
 * plus a binary chunk, and every accessor, buffer view and image lives in the
 * binary one. That chunk is copied through byte for byte, so this cannot
 * change the geometry — it re-lengths and re-pads the JSON chunk and nothing
 * else. That is also why it is cheap on a large model: the 45 MB bicycle is
 * about 45 MB of binary and a few hundred KB of JSON.
 */

import {
  MODEL_NODE_INSTANCE_SEPARATOR,
  modelNodeInstanceNames
} from "@carbon/mes-core";

// Re-exported so a caller holding a rewritten GLB has the naming rule to hand
// without also importing the wire contract.
export { MODEL_NODE_INSTANCE_SEPARATOR, modelNodeInstanceNames };

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
/** glTF 2.0 requires each chunk to start on a 4-byte boundary. */
const ALIGNMENT = 4;
/** JSON pads with spaces, binary with zeroes (glTF 2.0 §4.4.2). */
const JSON_PAD = 0x20;

const padTo = (length: number) =>
  (ALIGNMENT - (length % ALIGNMENT)) % ALIGNMENT;

export class NotAGlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAGlbError";
  }
}

type GlbNode = {
  name?: string;
  extras?: Record<string, unknown> | null;
};

type GlbMaterial = { alphaMode?: string };

/**
 * Returns the GLB with every node that carries an `extras.nodeId` renamed to
 * that id. Nodes without one keep the name they had, so a model from an older
 * conversion still loads — its components simply stay unaddressable, exactly
 * as they are today.
 *
 * Throws `NotAGlbError` when the bytes are not a GLB, rather than returning
 * them unchanged: serving a file the caller believes is renamed, but is not,
 * is the failure this function exists to prevent.
 */
export function renameGlbNodesToNodeIds(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) {
    throw new NotAGlbError("Too short to be a GLB");
  }
  if (view.getUint32(0, true) !== MAGIC) {
    throw new NotAGlbError("Not a GLB (bad magic)");
  }

  const jsonLength = view.getUint32(HEADER_BYTES, true);
  if (view.getUint32(HEADER_BYTES + 4, true) !== JSON_CHUNK) {
    throw new NotAGlbError("First GLB chunk is not JSON");
  }
  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES;
  const jsonEnd = jsonStart + jsonLength;
  if (jsonEnd > bytes.byteLength) {
    throw new NotAGlbError("GLB JSON chunk runs past the end of the file");
  }

  const gltf = JSON.parse(
    new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd))
  ) as { nodes?: GlbNode[]; materials?: GlbMaterial[] };

  let renamed = 0;
  // A nodeId is NOT unique on its own: identical geometry placed twice is two
  // nodes carrying the same id (the bicycle has 706 nodes and 696 ids), and
  // the graph calls those "every instance of this component". A renderer that
  // resolves a name to ONE entity would then light up the first instance and
  // leave its twin behind, so the later instances get a suffix and a client
  // walks `id`, `id#1`, `id#2`… until one does not resolve.
  const seen = new Map<string, number>();
  for (const node of gltf.nodes ?? []) {
    const nodeId = node.extras?.nodeId;
    if (typeof nodeId !== "string" || nodeId === "") continue;
    const nth = seen.get(nodeId) ?? 0;
    seen.set(nodeId, nth + 1);
    const name =
      nth === 0 ? nodeId : `${nodeId}${MODEL_NODE_INSTANCE_SEPARATOR}${nth}`;
    if (node.name === name) continue;
    // Keep the authored label reachable: it is what a parts list shows a
    // person, and the id means nothing to them.
    if (typeof node.name === "string") {
      node.extras = { ...node.extras, authoredName: node.name };
    }
    node.name = name;
    renamed++;
  }

  // Every material is marked blendable, so the viewer can SHOW a part
  // faintly. Filament compiles blending into the material, and gltfio builds
  // an opaque shader for `alphaMode: OPAQUE` — which every assembler output
  // is — so alpha is simply discarded at render time and an opacity call does
  // nothing at all, silently. Marking them BLEND is what makes the ghosted
  // not-yet-installed parts possible; it costs the renderer depth sorting it
  // would otherwise skip, and nothing visible while alpha stays 1.
  let blended = 0;
  for (const material of gltf.materials ?? []) {
    if (material.alphaMode === "BLEND") continue;
    material.alphaMode = "BLEND";
    blended++;
  }

  // Nothing to do — hand back the original bytes rather than re-encoding a
  // JSON chunk identically but not byte-identically.
  if (renamed === 0 && blended === 0) return bytes;

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = padTo(json.byteLength);
  const paddedJsonLength = json.byteLength + jsonPad;

  // Everything after the JSON chunk — the binary chunk and any extension
  // chunks — is carried across untouched.
  const rest = bytes.subarray(jsonEnd);
  const total =
    HEADER_BYTES + CHUNK_HEADER_BYTES + paddedJsonLength + rest.byteLength;

  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);

  outView.setUint32(0, MAGIC, true);
  outView.setUint32(4, view.getUint32(4, true), true); // version, as found
  outView.setUint32(8, total, true);
  outView.setUint32(HEADER_BYTES, paddedJsonLength, true);
  outView.setUint32(HEADER_BYTES + 4, JSON_CHUNK, true);
  out.set(json, jsonStart);
  out.fill(JSON_PAD, jsonStart + json.byteLength, jsonStart + paddedJsonLength);
  out.set(rest, jsonStart + paddedJsonLength);

  return out;
}
