# Favicon 子域名通解计划书（Bookmark Backup）

日期：2026-04-14  
范围：`Bookmark-Backup-3.0` 的 history/popup/search 等全部 Favicon 入口  
目标：三项目统一策略，避免项目内分裂实现

## 1. 通用策略
1. 缓存键统一：`hostname`（子域名）。
2. 主缓存统一：IndexedDB（`favicons` / `failures`）。
3. 查询顺序统一：`failures(TTL)` -> `favicons(IDB)` -> `network waterfall`。
4. 并发统一：`inflight(hostname)` 去重，防止同 host 并发重复抓取。
5. 速度优先：前台路径不阻塞 `await`，允许偶发 miss 进入瀑布流后覆盖回写。

## 2. 为什么不用 title / 完整 URL
1. `title` 易冲突（同名不同站）会串图标。
2. 完整 URL 过细，命中率低，重复数据多。
3. `hostname` 在准确性与复用率之间平衡最好，且适配子域名差异。

## 3. 性能实现约束（必须）
1. 禁止逐条事务：不得“一条 URL 一次 IDB 事务”。
2. 批量查询：当前屏待渲染 URL 先去重到 `hostname`，单事务批量读取。
3. 批量写入：网络命中后用单 readwrite 事务提交。
4. 失败缓存短 TTL（建议 5 分钟），避免失败风暴导致卡顿。
5. 默认 `last-write-wins`，不做阻塞式等待和复杂质量门控。

## 4. 本项目落地范围
1. `history_html/history.js`：统一查询链路与批量读写。
2. `popup.js`：与 history 共用同一套 resolver，不允许独立规则漂移。
3. 搜索/列表渲染入口：统一走批量 resolver。

## 5. 限制与风险
1. 冷启动：IDB 首次为空，网络时间不可消除。
2. 站点策略：部分站无 favicon 或返回默认图，质量受外部源限制。
3. 子域名键条目会增多，但换来更准确映射（避免错误复用）。
4. 浏览器扩展上下文可能被挂起，长任务需可恢复、可重入。
5. 允许覆盖回写后，极少数情况下会出现图标短暂抖动或质量回退。

## 6. 验收
1. 二次打开相同内容，图标以 IDB 命中为主。
2. 控制台可看到命中分布：`idb_hit / network_fetch / failure_ttl_block`。
3. history 与 popup 的命中行为一致，无“一个快一个慢”分裂。

## 7. 回滚
1. 通过开关回滚到旧链路。
2. 发生异常时优先回滚批量写入与失败 TTL，再排查瀑布源行为。
