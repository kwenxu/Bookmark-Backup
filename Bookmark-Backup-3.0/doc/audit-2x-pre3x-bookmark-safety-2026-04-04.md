# Bookmark Backup 2.x(<3.0) Commit 审计报告（非 UI）

- 审计日期：2026-04-04
- 审计仓库：`/Users/kk/Downloads/Bookmark Backup/Bookmark-Backup`
- 审计目标：从 `v2.0` 之后到 `<3.0` 的 2.x 提交，重点评估“用户书签树状结构安全/兜底”
- 结论类型：静态代码审计（不含运行时注入测试）

## 1. 范围与方法

### 1.1 Commit 范围
- 总提交（`v2.0..HEAD`）：531
- 2.x 相关提交（按提交信息匹配 `2.x/test_2.x/v2.0`）：257
- 时间范围：2025-09-15 至 2026-03-26

### 1.2 代码范围（非 UI 外观）
- 核心恢复/同步：`Bookmark-Backup-3.0/background.js`
- 历史与恢复逻辑：`Bookmark-Backup-3.0/history_html/history.js`
- 自动备份：`Bookmark-Backup-3.0/auto_backup_timer/*`
- 备份提醒：`Bookmark-Backup-3.0/backup_reminder/*`
- GitHub 同步：`Bookmark-Backup-3.0/github/repo-api.js`

### 1.3 审计方式
- 并行多视角审计（commit 轨迹、恢复事务、并发状态机、非 UI 模块稳定性）
- 本地二次复核高风险结论（函数与行号）
- 重点关注：
  - 是否会误删/清空书签树
  - 恢复失败是否可回滚
  - 同步/导出是否可能“假成功”
  - 并发与中断后状态是否可自愈

## 2. 2.x 核心演进（按阶段）

1. 2025-09 ~ 2025-10（2.0 初期）  
   自动备份计时器与恢复机制成形，开始引入防重复触发与补偿逻辑。  
   代表提交：`149a18b`, `626ee2d`

2. 2025-11（2.5~2.7）  
   书签关联历史数据层重构，增量更新与全量回退并存。  
   代表提交：`b223c2f`, `0adc446`, `19ed8c9`, `f1e8177`

3. 2025-12 ~ 2026-01（2.8~2.98）  
   导出路径兼容、历史清理、运行期稳定性增强。  
   代表提交：`9384fe1`, `8a8388d`, `c720d1b`

4. 2026-02（2.9.1~2.9.45）  
   多版本日志与恢复索引化、自动备份队列化、同步策略细化。  
   代表提交：`7c96548`, `c759af6`

5. 2026-03（2.9.5~2.9.23）  
   恢复安全集中加固：root 身份映射、事务写锁、继续/回滚、payload 分块。  
   代表提交：`f82aed0`, `0327cf9`, `864062b`, `6339925`, `8745a7e`, `7963413`

## 3. 已具备的书签树安全机制（正向）

1. 空树阻断（防止覆盖恢复把当前树清空）  
   证据：`background.js:12053`, `background.js:12101`, `background.js:4230`

2. 恢复事务化（intent + start/target snapshot + phase）  
   证据：`background.js:12276`, `background.js:12394`, `background.js:12548`, `background.js:12665`

3. 事务写锁（未完成事务阻断新恢复/撤销）  
   证据：`background.js:3213`, `background.js:12853`

4. 中断恢复（continue/rollback）  
   证据：`background.js:13087`, `background.js:13266`

5. 自动回滚包装（执行失败时回退到操作前快照）  
   证据：`background.js:14291`

6. 覆盖恢复 root 映射预检（映射失败直接阻断）  
   证据：`background.js:22205`

## 4. 关键风险与证据（按严重度）

## P0

1. 覆盖/合并恢复存在“部分失败被吞”风险（可能造成静默数据缺口）  
   - 现象：批量执行中异常被吞，外层仍继续并可能最终返回成功。
   - 证据：`background.js:22046`, `background.js:22061`, `background.js:22339`, `background.js:22371`, `background.js:22540`, `background.js:22580`, `background.js:24870`

2. 监听器重复注册，事件可能重复处理  
   - 现象：`initializeOperationTracking()` 在顶层、`onStartup`、`onInstalled` 均调用；函数内部直接 addListener。
   - 证据：`background.js:1461`, `background.js:1552`, `background.js:1802`, `background.js:16419`, `background.js:25101`

3. 同步锁不是原子锁，且 `initSync upload` 旁路锁  
   - 现象：锁通过 `get` 再 `set`；上传分支未统一走 `syncBookmarks` 锁链路。
   - 证据：`background.js:828`, `background.js:835`, `background.js:842`, `background.js:4942`, `background.js:11304`

## P1

1. 备份历史导出存在“成功误报”  
   - 现象：`exportSyncHistoryToCloud` 使用 `Promise.all(tasks)` 后直接 `success:true`，子任务内部普遍吞错。
   - 证据：`background.js:10783`, `background.js:10945`, `background.js:11014`, `background.js:11023`, `background.js:11047`, `background.js:11138`

2. `restoreToHistoryRecord` preflight 复用条件偏松  
   - 现象：主要按 `recordTime` 复用，未完整绑定 `requestedStrategy/threshold/fingerprint`。
   - 证据：`background.js:4755`, `background.js:4763`

3. 事务可被“提醒阈值”放弃，可能丢失回滚抓手  
   - 证据：`background.js:12365`, `background.js:12762`, `background.js:12856`

4. `activeBackupProgress` 可能僵尸化（单 key、无 TTL 启动清理）  
   - 证据：`background.js:1302`, `background.js:1313`, `background.js:15272`, `background.js:16415`

## P2

1. `backup_reminder` 状态恢复逻辑错误  
   - 现象：`isActive = stored || true` 导致显式 `false` 失效。
   - 证据：`backup_reminder/timer.js:745`

2. 通知关闭流程对象/ID 比较错误  
   - 现象：`windowIdToClose === activeNotificationInfo`。
   - 证据：`backup_reminder/notification.js:393`, `backup_reminder/notification.js:401`

3. 通知防重入变量是函数内局部变量（无法真正防并发）  
   - 证据：`backup_reminder/notification.js:446`, `backup_reminder/notification.js:487`

4. GitHub 请求无显式超时  
   - 证据：`github/repo-api.js:223`, `github/repo-api.js:226`

5. `callTimerFunction` 转发链路需补注册校验（静态检索未见绑定）  
   - 证据：`backup_reminder/index.js:344`, `backup_reminder/timer.js:1419`

## 5. 危险变更轨迹（2.x）

1. 删除确认被移除到恢复  
   - `eaa3e272`（移除删除确认） -> `bb3a3606`（恢复批量确认与结果统计）

2. 恢复安全链路逐步加固  
   - `dbbf8e8b`（恢复主链重写）  
   -> `f82aed0c`（session/preflight）  
   -> `0327cf97`（strictDelete + root 映射）  
   -> `864062b8`（事务写锁）  
   -> `63399254`（payload token/chunk + 意图清理）

3. 云端与手动导出边界收敛  
   - `c759af67` -> `e7ffb765` -> `8745a7e7`

## 6. 与书签树安全直接相关的关键提交（节选）

- `b223c2f`：缓存恢复与增量窗口
- `0adc446`：数据库分层重构 + 回退
- `19ed8c9`：增量条件收紧
- `f1e8177`：删除触发全量重建兜底
- `7c96548`：多版本信息日志
- `f82aed0`：恢复 session/preflight 加固
- `c759af6`：恢复源扫描缓存与队列化
- `8745a7e`：GitHub SHA 冲突重试
- `0327cf9`：root 身份映射 + overwrite 计划
- `864062b`：恢复事务写锁
- `6339925`：本地 payload token/chunk
- `7963413`：baseline 时间戳复核

## 7. 审计结论

总体上，2.x 尤其 2.9.x 已经形成“防清空 + 可回滚 + 可中断恢复”的主安全框架，方向正确。  
当前最主要风险不是“没有兜底”，而是：
- 局部失败吞错导致“看起来成功”
- 并发状态机（监听重复、锁旁路、进度状态）存在漏洞
- 个别模块（backup_reminder）存在确定性逻辑缺陷

这些问题若叠加，会直接影响“书签树安全兜底”的可信度。

---

备注：按需求，本文件仅记录审计事实与结论，不包含修复实施计划。
