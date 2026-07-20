//! cxx bridge over OpenCASCADE. `read_step` reads a STEP file into an XCAF
//! document, walks the assembly tree (names, per-instance transforms, colors),
//! tessellates each unique part once, and returns a FLAT node list (children as
//! indices) — mirroring `app/convert.py`'s `_build_tree`/`_tessellate`. The Rust
//! `converter` crate turns this into nodeIds + graph.json + GLB.

#[cxx::bridge(namespace = "carbon_occt")]
pub mod ffi {
    /// One node of the assembly tree, flattened. `children` holds indices into
    /// the returned `nodes` vector.
    #[derive(Debug, Clone)]
    pub struct RawNode {
        pub name: String,
        pub product_name: String,
        pub transform: Vec<f64>, // 16, column-major
        pub is_assembly: bool,
        pub has_mesh: bool,
        pub is_proxy: bool,
        pub vertices: Vec<f32>, // flat n*3, part-local mm
        pub indices: Vec<u32>,  // flat m*3
        pub has_color: bool,
        pub color: Vec<f64>, // 4 when has_color
        pub has_volume: bool,
        pub volume: f64,
        pub children: Vec<u64>,
    }

    /// Result of reading a STEP file.
    #[derive(Debug, Clone)]
    pub struct Tree {
        pub ok: bool,
        pub error: String,
        pub root_index: u64,
        pub nodes: Vec<RawNode>,
    }

    unsafe extern "C++" {
        include!("occt-bridge/src/occt.h");

        /// Read + tessellate a STEP file. `ok=false` with `error` on failure
        /// (unreadable STEP, transfer failure, no shapes).
        fn read_step(path: &str, linear_deflection: f64, angular_deflection: f64) -> Tree;

        /// Read + tessellate an IGES file — the XDE twin of `read_step` (same
        /// XCAF transfer, same walk → same `Tree` shape).
        fn read_iges(path: &str, linear_deflection: f64, angular_deflection: f64) -> Tree;

        /// Read + tessellate a bare `.brep` shape file, wrapped in a fresh XCAF
        /// doc so the identical walk applies (no names/colors/structure in BREP).
        fn read_brep(path: &str, linear_deflection: f64, angular_deflection: f64) -> Tree;

        /// Read a STEP file, transfer to XCAF, and store it as a BinXCAF (`.xbf`)
        /// document: lossless B-rep + assembly tree + names + colors, far smaller
        /// and faster to parse than ASCII STEP. Returns false on any failure.
        fn step_to_xbf(step_path: &str, xbf_path: &str) -> bool;

        /// Read a BinXCAF (`.xbf`) document and tessellate exactly like
        /// `read_step` (same walk → identical `Tree`). `ok=false` with `error`
        /// on failure.
        fn read_xbf(path: &str, linear_deflection: f64, angular_deflection: f64) -> Tree;

        /// Test fixture generator: write `boxes` disjoint solids as ONE
        /// product (flat multi-body, no assembly tree) to a STEP file.
        /// Hermetic tests use this instead of committed fixture files.
        fn write_test_step(path: &str, boxes: u32) -> bool;
    }
}

pub use ffi::{read_brep, read_iges, read_step, read_xbf, step_to_xbf, write_test_step, RawNode, Tree};
