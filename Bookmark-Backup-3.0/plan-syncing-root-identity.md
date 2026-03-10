# `syncing` 顶层根身份接入计划书

更新时间：2026-03-10

参考提交：
- `0013bb040c66c1869608b5d16d3fb2ed13e45e51`
- `aecaf19ed44ad0190600d9af9d7483d6be229c45`

## 1. 背景

当前仓库已经完成两件关键事情：

1. 基于 `folderType` 的普通全量 HTML 快照增强导出 / 解析。
2. 主 UI 的覆盖恢复、预演、报错链路已经统一到同一套根匹配逻辑。

这意味着：后续接入 `syncing` 时，不需要重新设计整条链路，只需要沿着 `folderType` 已经打通的路径，把“顶层根身份”从：

- `folderType`

升级为：

- `folderType + syncing`

并保留向下兼容兜底。

---

## 2. 目标

本计划目标不是“按 `syncing` 过滤书签内容”，而是：

1. **永远全量备份**：API 返回什么，就备份什么。
2. **只在顶层内建根身份上使用 `syncing`**。
3. **让 dual-storage / 双根场景下的覆盖恢复具备精确匹配能力**。
4. **保持旧 HTML / 无 `syncing` 快照可恢复，但在必要时保守失败而不是猜测**。

---

## 3. 基本原则（最终规则）

### 规则 1：永远全量备份

- 不因为 `syncing === true / false` 过滤任何节点。
- `syncing` 只影响“这棵顶层根是谁”，不影响“这棵树要不要备份”。

### 规则 2：`syncing` 只用于顶层内建根身份

- 只在 `folderType` 有意义的顶层根上使用。
- 不把它扩散到普通文件夹 / 普通书签的业务语义。

### 规则 3：根匹配优先级

1. 优先：`(folderType + syncing)`
2. 次级：`folderType`
3. 最后兜底：旧的 `id / title`

### 规则 4：`syncing` 只是“快照时刻的匹配提示”

- 不把 `syncing` 当长期稳定主键。
- 不把 `syncing` 写成跨时刻强绑定的永久 ID。
- 它的作用是“这次恢复 / 这次同步怎么配根”，不是“这个根永远是谁”。

---

## 4. 本次范围与非范围

### 4.1 本次范围

- 普通全量快照的导出 / 解析 / 恢复链路接入 `syncing`。
- 主 UI 覆盖恢复、预演、diff、报错接入 `syncing`。
- 旧格式 HTML / 无 `syncing` 快照继续兼容。

### 4.2 非范围

- 不因为 `syncing` 改变备份内容范围。
- 不改普通节点（非顶层根）的数据模型。
- 不把 `syncing` 扩展成“同步开关”或“权限语义”。
- 不在本次强行完成补丁恢复（patch restore）增强。

---

## 5. 当前基础（已完成，可直接复用）

这部分已经在参考提交中具备：

### 5.1 恢复主链路统一

- `background.js` 中 `restoreSelectedVersion(...)` 已经成为主执行入口。
- popup 已经把恢复记录元数据前置传给背景页，避免 popup 关闭时丢恢复记录。

### 5.2 `folderType` 已经打通

- 普通全量 HTML 已支持嵌入自定义根元数据。
- HTML 解析后可回填顶层根 `folderType`。
- overwrite 预演 / diff / 执行已统一用同一套 root plan。
- popup 已支持将 root-plan 失败转换为可读错误提示。

### 5.3 根匹配已有统一入口

- 目前已经有 `getRootMatchKeys(...)` 一类函数做根匹配。
- 目前是 `folderType` 优先 + 旧 `id/title` 兜底。
- 下一步只需要把这个“根身份”扩展为 `folderType + syncing`。

---

## 6. 数据模型设计

### 6.1 顶层根身份对象（建议）

建议在内存态统一使用：

```json
{
  "title": "Bookmarks Bar",
  "folderType": "bookmarks-bar",
  "syncing": true
}
```

说明：

- `title`：仅做兼容与展示。
- `folderType`：一级身份。
- `syncing`：二级身份。

### 6.2 匹配 key 设计

建议统一生成三层 key：

1. `folderType:<type>|syncing:<true|false>`
2. `folderType:<type>`
3. 旧兼容 key（`toolbar` / `menu` / `mobile` / 标题归一）

示例：

- `folderType:bookmarks-bar|syncing:true`
- `folderType:bookmarks-bar`
- `toolbar`

### 6.3 允许的缺省值

- `syncing` 缺失时，不报错。
- 只有在“当前浏览器存在同 `folderType` 多根，且源快照没有足够身份信息”时，才禁止 overwrite 猜测恢复。

---

## 7. 存储载体策略

### 7.1 HTML（我们自己的增强快照）

保留现有 `bookmarkBackupMeta` 协议，在 `rootDescriptors` 中新增 `syncing`：

```json
{
  "schemaVersion": 2,
  "snapshotKind": "full_html",
  "rootDescriptors": [
    {
      "title": "Bookmarks Bar",
      "folderType": "bookmarks-bar",
      "syncing": true
    }
  ]
}
```

### 7.2 JSON（如后续接入）

- 若仓库里已有 JSON 快照载体，同样增加根描述元数据。
- 原则与 HTML 保持一致。

### 7.3 索引文件 / 版本索引

- 索引文件不需要冗余整棵树。
- 但可以考虑只补“根身份摘要”，用于扫描期快速判断该快照是否具备双根精确恢复能力。
- 这一步可以放在第二阶段，不阻塞主恢复链路。

### 7.4 官方原生 HTML

- 浏览器原生导出的 Netscape HTML 不会原生带 `syncing`。
- 这类文件必须继续走兼容兜底：
  - `folderType + syncing` 不可用
  - 尝试 `folderType`
  - 再尝试旧 `id/title`
  - 仍无法唯一匹配时，禁止 overwrite 猜测恢复

---

## 8. 代码改造清单

以下清单按“必须先改 → 可后改”排序。

### 8.1 第 1 组：元数据导出 / 解析（必须）

#### `background.js`

1. `buildFullSnapshotHtmlMeta(...)`
   - 当前：写入 `title + folderType`
   - 目标：写入 `title + folderType + syncing`

2. `convertToEdgeHTML(...)`
   - 当前：输出 `bookmarkBackupMeta`
   - 目标：沿用原协议位置，不改容器，只扩字段

3. `parseFullSnapshotMetaFromHtml(...)`
   - 当前：读 `rootDescriptors`
   - 目标：额外读取 `syncing`

4. `applyFullSnapshotMetaToParsedTree(...)`
   - 当前：回填 `folderType`
   - 目标：同时回填 `syncing`

### 8.2 第 2 组：根匹配核心（必须）

#### `background.js`

1. `getRootMatchKeys(...)`
   - 当前：`folderType` → 旧 key
   - 目标：`(folderType + syncing)` → `folderType` → 旧 key

2. `setRootMatchMapEntry(...)`
   - 当前：把根写入多 key map
   - 目标：同样支持组合 key

3. `getRootMatchMapValue(...)`
   - 当前：按旧优先级取值
   - 目标：先查组合 key，再查单 `folderType`，再查旧 key

### 8.3 第 3 组：当前浏览器根建模（必须）

#### `background.js`

1. `buildBookmarkContainerState(...)`
   - 当前：当前浏览器顶层根建模只围绕 `folderType`
   - 目标：把 `syncing` 纳入当前根身份

2. duplicate 检测逻辑
   - 当前：同 `folderType` 重复时会保守失败
   - 目标：改为：
     - 同 `(folderType + syncing)` 重复才算真正冲突
     - 同 `folderType` 但 `syncing` 不同，不再直接判冲突

### 8.4 第 4 组：overwrite 计划 / 预演 / 执行（必须）

#### `background.js`

1. `buildOverwriteRestorePlan(...)`
   - 用新的根身份规则做 assignment
   - 新增“缺少 `syncing`，无法在双根场景中精确匹配”的结构化错误

2. `buildOverwriteRestorePreview(...)`
   - 复用同一套 plan

3. `computeRestoreDiffSummaryAgainstCurrent(...)`
   - 复用同一套 plan

4. `restoreSelectedVersion(...)`
   - 真执行 overwrite 前仍然走同一套预检
   - 继续避免被 auto-rollback 的通用错误吃掉

### 8.5 第 5 组：旧恢复兼容链路（建议一并完成）

#### `background.js`

1. `mapRevertRootIds(...)`
2. `applyRestoreTopLevelRootIdRemap(...)`
3. `restoreSnapshotTree(...)`

原因：

- 否则会出现“新 overwrite 预演用新规则，但旧兼容恢复链路仍按旧规则”的不一致。

### 8.6 第 6 组：popup 文案（必须）

#### `popup.js`

1. `formatRestoreUiError(...)`
   - 需要把错误语义改成：
     - 并不是“必须有 `syncing` 才能恢复”
     - 而是“当前浏览器存在双根，而源快照缺少足够根身份信息，无法精确覆盖恢复”

2. 预演 / 执行失败提示
   - 继续沿用现有结构化错误链路
   - 不改调用方式，只改文案分支

---

## 9. 错误与降级策略

### 9.1 可恢复场景

- 源快照有 `folderType + syncing`
- 当前浏览器双根存在，但能唯一匹配
- 允许 overwrite

### 9.2 降级可恢复场景

- 源快照没有 `syncing`
- 当前浏览器没有同 `folderType` 双根
- 允许回退到 `folderType` 或旧 key 匹配

### 9.3 必须保守失败场景

- 当前浏览器存在：
  - `bookmarks-bar + syncing=true`
  - `bookmarks-bar + syncing=false`
- 源快照只知道 `folderType=bookmarks-bar`
- 且无法通过其他信息唯一判断目标根

处理策略：

- **禁止 overwrite 猜测恢复**
- 提示用户：
  - 该快照缺少精确根身份信息
  - 可切换浏览器 / profile
  - 或改用 merge / 其他来源

---

## 10. 推荐实施顺序

### Phase 1：最小可用接入

- HTML 元数据写入 `syncing`
- HTML 解析回填 `syncing`
- 根匹配升级为三层优先级
- overwrite 计划接入 `syncing`
- popup 错误文案升级

目标：

- 普通快照 HTML 在双根 Chrome 上具备精确覆盖恢复能力

### Phase 2：兼容链路补齐

- `restoreSnapshotTree(...)`
- root id remap 相关逻辑
- 老恢复分支统一到新根身份规则

目标：

- 预演 / 正式执行 / 兼容恢复链路行为一致

### Phase 3：索引 / JSON 扩展（可选）

- 若有 JSON 快照，补 `syncing`
- 若要提升扫描期提示能力，再给索引文件补根身份摘要

目标：

- 扫描阶段即可提示“该快照是否具备双根精确恢复能力”

---

## 11. 验收标准（Checklist）

- [ ] 我们自己的增强 HTML 已写入 `syncing`
- [ ] 从增强 HTML 恢复时可读回 `syncing`
- [ ] 当前浏览器双根场景下，`(folderType + syncing)` 可唯一匹配
- [ ] 源快照缺少 `syncing` 且当前浏览器无双根时，仍可恢复
- [ ] 源快照缺少 `syncing` 且当前浏览器存在双根时，overwrite 保守失败
- [ ] popup 提示能明确告诉用户“为什么不能精确覆盖恢复”
- [ ] 不因为 `syncing` 过滤任何书签节点
- [ ] 老格式原生 HTML 仍能被主 UI 识别和恢复

---

## 12. 手测建议

### 场景 A：旧原生 HTML

- 用 Chrome / Edge 原生导出 HTML
- 本地选文件恢复
- 验证：
  - 能扫描
  - 能预演
  - 在单根浏览器下可正常 overwrite

### 场景 B：增强 HTML

- 用当前扩展导出普通快照 HTML
- 检查文件头中 `bookmarkBackupMeta`
- 验证 `rootDescriptors` 中带 `folderType + syncing`

### 场景 C：单根浏览器

- 当前浏览器只有单套标准根
- 恢复旧快照 / 新快照
- 验证都可通过

### 场景 D：双根浏览器

- 当前浏览器出现同 `folderType` 双根
- 用带 `syncing` 的增强快照恢复
- 验证：可唯一匹配

### 场景 E：双根 + 旧快照

- 当前浏览器双根
- 快照缺少 `syncing`
- 验证：overwrite 保守失败，merge 仍可作为替代策略

---

## 13. 风险与注意事项

### 风险 1：把 `syncing` 错当内容过滤条件

后果：

- 备份内容不完整
- 同步结果丢树

防护：

- 代码评审时明确：`syncing` 只能参与顶层根身份匹配

### 风险 2：只改 preview，不改执行

后果：

- 预演结果和正式恢复不一致

防护：

- `buildOverwriteRestorePlan(...)` 必须成为唯一根判断入口

### 风险 3：旧 HTML 被误伤

后果：

- 老格式导出无法恢复

防护：

- 继续保留 `folderType` / `id/title` 兜底
- 只有在“当前确实存在双根且无法唯一匹配”时才失败

---

## 14. 最终判断

对于当前仓库：

- **不接入 `syncing`，仍然可以继续做全量备份。**
- **但如果要把 Chrome 新 dual-storage 根模型下的精确覆盖恢复做对，最终还是要接入 `syncing`。**

因此，本计划建议：

- 先沿 `aecaf19...` 已打通的 `folderType` 链路最小改造接入 `syncing`
- 再补齐旧兼容恢复链路
- 最后再决定是否把索引 / JSON 也补上

