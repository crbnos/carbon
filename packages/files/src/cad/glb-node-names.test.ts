// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { modelNodeInstanceNames } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import { NotAGlbError, renameGlbNodesToNodeIds } from "./glb-node-names";

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** Builds a minimal but structurally valid GLB around the given glTF JSON. */
function makeGlb(gltf: unknown, bin: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.byteLength % 4)) % 4;
  const binPad = (4 - (bin.byteLength % 4)) % 4;
  const total =
    12 + 8 + json.byteLength + jsonPad + 8 + bin.byteLength + binPad;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, json.byteLength + jsonPad, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.byteLength, 20 + json.byteLength + jsonPad);

  const binStart = 20 + json.byteLength + jsonPad;
  view.setUint32(binStart, bin.byteLength + binPad, true);
  view.setUint32(binStart + 4, BIN_CHUNK, true);
  out.set(bin, binStart + 8);

  return out;
}

/** Reads the JSON chunk back out of a GLB. */
function readGltf(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
}

/** Reads the binary chunk, so a test can prove the geometry is untouched. */
function readBin(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return bytes.subarray(binStart + 8, binStart + 8 + binLength);
}

// 4-byte aligned, so the chunk carries no padding and a byte-for-byte
// comparison is about the copy rather than about the pad.
const BIN = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe("renameGlbNodesToNodeIds", () => {
  it("names each node by its extras.nodeId", () => {
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [
          { name: "Carbon disc road bike", extras: { nodeId: "df6bf0c0" } },
          { name: "levyjarrupinna", extras: { nodeId: "aaaa1111" } },
          { name: "levyjarrupinna", extras: { nodeId: "bbbb2222" } }
        ]
      },
      BIN
    );

    const nodes = readGltf(renameGlbNodesToNodeIds(glb)).nodes;

    expect(nodes.map((n: { name: string }) => n.name)).toEqual([
      "df6bf0c0",
      "aaaa1111",
      "bbbb2222"
    ]);
  });

  it("makes the 48 identically-named spokes individually addressable", () => {
    // The real failure this exists for: by authored name every spoke in the
    // bicycle resolves to the same entity, so a step fitting one lights up
    // another.
    const spokes = Array.from({ length: 48 }, (_, i) => ({
      name: "levyjarrupinna",
      extras: { nodeId: `spoke${i}` }
    }));
    const glb = makeGlb({ asset: { version: "2.0" }, nodes: spokes }, BIN);

    const names = readGltf(renameGlbNodesToNodeIds(glb)).nodes.map(
      (n: { name: string }) => n.name
    );

    expect(new Set(names).size).toBe(48);
  });

  it("suffixes a repeated nodeId so every instance is reachable", () => {
    // Identical geometry placed twice is two nodes with ONE id. Without the
    // suffix a name resolves to the first instance and its twin is stranded.
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [
          { name: "bolt", extras: { nodeId: "same" } },
          { name: "bolt", extras: { nodeId: "same" } },
          { name: "bolt", extras: { nodeId: "same" } }
        ]
      },
      BIN
    );

    const names = readGltf(renameGlbNodesToNodeIds(glb)).nodes.map(
      (n: { name: string }) => n.name
    );

    expect(names).toEqual(["same", "same#1", "same#2"]);
    expect(names).toEqual(modelNodeInstanceNames("same", 3));
  });

  it("keeps the authored label in extras", () => {
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [{ name: "levyjarrupinna", extras: { nodeId: "aaaa1111" } }]
      },
      BIN
    );

    expect(readGltf(renameGlbNodesToNodeIds(glb)).nodes[0].extras).toEqual({
      nodeId: "aaaa1111",
      authoredName: "levyjarrupinna"
    });
  });

  it("copies the binary chunk through byte for byte", () => {
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [
          {
            name: "a name long enough to change the chunk length",
            extras: { nodeId: "x" }
          }
        ]
      },
      BIN
    );

    expect(Array.from(readBin(renameGlbNodesToNodeIds(glb)))).toEqual(
      Array.from(BIN)
    );
  });

  it("keeps the binary chunk 4-byte aligned when the JSON length changes", () => {
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [
          { name: "abc", extras: { nodeId: "an-id-of-a-different-length" } }
        ]
      },
      BIN
    );

    const out = renameGlbNodesToNodeIds(glb);
    const jsonLength = new DataView(out.buffer).getUint32(12, true);

    expect(jsonLength % 4).toBe(0);
    expect((20 + jsonLength) % 4).toBe(0);
  });

  it("declares its own total length", () => {
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [{ name: "abc", extras: { nodeId: "zzzz9999" } }]
      },
      BIN
    );

    const out = renameGlbNodesToNodeIds(glb);

    expect(new DataView(out.buffer).getUint32(8, true)).toBe(out.byteLength);
  });

  it("leaves a node with no nodeId alone, so an older conversion still loads", () => {
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [{ name: "unconverted" }, { name: "b", extras: { nodeId: "i" } }]
      },
      BIN
    );

    expect(readGltf(renameGlbNodesToNodeIds(glb)).nodes[0].name).toBe(
      "unconverted"
    );
  });

  it("returns the original bytes when there is nothing to rename", () => {
    const glb = makeGlb(
      { asset: { version: "2.0" }, nodes: [{ name: "unconverted" }] },
      BIN
    );

    expect(renameGlbNodesToNodeIds(glb)).toBe(glb);
  });

  it("refuses bytes that are not a GLB rather than passing them through", () => {
    const notGlb = new Uint8Array(64).fill(7);

    expect(() => renameGlbNodesToNodeIds(notGlb)).toThrow(NotAGlbError);
  });

  it("refuses a truncated JSON chunk", () => {
    const glb = makeGlb(
      { asset: { version: "2.0" }, nodes: [{ extras: { nodeId: "i" } }] },
      BIN
    );
    new DataView(glb.buffer).setUint32(12, glb.byteLength * 2, true);

    expect(() => renameGlbNodesToNodeIds(glb)).toThrow(NotAGlbError);
  });
});

describe("material blending", () => {
  const withMaterial = (alphaMode: string) =>
    makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [{ name: "a", extras: { nodeId: "i" } }],
        materials: [{ alphaMode, pbrMetallicRoughness: {} }]
      },
      BIN
    );

  it("marks an opaque material blendable, or alpha is discarded silently", () => {
    const out = readGltf(renameGlbNodesToNodeIds(withMaterial("OPAQUE")));
    expect(out.materials[0].alphaMode).toBe("BLEND");
  });

  it("leaves an already-blending material alone", () => {
    const out = readGltf(renameGlbNodesToNodeIds(withMaterial("BLEND")));
    expect(out.materials[0].alphaMode).toBe("BLEND");
  });

  it("rewrites a GLB whose only change is the alpha mode", () => {
    // No node carries a nodeId, so the rename alone would short-circuit and
    // return the original bytes — with the materials still opaque.
    const glb = makeGlb(
      {
        asset: { version: "2.0" },
        nodes: [{ name: "unconverted" }],
        materials: [{ alphaMode: "OPAQUE" }]
      },
      BIN
    );
    const out = renameGlbNodesToNodeIds(glb);
    expect(out).not.toBe(glb);
    expect(readGltf(out).materials[0].alphaMode).toBe("BLEND");
  });
});
