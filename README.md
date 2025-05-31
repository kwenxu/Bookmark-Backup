# Bookmark-Backup
书签备份（云端/本地，自动/手动，时间线，提醒）or Bookmark Backup (Cloud/Local, Auto/Manual, Timeline, Reminder)
[English](#english-version) | [中文](#chinese-version)

---

# <a name="chinese-version"></a>书签备份与提醒

## 项目概述

书签备份与提醒是一款 Chrome/Edge 浏览器扩展程序，旨在提供强大且灵活的书签管理功能。它通过提供多种备份选项（云端/本地、自动/手动）、完善的手动备份提醒系统、智能的活动状态检测和崩溃恢复机制，确保您宝贵的书签数据安全无忧。

## 功能特性

**1. 全面的书签备份：**

*   **多种备份目的地：**
    *   **云端备份：** 安全地将您的书签备份到您首选的支持 WebDAV 的云存储服务（例如：坚果云、Nextcloud）。
    *   **本地备份：** 将您的书签以 HTML 文件形式保存到您的本地计算机。
*   **灵活的备份模式：**
    *   **实时自动备份：** 当检测到书签发生更改（添加、删除、修改、移动）时，扩展程序会自动备份您的书签。在进行大规模书签整理时，建议暂时禁用此功能，以避免不必要的频繁备份。
    *   **手动备份：** 只需单击一下，即可立即备份当前的书签状态。
*   **备份历史与时间线：** （如果此功能在基本日志记录之外得到充分开发，具体细节待从具体实现中确认）扩展程序会记录备份操作，可能允许您跟踪不同时间的备份版本。当前实现在弹出窗口中包含可查看的同步操作历史记录。
*   **备份内容：**
    *   完整备份您的书签和文件夹结构。
    *   不计算和备份浏览器的根书签文件夹（例如："书签栏"、"其他书签"、"移动书签"）。

**2. 智能备份提醒系统：**

*   **智能提醒激活：** 当"实时自动备份"被禁用，且扩展程序处于手动备份模式时，将启动提醒计时器。
*   **多阶段提醒（可自定义）：**
    *   **第1次提醒：** 默认：切换到手动模式后 **10 分钟**。
    *   **第2次提醒：** 默认：第1次提醒后未进行手动备份则 **30 分钟** 后提醒。
    *   **第3次提醒：** 默认：第2次提醒后未进行手动备份则 **120 分钟** 后提醒。
    *   **重复提醒：** 默认：第3次提醒后未进行手动备份则每隔 **2 天** 提醒一次。
    *   所有时间均可在"手动备份提醒设置"中完全自定义。
*   **全局提醒开关：** 设置中的主开关，用于启用或禁用整个手动备份提醒系统。
*   **提醒通知窗口：**
    *   **内容：** 显示上次备份的时间、当前书签/文件夹数量、一条指示当前为手动备份模式及自上次备份以来经过的时间的消息，以及到下一提醒阶段的倒计时。
    *   **操作：**
        *   **"切换为自动备份"：** 重新启用实时自动备份并停止提醒计时器。
        *   **"立即手动备份"：** 执行立即手动备份，并进入下一提醒阶段或重复间隔。
        *   **"设置"：** 打开"手动备份提醒设置"页面。
        *   **"关闭" (X)：** 关闭通知（手动或30秒后超时）也将进入下一提醒阶段或重复间隔。
    *   **位置：** 出现在浏览器的右上角。

**3. 智能状态与会话管理：**

*   **活动状态检测 (`chrome.idle` API)：**
    *   当浏览器变为空闲时（例如，用户离开计算机），手动备份提醒计时器将暂停。
    *   当浏览器再次变为活动状态时，计时器将从暂停处继续。
*   **崩溃恢复 (`chrome.alarms` API)：**
    *   利用 `chrome.alarms` API 精确安排提醒。
    *   如果浏览器崩溃或未正常关闭，扩展程序将在浏览器重启时恢复之前的备份模式（自动/手动）和提醒计时器状态，确保提醒的连续性。
*   **计时器与状态优先级：**
    *   最新的用户操作决定计时器状态；新的计时器启动会覆盖现有的计时器。
    *   自动备份模式下没有活动的提醒或计时器。从自动模式切换到手动模式时，计时器会启动（或从第一阶段重新启动）。
    *   执行手动备份（通过主界面或通知）会重置当前提醒阶段并进入下一阶段。
    *   关闭提醒通知也会重置并进入下一阶段。

**4. 直观的用户界面 (UI) 与用户体验 (UX)：**

*   **扩展程序图标角标：**
    *   在自动备份模式下显示"自"（中文）或"A"（英文）。
    *   在手动备份模式下显示"手"（中文）或"M"（英文）。
    *   如果发生错误则显示"!"。
    *   角标文本根据所选界面语言（中文/英文）自适应。
*   **书签与文件夹数量显示：** 弹出界面会显示当前书签和文件夹的数量。
*   **上次备份信息：** 显示上次成功备份的时间和状态。
*   **初始化流程：** 处理首次运行设置和必要的配置。
*   **"手动备份提醒设置"页面：**
    *   **区块一：提醒总开关：** 启用/禁用整个提醒功能。
    *   **区块二：提醒时间配置：** 2x2 布局，用于设置第1、2、3次提醒的时间（分钟）和重复提醒的间隔（天）。
    *   **区块三：操作按钮：**
        *   **"恢复默认"：** 将所有提醒时间重置为其默认值。
        *   **"保存设置"：** 保存自定义时间，成功后提供视觉反馈，并从第一阶段重新启动提醒周期。
    *   **"关闭"按钮：**位于设置页面右上角，与标题对齐。
*   **视觉反馈：** 为手动备份和模式切换等操作提供加载指示器和成功/失败消息。反馈消息显示约0.7秒。
*   **主题支持：** 包括浅色和深色模式主题，可适应系统偏好或手动选择。

## 技术细节

*   **核心 API 使用：**
    *   `chrome.bookmarks`: 用于访问和操作书签数据。
    *   `chrome.storage`: 用于存储扩展程序的设置和状态。
    *   `chrome.idle`: 用于检测浏览器活动状态。
    *   `chrome.alarms`: 用于精确安排提醒和崩溃恢复。
    *   `chrome.notifications` / `chrome.windows.create`: 用于创建提醒通知窗口。
    *   `chrome.downloads` & `chrome.downloads.shelf`: 用于管理本地备份文件下载并可选择隐藏下载栏。
*   **关键脚本文件：**
    *   `manifest.json`: 定义扩展程序的属性、权限和入口点。
    *   `background.js`: 处理所有后台逻辑，包括备份过程、同步操作、状态管理、事件监听和提醒调度。
    *   `popup.js`: 管理扩展程序弹出窗口中的UI和交互。
    *   `popup.html`: 扩展程序弹出窗口的HTML结构。
    *   `theme.js`: 管理浅色/深色主题切换。
    *   `backup_reminder/` 目录: 包含备份提醒功能特有的模块 (例如: `index.js`, `timer.js`, `notification_popup.html`, `settings.html`)。

## 安装指南

1.  **从 Chrome 网上应用店 / Edge 加载项商店安装：**
    *   （发布后添加链接）
2.  **手动安装（开发者模式）：**
    *   下载或克隆此代码仓库。
    *   打开 Chrome/Edge 浏览器，导航至 `chrome://extensions` 或 `edge://extensions`。
    *   启用"开发者模式"。
    *   点击"加载已解压的扩展程序"，然后选择 `21.5_副本` 目录（或扩展程序的根目录）。

## 使用说明

1.  安装后，点击浏览器工具栏中的扩展程序图标以打开主弹出窗口。
2.  **初始设置（推荐用于云备份）：**
    *   在弹出窗口中，导航至 WebDAV 配置部分。
    *   输入您的 WebDAV 服务器 URL、用户名和密码。保存配置。
    *   启用 WebDAV 备份。
3.  **本地备份配置（可选）：**
    *   配置本地备份设置，例如所需的默认下载路径。
    *   启用本地备份。
4.  **选择备份模式：**
    *   如果配置并启用了有效的备份目标（WebDAV 或本地），则默认启用"实时自动备份"。
    *   要切换到手动备份，请关闭"实时自动备份"。"手动备份"按钮将变为活动状态，并且提醒系统将根据您的设置启动。
5.  **自定义备份提醒（可选）：**
    *   点击主弹出窗口中的"手动备份提醒设置"按钮（通常由与提醒状态相关的齿轮或铃铛图标指示）。
    *   根据需要调整提醒时间和重复间隔。
    *   如果您希望禁用/启用所有提醒，请切换提醒总开关。
    *   保存您的设置。

## 重要提示

*   在执行大规模书签操作（导入、导出、大量重组）时，建议暂时禁用"实时自动备份"。完成后执行一次手动备份，然后重新启用自动备份。
*   确保您的 WebDAV 服务器详细信息正确且互联网连接稳定，以成功进行云备份。
*   如果您遇到通知问题，请检查您的浏览器和操作系统通知设置，以确保已为此扩展程序授予权限。

## 贡献代码

欢迎提交 问题 (issues) 和功能请求 (feature requests)！请随时查看 [问题页面](<YOUR_GITHUB_REPO_URL>/issues)。

## 开源许可

（请在此处指定您选择的开源许可证，例如 MIT, Apache 2.0。如果您在选择方面需要帮助，请访问 [https://choosealicense.com/](https://choosealicense.com/)）

---

感谢您使用书签备份与提醒工具！

---

# <a name="english-version"></a>Bookmark Backup & Reminder

## Overview

Bookmark Backup & Reminder is a Chrome/Edge browser extension designed to provide robust and flexible bookmark management. It ensures your valuable bookmark data is safe by offering multiple backup options (cloud/local, automatic/manual), a sophisticated reminder system for manual backups, intelligent activity detection, and a crash recovery mechanism.

## Features

**1. Comprehensive Bookmark Backup:**

*   **Multiple Backup Destinations:**
    *   **Cloud Backup:** Securely back up your bookmarks to your preferred WebDAV-enabled cloud storage service (e.g., Nutstore, Nextcloud).
    *   **Local Backup:** Save your bookmarks as an HTML file to your local computer.
*   **Flexible Backup Modes:**
    *   **Real-time Automatic Backup:** The extension automatically backs up your bookmarks whenever changes (additions, deletions, modifications, moves) are detected. It's recommended to temporarily disable this during large-scale bookmark organization to avoid frequent, potentially unnecessary backups.
    *   **Manual Backup:** Instantly back up your current bookmark state with a single click.
*   **Backup History & Timeline:** (Further details to be confirmed from specific implementation if this feature is fully developed beyond basic logging) The extension logs backup operations, potentially allowing you to track backup versions over time. Current implementation includes a viewable history of sync operations within the popup.
*   **Backup Content:**
    *   Complete backup of your bookmark and folder structure.
    *   Excludes the browser's root bookmark folders from calculations and backups (e.g., "Bookmarks Bar", "Other Bookmarks", "Mobile Bookmarks").

**2. Intelligent Backup Reminder System:**

*   **Smart Reminder Activation:** When "Real-time Automatic Backup" is disabled, and the extension is in manual backup mode, a reminder timer is initiated.
*   **Multi-Stage Reminders (Customizable):**
    *   **1st Reminder:** Default: **10 minutes** after switching to manual mode.
    *   **2nd Reminder:** Default: **30 minutes** if no manual backup after the 1st reminder.
    *   **3rd Reminder:** Default: **120 minutes** if no manual backup after the 2nd reminder.
    *   **Recurring Reminders:** Default: Every **2 days** if no manual backup after the 3rd reminder.
    *   All timings are fully customizable in the "Manual Backup Reminder Settings."
*   **Global Reminder Toggle:** A master switch in settings to enable or disable the entire manual backup reminder system.
*   **Reminder Notification Window:**
    *   **Content:** Displays the time of the last backup, current bookmark/folder counts, a message indicating manual backup mode and time elapsed since the last backup, and the countdown to the next reminder stage.
    *   **Actions:**
        *   **"Switch to Auto Backup":** Re-enables real-time automatic backup and stops the reminder timer.
        *   **"Backup Manually Now":** Performs an immediate manual backup and proceeds to the next reminder stage or recurring interval.
        *   **"Settings":** Opens the "Manual Backup Reminder Settings" page.
        *   **"Close" (X):** Dismissing the notification (manually or via timeout after 30 seconds) also proceeds to the next reminder stage or recurring interval.
    *   **Position:** Appears in the top-right corner of the browser.

**3. Smart State & Session Management:**

*   **Activity Detection (`chrome.idle` API):**
    *   The manual backup reminder timer pauses when the browser becomes idle (e.g., user is away from the computer).
    *   The timer resumes from where it left off when the browser becomes active again.
*   **Crash Recovery (`chrome.alarms` API):**
    *   Utilizes the `chrome.alarms` API for precise scheduling of reminders.
    *   If the browser crashes or is improperly closed, the extension restores the previous backup mode (auto/manual) and reminder timer state upon browser restart, ensuring reminder continuity.
*   **Timer & State Prioritization:**
    *   The most recent user action dictates the timer state; new timer initiations override existing ones.
    *   No reminders or timers are active in automatic backup mode. Timers start (or restart from the 1st stage) when switching from automatic to manual mode.
    *   Performing a manual backup (via main UI or notification) resets the current reminder stage and proceeds to the next.
    *   Closing a reminder notification also resets and proceeds to the next stage.

**4. Intuitive User Interface (UI) & Experience (UX):**

*   **Extension Icon Badge:**
    *   Displays "自" (Auto) or "A" when in automatic backup mode.
    *   Displays "手" (Manual) or "M" when in manual backup mode.
    *   Displays "!" if an error occurs.
    *   Badge text adapts based on the selected UI language (Chinese/English).
*   **Bookmark & Folder Count Display:** The popup UI shows the current number of bookmarks and folders.
*   **Last Backup Information:** Displays the time and status of the last successful backup.
*   **Initialization Flow:** Handles first-run setup and necessary configurations.
*   **"Manual Backup Reminder Settings" Page:**
    *   **Section 1: Master Reminder Switch:** Enables/disables the entire reminder feature.
    *   **Section 2: Reminder Timing Configuration:** A 2x2 layout to set times (in minutes) for the 1st, 2nd, 3rd reminders, and interval (in days) for recurring reminders.
    *   **Section 3: Action Buttons:**
        *   **"Restore Defaults":** Resets all reminder timings to their default values.
        *   **"Save Settings":** Saves custom timings, provides visual feedback on success, and restarts the reminder cycle from the 1st stage.
    *   **"Close" Button:** Positioned at the top-right of the settings page, aligned with the title.
*   **Visual Feedback:** Provides loading indicators and success/failure messages for operations like manual backup and mode switching. Feedback messages are displayed for approximately 0.7 seconds.
*   **Theme Support:** Includes light and dark mode themes, adapting to system preferences or manual selection.

## Technical Details

*   **Core APIs Used:**
    *   `chrome.bookmarks`: For accessing and manipulating bookmark data.
    *   `chrome.storage`: For storing extension settings and state.
    *   `chrome.idle`: For detecting browser activity status.
    *   `chrome.alarms`: For precise scheduling of reminders and crash recovery.
    *   `chrome.notifications` / `chrome.windows.create`: For creating reminder notification windows.
    *   `chrome.downloads` & `chrome.downloads.shelf`: For managing local backup file downloads and optionally hiding the download shelf.
*   **Key Script Files:**
    *   `manifest.json`: Defines extension properties, permissions, and entry points.
    *   `background.js`: Handles all background logic, including backup processes, sync operations, state management, event listening, and reminder orchestration.
    *   `popup.js`: Manages the UI and interactions within the extension's popup window.
    *   `popup.html`: The HTML structure for the extension's popup.
    *   `theme.js`: Manages light/dark theme switching.
    *   `backup_reminder/` directory: Contains modules專specific to the backup reminder functionality (e.g., `index.js`, `timer.js`, `notification_popup.html`, `settings.html`).

## Installation

1.  **From Chrome Web Store / Edge Add-ons:**
    *   (Link to be added once published)
2.  **Manual Installation (Developer Mode):**
    *   Download or clone this repository.
    *   Open Chrome/Edge, navigate to `chrome://extensions` or `edge://extensions`.
    *   Enable "Developer mode".
    *   Click "Load unpacked" and select the `21.5_副本` directory (or the root directory of the extension).

## Usage Guide

1.  After installation, click the extension icon in your browser toolbar to open the main popup.
2.  **Initial Setup (Recommended for Cloud Backup):**
    *   In the popup, navigate to the WebDAV configuration section.
    *   Enter your WebDAV server URL, username, and password. Save the configuration.
    *   Enable WebDAV backup.
3.  **Local Backup Configuration (Optional):**
    *   Configure local backup settings, such as the default download path if desired.
    *   Enable local backup.
4.  **Choose Backup Mode:**
    *   "Real-time Automatic Backup" is enabled by default if a valid backup destination (WebDAV or Local) is configured and enabled.
    *   To switch to manual backups, toggle off "Real-time Automatic Backup." The "Manual Backup" button will become active, and the reminder system will engage based on your settings.
5.  **Customize Backup Reminders (Optional):**
    *   Click the "Manual Backup Reminder Settings" button in the main popup (often indicated by a gear or bell icon associated with the reminder status).
    *   Adjust the reminder timings and recurring interval as needed.
    *   Toggle the master reminder switch if you wish to disable/enable all reminders.
    *   Save your settings.

## Important Notes

*   When performing large-scale bookmark operations (importing, exporting, extensive reorganization), it's advisable to temporarily disable "Real-time Automatic Backup." Perform a manual backup once completed, and then re-enable automatic backup.
*   Ensure your WebDAV server details are correct and your internet connection is stable for successful cloud backups.
*   If you encounter issues with notifications, check your browser and operating system notification settings to ensure permissions are granted for this extension.

## Contributing

Contributions, issues, and feature requests are welcome! Please feel free to check the [issues page](<YOUR_GITHUB_REPO_URL>/issues).

## License

(Please specify your chosen open-source license here, e.g., MIT, Apache 2.0. If you need help choosing, visit [https://choosealicense.com/](https://choosealicense.com/))

---

Thank you for using Bookmark Backup & Reminder! 
---

Thank you for using Bookmark Backup & Reminder!
