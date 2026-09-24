// Embed the built PWA when it is present, so a release is one file.
//
// `web/dist` is a build artifact (gitignored), so a plain `cargo build` from a
// fresh checkout has none — the crate then serves nothing but the API, and
// `--static-dir` remains for development.

fn main() {
    println!("cargo:rustc-check-cfg=cfg(has_web)");
    let dist = std::path::Path::new("../../web/dist");
    if dist.join("index.html").is_file() {
        println!("cargo:rustc-cfg=has_web");
    }
    println!("cargo:rerun-if-changed=../../web/dist");
}
