# AGENTS.md

> 本文件由 OpenCode 维护，帮助 AI 理解项目结构、规范和当前状态。
> 请将此文件提交到版本控制，并在每次重要变更后更新。

---

## 项目概述

**项目名称：** 三人聚智-Python程序管理工具（yuhanbopy-lh）
**项目描述：** 基于 Electron 的 Windows 桌面应用，用于分发、管理和运行加密保护的 Python 量化交易工具，内嵌 Python 3.12 运行时，支持插件式扩展。
**当前阶段：** 功能完善阶段
**目标用户：** 量化交易 / 金融 Python 工具用户（QMT、通达信、问财等）
**出品方：** 三人聚智（sanrenjz.com）

---

## 技术栈

| 类别 | 技术/工具 | 版本 | 说明 |
|------|----------|------|------|
| 桌面框架 | Electron | ^25.9.8 | 跨平台桌面应用壳，仅构建 Windows x64 |
| 构建工具 | electron-builder | 23.6.0 | 打包 Windows NSIS/Portable、macOS DMG/ZIP、Linux AppImage |
| 前端 | 原生 HTML/CSS/JS | — | 无 UI 框架，Vanilla JS + Electron IPC |
| UI 图标 | Font Awesome | 5.15.4 (CDN) | 按钮图标 |
| Node.js 依赖 | @electron/remote | ^2.1.2 | 渲染进程访问主进程 API |
| Node.js 依赖 | electron-updater | ^6.8.3 | 应用自动更新（对象存储/GitHub 双源） |
| Node.js 依赖 | axios | ^1.6.5 | HTTP 请求 |
| Node.js 依赖 | adm-zip | ^0.5.16 | ZIP 文件解压 |
| Node.js 依赖 | iconv-lite | ^0.6.3 | 字符编码转换（GBK/UTF-8） |
| 脚本语言 | Python | 3.12.8（嵌入式） | 运行内置/用户 Python 插件程序 |
| Python GUI | tkinter / ttk | 标准库 | 各内置工具的图形界面 |
| 加密 | Node.js crypto | 内置 | AES-256-CBC 加密/解密 `.enc` 文件 |
| 量化交易库 | xtquant (迅投QMT) | — | 股票量化数据接口，内置于 Python 环境 |
| 目标平台 | Windows/macOS/Linux x64 | — | Windows 内嵌 Python 运行时完整可用；macOS/Linux 仅完成 Electron 包构建，Python 运行时仍需后续适配 |

---

## 目录结构

```
yuhanbopy-lh/
├── main.js                   # Electron 主进程入口（514 行，核心调度逻辑）
├── index.html                # 主界面（程序卡片列表 UI）
├── log.html                  # 日志窗口 HTML
├── package.json              # 项目配置 & electron-builder 构建配置
├── .github/workflows/release.yml # push 到 main 后自动打包并发布 Release
├── scripts/                  # 构建辅助脚本（版本号与图标处理）
├── AGENTS.md                 # 本文件，项目 AI 上下文
├── .trae/                    # Trae 项目级规则与技能覆写
│
├── app/                      # 应用业务逻辑资源
│   ├── software_manager.js   # Python 软件管理类（进程调度、启停、清理）
│   └── software/             # 内置 Python 插件集合
│       ├── cos_downloader/   # 腾讯云 COS 下载器
│       ├── file_downloader/  # 通用文件下载器
│       ├── github_downloader/# GitHub 仓库下载器
│       └── terminal/         # 终端模拟器
│
├── python/                   # 内嵌 Python 运行时（随应用打包）
│   ├── requirements.txt      # 基础 Python 依赖（requests）
│   └── python-3.12.8-embed-amd64/  # Python 3.12 嵌入式版本
│       └── Lib/site-packages/xtquant/  # 量化交易库
│
├── build/                    # 构建资源（图标等）
└── dist/                     # 打包输出目录（NSIS + Portable）
```

### 插件（软件）目录规范

每个 `app/software/<name>/` 插件须包含：
- `settings.json` — 插件元数据（name, description, main_file, version, author, category），其中 `description` 仅保留一句简介
- `README.md` — 插件功能介绍、使用方法、配置说明与注意事项
- `<main_file>.py` 或 `<main_file>.enc`（加密版）或 ZIP 包 — 入口文件

---

## 核心模块说明

| 模块 | 路径 | 职责 |
|------|------|------|
| 主进程 | `main.js` | Electron 窗口管理、内置程序小店浏览器、自动更新、Python 环境初始化、子进程调度 |
| 软件管理器 | `app/software_manager.js` | 封装 Python 进程的运行/停止/清理，用 Map 管理多进程生命周期 |
| 主界面 | `index.html` | 程序卡片列表、详情弹窗、设置面板、账号状态、更新面板 |
| Python 环境管理 | `app/python_runtime.js` | 内置/自定义解释器校验与隔离的子进程环境变量构建 |
| 日志窗口 | `log.html` | 显示 Python 子进程 stdout/stderr，深色终端风格 |
| 内置下载器 | `app/software/cos_downloader/` | 从腾讯云 COS 下载插件文件 |
| 内置下载器 | `app/software/file_downloader/` | 通用 URL 文件下载 |
| 内置下载器 | `app/software/github_downloader/` | 从 GitHub 仓库下载 |
| 内置终端 | `app/software/terminal/` | 终端模拟器插件 |

---

## 编码规范

### JavaScript（主进程 / 渲染进程）

- **IPC 通信**：渲染进程通过 `ipcRenderer.invoke()` 调用主进程，主进程通过 `ipcMain.handle()` 注册处理器
- **路径适配**：开发/打包双模式适配，统一使用 `app.isPackaged ? process.resourcesPath : __dirname`
- **临时文件**：统一放 `os.tmpdir()/yuhanbopy-temp/`，进程退出时自动清理
- **字符编码**：Windows GBK 输出需用 `iconv-lite` 转换为 UTF-8

### Python 插件

- **GUI 框架**：使用 tkinter / ttk，无需额外安装
- **路径探测**：使用 `possible_paths` 列表遍历方式适配开发/打包环境
- **依赖管理**：每个插件可有独立 `requirements.txt`，主进程运行前自动 pip 安装缺失包
- **pip 源策略**：pypi.org 官方源优先，自动 fallback 到清华源、阿里云源
- **文档约定**：插件详细说明统一写入 `README.md`，`settings.json.description` 只用于列表简述

### Python 代码保护机制

| 格式 | 处理方式 |
|------|---------|
| `.py` 明文文件 | 直接通过嵌入式 Python 运行 |
| `.enc` 加密文件 | AES-256-CBC 解密 → 写入系统临时目录 → 执行 → 删除 |
| `.zip` 打包文件 | 解压后按 `__main__.py` → `<name>.py` → 第一个 .py 文件优先级查找入口 |

> **注意**：当前 AES 密钥硬编码在 `main.js` 中（`12345678901234567890123456789012`），属于轻度混淆保护，非高安全级别。

### UI 规范

- **配色体系**：Ant Design 风格，主色 `#1890ff`
- **布局**：CSS Grid 自适应卡片 `repeat(auto-fill, minmax(280px, 1fr))`
- **日志窗口**：深色背景 `#1e1e1e`，类 VS Code 终端风格

---

## 构建与发布

```bash
# 开发运行
npm start

# 构建 Windows 安装包（NSIS + Portable）
npm run build-win

# CI 使用的三平台发布构建
npm run release-win
npm run release-mac
npm run release-linux
```

**打包说明：**
- `asar: false`，资源明文存放（方便插件热更新）
- `python/` 打包到 `resources/python/`（排除 .pyc, \_\_pycache\_\_, test/），GitHub Actions 在构建前通过 `actions/setup-python` 重建 `python/python-3.12.8-embed-amd64/`
- `app/` 打包到 `resources/app/`（排除 .map, \_\_pycache\_\_, node_modules, .git, *.log）
- 输出：`dist/` 目录，Release 资产命名统一为 `yuhanbopy-app-<version>-<platform>-<arch>`，不发布 `builder-debug.yml` 等调试资产
- 自动版本递增：每次非 bot push 到 `main` 后由 GitHub Actions 将版本按次版本号递增，`1.1.0 -> 1.2.0`，`1.9.0 -> 2.0.0`

---

## 重要决策记录（ADR）

### ADR-001：嵌入式 Python 运行时策略

- **决策：** 将 Python 3.12 嵌入式版本直接打包进应用
- **背景：** 目标用户不一定安装了 Python 环境，嵌入式方案保证开箱即用
- **结果：** 应用包体较大，但无需用户手动配置 Python 环境

### ADR-002：插件式架构设计

- **决策：** 每个 Python 工具作为独立插件放在 `app/software/` 子目录
- **背景：** 便于增量分发新工具，不需要重新打包整个应用
- **结果：** 通过下载器插件实现运行时扩展，支持从 GitHub/COS/URL 获取新插件

### ADR-003：Python 代码加密保护

- **决策：** 支持 `.enc` 加密格式保护 Python 源码
- **背景：** 商业工具需要保护知识产权，防止源码直接暴露
- **结果：** 提供轻度混淆保护；当前密钥硬编码，安全级别有限

### ADR-004：双源自动更新与内置商店集成

- **决策：** 使用 `electron-updater` 实现自动更新，优先从对象存储检查 python 会员更新，缺失时自动回退到 GitHub Releases；程序小店改为内置浏览器并拦截 ZIP 下载自动安装到 `app/software/`
- **背景：** 用户需要统一的更新入口、会员专属更新源和更顺滑的插件安装体验
- **结果：** 应用具备会员识别、对象存储/GitHub 双源更新、内置商店下载后自动解压安装、菜单栏设置入口和插件详情阅读能力

### ADR-005：插件持久化与应用升级隔离

- **决策：** 打包后的插件统一运行于用户所选安装目录下的 `plugins/`；便携版使用便携 EXE 同目录下的 `plugins/`。安装包内的 `resources/app/software/` 仅作为内置插件种子源。
- **背景：** 应用在线升级会替换安装目录，不能让用户自行安装或修改的插件随程序升级被覆盖。
- **结果：** 启动时仅复制本地尚不存在的内置插件，同名插件始终保留本地版本；NSIS 更新卸载旧程序前会临时备份插件，并在新程序写入后恢复到安装目录。

### ADR-006：可切换 Python 运行环境

- **决策：** 默认使用内置 Python，允许用户在设置中选择自定义 Python 3 解释器；依赖检测、pip 安装和插件运行统一使用当前选定环境。
- **背景：** 用户已有 Python 环境可能包含大量第三方库，不应要求在内置环境中重复安装。
- **结果：** 每个 Python 子进程按当前运行环境独立构造环境变量，自定义环境不继承内置 `PYTHONHOME` 和 `site-packages`；自定义解释器失效时临时回退内置环境并在设置页提示。

---

## 已知问题与注意事项

- AES 加密密钥硬编码在 `main.js` 中，有心人可通过逆向获取，属轻度保护
- `asar: false` 导致打包后源码明文可见，加密 `.enc` 文件的保护依赖密钥安全
- `build/logo.png` 当前为 256x256，构建时通过 `scripts/prepare_icons.js` 自动生成 1024x1024 `build/icon.png`、Windows `build/icon.ico`，并在 macOS runner 上生成 `build/icon.icns`
- macOS/Linux 当前可生成 Electron 安装资产，但 Python 插件运行逻辑仍依赖 Windows 嵌入式 Python 目录和 Windows 生态依赖，跨平台运行需后续准备对应 Python runtime
- Font Awesome 通过 CDN 加载，离线环境下图标可能不显示
- 若需要在 CI 中恢复 `xtquant`，需提供 `XTQUANT_PACKAGE_URL` Secret 指向 wheel 或 zip 包
- 仓库已于 2026-05-04 执行 Git 重新初始化以摆脱历史构建产物污染；旧仓库元数据备份在项目根目录 `.git_backup_20260504_181500/`
- 远端 GitHub 仓库已于 2026-05-04 删除后重建，用于彻底清空历史污染内容并重新同步当前干净源码

---

## 变更日志

| 日期 | 变更内容 | 影响范围 |
|------|----------|---------|
| 2026-05-02 | 初始化 AGENTS.md，分析项目结构、技术栈和编码规范 | 全局 |
| 2026-05-04 | 新增双源自动更新、内置程序小店下载自动安装、设置面板、插件详情和 GitHub Actions 自动发布 | `main.js`, `index.html`, `package.json`, `.github/workflows/release.yml` |
| 2026-05-04 | 优化主界面品牌展示、账号头像、插件卡片操作区和插件 README 详情文档 | `main.js`, `index.html`, `app/software/*/` |
| 2026-05-04 | 调整设置弹窗为稳定左右分栏，新增 CSP 并在开发环境跳过自动更新检查日志 | `index.html`, `main.js` |
| 2026-05-04 | 新增 `.trae` 项目级规则与 skill 覆写，统一要求插件详细说明写入 `README.md`、`settings.json.description` 仅保留一句简介 | `.trae/`, `AGENTS.md` |
| 2026-05-04 | 优化 `.gitignore` 并清理生成产物的版本控制范围，避免 `dist/`、`resources/`、`node_modules/` 和嵌入式 Python 运行时污染提交 | `.gitignore`, Git 索引 |
| 2026-05-04 | 新增 CI Python 运行时重建脚本，Windows Actions 构建前自动准备 `python/python-3.12.8-embed-amd64` 并支持通过 Secret 恢复 `xtquant` | `.github/workflows/release.yml`, `scripts/prepare_embedded_python.ps1`, `.gitignore` |
| 2026-05-04 | 备份旧 `.git` 后重新初始化本地仓库，恢复 `main` 与 `origin`，避免继续处理历史构建产物导致的海量差异 | Git 元数据, `.gitignore`, `AGENTS.md` |
| 2026-05-04 | 删除并重建远端 `yuhanbo758/yuhanbopy-app` 仓库，准备以新的本地初始化历史重新推送源码 | GitHub 仓库, Git 历史 |
| 2026-05-05 | 调整 CI 为次版本号自动递增、三平台构建、统一 Release 资产命名并过滤调试资产；账号头像改为打包内 logo data URL 并为登录用户显示会员标识 | `.github/workflows/release.yml`, `package.json`, `scripts/`, `main.js`, `index.html` |
| 2026-09-19 | 将插件迁移至安装目录下的独立 `plugins` 并与应用升级隔离；新版本只补充本地缺少的内置插件，不覆盖已有同名插件 | `main.js`, `app/software_store.js`, `build/installer.nsh`, `package.json` |
| 2026-09-20 | 设置页新增内置/自定义 Python 环境切换，统一解释器校验、依赖安装和插件运行环境 | `main.js`, `index.html`, `app/python_runtime.js`, `scripts/test_python_runtime.js` |
