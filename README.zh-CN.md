# SSH Hold Deck

[English](README.md) | **简体中文**

本项目基于开源工具 [ssh-hold](https://github.com/CherryLover/ssh-hold)，在其 SSH 通道管理能力之上增加 Node.js Web 管理界面、SQLite 配置存储、多标签终端和 JumpServer 集成。SSH 通道的创建、复用和生命周期管理仍由 ssh-hold 负责。

## 功能

- 添加、编辑、连接、断开和删除通道，支持名称、地址、状态和认证方式筛选。
- 用户名与主机分别填写，支持密码、私钥路径和私钥文件选择。
- 选择已连接的通道作为跳板，复用其 ControlMaster 套接字。
- SQLite 直接读取列表；后台每 30 秒检查状态，手动刷新可立即检查。
- Reload 从 `~/.ssh/hold/*/meta` 导入配置，同名更新，保留保存的凭据。
- xterm.js 多标签终端，同一通道可多开，支持缩放、收起和全屏。
- Web 登录、修改密码、退出登录，以及简体中文和英文界面。
- JumpServer 配置、授权资产搜索、账户选择及连接令牌认证。

## 环境要求

- Node.js **22.13.0 或更高版本**，包含内置 `node:sqlite`。
- npm、OpenSSH 客户端，以及 PATH 中可执行的 `ssh-hold`。
- 当前开发环境为 macOS；Linux 尚未完整验证，原生 Windows 不在当前支持范围。
- `node-pty` 在没有可用预编译文件时需要原生编译工具；macOS 可安装 Xcode Command Line Tools。

**安装或运行本项目前，请先安装 [ssh-hold](https://github.com/CherryLover/ssh-hold)。** 本仓库不包含该 CLI，请参照 [ssh-hold 上游 README 与安装说明](https://github.com/CherryLover/ssh-hold#readme) 完成安装，并准备其认证助手和其他依赖。确认在启动 Web 服务的同一环境中可以执行 `ssh-hold list`。

请使用兼容版本，至少支持 `list`、`status <name>`、`start`、`stop <name>` 和 `shell <name>`；`start` 须支持 `-n`、`-p`、`-i`、`--password-stdin`、`--insecure`、重复的 `-o`，以及 `SSH_HOLD_DIR`。

## 快速开始

在克隆后的项目目录执行：

```sh
node --version
ssh -V
command -v ssh-hold
ssh-hold list
npm ci
npm start
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。首次访问设置 8–256 个字符的 Web 登录密码，之后使用此密码登录。它与目标服务器的 SSH 密码互相独立。

服务仅监听 `127.0.0.1`，请使用该地址访问。语言选择提供自动、简体中文和英文；自动模式跟随浏览器语言。仓库文档默认英文，可通过顶部链接切换中文。

## 使用

### 导入与刷新

首次启动自动导入 CLI 元数据，并迁移旧 `.web-vault` 中的凭据，原文件保留。列表从 SQLite 读取，不等待远端检查。

- **Reload**：重新导入源配置；同名更新、不重复，保留已有密码和私钥路径。源文件缺失时保留数据库记录。
- **刷新**：立即检查连接状态，不导入配置。
- CLI 元数据不含密码和私钥路径；导入后可能需要先编辑补全，连接按钮才可用。
- 后台检查更新数据库，已打开的页面不自动轮询列表。

### 通道与跳板

新增或编辑时设置用户名、主机、端口及认证方式，保存后发起连接。选择跳板时须先连接跳板通道；不允许自身引用和循环依赖。断开通道保留数据库配置，删除则移除配置并关闭连接。一次性密码失效后无法靠保存的旧密码重新认证。

### Web Terminal

畅通通道可打开终端，每次点击创建独立 Tab。关闭 Tab 只结束该 Shell，不关闭 SSH 主通道；收起保留会话，刷新浏览器或重启服务会结束终端会话。最多同时运行 24 个终端。终端输入输出默认不记录到数据库或应用日志，但远端 Shell 或堡垒机可能有自己的历史和审计。

### JumpServer

在 JumpServer 页面设置 HTTPS API 地址、Access Key ID/Secret、组织 UUID 和 SSH 网关地址/端口。API 与 SSH 端口独立设置。编辑时，地址和 Key ID 不变且 Secret 留空会保留原 Secret。

新增通道时选择 JumpServer 资产，搜索授权资产并选择可用账户。每次连接申请新的普通连接令牌，再通过 KoKo 认证；通道仅保存资产和账户引用，不保存临时令牌。已验证版本为 **JumpServer v4.10.19 CE**。需手动填写凭据的账户不提供选择；审批、额外认证及访问限制需在 JumpServer 中处理。仍被通道引用的堡垒机配置不可删除。

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8787` | 本地 HTTP 端口 |
| `SSH_HOLD_DIR` | `~/.ssh/hold` | CLI 元数据和套接字目录 |
| `SSH_HOLD_WEB_DATA_DIR` | 项目下的 `data/` | SQLite 和上传私钥的存储目录 |

```sh
PORT=8888 SSH_HOLD_WEB_DATA_DIR="$HOME/.local/share/ssh-hold-web" npm start
```

## 存储与安全

数据库位于 `data/channels.sqlite`，上传的私钥位于 `data/keys/`。数据库和上传私钥文件权限设为 `600`。Web 密码使用加盐 scrypt 哈希；会话 Cookie 使用 HttpOnly、SameSite=Strict，12 小时过期。终端需要有效登录会话及有效期 30 秒的一次性令牌。

连接配置和 JumpServer Secret 使用 AES-256-GCM 加密，但密钥由本机用户名和主机名派生，**不是独立的秘密密钥**。不能将其视为防御本机攻击者的凭据保险库；数据库状态快照也不加密。上传的私钥以明文文件保存，仅依赖文件权限保护。不要提交数据库、私钥、凭据、会话信息或含真实目标的截图。

备份时停止服务，备份完整数据目录。跨用户或跨主机迁移后当前派生密钥会改变，已有加密配置不能直接读取；当前没有密钥迁移或密码找回工具。详见 [安全说明](SECURITY.md)。

## 开发与验证

目录结构和模块职责见 [项目架构](docs/ARCHITECTURE.md)。

```sh
npm ci
npm test
```

测试使用模拟依赖和临时目录，不要求真实 JumpServer 凭据。终端测试需要可运行的 `node-pty`。

主要模块：`src/server.js`（HTTP、SQLite、通道操作）、`src/auth.js`（登录）、`src/jump.js`（跳板）、`src/jumpserver.js`（堡垒机 API）、`src/terminal-server.js`（PTY/WebSocket）及 `public/`（前端）。

## 故障排查

| 问题 | 检查方式 |
| --- | --- |
| 找不到 ssh-hold | 确认启动服务的 PATH 包含 CLI，终端执行 `ssh-hold list` |
| node:sqlite 不可用 | 升级至 Node.js 22.13.0 或更高版本 |
| PTY 启动失败 | 重新执行 `npm ci` 和 `node scripts/setup-pty.js`；必要时安装原生编译工具 |
| 连接按钮禁用 | 编辑并补全用户名、主机及密码或私钥路径 |
| 跳板不可用 | 先连接跳板；必要时 Reload 导入其记录 |
| 终端被拒绝 | 使用 `127.0.0.1` 访问并重新登录，确认通道畅通 |
| 畅通但保活停止 | SSH 主连接与额外保活进程独立，点击刷新确认最新状态 |

## 上游项目与致谢

本项目建立在 [CherryLover/ssh-hold](https://github.com/CherryLover/ssh-hold) 之上，感谢其作者及贡献者提供 SSH 通道管理的基础能力。

- **ssh-hold**：底层 CLI，负责通道生命周期和 SSH 连接复用；安装、命令行用法及其许可证请参阅上游仓库。
- **SSH Hold Deck**：本仓库提供围绕该 CLI 的 Web 界面、配置持久化和浏览器终端。

如果这两个工具对你有帮助，欢迎同时 Star 和 Watch 本仓库及 [ssh-hold](https://github.com/CherryLover/ssh-hold)。也欢迎上游维护者将本项目作为社区 Web 管理界面加入相关项目列表，方便用户双向发现。本项目独立维护，相关链接不代表上游官方背书或合作关系。

## 参与和许可证

参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，发布检查见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。

**许可证待项目所有者确定。** 当前仓库未提供 LICENSE，因此尚未授予开源使用、修改或再分发许可。发布为开源软件前需要添加选定许可证；第三方依赖仍适用各自许可证。
