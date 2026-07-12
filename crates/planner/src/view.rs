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

/// Möller–Trumbore, early-exit on the first triangle hit inside t ∈ (0, 0.98).
fn segment_hits_mesh(origin: &Vector3<f64>, end: &Vector3<f64>, mesh: &Mesh) -> bool {
    let dir = end - origin;
    for face in &mesh.faces {
        let a = &mesh.vertices[face[0] as usize];
        let b = &mesh.vertices[face[1] as usize];
        let c = &mesh.vertices[face[2] as usize];
        let e1 = b - a;
        let e2 = c - a;
        let p = dir.cross(&e2);
        let det = e1.dot(&p);
        if det.abs() < 1e-12 {
            continue;
        }
        let inv_det = 1.0 / det;
        let s = origin - a;
        let u = s.dot(&p) * inv_det;
        if !(0.0..=1.0).contains(&u) {
            continue;
        }
        let q = s.cross(&e1);
        let v = dir.dot(&q) * inv_det;
        if v < 0.0 || u + v > 1.0 {
            continue;
        }
        let t = e2.dot(&q) * inv_det;
        if t > 1e-9 && t < 0.98 {
            return true;
        }
    }
    false
}

/// How many occluders truly block the sight line eye→point. AABB broadphase,
/// then triangles.
fn blocked_count(
    eye: &Vector3<f64>,
    point: &Vector3<f64>,
    occluders: &[&Component],
) -> usize {
    occluders
        .iter()
        .filter(|occ| {
            segment_hits_aabb(eye, point, &occ.bbox_min, &occ.bbox_max)
                && segment_hits_mesh(eye, point, &occ.mesh)
        })
        .count()
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
/// occluders' real triangles. `occluders` are the bodies already installed
/// when this one animates. Mirrors the viewer's framing geometry (target =
/// assembly center nudged 30% toward the subject; whole-assembly standing
/// distance) so the direction transfers to the live camera.
pub fn best_view_direction(
    subject: &Component,
    motion: &Motion,
    occluders: &[&Component],
    assembly_min: &Vector3<f64>,
    assembly_max: &Vector3<f64>,
) -> [f64; 3] {
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
    // Cheap stage-1 set: the ends of the action
    let coarse: Vec<Vector3<f64>> = match &start_offset {
        Some(offset) => vec![subject_center, subject_center + offset],
        None => vec![subject_center],
    };

    let preference = |candidate: &Vector3<f64>| -> f64 {
        match &travel {
            // Prefer travel running across the screen, not into it
            Some(t) => TRAVEL_INTO_SCREEN_WEIGHT * (candidate.dot(t).abs() - 0.6).max(0.0),
            None => 0.0,
        }
    };

    let score_with = |candidate: &Vector3<f64>, samples: &[Vector3<f64>]| -> f64 {
        let eye = target + candidate * distance;
        let blocked: usize = samples
            .iter()
            .map(|point| blocked_count(&eye, point, occluders))
            .sum();
        BLOCK_WEIGHT * blocked as f64 / samples.len() as f64 + preference(candidate)
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
    [direction.x, direction.y, direction.z]
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

        let direction = best_view_direction(
            &subject,
            &motion,
            &occluder_refs,
            &Vector3::new(-50.0, -50.0, -5.0),
            &Vector3::new(50.0, 50.0, 80.0),
        );
        // The only clear sight line into the box interior is from high above
        assert!(
            direction[2] > 0.6,
            "expected a steep top-down view, got {direction:?}"
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
        let direction = best_view_direction(
            &subject,
            &Motion::None,
            &occluder_refs,
            &Vector3::new(-50.0, -50.0, -5.0),
            &Vector3::new(50.0, 50.0, 85.0),
        );
        let n = (direction[0] * direction[0]
            + direction[1] * direction[1]
            + direction[2] * direction[2])
            .sqrt();
        assert!((n - 1.0).abs() < 1e-6);
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
        let direction = best_view_direction(
            &subject,
            &motion,
            &[],
            &Vector3::new(-100.0, -100.0, -10.0),
            &Vector3::new(100.0, 100.0, 50.0),
        );
        // |dot(view, +X travel)| stays under the 0.6 penalty knee
        assert!(
            direction[0].abs() < 0.7,
            "view fights the travel direction: {direction:?}"
        );
    }
}
