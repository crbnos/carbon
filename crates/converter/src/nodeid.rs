//! Stable nodeId derivation — byte-identical to `app/convert.py`
//! (`_geometry_hash`, `_node_id`). Existing stored graphs/plans reference these
//! IDs, so they must match Python exactly.

use sha1::{Digest, Sha1};

/// `_geometry_hash`: sha1 over quantized positions (mm×1000, round-half-even to
/// int64) then uint32 indices, both little-endian row-major — matching numpy
/// `.astype(float64)*1000`, `np.round` (rint = ties-to-even), `.tobytes()`.
pub fn geometry_hash(positions: &[[f32; 3]], indices: &[[u32; 3]]) -> String {
    let mut hasher = Sha1::new();
    for p in positions {
        for &c in p {
            let q = (c as f64 * 1000.0).round_ties_even() as i64;
            hasher.update(q.to_le_bytes());
        }
    }
    for tri in indices {
        for &i in tri {
            hasher.update(i.to_le_bytes());
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
    fn geometry_hash_matches_python() {
        // Reference values captured from app.convert._geometry_hash.
        let pos = [
            [0.0f32, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 1.0],
        ];
        let idx = [[0u32, 1, 2], [1, 3, 2]];
        assert_eq!(
            geometry_hash(&pos, &idx),
            "9e21fed301a9b2683e3e381282e35ac1bb0576fb"
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
