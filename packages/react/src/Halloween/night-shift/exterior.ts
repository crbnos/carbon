// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hill at night, back to front: the sky (sky.ts), the hill (hill.ts), the
// plant (plant.ts) and the Great Lighting (great-lighting.ts). Every part is
// drawn from the scene alone (the moment, the seconds and who is watching),
// so any instant of the story can be rendered cold.

import { drawGreatLighting } from "./great-lighting";
import {
  drawDance,
  drawFence,
  drawGhost,
  drawGround,
  drawHills,
  drawPatch,
  drawPath,
  drawProcession,
  drawStones
} from "./hill";
import { drawBong, drawCraneAndHero, drawFactory } from "./plant";
import type { Scene } from "./scene";
import {
  dawnAt,
  drawBats,
  drawHorseman,
  drawLightning,
  drawMoon,
  drawRain,
  drawSkyVisitor,
  drawStars
} from "./sky";

export function drawExterior(scene: Scene) {
  const dawn = dawnAt(scene);
  drawStars(scene, dawn);
  drawMoon(scene, dawn);
  drawSkyVisitor(scene);
  drawBats(scene);
  drawHills(scene, dawn);
  drawHorseman(scene);
  drawGround(scene, dawn);
  drawPath(scene);
  drawStones(scene);
  drawFactory(scene, dawn);
  drawCraneAndHero(scene);
  drawFence(scene);
  drawPatch(scene);
  drawProcession(scene);
  drawGhost(scene);
  drawDance(scene);
  drawGreatLighting(scene);
  drawBong(scene);
  drawRain(scene);
  const flash = drawLightning(scene);
  return { dawn, flash };
}
