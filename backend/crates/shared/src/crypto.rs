use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::RngCore;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::error::{CoreError, CoreResult};

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12;

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    rand::rng().fill_bytes(&mut out);
    out
}

pub fn random_key() -> String {
    STANDARD.encode(random_bytes::<KEY_LEN>())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn b64_encode(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub fn b64_decode(text: &str) -> CoreResult<Vec<u8>> {
    STANDARD
        .decode(text.trim())
        .map_err(|e| CoreError::Codec(format!("invalid base64: {e}")))
}

pub fn decode_key(text: &str) -> CoreResult<[u8; KEY_LEN]> {
    let bytes = b64_decode(text)?;
    bytes
        .try_into()
        .map_err(|_| CoreError::Invalid("key must be 32 bytes".into()))
}

#[derive(Debug, Clone)]
pub struct KeyPair {
    pub private_key: String,
    pub public_key: String,
}

pub fn generate_keypair() -> KeyPair {
    let secret = StaticSecret::from(random_bytes::<KEY_LEN>());
    let public = PublicKey::from(&secret);
    KeyPair {
        private_key: STANDARD.encode(secret.to_bytes()),
        public_key: STANDARD.encode(public.as_bytes()),
    }
}

pub fn public_from_private(private_key: &str) -> CoreResult<String> {
    let bytes = decode_key(private_key)?;
    let secret = StaticSecret::from(bytes);
    let public = PublicKey::from(&secret);
    Ok(STANDARD.encode(public.as_bytes()))
}

#[derive(Clone)]
pub struct Sealer {
    cipher: ChaCha20Poly1305,
}

impl std::fmt::Debug for Sealer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sealer(..)")
    }
}

impl Sealer {
    pub fn from_master_key(master: &str) -> CoreResult<Self> {
        let bytes = b64_decode(master)?;
        let key: [u8; KEY_LEN] = bytes
            .try_into()
            .map_err(|_| CoreError::Invalid("master key must be 32 bytes of base64".into()))?;
        Ok(Self {
            cipher: ChaCha20Poly1305::new(Key::from_slice(&key)),
        })
    }

    pub fn seal(&self, plaintext: &[u8]) -> CoreResult<String> {
        let mut nonce = [0u8; NONCE_LEN];
        rand::rng().fill_bytes(&mut nonce);
        let sealed = self
            .cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext)
            .map_err(|e| CoreError::Crypto(format!("seal failed: {e}")))?;
        let mut out = Vec::with_capacity(NONCE_LEN + sealed.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        Ok(STANDARD.encode(out))
    }

    pub fn seal_str(&self, plaintext: &str) -> CoreResult<String> {
        self.seal(plaintext.as_bytes())
    }

    pub fn open(&self, encoded: &str) -> CoreResult<Vec<u8>> {
        let bytes = b64_decode(encoded)?;
        if bytes.len() <= NONCE_LEN {
            return Err(CoreError::Crypto("sealed value is truncated".into()));
        }
        let (nonce, body) = bytes.split_at(NONCE_LEN);
        self.cipher
            .decrypt(Nonce::from_slice(nonce), body)
            .map_err(|e| CoreError::Crypto(format!("open failed: {e}")))
    }

    pub fn open_str(&self, encoded: &str) -> CoreResult<String> {
        String::from_utf8(self.open(encoded)?)
            .map_err(|e| CoreError::Crypto(format!("sealed value is not utf-8: {e}")))
    }
}
