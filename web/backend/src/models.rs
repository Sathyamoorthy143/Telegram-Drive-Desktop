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
    /// The main channel ID where files are uploaded
    pub channel_id: Option<i64>,
    /// Backup channel ID — files are auto-forwarded here after upload
    pub backup_channel_id: Option<i64>,
    /// AI proxy URL
    pub ai_proxy_url: Option<String>,
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

/// Response from file upload
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
}
#[derive(Deserialize)]
pub struct ConnectRequest {
    pub api_id: i32,
}
#[derive(Deserialize)]
pub struct ChatRequest {
    pub message: String,
}
#[derive(Serialize)]
pub struct ChatResponse {
    pub reply: String,
}
