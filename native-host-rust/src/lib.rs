use serde::{Deserialize, Serialize};

// Define error type
#[derive(Debug)]
pub enum NativeHostError {
    InvalidMessage(String),
    IoError(std::io::Error),
    JsonError(serde_json::Error),
    PathTraversal(String),
    DirectoryNotFound(String),
}

impl std::fmt::Display for NativeHostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NativeHostError::InvalidMessage(msg) => write!(f, "Invalid message: {}", msg),
            NativeHostError::IoError(e) => write!(f, "IO error: {}", e),
            NativeHostError::JsonError(e) => write!(f, "JSON error: {}", e),
            NativeHostError::PathTraversal(msg) => write!(f, "Path traversal detected: {}", msg),
            NativeHostError::DirectoryNotFound(msg) => write!(f, "Directory not found: {}", msg),
        }
    }
}

impl std::error::Error for NativeHostError {}

impl From<std::io::Error> for NativeHostError {
    fn from(err: std::io::Error) -> Self {
        NativeHostError::IoError(err)
    }
}

impl From<serde_json::Error> for NativeHostError {
    fn from(err: serde_json::Error) -> Self {
        NativeHostError::JsonError(err)
    }
}

// Native Messaging 协议保持 camelCase，兼容扩展 JS 与旧 C# Native Host 的字段契约。
#[derive(Default, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRequest {
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub existing_path: String,
    #[serde(default)]
    pub executable_path: String,
    #[serde(default)]
    pub arguments_template: String,
    #[serde(default)]
    pub target_path: String,
    #[serde(default)]
    pub directory_path: String,
    #[serde(default)]
    pub files: Vec<HostFileEntry>,
    #[serde(default)]
    pub sync: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<HostFileEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileEntry {
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub exists: bool,
}

// Implement Default for HostResponse
impl Default for HostResponse {
    fn default() -> Self {
        HostResponse {
            ok: None,
            cancelled: None,
            error: None,
            host_name: None,
            version: None,
            executable_path: None,
            display_name: None,
            directory_path: None,
            files: None,
            current_version: None,
            latest_version: None,
            update_available: None,
            synced: None,
        }
    }
}

// Helper: pick editor via native dialog
pub fn pick_editor(existing_path: &str) -> HostResponse {
    use native_dialog::FileDialog;

    let mut dialog = FileDialog::new().set_title("Select editor or IDE");
    let mut initial_path = None;

    if !existing_path.is_empty() {
        if let Ok(canonical) = std::path::Path::new(existing_path).canonicalize() {
            if canonical.exists() {
                initial_path = Some(canonical);
            }
        }
    }

    if let Some(ref p) = initial_path {
        dialog = dialog.set_location(p);
    }

    match dialog.show_open_single_file() {
        Ok(Some(path)) => {
            let executable_path = path.to_string_lossy().to_string();
            HostResponse {
                ok: Some(true),
                cancelled: Some(false),
                executable_path: Some(executable_path.clone()),
                display_name: Some(
                    std::path::Path::new(&executable_path)
                        .file_stem()
                        .unwrap()
                        .to_string_lossy()
                        .to_string(),
                ),
                ..Default::default()
            }
        }
        Ok(None) => HostResponse {
            ok: Some(false),
            cancelled: Some(true),
            error: Some("User cancelled editor selection.".to_string()),
            ..Default::default()
        },
        Err(e) => HostResponse {
            ok: Some(false),
            cancelled: Some(false),
            error: Some(format!("Failed to open file dialog: {}", e)),
            ..Default::default()
        },
    }
}

// Helper: pick directory via native dialog
pub fn pick_directory(existing_path: &str) -> HostResponse {
    use native_dialog::FileDialog;

    let mut dialog = FileDialog::new().set_title("Select target folder");
    let mut initial_path = None;

    if !existing_path.is_empty() {
        if let Ok(canonical) = std::path::Path::new(existing_path).canonicalize() {
            if canonical.exists() {
                initial_path = Some(canonical);
            }
        }
    }

    if let Some(ref p) = initial_path {
        dialog = dialog.set_location(p);
    }

    match dialog.show_open_single_dir() {
        Ok(Some(path)) => {
            let directory_path = path.to_string_lossy().to_string();
            HostResponse {
                ok: Some(true),
                cancelled: Some(false),
                directory_path: Some(directory_path),
                ..Default::default()
            }
        }
        Ok(None) => HostResponse {
            ok: Some(false),
            cancelled: Some(true),
            error: Some("User cancelled directory selection.".to_string()),
            ..Default::default()
        },
        Err(e) => HostResponse {
            ok: Some(false),
            cancelled: Some(false),
            error: Some(format!("Failed to open folder dialog: {}", e)),
            ..Default::default()
        },
    }
}

// Helper: write files to directory
pub fn write_directory_files(directory_path: &str, files: &[HostFileEntry]) -> HostResponse {
    let normalized_dir = match normalize_directory_path(directory_path) {
        Ok(path) => path,
        Err(e) => {
            return HostResponse {
                ok: Some(false),
                error: Some(e.to_string()),
                ..Default::default()
            }
        }
    };

    let mut results = Vec::new();

    for file in files {
        let target_path = match resolve_file_path(&normalized_dir, &file.file_name) {
            Ok(path) => path,
            Err(e) => {
                return HostResponse {
                    ok: Some(false),
                    error: Some(e.to_string()),
                    ..Default::default()
                }
            }
        };

        // Create parent directory if not exists
        if let Some(parent) = std::path::Path::new(&target_path).parent() {
            if !parent.exists() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    return HostResponse {
                        ok: Some(false),
                        error: Some(e.to_string()),
                        ..Default::default()
                    };
                }
            }
        }

        let existed = std::path::Path::new(&target_path).exists();

        if let Err(e) = std::fs::write(&target_path, &file.content) {
            return HostResponse {
                ok: Some(false),
                error: Some(e.to_string()),
                ..Default::default()
            };
        }

        results.push(HostFileEntry {
            file_name: file.file_name.clone(),
            content: "".to_string(),
            exists: existed,
        });
    }

    HostResponse {
        ok: Some(true),
        directory_path: Some(normalized_dir),
        files: Some(results),
        ..Default::default()
    }
}

// Helper: read files from directory
pub fn read_directory_files(directory_path: &str, files: &[HostFileEntry]) -> HostResponse {
    let normalized_dir = match normalize_directory_path(directory_path) {
        Ok(path) => path,
        Err(e) => {
            return HostResponse {
                ok: Some(false),
                error: Some(e.to_string()),
                ..Default::default()
            }
        }
    };

    let mut results = Vec::new();

    for file in files {
        let target_path = match resolve_file_path(&normalized_dir, &file.file_name) {
            Ok(path) => path,
            Err(e) => {
                return HostResponse {
                    ok: Some(false),
                    error: Some(e.to_string()),
                    ..Default::default()
                }
            }
        };

        if !std::path::Path::new(&target_path).exists() {
            results.push(HostFileEntry {
                file_name: file.file_name.clone(),
                content: "".to_string(),
                exists: false,
            });
            continue;
        }

        let content = match std::fs::read_to_string(&target_path) {
            Ok(c) => c,
            Err(e) => {
                return HostResponse {
                    ok: Some(false),
                    error: Some(e.to_string()),
                    ..Default::default()
                }
            }
        };

        results.push(HostFileEntry {
            file_name: file.file_name.clone(),
            content,
            exists: true,
        });
    }

    HostResponse {
        ok: Some(true),
        directory_path: Some(normalized_dir),
        files: Some(results),
        ..Default::default()
    }
}

/// 按配置模板生成编辑器 argv；空模板直接传原始目录，避免把引号作为实参内容传给 VS Code / IDEA。
pub fn build_editor_arguments(
    arguments_template: &str,
    target_path: &str,
) -> Result<Vec<String>, NativeHostError> {
    let template = arguments_template.trim();
    if template.is_empty() {
        return Ok(vec![target_path.to_string()]);
    }

    let expanded = template
        .replace("{path}", &target_path.replace('\\', "/"))
        .replace("{rawPath}", target_path);

    split_argument_template(&expanded)
}

/// 解析简单命令行模板；支持空白分隔和双引号包裹路径，覆盖当前编辑器启动配置的业务形态。
fn split_argument_template(template: &str) -> Result<Vec<String>, NativeHostError> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = template.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
            }
            '\\' if in_quotes && matches!(chars.peek(), Some('"')) => {
                chars.next();
                current.push('"');
            }
            value if value.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            value => current.push(value),
        }
    }

    if in_quotes {
        return Err(NativeHostError::InvalidMessage(
            "Argument template has an unclosed quote".to_string(),
        ));
    }

    if !current.is_empty() {
        args.push(current);
    }

    if args.is_empty() {
        return Err(NativeHostError::InvalidMessage(
            "Argument template does not contain launch arguments".to_string(),
        ));
    }

    Ok(args)
}

// 启动本机编辑器；参数模板已先拆成 argv，避免把整段命令行当成单个参数。
pub fn launch_native_editor(
    executable_path: &str,
    arguments_template: &str,
    target_path: &str,
) -> HostResponse {
    if executable_path.is_empty() || !std::path::Path::new(executable_path).exists() {
        return HostResponse {
            ok: Some(false),
            error: Some("Executable path is missing or does not exist.".to_string()),
            ..Default::default()
        };
    }

    if target_path.is_empty() || !std::path::Path::new(target_path).exists() {
        return HostResponse {
            ok: Some(false),
            error: Some("Target directory is missing or does not exist.".to_string()),
            ..Default::default()
        };
    }

    let arguments = match build_editor_arguments(arguments_template, target_path) {
        Ok(args) => args,
        Err(e) => {
            return HostResponse {
                ok: Some(false),
                error: Some(e.to_string()),
                ..Default::default()
            }
        }
    };

    let start_info = std::process::Command::new(executable_path)
        .args(arguments.iter())
        .current_dir(target_path)
        .spawn();

    match start_info {
        Ok(_) => HostResponse {
            ok: Some(true),
            executable_path: Some(executable_path.to_string()),
            display_name: Some(
                std::path::Path::new(executable_path)
                    .file_stem()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
            ),
            ..Default::default()
        },
        Err(e) => HostResponse {
            ok: Some(false),
            error: Some(e.to_string()),
            ..Default::default()
        },
    }
}

/// 三段式版本号比较：返回值 >0 表示 left 高于 right，<0 表示 left 低于 right，0 表示相等
fn compare_versions(left: &str, right: &str) -> i32 {
    let parse = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .filter_map(|s| s.trim().parse::<u32>().ok())
            .collect()
    };
    let left_parts = parse(left);
    let right_parts = parse(right);
    let max_len = left_parts.len().max(right_parts.len());
    for i in 0..max_len {
        let l = left_parts.get(i).copied().unwrap_or(0);
        let r = right_parts.get(i).copied().unwrap_or(0);
        if l > r { return 1; }
        if l < r { return -1; }
    }
    0
}

/// 从 manifest.json 内容中提取 version 字段
fn parse_manifest_version(content: &str) -> String {
    let manifest: serde_json::Value = serde_json::from_str(content).unwrap_or_default();
    manifest["version"].as_str().unwrap_or("0.0.0").to_string()
}

/// 检查扩展目录是否为 Git 仓库，并从远程同步版本更新
/// Native Host 可执行文件位于 <ext_root>/.native-host/publish/cloudpiovt_native_host.exe
/// 仓库根目录即往上 3 级
pub fn git_sync(should_sync: bool) -> HostResponse {
    // 定位扩展根目录：exe 所在路径往上 3 级即为 Git 仓库根目录
    let exe_path = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return HostResponse {
            ok: Some(false),
            error: Some(format!("无法获取程序路径：{}", e)),
            ..Default::default()
        }
    };

    let git_root = match exe_path.parent()       // publish/
        .and_then(|p| p.parent())                // .native-host/
        .and_then(|p| p.parent())                // <ext_root>/
    {
        Some(p) => p.to_path_buf(),
        None => return HostResponse {
            ok: Some(false),
            error: Some("无法定位扩展根目录".to_string()),
            ..Default::default()
        }
    };

    // 检查是否为 Git 仓库
    if !git_root.join(".git").exists() {
        return HostResponse {
            ok: Some(false),
            error: Some("当前扩展目录不是 Git 仓库，无法通过 git 同步更新。".to_string()),
            ..Default::default()
        };
    }

    // 第一步：从远程获取最新信息
    let fetch = std::process::Command::new("git")
        .args(["-C", &git_root.to_string_lossy(), "fetch", "origin"])
        .output();
    if let Err(e) = fetch {
        return HostResponse {
            ok: Some(false),
            error: Some(format!("Git fetch 失败：{}", e)),
            ..Default::default()
        };
    }

    // 第二步：读取本地 manifest.json 版本
    let local_manifest_path = git_root.join("manifest.json");
    let local_version = std::fs::read_to_string(&local_manifest_path)
        .map(|c| parse_manifest_version(&c))
        .unwrap_or_else(|_| "0.0.0".to_string());

    // 第三步：读取远程 origin/master 的 manifest.json 版本
    let remote_version = std::process::Command::new("git")
        .args(["-C", &git_root.to_string_lossy(), "show", "origin/master:manifest.json"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .map(|c| parse_manifest_version(&c))
        .unwrap_or_else(|| "0.0.0".to_string());

    // 第四步：比较版本
    let update_available = compare_versions(&remote_version, &local_version) > 0;

    // 第五步：有更新且需要同步时，强制拉取
    if update_available && should_sync {
        let reset = std::process::Command::new("git")
            .args(["-C", &git_root.to_string_lossy(), "reset", "--hard", "origin/master"])
            .output();

        match reset {
            Ok(o) if o.status.success() => HostResponse {
                ok: Some(true),
                current_version: Some(local_version),
                latest_version: Some(remote_version),
                update_available: Some(true),
                synced: Some(true),
                ..Default::default()
            },
            Ok(o) => HostResponse {
                ok: Some(false),
                error: Some(format!(
                    "Git reset 失败：{}",
                    String::from_utf8_lossy(&o.stderr).trim()
                )),
                current_version: Some(local_version),
                latest_version: Some(remote_version),
                update_available: Some(true),
                synced: Some(false),
                ..Default::default()
            },
            Err(e) => HostResponse {
                ok: Some(false),
                error: Some(format!("Git reset 执行失败：{}", e)),
                current_version: Some(local_version),
                latest_version: Some(remote_version),
                update_available: Some(true),
                synced: Some(false),
                ..Default::default()
            },
        }
    } else {
        // 只读检查或无更新
        HostResponse {
            ok: Some(true),
            current_version: Some(local_version),
            latest_version: Some(remote_version),
            update_available: Some(update_available),
            synced: Some(false),
            ..Default::default()
        }
    }
}

// Public functions
pub fn handle_request(request: HostRequest) -> HostResponse {
    match request.command.as_str() {
        "ping" => HostResponse {
            ok: Some(true),
            host_name: Some("com.cloudpiovt.editor_helper".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            ..Default::default()
        },
        "write_directory_files" => write_directory_files(&request.directory_path, &request.files),
        "read_directory_files" => read_directory_files(&request.directory_path, &request.files),
        "pick_editor" => pick_editor(&request.existing_path),
        "pick_directory" => pick_directory(&request.existing_path),
        "launch_native_editor" => launch_native_editor(
            &request.executable_path,
            &request.arguments_template,
            &request.target_path,
        ),
        "git_sync" => git_sync(request.sync),
        _ => HostResponse {
            ok: Some(false),
            error: Some(format!("Unsupported command: {}", request.command)),
            ..Default::default()
        },
    }
}

pub fn normalize_directory_path(directory_path: &str) -> Result<String, NativeHostError> {
    if directory_path.is_empty() {
        return Err(NativeHostError::DirectoryNotFound(
            "Directory path is empty".to_string(),
        ));
    }

    let metadata = std::fs::metadata(directory_path)?;
    if !metadata.is_dir() {
        return Err(NativeHostError::DirectoryNotFound(
            "Path is not a directory".to_string(),
        ));
    }

    let canonical = std::path::Path::new(directory_path).canonicalize()?;

    Ok(canonical.to_string_lossy().to_string())
}

pub fn resolve_file_path(directory_path: &str, file_name: &str) -> Result<String, NativeHostError> {
    if file_name.is_empty() {
        return Err(NativeHostError::InvalidMessage(
            "File name is missing".to_string(),
        ));
    }

    // Check for path traversal (only prohibit ..)
    if file_name.contains("..") {
        return Err(NativeHostError::PathTraversal(
            "File name contains path traversal characters".to_string(),
        ));
    }

    let dir_path = normalize_directory_path(directory_path)?;
    let mut full_path = std::path::PathBuf::from(&dir_path);
    full_path.push(file_name);

    // Get canonical directory path for comparison
    let dir_canonical = std::path::Path::new(&dir_path).canonicalize()?;

    // Get canonical file path
    let file_canonical = if full_path.exists() {
        full_path.canonicalize()?
    } else if full_path.parent().map_or(false, |p| p.exists()) {
        // Parent exists, canonicalize parent and append file name
        let parent = full_path.parent().unwrap();
        let parent_canonical = parent.canonicalize()?;
        parent_canonical.join(file_name)
    } else {
        // Neither file nor parent exists - use the path as-is (will be created later)
        full_path
    };

    // Verify the resolved path is within the directory
    if !file_canonical.starts_with(&dir_canonical) {
        return Err(NativeHostError::PathTraversal(format!(
            "File path escapes target directory: {}",
            file_name
        )));
    }

    Ok(file_canonical.to_string_lossy().to_string())
}

pub fn read_message<R: std::io::Read>(
    input: &mut R,
) -> Result<Option<HostRequest>, NativeHostError> {
    let mut length_buffer = [0u8; 4];
    let bytes_read = input.read(&mut length_buffer)?;

    if bytes_read == 0 {
        return Ok(None); // EOF
    }

    if bytes_read < 4 {
        return Err(NativeHostError::InvalidMessage(
            "Invalid native messaging frame header".to_string(),
        ));
    }

    let length = u32::from_le_bytes(length_buffer);
    if length == 0 {
        return Ok(None);
    }

    let mut payload_buffer = vec![0u8; length as usize];
    input.read_exact(&mut payload_buffer)?;

    let json = String::from_utf8_lossy(&payload_buffer);
    let request: HostRequest = serde_json::from_str(&json)?;

    Ok(Some(request))
}

pub fn write_message<W: std::io::Write>(
    output: &mut W,
    response: &HostResponse,
) -> Result<(), NativeHostError> {
    let json = serde_json::to_string(response)?;
    let payload = json.as_bytes();
    let length = payload.len() as u32;

    output.write_all(&length.to_le_bytes())?;
    output.write_all(payload)?;
    output.flush()?;

    Ok(())
}

// Unit tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ping_command_returns_ok() {
        let request = HostRequest {
            command: "ping".to_string(),
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(response.ok.unwrap_or(false));
        assert_eq!(
            response.host_name,
            Some("com.cloudpiovt.editor_helper".to_string())
        );
        assert!(response.version.is_some());
    }

    #[test]
    fn test_unknown_command_returns_error() {
        let request = HostRequest {
            command: "unknown".to_string(),
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(!response.ok.unwrap_or(true));
        assert!(response.error.unwrap().contains("Unsupported command"));
    }

    #[test]
    fn test_normalize_directory_path_valid() {
        let temp_dir = std::env::temp_dir();
        let result = normalize_directory_path(temp_dir.to_str().unwrap());
        assert!(result.is_ok());
    }

    #[test]
    fn test_normalize_directory_path_invalid() {
        let result = normalize_directory_path("C:\\non_existent_path_12345");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_file_path_valid() {
        let temp_dir = std::env::temp_dir();
        let file_name = "test.txt";

        let result = resolve_file_path(temp_dir.to_str().unwrap(), file_name);

        assert!(result.is_ok());
        let resolved = result.unwrap();
        assert!(resolved.ends_with(file_name));
    }

    #[test]
    fn test_resolve_file_path_path_traversal() {
        let temp_dir = std::env::temp_dir();
        let file_name = "..\\..\\etc\\passwd";

        let result = resolve_file_path(temp_dir.to_str().unwrap(), file_name);

        assert!(result.is_err());
    }

    #[test]
    fn test_write_message_format() {
        let response = HostResponse {
            ok: Some(true),
            cancelled: Some(false),
            error: None,
            host_name: Some("test".to_string()),
            version: Some("1.0.0".to_string()),
            executable_path: None,
            display_name: None,
            directory_path: None,
            files: None,
            current_version: None,
            latest_version: None,
            update_available: None,
            synced: None,
        };

        let mut output = vec![];
        write_message(&mut output, &response).unwrap();

        // Check length prefix (first 4 bytes)
        let length = u32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(length as usize + 4, output.len());
    }
}
