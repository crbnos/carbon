//! Post-plan support-polygon stability check. Purely diagnostic and additive:
//! for each part, in final placement order, does its center of mass project
//! inside the convex hull of the contact points from ALREADY-PLACED parts that
//! support it from below? If not, the part will tip and needs holding — the
//! planner surfaces that as `needsSupport` on the step.
//!
//! Reads only geometry already computed upstream (PairData contact points +
//! normals, Component bboxes). No collision queries, no physics engine, no new
//! dependency. Gravity is -Z (matching `add_support_edges`), so the support
//! polygon lives in the XY plane and the CoM proxy is the bbox center.

use std::collections::{HashMap, HashSet};

use nalgebra::Vector3;

use crate::pipeline::{PairData, PairDepths};
use crate::types::{Component, FastenerInfo};

/// Fraction of a pair's mean contact normal that must align with gravity (Z)
/// for the pair to count as a vertical support rather than a side contact.
const SUPPORT_NORMAL_MIN_Z: f64 = 0.5;
/// The CoM must fall at least this far (mm) OUTSIDE the support hull before we
/// flag it — a part whose CoM sits right on the boundary isn't reported.
const SUPPORT_MARGIN_MM: f64 = 0.5;
/// Fewer than this many supporting contact points is a line/point contact, not
/// a gravity-resting seat (press-fit / mated / base) — never flagged.
const MIN_SUPPORT_POINTS: usize = 3;

/// 2D monotone-chain convex hull. Points are `[x, y]`; output is the hull in
/// counter-clockwise order with no repeated vertex. Degenerate inputs (< 3
/// unique points) are returned as-is (the caller treats those as no polygon).
pub fn convex_hull_2d(points: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut pts: Vec<[f64; 2]> = points.to_vec();
    pts.sort_by(|a, b| {
        a[0].partial_cmp(&b[0])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a[1].partial_cmp(&b[1]).unwrap_or(std::cmp::Ordering::Equal))
    });
    pts.dedup_by(|a, b| a[0] == b[0] && a[1] == b[1]);
    let n = pts.len();
    if n < 3 {
        return pts;
    }
    let cross = |o: [f64; 2], a: [f64; 2], b: [f64; 2]| {
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    };
    let mut hull: Vec<[f64; 2]> = Vec::with_capacity(2 * n);
    for &p in &pts {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len() + 1;
    for &p in pts.iter().rev() {
        while hull.len() >= lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    hull.pop();
    hull
}

/// Signed distance from `p` to a CCW convex polygon: positive inside (distance
/// to the nearest edge), negative outside. A hull with < 3 vertices is always
/// "outside" (returns the negative distance to it).
pub fn point_in_hull_margin(p: [f64; 2], hull: &[[f64; 2]]) -> f64 {
    let n = hull.len();
    if n == 0 {
        return f64::NEG_INFINITY;
    }
    if n == 1 {
        return -((p[0] - hull[0][0]).hypot(p[1] - hull[0][1]));
    }
    if n == 2 {
        return -dist_point_segment(p, hull[0], hull[1]);
    }
    let mut min_signed = f64::INFINITY;
    for i in 0..n {
        let a = hull[i];
        let b = hull[(i + 1) % n];
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        if len < 1e-12 {
            continue;
        }
        // CCW interior is to the left of each edge a→b.
        let signed = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
        min_signed = min_signed.min(signed);
    }
    min_signed
}

fn dist_point_segment(p: [f64; 2], a: [f64; 2], b: [f64; 2]) -> f64 {
    let ab = [b[0] - a[0], b[1] - a[1]];
    let l2 = ab[0] * ab[0] + ab[1] * ab[1];
    if l2 < 1e-12 {
        return (p[0] - a[0]).hypot(p[1] - a[1]);
    }
    let t = (((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2).clamp(0.0, 1.0);
    (p[0] - (a[0] + t * ab[0])).hypot(p[1] - (a[1] + t * ab[1]))
}

/// Pair's mean contact normal is predominantly vertical (a gravity support,
/// not a side wall). Mirrors the Z-alignment test in `add_support_edges`.
fn is_vertical_support(data: &PairData) -> bool {
    if data.normals.is_empty() {
        return false;
    }
    let mut mean = Vector3::zeros();
    for n in &data.normals {
        let flip = if n[2] >= 0.0 { 1.0 } else { -1.0 };
        mean += n * flip;
    }
    mean /= data.normals.len() as f64;
    let len = mean.norm();
    len > 1e-9 && (mean[2] / len).abs() >= SUPPORT_NORMAL_MIN_Z
}

/// Parts whose center of mass falls outside the convex hull of the contact
/// points supporting them from below, given the final placement `sequence`.
/// Only parts with a real gravity-resting seat (≥ MIN_SUPPORT_POINTS supporting
/// contacts from earlier-placed, lower neighbors) are candidates — base /
/// press-fit / fully-mated parts are never flagged.
pub fn support_check(
    sequence: &[String],
    parts: &[Component],
    pair_depths: &PairDepths,
    fasteners: &HashMap<String, FastenerInfo>,
) -> HashSet<String> {
    let by_id: HashMap<&str, &Component> = parts.iter().map(|p| (p.node_id.as_str(), p)).collect();
    let seq_pos: HashMap<&str, usize> = sequence
        .iter()
        .enumerate()
        .map(|(i, s)| (s.as_str(), i))
        .collect();

    let mut needs: HashSet<String> = HashSet::new();

    for part in parts {
        let pid = part.node_id.as_str();
        // Fasteners are held by threads / press-fit, not by a gravity support
        // polygon — never flag them (matches `add_support_edges`).
        if fasteners.contains_key(pid) {
            continue;
        }
        let pos = match seq_pos.get(pid) {
            Some(&p) => p,
            None => continue,
        };
        let p_center_z = (part.bbox_min[2] + part.bbox_max[2]) / 2.0;
        let com_xy = [
            (part.bbox_min[0] + part.bbox_max[0]) / 2.0,
            (part.bbox_min[1] + part.bbox_max[1]) / 2.0,
        ];

        let mut support_pts: Vec<[f64; 2]> = Vec::new();
        for data in pair_depths.values() {
            let other = if data.a == pid {
                &data.b
            } else if data.b == pid {
                &data.a
            } else {
                continue;
            };
            // A fastener doesn't hold a part up against gravity.
            if fasteners.contains_key(other.as_str()) {
                continue;
            }
            // Supporter must already be placed when this part goes on.
            match seq_pos.get(other.as_str()) {
                Some(&op) if op < pos => {}
                _ => continue,
            }
            let oc = match by_id.get(other.as_str()) {
                Some(c) => c,
                None => continue,
            };
            let o_center_z = (oc.bbox_min[2] + oc.bbox_max[2]) / 2.0;
            if o_center_z >= p_center_z {
                continue; // not below
            }
            if !is_vertical_support(data) {
                continue;
            }
            for pt in &data.points {
                support_pts.push([pt[0], pt[1]]);
            }
        }

        if support_pts.len() < MIN_SUPPORT_POINTS {
            continue;
        }
        let hull = convex_hull_2d(&support_pts);
        if point_in_hull_margin(com_xy, &hull) < -SUPPORT_MARGIN_MM {
            needs.insert(part.node_id.clone());
        }
    }
    needs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hull_of_a_square_is_four_corners() {
        let pts = [
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
            [0.5, 0.5], // interior, must be dropped
        ];
        let hull = convex_hull_2d(&pts);
        assert_eq!(hull.len(), 4);
    }

    #[test]
    fn point_inside_square_has_positive_margin() {
        let hull = convex_hull_2d(&[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]);
        assert!(point_in_hull_margin([1.0, 1.0], &hull) > 0.9);
        assert!(point_in_hull_margin([1.0, 1.0], &hull) <= 1.0 + 1e-9);
    }

    #[test]
    fn point_outside_square_has_negative_margin() {
        let hull = convex_hull_2d(&[[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]);
        assert!(point_in_hull_margin([3.0, 1.0], &hull) < 0.0);
        assert!(point_in_hull_margin([1.0, -0.5], &hull) < 0.0);
    }

    #[test]
    fn degenerate_hulls_are_outside() {
        assert!(point_in_hull_margin([0.0, 0.0], &[]) < 0.0);
        assert!(point_in_hull_margin([0.0, 0.0], &[[1.0, 1.0]]) < 0.0);
        assert!(point_in_hull_margin([0.0, 0.0], &[[1.0, 0.0], [2.0, 0.0]]) < 0.0);
    }

    #[test]
    fn collinear_points_do_not_form_a_polygon() {
        let hull = convex_hull_2d(&[[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]);
        assert!(hull.len() < 3);
    }
}
