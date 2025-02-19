# yuhanbopy-app：三人聚智-余汉波程序控制工具使用说明



## 1. 基本功能

- 这是一个基于Electron的桌面应用程序，用于管理和运行Python脚本，用于提高开发和文件管理效率。

- 支持加密和非加密的Python程序

- 提供实时运行日志显示

- 自动管理Python依赖

## 2. 版本使用

该程序共提供三个版本，分别命名为：yuhanbopy-xl、yuhanbopy-lh 和 yuhanbopy-mini。其中 yuhanbopy-lh 在 github 的进行开源，地址 [yuhanbo758/yuhanbopy-app: 三人聚智-余汉波程序控制工具](https://github.com/yuhanbo758/yuhanbopy-app)，基于 MIT 许可证发布。

1. yuhanbopy-xl：有嵌入版 python，无需另外安装 python，适用于电脑小白，下载安装直接使用，效率优先。
2. yuhanbopy-lh：在 yuhanbopy-xl 基础上，植入了 mini QMT 的库 xquant，主要对象是需要小 QMT 量化交易的小白，可以直接加载运行个人提供“通达信与 QMT 结合下单”的tdx3 程序。
3. yuhanbopy-mini：yuhanbopy-xl 的 mini 版，没有嵌入版 python，安装后首次启动时，系统会要求选择Python解释器（.exe文件）

![Pasted image 20250218210315](https://gdsx.sanrenjz.com/image/Pasted%20image%2020250218210315.png?imageSlim)

## 3. 程序目录结构

主要程序存放在 app/software 目录下，主要包含三个格式文件，py 或 enc 文件、settings.json 文件和 requirements.txt 文件：

##### 3.1 单文件程序

- 支持 .py 文件（普通Python文件）

- 支持 .enc 文件（加密的Python文件）

##### 3.2 文件夹程序

每个程序文件夹可以包含 json 相关说明，示例：

```json
{
    "name": "程序名称",
    "description": "程序描述",
    "main_file": "主程序文件名.py",
    "version": "版本号",
    "author": "作者",
    "category": "分类"
}
```

##### 3.3 依赖管理

- 在程序目录中可以放置 requirements.txt 文件

- 系统会自动检查并安装缺失的依赖

- 使用多个pip源以提高安装成功率：
	- pypi.org
	- 清华大学镜像
	- 阿里云镜像

## 4. 程序运行(注意：需管理员权限安装)

- Windows 64 位操作系统

- 程序列表会显示所有可用的Python程序——若文件夹中有 settings.json 文件，显示指定 py 文件，否则显示文件夹中所有 py 文件。

- 双击列表中的程序即可运行

- 运行时会自动打开日志窗口，显示程序输出

- 如果程序有依赖项（requirements.txt 文件），会自动安装所需依赖

- 需加载本地 python 代码，点击右上角“本地文件”，选择 py 文件或文件夹，会将文件或文件夹复制到app/software 下，创建项目。

![Pasted image 20250218210349](https://gdsx.sanrenjz.com/image/Pasted%20image%2020250218210349.png?imageSlim)

## 5. 安全特性

- 支持AES-256-CBC加密的Python程序（.enc文件）

- 加密程序运行时会自动解密到临时目录

- 程序结束后自动清理临时文件

## 6. 注意事项

 - 若是 yuhanbopy-mini 应用，确保Python解释器路径正确设置

- 建议在程序目录中提供 requirements.txt 声明依赖

- 加密程序需要使用特定的加密工具进行加密

- 程序运行时保持日志窗口打开可查看实时输出

## 7. 错误处理

- 如果遇到Python环境问题，可以通过界面重新选择Python解释器，或卸载重装

- 依赖安装失败时，日志窗口会显示详细错误信息

- 程序运行错误会在日志窗口中显示具体原因

这个工具设计得比较完善，特别适合管理和分发Python程序，同时通过加密机制保护源代码安全。

## 8. 已集成应用

- **终端模拟器**: 内置终端工具，支持命令行操作
- **文件下载器**: 支持文件批量下载和管理
- **GitHub 下载器**: 便捷的 GitHub 仓库和文件下载工具
- **腾讯云 COS 下载器**: 支持腾讯云对象存储文件的下载管理
- **自定义工具集成**: 可扩展的工具集成平台

##### 终端模拟器
- 打开应用后，选择"终端"模块
- 可以执行标准的命令行操作

##### 文件下载器
- 在文件下载器界面输入下载链接
- 选择保存位置
- 点击下载按钮开始下载

##### GitHub 下载器
- 输入 GitHub 仓库地址或文件链接
- 选择下载位置
- 支持单个文件或整个仓库的下载

##### 腾讯云 COS 下载器
- 配置腾讯云账号信息
- 浏览和选择需要下载的文件
- 执行下载操作

其他应用程序正创建中，可关注右上方“程序小店”，获取更多可视化 python 应用程序。

- GitHub Issues: [https://github.com/yuhanbo758/yuhanbopy-app/issues](https://github.com/yuhanbo758/yuhanbopy-app/issues)

## 9.版权信息

版权所有 © 2025 余汉波
基于 MIT 许可证发布

![三码合一](https://gdsx.sanrenjz.com/PicGo/%E5%85%A8%E7%A0%81%E5%90%88%E4%B8%80.png)
