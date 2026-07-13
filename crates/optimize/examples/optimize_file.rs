//! Ad-hoc harness: optimise a real .glb or .gltf (embedded-base64 buffer) and
//! print before/after stats. Not part of the service — a verification tool.
//!
//!   cargo run --release --example optimize_file -- "<path>" [none|meshopt|draco]

use base64::Engine;
use gltf::json;
use std::io::BufReader;
use std::time::Instant;

fn mb(bytes: usize) -> String {
    format!("{:.1} MB", bytes as f64 / 1_048_576.0)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).expect("usage: optimize_file <path> [codec]");
    let codec_name = args.get(2).map(String::as_str).unwrap_or("meshopt");
    let codec = optimize::Codec::from_str_opt(codec_name).expect("bad codec");

    let input_bytes = std::fs::metadata(path).map(|m| m.len() as usize).unwrap_or(0);
    eprintln!("loading {path} ({}) …", mb(input_bytes));

    let t = Instant::now();
    let (root, bin) = load(path);
    eprintln!(
        "loaded: {} meshes, bin {} in {} ms",
        root.meshes.len(),
        mb(bin.len()),
        t.elapsed().as_millis()
    );

    let opts = optimize::Options {
        codec,
        ..Default::default()
    };
    eprintln!("optimising (codec={codec_name}) …");
    let t = Instant::now();
    let res = match optimize::optimize_root(root, &bin, input_bytes, &opts) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("ERROR: {}", e.message);
            std::process::exit(1);
        }
    };
    let ms = t.elapsed().as_millis();

    println!("--- {codec_name} ---");
    println!(
        "tris   {:>10} -> {:>10}  ({:.1}%)",
        res.stats.input_triangles,
        res.stats.output_triangles,
        pct(res.stats.output_triangles, res.stats.input_triangles)
    );
    println!(
        "verts  {:>10} -> {:>10}",
        res.stats.input_vertices, res.stats.output_vertices
    );
    println!(
        "bytes  {:>10} -> {:>10}  (decoded {})  ({:.1}%)",
        mb(res.stats.input_bytes),
        mb(res.glb.len()),
        mb(res.stats.decoded_bytes),
        pct(res.glb.len(), res.stats.input_bytes)
    );
    println!("time   {ms} ms");
    if !res.stats.warnings.is_empty() {
        println!("warnings: {:?}", res.stats.warnings);
    }

    let out = format!("/tmp/optimized-{codec_name}.glb");
    std::fs::write(&out, &res.glb).expect("write output");
    println!("wrote {out} ({})", mb(res.glb.len()));
}

fn pct(a: usize, b: usize) -> f64 {
    if b == 0 {
        0.0
    } else {
        100.0 * a as f64 / b as f64
    }
}

fn load(path: &str) -> (json::Root, Vec<u8>) {
    if path.to_lowercase().ends_with(".glb") {
        let bytes = std::fs::read(path).expect("read glb");
        let glb = gltf::binary::Glb::from_slice(&bytes).expect("parse glb");
        let root: json::Root = serde_json::from_slice(glb.json.as_ref()).expect("parse json");
        let bin = glb.bin.expect("no bin").into_owned();
        (root, bin)
    } else {
        // .gltf — parse the JSON, then decode buffer[0]'s embedded base64 data URI.
        let file = std::fs::File::open(path).expect("open gltf");
        let mut root: json::Root =
            serde_json::from_reader(BufReader::new(file)).expect("parse gltf json");
        let uri = root.buffers[0]
            .uri
            .as_ref()
            .expect("buffer has no uri (external .bin not supported by this harness)");
        let b64 = uri
            .split_once(',')
            .map(|(_, d)| d)
            .expect("not a data URI");
        let bin = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .expect("decode base64 buffer");
        // Drop the ~1.3 GB base64 string now (optimize_root rebuilds buffers and
        // never reads the old ones); keeps peak RSS down.
        root.buffers.clear();
        (root, bin)
    }
}
