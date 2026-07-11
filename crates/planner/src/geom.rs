//! Pure geometry helpers: volumes, symmetry axes (SVD), candidate directions,
//! structural sort key. Deterministic vector math, no collision library.

use crate::consts::{world_axes, EXIT_MARGIN_MM};
use crate::types::{Component, FastenerKind, Mesh};
use nalgebra::{DMatrix, Vector3};

/// Python's `round(x, ndigits)` — round half to even (banker's rounding).
pub fn round_py(x: f64, ndigits: i32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let factor = 10f64.powi(ndigits);
    let scaled = x * factor;
    let floor = scaled.floor();
    let diff = scaled - floor;
    let rounded = if (diff - 0.5).abs() < 1e-9 {
        // exactly halfway: round to even
        if (floor as i64) % 2 == 0 {
            floor
        } else {
            floor + 1.0
        }
    } else {
        scaled.round()
    };
    rounded / factor
}

/// Component-wise absolute value.
pub fn vabs(v: &Vector3<f64>) -> Vector3<f64> {
    Vector3::new(v[0].abs(), v[1].abs(), v[2].abs())
}

/// `_separation_distance`: translation along `direction` until the AABBs separate.
pub fn separation_distance(
    bbox_min: &Vector3<f64>,
    bbox_max: &Vector3<f64>,
    static_min: &Vector3<f64>,
    static_max: &Vector3<f64>,
    direction: &Vector3<f64>,
) -> f64 {
    let mut travel = f64::INFINITY;
    for axis in 0..3 {
        let d = direction[axis];
        if d > 1e-6 {
            let needed = static_max[axis] - bbox_min[axis];
            travel = travel.min((needed / d).max(0.0));
        } else if d < -1e-6 {
            let needed = bbox_max[axis] - static_min[axis];
            travel = travel.min((needed / -d).max(0.0));
        }
    }
    if travel == f64::INFINITY {
        0.0
    } else {
        travel
    }
}

/// `_exit_travel`: distance along `direction` until the part's AABB clears the assembly.
pub fn exit_travel(
    part: &Component,
    static_min: &Vector3<f64>,
    static_max: &Vector3<f64>,
    direction: &Vector3<f64>,
    base_offset: Option<&Vector3<f64>>,
) -> f64 {
    let zero = Vector3::zeros();
    let off = base_offset.unwrap_or(&zero);
    let bbox_min = part.bbox_min + off;
    let bbox_max = part.bbox_max + off;
    let mut travel = separation_distance(&bbox_min, &bbox_max, static_min, static_max, direction);
    let diagonal = (static_max - static_min).norm();
    travel = travel.min(diagonal * 1.5);
    let extent = vabs(direction).dot(&(bbox_max - bbox_min));
    travel.max(extent) + EXIT_MARGIN_MM
}

/// `_recorded_travel`: the travel to record for the animation.
pub fn recorded_travel(
    part: &Component,
    direction: &Vector3<f64>,
    full_travel: f64,
    last_touch: f64,
) -> f64 {
    let extent = vabs(direction).dot(&(part.bbox_max - part.bbox_min));
    round_py(full_travel.min(last_touch + extent + EXIT_MARGIN_MM), 3)
}

/// `_bbox_axis_kind`: rod/disc axis from bbox extents when SVD is inconclusive.
pub fn bbox_axis_kind(part: &Component) -> Option<(Vector3<f64>, FastenerKind)> {
    let extents = vabs(&(part.bbox_max - part.bbox_min));
    // argsort ascending
    let mut order = [0usize, 1, 2];
    order.sort_by(|&a, &b| extents[a].partial_cmp(&extents[b]).unwrap());
    let smallest = extents[order[0]];
    let mid = extents[order[1]];
    let largest = extents[order[2]];
    if mid <= 1e-9 {
        return None;
    }
    let mut axis = Vector3::zeros();
    if largest > 1.4 * mid {
        axis[order[2]] = 1.0;
        return Some((axis, FastenerKind::Rod));
    }
    if smallest < 0.6 * mid {
        axis[order[0]] = 1.0;
        return Some((axis, FastenerKind::Disc));
    }
    None
}

/// Snap a unit direction to a clean world axis when within 0.999 dot.
pub fn snap_to_world(axis: Vector3<f64>) -> Vector3<f64> {
    for w in world_axes() {
        if axis.dot(&w) > 0.999 {
            return w;
        }
    }
    axis
}

/// Signed mesh volume via the divergence theorem (abs).
fn signed_volume(mesh: &Mesh) -> f64 {
    let mut s = 0.0;
    for f in &mesh.faces {
        let a = &mesh.vertices[f[0] as usize];
        let b = &mesh.vertices[f[1] as usize];
        let c = &mesh.vertices[f[2] as usize];
        s += a.dot(&b.cross(c));
    }
    (s / 6.0).abs()
}

/// trimesh `is_watertight`: every sorted edge is shared by exactly two faces.
/// Pure integer logic — bit-exact across implementations. OCCT-tessellated parts
/// duplicate vertices per B-rep face, so real parts are essentially never
/// watertight (matching the Python service).
pub fn is_watertight(mesh: &Mesh) -> bool {
    if mesh.faces.is_empty() {
        return false;
    }
    let mut counts: std::collections::HashMap<(u32, u32), u32> = std::collections::HashMap::new();
    for f in &mesh.faces {
        for (a, b) in [(f[0], f[1]), (f[1], f[2]), (f[2], f[0])] {
            let key = if a <= b { (a, b) } else { (b, a) };
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts.values().all(|&c| c == 2)
}

/// `_part_volume`: material volume (mm³). Faithful to the DEPLOYED Python
/// service: watertight → mesh volume; otherwise the split-into-bodies fallback
/// RAISES there (trimesh's repair path needs networkx, absent from the service
/// deps) → `except: volume = 0.0` → **bbox volume**. Real OCCT-tessellated parts
/// are never watertight, so bbox volume is the production path (verified
/// bit-identical on real assemblies).
pub fn part_volume(part: &Component) -> f64 {
    if let Some(v) = part.cached_volume {
        return v;
    }
    *part.vol_cache.get_or_init(|| {
        let v = if is_watertight(&part.mesh) {
            signed_volume(&part.mesh)
        } else {
            0.0
        };
        if v > 1e-9 {
            return v;
        }
        let e = part.bbox_max - part.bbox_min;
        (e[0] * e[1] * e[2]).abs().max(1e-9)
    })
}

/// `_assembly_centroid`: bbox center over all parts.
pub fn assembly_centroid(parts: &[Component]) -> Vector3<f64> {
    let mut lo = Vector3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY);
    let mut hi = Vector3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in parts {
        lo = lo.inf(&p.bbox_min);
        hi = hi.sup(&p.bbox_max);
    }
    (lo + hi) / 2.0
}

/// `_structural_key`: (−volume, bucket) — big & central first (ascending key).
pub fn structural_key(part: &Component, centroid: &Vector3<f64>, diagonal: f64) -> (f64, f64) {
    let center = (part.bbox_min + part.bbox_max) / 2.0;
    let offset = center - centroid;
    let distance = offset[0].hypot(offset[1]);
    let bucket = round_py(distance / diagonal.max(1e-6) * 20.0, 0) / 20.0;
    (-part_volume(part), bucket)
}

/// `_symmetry_axis_kind`: rod/disc insertion axis via SVD of the vertex cloud.
/// numpy-matching: mean via numpy's pairwise summation, SVD via LAPACK dgesdd —
/// so the axis SIGN matches Python's (no canonicalization).
///
/// Memoized per Component: the SVD is pure in the mesh vertices, and the greedy
/// loop re-asks the same part every iteration. `Component::new` gives each part
/// (and merged unit) a fresh cell, so clones never carry a stale axis.
pub fn symmetry_axis_kind(part: &Component) -> Option<(Vector3<f64>, FastenerKind)> {
    *part
        .sym_axis_cache
        .get_or_init(|| symmetry_axis_kind_uncached(part))
}

fn symmetry_axis_kind_uncached(part: &Component) -> Option<(Vector3<f64>, FastenerKind)> {
    let verts = &part.mesh.vertices;
    if verts.len() < 3 {
        return None;
    }
    let mean = crate::npy::mean_rows(verts);
    let mut m = DMatrix::<f64>::zeros(verts.len(), 3);
    for (i, v) in verts.iter().enumerate() {
        let c = v - mean;
        m[(i, 0)] = c[0];
        m[(i, 1)] = c[1];
        m[(i, 2)] = c[2];
    }
    let (s, vt) = crate::npy::svd_rows(&m)?;
    let (s1, s2, s3) = (s[0], s[1], s[2]);
    if s2 <= 1e-9 {
        return None;
    }
    let row = |i: usize| Vector3::new(vt[(i, 0)], vt[(i, 1)], vt[(i, 2)]);
    let (axis, kind) = if s1 > 1.4 * s2 {
        (row(0), FastenerKind::Rod)
    } else if s3 > 1e-9 && s2 > 1.4 * s3 && s1 < 1.25 * s2 {
        (row(2), FastenerKind::Disc)
    } else {
        return None;
    };
    let norm = axis.norm();
    if norm <= 1e-9 {
        return None;
    }
    let axis = axis / norm;
    for w in world_axes() {
        if axis.dot(&w) > 0.999 {
            return Some((w, kind));
        }
    }
    Some((axis, kind))
}

pub fn symmetry_axis(part: &Component) -> Option<Vector3<f64>> {
    symmetry_axis_kind(part).map(|(a, _)| a)
}

/// `_normal_clusters`: dominant contact-normal directions (greedy clustering).
pub fn normal_clusters(normals: &[Vector3<f64>], top: usize) -> Vec<Vector3<f64>> {
    let mut clusters: Vec<(Vector3<f64>, usize)> = Vec::new();
    for normal in normals {
        let length = normal.norm();
        if length <= 1e-9 {
            continue;
        }
        let unit = normal / length;
        let mut matched = false;
        for c in clusters.iter_mut() {
            if c.0.dot(&unit).abs() > 0.95 {
                c.1 += 1;
                matched = true;
                break;
            }
        }
        if !matched {
            clusters.push((unit, 1));
        }
    }
    clusters.sort_by(|a, b| b.1.cmp(&a.1));
    let mut results = Vec::new();
    for (center, _) in clusters.into_iter().take(top) {
        let mut snapped = center;
        for w in world_axes() {
            let d = center.dot(&w);
            if d.abs() > 0.999 {
                snapped = if d > 0.0 { w } else { -w };
                break;
            }
        }
        results.push(snapped);
    }
    results
}

/// `_candidate_directions`: removal directions to try, most natural first.
pub fn candidate_directions(part: &Component) -> Vec<Vector3<f64>> {
    let mut candidates: Vec<Vector3<f64>> = Vec::new();
    if let Some(axis) = symmetry_axis(part) {
        candidates.push(axis);
        candidates.push(-axis);
    }
    for normal in normal_clusters(&part.contact_normals, 3) {
        for candidate in [normal, -normal] {
            if candidates.iter().all(|c| candidate.dot(c) < 0.999) {
                candidates.push(candidate);
            }
        }
    }
    for w in world_axes() {
        if candidates.iter().all(|c| w.dot(c) < 0.999) {
            candidates.push(w);
        }
    }
    candidates
}

/// `_axis_from_contacts`: bore axis from a cylindrical band of contact points.
pub fn axis_from_contacts(points: &[Vector3<f64>]) -> Option<Vector3<f64>> {
    if points.len() < 8 {
        return None;
    }
    let mean = crate::npy::mean_rows(points);
    let mut m = DMatrix::<f64>::zeros(points.len(), 3);
    for (i, p) in points.iter().enumerate() {
        let c = p - mean;
        m[(i, 0)] = c[0];
        m[(i, 1)] = c[1];
        m[(i, 2)] = c[2];
    }
    let (_s, vt) = crate::npy::svd_rows(&m)?;
    let row = |i: usize| Vector3::new(vt[(i, 0)], vt[(i, 1)], vt[(i, 2)]);
    let mut candidates = vec![row(0), row(2)];
    candidates.extend(world_axes());

    let centered: Vec<Vector3<f64>> = points.iter().map(|p| p - mean).collect();
    let mut best_axis: Option<Vector3<f64>> = None;
    let mut best_spread = f64::INFINITY;
    for candidate in candidates {
        let norm = candidate.norm();
        if norm <= 1e-9 {
            continue;
        }
        let axis = candidate / norm;
        let radii: Vec<f64> = centered
            .iter()
            .map(|c| (c - axis * c.dot(&axis)).norm())
            .collect();
        let mean_radius = crate::npy::mean(&radii);
        if mean_radius <= 1e-6 {
            continue;
        }
        let spread = crate::npy::std(&radii);
        if spread < best_spread {
            best_spread = spread;
            best_axis = Some(axis);
        }
    }
    let best_axis = best_axis?;
    if best_spread > 0.5 {
        return None;
    }
    for w in world_axes() {
        if best_axis.dot(&w) > 0.999 {
            return Some(w);
        }
    }
    Some(best_axis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_py_banker() {
        assert_eq!(round_py(0.5, 0), 0.0);
        assert_eq!(round_py(1.5, 0), 2.0);
        assert_eq!(round_py(2.5, 0), 2.0);
        assert_eq!(round_py(0.125, 2), 0.12);
        assert_eq!(round_py(0.135, 2), 0.14);
    }

    #[test]
    fn separation_stacked_z() {
        // moving box z[10,20], static z[0,10] -> moving up +Z separates instantly (needed<=0)
        let bmin = Vector3::new(-5.0, -5.0, 10.0);
        let bmax = Vector3::new(5.0, 5.0, 20.0);
        let smin = Vector3::new(-50.0, -50.0, 0.0);
        let smax = Vector3::new(50.0, 50.0, 10.0);
        let up = Vector3::new(0.0, 0.0, 1.0);
        // +Z: needed = static_max.z - bbox_min.z = 10-10 = 0 -> travel 0
        assert_eq!(separation_distance(&bmin, &bmax, &smin, &smax, &up), 0.0);
    }
}
