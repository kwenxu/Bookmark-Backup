# [版本更新日志](#版本更新日志) | [Release Notes](#release-notes)

# 版本更新日志

---

## 📢 版本更新 v1.7

### 🐞 已修复的Bug

-   **✅ 「手动模式下角标不变黄」**：
    -   修复了手动备份模式下增加或删除书签后角标不变黄色的问题。
    -   实现了 `getStructureSignature` 函数，为书签结构生成精确签名，使角标能够准确检测到任何变动。
-   **✅ 「增删数量相同但内容不同时的变动提示」**：
    -   修复了手动模式下增删相同数量但不同内容的书签或文件夹时，UI不正确显示变化的问题。
    -   改进了变动检测逻辑，现在能够准确区分"书签变动"、"文件夹变动"或"书签与文件夹变动"。
    -   例如：添加书签A并删除书签B时，现在能正确显示"书签变动"。

## 📢 版本更新 v1.5

### 🐞 已修复的Bug

-   **✅ 「多窗口计时兼容问题」**：
    -   修复了「循环提醒」计时器在多窗口环境下无法同步暂停与恢复的问题。
    -   使用 `chrome.windows.onFocusChanged` API 替换原有的 `chrome.idle` API，确保所有窗口失去焦点后才暂停提醒计时。
-   **🌟 增强角标状态控制**：
    -   只有在角标显示黄色（手动模式且发生结构/数量变化）时，才激活窗口焦点状态监听，减少系统资源占用和干扰。
-   **✅ 计时初始化前的判断优化**：
    -   修复了首次安装和自动模式下不必要的计时器初始化。
    -   仅在切换为手动备份模式后才进行初始化，避免冗余初始化。

### 🚀 新增功能

-   **🌟 备份检查记录--日期分割条目**：
    -   备份检查记录现支持每日分隔条目，并以蓝色椭圆形标记，便于区分不同日期。
    -   导出的txt记录格式优化：最新记录置于上方，日期分隔线采用Markdown横线形式，更清晰易读。
-   **🌟 备份检查记录--增加备注功能**：
    -   新增「时间与备注」栏，每条记录可添加备注（建议20字以下，分两行）。
    -   备注通过UI单独输入，不干扰原有功能。
    -   导出的txt记录显示备注。

---

# Release Notes

---

## 📢 Release Notes v1.7

### 🐞 Bug Fixes

-   **✅ "Badge Color Not Changing in Manual Mode"**:
    -   Fixed an issue where the badge would not turn yellow after adding or deleting bookmarks in manual backup mode.
    -   Implemented the `getStructureSignature` function to generate precise signatures of bookmark structures, enabling accurate detection of any changes.
-   **✅ "Change Detection When Adding and Deleting Equal Numbers of Different Items"**:
    -   Fixed an issue where the UI didn't correctly display changes when adding and deleting the same number of different bookmarks or folders.
    -   Enhanced change detection logic to accurately identify and display "Bookmark changed", "Folder changed", or "Bookmark & Folder changed".
    -   For example: Adding Bookmark A and deleting Bookmark B now correctly shows "Bookmark changed".

## 📢 Release Notes v1.5

### 🐞 Bug Fixes

-   **✅ Multi-window Timer Compatibility Issue**:
    -   Fixed an issue where the loop reminder timer did not synchronize pause and resume correctly in a multi-window environment.
    -   Replaced the original `chrome.idle` API with the `chrome.windows.onFocusChanged` API, ensuring the reminder timer pauses only when all windows lose focus.
-   **🌟 Enhanced Badge State Control**:
    -   Window focus monitoring activates only when the badge displays yellow (manual mode with structural/quantity changes), minimizing resource usage and user disruption.
-   **✅ Timer Initialization Optimization**:
    -   Fixed unnecessary timer initialization during first installation and in automatic mode.
    -   Initialization occurs only upon switching to manual backup mode to avoid redundant initialization.

### 🚀 New Features

-   **🌟 Backup Check Records - Daily Dividers**:
    -   Backup check records now include daily dividers marked with blue ovals for easier date differentiation.
    -   Optimized exported txt record format: newest entries appear at the top, with markdown-style horizontal lines for clearer readability.
-   **🌟 Backup Check Records - Notes Feature**:
    -   Added a "Time and Notes" column allowing each record to have notes (recommended under 20 characters, in two lines).
    -   Notes are entered separately via the UI, avoiding interference with existing features.
    -   Notes are included in exported txt records. 