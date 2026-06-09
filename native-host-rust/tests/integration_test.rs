// Integration tests for cloudpiovt-native-host
// These tests exercise the public API defined in src/lib.rs

#[cfg(test)]
mod tests {
    use cloudpiovt_native_host::*;
    use base64::{engine::general_purpose, Engine as _};
    use image::{ImageBuffer, ImageFormat, Rgba};
    use std::fs;
    use std::io::Cursor;

    fn test_png_base64() -> String {
        let image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(2, 2, Rgba([30, 120, 220, 255]));
        let mut bytes = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn test_ping_command_returns_ok() {
        let request = HostRequest {
            command: "ping".to_string(),
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(response.ok.unwrap_or(false));
        assert_eq!(response.host_name.unwrap(), "com.cloudpiovt.editor_helper");
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
            ..Default::default()
        };

        let mut output = vec![];
        write_message(&mut output, &response).unwrap();

        // Check length prefix (first 4 bytes)
        let length = u32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(length as usize + 4, output.len());
    }

    #[test]
    fn test_camel_case_request_fields_deserialize() {
        let request: HostRequest = serde_json::from_value(serde_json::json!({
            "command": "write_directory_files",
            "existingPath": "C:\\Program Files\\Editor\\editor.exe",
            "executablePath": "C:\\Program Files\\Editor\\editor.exe",
            "argumentsTemplate": "--goto \"{path}\"",
            "targetPath": "C:\\workspace\\demo",
            "directoryPath": "C:\\workspace",
            "files": [
                {
                    "fileName": "src/main.js",
                    "content": "console.log('ok');",
                    "exists": true
                }
            ],
            "iconKey": "custom-tool",
            "fileName": "tool.png",
            "content": "data:image/png;base64,AAAA"
        }))
        .unwrap();

        // Chrome Native Messaging 由 JS 侧发送 camelCase 字段，Rust 必须保持兼容旧 C# 协议。
        assert_eq!(
            request.existing_path,
            "C:\\Program Files\\Editor\\editor.exe"
        );
        assert_eq!(
            request.executable_path,
            "C:\\Program Files\\Editor\\editor.exe"
        );
        assert_eq!(request.arguments_template, "--goto \"{path}\"");
        assert_eq!(request.target_path, "C:\\workspace\\demo");
        assert_eq!(request.directory_path, "C:\\workspace");
        assert_eq!(request.files[0].file_name, "src/main.js");
        assert_eq!(request.files[0].content, "console.log('ok');");
        assert!(request.files[0].exists);
        assert_eq!(request.icon_key, "custom-tool");
        assert_eq!(request.file_name, "tool.png");
        assert_eq!(request.content, "data:image/png;base64,AAAA");
    }

    #[test]
    fn test_host_response_serializes_camel_case_fields() {
        let response = HostResponse {
            ok: Some(true),
            host_name: Some("com.cloudpiovt.editor_helper".to_string()),
            executable_path: Some("C:\\Program Files\\Editor\\editor.exe".to_string()),
            display_name: Some("editor".to_string()),
            directory_path: Some("C:\\workspace".to_string()),
            ..Default::default()
        };

        let value = serde_json::to_value(response).unwrap();

        // UI 侧读取 hostName/executablePath/displayName/directoryPath，不能输出 snake_case。
        assert_eq!(value["hostName"], "com.cloudpiovt.editor_helper");
        assert_eq!(
            value["executablePath"],
            "C:\\Program Files\\Editor\\editor.exe"
        );
        assert_eq!(value["displayName"], "editor");
        assert_eq!(value["directoryPath"], "C:\\workspace");
        assert!(value.get("host_name").is_none());
        assert!(value.get("executable_path").is_none());
        assert!(value.get("directory_path").is_none());
    }

    #[test]
    fn test_discover_launchers_returns_builtin_entries() {
        let response = discover_launchers();

        assert!(response.ok.unwrap_or(false));
        let launchers = response.launchers.unwrap();
        assert_eq!(launchers.len(), 4);
        assert_eq!(launchers[0].launcher_id, "builtin-vscode");
        assert_eq!(launchers[1].launcher_id, "builtin-idea");
        assert_eq!(launchers[2].launcher_id, "builtin-file-explorer");
        assert_eq!(launchers[3].launcher_id, "builtin-git-bash");
    }

    #[test]
    fn test_extract_executable_icon_missing_path_fails() {
        let response = extract_executable_icon("C:\\non_existent_launcher.exe", "custom-tool");

        assert!(!response.ok.unwrap_or(true));
        assert!(response.error.unwrap().contains("Executable path"));
    }

    #[test]
    fn test_save_and_delete_launcher_icon_generates_three_sizes() {
        let icon_key = format!(
            "custom-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        let response = save_launcher_icon(
            &icon_key,
            "test.png",
            &test_png_base64(),
        );

        assert!(response.ok.unwrap_or(false), "{:?}", response.error);
        let icon_paths = response.icon_paths.unwrap();
        assert_eq!(icon_paths.len(), 3);
        for path in &icon_paths {
            assert!(std::path::Path::new(path).exists(), "missing {}", path);
        }

        let delete_response = delete_launcher_icon(&icon_key);
        assert!(delete_response.ok.unwrap_or(false));
        for path in &icon_paths {
            assert!(!std::path::Path::new(path).exists(), "not deleted {}", path);
        }
    }

    #[test]
    fn test_save_launcher_icon_rejects_svg() {
        let response = save_launcher_icon("custom-svg-test", "icon.svg", "PHN2Zz48L3N2Zz4=");

        assert!(!response.ok.unwrap_or(true));
        assert!(response.error.unwrap().contains("png/webp"));
    }

    #[test]
    fn test_build_editor_arguments_uses_raw_path_when_template_empty() {
        let args = build_editor_arguments("", "C:\\workspace\\demo folder").unwrap();

        assert_eq!(args, vec!["C:\\workspace\\demo folder"]);
    }

    #[test]
    fn test_build_editor_arguments_splits_quoted_template() {
        let args =
            build_editor_arguments("--goto \"{path}\"", "C:\\workspace\\demo folder").unwrap();

        assert_eq!(args, vec!["--goto", "C:/workspace/demo folder"]);
    }

    // Tests for write_directory_files
    #[test]
    fn test_write_directory_files_success() {
        let temp_dir = std::env::temp_dir();
        let unique_dir = temp_dir.join("test_write_1");
        fs::create_dir_all(&unique_dir).unwrap();

        let files = vec![
            HostFileEntry {
                file_name: "test1.txt".to_string(),
                content: "Hello".to_string(),
                exists: false,
                ..Default::default()
            },
            HostFileEntry {
                file_name: "test2.txt".to_string(),
                content: "World".to_string(),
                exists: false,
                ..Default::default()
            },
        ];

        let request = HostRequest {
            command: "write_directory_files".to_string(),
            directory_path: unique_dir.to_str().unwrap().to_string(),
            files,
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(response.ok.unwrap_or(false));
        assert!(response.directory_path.is_some());

        // Cleanup
        fs::remove_dir_all(&unique_dir).unwrap();
    }

    #[test]
    fn test_write_directory_files_creates_parent_dirs() {
        let temp_dir = std::env::temp_dir();
        let unique_dir = temp_dir.join("test_write_2");
        fs::create_dir_all(&unique_dir).unwrap();

        let files = vec![HostFileEntry {
            file_name: "subdir/nested.txt".to_string(),
            content: "Nested".to_string(),
            exists: false,
            ..Default::default()
        }];

        let request = HostRequest {
            command: "write_directory_files".to_string(),
            directory_path: unique_dir.to_str().unwrap().to_string(),
            files,
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(response.ok.unwrap_or(false));

        // Cleanup
        fs::remove_dir_all(&unique_dir).unwrap();
    }

    #[test]
    fn test_write_directory_files_invalid_dir() {
        let files = vec![HostFileEntry {
            file_name: "test.txt".to_string(),
            content: "Hello".to_string(),
            exists: false,
            ..Default::default()
        }];

        let request = HostRequest {
            command: "write_directory_files".to_string(),
            directory_path: "C:\\non_existent".to_string(),
            files,
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(!response.ok.unwrap_or(true));
        assert!(response.error.is_some());
    }

    // Tests for read_directory_files
    #[test]
    fn test_read_directory_files_success() {
        let temp_dir = std::env::temp_dir();
        let unique_dir = temp_dir.join("test_read_1");
        fs::create_dir_all(&unique_dir).unwrap();

        // Create test files
        fs::write(unique_dir.join("read_test1.txt"), "Content 1").unwrap();
        fs::write(unique_dir.join("read_test2.txt"), "Content 2").unwrap();

        let files = vec![
            HostFileEntry {
                file_name: "read_test1.txt".to_string(),
                content: "".to_string(),
                exists: false,
                ..Default::default()
            },
            HostFileEntry {
                file_name: "read_test2.txt".to_string(),
                content: "".to_string(),
                exists: false,
                ..Default::default()
            },
        ];

        let request = HostRequest {
            command: "read_directory_files".to_string(),
            directory_path: unique_dir.to_str().unwrap().to_string(),
            files,
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(response.ok.unwrap_or(false));
        assert!(response.files.is_some());
        let response_files = response.files.unwrap();
        assert_eq!(response_files.len(), 2);
        assert!(response_files[0].exists);
        assert!(response_files[1].exists);

        // Cleanup
        fs::remove_dir_all(&unique_dir).unwrap();
    }

    #[test]
    fn test_read_directory_files_missing_file() {
        let temp_dir = std::env::temp_dir();
        let unique_dir = temp_dir.join("test_read_2");
        fs::create_dir_all(&unique_dir).unwrap();

        let files = vec![HostFileEntry {
            file_name: "missing.txt".to_string(),
            content: "".to_string(),
            exists: false,
            ..Default::default()
        }];

        let request = HostRequest {
            command: "read_directory_files".to_string(),
            directory_path: unique_dir.to_str().unwrap().to_string(),
            files,
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(response.ok.unwrap_or(false));
        assert!(response.files.is_some());
        let response_files = response.files.unwrap();
        assert!(!response_files[0].exists);
        assert_eq!(response_files[0].content, "");

        // Cleanup
        fs::remove_dir_all(&unique_dir).unwrap();
    }

    #[test]
    fn test_stat_directory_files_omits_content() {
        let temp_dir = std::env::temp_dir();
        let unique_dir = temp_dir.join("test_stat_1");
        fs::create_dir_all(&unique_dir).unwrap();
        fs::write(unique_dir.join("metadata.txt"), "Content 1").unwrap();

        let files = vec![
            HostFileEntry {
                file_name: "metadata.txt".to_string(),
                ..Default::default()
            },
            HostFileEntry {
                file_name: "missing.txt".to_string(),
                ..Default::default()
            },
        ];

        let request = HostRequest {
            command: "stat_directory_files".to_string(),
            directory_path: unique_dir.to_str().unwrap().to_string(),
            files,
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(response.ok.unwrap_or(false));
        let response_files = response.files.unwrap();
        assert_eq!(response_files.len(), 2);
        assert!(response_files[0].exists);
        assert_eq!(response_files[0].content, "");
        assert_eq!(response_files[0].size, Some(9));
        assert!(response_files[0].modified_at.is_some());
        assert!(!response_files[1].exists);

        fs::remove_dir_all(&unique_dir).unwrap();
    }

    // 系统文件/目录选择会弹出桌面对话框，自动验证只覆盖结构兼容，完整流程交给人工联调。
    #[test]
    #[ignore = "需要人工桌面交互，自动验证只覆盖协议与文件读写路径。"]
    fn test_pick_editor_command() {
        let request = HostRequest {
            command: "pick_editor".to_string(),
            existing_path: "".to_string(),
            ..Default::default()
        };

        let response = handle_request(request);

        // 无桌面环境可能返回 cancelled=true，这里只确认响应结构不会崩溃。
        if let Some(ok) = response.ok {
            if ok {
                assert!(response.executable_path.is_some());
            }
        }
    }

    #[test]
    #[ignore = "需要人工桌面交互，自动验证只覆盖协议与文件读写路径。"]
    fn test_pick_directory_command() {
        let request = HostRequest {
            command: "pick_directory".to_string(),
            existing_path: "".to_string(),
            ..Default::default()
        };

        let response = handle_request(request);

        // 无桌面环境可能返回 cancelled=true，这里只确认响应结构不会崩溃。
        if let Some(ok) = response.ok {
            if ok {
                assert!(response.directory_path.is_some());
            }
        }
    }

    // Test for launch_native_editor
    #[test]
    fn test_launch_native_editor_missing_executable() {
        let request = HostRequest {
            command: "launch_native_editor".to_string(),
            executable_path: "C:\\non_existent.exe".to_string(),
            target_path: "C:\\temp".to_string(),
            ..Default::default()
        };

        let response = handle_request(request);

        assert!(!response.ok.unwrap_or(true));
        assert!(response.error.is_some());
    }
}
