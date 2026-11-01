# Public Release Checklist / 开源发布检查

Desktop installer and tag/Release automation instructions are in [DESKTOP.md](DESKTOP.md). / 桌面打包与 tag、Release 自动发布步骤见该文档。手动运行 Desktop Release 并输入版本标签即可创建 tag、构建安装包并上传至对应 Release；也支持推送 `v*` 标签触发。

1. Choose a license and add `LICENSE`. Public visibility alone does not make the project open source. / 选择许可证并添加 LICENSE，公开仓库不等同于授予开源许可。
2. Verify the prerequisite links to https://github.com/CherryLover/ssh-hold and compatibility with the upstream CLI. Keep upstream attribution and distinguish this companion project's license from upstream licensing. / 验证上游安装链接与 CLI 兼容性，保留致谢并区分两个项目的许可证。
3. Keep `README.md` as the default English entry and `README.zh-CN.md` as the Chinese translation. Relative language links work directly on GitHub. / 保留英文默认入口和中文翻译，顶部相对链接可直接切换。
4. Exclude `data/`, custom data directories, private keys, `.web-vault`, SSH metadata, `.env` files, logs, and real server screenshots. Review the actual staged diff and history before pushing. / 排除敏感数据，推送前检查暂存内容与历史。
5. If a secret entered Git history, rotate it before publishing; deleting the current file does not remove historical exposure. / 历史中出现的凭据须轮换，仅删文件不足以解决泄露。
6. Run the README test commands and a fresh `npm ci`. Verify localhost login, import, connection, jump routing, and terminal tabs using disposable systems. / 执行测试和全新安装，用可丢弃环境验证功能。
7. Set repository description/topics and enable private vulnerability reporting or publish a private security contact. / 设置仓库描述并建立私密漏洞反馈渠道。
8. After choosing the license, update the license sections in both READMEs. Once this repository has a public URL, propose a reciprocal related-project link to the ssh-hold maintainer. / 确定许可证后同步更新中英文说明；本仓库有公开地址后，可向上游维护者提议添加相关项目反向链接。

No GitHub URL, owner identity, license, release tag, or support contact is assumed by these documents. / 文档未假设 GitHub 地址、所有者身份、许可证、版本标签或联系地址。
