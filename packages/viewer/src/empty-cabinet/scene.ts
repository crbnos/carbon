// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  type Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  PointLight,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from "three";
import {
  HorizontalBlurShader,
  RoundedBoxGeometry,
  VerticalBlurShader
} from "three-stdlib";

// A two-drawer steel filing cabinet whose bottom drawer slides open, empty.
//
// Every empty state on a page shares ONE WebGL renderer: browsers cap live
// WebGL contexts at ~16 and a list page can show more empty states than that.
// Each instance owns a plain 2D canvas, and a frame is rendered on the shared
// renderer and copied across with `drawImage` in the same task, before the
// drawing buffer is discarded. An instance renders only while its drawer is
// moving or someone is turning it; otherwise it costs nothing until the theme
// changes.

// Proportions follow the line drawing this replaces: a narrow, tall cabinet,
// about as deep as it is wide, standing on four feet.
const W = 0.8;
const D = 0.85;
const H = 1.32;
const FOOT = 0.045;
const SIDE = 0.022;
const PLINTH = 0.07;
const RAIL = 0.03;
const CAP = 0.045;
const GAP = 0.008;
const OPENING = (H - PLINTH - RAIL - CAP) / 2;
const FRONT_Z = D / 2;
const FRONT_DEPTH = 0.03;
const TRAVEL = 0.62;

const BOX_WIDTH = W - 2 * SIDE - 0.07;
const BOX_DEPTH = D - 0.13;
const BOX_HEIGHT = OPENING - 0.12;
const SHEET = 0.012;

// The drawer is pulled, runs out on its slides, and knocks against the stop:
// it decelerates into the end of travel, then rebounds a few millimetres.
const DELAY = 0.35;
const PULL = 0.95;
const REBOUND = 0.24;
const REBOUND_DEPTH = 0.018;

function drawerTravel(seconds: number) {
  const t = seconds - DELAY;
  if (t <= 0) return 0;
  if (t < PULL) {
    const u = t / PULL;
    // Ease in over the first few frames (the pull starts from rest), then
    // decelerate on the slides' friction into the stop.
    const pull = 1 - (1 - u) ** 3;
    const start = Math.min(1, u * 6);
    return pull * (start * start * (3 - 2 * start) * 0.15 + 0.85);
  }
  const r = t - PULL;
  if (r < REBOUND) return 1 - REBOUND_DEPTH * Math.sin((Math.PI * r) / REBOUND);
  return 1;
}

const DURATION = DELAY + PULL + REBOUND;

// Turntable. The cabinet spins about the middle of its footprint with the
// drawer out, and the camera tilts between near eye level and a steep view; at
// rest it looks at the cabinet from a little above eye level, so the fronts
// read and the top is a sliver.
const PIVOT_Z = TRAVEL / 2;
const REACH = Math.hypot(W / 2, (D + TRAVEL) / 2);
const FLOOR_REACH = REACH + 0.12;
const HEIGHT = FOOT + H;
const REST_PITCH = (13 * Math.PI) / 180;
const MIN_PITCH = (4 * Math.PI) / 180;
const MAX_PITCH = (55 * Math.PI) / 180;
const DRAG_SPEED = 0.012;
const SPIN_DAMPING = 4;

// Contact shadow: the floor's view of the cabinet from below, darker the
// closer a surface is to the floor, blurred. Height-aware, so the drawer —
// riding higher than the feet — throws a softer, fainter shadow than the
// carcass, and it follows any rotation for free.
const CONTACT_SIZE = 2 * (REACH + 0.35);
const CONTACT_HEIGHT = 0.8;
const CONTACT_RESOLUTION = 256;
const CONTACT_BLUR = 3;

type Palette = {
  steel: Color;
  card: Color;
  handle: Color;
  ink: Color;
  foot: Color;
  edge: Color;
  dark: boolean;
};

type View = { travel: number; yaw: number; pitch: number };

type ContactShadow = {
  render: (renderer: WebGLRenderer, scene: Scene) => void;
  material: MeshBasicMaterial;
};

type Shared = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: OrthographicCamera;
  target: Vector3;
  pivot: Group;
  drawer: Group;
  slide: Group;
  contact: ContactShadow;
  outlines: LineSegments[];
  ambient: AmbientLight;
  key: DirectionalLight;
  fill: DirectionalLight;
  glow: PointLight;
  materials: {
    steel: MeshStandardMaterial;
    card: MeshStandardMaterial;
    foot: MeshStandardMaterial;
    handle: MeshStandardMaterial;
    rail: MeshStandardMaterial;
    ink: MeshBasicMaterial;
    edge: LineBasicMaterial;
  };
};

let shared: Shared | null | undefined;

function getShared(): Shared | null {
  if (shared !== undefined) return shared;
  try {
    shared = createScene();
  } catch {
    shared = null;
  }
  return shared;
}

function createScene(): Shared {
  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power"
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const materials = {
    steel: new MeshStandardMaterial({
      roughness: 0.62,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }),
    card: new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
    foot: new MeshStandardMaterial({ roughness: 0.8, metalness: 0 }),
    handle: new MeshStandardMaterial({ roughness: 0.38, metalness: 0.15 }),
    rail: new MeshStandardMaterial({ roughness: 0.32, metalness: 0.35 }),
    ink: new MeshBasicMaterial(),
    edge: new LineBasicMaterial({ transparent: true })
  };

  const scene = new Scene();
  const pivot = new Group();
  scene.add(pivot);
  const cabinet = new Group();
  cabinet.position.z = -PIVOT_Z;
  pivot.add(cabinet);
  const outlines: LineSegments[] = [];

  const part = (
    parent: Object3D,
    size: [number, number, number],
    center: [number, number, number],
    material: Material = materials.steel,
    { edges = true, radius = 0.006 } = {}
  ) => {
    const [w, h, d] = size;
    const geometry =
      radius > 0 && Math.min(w, h, d) > radius * 2.5
        ? new RoundedBoxGeometry(w, h, d, 2, radius)
        : new BoxGeometry(w, h, d);
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (edges) {
      // Outlines come from the sharp box, not the rounded one: a rounded box's
      // bevel facets would each draw a line. The offset is under a pixel.
      const lines = new LineSegments(
        new EdgesGeometry(new BoxGeometry(w, h, d)),
        materials.edge
      );
      lines.position.set(...center);
      parent.add(lines);
      outlines.push(lines);
    }
    return mesh;
  };

  // Carcass. The front of the cabinet faces +z.
  const yb = FOOT;
  const innerW = W - 2 * SIDE;
  part(cabinet, [W, PLINTH, D], [0, yb + PLINTH / 2, 0]);
  for (const side of [-1, 1]) {
    part(
      cabinet,
      [SIDE, H - CAP, D],
      [side * (W / 2 - SIDE / 2), yb + (H - CAP) / 2, 0]
    );
  }
  part(
    cabinet,
    [innerW, H - CAP - PLINTH, SIDE],
    [0, yb + PLINTH + (H - CAP - PLINTH) / 2, -D / 2 + SIDE / 2],
    materials.steel,
    { edges: false }
  );
  part(
    cabinet,
    [innerW, RAIL, 0.05],
    [0, yb + PLINTH + OPENING + RAIL / 2, FRONT_Z - 0.025]
  );
  part(
    cabinet,
    [W + 0.016, CAP, D + 0.016],
    [0, yb + H - CAP / 2, 0],
    materials.steel,
    { radius: 0.01 }
  );
  // Ceiling of the bottom bay, seen when looking up into the open drawer's slot.
  part(
    cabinet,
    [innerW, SHEET, D - 0.06],
    [0, yb + PLINTH + OPENING + RAIL / 2, -0.03],
    materials.steel,
    { edges: false }
  );

  // Lock cylinder in the top rail.
  const lock = new Mesh(
    new CylinderGeometry(0.018, 0.018, 0.012, 20),
    materials.handle
  );
  lock.rotation.x = Math.PI / 2;
  lock.position.set(W / 2 - 0.08, yb + H - CAP / 2, FRONT_Z + 0.014);
  cabinet.add(lock);
  const keyway = new Mesh(new BoxGeometry(0.004, 0.018, 0.004), materials.foot);
  keyway.position.set(W / 2 - 0.08, yb + H - CAP / 2, FRONT_Z + 0.02);
  cabinet.add(keyway);

  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      part(
        cabinet,
        [0.07, FOOT, 0.07],
        [x * (W / 2 - 0.06), FOOT / 2, z * (D / 2 - 0.06)],
        materials.foot,
        { radius: 0 }
      );
    }
  }

  // A drawer front: the panel, a card holder, and a pull handle.
  const front = (parent: Object3D, centerY: number) => {
    const fw = innerW - 2 * GAP;
    const fh = OPENING - 2 * GAP;
    const z = FRONT_Z - FRONT_DEPTH / 2 + 0.004;
    part(parent, [fw, fh, FRONT_DEPTH], [0, centerY, z], materials.steel, {
      radius: 0.008
    });
    const face = z + FRONT_DEPTH / 2;
    // Card holder and pull in a contrasting finish (dark on a light cabinet,
    // bright on a dark one) so they read at empty-state size. Neither casts a
    // shadow: under a near-overhead light a handle drops a streak down the
    // whole drawer front.
    const labelY = centerY + fh * 0.13;
    part(
      parent,
      [0.18, 0.092, 0.008],
      [0, labelY, face + 0.004],
      materials.handle,
      { edges: false, radius: 0.003 }
    );
    part(
      parent,
      [0.154, 0.066, 0.004],
      [0, labelY, face + 0.009],
      materials.card,
      { edges: false, radius: 0 }
    );
    part(
      parent,
      [0.09, 0.012, 0.002],
      [-0.016, labelY + 0.008, face + 0.0115],
      materials.ink,
      { edges: false, radius: 0 }
    );
    part(
      parent,
      [0.06, 0.012, 0.002],
      [-0.031, labelY - 0.014, face + 0.0115],
      materials.ink,
      { edges: false, radius: 0 }
    );

    const handleY = centerY - fh * 0.06;
    const bar = new Mesh(
      new CapsuleGeometry(0.016, 0.22, 6, 16),
      materials.handle
    );
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, handleY, face + 0.052);
    parent.add(bar);
    for (const x of [-0.11, 0.11]) {
      const post = new Mesh(
        new CylinderGeometry(0.012, 0.013, 0.052, 12),
        materials.handle
      );
      post.rotation.x = Math.PI / 2;
      post.position.set(x, handleY, face + 0.026);
      parent.add(post);
    }
  };

  const bottomCenter = yb + PLINTH + OPENING / 2;
  const topCenter = yb + PLINTH + OPENING + RAIL + OPENING / 2;
  front(cabinet, topCenter);

  // The bottom drawer: a front and an open steel box with hanging-file rails.
  const drawer = new Group();
  cabinet.add(drawer);
  front(drawer, bottomCenter);
  const boxBack = FRONT_Z - FRONT_DEPTH - BOX_DEPTH;
  const boxZ = boxBack + BOX_DEPTH / 2;
  const floorY = yb + PLINTH + 0.035;
  part(drawer, [BOX_WIDTH, SHEET, BOX_DEPTH], [0, floorY, boxZ]);
  for (const side of [-1, 1]) {
    const x = side * (BOX_WIDTH / 2 - SHEET / 2);
    part(
      drawer,
      [SHEET, BOX_HEIGHT, BOX_DEPTH],
      [x, floorY + BOX_HEIGHT / 2, boxZ]
    );
    // Hanging-file lip folded outward along the top of each side.
    part(
      drawer,
      [0.024, 0.008, BOX_DEPTH],
      [x + side * 0.006, floorY + BOX_HEIGHT, boxZ],
      materials.steel,
      { radius: 0 }
    );
    // The drawer's own slide member.
    part(
      drawer,
      [0.01, 0.034, BOX_DEPTH * 0.94],
      [side * (BOX_WIDTH / 2 + 0.007), floorY + BOX_HEIGHT * 0.45, boxZ],
      materials.rail,
      { edges: false, radius: 0 }
    );
  }
  part(
    drawer,
    [BOX_WIDTH, BOX_HEIGHT, SHEET],
    [0, floorY + BOX_HEIGHT / 2, boxBack + SHEET / 2]
  );

  // The telescoping intermediate member runs out half as far as the drawer, and
  // the cabinet member stays put — what a full-extension slide actually does.
  const slide = new Group();
  cabinet.add(slide);
  for (const side of [-1, 1]) {
    part(
      slide,
      [0.008, 0.044, BOX_DEPTH * 0.94],
      [side * (BOX_WIDTH / 2 + 0.016), floorY + BOX_HEIGHT * 0.45, boxZ],
      materials.rail,
      { edges: false, radius: 0 }
    );
    part(
      cabinet,
      [0.007, 0.054, D - 0.08],
      [side * (innerW / 2 - 0.004), floorY + BOX_HEIGHT * 0.45, -0.01],
      materials.rail,
      { edges: false, radius: 0 }
    );
  }

  const contact = createContactShadow(scene, [...outlines]);

  // Light from above, in front and to the left: the top is brightest, the front
  // next, and the right side falls into shade — the same reading as the line
  // drawing, where the front was light and the side was muted. The key light
  // shadows the cabinet onto itself (the drawer's walls onto its floor); the
  // floor takes only the contact shadow.
  const ambient = new AmbientLight(0xffffff);
  scene.add(ambient);
  const key = new DirectionalLight(0xffffff);
  key.position.set(-0.4, 6, 1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -1.1;
  key.shadow.camera.right = 1.1;
  key.shadow.camera.top = 1.1;
  key.shadow.camera.bottom = -1.1;
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 8;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  key.target.position.set(0, H / 2, 0);
  scene.add(key, key.target);
  const fill = new DirectionalLight(0xffffff);
  fill.position.set(3, 1.2, -0.6);
  scene.add(fill);
  // A near light above the front so each face brightens toward the top, as a
  // room light falls off — flat directional light alone reads as a diagram.
  const glow = new PointLight(0xffffff, 0, 0, 2);
  glow.position.set(-1.1, H + 0.6, D + 0.9);
  scene.add(glow);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  const target = new Vector3(0, HEIGHT / 2, 0);

  return {
    renderer,
    scene,
    camera,
    target,
    pivot,
    drawer,
    slide,
    contact,
    outlines,
    ambient,
    key,
    fill,
    glow,
    materials
  };
}

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function createContactShadow(scene: Scene, hidden: Object3D[]): ContactShadow {
  const options = { depthBuffer: true, generateMipmaps: false };
  const target = new WebGLRenderTarget(
    CONTACT_RESOLUTION,
    CONTACT_RESOLUTION,
    options
  );
  const blurTarget = new WebGLRenderTarget(
    CONTACT_RESOLUTION,
    CONTACT_RESOLUTION,
    options
  );

  // Looks straight up from the floor; its image's up is +z, right is +x.
  const half = CONTACT_SIZE / 2;
  const camera = new OrthographicCamera(
    -half,
    half,
    half,
    -half,
    0,
    CONTACT_HEIGHT
  );
  camera.rotation.x = Math.PI / 2;
  scene.add(camera);

  // Black, with alpha falling off by height above the floor. The power curve
  // keeps a surface a hand's width up from casting as dark as the feet.
  const depth = new MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4( vec3( 1.0 - fragCoordZ ), opacity );",
      "vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 2.5 ) );"
    );
  };

  const blurMaterial = (fragmentShader: string, direction: "h" | "v") =>
    new ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, [direction]: { value: 0 } },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false
    });
  const horizontal = blurMaterial(HorizontalBlurShader.fragmentShader, "h");
  const vertical = blurMaterial(VerticalBlurShader.fragmentShader, "v");
  const quad = new Mesh(new PlaneGeometry(2, 2), horizontal);
  quad.frustumCulled = false;

  const blur = (renderer: WebGLRenderer, amount: number) => {
    quad.material = horizontal;
    horizontal.uniforms.tDiffuse!.value = target.texture;
    horizontal.uniforms.h!.value = amount / CONTACT_RESOLUTION;
    renderer.setRenderTarget(blurTarget);
    renderer.render(quad, camera);
    quad.material = vertical;
    vertical.uniforms.tDiffuse!.value = blurTarget.texture;
    vertical.uniforms.v!.value = amount / CONTACT_RESOLUTION;
    renderer.setRenderTarget(target);
    renderer.render(quad, camera);
  };

  const material = new MeshBasicMaterial({
    map: target.texture,
    transparent: true,
    depthWrite: false
  });
  const floor = new Mesh(
    new PlaneGeometry(CONTACT_SIZE, CONTACT_SIZE),
    material
  );
  floor.rotation.x = -Math.PI / 2;
  // The camera sees the floor mirrored; flipping v puts each shadow under its
  // own part.
  floor.scale.y = -1;
  floor.position.y = 0.001;
  floor.renderOrder = -1;
  scene.add(floor);

  const shadowCasters = [...hidden, floor];

  return {
    material,
    render(renderer, renderScene) {
      const visible = shadowCasters.map((object) => object.visible);
      for (const object of shadowCasters) object.visible = false;
      renderScene.overrideMaterial = depth;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(renderScene, camera);
      renderScene.overrideMaterial = null;
      shadowCasters.forEach((object, i) => {
        object.visible = visible[i]!;
      });
      blur(renderer, CONTACT_BLUR);
      blur(renderer, CONTACT_BLUR * 0.4);
      renderer.setRenderTarget(null);
    }
  };
}

let probe: CanvasRenderingContext2D | null = null;

function cssColor(element: Element, name: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (!value) return new Color(fallback);
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return new Color(fallback);
  probe.fillStyle = fallback;
  probe.fillStyle = value;
  return new Color().setStyle(probe.fillStyle);
}

function readPalette(element: Element): Palette {
  const background = cssColor(element, "--color-background", "#ffffff");
  const foreground = cssColor(element, "--color-foreground", "#09090b");
  const dark = background.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
  const mix = (amount: number) => background.clone().lerp(foreground, amount);
  return {
    steel: mix(dark ? 0.12 : 0.09),
    card: mix(dark ? 0.82 : 0),
    handle: mix(dark ? 0.78 : 0.72),
    ink: mix(dark ? 0.25 : 0.5),
    foot: mix(dark ? 0.04 : 0.55),
    edge: mix(dark ? 0.42 : 0.62),
    dark
  };
}

function applyPalette(s: Shared, palette: Palette) {
  s.materials.steel.color.copy(palette.steel);
  s.materials.card.color.copy(palette.card);
  s.materials.foot.color.copy(palette.foot);
  s.materials.handle.color.copy(palette.handle);
  s.materials.rail.color
    .copy(palette.steel)
    .multiplyScalar(palette.dark ? 1.4 : 0.92);
  s.materials.ink.color.copy(palette.ink);
  s.materials.edge.color.copy(palette.edge);
  s.materials.edge.opacity = palette.dark ? 0.5 : 0.42;
  s.contact.material.opacity = palette.dark ? 0.7 : 0.36;
  // Physically based lights: an intensity of π returns a surface's own colour.
  const boost = palette.dark ? 1.25 : 1;
  s.ambient.intensity = Math.PI * 0.42 * boost;
  s.key.intensity = Math.PI * 0.55 * boost;
  s.fill.intensity = Math.PI * 0.07 * boost;
  s.glow.intensity = Math.PI * 1.3 * boost;
}

function draw(
  s: Shared,
  context: CanvasRenderingContext2D,
  palette: Palette,
  view: View
) {
  const { width, height } = context.canvas;
  if (
    s.renderer.domElement.width !== width ||
    s.renderer.domElement.height !== height
  ) {
    s.renderer.setSize(width, height, false);
  }
  // Orthographic camera on a sphere around the middle of the cabinet, framed
  // so no yaw clips the cabinet or its shadow: the cabinet sweeps a cylinder
  // (wider at the floor, where the shadow spreads), and on screen a cylinder's
  // rim reaches its radius across and half its height × cos(pitch) + radius ×
  // sin(pitch) up and down. Spinning never zooms; tilting steeply zooms out
  // only as far as the taller silhouette needs.
  const pad = 0.03;
  const halfWidth = FLOOR_REACH + pad;
  const halfHeight =
    (HEIGHT / 2) * Math.cos(view.pitch) +
    FLOOR_REACH * Math.sin(view.pitch) +
    pad;
  const scale = Math.max((2 * halfWidth) / width, (2 * halfHeight) / height);
  s.camera.left = -(width * scale) / 2;
  s.camera.right = (width * scale) / 2;
  s.camera.top = (height * scale) / 2;
  s.camera.bottom = -(height * scale) / 2;
  s.camera.updateProjectionMatrix();
  s.camera.position.set(
    s.target.x + 6 * Math.cos(view.pitch) * Math.SQRT1_2,
    s.target.y + 6 * Math.sin(view.pitch),
    s.target.z + 6 * Math.cos(view.pitch) * Math.SQRT1_2
  );
  s.camera.lookAt(s.target);

  applyPalette(s, palette);
  s.pivot.rotation.y = view.yaw;
  s.drawer.position.z = view.travel * TRAVEL;
  s.slide.position.z = (view.travel * TRAVEL) / 2;
  s.scene.updateMatrixWorld();
  s.contact.render(s.renderer, s.scene);
  s.renderer.render(s.scene, s.camera);
  context.clearRect(0, 0, width, height);
  context.drawImage(s.renderer.domElement, 0, 0, width, height);
}

/**
 * Plays the drawer opening on `canvas` (sized by the caller in device pixels),
 * lets the pointer turn the cabinet, and keeps the frame in step with the
 * theme. Returns a disposer, or `null` when WebGL is unavailable.
 */
export function playCabinet(
  canvas: HTMLCanvasElement,
  { animate = true }: { animate?: boolean } = {}
): (() => void) | null {
  const s = getShared();
  const context = canvas.getContext("2d");
  if (!s || !context) return null;

  let palette = readPalette(canvas);
  const view: View = {
    travel: animate ? 0 : 1,
    yaw: 0,
    pitch: REST_PITCH
  };
  let opening = animate;
  let start: number | undefined;
  let last: number | undefined;
  let frame = 0;

  // Drag turns it; let go and it keeps spinning, slowing to a stop.
  let pointer: { id: number; x: number; y: number; time: number } | null = null;
  let spin = 0;

  const tick = (now: number) => {
    frame = 0;
    const dt = last === undefined ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    let moving = false;
    if (opening) {
      start ??= now;
      const elapsed = (now - start) / 1000;
      view.travel = drawerTravel(elapsed);
      opening = elapsed < DURATION;
      moving ||= opening;
    }
    if (!pointer && spin !== 0) {
      view.yaw += spin * dt;
      spin *= Math.exp(-SPIN_DAMPING * dt);
      if (Math.abs(spin) < 0.05) spin = 0;
      moving ||= spin !== 0;
    }
    draw(s, context, palette, view);
    if (moving) frame = requestAnimationFrame(tick);
    else last = undefined;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp
    };
    spin = 0;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const dt = Math.max(1, event.timeStamp - pointer.time) / 1000;
    view.yaw += dx * DRAG_SPEED;
    view.pitch = Math.min(
      MAX_PITCH,
      Math.max(MIN_PITCH, view.pitch + dy * DRAG_SPEED)
    );
    // Smoothed, so the release speed is the gesture's and not its last event's.
    spin = spin * 0.6 + ((dx * DRAG_SPEED) / dt) * 0.4;
    pointer = {
      ...pointer,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp
    };
    schedule();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    // A pause before letting go means no fling.
    if (event.timeStamp - pointer.time > 80) spin = 0;
    pointer = null;
    schedule();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  if (animate) draw(s, context, palette, view);
  schedule();

  const observer = new MutationObserver(() => {
    palette = readPalette(canvas);
    schedule();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"]
  });

  return () => {
    observer.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    if (frame) cancelAnimationFrame(frame);
  };
}
