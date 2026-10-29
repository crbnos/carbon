// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

    /// A polyline, flat x,y,z, world mm.
    #[derive(Debug, Clone, Default)]
    pub struct PmiPolyline {
        pub points: Vec<f64>,
    }

    /// Triangles, flat x,y,z positions (world mm) and flat index triples.
    #[derive(Debug, Clone, Default)]
    pub struct PmiMesh {
        pub positions: Vec<f64>,
        pub indices: Vec<u32>,
    }

    /// One PMI item as OCCT reads it (see `pmi.cc`). `kind`: 0 dimension,
    /// 1 geometric tolerance, 2 datum, 3 graphic-only note. Enum values are
    /// lower camel case strings; an empty string is "none". Lengths are mm,
    /// angles degrees.
    #[derive(Debug, Clone)]
    pub struct PmiRaw {
        pub kind: u8,
        pub type_name: String,
        pub name: String,
        pub has_value: bool,
        pub value: f64,
        pub has_plus_minus: bool,
        pub upper: f64,
        /// Negative: the lower deviation, signed.
        pub lower: f64,
        pub has_range: bool,
        pub upper_bound: f64,
        pub lower_bound: f64,
        pub has_fit: bool,
        pub fit_hole: bool,
        pub fit_variance: String,
        pub fit_grade: String,
        pub qualifier: String,
        pub has_decimals: bool,
        pub decimals_left: i32,
        pub decimals_right: i32,
        pub modifiers: Vec<String>,
        pub descriptions: Vec<String>,
        pub zone_shape: String,
        pub material: String,
        pub zone_modifier: String,
        pub zone_modifier_value: f64,
        pub max_value: f64,
        /// Datum letters a tolerance references, in precedence order.
        pub datum_refs: Vec<String>,
        /// Per datum reference: its modifiers, comma-joined.
        pub datum_ref_modifiers: Vec<String>,
        pub datum_target: String,
        pub lines: Vec<PmiPolyline>,
        pub mesh: PmiMesh,
        pub has_plane: bool,
        /// 9 when `has_plane`: origin, normal, x direction.
        pub plane: Vec<f64>,
        pub has_text: bool,
        /// 3 when `has_text`.
        pub text: Vec<f64>,
        /// Indices into `PmiTree::faces` / `PmiTree::edges`.
        pub faces: Vec<u32>,
        pub edges: Vec<u32>,
    }

    /// A saved view. `direction` is the look direction (camera → model);
    /// `projection`: 0 none, 1 parallel, 2 central. `items` index `PmiTree::items`.
    #[derive(Debug, Clone)]
    pub struct PmiViewRaw {
        pub name: String,
        pub direction: Vec<f64>,
        pub up: Vec<f64>,
        pub projection: u8,
        pub items: Vec<u32>,
    }

    /// The PMI of a document. `ok=false` with `error` when the file could not
    /// be read; `ok=true` and empty lists when it has no PMI.
    #[derive(Debug, Clone)]
    pub struct PmiTree {
        pub ok: bool,
        pub error: String,
        pub items: Vec<PmiRaw>,
        pub faces: Vec<PmiMesh>,
        pub edges: Vec<PmiPolyline>,
        pub views: Vec<PmiViewRaw>,
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

        /// Read the PMI (dimensions, geometric tolerances, datums, saved
        /// views) of a STEP or BinXCAF (`.xbf`) file, in world mm. A second,
        /// read-only pass: the geometry of `read_step` / `read_xbf` is not
        /// touched. `angular_deflection` samples curved presentation and
        /// referenced edges.
        fn read_pmi(path: &str, angular_deflection: f64) -> PmiTree;

        /// Test fixture generator: a 100 x 50 x 20 mm box as AP242 with one
        /// dimension, one flatness tolerance and datum A (see `pmi.cc`).
        fn write_test_pmi_step(path: &str) -> bool;

        /// Test fixture generator: write `boxes` disjoint solids as ONE
        /// product (flat multi-body, no assembly tree) to a STEP file.
        /// Hermetic tests use this instead of committed fixture files.
        fn write_test_step(path: &str, boxes: u32) -> bool;

        /// Test fixture generator: a single cylinder — the canonical curved
        /// surface for asserting tessellation smoothness (circle segments).
        fn write_test_cylinder(path: &str, radius: f64, height: f64) -> bool;

        /// Test fixture generator: a square plate with `holes` small
        /// through-holes drilled in it — a small curved feature inside a large
        /// bounding box, the case where sag-based deflection alone goes blocky.
        fn write_test_plate_with_holes(
            path: &str,
            size: f64,
            thickness: f64,
            hole_radius: f64,
            holes: u32,
        ) -> bool;
    }
}

pub use ffi::{
    read_brep, read_iges, read_pmi, read_step, read_xbf, step_to_xbf, write_test_cylinder,
    write_test_plate_with_holes, write_test_pmi_step, write_test_step, PmiMesh, PmiPolyline,
    PmiRaw, PmiTree, PmiViewRaw, RawNode, Tree,
};
