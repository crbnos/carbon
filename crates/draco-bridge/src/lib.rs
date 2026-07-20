//! cxx bridge over C++ Google Draco: encode one triangle mesh (positions +
//! optional normals/UVs + indices) into a `KHR_draco_mesh_compression` blob.
//! The caller (`crates/optimize`) assembles the glTF extension records from the
//! returned draco attribute ids.

#[cxx::bridge(namespace = "carbon_draco")]
pub mod ffi {
    /// One encoded primitive: the draco byte stream plus the draco attribute
    /// `unique_id` assigned to each glTF semantic (`-1` when the attribute was
    /// absent). These ids are what `primitive.extensions.KHR_draco_mesh_
    /// compression.attributes` maps each semantic to.
    #[derive(Debug, Clone)]
    pub struct DracoEncoded {
        pub data: Vec<u8>,
        pub ok: bool,
        pub pos_id: i32,
        pub norm_id: i32,
        pub uv_id: i32,
    }

    unsafe extern "C++" {
        include!("draco-bridge/src/shim.h");

        /// Encode an indexed triangle mesh. `positions` is `n*3` f32, `normals`
        /// `n*3` (or empty), `uvs` `n*2` (or empty), `indices` `m*3` u32. The
        /// `*_bits` are draco quantization bit counts (0 = leave that attribute
        /// unquantized). Returns `ok=false` with empty data on any draco error.
        fn encode_mesh(
            positions: &[f32],
            normals: &[f32],
            uvs: &[f32],
            indices: &[u32],
            pos_bits: i32,
            norm_bits: i32,
            uv_bits: i32,
        ) -> DracoEncoded;
    }
}

pub use ffi::{encode_mesh, DracoEncoded};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_quad_to_draco() {
        // Unit quad, two triangles.
        let positions: Vec<f32> = vec![
            0.0, 0.0, 0.0, //
            1.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, //
            1.0, 1.0, 0.0,
        ];
        let indices: Vec<u32> = vec![0, 1, 2, 2, 1, 3];
        let enc = encode_mesh(&positions, &[], &[], &indices, 14, 10, 12);
        assert!(enc.ok, "draco encode failed");
        assert!(!enc.data.is_empty());
        // Every draco stream starts with the "DRACO" magic.
        assert_eq!(&enc.data[0..5], b"DRACO");
        assert_eq!(enc.pos_id, 0);
        assert_eq!(enc.norm_id, -1);
        assert_eq!(enc.uv_id, -1);
    }

    #[test]
    fn encodes_with_normals_and_uvs() {
        let positions: Vec<f32> = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
        let normals: Vec<f32> = vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let uvs: Vec<f32> = vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let indices: Vec<u32> = vec![0, 1, 2, 2, 1, 3];
        let enc = encode_mesh(&positions, &normals, &uvs, &indices, 14, 10, 12);
        assert!(enc.ok);
        assert_eq!(enc.pos_id, 0);
        assert_eq!(enc.norm_id, 1);
        assert_eq!(enc.uv_id, 2);
    }
}
