//! Planner constants (tolerances, sampling, sandwich/fastener thresholds).

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

/// Proximity (mm) at which two parts are treated as "related" — connected for
/// sequencing-connectivity and the emitted viewer contact graph, even when they
/// don't touch. Real assemblies hold parts together across mm-scale clearance
/// gaps (fasteners in clearance holes, snug slip-fits) that strict
/// `ORDERING_CONTACT_MM` contact can't see, which otherwise splits one physical
/// assembly into phantom-disconnected islands. Scaled to assembly size and
/// clamped; collision correctness still uses strict contact, so a generous value
/// here only softens the connectivity *preference* — it never permits a
/// colliding sequence.
pub fn relatedness_mm(assembly_diagonal: f64) -> f64 {
    (0.025 * assembly_diagonal).clamp(3.0, 25.0)
}

#[cfg(test)]
mod tests {
    use super::relatedness_mm;

    #[test]
    fn relatedness_scales_and_clamps() {
        // Floor for tiny assemblies, ceiling for huge ones, ~2.5% between.
        assert_eq!(relatedness_mm(40.0), 3.0);
        assert!((relatedness_mm(644.0) - 16.1).abs() < 0.05);
        assert_eq!(relatedness_mm(4000.0), 25.0);
        // Strictly exceeds strict contact so clearance-fit neighbors connect.
        assert!(relatedness_mm(644.0) > super::ORDERING_CONTACT_MM);
    }
}

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
