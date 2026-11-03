use crate::{Error, Result};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}
pub fn digest(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
pub fn vault_key() -> [u8; 32] {
    Sha256::digest(
        format!(
            "{}:{}:ssh-hold-web-v1",
            whoami::username(),
            hostname::get().unwrap_or_default().to_string_lossy()
        )
        .as_bytes(),
    )
    .into()
}
pub fn encrypt(value: &Value, key: &[u8; 32]) -> Result<Value> {
    let iv = random::<12>();
    let mut data = Aes256Gcm::new_from_slice(key)
        .unwrap()
        .encrypt(Nonce::from_slice(&iv), serde_json::to_vec(value)?.as_ref())
        .map_err(|_| Error::bad("加密失败"))?;
    let tag = data.split_off(data.len() - 16);
    Ok(json!({"iv":B64.encode(iv),"tag":B64.encode(tag),"data":B64.encode(data)}))
}
pub fn decrypt(value: &Value, key: &[u8; 32]) -> Result<Value> {
    let iv = decode(&value["iv"])?;
    let tag = decode(&value["tag"])?;
    let mut data = decode(&value["data"])?;
    if iv.len() != 12 || tag.len() != 16 {
        return Err(Error::bad("加密数据格式无效"));
    }
    data.extend(tag);
    let plain = Aes256Gcm::new_from_slice(key)
        .unwrap()
        .decrypt(Nonce::from_slice(&iv), data.as_ref())
        .map_err(|_| Error::bad("凭据解密失败，请检查本机用户和主机名称"))?;
    Ok(serde_json::from_slice(&plain)?)
}
pub fn decode(value: &Value) -> Result<Vec<u8>> {
    B64.decode(value.as_str().unwrap_or(""))
        .map_err(|_| Error::bad("数据编码无效"))
}
pub fn derive(password: &str, salt: &[u8], length: usize) -> Result<Vec<u8>> {
    let mut key = vec![0; length];
    let params = scrypt::Params::new(14, 8, 1, length).map_err(|_| Error::bad("密码参数无效"))?;
    scrypt::scrypt(password.as_bytes(), salt, &params, &mut key)
        .map_err(|_| Error::bad("密码计算失败"))?;
    Ok(key)
}
pub async fn hash(password: String) -> Result<Value> {
    tokio::task::spawn_blocking(move || {
        let salt = hex::encode(random::<32>());
        let bytes = derive(&password, salt.as_bytes(), 64)?;
        Ok(json!({"salt":salt,"hash":hex::encode(bytes)}))
    })
    .await
    .map_err(|_| Error::bad("密码计算失败"))?
}
pub async fn verify(password: String, record: Value) -> Result<bool> {
    if password.len() > 1024 || !record.is_object() {
        return Ok(false);
    }
    tokio::task::spawn_blocking(move || {
        let calculated = derive(
            &password,
            record["salt"].as_str().unwrap_or("").as_bytes(),
            64,
        )?;
        let expected = hex::decode(record["hash"].as_str().unwrap_or("")).unwrap_or_default();
        Ok(bool::from(calculated.ct_eq(&expected)))
    })
    .await
    .map_err(|_| Error::bad("密码计算失败"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decrypt_node_fixture() {
        let fixture = json!({"iv":"AwMDAwMDAwMDAwMD","tag":"1CuwYSIpZj/CyfUofHElDA==","data":"XtzTYilbKS0IJGFmyTSQYZ1dlMLA8OcEDfKl34KIJZqLhZmaNh0zx+z1"});
        assert_eq!(
            decrypt(&fixture, &[7; 32]).unwrap(),
            json!({"password":"compat-test","name":"中文"})
        );
    }
    #[test]
    fn node_scrypt_fixture() {
        assert_eq!(hex::encode(derive("test-password","0123456789abcdef".repeat(4).as_bytes(),64).unwrap()),"8fd0f88e7e5a48e2adf9d882fa67d0c774d427c33cd3e00039a5cc3c7eb5702ba0c252b51a1a50a2f9eb83e868823d7aa02f04a7d0022bde0057fa26f676ab44");
    }
    #[test]
    fn vault_roundtrip_and_tampering() {
        let key = [7; 32];
        let original = json!({"password":"secret","name":"中文"});
        let mut envelope = encrypt(&original, &key).unwrap();
        assert_eq!(decrypt(&envelope, &key).unwrap(), original);
        envelope["tag"] = json!(B64.encode([0; 16]));
        assert!(decrypt(&envelope, &key).is_err());
    }
    #[tokio::test]
    async fn password_roundtrip() {
        let record = hash("password-test".into()).await.unwrap();
        assert!(verify("password-test".into(), record.clone())
            .await
            .unwrap());
        assert!(!verify("wrong".into(), record).await.unwrap());
    }
}
