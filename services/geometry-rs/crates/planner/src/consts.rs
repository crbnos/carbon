//! Planner constants — ported 1:1 from `app/plan.py`. Values must match exactly.

use nalgebra::Vector3;

/// Default allowed surface penetration (mm) along a removal path.
pub const PENETRATION_TOLERANCE_MM: f64 = 0.15;

/// Effective tolerance scales with the deflection used to mesh the model.
pub fn mesh_tolerance(linear_deflection: f64) -> f64 {
    PENETRATION_TOLERANCE_MM.max(2.5 * linear_deflection)
}

/// Margin (mm) past the assembly bounds before a part counts as "out".
pub const EXIT_MARGIN_MM: f64 = 5.0;

pub const MAX_SAMPLE_SPACING_MM: f64 = 2.0;
pub const MAX_PATH_SAMPLES: usize = 400;

pub const MATE_MIN_DEPTH_MM: f64 = 0.2;
pub const MATE_DEPTH_MARGIN_MM: f64 = 0.3;

pub const ORDERING_CONTACT_MM: f64 = 0.5;
pub const MAX_ADJACENCY_DISTANCE_PAIRS: usize = 20000;

pub const SANDWICH_MAX_THICKNESS_RATIO: f64 = 0.3;
pub const SANDWICH_MAX_THICKNESS_MM: f64 = 6.0;
pub const SANDWICH_AXIS_ALIGNMENT: f64 = 0.9;
pub const SANDWICH_MAX_SQUISH_MM: f64 = 0.6;

pub const MAX_FASTENER_DIAGONAL_FRACTION: f64 = 0.35;
pub const MAX_FASTENER_EXTENT_MM: f64 = 100.0;

pub const MAX_ESCAPE_SEGMENTS: usize = 3;
pub const MAX_ESCAPE_EXPANSIONS: usize = 24;
pub const MIN_HOP_FRACTION: f64 = 0.25;

pub const MAX_GROUP_SIZE: usize = 4;
pub const MAX_GROUP_TESTS: usize = 40;
pub const GROUP_PROXIMITY_MM: f64 = 2.0;

/// World axes in the exact order the Python planner tries them:
/// +Z, -Z, +X, -X, +Y, -Y.
pub fn world_axes() -> [Vector3<f64>; 6] {
    [
        Vector3::new(0.0, 0.0, 1.0),
        Vector3::new(0.0, 0.0, -1.0),
        Vector3::new(1.0, 0.0, 0.0),
        Vector3::new(-1.0, 0.0, 0.0),
        Vector3::new(0.0, 1.0, 0.0),
        Vector3::new(0.0, -1.0, 0.0),
    ]
}
