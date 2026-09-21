use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileMetadata {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub size: u64,
    pub mime_type: Option<String>,
    pub file_ext: Option<String>,
    pub created_at: String,
    pub icon_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FolderMetadata {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthResult {
    pub success: bool,
    pub next_step: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserInfo {
    pub id: i32,
    pub first_name: String,
    pub last_name: Option<String>,
    pub username: Option<String>,
    pub phone: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Settings {
    pub telegram_api_id: Option<i32>,
    pub theme: Option<String>,
    pub channel_id: Option<i64>,
    pub backup_channel_id: Option<i64>,
    pub encryption_enabled: Option<bool>,
    pub lock_pin_hash: Option<String>,
    pub lock_interval_ms: Option<i64>,
    pub notification_mode: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub subdomain: String,
    pub master_admin_id: Option<String>,
    pub created_at: Option<String>,
    pub active: Option<bool>,
    #[serde(default, skip_serializing)]
    pub entry_password_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OrgMember {
    pub id: String,
    pub org_id: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    pub role: String,
    pub created_by: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct OrgSettings {
    pub org_id: String,
    pub channel_id: Option<i64>,
    pub backup_channel_id: Option<i64>,
    pub lock_pin_hash: Option<String>,
    pub lock_interval_ms: Option<i64>,
    pub notification_mode: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OrgAuditLog {
    pub id: Option<String>,
    pub org_id: String,
    pub user_id: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub details: Option<serde_json::Value>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OrgTrashItem {
    pub id: Option<String>,
    pub org_id: String,
    pub message_id: i64,
    pub folder_id: Option<i64>,
    pub name: String,
    pub size: i64,
    pub deleted_at: Option<String>,
    pub restored_at: Option<String>,
}

/// In-memory org session issued by username/password login.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OrgSession {
    pub token: String,
    pub org_id: String,
    pub member_id: String,
    pub username: String,
    pub role: String,
    /// Unix timestamp of issuance; 0 = unknown (treated as expired).
    #[serde(default)]
    pub issued_at: i64,
    /// Unix timestamp of the last DB role re-check; 0 = never (check now).
    #[serde(default)]
    pub role_checked_at: i64,
}

#[derive(Deserialize)]
pub struct CreateOrgRequest {
    pub name: String,
    pub subdomain: String,
    pub entry_password: String,
}

#[derive(Deserialize)]
pub struct PasswordBody {
    pub password: String,
}

#[derive(Deserialize)]
pub struct NewPasswordBody {
    pub new_password: String,
}

/// Folder-scoped permission grant (see 002_folder_grants.sql).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OrgFolderGrant {
    pub id: String,
    pub org_id: String,
    pub folder_id: i64,
    pub member_id: String,
    pub level: String,
    pub created_by: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateOrgRequest {
    pub name: Option<String>,
    pub active: Option<bool>,
}

#[derive(Deserialize)]
pub struct CreateMemberRequest {
    pub username: String,
    pub password: String,
    pub role: Option<String>,
}

#[derive(Deserialize)]
pub struct OrgLoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct UpdateOrgSettingsRequest {
    pub channel_id: Option<i64>,
    pub backup_channel_id: Option<i64>,
    pub lock_pin_hash: Option<String>,
    pub lock_interval_ms: Option<i64>,
    pub notification_mode: Option<String>,
}

#[derive(Deserialize)]
pub struct LogOrgActivityRequest {
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub details: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StreamInfo {
    pub token: String,
    pub base_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BandwidthStats {
    pub up_bytes: u64,
    pub down_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UploadResponse {
    pub success: bool,
    pub message_id: i64,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct AuthRequest {
    pub phone: String,
    pub api_id: i32,
    pub api_hash: String,
}

#[derive(Deserialize)]
pub struct SignInRequest {
    pub code: String,
}

#[derive(Deserialize)]
pub struct CheckPasswordRequest {
    pub password: String,
}

#[derive(Deserialize)]
pub struct GetFilesRequest {
    pub folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct RenameFolderRequest {
    pub new_name: String,
}

#[derive(Deserialize)]
pub struct DeleteFileRequest {
    pub message_id: i32,
    pub folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct DeleteFolderRequest {
    pub folder_id: i64,
}

#[derive(Deserialize)]
pub struct MoveFilesRequest {
    pub message_ids: Vec<i32>,
    pub source_folder_id: Option<i64>,
    pub target_folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct CopyFilesRequest {
    pub message_ids: Vec<i32>,
    pub source_folder_id: Option<i64>,
    pub target_folder_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub file_type: Option<String>,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    pub after: Option<String>,
    pub before: Option<String>,
}

#[derive(Deserialize)]
pub struct ConnectRequest {
    pub api_id: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_defaults_to_empty() {
        let s = Settings::default();
        assert_eq!(s.channel_id, None);
        assert_eq!(s.backup_channel_id, None);
        assert_eq!(s.telegram_api_id, None);
    }

    #[test]
    fn upload_response_roundtrips() {
        let r = UploadResponse {
            success: true,
            message_id: 42,
            name: "test.pdf".into(),
            size: 1024,
            mime_type: "application/pdf".into(),
            folder_id: Some(7),
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: UploadResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(back.message_id, 42);
        assert_eq!(back.folder_id, Some(7));
    }

    #[test]
    fn auth_request_deserializes() {
        let json = r#"{"phone":"+1234","api_id":123,"api_hash":"abc"}"#;
        let req: AuthRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.phone, "+1234");
        assert_eq!(req.api_id, 123);
    }

    #[test]
    fn delete_file_request_deserializes() {
        let json = r#"{"message_id":99,"folder_id":5}"#;
        let req: DeleteFileRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.message_id, 99);
        assert_eq!(req.folder_id, Some(5));
    }

    #[test]
    fn move_files_request_deserializes() {
        let json = r#"{"message_ids":[1,2],"source_folder_id":10,"target_folder_id":20}"#;
        let req: MoveFilesRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.message_ids, vec![1, 2]);
        assert_eq!(req.target_folder_id, Some(20));
    }

    #[test]
    fn file_metadata_id_fits_i64() {
        let f = FileMetadata {
            id: i64::MAX,
            folder_id: None,
            name: "big".into(),
            size: u64::MAX,
            mime_type: None,
            file_ext: None,
            created_at: String::new(),
            icon_type: "file".into(),
        };
        assert_eq!(f.id, i64::MAX);
        assert_eq!(f.size, u64::MAX);
    }
}
