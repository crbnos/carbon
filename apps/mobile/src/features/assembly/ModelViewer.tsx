// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyPlaybackStep } from "@carbon/mes-core";
import { indexAssemblyGraph } from "@carbon/viewer/graph";
import { useLingui } from "@lingui/react/macro";
import { Pause, Play } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type {
  CameraManipulator,
  Entity,
  Float3,
  Mat4
} from "react-native-filament";
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
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useThemeColors } from "~/components/useThemeColor";
import type { AssemblyGraphNode } from "./modelVisibility";
import {
  buildSubtreeIndex,
  futureNodeIds,
  hiddenIdsFor,
  instanceNamesFor,
  mentionedNodeIds,
  visibleNodeIds
} from "./modelVisibility";
import type { StepView } from "./stepCamera";
import { defaultView, stepView } from "./stepCamera";
import {
  displayMotionFor,
  easeInOut,
  expandToLeaves,
  motionDurationMs,
  motionOffsetAt,
  motionSpinAt,
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
 * Matching web's viewer, this shows the step's parts, ghosts the ones a later
 * step fits, animates the insertion, frames the camera per step and lets the
 * operator orbit, pan and zoom by hand (`ModelGestures`).
 *
 * What web has and this does not: the view cube, and damped/inertial camera
 * motion — drei's `OrbitControls` gives web both for free, and Filament's
 * manipulator has neither.
 */
/** `useModel`'s result once it has finished loading. */
type LoadedModel = Extract<ReturnType<typeof useModel>, { state: "loaded" }>;

/** The opacity web ghosts a not-yet-installed part at. */
const GHOST_OPACITY = 0.3;

/**
 * Pinch scale → Filament scroll units. Filament's scroll step is sized for a
 * mouse wheel notch, which is far coarser than a pinch, so the raw ratio
 * moves the camera barely at all without this.
 */
const ZOOM_SENSITIVITY = 12;

/**
 * The beat held on a seated step before the next one starts.
 *
 * Most steps in real data carry no authored motion, so their synthesized
 * insertion is short; without a pause the whole assembly plays in a couple
 * of seconds and reads as a flicker rather than a sequence.
 */
const STEP_DWELL_MS = 600;

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

function Scene(props: {
  glbUri: string;
  graphRoot: AssemblyGraphNode | null;
  steps: AssemblyPlaybackStep[];
  activeStepIndex: number;
}) {
  // TWO instances of one asset: a solid one and a ghost one. Filament can
  // set opacity per ASSET or per INSTANCE, never per entity, so this is how a
  // SUBSET of the model is shown faintly. Instancing shares the geometry, so
  // the second copy costs transforms and draw calls, not meshes.
  const { t } = useLingui();
  const model = useModel({ uri: props.glbUri }, { instanceCount: 2 });

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

  // Everything below is mounted ONLY once the model is loaded.
  // `useCameraManipulator` fixes the camera's home when it is constructed and
  // offers no setter, so a manipulator built while the model was still
  // loading keeps a placeholder frame (radius 1 at the origin) and the model
  // renders off in a corner.
  return <LoadedScene {...props} model={model} />;
}

/**
 * The camera, alone, so its manipulator can be rebuilt without disturbing
 * the model. `near` and `far` are derived from the model rather than left at
 * Filament's defaults: CAD comes in its own units, this engine's half-extent
 * is 464, so the framed camera sits ~1100 out — past the default far plane.
 * The scene then renders with nothing inside the frustum, which looks exactly
 * like a broken viewer.
 */
function CameraRig({
  view,
  radius,
  onManipulator
}: {
  view: StepView;
  radius: number;
  onManipulator: (m: CameraManipulator | undefined) => void;
}) {
  const cameraManipulator = useCameraManipulator({
    orbitHomePosition: view.position,
    targetPosition: view.target,
    // Scaled with the model so a drag turns the part by the same amount
    // whatever units it was drawn in.
    orbitSpeed: [0.004, 0.004]
  });

  // Handed UP rather than held here, because the gestures that drive it are
  // attached outside `FilamentView` while the manipulator is fixed to this
  // camera. A ref, not state: this component is REMOUNTED on every step that
  // carries its own view, and storing the manipulator in the parent's state
  // would re-render the whole scene each time — which re-adds the asset and
  // silently resets the ghosts to solid.
  useEffect(() => {
    onManipulator(cameraManipulator);
    return () => onManipulator(undefined);
  }, [cameraManipulator, onManipulator]);

  return (
    <Camera
      cameraManipulator={cameraManipulator}
      near={Math.max(radius / 100, 0.01)}
      far={radius * 20}
    />
  );
}

/**
 * Orbit, pan and zoom with a finger.
 *
 * Web gets this from drei's `OrbitControls`; Filament exposes the same thing
 * as three imperative calls on the manipulator, so the gestures are wired by
 * hand. One finger orbits, two pan, a pinch zooms — the convention every CAD
 * viewer on a tablet uses, and the one an operator will already have from
 * Maps.
 *
 * **Every callback runs on the JS thread** (`runOnJS(true)`). The manipulator
 * is a JSI host object created on the JS thread; reaching it from the UI
 * thread, which is where gesture-handler runs its callbacks by default, is
 * not safe.
 *
 * **Strafe is decided once, at `onBegin`.** `grabBegin` takes it as an
 * argument and Filament holds that mode for the whole grab, so a finger
 * added or lifted part-way cannot switch between orbiting and panning. That
 * is Filament's model, not a simplification of it.
 */
function ModelGestures({
  manipulator,
  children
}: {
  manipulator: React.RefObject<CameraManipulator | undefined>;
  children: React.ReactNode;
}) {
  // The pinch's own scale is cumulative; the manipulator wants a per-frame
  // delta, so the previous value is kept to difference against.
  const lastScale = useRef(1);

  const gesture = useMemo(() => {
    const drag = Gesture.Pan()
      .onBegin((e) => {
        manipulator.current?.grabBegin(
          e.x,
          e.y,
          // Two fingers pan, one orbits.
          e.numberOfPointers > 1
        );
      })
      .onUpdate((e) => {
        manipulator.current?.grabUpdate(e.x, e.y);
      })
      .onFinalize(() => {
        // onFinalize, not onEnd: a gesture cancelled by the system never
        // fires onEnd, and a grab left open ignores every later one.
        manipulator.current?.grabEnd();
      })
      .runOnJS(true);

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        lastScale.current = 1;
      })
      .onUpdate((e) => {
        // Filament reads NEGATIVE as zoom in, and spreading the fingers
        // (scale > 1) is zoom in, so the difference is taken in this order.
        const delta = (lastScale.current - e.scale) * ZOOM_SENSITIVITY;
        lastScale.current = e.scale;
        manipulator.current?.scroll(e.focalX, e.focalY, delta);
      })
      .runOnJS(true);

    // Simultaneous, so two fingers can pan and zoom in one movement the way
    // they do on a map. Exclusive would make the operator lift and re-place
    // their fingers to switch between the two.
    return Gesture.Simultaneous(drag, pinch);
  }, [manipulator]);

  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

function LoadedScene({
  model,
  graphRoot,
  steps,
  activeStepIndex: operatorStepIndex
}: {
  model: LoadedModel;
  graphRoot: AssemblyGraphNode | null;
  steps: AssemblyPlaybackStep[];
  activeStepIndex: number;
}) {
  // The player's own playhead, which is NOT the operator's procedure step.
  //
  // Web's `AssemblyPlayer` plays the assembly as its own timeline, and that
  // separation matters more here than it does there: on this screen,
  // changing the operator's step records progress, advances the unit and can
  // start the Labor timer. A 3D preview must never do any of that. So
  // playing overrides the index locally, and the moment the operator moves
  // on their own the playhead is dropped and the view follows them again.
  const [playIndex, setPlayIndex] = useState<number | null>(null);
  const activeStepIndex = playIndex ?? operatorStepIndex;
  const playing = playIndex !== null;

  // Adjusted during render rather than in an effect. React documents this
  // for "reset state when a prop changes", and it is the correct tool twice
  // over here: an effect would need the operator's index as a dependency it
  // never reads (a trigger, which the exhaustive-deps rule rightly objects
  // to), and it would land a frame late — showing one frame of the playhead's
  // step after the operator had already moved off it.
  const lastOperatorStep = useRef(operatorStepIndex);
  if (lastOperatorStep.current !== operatorStepIndex) {
    lastOperatorStep.current = operatorStepIndex;
    if (playIndex !== null) setPlayIndex(null);
  }

  // The live camera manipulator, published by CameraRig. A ref because the
  // rig remounts whenever a step brings its own view, and the gestures only
  // need it at touch time — nothing has to re-render when it changes.
  const manipulator = useRef<CameraManipulator | undefined>(undefined);
  const setManipulator = useCallback((m: CameraManipulator | undefined) => {
    manipulator.current = m;
  }, []);

  // TWO instances of one asset: a solid one and a ghost one. Filament can
  // set opacity per ASSET or per INSTANCE, never per entity, so this is how a
  // SUBSET of the model is shown faintly. Instancing shares the geometry, so
  // the second copy costs transforms and draw calls, not meshes.
  const { scene, transformManager, renderableManager, nameComponentManager } =
    useFilamentContext();

  // Framed from the model's own bounding box, never a fixed distance. CAD
  // arrives in whatever units it was drawn in — the radial engine and a
  // bicycle frame differ by orders of magnitude — so a hard-coded camera
  // either sits inside the geometry or leaves a speck in the middle of the
  // screen. 2.4 half-extents back is the whole part with room to orbit.
  const box = model.boundingBox;
  const radius = box
    ? Math.max(box.halfExtent[0], box.halfExtent[1], box.halfExtent[2]) || 1
    : 1;
  const center: Float3 = box ? box.center : [0, 0, 0];

  // The planner may bake a view per step, chosen against the real triangles
  // of what is already installed so the part being fitted is not behind
  // something. With none, the whole model is framed. Either way the distance
  // comes from the model's own radius, never a constant.
  const view = useMemo(() => {
    const planned = stepView(steps[activeStepIndex]?.camera, center, radius);
    return planned ?? defaultView(center, radius);
  }, [steps, activeStepIndex, center, radius]);

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

  /**
   * Whether this scene is still mounted.
   *
   * The effects below put entities back and re-seat parts when their inputs
   * change — but on UNMOUNT there is nothing to put back, and Filament has
   * already released the asset by then: touching it throws
   * "Pointer FilamentAssetWrapper has already been manually released". This
   * effect is declared FIRST so React runs its cleanup FIRST, and every
   * cleanup after it checks the flag.
   */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const asset = model.asset;

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

  useEffect(() => {
    if (!copies) return;
    const { solid, ghost } = copies;

    const restoreSolid: Entity[] = [];
    const addedGhosts: Entity[] = [];

    const applyMembership = () => {
      // The ghost copy is entirely out of the scene to begin with: it is a
      // second full model, and leaving it in would draw every part twice.
      const ghostEntities = ghost.instance.getEntities();
      for (const entity of ghostEntities) scene.removeEntity(entity);

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

      // Re-applied with the membership rather than once on mount, so the
      // ghost copy cannot be left opaque by a reload that rebuilt its
      // materials.
      renderableManager.setInstanceEntitiesOpacity(
        ghost.instance,
        GHOST_OPACITY
      );
    };

    applyMembership();
    // And again next frame. `ModelRenderer` puts the asset into the scene
    // through its own effect, and when the model is already in memory — a tab
    // switched away from and back — that can land AFTER this one and undo it:
    // every part returns, opaque, which reads as "ghosting is broken" while a
    // first visit looks perfect. Re-asserting is cheap and idempotent.
    const settle = requestAnimationFrame(applyMembership);

    return () => {
      cancelAnimationFrame(settle);
      if (!alive.current) return;
      for (const entity of restoreSolid) scene.addEntity(entity);
      for (const entity of addedGhosts) scene.removeEntity(entity);
    };
  }, [copies, scene, renderableManager, visible, mentioned, future, subtrees]);

  // The insertion: the step's components start back along the motion and
  // travel to the pose the model already has them in.
  //
  // Driven from JS rather than a render-callback worklet. The clip is under
  // two seconds and only re-runs when the step changes, so the simpler loop
  // buys nothing worth a worklet's sharp edges — and because the seated pose
  // is read from the model and written back on the last frame, a dropped
  // frame or an unmount mid-flight leaves the part exactly where it belongs
  // rather than drifting.
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
      const eased = easeInOut(t);
      const offset = motionOffsetAt(motion, eased);
      const spin = motionSpinAt(motion, eased);
      transformManager.openLocalTransformTransaction();
      for (const { entity, seated } of moving) {
        // A threaded fastener turns about its own axis as it backs out, and
        // that axis passes through `origin` rather than the part's centre, so
        // the rotation is sandwiched between a move to the origin and back.
        //
        // Filament's `Mat4` methods PRE-multiply — `m.translate(v)` is
        // `T(v) · m`, verified on device — so the calls read in the opposite
        // order to the matrices they build. Moving to the origin first means
        // calling `.translate(-origin)` FIRST, which lands leftmost-last.
        // Written the intuitive way round it pivots about `-origin`, which on
        // this engine is a metre out and still animates, just wrongly.
        const posed = spin
          ? seated
              .translate([-spin.origin[0], -spin.origin[1], -spin.origin[2]])
              .rotate(spin.radians, spin.axis)
              .translate(spin.origin)
              .translate(offset)
          : seated.translate(offset);
        transformManager.setTransform(entity, t >= 1 ? seated : posed);
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
      // Whatever happened, the part ends up seated — unless the whole scene
      // is going away, in which case the asset is already gone.
      if (alive.current) apply(1);
    };
  }, [copies, motion, step, transformManager]);

  // Auto-advance, the way web's player does: when a step's insertion has
  // played, move to the next and keep going; stop on the last rather than
  // looping. The dwell is what makes it readable — back to back, the steps
  // of a small assembly go by faster than anyone can follow.
  useEffect(() => {
    if (!playing) return;
    const next = activeStepIndex + 1;
    if (next >= steps.length) return;
    const timer = setTimeout(
      () => setPlayIndex(next),
      motionDurationMs(motion) + STEP_DWELL_MS
    );
    return () => clearTimeout(timer);
  }, [playing, activeStepIndex, steps.length, motion]);

  return (
    // The gestures sit OUTSIDE FilamentView, wrapping it: FilamentView is a
    // native surface, so a touch handler on it never sees the gesture.
    <ModelGestures manipulator={manipulator}>
      <View style={{ flex: 1 }}>
        <FilamentView style={{ flex: 1 }}>
          {/*
        near and far are derived from the model, not left at Filament's
        defaults. CAD comes in its own units — this engine's half-extent is
        464, so the framed camera sits ~1100 out, which is past the default
        far plane: the scene renders, and nothing is inside the frustum. A
        black viewport with no error is the symptom.
      */}
          {/*
        Keyed on the view, so a step with its own camera gets a manipulator
        built for it — the home is fixed at construction and there is no
        setter. ONLY the camera remounts: remounting the whole scene would
        remount `ModelRenderer` too, which re-adds the asset and resets the
        materials, and the ghosts would silently go solid.
      */}
          <CameraRig
            key={`${view.position.join()}|${view.target.join()}`}
            view={view}
            radius={radius}
            onManipulator={setManipulator}
          />
          <DefaultLight />
          <ModelRenderer model={model} />
        </FilamentView>
        <PlayButton
          playing={playing}
          // From the operator's step, so Play always shows the build from
          // where they actually are rather than from wherever it last
          // stopped.
          onPress={() =>
            setPlayIndex(
              playing ? null : Math.min(operatorStepIndex, steps.length - 1)
            )
          }
        />
      </View>
    </ModelGestures>
  );
}

/**
 * Play / pause the build.
 *
 * Overlaid on the model rather than placed under it: the viewport is the
 * whole tab, and a control in a bar below would cost a row of the only thing
 * on screen worth looking at. Bottom-left keeps it clear of the right-handed
 * grip that orbits the model.
 */
function PlayButton({
  playing,
  onPress
}: {
  playing: boolean;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: playing }}
      accessibilityLabel={playing ? t`Pause the build` : t`Play the build`}
      className="absolute bottom-4 left-4 h-14 w-14 items-center justify-center rounded-full border border-border bg-card/90 active:opacity-70"
    >
      {playing ? (
        <Pause size={24} color={colors.foreground} fill={colors.foreground} />
      ) : (
        <Play size={24} color={colors.foreground} fill={colors.foreground} />
      )}
    </Pressable>
  );
}
