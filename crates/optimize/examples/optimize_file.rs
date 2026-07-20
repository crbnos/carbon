//! Ad-hoc harness: optimise a real .glb or .gltf (embedded-base64 buffer) and
//! print before/after stats. Not part of the service — a verification tool.
//!
//!   cargo run --release --example optimize_file -- "<path>" [none|meshopt|draco]

use gltf::json;
use std::io::BufReader;
use std::time::Instant;

fn mb(bytes: usize) -> String {
    format!("{:.1} MB", bytes as f64 / 1_048_576.0)
}

/// Holds the binary buffer either memory-mapped (OS-paged, off the RSS) — with
/// the BIN sub-range within the map — or owned.
enum Bin {
    Mapped(memmap2::Mmap, usize, usize),
    Owned(Vec<u8>),
}
impl Bin {
    fn as_slice(&self) -> &[u8] {
        match self {
            Bin::Mapped(m, off, len) => &m[*off..*off + *len],
            Bin::Owned(v) => v,
        }
    }
}

fn le_u32(b: &[u8], off: usize) -> usize {
    u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]]) as usize
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).expect("usage: optimize_file <path> [codec]");
    let codec_name = args.get(2).map(String::as_str).unwrap_or("meshopt");
    let codec = optimize::Codec::from_str_opt(codec_name).expect("bad codec");

    let input_bytes = std::fs::metadata(path)
        .map(|m| m.len() as usize)
        .unwrap_or(0);
    eprintln!("loading {path} ({}) …", mb(input_bytes));

    let t = Instant::now();
    let (root, bin) = load(path);
    eprintln!(
        "loaded: {} meshes, bin {} in {} ms",
        root.meshes.len(),
        mb(bin.as_slice().len()),
        t.elapsed().as_millis()
    );

    let opts = optimize::Options {
        codec,
        quantize_normals: true,
        merge_primitives: true,
        ..Default::default()
    };
    eprintln!("optimising (codec={codec_name}) …");
    let t = Instant::now();
    let res = match optimize::optimize_root(root, bin.as_slice(), input_bytes, &opts) {
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

fn load(path: &str) -> (json::Root, Bin) {
    if path.to_lowercase().ends_with(".glb") {
        // mmap the whole file; the BIN chunk becomes an OS-paged sub-slice, off
        // the RSS. Parse the GLB chunk layout by hand to avoid a Cow borrow of
        // the map: [magic,ver,len] then chunks [len,type,data]; chunk0=JSON (its
        // length is 4-aligned), chunk1=BIN.
        let file = std::fs::File::open(path).expect("open glb");
        let map = unsafe { memmap2::Mmap::map(&file) }.expect("mmap glb");
        let json_len = le_u32(&map, 12);
        let root: json::Root = serde_json::from_slice(&map[20..20 + json_len]).expect("parse json");
        let bin_hdr = 20 + json_len;
        let bin_len = le_u32(&map, bin_hdr);
        let bin_off = bin_hdr + 8;
        (root, Bin::Mapped(map, bin_off, bin_len))
    } else {
        // .gltf — parse the JSON, then STREAM-decode buffer[0]'s base64 data URI
        // straight to a temp file and mmap it, so the ~900 MB buffer is never a
        // resident Vec. The 1.3 GB base64 string is dropped right after.
        let file = std::fs::File::open(path).expect("open gltf");
        let mut root: json::Root =
            serde_json::from_reader(BufReader::new(file)).expect("parse gltf json");
        let uri = std::mem::take(&mut root.buffers[0].uri).expect("buffer has no uri");
        let comma = uri.find(',').expect("not a data URI") + 1;

        let tmp = std::env::temp_dir().join(format!("optimize-bin-{}.bin", std::process::id()));
        {
            let mut out = std::fs::File::create(&tmp).expect("create temp");
            let mut dec = base64::read::DecoderReader::new(
                std::io::Cursor::new(&uri.as_bytes()[comma..]),
                &base64::engine::general_purpose::STANDARD,
            );
            std::io::copy(&mut dec, &mut out).expect("stream-decode base64");
        }
        drop(uri); // free the ~1.3 GB base64 string
        root.buffers.clear();
        let map = unsafe { memmap2::Mmap::map(&std::fs::File::open(&tmp).expect("open temp")) }
            .expect("mmap temp");
        let len = map.len();
        let _ = std::fs::remove_file(&tmp); // unlinked; the mmap keeps it alive
        (root, Bin::Mapped(map, 0, len))
    }
}
