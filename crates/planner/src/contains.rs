//! Point-in-mesh containment via ray casting. Used by embedded-pair and
//! fastener-joint detection, which vote on an aggregate fraction, so per-point
//! robustness matters more than the exact backend. A single ray in a
//! non-axis-aligned direction (avoids edge/vertex degeneracy) with odd-crossing
//! parity is the standard watertight test.

use crate::types::Mesh;
use nalgebra::Vector3;

/// Möller–Trumbore, forward hits only (t > eps).
fn ray_hits_triangle(
    origin: &Vector3<f64>,
    dir: &Vector3<f64>,
    v0: &Vector3<f64>,
    v1: &Vector3<f64>,
    v2: &Vector3<f64>,
) -> bool {
    const EPS: f64 = 1e-9;
    let e1 = v1 - v0;
    let e2 = v2 - v0;
    let p = dir.cross(&e2);
    let det = e1.dot(&p);
    if det.abs() < EPS {
        return false;
    }
    let inv = 1.0 / det;
    let t = origin - v0;
    let u = t.dot(&p) * inv;
    if u < 0.0 || u > 1.0 {
        return false;
    }
    let q = t.cross(&e1);
    let v = dir.dot(&q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return false;
    }
    let dist = e2.dot(&q) * inv;
    dist > EPS
}

/// Which of `points` lie inside `mesh` (odd forward-crossing count).
pub fn mesh_contains(mesh: &Mesh, points: &[Vector3<f64>]) -> Vec<bool> {
    // A general direction: no exact axis component, so rays rarely graze a
    // coplanar face or slip through a shared edge.
    let dir = Vector3::new(1.0, 0.000_913_3, 0.000_731_7).normalize();
    points
        .iter()
        .map(|p| {
            let mut crossings = 0usize;
            for f in &mesh.faces {
                let v0 = &mesh.vertices[f[0] as usize];
                let v1 = &mesh.vertices[f[1] as usize];
                let v2 = &mesh.vertices[f[2] as usize];
                if ray_hits_triangle(p, &dir, v0, v1, v2) {
                    crossings += 1;
                }
            }
            crossings % 2 == 1
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_box() -> Mesh {
        // 2x2x2 box centered at origin.
        let v = [
            [-1., -1., -1.],
            [1., -1., -1.],
            [1., 1., -1.],
            [-1., 1., -1.],
            [-1., -1., 1.],
            [1., -1., 1.],
            [1., 1., 1.],
            [-1., 1., 1.],
        ];
        let vertices = v.iter().map(|c| Vector3::new(c[0], c[1], c[2])).collect();
        let faces = vec![
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [1, 2, 6],
            [1, 6, 5],
            [2, 3, 7],
            [2, 7, 6],
            [3, 0, 4],
            [3, 4, 7],
        ];
        Mesh { vertices, faces }
    }

    #[test]
    fn inside_outside() {
        let m = unit_box();
        let pts = vec![
            Vector3::new(0.0, 0.0, 0.0),  // inside
            Vector3::new(5.0, 0.0, 0.0),  // outside
            Vector3::new(0.5, 0.5, 0.5),  // inside
            Vector3::new(-3.0, 0.0, 0.0), // outside
        ];
        assert_eq!(mesh_contains(&m, &pts), vec![true, false, true, false]);
    }
}
