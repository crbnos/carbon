// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Html } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial
} from "three";
import {
  formatPmiItem,
  type PmiDisplayUnit,
  type PmiDocument,
  type PmiItem,
  type PmiMesh,
  pmiItemBounds
} from "./pmi";
import type { Vec3 } from "./types";
import { cn } from "./utils";

export type PmiLayerProps = {
  doc: PmiDocument;
  /** Items to draw; any other item renders nothing. */
  visibleIds: Set<string>;
  /** Drawn blue and on top, with its faces and edges highlighted. */
  selectedId: string | null;
  mode: "dark" | "light";
  /** Display unit of the text labels (default mm). */
  unit?: PmiDisplayUnit;
  /** Fired when a text label is clicked. */
  onSelect?: (id: string) => void;
};

const SELECTED_COLOR = 0x3b82f6;
const FOREGROUND = { dark: 0xe4e4e7, light: 0x18181b } as const;
const SELECTED_RENDER_ORDER = 10;
/** Text labels are DOM nodes; past this they cost more than they show. */
const MAX_LABELS = 200;

type ItemGeometry = {
  lines: BufferGeometry | null;
  mesh: BufferGeometry | null;
  /** Where a text label goes, for an item with no graphical PMI. */
  labelAt: Vec3 | null;
};

/** Each polyline as consecutive segment pairs, merged into one geometry. */
function segmentsGeometry(polylines: number[][]): BufferGeometry | null {
  let count = 0;
  for (const line of polylines) {
    const points = Math.floor(line.length / 3);
    if (points >= 2) count += (points - 1) * 6;
  }
  if (count === 0) return null;
  const positions = new Float32Array(count);
  let o = 0;
  for (const line of polylines) {
    const points = Math.floor(line.length / 3);
    for (let p = 0; p + 1 < points; p++) {
      for (let k = 0; k < 6; k++) positions[o++] = line[p * 3 + k] ?? 0;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Triangle meshes merged into one geometry (indexed when every one is). */
function meshGeometry(meshes: PmiMesh[]): BufferGeometry | null {
  const parts = meshes.filter((m) => m.positions.length >= 9);
  if (parts.length === 0) return null;
  const vertexCount = parts.reduce(
    (n, m) => n + Math.floor(m.positions.length / 3),
    0
  );
  const positions = new Float32Array(vertexCount * 3);
  const indexed = parts.every((m) => m.indices.length > 0);
  const indices: number[] = [];
  let base = 0;
  for (const part of parts) {
    const vertices = Math.floor(part.positions.length / 3);
    positions.set(part.positions.slice(0, vertices * 3), base * 3);
    if (indexed) {
      for (const index of part.indices) indices.push(index + base);
    }
    base += vertices;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (indexed) {
    geometry.setIndex(
      new BufferAttribute(
        vertexCount > 65535
          ? new Uint32Array(indices)
          : new Uint16Array(indices),
        1
      )
    );
  }
  return geometry;
}

function labelAnchor(doc: PmiDocument, item: PmiItem): Vec3 | null {
  if (item.textPosition) return item.textPosition;
  const bounds = pmiItemBounds(doc, item, true);
  if (!bounds) return null;
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2
  ];
}

/**
 * The model's PMI in the scene: each item's graphical lines and filled text in
 * the theme's foreground, depth-tested so the model hides what is behind it.
 * The selected item draws blue on top, with its referenced faces and edges
 * highlighted. An item with no graphical PMI gets a text label instead.
 */
export function PmiLayer({
  doc,
  visibleIds,
  selectedId,
  mode,
  unit = "mm",
  onSelect
}: PmiLayerProps) {
  const geometries = useMemo(() => {
    const byId = new Map<string, ItemGeometry>();
    for (const item of doc.items) {
      const lines = segmentsGeometry(item.lines);
      const mesh = item.mesh ? meshGeometry([item.mesh]) : null;
      byId.set(item.id, {
        lines,
        mesh,
        labelAt: lines || mesh ? null : labelAnchor(doc, item)
      });
    }
    return byId;
  }, [doc]);

  useEffect(
    () => () => {
      for (const geometry of geometries.values()) {
        geometry.lines?.dispose();
        geometry.mesh?.dispose();
      }
    },
    [geometries]
  );

  const highlight = useMemo(() => {
    const item = selectedId
      ? doc.items.find((candidate) => candidate.id === selectedId)
      : undefined;
    if (!item) return { faces: null, edges: null };
    const faces = item.faces
      .map((index) => doc.faces[index])
      .filter((face): face is PmiMesh => Boolean(face));
    const edges = item.edges
      .map((index) => doc.edges[index])
      .filter((edge): edge is number[] => Boolean(edge));
    return { faces: meshGeometry(faces), edges: segmentsGeometry(edges) };
  }, [doc, selectedId]);

  useEffect(
    () => () => {
      highlight.faces?.dispose();
      highlight.edges?.dispose();
    },
    [highlight]
  );

  const materials = useMemo(() => {
    const color = FOREGROUND[mode];
    return {
      line: new LineBasicMaterial({ color }),
      mesh: new MeshBasicMaterial({ color, side: DoubleSide }),
      // Transparent (at full opacity) so the selection sorts after the
      // model's own transparent materials too, and draws over them.
      selectedLine: new LineBasicMaterial({
        color: SELECTED_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true
      }),
      selectedMesh: new MeshBasicMaterial({
        color: SELECTED_COLOR,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
        transparent: true
      }),
      face: new MeshBasicMaterial({
        color: SELECTED_COLOR,
        side: DoubleSide,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      }),
      edge: new LineBasicMaterial({
        color: SELECTED_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true
      })
    };
  }, [mode]);

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials]
  );

  const labels = useMemo(() => {
    const out: { item: PmiItem; at: Vec3 }[] = [];
    for (const item of doc.items) {
      if (out.length >= MAX_LABELS) break;
      if (!visibleIds.has(item.id)) continue;
      const at = geometries.get(item.id)?.labelAt;
      if (at) out.push({ item, at });
    }
    return out;
  }, [doc, visibleIds, geometries]);

  return (
    <group>
      {doc.items.map((item) => {
        if (!visibleIds.has(item.id)) return null;
        const geometry = geometries.get(item.id);
        if (!geometry || (!geometry.lines && !geometry.mesh)) return null;
        const selected = item.id === selectedId;
        const renderOrder = selected ? SELECTED_RENDER_ORDER : 0;
        return (
          <group key={item.id}>
            {geometry.lines && (
              <lineSegments
                geometry={geometry.lines}
                material={selected ? materials.selectedLine : materials.line}
                renderOrder={renderOrder}
              />
            )}
            {geometry.mesh && (
              <mesh
                geometry={geometry.mesh}
                material={selected ? materials.selectedMesh : materials.mesh}
                renderOrder={renderOrder}
              />
            )}
          </group>
        );
      })}
      {selectedId && visibleIds.has(selectedId) && highlight.faces && (
        <mesh
          geometry={highlight.faces}
          material={materials.face}
          renderOrder={SELECTED_RENDER_ORDER - 1}
        />
      )}
      {selectedId && visibleIds.has(selectedId) && highlight.edges && (
        <lineSegments
          geometry={highlight.edges}
          material={materials.edge}
          renderOrder={SELECTED_RENDER_ORDER - 1}
        />
      )}
      {labels.map(({ item, at }) => {
        const { label, title } = formatPmiItem(item, unit, doc.sourceUnit);
        const selected = item.id === selectedId;
        return (
          <Html
            key={item.id}
            position={at}
            center
            // Below the preview's panels (z-20) and its interact gate (z-10).
            zIndexRange={[5, 0]}
          >
            <button
              type="button"
              title={title}
              onClick={() => onSelect?.(item.id)}
              className={cn(
                "whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-xs tabular-nums shadow-sm",
                selected
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-border bg-popover text-popover-foreground hover:bg-accent"
              )}
            >
              {label}
            </button>
          </Html>
        );
      })}
    </group>
  );
}
