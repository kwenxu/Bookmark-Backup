# 书签备份历史查看器 / Bookmark Backup History Viewer

## 功能概述 / Features

这是一个类似 Git 的书签变化追踪界面，提供详细的书签历史记录查看功能。

This is a Git-like bookmark change tracking interface that provides detailed bookmark history viewing.

## 主要功能 / Main Features

### 1. 备份历史 / Backup History
- 查看所有备份记录（类似 git log）/ View all backup records (similar to git log)
- 显示每次备份的详细变化统计 / Show detailed change statistics for each backup
- 区分自动备份和手动备份 / Distinguish between auto and manual backups
- 点击记录查看详细信息 / Click records to view details

### 2. 书签温故 / Bookmark Review
- 按日期分组显示新增书签 / Display new bookmarks grouped by date
- 按文件夹分类 / Categorize by folders
- 显示备份状态（已备份/未备份）/ Show backup status (backed up / not backed up)
- 过滤功能：全部/已备份/未备份 / Filter: All / Backed Up / Not Backed Up

### 3. 书签树 / Bookmark Tree
- 完整的书签层级结构 / Complete bookmark hierarchy
- 实时显示每个书签的备份状态 / Real-time backup status for each bookmark
- 可折叠/展开的树形视图 / Collapsible/expandable tree view
- 显示书签图标 / Display bookmark favicons

### 4. 其他功能 / Other Features
- 🔍 实时搜索 / Real-time search
- 🌓 深色模式自动同步 / Dark mode auto-sync with main UI
- 🌐 多语言支持（中文/英文）/ Multi-language support (Chinese/English)
- 📥 导出为 JSON/HTML 格式 / Export as JSON/HTML
- 🔄 实时更新（无需刷新）/ Real-time updates (no refresh needed)
- 📊 统计信息面板 / Statistics panel

## 使用方法 / How to Use

### 方式 1: 从状态卡片打开 / Method 1: Open from Status Card
点击主界面的绿色/蓝色状态卡片，会自动打开历史查看器并显示最新的备份详情。

Click the green/blue status card in the main UI to automatically open the history viewer and display the latest backup details.

### 方式 2: 从备份检查记录打开 / Method 2: Open from Backup History
点击「备份检查记录」右侧的「详细查看器」按钮，打开完整的历史查看器。

Click the "Detail Viewer" button next to "Backup History" to open the full history viewer.

## 技术特点 / Technical Features

### 1. Git 风格设计 / Git-style Design
- 提交记录视图 / Commit-like view
- 变化统计标记 / Change statistics badges
- 清晰的视觉层次 / Clear visual hierarchy

### 2. 响应式设计 / Responsive Design
- 适配不同屏幕尺寸 / Adapts to different screen sizes
- 流畅的动画过渡 / Smooth animation transitions
- 优雅的交互反馈 / Elegant interaction feedback

### 3. 主题同步 / Theme Synchronization
- 自动与主 UI 的主题保持一致 / Automatically syncs with main UI theme
- 深色模式优化 / Dark mode optimized
- CSS 变量驱动 / CSS variable-driven

### 4. 实时通信 / Real-time Communication
- 使用 Chrome Storage API 监听变化 / Uses Chrome Storage API to listen for changes
- 自动更新数据显示 / Automatically updates data display
- 无需手动刷新 / No manual refresh needed

## 文件结构 / File Structure

```
history_html/
├── history.html    # 主页面 / Main page
├── history.css     # 样式文件 / Stylesheet
├── history.js      # 逻辑文件 / Logic file
└── README.md       # 说明文档 / Documentation
```

## 兼容性 / Compatibility

- Chrome 88+
- Edge 88+
- 其他基于 Chromium 的浏览器 / Other Chromium-based browsers

## 注意事项 / Notes

1. 由于浏览器扩展限制，无法获取具体变化的书签列表，只能显示统计信息。
   Due to browser extension limitations, we cannot retrieve the specific list of changed bookmarks, only statistics.

2. 书签的备份状态基于最后备份时间判断。
   Bookmark backup status is determined based on the last backup time.

3. 建议定期导出历史记录以防数据丢失。
   It's recommended to export history regularly to prevent data loss.

## 更新日志 / Changelog

### v2.0.1 (2024)
- ✨ 新增「当前 数量/结构 变化」视图作为首页 / Added "Current Changes" view as homepage
- 🌳 树状形式展示未备份的变化详情 / Display unbacked changes in tree structure
- 🗂️ 按文件夹分组显示新增/修改的书签 / Group bookmarks by folder
- 🔧 修复图标显示问题 / Fixed icon display issues
- 💬 添加工具按钮中英文说明气泡 / Added bilingual tooltips for tool buttons
- 🗑️ 移除导出 JSON/HTML 功能（简化界面）/ Removed JSON/HTML export features (simplified UI)
- 🔗 状态卡片点击直接跳转到当前变化视图 / Status card click now directly opens current changes view

### v2.0 (2024)
- ✨ 初始版本发布 / Initial release
- 🎨 Git 风格界面设计 / Git-style interface design
- 🌓 深色模式支持 / Dark mode support
- 🌐 中英文双语 / Bilingual (Chinese/English)
- 📱 响应式布局 / Responsive layout
- 🔍 搜索功能 / Search functionality
- 🌳 书签树视图 / Bookmark tree view
- 🔄 实时更新 / Real-time updates

## 反馈 / Feedback

如果您有任何问题或建议，欢迎通过以下方式联系：
If you have any questions or suggestions, please contact us through:

- GitHub Issues
- Email: [Your Email]

---

**开发者 / Developer:** kk1  
**版本 / Version:** 2.0  
**最后更新 / Last Updated:** 2024
