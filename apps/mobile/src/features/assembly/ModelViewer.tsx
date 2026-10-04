// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyPlaybackStep } from "@carbon/mes-core";
import { indexAssemblyGraph } from "@carbon/viewer/graph";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { Entity, Float3, Mat4 } from "react-native-filament";
import {
  Camera,
  DefaultLight,
  FilamentScene,
  FilamentView,
  ModelRenderer,
  useCameraManipulator,
  useFilamentContext,
  useModel
} from "react-native-filament";
import type { AssemblyGraphNode } from "./modelVisibility";
import {
  buildSubtreeIndex,
  futureNodeIds,
  hiddenIdsFor,
  instanceNamesFor,
  mentionedNodeIds,
  visibleNodeIds
} from "./modelVisibility";
import {
  displayMotionFor,
  easeInOut,
  expandToLeaves,
  motionDurationMs,
  motionOffsetAt,
  presentNodeIdsBefore
} from "./stepMotion";

/**
 * The assembly instruction in 3D, rendered natively.
 *
 * **Why Filament and not the web player.** `@carbon/viewer`'s `AssemblyPlayer`
 * is three.js, and three.js on a phone needs `expo-gl` — which is built on
 * OpenGL ES, deprecated by Apple, and already broken against current
 * react-three-fiber. Filament renders through Metal on a thread of its own,
 * and its glTF loader decodes `EXT_meshopt_compression` in C++, which every
 * model the assembler produces uses and which Hermes could not decode at all
 * (the decoder is WebAssembly, and Hermes has no WebAssembly).
 *
 * **Components are addressed by NAME here, not by extras.** A step names the
 * parts it installs by `componentNodeIds`, and the assembler writes those ids
 * into each glTF node's `extras` — which Filament cannot read. So the server
 * moves the id onto the node's name on the way out
 * (`renameGlbNodesToNodeIds`), and this component looks parts up by name. It
 * matters that the server does it rather than the client: the authored CAD
 * names repeat (48 spokes share one in the demo bicycle), so matching on the
 * authored name would address the wrong part with no sign that it had.
 *
 * What this does NOT do yet, and web does: animate the insertion path of the
 * active step, ghost the parts still to come, and frame the camera per step.
 * The model, the step's parts and free orbit are the first pass.
 */
/** The opacity web ghosts a not-yet-installed part at. */
const GHOST_OPACITY = 0.3;

/**
 * Every entity one component id names in a copy of the model: the id itself,
 * then its `#1`, `#2`… instances, stopping at the first that is absent.
 */
function entitiesFor(nodeId: string, byName: Map<string, Entity>) {
  const out: Entity[] = [];
  for (const name of instanceNamesFor(nodeId)) {
    const entity = byName.get(name);
    if (entity == null) break;
    out.push(entity);
  }
  return out;
}

export function ModelViewer({
  glbUri,
  graphRoot,
  steps,
  activeStepIndex
}: {
  /** Local `file://` uri from `useAssemblyModel`. */
  glbUri: string;
  /** The product tree, so a component hides with its descendants. */
  graphRoot: AssemblyGraphNode | null;
  steps: AssemblyPlaybackStep[];
  activeStepIndex: number;
}) {
  // `FilamentScene` must be a PARENT component rather than wrapped around the
  // hooks in one function: its context cannot be read by the component that
  // renders it.
  return (
    <FilamentScene>
      <Scene
        glbUri={glbUri}
        graphRoot={graphRoot}
        steps={steps}
        activeStepIndex={activeStepIndex}
      />
    </FilamentScene>
  );
}

function Scene({
  glbUri,
  graphRoot,
  steps,
  activeStepIndex
}: {
  glbUri: string;
  graphRoot: AssemblyGraphNode | null;
  steps: AssemblyPlaybackStep[];
  activeStepIndex: number;
}) {
  const { t } = useLingui();
  // TWO instances of one asset: a solid one and a ghost one. Filament can
  // set opacity per ASSET or per INSTANCE, never per entity, so this is how a
  // SUBSET of the model is shown faintly. Instancing shares the geometry, so
  // the second copy costs transforms and draw calls, not meshes.
  const model = useModel({ uri: glbUri }, { instanceCount: 2 });
  const { scene, transformManager, renderableManager, nameComponentManager } =
    useFilamentContext();

  // Framed from the model's own bounding box, never a fixed distance. CAD
  // arrives in whatever units it was drawn in — the radial engine and a
  // bicycle frame differ by orders of magnitude — so a hard-coded camera
  // either sits inside the geometry or leaves a speck in the middle of the
  // screen. 2.4 half-extents back is the whole part with room to orbit.
  const box = model.state === "loaded" ? model.boundingBox : null;
  const radius = box
    ? Math.max(box.halfExtent[0], box.halfExtent[1], box.halfExtent[2]) || 1
    : 1;
  const target: Float3 = box ? box.center : [0, 0, 0];
  const cameraManipulator = useCameraManipulator({
    orbitHomePosition: [
      target[0],
      target[1] + radius * 0.6,
      target[2] + radius * 2.4
    ],
    targetPosition: target,
    // Scaled with the model so a drag turns the part by the same amount
    // whatever units it was drawn in.
    orbitSpeed: [0.004, 0.004]
  });

  const visible = useMemo(
    () => visibleNodeIds(steps, activeStepIndex),
    [steps, activeStepIndex]
  );
  const mentioned = useMemo(() => mentionedNodeIds(steps), [steps]);
  const future = useMemo(
    () => futureNodeIds(steps, activeStepIndex),
    [steps, activeStepIndex]
  );
  const subtrees = useMemo(() => buildSubtreeIndex(graphRoot), [graphRoot]);
  // The viewer's own graph index, for the fallback motion synthesis. Built
  // from the same graph.json the subtree index uses.
  const graphIndex = useMemo(
    () =>
      graphRoot
        ? indexAssemblyGraph({ root: graphRoot } as Parameters<
            typeof indexAssemblyGraph
          >[0])
        : null,
    [graphRoot]
  );

  // The graph's leaves are the only nodes carrying geometry, and the
  // fallback synthesis reasons about their boxes.
  const leafIds = useMemo(
    () => new Set((graphIndex?.leaves ?? []).map((leaf) => leaf.nodeId)),
    [graphIndex]
  );

  const step = steps[activeStepIndex];
  const motion = useMemo(
    () =>
      step
        ? displayMotionFor({
            motion: step.motion as Parameters<
              typeof displayMotionFor
            >[0]["motion"],
            componentNodeIds: [
              ...expandToLeaves(step.componentNodeIds, subtrees, leafIds)
            ],
            flagged: Boolean(
              (step.warnings as { flagged?: boolean } | null)?.flagged
            ),
            index: activeStepIndex,
            graphIndex,
            presentNodeIds: expandToLeaves(
              presentNodeIdsBefore(steps, activeStepIndex),
              subtrees,
              leafIds
            )
          })
        : { type: "none" as const },
    [step, steps, activeStepIndex, graphIndex, subtrees, leafIds]
  );

  const asset = model.state === "loaded" ? model.asset : null;

  // name -> entity, per instance. `getFirstEntityByName` searches the asset
  // and so cannot tell the two copies apart; these can.
  const copies = useMemo(() => {
    if (!asset) return null;
    const instances = asset.getAssetInstances();
    const solid = instances[0];
    const ghost = instances[1];
    if (!solid || !ghost) return null;
    const index = (instance: typeof solid) => {
      const byName = new Map<string, Entity>();
      for (const entity of instance.getEntities()) {
        const name = nameComponentManager.getEntityName(entity);
        if (name) byName.set(name, entity);
      }
      return { instance, byName };
    };
    return { solid: index(solid), ghost: index(ghost) };
  }, [asset, nameComponentManager]);

  // Faint, and the same 0.3 web ghosts with.
  useEffect(() => {
    if (!copies) return;
    renderableManager.setInstanceEntitiesOpacity(
      copies.ghost.instance,
      GHOST_OPACITY
    );
  }, [copies, renderableManager]);

  useEffect(() => {
    if (!copies) return;
    const { solid, ghost } = copies;

    // The ghost copy is entirely out of the scene to begin with: it is a
    // second full model, and leaving it in would draw every part twice.
    const ghostEntities = ghost.instance.getEntities();
    for (const entity of ghostEntities) scene.removeEntity(entity);

    const restoreSolid: Entity[] = [];
    const addedGhosts: Entity[] = [];

    // Nothing to hide when the instruction names no components — showing the
    // whole model is the honest answer, not an empty scene.
    if (visible.size > 0) {
      for (const nodeId of mentioned) {
        if (visible.has(nodeId)) continue;
        // The step names an assembly node, whose geometry is in its
        // children, so the whole subtree goes. (Scene membership is per
        // entity; unlike a transform it is not inherited.)
        for (const id of hiddenIdsFor(nodeId, subtrees)) {
          for (const entity of entitiesFor(id, solid.byName)) {
            scene.removeEntity(entity);
            restoreSolid.push(entity);
          }
          // Only a part a LATER step fits is ghosted; one moved aside for
          // access this step simply goes.
          if (!future.has(nodeId)) continue;
          for (const entity of entitiesFor(id, ghost.byName)) {
            scene.addEntity(entity);
            addedGhosts.push(entity);
          }
        }
      }
    }

    return () => {
      for (const entity of restoreSolid) scene.addEntity(entity);
      for (const entity of addedGhosts) scene.removeEntity(entity);
    };
  }, [copies, scene, visible, mentioned, future, subtrees]);

  // The insertion: the step's components start back along the motion and
  // travel to the pose the model already has them in.
  //
  // Driven from JS rather than a render-callback worklet. The clip is under
  // two seconds and only re-runs when the step changes, so the simpler loop
  // buys nothing worth a worklet's sharp edges — and because the seated pose
  // is read from the model and written back on the last frame, a dropped
  // frame or an unmount mid-flight leaves the part exactly where it belongs
  // rather than drifting.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the step
  useEffect(() => {
    const duration = motionDurationMs(motion);
    if (!copies || !step || duration === 0) return;

    const moving: { entity: Entity; seated: Mat4 }[] = [];
    for (const nodeId of step.componentNodeIds) {
      // The assembly node itself, NOT its subtree: a transform IS inherited
      // (unlike scene membership), so moving the parent carries its children.
      // The SOLID copy only — the ghost is a preview and does not travel.
      for (const entity of entitiesFor(nodeId, copies.solid.byName)) {
        moving.push({
          entity,
          seated: transformManager.getTransform(entity)
        });
      }
    }
    if (moving.length === 0) return;

    let frame: number | null = null;
    let cancelled = false;
    const startedAt = Date.now();

    const apply = (t: number) => {
      const offset = motionOffsetAt(motion, easeInOut(t));
      transformManager.openLocalTransformTransaction();
      for (const { entity, seated } of moving) {
        transformManager.setTransform(
          entity,
          t >= 1 ? seated : seated.translate(offset)
        );
      }
      transformManager.commitLocalTransformTransaction();
    };

    const tick = () => {
      if (cancelled) return;
      const t = Math.min(1, (Date.now() - startedAt) / duration);
      apply(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelled = true;
      if (frame != null) cancelAnimationFrame(frame);
      // Whatever happened, the part ends up seated.
      apply(1);
    };
  }, [copies, motion, step, transformManager]);

  if (model.state !== "loaded") {
    return (
      <View className="flex-1 items-center justify-center bg-muted">
        <ActivityIndicator />
        <Text className="pt-2 text-sm text-muted-foreground">
          {t`Loading the 3D model`}
        </Text>
      </View>
    );
  }

  return (
    <FilamentView style={{ flex: 1 }}>
      {/*
        near and far are derived from the model, not left at Filament's
        defaults. CAD comes in its own units — this engine's half-extent is
        464, so the framed camera sits ~1100 out, which is past the default
        far plane: the scene renders, and nothing is inside the frustum. A
        black viewport with no error is the symptom.
      */}
      <Camera
        cameraManipulator={cameraManipulator}
        near={Math.max(radius / 100, 0.01)}
        far={radius * 20}
      />
      <DefaultLight />
      <ModelRenderer model={model} />
    </FilamentView>
  );
}
