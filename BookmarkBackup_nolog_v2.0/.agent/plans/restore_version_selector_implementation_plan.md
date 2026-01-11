# 统一版本选择与恢复系统实施计划

> **状态**: 📋 规划中  
> **目标**: 建立一个类似于 Git 版本控制的恢复向导，自动扫描云端或本地文件夹，优先识别合并版历史记录，并提供带有详细变更统计的可视化版本选择界面。

---
# 0.创建一个专用文件夹专项用于 恢复/同步

## 1. 核心逻辑与工作流

### 1.1 数据源识别
系统支持三种数据源，点击即触发扫描（本地需先选文件夹）：

1.  **☁️ 云端 1 (WebDAV)**:
    *   **行为**: 自动定位到配置的根目录（如 `书签快照 & 工具箱/`）。（注意也有英文版本）
    *   **扫描**: 递归扫描 `Backup History/` 和 `Bookmark Backup/`。
2.  **🐙 云端 2 (GitHub)**:
    *   **行为**: 自动定位到仓库根目录。
    *   **扫描**: 同上。
3.  **💻 本地 (Local)**:
    *   **行为**: 用户点击按钮 → 弹出文件夹选择器 (`webkitdirectory`) → 用户选择总父文件夹。（给出提示）
    *   **扫描**: 前端遍历 `FileList`，根据文件名和路径识别文件。

    首先是我们这三个东西得有你明白吗？就是相当于我们的那个我们上面那三个就是开关打开的时候，我们这三个才会显示明白吗？哪个开关打开显示哪个可以点击哪个。

### 1.2 优先级扫描策略 (Priority Logic)
系统将扫描到的所有文件解析为“可恢复版本”，并按以下优先级处理：

| 优先级 | 文件类型 | 路径特征 | 包含内容 | 处理逻辑 |
|:---:|---|---|---|---|
| **🥇 高** | **合并历史**<br>`backup_history.json` | 位于 `Backup History/` 根目录 | ✅ **所有历史版本**<br>✅ 完整元数据 (Stats, Note, Fingerprint)<br>✅ 完整书签树 (`_rawBookmarkTree`) | 解析 JSON 数组，展开为多个可恢复版本选项。这是**首选**数据源。 |
| **🥈 中** | **历史归档**<br>`history_archive_*.zip` | 位于 `Backup History/Auto_Archive/` | ✅ **多个历史版本** (通常为按月/年归档)<br>✅ 同上 (解压后) | 解压 ZIP，读取内部 JSON，展开为多个可恢复版本。 |
| **🥉 低** | **书签快照**<br>`backup_*.html` | 位于 `Bookmark Backup/` | ❌ 仅当前时刻书签<br>❌ 无变更统计<br>❌ 无结构化元数据 | 解析文件名中的日期，作为单个版本展示。仅在无历史记录时作为兜底。 |

也就是和我们的「设置与初始化」左边的「书签备份」、「备份历史」的那些选项导出的匹配，优先的是我们默认给用户的选项。

---

## 2. UI 设计规范 (Version Selection UI)

当扫描完成后，直接弹出 **版本选择模态框 (Restore Modal)**。

### 2.1 模态框结构
*   **标题栏**: 显示当前数据源（如 "Restore form WebDAV"）。
*   **版本列表**: 核心区域，垂直滚动列表。
*   **底部操作栏**: 
    *   **策略选择**: ○ Merge (作为导入合并（根目录））) / ● Overwrite (覆盖当前  - 默认推荐用于完整恢复)
    *   **按钮**: [Cancel] [Restore Selected Version]

### 2.2 版本条目样式 (List Item)

参考 `history.html` 的「全局备份导出」的「选择备份记录」的ui即可，不要视图模式，
序号、备注、哈希值、时间、变更统计（主ui的「数量与结构」）。


---

## 3. 技术实现方案

### 3.1 Background Service (`background.js`)

*   **新增 API**: `scanAndParseRestoreSource(source, localFiles?)`
    *   **功能**: 
        1. 列表/下载文件。
        2. 应用优先级逻辑：
           * 先找 `backup_history.json`，若有，下载并解析。
           * 若无，找 ZIP，下载并解压解析。
           * 若无，找 HTML，解析文件名。
        3. **标准化输出**: 将不同来源的数据统一转换为 `RestoreVersion` 对象数组。
    *   **RestoreVersion 对象结构**:
        ```javascript
        {
            id: "unique_id_or_timestamp",
            time: 1705123456789,
            displayTime: "2026-01-13 14:30",
            note: "Auto Backup",
            stats: { added: 5, deleted: 0, moved: 1, modified: 3, total: 145 },
            fingerprint: "abc1234",
            sourceType: "json" | "zip" | "html",
            originalFile: "backup_history.json", // 或 backup_2026...html
            // 关键：恢复所需的数据或获取方式
            restoreData: { ... } 
        }
        ```

### 3.2 Frontend (`popup.js`)

*   **UI 渲染**: `renderRestoreVersionList(versions)`
    *   动态生成上述设计的 HTML 结构。
    *   应用 CSS 样式（复用 `history.css` 的统计样式类）。
*   **交互逻辑**:
    *   点击条目选中。
    *   点击 "Restore" 调用后台恢复接口，传入选中的版本数据。

---

## 4. 开发步骤

1.  **后端扫描逻辑升级**:
    *   [ ] 修改 `listRemoteFiles` 支持优先级判断。
    *   [ ] 实现 `backup_history.json` 的解析与版本提取。
    *   [ ] 实现 ZIP 归档内容的深度解析（提取内部 JSON）。

2.  **前端 UI 重构**:
    *   [ ] 改造 `restoreModal`，从简单的文件列表变为“富文本版本列表”。
    *   [ ] 添加 CSS 样式以支持统计数据的彩色显示。
    *   [ ] 实现本地文件输入 (`.files`) 的智能解析（在前端预处理为 Version 数组）。

3.  **恢复执行逻辑适配**:
    *   [ ] 确保恢复函数能直接接受 `_rawBookmarkTree` 数据进行恢复（不仅限于从 URL 下载）。

---

## 5. 预期效果

用户点击 "WebDAV" -> 系统显示 "Scanning..." -> 自动展示类似 Git Log 的版本列表 -> 用户看到 "昨天 14:00 删除了 50 个书签" -> 用户选择该版本前的版本 -> 点击恢复 -> 完美回滚。

这个恢复的显示数据是临时的，推出这个ui这个数据则销毁，重新进行选择导入。

同步我们在完成恢复后再继续，因为后期我们有做「书签画布」同步的打算，现在暂时不做。