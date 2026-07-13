//! Output buffer codec for the optimised GLB. Geometry optimisation (weld,
//! reorder, simplify) is codec-independent; this only selects how the resulting
//! vertex/index buffers are encoded in the container.

/// Transmission codec for the optimised GLB buffers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Codec {
    /// Plain little-endian buffers, no compression extension.
    None,
    /// `EXT_meshopt_compression` (native meshopt encode). Decoded by the viewer's
    /// MeshoptDecoder. (Phase 1b.)
    #[default]
    Meshopt,
    /// `KHR_draco_mesh_compression` (via crates/draco-bridge → C++ Google Draco).
    /// Per-primitive; quantizes attributes (the decoder dequantizes).
    Draco,
}

impl Codec {
    pub fn from_str_opt(s: &str) -> Option<Codec> {
        match s {
            "none" => Some(Codec::None),
            "meshopt" => Some(Codec::Meshopt),
            "draco" => Some(Codec::Draco),
            _ => None,
        }
    }
}
