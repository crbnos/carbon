//! Temp harness: build_tree a CAD file, print one line per leaf node:
//! nodeId, geometryHash, name, verts, tris, volume, bbox. Usage:
//!   cargo run --release -p converter --example dump_tree -- <in.step|in.xbf>

use converter::graph::AssemblyNode;

fn walk(n: &AssemblyNode, out: &mut Vec<String>) {
    if let Some(m) = &n.mesh {
        out.push(format!(
            "{}\t{}\t{}\t{}\t{}\t{:.6}\t{:.3},{:.3},{:.3}\t{:.3},{:.3},{:.3}",
            n.node_id,
            m.geometry_hash,
            n.name,
            m.positions.len(),
            m.indices.len(),
            n.volume.unwrap_or(0.0),
            n.bbox_min[0],
            n.bbox_min[1],
            n.bbox_min[2],
            n.bbox_max[0],
            n.bbox_max[1],
            n.bbox_max[2],
        ));
    }
    for c in &n.children {
        walk(c, out);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = converter::convert::build_tree(&args[1], 0.1, 0.5).expect("build_tree");
    let mut lines = Vec::new();
    walk(&root, &mut lines);
    for l in lines {
        println!("{l}");
    }
}
