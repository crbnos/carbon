//! Convert a STEP file and write its graph.json. Usage:
//!   cargo run -p converter --example convert_file -- <in.step> <out.graph.json>

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let step = &args[1];
    let out = &args[2];
    let text = std::fs::read_to_string(step).unwrap_or_default();
    let t = std::time::Instant::now();
    let conv = converter::convert::convert_step(step, &text, 0.1, 0.5).expect("convert");
    std::fs::write(out, serde_json::to_vec(&conv.graph).unwrap()).unwrap();
    eprintln!(
        "comps={} tris={} {:.1}s -> {out}",
        conv.component_count,
        conv.triangles,
        t.elapsed().as_secs_f64()
    );
}
