use std::env;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use base64::Engine;
use chrono::{DateTime, Local};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "bmp", "gif",
    "pcx", "tif", "tiff", "jxl", "avif", "svg",
    "ico",
];

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
fn scan_folder(path: String, scan_all_files: bool) -> Result<ScanResult, String> {
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

        if !scan_all_files && !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
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
fn scan_folders(paths: Vec<String>, scan_all_files: bool) -> Result<Vec<ScanResult>, String> {
    let mut results = Vec::new();
    for path in paths {
        let result = scan_folder(path.clone(), scan_all_files)?;
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

/// 渐进式扫描取消标志
static SCAN_CANCELLED: AtomicBool = AtomicBool::new(false);

/// 渐进式扫描：边遍历边发送事件，前端实时构建树
#[tauri::command]
fn scan_folders_progressive(app_handle: AppHandle, paths: Vec<String>, scan_all_files: bool) -> Result<(), String> {
    SCAN_CANCELLED.store(false, Ordering::Relaxed);

    std::thread::spawn(move || {
        for root_path in &paths {
            if SCAN_CANCELLED.load(Ordering::Relaxed) { break; }

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
                if SCAN_CANCELLED.load(Ordering::Relaxed) { break; }

                let entry_path = entry.path();
                if !entry_path.is_file() {
                    continue;
                }
                let ext = entry_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                if !scan_all_files && !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
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

            if SCAN_CANCELLED.load(Ordering::Relaxed) { break; }

            // 发送最后一个目录
            if let Some(ref dir) = current_dir {
                flush(dir, &mut current_images);
            }
        }
        let _ = app_handle.emit("scan-all-complete", ());
    });
    Ok(())
}

/// 取消正在进行的渐进式扫描
#[tauri::command]
fn cancel_scan() -> Result<(), String> {
    SCAN_CANCELLED.store(true, Ordering::Relaxed);
    Ok(())
}

/// 将图片编码为 PNG base64 data URI
fn encode_to_png_base64(img: &image::DynamicImage) -> Result<String, String> {
    let mut png_data = Vec::new();
    img.write_to(&mut Cursor::new(&mut png_data), image::ImageFormat::Png)
        .map_err(|e| format!("PNG 编码失败: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_data);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// 获取图片文件的基础64编码数据（按需加载）
#[tauri::command]
fn load_image_base64(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("文件不存在".into());
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let data = fs::read(path).map_err(|e| e.to_string())?;

    match ext.as_str() {
        // ===== 浏览器直接支持的格式：原始 data URI =====
        "jpg" | "jpeg" => Ok(make_data_uri(&data, "image/jpeg")),
        "png" => Ok(make_data_uri(&data, "image/png")),
        "webp" => Ok(make_data_uri(&data, "image/webp")),
        "bmp" => Ok(make_data_uri(&data, "image/bmp")),
        "gif" => Ok(make_data_uri(&data, "image/gif")),
        "avif" => Ok(make_data_uri(&data, "image/avif")),
        "svg" => Ok(make_data_uri(&data, "image/svg+xml")),
        "ico" => Ok(make_data_uri(&data, "image/x-icon")),

        // ===== 需 Rust 端解码的格式：解码后编码为 PNG =====
        "pcx" => {
            let mut reader = pcx::Reader::from_mem(&data)
                .map_err(|e| format!("PCX 读取失败: {}", e))?;
            let w = reader.width() as u32;
            let h = reader.height() as u32;
            let mut rgb = vec![0u8; (w * h * 3) as usize];
            reader.read_rgb_pixels(&mut rgb)
                .map_err(|e| format!("PCX 解码失败: {}", e))?;
            // RGB → RGBA
            let mut rgba = Vec::with_capacity((w * h * 4) as usize);
            for chunk in rgb.chunks(3) {
                rgba.push(chunk[0]);
                rgba.push(chunk[1]);
                rgba.push(chunk[2]);
                rgba.push(255);
            }
            let img = image::RgbaImage::from_raw(w, h, rgba)
                .ok_or("PCX: 无法创建图像".to_string())?;
            encode_to_png_base64(&image::DynamicImage::from(img))
        }
        "tif" | "tiff" => {
            let img = image::load_from_memory_with_format(&data, image::ImageFormat::Tiff)
                .map_err(|e| format!("TIFF 解码失败: {}", e))?;
            encode_to_png_base64(&img)
        }
        "jxl" => {
            let image = jxl_oxide::JxlImage::builder()
                .read(Cursor::new(&data))
                .map_err(|e| format!("JXL 读取失败: {}", e))?;
            let rendered = image.render_frame(0)
                .map_err(|e| format!("JXL 渲染失败: {}", e))?;
            let mut stream = rendered.stream();
            let w = stream.width();
            let h = stream.height();
            let ch = stream.channels();
            let mut raw = vec![0u8; (w * h * ch) as usize];
            stream.write_to_buffer(&mut raw);
            // 转为 RGBA（如有 alpha 通道则保留，否则补 255）
            let rgba = if ch >= 4 {
                raw
            } else {
                let mut pixels = Vec::with_capacity((w * h * 4) as usize);
                for i in 0..(w * h) as usize {
                    let src = i * ch as usize;
                    pixels.push(if ch > 0 { raw[src] } else { 0 });
                    pixels.push(if ch > 1 { raw[src + 1] } else { 0 });
                    pixels.push(if ch > 2 { raw[src + 2] } else { 0 });
                    pixels.push(255);
                }
                pixels
            };
            let img = image::RgbaImage::from_raw(w, h, rgba)
                .ok_or("JXL: 无法创建图像".to_string())?;
            encode_to_png_base64(&image::DynamicImage::from(img))
        }

        _ => Err(format!("不支持的图片格式: {}", ext)),
    }
}

/// 读取文件文本内容（限制 1MB，二进制检测用 null byte）
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err("文件不存在".into());
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > 1024 * 1024 {
        return Err("文件超过 1MB 限制".into());
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    // 二进制检测：前 4KB 中是否有 null byte
    let check_len = data.len().min(4096);
    if data[..check_len].contains(&0u8) {
        return Err("二进制文件，无法以文本显示".into());
    }
    // 尝试 UTF-8 解码
    String::from_utf8(data).map_err(|_| "文件编码不是有效的 UTF-8".to_string())
}

/// 创建 data URI
fn make_data_uri(data: &[u8], mime: &str) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
    format!("data:{};base64,{}", mime, b64)
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
        // explorer.exe 只认反斜杠路径，将正斜杠替换为反斜杠
        let win_path = path.replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(&win_path)
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

/// 遇到目标已存在时，返回自动添加 `-copy` 后缀的不冲突路径
fn auto_rename_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or(Path::new("."));
    let stem = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    // 尝试 "文件名-copy.ext", "文件名-copy (2).ext", ...
    let candidate = format!("{}-copy{}", stem, ext);
    let mut candidate_path = parent.join(&candidate);
    if !candidate_path.exists() {
        return candidate_path;
    }
    for i in 2.. {
        let name = format!("{}-copy ({}){}", stem, i, ext);
        candidate_path = parent.join(&name);
        if !candidate_path.exists() {
            return candidate_path;
        }
    }
    // 理论上不会跑到这里
    path.to_path_buf()
}

/// 复制文件列表到目标目录（保留相对路径结构，自动处理重名）
#[tauri::command]
fn copy_files(files: Vec<Vec<String>>, dest_dir: String) -> Result<(), String> {
    for pair in &files {
        if pair.len() < 2 { continue; }
        let source = &pair[0];
        let relative = &pair[1];
        let dest_path = Path::new(&dest_dir).join(relative);
        // 创建父目录
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        // 自动重命名避免覆盖
        let final_path = auto_rename_path(&dest_path);
        fs::copy(source, &final_path).map_err(|e| format!("复制文件失败 ({} -> {}): {}", source, final_path.display(), e))?;
    }
    Ok(())
}

/// 移动文件列表到目标目录（优先重命名，跨卷时回退到复制+删除，自动处理重名）
/// 移动完成后会清理 cleanup_dirs 中指定的目录及其下所有空的子目录
#[tauri::command]
fn move_files(files: Vec<Vec<String>>, dest_dir: String, cleanup_dirs: Vec<String>) -> Result<Vec<String>, String> {
    let mut moved = Vec::new();
    for pair in &files {
        if pair.len() < 2 { continue; }
        let source = &pair[0];
        let relative = &pair[1];
        let source_path = Path::new(&source);
        let dest_path = Path::new(&dest_dir).join(relative);

        // 若目标路径与源路径相同，跳过
        if source_path == dest_path {
            continue;
        }

        // 创建父目录
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }

        // 自动重命名（处理重名冲突）
        let final_path = auto_rename_path(&dest_path);

        // 规范化比较，确保目标与源不是同一个文件
        if let (Ok(src_canon), Ok(dst_canon)) = (
            source_path.canonicalize(),
            final_path.canonicalize(),
        ) {
            if src_canon == dst_canon {
                continue;
            }
        }

        // 优先尝试重命名（同文件系统，瞬间完成）
        match fs::rename(source, &final_path) {
            Ok(()) => {
                moved.push(source.clone());
            }
            Err(e) => {
                // 跨卷时 rename 失败，回退到复制+删除（保留创建时间等元数据）
                fs::copy(source, &final_path)
                    .map_err(|_| format!("移动失败 ({} -> {}): {}", source, final_path.display(), e))?;
                // 复制源文件的时间戳到目标文件（保留修改时间、访问时间、创建时间）
                if let Ok(src_meta) = fs::metadata(source) {
                    use std::fs::FileTimes;
                    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&final_path) {
                        let mut times = FileTimes::new();
                        if let Ok(t) = src_meta.accessed() { times = times.set_accessed(t); }
                        if let Ok(t) = src_meta.modified() { times = times.set_modified(t); }
                        #[cfg(windows)]
                        if let Ok(t) = src_meta.created() {
                            use std::os::windows::fs::FileTimesExt;
                            times = times.set_created(t);
                        }
                        let _ = file.set_times(times);
                    }
                }
                fs::remove_file(source)
                    .map_err(|_| format!("移动-删除源文件失败 ({}): {}", source, e))?;
                moved.push(source.clone());
            }
        }
    }

    // 从选中的节点目录向下递归清理空目录
    for dir_str in &cleanup_dirs {
        let dir = Path::new(dir_str);
        remove_empty_dirs_recursive(dir);
    }

    Ok(moved)
}

/// 递归清理空目录：先处理子目录（深优先），再尝试删除自身
fn remove_empty_dirs_recursive(dir: &Path) {
    if !dir.is_dir() {
        return;
    }
    // 先递归处理所有子目录
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                remove_empty_dirs_recursive(&entry.path());
            }
        }
    }
    // 再尝试删除自己（如果为空）
    let _ = try_remove_empty_dir(dir);
}

/// 尝试删除空目录
/// - 目录不存在或不是目录 → Err（停止向上递归）
/// - 目录非空 → Err（停止向上递归）
/// - 目录为空并成功删除 → Ok(())
fn try_remove_empty_dir(dir: &Path) -> Result<(), std::io::Error> {
    if !dir.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "not a directory"));
    }
    let mut has_entries = false;
    if let Ok(mut read) = fs::read_dir(dir) {
        has_entries = read.next().is_some();
    }
    if has_entries {
        return Err(std::io::Error::new(std::io::ErrorKind::DirectoryNotEmpty, "directory not empty"));
    }
    fs::remove_dir(dir)?;
    Ok(())
}

/// 删除文件（放入回收站）
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// 批量删除路径到回收站（支持文件和文件夹）
#[tauri::command]
fn trash_paths(paths: Vec<String>) -> Result<(), String> {
    for p in &paths {
        trash::delete(p).map_err(|e| format!("删除失败 ({}): {}", p, e))?;
    }
    Ok(())
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
fn get_files_info(paths: Vec<String>, scan_all_files: bool) -> Result<Vec<ImageInfo>, String> {
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
        if !scan_all_files && !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
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
/// 获取图片尺寸，SVG/PCX 特殊处理（imagesize 可能不支持某些变体）
fn get_image_dimensions(path: &Path) -> (u32, u32) {
    // 先尝试 imagesize（支持绝大多数光栅格式）
    if let Ok(dim) = imagesize::size(path) {
        return (dim.width as u32, dim.height as u32);
    }
    // 读取文件头做回退解析
    if let Ok(data) = fs::read(path) {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext == "svg" {
            if let Ok(text) = std::str::from_utf8(&data) {
                if let Some(dim) = parse_svg_dimensions(text) {
                    return dim;
                }
            }
        }
        if ext == "pcx" {
            if let Some(dim) = parse_pcx_dimensions(&data) {
                return dim;
            }
        }
    }
    (0, 0)
}

/// 从 PCX 文件头解析尺寸
fn parse_pcx_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 12 { return None; }
    if data[0] != 0x0A { return None; }
    let xmin = u16::from_le_bytes([data[4], data[5]]) as i32;
    let ymin = u16::from_le_bytes([data[6], data[7]]) as i32;
    let xmax = u16::from_le_bytes([data[8], data[9]]) as i32;
    let ymax = u16::from_le_bytes([data[10], data[11]]) as i32;
    let w = (xmax - xmin + 1) as u32;
    let h = (ymax - ymin + 1) as u32;
    if w > 0 && h > 0 && w < 65536 && h < 65536 {
        Some((w, h))
    } else {
        None
    }
}

/// 从 SVG XML 中提取宽高（支持 viewBox、width/height 属性）
fn parse_svg_dimensions(svg: &str) -> Option<(u32, u32)> {
    // 跳过 BOM 和空白，找到 <svg 标签
    let svg_start = svg.find("<svg")?;
    let svg_tag_end = svg[svg_start..].find('>')?;
    let tag = &svg[svg_start..svg_start + svg_tag_end];

    // 提取属性的辅助函数：attr="value" 或 attr='value'
    fn get_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
        for quote in ['"', '\''] {
            let pattern = format!("{}={}", attr, quote);
            if let Some(start) = tag.find(&pattern) {
                let val_start = start + pattern.len();
                if let Some(val_end) = tag[val_start..].find(quote) {
                    return Some(&tag[val_start..val_start + val_end]);
                }
            }
        }
        None
    }

    // 从字符串中提取第一个数值（去掉 px/pt/em 等单位）
    fn parse_num(s: &str) -> Option<u32> {
        let num_str: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        if num_str.is_empty() { return None; }
        num_str.parse::<f64>().ok().map(|v| v.ceil() as u32)
    }

    // 优先 width/height 属性
    if let (Some(w_str), Some(h_str)) = (get_attr(tag, "width"), get_attr(tag, "height")) {
        if let (Some(w), Some(h)) = (parse_num(w_str), parse_num(h_str)) {
            if w > 0 && h > 0 {
                return Some((w, h));
            }
        }
    }

    // 退回到 viewBox="minX minY width height"
    if let Some(vb) = get_attr(tag, "viewBox") {
        let parts: Vec<f64> = vb
            .split_whitespace()
            .filter_map(|s| s.parse::<f64>().ok())
            .collect();
        if parts.len() >= 4 {
            let w = (parts[2] - parts[0]).ceil() as u32;
            let h = (parts[3] - parts[1]).ceil() as u32;
            if w > 0 && h > 0 {
                return Some((w, h));
            }
        }
    }

    None
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
            trash_paths,
            copy_files,
            move_files,
            update_watcher,
            set_suppress_watcher,
            get_files_info,
            scan_folders_progressive,
            cancel_scan,
            read_file_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
