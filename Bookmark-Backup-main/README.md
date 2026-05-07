## Switch to [English](#english)

[![Linux.do](https://img.shields.io/badge/Linux.do-Portfolio-FFD700?logo=discourse&logoColor=white)](https://linux.do/u/kk1/activity/portfolio)
[![GitHub Releases](https://img.shields.io/github/v/release/kwenxu/Bookmark-Backup?logo=github&logoColor=white&label=GitHub+Releases)](https://github.com/kwenxu/Bookmark-Backup/releases)
[![Microsoft Edge Add-ons](https://img.shields.io/badge/Edge_Add--ons-Available-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/%E4%B9%A6%E7%AD%BE%E5%A4%87%E4%BB%BDbookmark-backup/klopopehpngheikchkjgkmplgmbfodek)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/dbdpgedioldmeooemjanbjlhgpocafbc?color=0F9D58&logo=googlechrome&logoColor=white&label=Chrome+Web+Store)](https://chromewebstore.google.com/detail/dbdpgedioldmeooemjanbjlhgpocafbc)

### 简介
`书签备份` 是一款面向 Chrome / Edge 的 Git 式书签版本管理、备份历史追踪与安全恢复扩展。

它把浏览器书签当作可持续留痕的版本资产：每次备份会形成带时间、指纹和快照数据的版本记录，既能保存完整书签树，也能记录当前变化与历史差异。你可以将这些版本同步到本地、WebDAV 或 GitHub 仓库，并在需要时按历史节点恢复、撤销或合并导入。

### 特色功能
- **多目标备份**：支持本地下载、WebDAV 云端和 GitHub 仓库备份，适合不同的数据保存习惯。
- **Git 式版本管理**：以时间、指纹和快照记录书签版本，围绕“当前变化—备份历史—安全恢复”形成可回溯时间线。
- **自动/手动备份**：可在书签变化后自动备份，也可以手动触发备份并配合提醒系统使用。
- **当前变化视图**：按数量、结构和内容变化查看当前书签与上次备份之间的差异。
- **备份历史时间线**：记录备份历史、备注、数据能力和可恢复状态，方便回溯与导出。
- **安全恢复体系**：支持覆盖恢复、补丁式恢复/撤销、合并导入，并在高风险操作前生成临时安全快照。
- **手动备份提醒**：在手动模式下结合书签变化状态、循环提醒、准点提醒和浏览器焦点状态提醒用户备份。
- **网页快照辅助**：提供基于 Chrome 官方 `pageCapture.saveAsMHTML` 的网页快照能力，并配合截图/录屏辅助工具用于页面留存。
- **升级兼容**：对 v2.1 旧历史记录和旧备份产物做兼容处理；没有快照数据的旧记录会作为可读日志保留。
- **中英文 + 主题切换**：支持中英文界面、明暗主题和浏览器主题跟随。

### 预览

#### 3.0 代码结构预览
```text
Bookmark-Backup-main/
|-- manifest.json                     [CORE] Manifest V3 配置、权限、后台入口与快捷键。
|-- background.js                     [CORE] 备份、恢复、历史、迁移、缓存、角标和消息中枢。
|-- popup.html / popup.js             [UI] 主弹窗：备份目标配置、状态、历史入口、初始化和设置。
|-- history_html/                     [UI] 备份历史、当前变化、书签树、搜索、恢复与安全快照页面。
|-- backup_reminder/                  [UI] 手动备份提醒窗口、提醒设置、通知生命周期与计时器。
|-- auto_backup_timer/                [CORE] 自动备份定时与相关设置存储。
|-- dev_1/                            [TOOLS] 网页快照、MHTML、截图、录屏和队列辅助能力。
|-- github/                           [SYNC] GitHub 仓库备份目标的 API 封装。
|-- _locales/                         [I18N] 中英文扩展名称、描述和工具栏标题。
|-- docs/PROJECT_STRUCTURE.md         [DOC] 更完整的项目结构说明。
\-- LICENSE                           [DOC] 开源许可。
```

### 主要视图
- **主界面**：配置本地、WebDAV、GitHub 仓库备份目标，查看书签统计、备份状态和快捷入口。
- **当前变化**：查看当前书签树相对备份基线的数量、结构和内容变化。
- **备份历史**：按时间线查看备份记录、备注、可恢复能力、导出与搜索。
- **恢复与安全快照**：从历史记录或安全快照执行恢复、撤销、合并导入等高风险操作。
- **网页快照**：将网页保存为 MHTML，并提供截图/录屏等辅助留存能力。

### 安装入口
- **GitHub Releases**：[下载发布包](https://github.com/kwenxu/Bookmark-Backup/releases)，适合手动安装或保留指定版本。
- **Microsoft Edge Add-ons**：[从 Edge 加载项安装](https://microsoftedge.microsoft.com/addons/detail/%E4%B9%A6%E7%AD%BE%E5%A4%87%E4%BB%BDbookmark-backup/klopopehpngheikchkjgkmplgmbfodek)。
- **Chrome Web Store**：[从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/dbdpgedioldmeooemjanbjlhgpocafbc)。

### 手动安装
- **下载发布包**：从 [GitHub Releases](https://github.com/kwenxu/Bookmark-Backup/releases) 下载发布版本。
- **打开扩展管理页**：进入 `chrome://extensions` 或 `edge://extensions`。
- **启用开发者模式**：打开右上角“开发者模式”。
- **加载扩展**：点击“加载已解压的扩展程序”，选择扩展程序根目录。

### 重要提示
- **WebDAV 配置**：请确认服务器地址、账号、密码或应用密码正确，并保持网络稳定。
- **本地备份限制**：浏览器扩展无法静默写入任意本地路径，本地备份会依赖浏览器默认下载目录。
- **曲线云端备份**：如需让本地备份同步到云盘，可将浏览器默认下载目录设置到云盘同步目录，或使用系统级文件夹同步/软链接方案。
- **大规模整理前建议**：导入、批量删除、大量移动或重组书签前，建议暂时关闭实时自动备份，完成后再手动备份。
- **恢复操作需谨慎**：覆盖恢复、撤销和补丁式恢复会写入浏览器书签树；执行前请确认目标记录，并保留安全快照。
- **v2.1 升级记录**：旧版中没有完整快照数据的历史记录会保留为日志/备注，不一定可直接恢复。

### 数据与隐私
- 核心设置、状态、历史索引和缓存数据保存在浏览器本地存储中。
- WebDAV 和 GitHub 仓库备份只会写入用户自行配置的目标位置。
- 扩展会请求书签、存储、下载、标签页、窗口、网页捕获等权限，以实现备份、恢复、快照和辅助工具能力。
- favicon、网页快照和导出文件会根据用户操作生成或缓存，请按自己的隐私需求管理备份目标和下载目录。
- 详细的隐私处理原则与权限说明请参阅 [隐私政策](PRIVACY_POLICY.md)。

### 相关文档
- [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)：项目结构与主要模块说明。
- [`docs/LIMITATIONS_AND_COMPROMISES.md`](docs/LIMITATIONS_AND_COMPROMISES.md)：浏览器限制、功能妥协与防干扰说明。
- [`docs/other docs/`](docs/other%20docs/)：包含各个版本的详细设计文档、历史审计及开发计划（如 v2.1 到 v3.0 升级兼容计划、恢复事务与安全快照设计等）。

---

<a id="english"></a>

## English

### Overview
`Bookmark Backup` is a Git-style bookmark versioning, backup-history tracking, and safety-recovery extension for Chrome / Edge.

It treats the browser bookmark tree as a versioned asset. Each backup creates a time-stamped, fingerprinted snapshot/history record that can preserve the full bookmark tree and track current changes against historical states. These versions can be synced to local storage, WebDAV, or a GitHub repository, then used later for restore, revert, or import-merge workflows.

### Highlights
- **Multiple backup targets**: local downloads, WebDAV cloud storage, and GitHub repository backup.
- **Git-style versioning**: time-stamped, fingerprinted snapshot records build a traceable timeline around current changes, backup history, and safety recovery.
- **Automatic and manual backup**: back up after bookmark changes or trigger backups manually with reminders.
- **Current changes view**: inspect quantity, structure, and content differences from the last backup baseline.
- **Backup history timeline**: review backup records, notes, restore capability, export options, and searchable history.
- **Safety recovery system**: overwrite restore, patch restore/revert, import merge, and temporary safety snapshots before high-risk writes.
- **Manual backup reminders**: cyclic and fixed-time reminders that react to actual bookmark changes and browser focus state.
- **Web snapshot helper**: MHTML snapshots through Chrome’s official `pageCapture.saveAsMHTML` API, with screenshot/recording helper tools.
- **Upgrade compatibility**: legacy v2.1 history and backup artifacts are handled where possible; record-only entries remain readable as logs.
- **Bilingual UI + themes**: Chinese/English UI, light/dark themes, and browser theme following.

### Preview

#### Screenshots
| Main UI | Setup & Initialization |
| :---: | :---: |
| <img src="../Screenshots%20and%20icons/v3.0/主UI%20en.png" width="400"> | <img src="../Screenshots%20and%20icons/v3.0/设置与初始化%20en.png" width="400"> |
| **Current Changes** | **Backup History** |
| <img src="../Screenshots%20and%20icons/v3.0/当前变化html%20en.png" width="400"> | <img src="../Screenshots%20and%20icons/v3.0/备份历史html%20en.png" width="400"> |

#### 3.0 Code Structure Preview
```text
Bookmark-Backup-main/
|-- manifest.json                     [CORE] Manifest V3 config, permissions, background entry, and commands.
|-- background.js                     [CORE] Backup, restore, history, migration, cache, badge, and message hub.
|-- popup.html / popup.js             [UI] Main popup: target setup, status, history entries, initialization, and settings.
|-- history_html/                     [UI] Backup history, current changes, bookmark tree, search, restore, and safety snapshots.
|-- backup_reminder/                  [UI] Manual backup reminders, reminder settings, notification lifecycle, and timers.
|-- auto_backup_timer/                [CORE] Automatic backup timing and related setting storage.
|-- dev_1/                            [TOOLS] Web snapshot, MHTML, screenshot, recording, and queue helper tools.
|-- github/                           [SYNC] GitHub repository backup API wrapper.
|-- _locales/                         [I18N] Chinese/English extension name, description, and action title.
|-- docs/PROJECT_STRUCTURE.md         [DOC] More complete project structure notes.
\-- LICENSE                           [DOC] Open-source license.
```

### Main Views
- **Main popup**: configure local, WebDAV, and GitHub backup targets; view bookmark stats, backup status, and shortcuts.
- **Current changes**: inspect changes between the current bookmark tree and the backup baseline.
- **Backup history**: browse timeline records, notes, restore capability, exports, and search.
- **Recovery and safety snapshots**: restore, revert, merge, or recover from safety snapshots.
- **Web snapshot**: save pages as MHTML and use screenshot/recording helpers when needed.

### Install Links
- **GitHub Releases**: [download release packages](https://github.com/kwenxu/Bookmark-Backup/releases) for manual installation or version pinning.
- **Microsoft Edge Add-ons**: [install from Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/%E4%B9%A6%E7%AD%BE%E5%A4%87%E4%BB%BDbookmark-backup/klopopehpngheikchkjgkmplgmbfodek).
- **Chrome Web Store**: [install from Chrome Web Store](https://chromewebstore.google.com/detail/dbdpgedioldmeooemjanbjlhgpocafbc).

### Manual Installation
- **Download a release package**: get a release from [GitHub Releases](https://github.com/kwenxu/Bookmark-Backup/releases).
- **Open the extension page**: go to `chrome://extensions` or `edge://extensions`.
- **Enable developer mode**: turn on “Developer mode”.
- **Load the extension**: click “Load unpacked” and select the extension root directory.

### Important Notes
- **WebDAV setup**: make sure the server address, username, password/app password, and network connection are correct.
- **Local backup limitation**: browser extensions cannot silently write to arbitrary local paths; local backup depends on the browser’s default download folder.
- **Cloud-sync workaround**: set the browser’s default download folder to a cloud-drive sync folder, or use system-level folder sync/symlink strategies.
- **Before large reorganizations**: consider disabling real-time automatic backup before import, bulk deletion, large moves, or major bookmark restructuring.
- **Restore with care**: overwrite restore, revert, and patch restore write to the browser bookmark tree; verify the target record and keep safety snapshots.
- **v2.1 upgrade records**: legacy history entries without full snapshot data are kept as readable logs/notes and may not be directly restorable.

### Data & Privacy
- Core settings, states, history indexes, and caches are stored in browser local storage.
- WebDAV and GitHub backups are written only to targets configured by the user.
- Permissions include bookmarks, storage, downloads, tabs, windows, page capture, and related APIs to support backup, restore, snapshot, and helper features.
- Favicons, web snapshots, and exported files may be generated or cached according to user actions; manage backup targets and download folders according to your privacy needs.
- Please refer to the [Privacy Policy](PRIVACY_POLICY.md) for detailed principles and permission justifications.

### Docs
- [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md): project structure and main module notes.
- [`docs/LIMITATIONS_AND_COMPROMISES.md`](docs/LIMITATIONS_AND_COMPROMISES.md): browser limitations, compromises, and download anti-disturbance notes.
- [`docs/other docs/`](docs/other%20docs/): contains detailed design documents, historical audits, and development plans (e.g., v2.1 to v3.0 local upgrade compatibility plan, restore transaction design notes).

---

## License

MIT. See [LICENSE](LICENSE).

## [Back to top](#switch-to-english)
