use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use base64::Engine;
use chrono::{DateTime, Local};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif"];

#[derive(Debug, Serialize, Clone)]
pub struct ImageInfo {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub ext: String,
    pub size_bytes: u64,
    pub modified: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub images: Vec<ImageInfo>,
    pub total: usize,
}

/// 扫描文件夹，递归获取所有图片文件信息
#[tauri::command]
fn scan_folder(path: String) -> Result<ScanResult, String> {
    let mut images = Vec::new();
    let path = Path::new(&path);

    if !path.exists() {
        return Err("路径不存在".into());
    }

    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }

        let ext = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let metadata = fs::metadata(entry_path).map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| {
                let dt: DateTime<Local> =
                    DateTime::from_timestamp(d.as_secs() as i64, 0)
                        .unwrap_or_default()
                        .into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_default();

        let (width, height) = get_image_dimensions(entry_path);

        let full_path = entry_path.to_string_lossy().to_string();
        let name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let dir = entry_path
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();

        images.push(ImageInfo {
            path: full_path,
            name,
            dir,
            ext,
            size_bytes: metadata.len(),
            modified,
            width,
            height,
        });
    }

    let total = images.len();
    Ok(ScanResult { images, total })
}

/// 扫描多个文件夹
#[tauri::command]
fn scan_folders(paths: Vec<String>) -> Result<Vec<ScanResult>, String> {
    let mut results = Vec::new();
    for path in paths {
        let result = scan_folder(path.clone())?;
        results.push(result);
    }
    Ok(results)
}

#[derive(serde::Serialize, Clone)]
struct DirProgress {
    dir: String,
    images: Vec<ImageInfo>,
    root: String,
}

/// 渐进式扫描：边遍历边发送事件，前端实时构建树
#[tauri::command]
fn scan_folders_progressive(app_handle: AppHandle, paths: Vec<String>) -> Result<(), String> {
    std::thread::spawn(move || {
        for root_path in &paths {
            let root_dir = Path::new(root_path);
            if !root_dir.exists() {
                continue;
            }
            // 缓存当前正在收集的目录及其图片
            let mut current_dir: Option<String> = None;
            let mut current_images: Vec<ImageInfo> = Vec::new();

            // 发送已收集的目录批次
            let flush = |dir: &str, images: &mut Vec<ImageInfo>| {
                if !images.is_empty() {
                    let _ = app_handle.emit(
                        "scan-dir-progress",
                        DirProgress {
                            dir: dir.to_string(),
                            images: std::mem::take(images),
                            root: root_path.clone(),
                        },
                    );
                }
            };

            for entry in WalkDir::new(root_dir)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }
                let ext = entry_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                    continue;
                }
                let metadata = match fs::metadata(entry_path) {
                    Ok(m) => m,
                    _ => continue,
                };
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| {
                        let dt: DateTime<Local> =
                            DateTime::from_timestamp(d.as_secs() as i64, 0)
                                .unwrap_or_default()
                                .into();
                        dt.format("%Y-%m-%d %H:%M:%S").to_string()
                    })
                    .unwrap_or_default();
                let (width, height) = get_image_dimensions(entry_path);
                let full_path = entry_path.to_string_lossy().to_string();
                let name = entry_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                let dir = entry_path
                    .parent()
                    .and_then(|p| p.to_str())
                    .unwrap_or("")
                    .to_string();

                // 切换目录时，先发走上一批
                if let Some(ref cur) = current_dir {
                    if cur != &dir {
                        flush(cur, &mut current_images);
                        current_dir = Some(dir.clone());
                    }
                } else {
                    current_dir = Some(dir.clone());
                }

                current_images.push(ImageInfo {
                    path: full_path,
                    name,
                    dir,
                    ext,
                    size_bytes: metadata.len(),
                    modified,
                    width,
                    height,
                });
            }

            // 发送最后一个目录
            if let Some(ref dir) = current_dir {
                flush(dir, &mut current_images);
            }
        }
        let _ = app_handle.emit("scan-all-complete", ());
    });
    Ok(())
}

/// 获取图片文件的基础64编码数据（按需加载）
#[tauri::command]
fn load_image_base64(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("文件不存在".into());
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// 解码 Undefined 类型值（如 UserComment），参考 piexif 的处理方式
fn decode_undefined(data: &[u8]) -> String {
    let payload = if data.len() > 8 {
        let prefix = &data[..8];
        // 跳过常见编码前缀 ASCII\0\0\0, UNICODE\0, JIS\0\0\0\0\0
        if prefix.starts_with(b"ASCII")
            || prefix.starts_with(b"UNICODE")
            || prefix.starts_with(b"JIS")
        {
            &data[8..]
        } else {
            data
        }
    } else {
        data
    };

    String::from_utf8(payload.to_vec())
        .unwrap_or_else(|_| String::from_utf8_lossy(payload).into_owned())
}

/// 获取图片EXIF元信息
#[tauri::command]
fn get_image_metadata(path: String) -> Result<Vec<Vec<String>>, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("文件不存在".into());
    }

    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf_reader = std::io::BufReader::new(file);
    let exif_reader = exif::Reader::new();
    let exif = match exif_reader.read_from_container(&mut buf_reader) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()), // 无EXIF数据或格式不支持
    };

    let mut fields = Vec::new();
    for field in exif.fields() {
        let tag = format!("{}", field.tag);
        let value = match &field.value {
            exif::Value::Undefined(data, _) => decode_undefined(data),
            _ => field.display_value().to_string(),
        };
        fields.push(vec![tag, value]);
    }

    if fields.is_empty() {
        if let Ok(meta) = fs::metadata(path) {
            fields.push(vec!["文件大小".into(), format!("{} bytes", meta.len())]);
        }
    }

    Ok(fields)
}

/// 在系统文件管理器中打开文件/文件夹
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        Err("不支持的操作系统".into())
    }
}

/// 删除文件（放入回收站）
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// 检查路径是否为目录
#[tauri::command]
fn check_is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// 用指定程序打开文件
#[tauri::command]
fn open_with_program(path: String, program: String) -> Result<(), String> {
    std::process::Command::new(&program)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("启动程序失败: {}", e))?;
    Ok(())
}

/// 获取config-user.yaml的路径（软件exe所在目录）
fn config_path() -> PathBuf {
    let exe = env::current_exe().unwrap_or_default();
    exe.parent()
        .unwrap_or(Path::new("."))
        .join("config-user.yaml")
}

/// 加载配置
#[tauri::command]
fn load_config() -> Result<serde_json::Value, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let yaml_value: serde_yaml::Value =
        serde_yaml::from_str(&content).map_err(|e| e.to_string())?;
    let json = serde_json::to_value(yaml_value).map_err(|e| e.to_string())?;
    Ok(json)
}

/// 获取命令行传入的路径参数（跳过第一个为exe路径）
#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().skip(1).collect()
}

/// 设置是否抑制文件变更事件（自身操作时忽略）
#[tauri::command]
fn set_suppress_watcher(app_handle: AppHandle, suppress: bool) -> Result<(), String> {
    if let Some(state) = app_handle.try_state::<Mutex<bool>>() {
        if let Ok(mut guard) = state.lock() {
            *guard = suppress;
        }
    }
    Ok(())
}

/// 更新文件监听器（监视根文件夹的变更）
#[tauri::command]
fn update_watcher(app_handle: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let handle = app_handle.clone();

    // 创建递归监听器
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            // 被抑制时跳过（自身操作导致的变更）
            if let Some(s) = handle.try_state::<Mutex<bool>>() {
                if let Ok(flag) = s.lock() {
                    if *flag {
                        return;
                    }
                }
            }
            // 只关注创建、修改、删除事件
            if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
                let paths: Vec<String> = event.paths.iter().filter_map(|p| {
                    let ext = p.extension()?.to_str()?.to_lowercase();
                    if SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                        Some(p.to_string_lossy().to_string())
                    } else {
                        None
                    }
                }).collect();
                if !paths.is_empty() {
                    let _ = handle.emit("fs-changed", paths);
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;

    // 添加所有根路径
    for p in &paths {
        let dir = Path::new(p);
        if dir.exists() {
            watcher
                .watch(dir, RecursiveMode::Recursive)
                .map_err(|e| format!("监听 {} 失败: {}", p, e))?;
        }
    }

    // 替换旧的监听器
    if let Some(state) = app_handle.try_state::<Mutex<Option<RecommendedWatcher>>>() {
        if let Ok(mut guard) = state.lock() {
            *guard = Some(watcher);
        }
    }

    Ok(())
}

/// 获取多个文件的信息（用于细粒度刷新）
#[tauri::command]
fn get_files_info(paths: Vec<String>) -> Result<Vec<ImageInfo>, String> {
    let mut result = Vec::new();
    for p in &paths {
        let entry_path = Path::new(p);
        if !entry_path.exists() || !entry_path.is_file() {
            continue;
        }
        let ext = entry_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        let metadata = fs::metadata(entry_path).map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| {
                let dt: DateTime<Local> =
                    DateTime::from_timestamp(d.as_secs() as i64, 0)
                        .unwrap_or_default()
                        .into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_default();
        let (width, height) = get_image_dimensions(entry_path);
        let name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let dir = entry_path
            .parent()
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();
        result.push(ImageInfo {
            path: p.clone(),
            name,
            dir,
            ext,
            size_bytes: metadata.len(),
            modified,
            width,
            height,
        });
    }
    Ok(result)
}

/// 保存配置
#[tauri::command]
fn save_config(settings: serde_json::Value) -> Result<(), String> {
    let path = config_path();
    let yaml_value: serde_yaml::Value =
        serde_json::from_value(settings).map_err(|e| e.to_string())?;
    let yaml_str = serde_yaml::to_string(&yaml_value).map_err(|e| e.to_string())?;
    fs::write(&path, yaml_str).map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取图片尺寸
fn get_image_dimensions(path: &Path) -> (u32, u32) {
    match imagesize::size(path) {
        Ok(dim) => (dim.width as u32, dim.height as u32),
        Err(_) => (0, 0),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(None::<RecommendedWatcher>))
        .manage(Mutex::new(false))
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            scan_folders,
            load_image_base64,
            get_image_metadata,
            open_in_explorer,
            check_is_dir,
            open_with_program,
            load_config,
            save_config,
            get_cli_args,
            delete_file,
            update_watcher,
            set_suppress_watcher,
            get_files_info,
            scan_folders_progressive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
