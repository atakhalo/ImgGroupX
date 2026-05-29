🌐 English | [中文](README.md)

# ImgGroupX — Multi-Folder Image Group Browser

> A high-performance desktop image management tool built with **Tauri v2 + Vue 3 + Rust**. Easily manage, browse, filter, and compare large collections of images.

[📺 YouTube Video Demo](https://youtu.be/FW07Nv0fMWU)[📺 bilibili Video Demo](https://www.bilibili.com/video/BV1hHLi6ZE8P/)

---

## Interface Preview

<table>
	<tr>
		<td align="center"><img src="DocImage/mainView.webp" height="300" alt="Group View"></td>
		<td align="center"><img src="DocImage/rainbow.webp" height="300" alt="Rainbow View"></td>
	</tr>
	<tr>
		<td align="center"><b>📂 Group View</b></td>
		<td align="center"><b>🌈 Rainbow Tier View</b></td>
	</tr>
	<tr>
		<td align="center"><img src="DocImage/groupNoTitle.webp" height="300" alt="Compact Group View"></td>
		<td align="center"><img src="DocImage/nogroup.webp" height="300" alt="Compact View"></td>
	</tr>
	<tr>
		<td align="center"><b>🔇 Compact Group View</b></td>
		<td align="center"><b>📦 Compact View</b></td>
	</tr>
	<tr>
		<td align="center"><img src="DocImage/bigView.webp" height="300" alt="Image Viewer"></td>
		<td align="center"><img src="DocImage/compare.webp" height="300" alt="Compare Mode"></td>
	</tr>
	<tr>
		<td align="center"><b>🖼️ Image Viewer</b></td>
		<td align="center"><b>⚖️ Compare Mode</b></td>
	</tr>
</table>

---

## ✨ Core Features

### 📁 Grid & Group View
- **Auto folder grouping** — Organized in a folder tree with hierarchical display
- **Virtual groups** — Create temporary groups from arbitrary selected images
- **Multi-folder viewing** — Browse multiple folders at once; compact mode for efficient small-folder handling
- **Rainbow tier coloring** — Depth-based auto-cycling background colors for clear hierarchy

### 🏷️ 5-Level Mark System
- Customizable mark colors with visible borders and badges in grid view
- Select/deselect by mark level, batch mark operations
- Keyboard shortcuts: `1`-`5` to mark, `` ` `` / `0` to clear

### 🛠️ Batch Management
- Move, copy, delete (to recycle bin) with directory structure preservation
- Auto-rename on conflict (`-copy` suffix)
- **Node-level selection** — Select entire folder nodes with select-all / invert / first-level quick actions
- **Right-click context menus** — Grid/viewer/compare: copy image, copy path, rename, save as

### 🔍 Filter & Sort
- Filter by filename / folder name / full path using regex
- Save filters as presets for quick switching
- Sort by name / date / size, ascending or descending

### 🖼️ Image Viewer
- Zoom with mouse wheel, pan mode, fit to window, fullscreen
- **Mark menu** — Set/clear marks directly in the viewer
- Open with external programs

### ⚖️ Comparison Matrix
- Compare 2 to 8 images in a comparison matrix (triangular / full matrix layout)
- Drag dividers synchronize across all panes for multi-image comparison
- Synchronized zoom and pan for detailed comparison

### ⌨️ Customizable Shortcuts
- All keyboard shortcuts (including alternative keys) are configurable in Settings

### ⚡ Performance
- Progressive scanning — renders each directory as soon as it's scanned
- Lazy loading — images load only when visible; size threshold skip for large files (placeholder only)
- File system watcher — auto-detects external changes with incremental refresh

---

## 🚀 Quick Start

```bash
# Development mode (hot reload)
npm run tauri dev

# Production build
npm run tauri build
```

> Requirements: Node.js ≥ 18, Rust ≥ 1.70

---

## 📖 Docs

| Document | Description |
|----------|-------------|
| [📋 Feature List](Docs/功能清单.md) | Complete feature details |
| [🏗️ Architecture](Docs/技术架构.md) | Frontend & backend architecture |
| [📘 Dev Guide](Docs/开发指南.md) | Environment setup & development workflow |

---

## 🧩 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vue 3 + TypeScript + Vite 6 |
| **Desktop** | Tauri v2 |
| **Backend** | Rust |
| **Key Crates** | walkdir · imagesize · kamadak-exif · notify · serde_yaml |

---

## 📄 License

MIT
