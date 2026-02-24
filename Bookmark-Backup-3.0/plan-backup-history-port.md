# 计划书：备份历史拆分存储 + 恢复按钮移植

## 范围与目标
- 仅移植项目B中与「备份历史」与「主 UI（历史入口）」相关的改动
- 核心目标：拆分存储、恢复按钮、历史视图按需加载

## 实施步骤（对应代码修改）
1. **拆分存储（Index vs Data）**
   - `background.js`：新增迁移函数，将 `syncHistory[].bookmarkTree` 迁出为 `backup_data_<time>`；写入 `hasData`
   - `updateSyncStatus`：新记录只写索引，书签树单独存储
   - 删除记录时同步清理 `backup_data_<time>`，并维护 `cachedRecordAfterClear`

2. **恢复按钮（历史视图）**
   - `history_html/history.js`：在历史列表加入“恢复”按钮并绑定事件
   - `background.js`：新增 `restoreToHistoryRecord` 消息处理，复用现有还原逻辑

3. **历史详情按需加载**
   - `background.js`：新增 `getBackupData` 消息
   - `history_html/history.js`：新增 `getBackupDataLazy()`，在详情/搜索/对比时按需拉取树数据

## 验收标准
- 备份历史存储不再把 `bookmarkTree` 写入 `syncHistory`
- 历史详情仍可正常展示变化（按需加载）
- 点击“恢复”按钮后可恢复到对应版本
- 删除历史记录时不会残留 `backup_data_<time>`
