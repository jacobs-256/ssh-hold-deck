# ssh-hold：撑开并复用 SSH 连接

`ssh-hold` 基于 SSH ControlMaster 保持一条连接。密码或证书只在第一次连接时使用，后续命令复用已打开的通道，无需重新认证。

- 命令位置：`~/.local/bin/ssh-hold`
- 通道记录：`~/.ssh/hold/<名字>/`
- `sock` 是复用套接字，`meta` 保存连接信息，`keepalive.log` 记录保活日志。
- 适用于跳板机一次性密码、证书登录，以及需要持续复用的 SSH 会话。

## 使用规则

1. **先查看通道。** 每次操作前运行 `ssh-hold list`，核对名字和状态。
2. **显式指定通道名。** 名字必须与列表一致；不要猜测，也不要省略。
3. **交互命令在自己的终端运行。** `shell`、交互密码登录、`vim`、`top` 等会等待输入，不应交给无人值守的工具执行。
4. **密码不要写进命令行或文件。** 自动化时使用 `--password-stdin`，且只使用用户明确提供的密码。
5. **关闭通道前先确认。** 一次性密码失效后，断开的通道可能无法重新连接。

## 1. 查看现有通道

```sh
ssh-hold list
ssh-hold status us-1
```

确认目标正确、状态为“畅通”后，再执行操作。“已断开”需要重新认证并建立连接。

## 2. 建立连接

### 证书登录

```sh
chmod 600 ~/.ssh/server.pem
ssh-hold start -n us-1 -i ~/.ssh/server.pem ubuntu@server.example.com
```

私钥若有口令，需要在交互终端完成输入。

### 密码或一次性密码

在自己的终端运行，按提示输入密码：

```sh
ssh-hold start -n us-1 -p 2222 ubuntu@jump.example.com
```

自动化输入可使用 `--password-stdin`。密码认证依赖 `sshpass`。

通道名仅使用字母、数字、点、下划线和短横线；`-p` 默认为端口 `22`。`-o` 可重复指定 SSH 选项。

### 临时跳板的主机指纹

地址变更时应先核实新主机指纹。`--insecure` 会跳过指纹校验，仅适用于已确认风险的临时场景。

## 3. 复用连接

```sh
ssh-hold run us-1 -- hostname
ssh-hold run us-1 -- 'df -h'
ssh-hold run us-1 -- 'ps aux | head -20'
```

包含空格、管道或重定向的远端命令，用单引号包住，避免被本地 shell 提前展开。远端命令退出码会原样返回。

交互终端：

```sh
ssh-hold shell us-1
```

退出这个 shell 不会关闭 SSH 主通道。

## 4. 传文件

`scp` 和 `rsync` 可复用已有套接字；用户名、主机和端口必须与通道记录一致。

```sh
scp -o ControlPath="$HOME/.ssh/hold/us-1/sock" \
  -o ControlMaster=no -o BatchMode=yes \
  ./file.txt ubuntu@server.example.com:/tmp/

rsync -avz -e "ssh -o ControlPath=$HOME/.ssh/hold/us-1/sock -o ControlMaster=no" \
  ./local-dir/ ubuntu@server.example.com:/tmp/remote-dir/
```

非 22 端口的 `scp` 需要额外添加 `-P 端口`。

## 5. 关闭通道

仅在确定不再需要时执行：

```sh
ssh-hold stop us-1
```

**此命令会关闭 SSH 连接，并删除对应通道记录目录。** 一次性密码过期后无法用旧密码重新建立连接。

## 常见问题

| 情况 | 处理方式 |
| --- | --- |
| 没有这个名字的通道 | 重新运行 `ssh-hold list`，使用准确名字 |
| 通道已断开 | 用新的有效密码或证书重新建立连接 |
| 通道名后缺少 `--` | 使用 `ssh-hold run 名字 -- 命令` |
| 已存在同名通道 | 使用新名字；确认后再关闭旧通道 |
| 找不到 `sshpass` | 安装依赖，或改用证书认证 |
| 私钥权限过宽 | 对私钥执行 `chmod 600` |
| 密码错误、过期或连接被拒绝 | 核对凭据、地址、端口和主机指纹 |
| 保活异常 | 查看 `~/.ssh/hold/<名字>/keepalive.log` |

## 保活与恢复

- 后台保活定期执行远端空命令；具体间隔和重试策略取决于安装版本。
- 服务端会话时长限制仍然有效，保活无法绕过。
- 重启、休眠或网络切换后，先检查通道状态。
- 不要因为一次命令失败就主动停止仍可复用的通道。

[ssh-hold 开源项目](https://github.com/CherryLover/ssh-hold)
