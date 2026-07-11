use std::path::{Path, PathBuf};
use std::process::Command;

/// Resolve the OCCT install prefix: `OCCT_PREFIX` env (Docker/CI/custom) →
/// `brew --prefix opencascade` (macOS fallback) → default brew path.
fn occt_prefix() -> String {
    if let Ok(p) = std::env::var("OCCT_PREFIX") {
        if !p.is_empty() {
            return p;
        }
    }
    // The per-machine static build (apps/assembler/scripts/build-occt.sh).
    if let Some(home) = std::env::var_os("HOME") {
        let cached = std::path::PathBuf::from(home).join(".cache/carbon-occt/8.0.0-p1");
        if cached.join("lib/libTKernel.a").exists() {
            return cached.to_string_lossy().into_owned();
        }
    }
    Command::new("brew")
        .args(["--prefix", "opencascade"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/opt/homebrew/opt/opencascade".to_string())
}

/// All OCCT toolkits present in `lib_dir`, and whether they are static
/// archives. Prefers static (`libTK*.a`) when present — the deployment build —
/// else dynamic (`libTK*.dylib`/`.so`, e.g. the brew install).
fn toolkits(lib_dir: &Path) -> (Vec<String>, bool) {
    let mut static_libs = Vec::new();
    let mut dylibs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(lib_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Some(stem) = name.strip_prefix("lib") else {
                continue;
            };
            if let Some(s) = stem.strip_suffix(".a") {
                if s.starts_with("TK") && !s.contains('.') {
                    static_libs.push(s.to_string());
                }
            } else if let Some(s) = stem
                .strip_suffix(".dylib")
                .or_else(|| stem.strip_suffix(".so"))
            {
                // Skip versioned files (libTKFoo.so.8.0.0) so each links once.
                if s.starts_with("TK") && !s.contains('.') {
                    dylibs.push(s.to_string());
                }
            }
        }
    }
    let is_static = !static_libs.is_empty();
    let mut libs = if is_static { static_libs } else { dylibs };
    libs.sort();
    libs.dedup();
    (libs, is_static)
}

fn main() {
    let occt = occt_prefix();
    let include_dir = format!("{occt}/include/opencascade");
    let lib_dir = PathBuf::from(format!("{occt}/lib"));

    cxx_build::bridge("src/lib.rs")
        .file("src/occt.cc")
        .std("c++17")
        .include(&include_dir)
        .warnings(false)
        .compile("carbon_occt_shim");

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!(
        "cargo:rustc-link-search=native={}/x86_64-linux-gnu",
        lib_dir.display()
    );

    // Link every OpenCASCADE toolkit found — the STEP+XCAF+Mesh path pulls in a
    // broad transitive set; linking all TK* avoids hand-maintaining the list.
    let (libs, is_static) = toolkits(&lib_dir);
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    if is_static && target_os == "linux" {
        // GNU ld resolves archives in one pass, so inter-toolkit dependency
        // order matters; a link group re-scans until fixed point.
        println!("cargo:rustc-link-arg=-Wl,--start-group");
        for lib in &libs {
            println!("cargo:rustc-link-arg=-l{lib}");
        }
        println!("cargo:rustc-link-arg=-Wl,--end-group");
    } else {
        let kind = if is_static { "static" } else { "dylib" };
        for lib in &libs {
            println!("cargo:rustc-link-lib={kind}={lib}");
        }
    }

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/occt.cc");
    println!("cargo:rerun-if-changed=src/occt.h");
    println!("cargo:rerun-if-env-changed=OCCT_PREFIX");
}
