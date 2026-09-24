//! The PWA, embedded in the binary at build time.
//!
//! A release is a single file: `web/dist` is compiled in, so `kelpie serve`
//! needs no `--static-dir`. When the dist is absent (a fresh checkout that
//! never ran `pnpm build`), the build script does not set `has_web` and this
//! module is empty.

#[cfg(has_web)]
static WEB: include_dir::Dir<'static> =
    include_dir::include_dir!("$CARGO_MANIFEST_DIR/../../web/dist");

/// Serve a path from the embedded PWA, falling back to `index.html` so the
/// client-side routes resolve.
#[cfg(has_web)]
pub async fn serve(uri: axum::http::Uri) -> axum::response::Response {
    use axum::response::IntoResponse;

    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if let Some(file) = WEB.get_file(path) {
        return response(path, file.contents());
    }
    match WEB.get_file("index.html") {
        Some(index) => response("index.html", index.contents()),
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

#[cfg(has_web)]
fn response(path: &str, bytes: &'static [u8]) -> axum::response::Response {
    use axum::body::Body;
    use axum::http::{HeaderValue, StatusCode, header};
    use axum::response::Response;

    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    let _ = StatusCode::OK;
    response
}
