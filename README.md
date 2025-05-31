# Bookmark-Backup
书签备份（云端/本地，自动/手动，时间线，提醒）or Bookmark Backup (Cloud/Local, Auto/Manual, Timeline, Reminder)
[English](#english-version) | [中文](#chinese-version)

---

# <a name="chinese-version"></a>书签备份与提醒

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
