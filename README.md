🌐 [English](README.EN.md) | 中文

# 格图X — 多文件夹图片分组浏览器

> 基于 **Tauri v2 + Vue 3 + Rust** 的高性能桌面端图片管理工具，轻松管理、浏览、筛选和对比大量图片。

[📺 B站视频演示](https://www.bilibili.com/video/BV1hHLi6ZE8P/)[📺 YouTube](https://youtu.be/FW07Nv0fMWU)

---

## 界面预览

<table>
	<tr>
		<td align="center"><img src="DocImage/mainView.webp" height="300" alt="分组视图"></td>
		<td align="center"><img src="DocImage/rainbow.webp" height="300" alt="彩虹视图"></td>
	</tr>
	<tr>
		<td align="center"><b>📂 分组视图</b></td>
		<td align="center"><b>🌈 彩虹层级视图</b></td>
	</tr>
	<tr>
		<td align="center"><img src="DocImage/groupNoTitle.webp" height="300" alt="分组紧凑视图"></td>
		<td align="center"><img src="DocImage/nogroup.webp" height="300" alt="无分组视图"></td>
	</tr>
	<tr>
		<td align="center"><b>🔇 分组紧凑视图</b></td>
		<td align="center"><b>📦 无分组紧凑视图</b></td>
	</tr>
	<tr>
		<td align="center"><img src="DocImage/bigView.webp" height="300" alt="大图模式"></td>
		<td align="center"><img src="DocImage/compare.webp" height="300" alt="对比模式"></td>
	</tr>
	<tr>
		<td align="center"><b>🖼️ 大图查看</b></td>
		<td align="center"><b>⚖️ 双图对比</b></td>
	</tr>
</table>

---

## ✨ 核心功能

### 📁 网格分组视图
- **自动文件夹分组** — 以文件夹为组，树状层级展示，递归统计图片数
- **手动虚拟分组** — 选中任意图片创建临时分组，支持保存到文件夹
- **多组集合查看** — 同时加载多个文件夹，统一网格浏览
- **彩虹层级着色** — 按目录深度自动轮换背景色，层级一目了然

### 🏷️ 图片标记
- **5 级标记系统** — 自定义标记颜色，网格视图显示彩色边框 + 角标
- **按标记筛选操作** — 按标记等级全选/取消选择，批量标记
- **快捷键支持** — 数字键 1-5 快速标记，`` ` `` / `0` 取消标记

### 🛠️ 管理功能
- **批量操作** — 移动、复制、删除（回收站），保留目录结构
- **智能重命名** — 同名文件自动添加 `-copy` 后缀，避免覆盖
- **节点级选择** — 选中整个文件夹节点，支持全选/反选/一级图片快速操作

### 🔍 筛选与排序
- **三模式筛选** — 按文件名 / 分组名 / 完整路径正则匹配
- **筛选预设** — 常用正则保存为预设，一键切换
- **多维度排序** — 文件名 / 修改日期 / 文件大小，升序或降序

### 🖼️ 大图查看器
- 滚轮缩放、平移模式、适应窗口、全屏
- 分组内导航、外部程序打开
- **标记菜单** — 大图中直接设置/取消标记

### ⚖️ 双图对比
- 重叠显示 + 可拖拽分割线
- 同步缩放平移，适合细节对比

### ⌨️ 可自定义快捷键
- 所有快捷键（含替代键）均可在设置中自由修改
- 支持主键 + 替代键双绑定

### ⚡ 性能优化
- **渐进式扫描** — 后台遍历，扫完一个目录立即渲染
- **懒加载** — 图片进入视口才加载，内存友好
- **文件变更监听** — 自动检测外部文件变化，增量刷新

---

## 🚀 快速开始

```bash
# 开发模式（热更新）
npm run tauri dev

# 生产构建
npm run tauri build
```

> 环境要求：Node.js ≥ 18、Rust ≥ 1.70

---

## 📖 文档

| 文档 | 说明 |
|------|------|
| [📋 功能清单](Docs/功能清单.md) | 全部功能详细说明 |
| [🏗️ 技术架构](Docs/技术架构.md) | 前后端架构、数据流、组件树 |
| [📘 开发指南](Docs/开发指南.md) | 环境搭建、开发流程、最佳实践 |

---

## 🧩 技术栈

| 层 | 技术 |
|---|------|
| **前端框架** | Vue 3 + TypeScript + Vite 6 |
| **桌面框架** | Tauri v2 |
| **后端语言** | Rust |
| **关键依赖** | walkdir · imagesize · kamadak-exif · notify · serde_yaml |

---

## 📄 许可证

本项目基于 MIT 许可证开源。
