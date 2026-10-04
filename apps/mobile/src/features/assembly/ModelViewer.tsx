// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyPlaybackStep } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { Entity, Float3 } from "react-native-filament";
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
  hiddenIdsFor,
  instanceNamesFor,
  mentionedNodeIds,
  visibleNodeIds
} from "./modelVisibility";

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
  const model = useModel({ uri: glbUri });
  const { scene } = useFilamentContext();

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
  const subtrees = useMemo(() => buildSubtreeIndex(graphRoot), [graphRoot]);

  const asset = model.state === "loaded" ? model.asset : null;

  useEffect(() => {
    if (!asset) return;
    // Nothing to hide when the instruction names no components — showing the
    // whole model is the honest answer, not an empty scene.
    if (visible.size === 0) return;

    // An entity is removed from the SCENE rather than scaled away: Filament
    // then skips it entirely, which is what keeps a 300-part engine
    // interactive on a tablet.
    const hidden: Entity[] = [];
    for (const nodeId of mentioned) {
      if (visible.has(nodeId)) continue;
      // One id can name several entities — identical geometry placed more
      // than once — so walk the instance names until one is absent. Stopping
      // at the first miss is what makes this bounded in practice.
      // The step names an assembly node, whose geometry is in its children,
      // so the whole subtree goes.
      for (const id of hiddenIdsFor(nodeId, subtrees)) {
        for (const name of instanceNamesFor(id)) {
          const entity = asset.getFirstEntityByName(name);
          if (entity == null) break;
          hidden.push(entity);
        }
      }
    }
    for (const entity of hidden) scene.removeEntity(entity);

    return () => {
      for (const entity of hidden) scene.addEntity(entity);
    };
  }, [asset, scene, visible, mentioned, subtrees]);

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
