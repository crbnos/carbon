// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

//! Temp harness: STEP → BinXCAF (.xbf) retained raw. Usage:
//!   cargo run --release -p converter --example make_xbf -- <in.step> <out.xbf>

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let t = std::time::Instant::now();
    converter::convert::step_to_xbf(&args[1], &args[2]).expect("step_to_xbf");
    let in_len = std::fs::metadata(&args[1]).unwrap().len();
    let out_len = std::fs::metadata(&args[2]).unwrap().len();
    eprintln!(
        "xbf written: {} -> {} bytes in {:.1}s",
        in_len,
        out_len,
        t.elapsed().as_secs_f64()
    );
}
