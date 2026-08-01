//! Stable nodeId derivation.
//!
//! Identity comes from the part's quantized vertex positions ONLY — never from
//! the triangulation topology. BRepMesh's Delaunay breaks near-co-circular
//! quads by an epsilon comparison in UV space, so the chosen diagonal can flip
//! on last-ulp parametrization noise (e.g. a BinXCAF raw roundtrip) while the
//! 3D vertices stay bit-identical. Hashing indices made identity depend on
//! that tie — a compacted raw re-read would silently rename a handful of
//! parts. Positions are micron-quantized ints sorted into a canonical order,
//! so the hash is also immune to vertex-emission-order ties.
//!
//! (v1 of this hash matched the retired Python pipeline byte-for-byte and
//! included raw indices; changing the recipe renames every nodeId once —
//! stored graphs/plans/mappings regenerate on re-conversion.)

use sha1::{Digest, Sha1};

/// sha1 over the part's quantized vertex positions (mm×1000, round-half-even
/// to int64, little-endian), sorted as (x, y, z) triples. Triangle indices are
/// deliberately excluded — see module docs.
pub fn geometry_hash(positions: &[[f32; 3]]) -> String {
    let mut quantized: Vec<[i64; 3]> = positions
        .iter()
        .map(|p| {
            [
                (p[0] as f64 * 1000.0).round_ties_even() as i64,
                (p[1] as f64 * 1000.0).round_ties_even() as i64,
                (p[2] as f64 * 1000.0).round_ties_even() as i64,
            ]
        })
        .collect();
    quantized.sort_unstable();
    let mut hasher = Sha1::new();
    for q in &quantized {
        for &c in q {
            hasher.update(c.to_le_bytes());
        }
    }
    hex(&hasher.finalize())
}

/// `_node_id`: `sha1("{hash_key}:{parent_path}:{sibling_ordinal}")[:16]`.
pub fn node_id(hash_key: &str, parent_path: &str, sibling_ordinal: usize) -> String {
    let raw = format!("{hash_key}:{parent_path}:{sibling_ordinal}");
    let mut hasher = Sha1::new();
    hasher.update(raw.as_bytes());
    hex(&hasher.finalize())[..16].to_string()
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geometry_hash_ignores_vertex_order() {
        let a = [[0.0f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let b = [[1.0f32, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0]];
        assert_eq!(geometry_hash(&a), geometry_hash(&b));
    }

    #[test]
    fn geometry_hash_distinguishes_geometry() {
        let a = [[0.0f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let b = [[0.0f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.5]];
        assert_ne!(geometry_hash(&a), geometry_hash(&b));
        // Sub-half-micron wiggle quantizes away.
        let c = [[0.0002f32, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        assert_eq!(geometry_hash(&a), geometry_hash(&c));
    }

    #[test]
    fn geometry_hash_stable_value() {
        // Pinned so an accidental recipe change (quantization, sort, endian)
        // is loud — this exact value is what stored graphs reference from now.
        let pos = [
            [0.0f32, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 1.0],
        ];
        assert_eq!(
            geometry_hash(&pos),
            "23ddd092dc128b8467a7e243e0a58e9865dd4357"
        );
    }

    #[test]
    fn node_id_matches_python() {
        // Reference values captured from app.convert._node_id.
        assert_eq!(
            node_id("9e21fed301a9b2683e3e381282e35ac1bb0576fb", "A/B", 2),
            "e7e90bb71c31f2f8"
        );
        assert_eq!(node_id("", "", 0), "df6bf0c022b56e83");
        assert_eq!(node_id("abc123", "PLATE", 0), "d5dc7338a9bc0158");
        assert_eq!(node_id("abc123", "STACK-ASSY/PLATE", 1), "cfb23fd2f838d9a5");
    }
}
