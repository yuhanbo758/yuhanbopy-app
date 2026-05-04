# 三人聚智-Python程序管理工具

> 基于 Electron 的 Windows 桌面应用，用于分发、管理和运行加密保护的 Python 量化交易工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%20x64-blue)](https://www.microsoft.com/windows)
[![Electron](https://img.shields.io/badge/Electron-25.x-47848F)](https://www.electronjs.org/)
[![Python](https://img.shields.io/badge/Python-3.12.8%20Embedded-3776AB)](https://www.python.org/)

---

## 📖 项目简介

**三人聚智-Python程序管理工具**（yuhanbopy）是一款专为量化交易用户设计的 Python 工具管理平台。它内嵌 Python 3.12 运行时，支持插件式扩展，让用户无需手动配置 Python 环境即可运行各类量化交易工具。

**核心功能：**
- 🚀 一键运行 Python 工具插件（支持明文 `.py`、加密 `.enc`、ZIP 打包三种格式）
- 📦 插件式架构，支持从 GitHub / 腾讯云 COS / 通用 URL 在线获取新插件
- 🔐 AES-256-CBC 加密保护，支持加密 Python 源码分发
- 📋 实时日志窗口，显示程序运行输出
- 🔍 程序卡片列表，支持实时搜索和双击运行
- 🔄 双源自动更新（对象存储会员专属源 + GitHub Releases 双重保障）
- 🏪 内置程序小店浏览器，一键下载 ZIP 插件自动解压安装
- ⚙️ 设置面板，支持会员账号、更新源和插件管理配置

---

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^25.9.8 | 桌面应用框架 |
| electron-builder | 23.6.0 | Windows 打包（NSIS + Portable） |
| Python | 3.12.8（嵌入式） | 运行 Python 插件 |
| electron-updater | ^6.8.3 | 应用自动更新（双源：对象存储 + GitHub） |
| xtquant (迅投QMT) | — | 量化交易数据接口 |
| Node.js crypto | 内置 | AES-256-CBC 加密/解密 |
| adm-zip | ^0.5.16 | ZIP 文件解压 |
| @electron/remote | ^2.1.2 | 渲染进程访问主进程 API |
| tkinter / ttk | 标准库 | Python 插件 GUI |

---

## 📋 系统要求

- **操作系统：** Windows x64（仅支持 64 位 Windows）
- **依赖：** 无需额外安装 Python，运行时已内嵌

---

## 🚀 快速开始

### 下载安装

前往 [Releases](https://github.com/yuhanbo758/yuhanbopy-app/releases) 页面下载最新版本：

- **安装版（推荐）：** `三人聚智-Python程序管理工具-x.x.x-Setup.exe`
- **便携版：** `三人聚智-Python程序管理工具-x.x.x-portable.exe`

### 开发环境运行

```bash
# 克隆仓库
git clone https://github.com/yuhanbo758/yuhanbopy-app.git
cd yuhanbopy-app

# 安装依赖
npm install

# 启动应用
npm start
```

### 构建安装包

```bash
# 构建 Windows 安装包（NSIS + Portable）
npm run build-win
```

构建产物输出至 `dist/` 目录。

---

## 📁 目录结构

```
yuhanbopy-lh/
├── main.js                   # Electron 主进程（核心调度逻辑）
├── index.html                # 主界面（程序卡片列表）
├── log.html                  # 日志窗口
├── package.json              # 项目配置 & 构建配置
│
├── app/
│   └── software/             # 内置 Python 插件目录
│       ├── cos_downloader/   # 腾讯云 COS 下载器
│       ├── file_downloader/  # 通用文件下载器
│       ├── github_downloader/# GitHub 仓库下载器
│       └── terminal/         # 终端模拟器
│
└── python/
    └── python-3.12.8-embed-amd64/  # 内嵌 Python 运行时
```

---

## 🔌 插件开发

每个插件放置在 `app/software/<name>/` 目录下，包含以下文件：

### settings.json（必须）

```json
{
  "name": "插件名称",
  "description": "插件描述",
  "main_file": "main.py",
  "version": "1.0.0",
  "author": "作者名",
  "category": "工具分类"
}
```

### 入口文件（三种格式之一）

| 格式 | 说明 |
|------|------|
| `<main_file>.py` | 明文 Python 脚本，直接运行 |
| `<main_file>.enc` | AES-256-CBC 加密的 Python 脚本 |
| `<name>.zip` | ZIP 打包，按 `__main__.py` → `<name>.py` → 第一个 .py 文件顺序查找入口 |

### 插件路径适配（推荐写法）

```python
import os
import sys

# 适配开发环境和打包环境
possible_paths = [
    os.path.join(os.path.dirname(__file__)),           # 开发环境
    os.path.join(os.path.dirname(sys.executable), 'app', 'software', 'your_plugin'),  # 打包环境
]
```

### 依赖管理

在插件目录放置 `requirements.txt`，主程序运行插件前会自动安装缺失的依赖包。

---

## ⚙️ 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `YUHANBOPY_ENC_KEY` | `.enc` 文件的 AES-256 解密密钥（32字节十六进制字符串） | 内置默认值 |

> **安全说明：** 建议在生产环境中通过环境变量 `YUHANBOPY_ENC_KEY` 设置自定义密钥，以替代默认密钥。

---

## 🔐 安全说明

- `.enc` 加密文件使用 AES-256-CBC 算法，解密密钥可通过环境变量 `YUHANBOPY_ENC_KEY` 覆盖
- 解密后的临时文件使用随机文件名存放于系统临时目录，程序退出后自动清理
- ZIP 解压已内置 Zip Slip 路径穿越防护
- 程序卡片内容已做 XSS 防护（使用 `textContent` 代替 `innerHTML`）

---

## 📝 内置插件说明

| 插件 | 功能 |
|------|------|
| **腾讯云 COS 下载器** | 从腾讯云对象存储下载插件文件 |
| **通用文件下载器** | 从任意 URL 下载文件，支持自动解压 ZIP |
| **GitHub 仓库下载器** | 一键克隆 GitHub 仓库 ZIP 包 |
| **终端模拟器** | 内置命令行终端，直接执行系统命令 |

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 提交变更：`git commit -m 'feat: add your feature'`
4. 推送分支：`git push origin feat/your-feature`
5. 提交 Pull Request

---

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。

---

## 👨‍💻 作者信息

**余汉波** - 编程爱好者-量化交易和效率工具开发

- **GitHub**: [@yuhanbo758](https://github.com/yuhanbo758)
- **Email**: yuhanbo@sanrenjz.com
- **Website**: [三人聚智](https://www.sanrenjz.com)

## 🌐 相关链接

- 🏠 [项目主页](https://www.sanrenjz.com)
- 📚 [在线文档](https://docs.sanrenjz.com)（财经、代码和库文档等）
- 🛒 [插件商店](https://shop.sanrenjz.com)（个人开发的所有程序，包括开源和不开源）

## 联系我们

[联系我们 - 三人聚智-余汉波](https://www.sanrenjz.com/contact_us/)

python 程序管理工具下载：[sanrenjz - 三人聚智-余汉波](https://www.sanrenjz.com/sanrenjz/)

效率工具程序管理下载：[sanrenjz-tools - 三人聚智-余汉波](https://www.sanrenjz.com/sanrenjz-tools/)

智能codebot下载：[sanrenjz-codebot - 三人聚智-余汉波](https://www.sanrenjz.com/sanrenjz-codebot/)

![三码合一](https://gdsx.sanrenjz.com/image/sanrenjz_yuhanbolh_yuhanbo758.png?imageSlim&t=1ab9b82c-e220-8022-beff-e265a194292a)

![余汉波打赏码](https://gdsx.sanrenjz.com/image/%E6%89%93%E8%B5%8F%E7%A0%81%E5%90%88%E4%B8%80.png?imageSlim)

## 🙏 致谢

感谢所有为本项目贡献代码和想法的开发者们！

---
**⭐ 如果这个项目对您有帮助，请给它一个 Star！**
