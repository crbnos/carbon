// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! `cargo run --release -p thumbnail --example render -- model.glb out.png [size]`

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, input, output, rest @ ..] = args.as_slice() else {
        eprintln!("usage: render <model.glb> <out.png> [size]");
        std::process::exit(2);
    };
    let size = rest
        .first()
        .and_then(|s| s.parse().ok())
        .unwrap_or(thumbnail::DEFAULT_SIZE);
    let glb = std::fs::read(input).expect("read GLB");
    let started = std::time::Instant::now();
    let png = thumbnail::render_png(&glb, size).expect("render");
    eprintln!("{} bytes in {:?}", png.len(), started.elapsed());
    std::fs::write(output, png).expect("write PNG");
}
