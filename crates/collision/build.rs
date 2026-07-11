use std::process::Command;

/// Resolve a library prefix: `<ENV_KEY>_PREFIX` env (Docker/Linux) → `brew
/// --prefix <pkg>` (macOS) → `/opt/homebrew/opt/<pkg>`.
fn prefix(pkg: &str, env_key: &str) -> String {
    if let Ok(p) = std::env::var(format!("{env_key}_PREFIX")) {
        if !p.is_empty() {
            return p;
        }
    }
    Command::new("brew")
        .args(["--prefix", pkg])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("/opt/homebrew/opt/{pkg}"))
}

/// Link `lib` from `prefix`, statically when a `.a` is present there, else
/// dynamically. Static keeps the archive's code in the binary (no runtime .so).
fn link_lib(prefix: &str, lib: &str) {
    let static_archive = ["lib", "lib/x86_64-linux-gnu"]
        .iter()
        .any(|sub| std::path::Path::new(&format!("{prefix}/{sub}/lib{lib}.a")).exists());
    let kind = if static_archive { "static" } else { "dylib" };
    println!("cargo:rustc-link-lib={kind}={lib}");
}

fn main() {
    let fcl = prefix("fcl", "FCL");
    let ccd = prefix("libccd", "LIBCCD");
    let eigen = prefix("eigen", "EIGEN");
    let octomap = prefix("octomap", "OCTOMAP");

    cxx_build::bridge("src/lib.rs")
        .file("src/shim.cc")
        .std("c++14")
        .include(format!("{fcl}/include"))
        .include(format!("{ccd}/include"))
        .include(format!("{eigen}/include/eigen3"))
        .include(format!("{octomap}/include"))
        .warnings(false)
        .compile("carbon_fcl_shim");

    for p in [&fcl, &ccd] {
        println!("cargo:rustc-link-search=native={p}/lib");
        println!("cargo:rustc-link-search=native={p}/lib/x86_64-linux-gnu");
    }
    // Prefer a static archive when the prefix ships one (the deployment build
    // installs libfcl.a/libccd.a → a self-contained binary with no FCL runtime
    // .so); fall back to dynamic where only a shared lib exists (macOS/brew dev).
    // FCL depends on ccd, so fcl must be listed before ccd for the static link.
    link_lib(&fcl, "fcl");
    link_lib(&ccd, "ccd");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/shim.cc");
    println!("cargo:rerun-if-changed=src/shim.h");
}
