# 恢复 / 撤销事务中断恢复方案（精准版 v1）

更新时间：2026-03-14

## 1. 背景

当前仓库里，恢复 / 撤销相关链路已经具备一部分基础能力，但还没有形成真正“可跨中断恢复”的完整事务方案。

### 1.1 已有基础

1. **主 UI 的恢复**已经会在执行前抓取“开始前快照”并写入 `restoreBaselineSnapshot`。
2. **HTML 历史页的恢复**也会在执行前抓取“开始前快照”并写入 `restoreBaselineSnapshot`。
3. **运行时自动回退**已经存在：执行补丁 / 覆盖操作失败时，会用操作开始前临时抓取的当前树做一次覆盖回退。
4. **补丁恢复 / 补丁撤销**内部已经是严格 ID 模式，支持增加、删除、移动、修改、排序。

### 1.2 目前还缺什么

1. **撤销链路没有持久化“开始前快照”**。
   - 现在撤销只有函数调用期间的内存态 auto-rollback。
   - 如果浏览器 / 扩展 / service worker 在中途退出，内存态就没了。

2. **主 UI 的恢复没有持久化“目标快照”**。
   - 当前主 UI 传给后台的是 `restoreRef` / `localPayload` 等执行参数。
   - 一旦进程在执行中断掉，想“继续到目标状态”，可能还得重新选来源。

3. **还没有统一的“未完成事务状态”**。
   - 也就是说，现在系统不知道“上一次恢复 / 撤销做到哪一步了”。
   - 所以也就没法在下次打开 popup / history 页面时，给用户一个明确的继续 / 回滚面板。

---

## 2. 目标

本方案的目标很明确：

1. **恢复 / 撤销做到一半时，浏览器或扩展中断，不会把用户丢在半成品状态。**
2. **主 UI 和 HTML 页面共用一套后台事务恢复机制。**
3. **用户不需要为了“继续到目标状态”再次手动选择目标快照。**
4. **“回滚到开始前状态”优先恢复到确定状态，并在可能时尽量保住现存 ID。**
5. **“继续到目标状态”在补丁链路下优先尝试保 ID。**
6. **所有事务持久化缓存只在事务存活期间保留，完成后必须清理。**

---

## 3. 核心原则

### 原则 1：数据安全优先，其次才是 ID

- 一旦发生中断，第一优先级是“用户书签不要丢”。
- 但这不等于“回滚一律只能覆盖”。
- 更准确的策略应该是：
  - **能用补丁回滚，就先尝试补丁回滚；**
  - **补丁回滚失败或不兼容，再降级为覆盖回滚。**

### 原则 2：继续和回滚是两种不同目标

- **继续到目标状态**：目标是完成本次原本要做的恢复 / 撤销。
- **回滚到开始前状态**：目标是回到本次操作开始前的那一刻。

这两个目标不能混在一起设计。

### 原则 3：补丁中断后，优先推荐“继续”

- 如果原本是补丁恢复 / 补丁撤销，且中途打断：
  - **继续到目标状态**更有机会保住已有 ID 映射和结构定位；
  - **回滚到开始前状态**也可以尝试补丁回滚，但它的目标是安全回到开始前状态，而不是保证所有原始 ID 百分百复活。

### 原则 4：补丁回滚是可做的，但不是万能的

- 只要 `startSnapshot` 已经持久化，所谓“补丁回滚”本质上就是：
  - 把 `startSnapshot` 当成新的目标快照；
  - 再执行一次补丁收敛逻辑。
- 这在技术上完全成立。
- 但要明确：
  - **已经被删除并真正消失的旧节点 ID，不可能被 Chrome 原样复活；**
  - 对这类节点，补丁回滚只能重建出“内容和位置对应的新节点”。
- 所以补丁回滚的真实语义是：
  - **尽量保住还存在节点的 ID；**
  - **尽量用 patch 回到开始前结构；**
  - **必要时允许降级为覆盖，确保数据安全。**

### 原则 5：不做重型哈希 / 心跳系统

- 不引入持续心跳。
- 不引入整树哈希比对作为主判定手段。
- 只使用：
  - 持久化事务状态；
  - 关键阶段落盘；
  - 正常完成后的双重清理；
  - 必要时的轻量状态校验。

### 原则 6：不要依赖外部来源重新可用

- 对于“继续到目标状态”，不能假设：
  - popup 还开着；
  - HTML 页面还开着；
  - 用户还记得刚才选的是哪个源；
  - 本地 / 云端来源还能立刻重新解析。

因此，事务一旦开始，必须把**真正要用的目标快照**固化下来。

### 原则 7：事务持久化是临时缓存，不是永久档案

- 事务态持久化的目的只有一个：
  - **支持中断后继续 / 回滚。**
- 它不是：
  - 历史记录；
  - 备份索引；
  - 长期快照协议的一部分。
- 所以事务完成后：
  - **事务头要清；**
  - **开始前快照要清；**
  - **目标快照要清；**
  - **分片键 / 临时索引键也要清。**

---

## 4. 本次范围与非范围

### 4.1 本次范围

v1 覆盖下面四类破坏性操作：

1. 覆盖恢复
2. 补丁恢复
3. 覆盖撤销
4. 补丁撤销

并要求：

- 主 UI 与 HTML 页面共用后台实现；
- 都支持中断后提示；
- 都支持“继续到目标状态 / 回滚到开始前状态 / 稍后处理”；
- 对补丁事务支持 **补丁回滚优先，覆盖回滚兜底**。

### 4.2 暂不纳入 v1

1. 导入合并（merge）
2. 纯扫描 / 预演 / diff 过程
3. 自动同步链路

说明：

- merge 的破坏性和目标定义与 restore / revert 不完全一致，先不混进第一版。
- 第一版先把最危险的 restore / revert 做稳。

---

## 5. 新方案总览

### 5.1 统一事务键

新增统一事务状态，例如：

- `restoreRecoveryTransaction`

建议只允许**同一时刻最多一个未完成事务**。

理由：

- 该扩展本身的破坏性恢复 / 撤销就不适合并发；
- 单事务模型更稳，也更容易给 UI 做明确提示。

### 5.2 事务里必须固化两份快照

每次真正开始执行破坏性恢复 / 撤销前，统一固化：

1. **startSnapshot**：操作开始前的当前浏览器书签树
2. **targetSnapshot**：本次最终要达到的目标快照

这两份快照都放在事务临时缓存里，不写进索引文件，不写进长期历史协议。

这样可以直接解决两个关键问题：

1. **回滚到开始前状态**：把 `startSnapshot` 当成新的回滚目标快照，按 patch / overwrite 规则执行回滚。
2. **继续到目标状态**：把 `targetSnapshot` 当成继续目标快照继续执行，不需要用户重新选源。

### 5.3 为什么这次必须把目标快照真正存下来

如果只存：

- `restoreRef`
- `localPayload`
- `sourceType`
- `sourcePath`

那么中断后仍然有问题：

1. 本地文件可能已经被移动 / 解除挂载；
2. 云端索引可能更新；
3. 用户已经忘记刚才选的是哪个版本；
4. 继续执行时还得再走一遍“解析来源 → 组装目标树”的流程。

这会让“继续”重新变成一个半手动过程。

因此，新方案建议：

- **在事务开始前，就先把最终要恢复 / 撤销到的目标树解析出来**；
- 然后把这棵完整的 `targetSnapshot` 落入事务状态；
- 后续执行时，无论是第一次跑，还是中断后继续，都只依赖这份事务内快照。

这样主 UI 也不需要再次让用户手选目标快照。

### 5.4 容量上是可行的

当前扩展 `manifest.json` 已声明：

- `storage`
- `unlimitedStorage`

因此，v1 里用 `storage.local` 临时落一份 `startSnapshot + targetSnapshot`，在容量策略上是成立的。

---

## 6. 数据模型设计

### 6.1 事务头建议结构

```json
{
  "sessionId": "restore_1710000000000_abcd1234",
  "status": "running",
  "phase": "apply_started",
  "operationKind": "restore",
  "requestedStrategy": "patch",
  "resolvedStrategy": "patch",
  "uiSource": "popup",
  "sourceType": "local_html",
  "startedAt": 1710000000000,
  "updatedAt": 1710000001234,
  "displayTitle": "2026-03-14 09:30 快照恢复",
  "startSnapshotKey": "restoreRecoveryTransaction:start:restore_1710000000000_abcd1234",
  "targetSnapshotKey": "restoreRecoveryTransaction:target:restore_1710000000000_abcd1234",
  "canContinue": true,
  "canRollback": true,
  "meta": {
    "recordTime": "2026-03-14T01:30:00.000Z",
    "snapshotKey": "__overwrite__",
    "requestedFrom": "main_ui"
  }
}
```

说明：

- 建议把**事务头**与**大体积快照**分开存。
- 不强制必须单键或单对象。
- 只要能做到：
  - 明确引用；
  - 完整清理；
  - 中断后能恢复；
  就可以。

### 6.2 快照缓存建议结构

建议至少拆成两个键：

- `restoreRecoveryTransaction:start:<sessionId>`
- `restoreRecoveryTransaction:target:<sessionId>`

如果体积更大，可继续分片，例如：

- `restoreRecoveryTransaction:start:<sessionId>:part:0`
- `restoreRecoveryTransaction:target:<sessionId>:part:0`

### 6.3 必填字段

事务头建议至少包含：

- `sessionId`
- `status`
- `phase`
- `operationKind`
- `requestedStrategy`
- `resolvedStrategy`
- `startedAt`
- `updatedAt`
- `startSnapshotKey`
- `targetSnapshotKey`

### 6.4 推荐附带字段

- `uiSource`
- `sourceType`
- `displayTitle`
- `meta.recordTime`
- `meta.snapshotKey`
- `meta.requestedFrom`

### 6.5 `status` 建议值

- `running`
- `completed`
- `abandoned`

### 6.6 `phase` 建议值

- `prepared`
- `snapshot_ready`
- `destructive_started`
- `apply_started`
- `finalizing`
- `completed`

说明：

- 检测未完成事务时，主要看：
  - `status !== completed`
- UI 展示文案时，再参考：
  - `phase`

---

## 7. 四条链路怎么接入

### 7.1 主 UI 覆盖恢复 / 补丁恢复

进入后台后：

1. 先抓当前树，写 `startSnapshot`
2. 先把来源解析成真正的 `targetSnapshot`
3. 写事务状态：`snapshot_ready`
4. 再按原本的覆盖 / 补丁策略执行
5. 成功后标记 `completed` 并清理

这样中断后：

- **继续**：直接拿事务里的 `targetSnapshot` 重跑
- **回滚**：直接拿事务里的 `startSnapshot` 当目标快照回滚

### 7.2 HTML 历史页覆盖恢复 / 补丁恢复

逻辑与主 UI 一样。

不同点只是：

- `targetSnapshot` 来源更稳定，通常直接来自历史记录 / 历史页面已有数据；
- 但仍然建议统一固化到事务里，不走分支特判。

### 7.3 覆盖撤销 / 补丁撤销

当前撤销的目标本来就是：

- `lastBookmarkData.bookmarkTree`

因此事务化后统一做：

1. 抓当前树，写 `startSnapshot`
2. 把 `lastBookmarkData.bookmarkTree` 复制为 `targetSnapshot`
3. 记录当前是 `revert`
4. 执行覆盖撤销 / 补丁撤销
5. 成功后清理

这样撤销中断后也具备：

- 继续到目标状态
- 回滚到开始前状态

### 7.4 merge 先不纳入

原因：

- merge 的“目标状态”不是整树强收敛；
- 它更像导入行为而不是恢复到既定快照；
- 第一版先别把复杂度带进来。

---

## 8. 恢复 / 回滚策略定义

### 8.1 继续到目标状态

#### 覆盖链路

- 直接对事务里的 `targetSnapshot` 执行覆盖恢复。

#### 补丁链路

- 优先按原来的 `resolvedStrategy = patch` 继续执行；
- 如果继续时发现补丁条件已经不满足：
  - 可以提示用户是否改用覆盖继续；
  - 但 v1 不建议静默改成覆盖。

原因：

- 用户原本选择补丁，通常就是为了尽量保 ID；
- 中断后继续应尽量尊重这个目标。

### 8.2 回滚到开始前状态

#### 原事务是 `overwrite`

- 直接对 `startSnapshot` 执行覆盖回滚。

#### 原事务是 `patch`

- 优先对 `startSnapshot` 执行**补丁回滚**；
- 如果补丁回滚失败、条件不兼容、或中途再次报错：
  - 自动降级为**覆盖回滚**。

### 8.3 补丁回滚的真实边界

补丁回滚是可做的，但要把边界说清楚：

1. **对仍然存在的节点**
   - 可以尽量按真实 ID 做 patch 定位；
   - 更有机会保住现存 ID。

2. **对已经被删掉并彻底消失的节点**
   - Chrome 不可能“复活原 ID”；
   - 只能重建为新节点。

3. **因此补丁回滚的目标不是“原 ID 百分百恢复”**
   - 而是：
     - 尽量 patch 回去；
     - 尽量保现存 ID；
     - 失败时确保能覆盖兜底回到开始前状态。

### 8.4 推荐的实际策略

建议按下面规则实现：

1. **继续到目标状态**
   - 原来是 `patch`，就优先继续 `patch`
   - 原来是 `overwrite`，就继续 `overwrite`

2. **回滚到开始前状态**
   - 原来是 `patch`，先尝试 `patch rollback`
   - `patch rollback` 失败或不兼容，再 `overwrite rollback`
   - 原来是 `overwrite`，直接 `overwrite rollback`

---

## 9. UI 方案

### 9.1 触发时机

当下面任一页面打开时，查询是否存在未完成事务：

1. popup 打开
2. `history_html/history.html` 打开
3. 扩展初始化后可选做一次静默检查

### 9.2 面板文案建议

标题：

- `检测到上次恢复 / 撤销未完成`

正文：

- `上一次书签恢复或撤销在执行过程中被中断，当前浏览器书签可能处于中间状态。你可以继续执行到目标状态，或回滚到本次操作开始前的状态。`

附加信息：

- 操作类型：恢复 / 撤销
- 原策略：覆盖 / 补丁
- 开始时间
- 中断阶段
- 来源：主 UI / 历史页

### 9.3 按钮设计

1. `继续到目标状态`
2. `回滚到开始前状态`
3. `稍后处理`

### 9.4 推荐逻辑

- 如果 `resolvedStrategy === patch`：
  - 推荐按钮是 `继续到目标状态`
  - 回滚说明中补充：`将优先尝试补丁回滚，失败后自动改用覆盖回滚。`
- 如果 `resolvedStrategy === overwrite`：
  - 两者都可，不强推荐

### 9.5 风险提示

当用户点击 `回滚到开始前状态` 时，提示：

- `本操作会优先尝试回到开始前状态；若补丁回滚不兼容或失败，将自动改用覆盖回滚。节点 ID 可能与中断前不同。`

---

## 10. 生命周期设计

### 10.1 开始事务

真正执行破坏性操作之前：

1. 生成 `sessionId`
2. 抓 `startSnapshot`
3. 解析并固化 `targetSnapshot`
4. 写事务状态：`snapshot_ready`

### 10.2 执行阶段

进入真正修改书签前：

- 写 `phase = destructive_started`

开始调用 restore / patch 逻辑时：

- 写 `phase = apply_started`

开始收尾时：

- 写 `phase = finalizing`

### 10.3 正常结束

成功后执行两轮清理：

1. 先写：`status = completed, phase = completed`
2. 删除事务头键
3. 删除 `startSnapshot` 对应键
4. 删除 `targetSnapshot` 对应键
5. 删除所有事务分片键 / 临时索引键
6. 删除后再校验一次；若仍存在，再删一次

目的：

- 降低“其实已完成，但事务键没删掉”的误报概率；
- 确保事务持久化缓存不会长期留在 `storage.local` 里。

### 10.4 异常结束

如果代码层面抛错，但进程仍活着：

- 保留事务键；
- 不在这里自动强行清掉；
- 让下次打开 UI 时进入统一恢复面板。

如果浏览器 / 扩展直接崩溃：

- 事务键自然残留；
- 下次打开 UI 时会被检测到。

### 10.5 启动后的残留清理规则

下次打开 popup / history 页面时：

1. 如果事务头不存在：
   - 直接视为无事发生。

2. 如果事务头存在，但 `status === completed`：
   - 不弹面板；
   - 直接静默再清理一轮事务相关键。

3. 如果事务头存在，且 `status !== completed`：
   - 弹出未完成事务面板。

---

## 11. 代码改造清单

### 11.1 `background.js`

新增统一事务工具函数：

1. `beginRestoreRecoveryTransaction(...)`
2. `updateRestoreRecoveryTransactionPhase(...)`
3. `completeRestoreRecoveryTransaction(...)`
4. `clearRestoreRecoveryTransaction(...)`
5. `getPendingRestoreRecoveryTransaction(...)`
6. `continueRestoreRecoveryTransaction(...)`
7. `rollbackRestoreRecoveryTransaction(...)`
8. `loadRestoreRecoverySnapshot(...)`
9. `removeRestoreRecoverySnapshotParts(...)`

### 11.2 恢复链路接入

把下面入口统一接入事务包装：

1. `restoreSelectedVersion(...)`
2. `restoreToHistoryRecord` 对应后台主入口

要求：

- 不只是存 `restoreBaselineSnapshot`；
- 而是升级为完整事务：`startSnapshot + targetSnapshot`；
- 并让 `continue / rollback` 都只依赖事务缓存，不依赖 UI 页面还活着。

### 11.3 撤销链路接入

把下面入口接入事务包装：

1. `revertAllToLastBackup`

要求：

- 补上撤销前的 `startSnapshot` 持久化；
- 同时把 `lastBookmarkData.bookmarkTree` 固化为 `targetSnapshot`；
- 支持 patch rollback 优先、overwrite rollback 兜底。

### 11.4 popup / history 页面

新增：

1. 查询未完成事务
2. 弹恢复面板
3. 调用：继续 / 回滚 / 稍后处理

但注意：

- 真正执行逻辑仍在后台；
- UI 只负责展示与触发。

---

## 12. 实施顺序建议

### Phase A：先把底座做出来

1. 新增统一事务 state 数据结构
2. 新增事务头 / 快照缓存读写工具
3. 主 UI 恢复接入事务包装
4. HTML 恢复接入事务包装
5. 撤销接入事务包装
6. 完成双重清理

### Phase B：补 UI 面板

1. popup 检测未完成事务
2. history 页面检测未完成事务
3. 增加继续 / 回滚 / 稍后处理按钮
4. 增加 patch 推荐提示
5. 增加 completed 残留静默清理

### Phase C：补验证

1. 中途中断恢复
2. 中途中断撤销
3. 中途中断补丁恢复
4. 中途中断补丁撤销
5. 正常完成误报检测
6. 事务缓存清理检测

---

## 13. 压力测试与抗风险测试建议

### 13.1 中断类测试

1. 主 UI 覆盖恢复开始后，关闭 popup
2. HTML 覆盖恢复开始后，关闭历史页
3. 覆盖恢复删除阶段中途关闭浏览器
4. 补丁恢复 move / update 阶段中途关闭浏览器
5. 覆盖撤销中途关闭浏览器
6. 补丁撤销中途关闭浏览器
7. 补丁回滚阶段中途关闭浏览器

预期：

- 下次打开 popup / history 页面时，能检测到未完成事务；
- 能继续或回滚；
- 不需要用户重新选择目标快照。

### 13.2 大数据量测试

1. 5k 节点
2. 20k 节点
3. 50k 节点
4. 多层深目录
5. 重名文件夹 / 重名书签大量存在

重点观察：

- 事务 state 写入是否稳定；
- `storage.local` 是否有明显写放大问题；
- 恢复完成后事务是否被正确清理；
- patch rollback 失败时是否稳定降级为 overwrite rollback。

### 13.3 误报测试

1. 正常恢复成功后立即关闭 popup
2. 正常撤销成功后立即关闭 HTML 页面
3. 正常完成后立刻重新打开插件

预期：

- 不应该反复弹“上次恢复未完成”；
- 双重清理能消除大多数误报；
- `completed` 残留只会触发静默清理，不会误弹面板。

---

## 14. 风险与取舍

### 14.1 v1 的取舍

本方案明确接受下面这个取舍：

- **补丁回滚可做，但不承诺把已经消失的旧 ID 百分百复原。**
- **一旦补丁回滚不兼容或失败，必须允许自动降级为覆盖回滚。**

这不是缺陷，而是浏览器书签 API 的真实边界。

### 14.2 为什么这样更适合 Bookmark Backup

对于书签备份工具，最高优先级是：

1. 用户数据不要丢
2. 用户能恢复到确定状态
3. 在条件允许时再尽量保 ID

因此：

- “继续到目标状态”适合追求 ID 尽量稳定；
- “回滚到开始前状态”适合先尝试 patch，再以 overwrite 做安全兜底。

---

## 15. 最终建议（精准版 v1 定案）

建议按下面这个版本直接落地：

1. **所有 restore / revert 统一事务化。**
2. **事务里必须存 `startSnapshot` 和 `targetSnapshot`。**
3. **主 UI 的恢复不再依赖用户中断后重新选目标。**
4. **继续到目标状态：按原策略继续。**
5. **回滚到开始前状态：原 patch 先 patch rollback，失败再 overwrite rollback；原 overwrite 直接 overwrite rollback。**
6. **所有事务持久化缓存只用于中断恢复，正常完成后全部清除。**
7. **merge 暂不纳入第一版。**
8. **UI 统一提供：继续 / 回滚 / 稍后处理。**

这版的优点是：

- 结构清晰；
- 逻辑更准确；
- 不会让主 UI 中断后重新选目标；
- 对主 UI 和 HTML 都成立；
- 更符合“书签备份工具以数据安全为第一目标，同时尽量保 ID”的定位。
