use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2;
use sha2::Sha256;
use hmac::Hmac;

type HmacSha256 = Hmac<Sha256>;

pub struct EncryptionManager {
    key: [u8; 32],
}

impl EncryptionManager {
    pub fn from_password(password: &str, salt: &[u8]) -> Self {
        let mut key = [0u8; 32];
        pbkdf2::<HmacSha256>(
            password.as_bytes(),
            salt,
            100_000,
            &mut key,
        ).expect("PBKDF2 derivation failed");
        Self { key }
    }

    pub fn encrypt_chunk(&self, data: &[u8], nonce_bytes: &[u8; 12]) -> Result<Vec<u8>, String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| e.to_string())?;
        let nonce = Nonce::from_slice(nonce_bytes);
        cipher.encrypt(nonce, data).map_err(|e| e.to_string())
    }

    pub fn decrypt_chunk(&self, data: &[u8], nonce_bytes: &[u8; 12]) -> Result<Vec<u8>, String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| e.to_string())?;
        let nonce = Nonce::from_slice(nonce_bytes);
        cipher.decrypt(nonce, data).map_err(|e| e.to_string())
    }
}
