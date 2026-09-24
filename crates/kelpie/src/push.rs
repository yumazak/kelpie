//! Web Push: the VAPID keypair, the device subscriptions, and the send.
//!
//! Everything lives in the state dir (`~/.local/state/kelpie/push.json`): the
//! VAPID private key is generated on first use, and each device's subscription
//! is appended when the PWA registers it. Sending is blocking (`isahc`), so it
//! runs on a blocking thread.

use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};

/// A device's push subscription, as the browser reports it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub endpoint: String,
    pub keys: SubscriptionKeys,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

/// What the operator sees on the lock screen.
#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// A collapse key, so a second alert replaces the first on the device.
    pub tag: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoreFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    vapid_private: Option<String>,
    #[serde(default)]
    subscriptions: Vec<Subscription>,
}

/// The push state: the VAPID key and the device subscriptions.
pub struct PushStore {
    file: PathBuf,
    inner: Mutex<StoreFile>,
}

impl PushStore {
    /// Load from the state dir, generating a VAPID key on first use.
    pub fn load() -> Self {
        let file = state_dir()
            .map(|dir| dir.join("push.json"))
            .unwrap_or_else(|| PathBuf::from("push.json"));
        let mut inner: StoreFile = std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        if inner.vapid_private.is_none() {
            inner.vapid_private = generate_vapid_private();
        }
        let store = Self {
            file,
            inner: Mutex::new(inner),
        };
        store.save();
        store
    }

    /// The VAPID public key the browser subscribes with (base64url, uncompressed
    /// P-256 point).
    pub fn public_key(&self) -> Option<String> {
        let inner = self.inner.lock().ok()?;
        let private = inner.vapid_private.as_ref()?;
        public_from_private(private)
    }

    fn vapid_private(&self) -> Option<String> {
        self.inner.lock().ok()?.vapid_private.clone()
    }

    /// Add (or replace) a device subscription.
    pub fn subscribe(&self, subscription: Subscription) {
        if let Ok(mut inner) = self.inner.lock() {
            inner
                .subscriptions
                .retain(|existing| existing.endpoint != subscription.endpoint);
            inner.subscriptions.push(subscription);
        }
        self.save();
    }

    pub fn subscriptions(&self) -> Vec<Subscription> {
        self.inner
            .lock()
            .map(|inner| inner.subscriptions.clone())
            .unwrap_or_default()
    }

    /// Forget an endpoint the push service rejected (404/410).
    pub fn forget(&self, endpoint: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner
                .subscriptions
                .retain(|existing| existing.endpoint != endpoint);
        }
        self.save();
    }

    fn save(&self) {
        let Ok(inner) = self.inner.lock() else { return };
        if let Some(parent) = self.file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&*inner) {
            let _ = std::fs::write(&self.file, text);
        }
    }
}

/// The state dir: `$XDG_STATE_HOME/kelpie` or `~/.local/state/kelpie`.
pub fn state_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state"))
        })?;
    Some(base.join("kelpie"))
}

/// A fresh P-256 private scalar, base64url-no-padding (the format `web-push`
/// wants).
fn generate_vapid_private() -> Option<String> {
    let secret = p256::SecretKey::random(&mut OsRng);
    Some(URL_SAFE_NO_PAD.encode(secret.to_bytes()))
}

/// The uncompressed public point for a private scalar.
fn public_from_private(private: &str) -> Option<String> {
    let bytes = URL_SAFE_NO_PAD.decode(private).ok()?;
    let secret = p256::SecretKey::from_bytes(bytes.as_slice().into()).ok()?;
    let point = secret.public_key().to_encoded_point(false);
    Some(URL_SAFE_NO_PAD.encode(point.as_bytes()))
}

/// Deliver one notification to every subscription. Endpoints the service
/// rejects are forgotten.
pub async fn broadcast(store: &PushStore, notification: &Notification) {
    let Some(private) = store.vapid_private() else {
        return;
    };
    let subscriptions = store.subscriptions();
    tracing::info!(
        title = %notification.title,
        session = ?notification.session_id,
        subscriptions = subscriptions.len(),
        "push"
    );
    let payload = serde_json::to_vec(notification).unwrap_or_default();
    for subscription in subscriptions {
        match send(&subscription, &private, &payload).await {
            Ok(()) => {}
            Err(SendError::Gone) => store.forget(&subscription.endpoint),
            Err(SendError::Other(error)) => {
                tracing::warn!(endpoint = %subscription.endpoint, %error, "push failed")
            }
        }
    }
}

enum SendError {
    /// The push service disowned the subscription (404/410).
    Gone,
    Other(String),
}

async fn send(
    subscription: &Subscription,
    vapid_private: &str,
    payload: &[u8],
) -> Result<(), SendError> {
    use web_push::{
        ContentEncoding, IsahcWebPushClient, SubscriptionInfo, Urgency, VapidSignatureBuilder,
        WebPushClient, WebPushMessageBuilder,
    };

    let info = SubscriptionInfo::new(
        subscription.endpoint.as_str(),
        subscription.keys.p256dh.as_str(),
        subscription.keys.auth.as_str(),
    );
    let signature = VapidSignatureBuilder::from_base64_no_sub(vapid_private)
        .map_err(|error| SendError::Other(error.to_string()))?
        .add_sub_info(&info)
        .build()
        .map_err(|error| SendError::Other(error.to_string()))?;

    let mut builder = WebPushMessageBuilder::new(&info);
    builder.set_ttl(60 * 60 * 6);
    builder.set_urgency(Urgency::High);
    builder.set_vapid_signature(signature);
    // `set_payload` borrows, so `payload` must outlive the builder.
    builder.set_payload(ContentEncoding::Aes128Gcm, payload);
    let message = builder
        .build()
        .map_err(|error| SendError::Other(error.to_string()))?;

    let client = IsahcWebPushClient::new().map_err(|error| SendError::Other(error.to_string()))?;
    match client.send(message).await {
        Ok(_) => Ok(()),
        Err(web_push::WebPushError::EndpointNotValid(_))
        | Err(web_push::WebPushError::EndpointNotFound(_)) => Err(SendError::Gone),
        Err(error) => {
            let text = error.to_string();
            if text.contains("410") || text.contains("404") {
                Err(SendError::Gone)
            } else {
                Err(SendError::Other(text))
            }
        }
    }
}
