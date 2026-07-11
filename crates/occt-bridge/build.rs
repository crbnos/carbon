use std::process::Command;

/// `OCCT_PREFIX` env (Docker/Linux) → `brew --prefix opencascade` → default.
fn occt_prefix() -> String {
    if let Ok(p) = std::env::var("OCCT_PREFIX") {
        if !p.is_empty() {
            return p;
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

fn main() {
    let occt = occt_prefix();

    cxx_build::bridge("src/lib.rs")
        .file("src/occt.cc")
        .std("c++17")
        .include(format!("{occt}/include/opencascade"))
        .warnings(false)
        .compile("carbon_occt_shim");

    println!("cargo:rustc-link-search=native={occt}/lib");
    println!("cargo:rustc-link-search=native={occt}/lib/x86_64-linux-gnu");
    // Link every OpenCASCADE toolkit — the STEP+XCAF+Mesh path pulls in a broad
    // transitive set; linking all TK* avoids hand-maintaining the exact list.
    let lib_dir = format!("{occt}/lib");
    if let Ok(entries) = std::fs::read_dir(&lib_dir) {
        let mut libs: Vec<String> = Vec::new();
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            // libTKFoo.dylib (macOS) / libTKFoo.so (Linux base symlink) -> TKFoo.
            // Skip versioned files (libTKFoo.so.7.9.3) so each toolkit links once.
            let stem = name
                .strip_prefix("lib")
                .and_then(|s| s.strip_suffix(".dylib").or_else(|| s.strip_suffix(".so")));
            if let Some(stem) = stem {
                if stem.starts_with("TK") && !stem.contains('.') {
                    libs.push(stem.to_string());
                }
            }
        }
        libs.sort();
        libs.dedup();
        for lib in libs {
            println!("cargo:rustc-link-lib=dylib={lib}");
        }
    }

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/occt.cc");
    println!("cargo:rerun-if-changed=src/occt.h");
    println!("cargo:rerun-if-env-changed=OCCT_PREFIX");
}
