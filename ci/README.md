# CI 与发布

## 独立缓存与草稿验收

本仓自带 `.github/actions/dependency-cache`、`ci/dependency-cache.mjs` 和测试；其他维护仓采用相同实现，各自提交，不依赖公共 CI 仓库或远程脚本。`ci/cache.json` 只配置本仓的 lockfile 和 npm 版本。缓存只包含 npm 内容寻址下载包，不包含 node_modules、profile、凭据或模型。

缓存 key 区分实现版本、系统、架构、Node、npm 和完整 lockfile 摘要，不包含 tag。成功的 main push/手动任务预热缓存；PR 和 tag 只恢复。key 未命中或缓存服务不可用时照常安装冻结依赖，始终运行原有测试与包校验。日志和任务摘要显示 key、hit、save；源代码中的本地动作固定官方 Actions commit。

手动从 main 运行 Release 工作流只创建 draft release，校验通过后才使用 GITHUB_TOKEN 创建新的版本 tag，因此不会再次触发公开 tag 发布。与 package.json 不符的 tag、非 main 手动发布、已有草稿/公开 Release、指向其他 commit 的 tag 均拒绝覆盖。正常推送版本 tag 的公开发布行为不变。草稿不会被能力中心 OTA 发现，验收通过前不要公开。

本轮缓存策略测试命令为 `node --test ci/dependency-cache.test.mjs ci/release-mode.test.mjs`，本机必须显式指定隔离的 `MOE4ALL_CI_TEST_ROOT`，GitHub runner 使用 RUNNER_TEMP。草稿验收需检查 main 冷缓存写入、发布中的缓存命中、完整原有测试、下载资产 SHA256/版本/源码 commit；不能仅以 workflow 绿灯代替包验收。

此仓库按已提交的预编译运行文件分发，不在发布时临时拉取 DSH main 或重建不完整的上游源码。CI 验证真实包入口、相对依赖、客户端 loader 依赖、bundle patch、许可证、语法及现有离线测试；Mneme 另校验 src/lib 同步。

固定 Node 版本见 `.node-version`，npm 为 10.9.2。先运行 `npm ci --prefix ci/host --ignore-scripts`，再运行 `npm run ci:check`、`npm run ci:contract` 和 `npm run ci:test`。host fixture 固定官方 DSH 0.2.0-rc.2 及完整依赖锁，只有包导入冒烟，不代表完整 Agent/DSH 功能兼容已经验收，也不覆盖真实云服务或 GPU。

`main` push、PR 和手动触发执行 Windows/Linux 检查。发布需在 main 提交上创建与 package.json 完全一致的 `release-<version>` 或 `v<version>` tag；只有 CI 通过才创建 GitHub Release。不上传源码代替运行包，不发布 npm。`-moe4all.N` 表示本发行版的正式修订，与 Agent 能力中心的通道规则一致；beta、rc、preview 等其他后缀仍标记为预发布。自 `moe4all.2` 修订起，默认正式通道即可发现这些插件更新，旧发布资产不覆盖。

发布产物为 `dsh-remote-web-ui-moe4all.tgz`、`plugin-release.json` 和 `SHA256SUMS.txt`。清单记录包身份、版本、仓库、源码 commit、宿主声明、验证范围和包校验值；校验值不等于签名。脚本校验包内容与当前文件逐字节一致，并拒绝覆盖已有产物、错误 tag、路径越界或链接条目。

本机验证必须按工作区磁盘规则在 staging 快照中执行，测试数据和缓存定向到统一 local-work；不要在生产 profile 中安装 CI fixture。TTS 的 CI 使用模拟 Edge WebSocket 与本地 mock RVC，不下载模型，不启动真实推理服务。
