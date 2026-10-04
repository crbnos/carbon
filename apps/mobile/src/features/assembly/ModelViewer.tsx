// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyPlaybackStep } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
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
import {
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
  steps,
  activeStepIndex
}: {
  /** Local `file://` uri from `useAssemblyModel`. */
  glbUri: string;
  steps: AssemblyPlaybackStep[];
  activeStepIndex: number;
}) {
  // `FilamentScene` must be a PARENT component rather than wrapped around the
  // hooks in one function: its context cannot be read by the component that
  // renders it.
  return (
    <FilamentScene>
      <Scene glbUri={glbUri} steps={steps} activeStepIndex={activeStepIndex} />
    </FilamentScene>
  );
}

function Scene({
  glbUri,
  steps,
  activeStepIndex
}: {
  glbUri: string;
  steps: AssemblyPlaybackStep[];
  activeStepIndex: number;
}) {
  const { t } = useLingui();
  const model = useModel({ source: { uri: glbUri } });
  const { scene } = useFilamentContext();

  // Far enough out to hold a whole engine or frame; the operator orbits from
  // here rather than being dropped inside the model.
  const cameraManipulator = useCameraManipulator({
    orbitHomePosition: [0, 1.5, 6],
    targetPosition: [0, 0, 0],
    orbitSpeed: [0.004, 0.004]
  });

  const visible = useMemo(
    () => visibleNodeIds(steps, activeStepIndex),
    [steps, activeStepIndex]
  );
  const mentioned = useMemo(() => mentionedNodeIds(steps), [steps]);

  const asset = model.state === "loaded" ? model.asset : null;

  useEffect(() => {
    if (!asset) return;
    // Nothing to hide when the instruction names no components — showing the
    // whole model is the honest answer, not an empty scene.
    if (visible.size === 0) return;

    // An entity is removed from the SCENE rather than scaled away: Filament
    // then skips it entirely, which is what keeps a 300-part engine
    // interactive on a tablet.
    const hidden = [];
    for (const nodeId of mentioned) {
      if (visible.has(nodeId)) continue;
      // One id can name several entities — identical geometry placed more
      // than once — so walk the instance names until one is absent. Stopping
      // at the first miss is what makes this bounded in practice.
      for (const name of instanceNamesFor(nodeId)) {
        const entity = asset.getFirstEntityByName(name);
        if (entity == null) break;
        hidden.push(entity);
      }
    }
    for (const entity of hidden) scene.removeEntity(entity);

    return () => {
      for (const entity of hidden) scene.addEntity(entity);
    };
  }, [asset, scene, visible, mentioned]);

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
      <Camera cameraManipulator={cameraManipulator} />
      <DefaultLight />
      <ModelRenderer model={model} />
    </FilamentView>
  );
}
