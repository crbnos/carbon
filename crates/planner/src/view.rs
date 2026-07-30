//! Mesh-precise per-step view directions, baked into plan.json.
//!
//! Picks the camera direction with the clearest actual-triangle sight line to
//! a step's action (the seated part plus its travel). An AABB-only occlusion
//! test cannot do this job: a container's box CONTAINS the seat of the part
//! going into it, so every direction looks equally blocked and the choice
//! degenerates to tie-breakers — the BCU's PCB-into-enclosure step picked a
//! view straight through the box wall. Only rays against real triangles can
//! tell "through the open top" from "through a wall".
//!
//! The planner is the right home: it holds every tessellated mesh and the
//! authoritative install sequence (occluders for step i = bodies installed
//! before i). The viewer applies the baked direction with LIVE framing math
//! (target, standing distance, frustum fit with the real viewport aspect).

use crate::types::{Component, Mesh, Motion};
use nalgebra::Vector3;
use rayon::prelude::*;

/// Stage-1 candidates kept for full-ray rescoring.
const REFINE_TOP: usize = 8;
/// Blocked sight lines dominate the preference terms.
const BLOCK_WEIGHT: f64 = 10.0;
/// Penalty for travel running into the screen instead of across it.
const TRAVEL_INTO_SCREEN_WEIGHT: f64 = 4.0;

/// Where a body starts relative to its seated pose; `None` if it doesn't move.
fn travel_start_offset(motion: &Motion) -> Option<Vector3<f64>> {
    match motion {
        Motion::None => None,
        Motion::Linear { direction, distance } => {
            let d = Vector3::from_column_slice(direction);
            let n = d.norm();
            (n > 1e-9).then(|| d * (-distance / n))
        }
        Motion::L { segments } => {
            let mut offset = Vector3::zeros();
            for segment in segments {
                let d = Vector3::from_column_slice(&segment.direction);
                let n = d.norm();
                if n > 1e-9 {
                    offset += d * (-segment.distance / n);
                }
            }
            (offset.norm() > 1e-9).then_some(offset)
        }
    }
}

/// Dominant travel direction; `None` if the body doesn't move.
fn travel_direction(motion: &Motion) -> Option<Vector3<f64>> {
    match motion {
        Motion::None => None,
        Motion::Linear { direction, .. } => {
            let d = Vector3::from_column_slice(direction);
            let n = d.norm();
            (n > 1e-9).then(|| d / n)
        }
        Motion::L { segments } => segments
            .iter()
            .max_by(|a, b| a.distance.abs().total_cmp(&b.distance.abs()))
            .and_then(|s| {
                let d = Vector3::from_column_slice(&s.direction);
                let n = d.norm();
                (n > 1e-9).then(|| d / n)
            }),
    }
}

/// Slab test: does the segment origin→end pass through the AABB? The segment
/// stops just short of the end so geometry AT the sample point (the seat the
/// part rests on) doesn't read as blocking it.
fn segment_hits_aabb(
    origin: &Vector3<f64>,
    end: &Vector3<f64>,
    min: &Vector3<f64>,
    max: &Vector3<f64>,
) -> bool {
    let mut t_min = 0.0f64;
    let mut t_max = 0.98f64;
    for axis in 0..3 {
        let o = origin[axis];
        let delta = end[axis] - o;
        if delta.abs() < 1e-9 {
            if o < min[axis] || o > max[axis] {
                return false;
            }
            continue;
        }
        let mut t_near = (min[axis] - o) / delta;
        let mut t_far = (max[axis] - o) / delta;
        if t_near > t_far {
            std::mem::swap(&mut t_near, &mut t_far);
        }
        t_min = t_min.max(t_near);
        t_max = t_max.min(t_far);
        if t_min > t_max {
            return false;
        }
    }
    true
}

/// Möller–Trumbore for one triangle: does the segment origin→(origin+dir) cross
/// it inside t ∈ (1e-9, 0.98)? `dir` is the full segment vector (end − origin).
fn triangle_hit(
    origin: &Vector3<f64>,
    dir: &Vector3<f64>,
    a: &Vector3<f64>,
    b: &Vector3<f64>,
    c: &Vector3<f64>,
) -> bool {
    let e1 = b - a;
    let e2 = c - a;
    let p = dir.cross(&e2);
    let det = e1.dot(&p);
    if det.abs() < 1e-12 {
        return false;
    }
    let inv_det = 1.0 / det;
    let s = origin - a;
    let u = s.dot(&p) * inv_det;
    if !(0.0..=1.0).contains(&u) {
        return false;
    }
    let q = s.cross(&e1);
    let v = dir.dot(&q) * inv_det;
    if v < 0.0 || u + v > 1.0 {
        return false;
    }
    let t = e2.dot(&q) * inv_det;
    t > 1e-9 && t < 0.98
}

/// Blocked weight on the sight line eye→point. AABB broadphase per occluder,
/// then a BVH-accelerated triangle test; `installed` count at full weight,
/// `future` (hidden/ghosted at playback) at a low weight so a view that also
/// clears the "show all" toggle wins ties without dominating.
fn blocked_weight(
    eye: &Vector3<f64>,
    point: &Vector3<f64>,
    installed: &[&Component],
    future: &[&Component],
) -> f64 {
    let hits = |group: &[&Component]| -> usize {
        group
            .iter()
            .filter(|occ| {
                segment_hits_aabb(eye, point, &occ.bbox_min, &occ.bbox_max)
                    && occ.view_bvh().ray_hits(eye, point)
            })
            .count()
    };
    hits(installed) as f64 + FUTURE_OCCLUDER_WEIGHT * hits(future) as f64
}

/// Weight of a not-yet-installed occluder (hidden/ghosted by default; matches
/// the viewer's ghost opacity semantics).
const FUTURE_OCCLUDER_WEIGHT: f64 = 0.3;

/// A median-split triangle BVH for repeated ray-vs-mesh sight-line tests.
/// The FCL BVH on `Component` is collision-only (no ray query in the bridge),
/// so view baking builds its own. Verdict is identical to a linear triangle
/// walk — only faster (occluder meshes reach ~200k triangles and each is hit
/// by hundreds of rays across the candidate search).
pub struct TriBvh {
    verts: Vec<Vector3<f64>>,
    /// Triangle vertex indices, reordered so each node owns a contiguous range.
    tris: Vec<[u32; 3]>,
    nodes: Vec<BvhNode>,
}

struct BvhNode {
    min: Vector3<f64>,
    max: Vector3<f64>,
    /// Leaf (`count > 0`): triangle range [start, start+count) into `tris`.
    /// Interior (`count == 0`): `start` = left child index, `right` = right
    /// child index. The right child is NOT left+1 — the left subtree pushes its
    /// own descendants first — so both indices are stored explicitly.
    start: u32,
    right: u32,
    count: u32,
}

const BVH_LEAF_TRIS: usize = 8;

impl TriBvh {
    pub fn build(mesh: &Mesh) -> TriBvh {
        let verts = mesh.vertices.clone();
        let tris = mesh.faces.clone();
        let mut bvh = TriBvh {
            verts,
            tris,
            nodes: Vec::new(),
        };
        if bvh.tris.is_empty() {
            return bvh;
        }
        let count = bvh.tris.len();
        bvh.nodes.reserve(2 * count / BVH_LEAF_TRIS + 1);
        bvh.build_node(0, count);
        bvh
    }

    /// Build a node over tris[start..start+count), return its index.
    fn build_node(&mut self, start: usize, count: usize) -> u32 {
        let (mut min, mut max) = (
            Vector3::repeat(f64::INFINITY),
            Vector3::repeat(f64::NEG_INFINITY),
        );
        for tri in &self.tris[start..start + count] {
            for &vi in tri {
                let v = &self.verts[vi as usize];
                min = min.inf(v);
                max = max.sup(v);
            }
        }
        let index = self.nodes.len() as u32;
        self.nodes.push(BvhNode {
            min,
            max,
            start: start as u32,
            right: 0,
            count: count as u32,
        });
        if count <= BVH_LEAF_TRIS {
            return index;
        }
        // Split along the widest extent at the centroid median.
        let extent = max - min;
        let axis = if extent.x >= extent.y && extent.x >= extent.z {
            0
        } else if extent.y >= extent.z {
            1
        } else {
            2
        };
        let centroid = |tri: &[u32; 3]| -> f64 {
            (self.verts[tri[0] as usize][axis]
                + self.verts[tri[1] as usize][axis]
                + self.verts[tri[2] as usize][axis])
                / 3.0
        };
        let mid = start + count / 2;
        self.tris[start..start + count]
            .select_nth_unstable_by(count / 2, |a, b| {
                centroid(a).total_cmp(&centroid(b))
            });
        // Degenerate split (all centroids equal) → keep as a leaf.
        if mid == start || mid == start + count {
            self.nodes[index as usize].count = count as u32;
            return index;
        }
        self.nodes[index as usize].count = 0;
        let left = self.build_node(start, mid - start);
        let right = self.build_node(mid, start + count - mid);
        self.nodes[index as usize].start = left;
        self.nodes[index as usize].right = right;
        index
    }

    /// Does the segment eye→point cross any triangle inside t ∈ (1e-9, 0.98)?
    pub fn ray_hits(&self, eye: &Vector3<f64>, point: &Vector3<f64>) -> bool {
        if self.nodes.is_empty() {
            return false;
        }
        let dir = point - eye;
        let mut stack = [0u32; 64];
        let mut sp = 0usize;
        stack[sp] = 0;
        sp += 1;
        while sp > 0 {
            sp -= 1;
            let node = &self.nodes[stack[sp] as usize];
            if !segment_hits_aabb(eye, point, &node.min, &node.max) {
                continue;
            }
            if node.count > 0 {
                let range = node.start as usize..(node.start + node.count) as usize;
                for tri in &self.tris[range] {
                    let a = &self.verts[tri[0] as usize];
                    let b = &self.verts[tri[1] as usize];
                    let c = &self.verts[tri[2] as usize];
                    if triangle_hit(eye, &dir, a, b, c) {
                        return true;
                    }
                }
            } else if sp + 2 <= stack.len() {
                stack[sp] = node.start;
                sp += 1;
                stack[sp] = node.right;
                sp += 1;
            }
        }
        false
    }
}

/// ~48 unit directions on the upper hemisphere (Z-up CAD models), Fibonacci
/// spiral over elevation z ∈ [0.15, 0.92] — low grazing views and the exact
/// zenith (degenerate camera up) are both excluded.
fn candidate_directions() -> Vec<Vector3<f64>> {
    const COUNT: usize = 48;
    const GOLDEN_ANGLE: f64 = 2.399963229728653; // π(3 − √5)
    (0..COUNT)
        .map(|i| {
            let z = 0.15 + (0.92 - 0.15) * (i as f64 + 0.5) / COUNT as f64;
            let r = (1.0 - z * z).sqrt();
            let azimuth = GOLDEN_ANGLE * i as f64;
            Vector3::new(r * azimuth.cos(), r * azimuth.sin(), z)
        })
        .collect()
}

/// The 8 corners of a bbox, optionally translated.
fn corners(min: &Vector3<f64>, max: &Vector3<f64>, offset: Option<&Vector3<f64>>) -> Vec<Vector3<f64>> {
    (0..8)
        .map(|i| {
            let mut corner = Vector3::new(
                if i & 1 != 0 { max.x } else { min.x },
                if i & 2 != 0 { max.y } else { min.y },
                if i & 4 != 0 { max.z } else { min.z },
            );
            if let Some(o) = offset {
                corner += o;
            }
            corner
        })
        .collect()
}

/// The clearest view direction for one planned body: sight lines from the
/// standing-distance eye to the seated body and its travel, rays against the
/// occluders' real triangles. `installed` are the bodies present when this one
/// animates (full weight); `future` are the not-yet-installed bodies (low
/// weight — hidden/ghosted at playback, but a direction that also clears them
/// survives the viewer's "show all" toggle). Mirrors the viewer's framing
/// geometry (target = assembly center nudged 30% toward the subject;
/// whole-assembly standing distance) so the direction transfers to the live
/// camera. Returns the chosen unit direction and its obstruction (0 = every
/// sight line clear; grows as the winning view is still blocked — the signal
/// for "this step's action is inherently hidden").
pub fn best_view_direction(
    subject: &Component,
    motion: &Motion,
    installed: &[&Component],
    future: &[&Component],
    assembly_min: &Vector3<f64>,
    assembly_max: &Vector3<f64>,
) -> ([f64; 3], f64) {
    let subject_center = (subject.bbox_min + subject.bbox_max) * 0.5;
    let assembly_center = (assembly_min + assembly_max) * 0.5;
    let assembly_radius = ((assembly_max - assembly_min).norm() / 2.0).max(1e-6);
    // fov 45°, framed at 1.25× — the viewer's standing-distance formula
    let distance = (assembly_radius / (22.5f64.to_radians().tan()) * 1.25)
        .max(assembly_radius * 2.0);
    let target = assembly_center.lerp(&subject_center, 0.3);

    let start_offset = travel_start_offset(motion);
    let travel = travel_direction(motion);

    // Full sample set: center + seated corners + travel start/midpoint
    let mut points: Vec<Vector3<f64>> = vec![subject_center];
    points.extend(corners(&subject.bbox_min, &subject.bbox_max, None));
    if let Some(offset) = &start_offset {
        points.push(subject_center + offset * 0.5);
        points.push(subject_center + offset);
    }
    // Cheap stage-1 set: the ends of the action. A seated part (no travel)
    // still needs more than its center — one ray can't tell a clear approach
    // from a blocked one — so seed two opposite corners.
    let coarse: Vec<Vector3<f64>> = match &start_offset {
        Some(offset) => vec![subject_center, subject_center + offset],
        None => vec![subject.bbox_min, subject_center, subject.bbox_max],
    };

    let preference = |candidate: &Vector3<f64>| -> f64 {
        match &travel {
            // Prefer travel running across the screen, not into it
            Some(t) => TRAVEL_INTO_SCREEN_WEIGHT * (candidate.dot(t).abs() - 0.6).max(0.0),
            None => 0.0,
        }
    };

    // Mean blocked weight per sample point (0 when every sight line is clear).
    let obstruction_of = |candidate: &Vector3<f64>, samples: &[Vector3<f64>]| -> f64 {
        let eye = target + candidate * distance;
        samples
            .iter()
            .map(|point| blocked_weight(&eye, point, installed, future))
            .sum::<f64>()
            / samples.len() as f64
    };
    let score_with = |candidate: &Vector3<f64>, samples: &[Vector3<f64>]| -> f64 {
        BLOCK_WEIGHT * obstruction_of(candidate, samples) + preference(candidate)
    };

    let candidates = candidate_directions();
    let mut coarse_scores: Vec<(f64, usize)> = candidates
        .par_iter()
        .enumerate()
        .map(|(index, candidate)| (score_with(candidate, &coarse), index))
        .collect();
    coarse_scores.sort_by(|a, b| a.0.total_cmp(&b.0));

    let best = coarse_scores
        .iter()
        .take(REFINE_TOP)
        .map(|&(_, index)| index)
        .collect::<Vec<_>>()
        .into_par_iter()
        .map(|index| (score_with(&candidates[index], &points), index))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, index)| index)
        .unwrap_or(0);

    let direction = candidates[best];
    let obstruction = obstruction_of(&direction, &points);
    ([direction.x, direction.y, direction.z], obstruction)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Mesh;

    /// Axis-aligned solid slab as a 12-triangle mesh.
    fn slab(min: Vector3<f64>, max: Vector3<f64>) -> Mesh {
        let v = |x: f64, y: f64, z: f64| Vector3::new(x, y, z);
        let vertices = vec![
            v(min.x, min.y, min.z),
            v(max.x, min.y, min.z),
            v(max.x, max.y, min.z),
            v(min.x, max.y, min.z),
            v(min.x, min.y, max.z),
            v(max.x, min.y, max.z),
            v(max.x, max.y, max.z),
            v(min.x, max.y, max.z),
        ];
        let faces: Vec<[u32; 3]> = vec![
            [0, 2, 1],
            [0, 3, 2], // bottom
            [4, 5, 6],
            [4, 6, 7], // top
            [0, 1, 5],
            [0, 5, 4], // -y
            [2, 3, 7],
            [2, 7, 6], // +y
            [0, 4, 7],
            [0, 7, 3], // -x
            [1, 2, 6],
            [1, 6, 5], // +x
        ];
        Mesh { vertices, faces }
    }

    fn component(name: &str, mesh: Mesh) -> Component {
        let (bbox_min, bbox_max) = mesh.bbox();
        Component::new(name.to_string(), name.to_string(), mesh, bbox_min, bbox_max, false)
    }

    /// Hollow open-top box (4 walls + floor) around a small subject cube: the
    /// BCU failure. Every AABB-only score ties (the box's bbox contains the
    /// subject); only triangle rays discover the open top.
    #[test]
    fn picks_the_open_top_of_a_hollow_box() {
        let walls = [
            slab(Vector3::new(-50.0, -50.0, 0.0), Vector3::new(-45.0, 50.0, 80.0)),
            slab(Vector3::new(45.0, -50.0, 0.0), Vector3::new(50.0, 50.0, 80.0)),
            slab(Vector3::new(-50.0, -50.0, 0.0), Vector3::new(50.0, -45.0, 80.0)),
            slab(Vector3::new(-50.0, 45.0, 0.0), Vector3::new(50.0, 50.0, 80.0)),
            slab(Vector3::new(-50.0, -50.0, -5.0), Vector3::new(50.0, 50.0, 0.0)),
        ];
        let occluders: Vec<Component> = walls
            .into_iter()
            .enumerate()
            .map(|(i, mesh)| component(&format!("wall{i}"), mesh))
            .collect();
        let occluder_refs: Vec<&Component> = occluders.iter().collect();

        let subject = component(
            "pcb",
            slab(Vector3::new(-20.0, -20.0, 5.0), Vector3::new(20.0, 20.0, 10.0)),
        );
        // Drops straight down into the box
        let motion = Motion::Linear {
            direction: [0.0, 0.0, -1.0],
            distance: 120.0,
        };

        let (direction, obstruction) = best_view_direction(
            &subject,
            &motion,
            &occluder_refs,
            &[],
            &Vector3::new(-50.0, -50.0, -5.0),
            &Vector3::new(50.0, 50.0, 80.0),
        );
        // The only clear sight line into the box interior is from high above
        assert!(
            direction[2] > 0.6,
            "expected a steep top-down view, got {direction:?}"
        );
        // Open top → the chosen view sees the action; obstruction stays low.
        assert!(
            obstruction < 0.5,
            "open-top box should have a mostly-clear view, got {obstruction}"
        );
    }

    /// Sealed box: every direction is blocked — must still return a sane unit
    /// direction (least-blocked) without panicking.
    #[test]
    fn sealed_box_still_returns_a_direction() {
        let mut walls = vec![
            slab(Vector3::new(-50.0, -50.0, 0.0), Vector3::new(-45.0, 50.0, 80.0)),
            slab(Vector3::new(45.0, -50.0, 0.0), Vector3::new(50.0, 50.0, 80.0)),
            slab(Vector3::new(-50.0, -50.0, 0.0), Vector3::new(50.0, -45.0, 80.0)),
            slab(Vector3::new(-50.0, 45.0, 0.0), Vector3::new(50.0, 50.0, 80.0)),
            slab(Vector3::new(-50.0, -50.0, -5.0), Vector3::new(50.0, 50.0, 0.0)),
        ];
        walls.push(slab(
            Vector3::new(-50.0, -50.0, 80.0),
            Vector3::new(50.0, 50.0, 85.0),
        ));
        let occluders: Vec<Component> = walls
            .into_iter()
            .enumerate()
            .map(|(i, mesh)| component(&format!("wall{i}"), mesh))
            .collect();
        let occluder_refs: Vec<&Component> = occluders.iter().collect();
        let subject = component(
            "pcb",
            slab(Vector3::new(-20.0, -20.0, 5.0), Vector3::new(20.0, 20.0, 10.0)),
        );
        let (direction, obstruction) = best_view_direction(
            &subject,
            &Motion::None,
            &occluder_refs,
            &[],
            &Vector3::new(-50.0, -50.0, -5.0),
            &Vector3::new(50.0, 50.0, 85.0),
        );
        let n = (direction[0] * direction[0]
            + direction[1] * direction[1]
            + direction[2] * direction[2])
            .sqrt();
        assert!((n - 1.0).abs() < 1e-6);
        // Fully enclosed → every sight line is blocked; obstruction is high,
        // and notably higher than the open-top box (the signal for "hidden").
        assert!(
            obstruction > 0.9,
            "sealed box should report near-total obstruction, got {obstruction}"
        );
    }

    /// No occluders at all: an unobstructed part must not get a view fighting
    /// its travel (travel across the screen, not into it).
    #[test]
    fn open_air_prefers_travel_across_the_screen() {
        let subject = component(
            "bracket",
            slab(Vector3::new(-10.0, -10.0, 0.0), Vector3::new(10.0, 10.0, 10.0)),
        );
        let motion = Motion::Linear {
            direction: [1.0, 0.0, 0.0],
            distance: 50.0,
        };
        let (direction, obstruction) = best_view_direction(
            &subject,
            &motion,
            &[],
            &[],
            &Vector3::new(-100.0, -100.0, -10.0),
            &Vector3::new(100.0, 100.0, 50.0),
        );
        // |dot(view, +X travel)| stays under the 0.6 penalty knee
        assert!(
            direction[0].abs() < 0.7,
            "view fights the travel direction: {direction:?}"
        );
        // Nothing in the way → perfectly clear.
        assert_eq!(obstruction, 0.0);
    }

    /// The triangle BVH must return the exact same hit/no-hit verdict as a
    /// brute-force triangle walk — it's a pure speedup, not an approximation.
    /// Uses a MANY-slab scene so the tree is several levels deep with interior
    /// children: a shallow two-leaf tree hides right-child indexing bugs.
    #[test]
    fn bvh_matches_brute_force() {
        // 27 scattered slabs → hundreds of triangles → a multi-level BVH.
        let mut vertices = Vec::new();
        let mut faces = Vec::new();
        for gx in -1..=1 {
            for gy in -1..=1 {
                for gz in -1..=1 {
                    let c = Vector3::new(gx as f64 * 40.0, gy as f64 * 40.0, gz as f64 * 40.0);
                    let s = slab(c - Vector3::repeat(8.0), c + Vector3::repeat(8.0));
                    let base = vertices.len() as u32;
                    vertices.extend(s.vertices);
                    faces.extend(s.faces.iter().map(|f| [f[0] + base, f[1] + base, f[2] + base]));
                }
            }
        }
        let mesh = Mesh { vertices, faces };
        assert!(mesh.faces.len() > 4 * BVH_LEAF_TRIS, "scene must force a deep tree");
        let bvh = TriBvh::build(&mesh);
        let brute = |eye: &Vector3<f64>, point: &Vector3<f64>| -> bool {
            let dir = point - eye;
            mesh.faces.iter().any(|f| {
                triangle_hit(
                    eye,
                    &dir,
                    &mesh.vertices[f[0] as usize],
                    &mesh.vertices[f[1] as usize],
                    &mesh.vertices[f[2] as usize],
                )
            })
        };
        // A dense grid of segments through the scene: hits, misses, grazes.
        let coords = [-120.0, -40.0, -8.0, 0.0, 8.0, 40.0, 120.0];
        let mut any_hit = false;
        let mut any_miss = false;
        for &x in &coords {
            for &z in &coords {
                let eye = Vector3::new(x, -150.0, z);
                let point = Vector3::new(-x * 0.5, 150.0, z * 0.5);
                let bvh_hit = bvh.ray_hits(&eye, &point);
                assert_eq!(
                    bvh_hit,
                    brute(&eye, &point),
                    "BVH disagrees with brute force for {eye:?}->{point:?}"
                );
                any_hit |= bvh_hit;
                any_miss |= !bvh_hit;
            }
        }
        // Not vacuous: the grid must contain both hits and misses.
        assert!(any_hit && any_miss, "test rays must cover hit and miss");
    }
}
