//! Backend calibration sweep: full-enumeration contact depths for a fixed,
//! deterministic set of (part, direction, offset) poses. Run once per backend
//! (FCL default build, then --features coal) and join the CSVs to measure how
//! the two backends' depth semantics relate on identical poses.
//!   calib_pairs <step> <out.csv>
//! CSV: part,other,dir,s,depth  (one row per reported neighbor contact)

use nalgebra::Vector3;
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let root = converter::convert::build_tree(&a[1], 0.1, 0.5).expect("build_tree");
    let parts = planner::steps::collect_world_parts(&root);
    let world = planner::collide::CollisionWorld::from_components(&parts);
    let dirs: [Vector3<f64>; 6] = [
        Vector3::new(1.0, 0.0, 0.0),
        Vector3::new(-1.0, 0.0, 0.0),
        Vector3::new(0.0, 1.0, 0.0),
        Vector3::new(0.0, -1.0, 0.0),
        Vector3::new(0.0, 0.0, 1.0),
        Vector3::new(0.0, 0.0, -1.0),
    ];
    let mut f = std::fs::File::create(&a[2]).unwrap();
    writeln!(f, "part,other,dir,s,depth").unwrap();
    for part in &parts {
        let diag = (part.bbox_max - part.bbox_min).norm().max(1.0);
        for (di, d) in dirs.iter().enumerate() {
            // 8 deterministic offsets: 0 .. diag (covers seated through separated).
            for k in 0..8u32 {
                let s = diag * (k as f64) / 7.0;
                let t = d * s;
                for (other, depth) in world.contacts_at(part, &t) {
                    writeln!(f, "{},{},{di},{s:.4},{depth:.6}", part.node_id, other).unwrap();
                }
            }
        }
    }
}
