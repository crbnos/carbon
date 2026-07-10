//! Dump per-part volume + symmetry axis for float-parity diffing vs Python.
//! Usage: cargo run --release -p planner --example dump_parts -- <in.step> <out.json>

use planner::geom::{part_volume, symmetry_axis_kind};
use planner::steps::collect_world_parts;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = converter::convert::build_tree(&args[1], 0.1, 0.5).expect("read");
    let parts = collect_world_parts(&root);
    let mut out = serde_json::Map::new();
    for p in &parts {
        let ak = symmetry_axis_kind(p);
        out.insert(
            p.node_id.clone(),
            serde_json::json!({
                "volume": hex::encode(part_volume(p).to_le_bytes()),
                "axis": ak.map(|(a, _)| vec![hex::encode(a[0].to_le_bytes()), hex::encode(a[1].to_le_bytes()), hex::encode(a[2].to_le_bytes())]),
                "kind": ak.map(|(_, k)| format!("{k:?}").to_lowercase()),
                "nverts": p.mesh.vertices.len(),
            }),
        );
    }
    std::fs::write(&args[2], serde_json::to_vec(&serde_json::Value::Object(out)).unwrap()).unwrap();
    eprintln!("dumped {} parts", parts.len());
}
