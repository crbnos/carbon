// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Convert a STEP file and write its graph.json. Usage:
//!   cargo run -p converter --example convert_file -- <in.step> <out.graph.json> [angular] [out.glb]
//!
//! `angular` is the angular deflection in radians (default 0.5); with `out.glb`
//! the mesh is written too, to compare detail levels by eye.

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let step = &args[1];
    let out = &args[2];
    let ang = args.get(3).and_then(|a| a.parse().ok()).unwrap_or(0.5);
    let text = std::fs::read_to_string(step).unwrap_or_default();
    let t = std::time::Instant::now();
    let conv = converter::convert::convert_step(step, &text, 0.1, ang).expect("convert");
    std::fs::write(out, serde_json::to_vec(&conv.graph).unwrap()).unwrap();
    if let Some(glb) = args.get(4) {
        std::fs::write(glb, &conv.glb).unwrap();
    }
    eprintln!(
        "ang={ang} comps={} tris={} {:.1}s -> {out}",
        conv.component_count,
        conv.triangles,
        t.elapsed().as_secs_f64()
    );
}
