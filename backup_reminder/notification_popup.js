// =======================================================
// 浏览器兼容性处理
// =======================================================
/**
 * 获取浏览器兼容的API对象。
 * @returns {object} 浏览器API对象 (chrome 或 browser)。
 */
const browserAPI = (function() {
    if (typeof chrome !== 'undefined') {
        if (typeof browser !== 'undefined') {
            // Firefox 环境
            return browser;
        }
        // Chrome, Edge 环境
        return chrome;
    }
    throw new Error('不支持的浏览器');
})();

// =======================================================
// 主题相关常量与函数
// =======================================================
/**
 * 主题类型枚举。
 * @enum {string}
 */
const ThemeType = {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system'
};

/**
 * 获取系统主题偏好。
 * @returns {ThemeType} 系统主题偏好。
 */
function getSystemThemePreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ?
        ThemeType.DARK : ThemeType.LIGHT;
}

/**
 * 从本地存储加载主题设置。
 * @returns {ThemeType} 加载到的主题偏好，默认为 SYSTEM。
 */
function loadThemePreference() {
    try {
        return localStorage.getItem('themePreference') || ThemeType.SYSTEM;
    } catch (e) {
        console.error('无法加载主题偏好:', e);
        return ThemeType.SYSTEM;
    }
}

/**
 * 应用主题到文档。
 */
function applyTheme() {
    const savedTheme = loadThemePreference();
    const actualTheme = savedTheme === ThemeType.SYSTEM ?
        getSystemThemePreference() : savedTheme;

    document.documentElement.removeAttribute('data-theme'); // 移除所有可能的主题类

    if (actualTheme === ThemeType.DARK) {
        document.documentElement.setAttribute('data-theme', 'dark'); // 应用深色主题
    }
}

// =======================================================
// 国际化文本常量
// =======================================================
// 提醒设置相关国际化文本
const reminderSettingsStrings = { 'zh_CN': "动态提醒设置", 'en': "Reminder Settings" };
const cyclicReminderStrings = { 'zh_CN': "循环提醒", 'en': "Cyclic Reminder" };
const minutesUnitStrings = { 'zh_CN': "分钟", 'en': "minutes" };
const fixedTime1Strings = { 'zh_CN': "准点定时1", 'en': "Fixed Time 1" };
const fixedTime2Strings = { 'zh_CN': "准点定时2", 'en': "Fixed Time 2" };
const manualBackupReminderDescStrings = { 'zh_CN': "手动备份下，进行操作（数量/结构变化）才会提醒", 'en': "Reminders only trigger after changes (quantity/structure)" };
const reminderExampleStrings = { 'zh_CN': "示例：(<span style=\"color: #4CAF50;\">+12</span> 书签，<span style=\"color: #4CAF50;\">+1</span> 文件夹，<span style=\"color: orange;\">书签、文件夹变动</span>)", 'en': "Example: (<span style=\"color: #4CAF50;\">+12</span> bookmarks, <span style=\"color: #4CAF50;\">+1</span> folder, <span style=\"color: orange;\">bookmarks & folders changed</span>)" };
const restoreDefaultStrings = { 'zh_CN': "恢复默认", 'en': "Restore Default" };
const saveSettingsStrings = { 'zh_CN': "保存设置", 'en': "Save Settings" };
const settingsSavedStrings = { 'zh_CN': "设置已保存", 'en': "Settings saved" };
const restoreDefaultSettingsDoneStrings = { 'zh_CN': "已恢复默认设置", 'en': "Default settings restored" };
const cyclicReminderLabelStrings = { 'zh_CN': "循环提醒：", 'en': "Cyclic Reminder:" };
const fixedTime1LabelStrings = { 'zh_CN': "准点定时1：", 'en': "Fixed Time 1:" };
const fixedTime2LabelStrings = { 'zh_CN': "准点定时2：", 'en': "Fixed Time 2:" };

// 通知窗口UI文本国际化
const notificationTitleStrings = { 'zh_CN': "书签备份提醒", 'en': "Bookmark Backup Reminder" };
const testNotificationTitleStrings = { 'zh_CN': "书签备份提醒(测试)", 'en': "Bookmark Backup Reminder(Test)" };
const fixedTimeNotificationTitleStrings = { 'zh_CN': "准点定时提醒", 'en': "Fixed Time Reminder" };
const lastChangeStrings = { 'zh_CN': "上次变动：", 'en': "Last Change:" };
const noBackupRecordStrings = { 'zh_CN': "暂无备份记录", 'en': "No backup record yet" };
const currentQuantityStrings = { 'zh_CN': "当前数量/结构：", 'en': "Current Stats:" };
const bookmarksStrings = { 'zh_CN': "书签", 'en': "bookmarks" };
const bookmarkSingularString = { 'en': "bookmark" };
const foldersStrings = { 'zh_CN': "文件夹", 'en': "folders" };
const folderSingularString = { 'en': "folder" };
const backupSuggestionStrings = { 'zh_CN': "建议您立即备份书签，\n或重新开启自动备份功能以确保数据安全。", 'en': "It is recommended to backup your bookmarks now,\nor re-enable auto backup to ensure data security." };
const settingsButtonStrings = { 'zh_CN': "设置", 'en': "Settings" };
const toggleAutoBackupStrings = { 'zh_CN': "切换自动备份", 'en': "Toggle Auto Backup" };
const backupNowStrings = { 'zh_CN': "立即备份", 'en': "Backup Now" };
const bookmarksChangedStrings = { 'zh_CN': "书签变动", 'en': "Bookmark changed" };
const foldersChangedStrings = { 'zh_CN': "文件夹变动", 'en': "Folder changed" };
const bookmarksAndFoldersChangedStrings = { 'zh_CN': "书签、文件夹变动", 'en': "Bookmark & Folder changed" };

// 操作状态消息国际化
const statusStrings = {
    backupSuccess: { 'zh_CN': "备份成功", 'en': "Backup successful" },
    autoBackupEnabled: { 'zh_CN': "自动备份已启用", 'en': "Auto backup enabled" },
    backupFailed: { 'zh_CN': "备份失败", 'en': "Backup failed" },
    networkError: { 'zh_CN': "网络错误，请检查连接", 'en': "Network error, please check your connection" },
    autoBackupFailed: { 'zh_CN': "启用自动备份失败", 'en': "Failed to enable auto backup" },
    unknownError: { 'zh_CN': "未知错误", 'en': "Unknown error" },
    backupInProgress: { 'zh_CN': "正在进行备份...", 'en': "Backup in progress..." },
    settingsSaved: { 'zh_CN': "设置已保存", 'en': "Settings saved" },
    savingSettingsFailed: { 'zh_CN': "保存设置失败", 'en': "Failed to save settings" },
    unknownTime: { 'zh_CN': "未知时间", 'en': "Unknown time" },
    switchToAutoBackup: { 'zh_CN': "已切换至自动备份", 'en': "Auto backup enabled" },
    detectingChangesBackingUp: { 'zh_CN': "检测到修改，正在为您备份...", 'en': "Changes detected, backing up..." },
    requestBackupFailed: { 'zh_CN': "请求备份失败", 'en': "Backup request failed" },
    manualBackupCompleted: { 'zh_CN': "手动备份已完成", 'en': "Manual backup completed" }
};

// =======================================================
// 全局变量与状态
// =======================================================
let currentLang = 'zh_CN'; // 默认中文语言
window.isClosing = false; // 全局标记，指示窗口是否正在关闭

// =======================================================
// 辅助函数
// =======================================================

/**
 * 格式化日期时间。
 * @param {number|string} timestamp - 时间戳或日期字符串。
 * @returns {string} 格式化后的日期时间字符串。
 */
function formatDateTime(timestamp) {
    try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) {
            return statusStrings.unknownTime[currentLang] || statusStrings.unknownTime['zh_CN'];
        }
        return date.toLocaleString(); // 使用系统标准的时间格式
    } catch (error) {
        console.error('格式化时间失败:', error);
        return statusStrings.unknownTime[currentLang] || statusStrings.unknownTime['zh_CN'];
    }
}

/**
 * 解析并格式化变化描述字符串，添加颜色高亮。
 * @param {string} description - 类似 "(+8 书签，+2 文件夹，书签变动，文件夹变动)"。
 * @returns {string} - 包含高亮HTML的字符串。
 */
function formatChangeDescription(description) {
    if (!description || typeof description !== 'string') {
        return '';
    }

    const content = description.replace(/^\(|\)$/g, '');
    const parts = content.split('，').map(p => p.trim()).filter(p => p);

    let quantityParts = []; // 用于保存数量变化部分
    let hasBookmarksChanged = false;
    let hasFoldersChanged = false;
    let structuralChangeParts = []; // 用于保存结构变化部分

    parts.forEach(part => {
        const numMatch = part.match(/^([+-]\d+)\s+(书签|文件夹)$/);
        if (numMatch) {
            const number = parseInt(numMatch[1], 10);
            const sign = number > 0 ? "+" : "";
            const color = number > 0 ? "#4CAF50" : (number < 0 ? "#F44336" : "#777777");
            let type = numMatch[2];

            if (currentLang === 'en') {
                if (type === "书签") {
                    type = (Math.abs(number) === 1) ? bookmarkSingularString['en'] : bookmarksStrings['en'];
                } else if (type === "文件夹") {
                    type = (Math.abs(number) === 1) ? folderSingularString['en'] : foldersStrings['en'];
                }
            } else {
                if (type === "书签") {
                    type = bookmarksStrings['zh_CN'];
                } else if (type === "文件夹") {
                    type = foldersStrings['zh_CN'];
                }
            }
            quantityParts.push(`<span style="color: ${color}; font-weight: bold;">${sign}${number}</span> ${type}`);
        } else if (part === "书签变动") {
            hasBookmarksChanged = true;
        } else if (part === "文件夹变动") {
            hasFoldersChanged = true;
        } else {
            quantityParts.push(part);
        }
    });

    if (hasBookmarksChanged && hasFoldersChanged) {
        const text = bookmarksAndFoldersChangedStrings[currentLang] || bookmarksAndFoldersChangedStrings['zh_CN'];
        structuralChangeParts.push(`<span style="color: orange; font-weight: bold;">${text}</span>`);
    } else {
        if (hasBookmarksChanged) {
            const text = bookmarksChangedStrings[currentLang] || bookmarksChangedStrings['zh_CN'];
            structuralChangeParts.push(`<span style="color: orange; font-weight: bold;">${text}</span>`);
        }
        if (hasFoldersChanged) {
            const text = foldersChangedStrings[currentLang] || foldersChangedStrings['zh_CN'];
            structuralChangeParts.push(`<span style="color: orange; font-weight: bold;">${text}</span>`);
        }
    }

    const separator = currentLang === 'zh_CN' ? '，' : ', ';
    let result = '';

    if (quantityParts.length > 0) {
        result += `(${quantityParts.join(separator)})`;
        if (structuralChangeParts.length > 0) {
            result += '<br>';
        }
    }

    if (structuralChangeParts.length > 0) {
        result += `(${structuralChangeParts.join(separator)})`;
    }
    return result;
}

/**
 * 显示操作状态消息。
 * @param {string} message - 消息内容。
 * @param {'success' | 'error' | 'warning'} type - 消息类型。
 */
function showOperationStatus(message, type) {
    const operationStatusElement = document.getElementById('operationStatus');
    if (!operationStatusElement) return;

    operationStatusElement.textContent = message;
    operationStatusElement.classList.remove('success', 'error', 'warning');
    operationStatusElement.classList.add('operation-status', type);

    operationStatusElement.style.opacity = '0';
    operationStatusElement.style.transform = 'translateY(-10px)';
    operationStatusElement.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out';

    switch (type) {
        case 'success':
            operationStatusElement.style.color = 'var(--theme-success-color, #2e7d32)';
            operationStatusElement.style.backgroundColor = 'var(--theme-status-success-bg, #e8f5e9)';
            operationStatusElement.style.borderColor = 'var(--theme-status-success-border, #c8e6c9)';
            break;
        case 'error':
            operationStatusElement.style.color = 'var(--theme-error-color, #c62828)';
            operationStatusElement.style.backgroundColor = 'var(--theme-status-error-bg, #ffebee)';
            operationStatusElement.style.borderColor = 'var(--theme-status-error-border, #ffcdd2)';
            break;
        case 'warning':
            operationStatusElement.style.color = 'var(--theme-warning-color, #e65100)';
            operationStatusElement.style.backgroundColor = 'var(--theme-status-warning-bg, #fff3e0)';
            operationStatusElement.style.borderColor = 'var(--theme-status-warning-border, #ffe0b2)';
            break;
        default:
            operationStatusElement.style.color = 'var(--text-primary)';
    }

    operationStatusElement.style.display = 'block';
    setTimeout(() => {
        operationStatusElement.style.opacity = '1';
        operationStatusElement.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        operationStatusElement.style.opacity = '0';
        operationStatusElement.style.transform = 'translateY(10px)';
        setTimeout(() => {
            operationStatusElement.style.display = 'none';
        }, 200);
    }, 400);
}

/**
 * 发送消息并返回Promise。
 * @param {object} message - 消息对象。
 * @returns {Promise<any>} 响应结果。
 */
function sendMessagePromise(message) {
    const isCriticalOperation = message.action === "toggleAutoSync" ||
                               message.action === "syncBookmarks" ||
                               message.action === "notificationAction" ||
                               message.action === "manualBackupCompleted" ||
                               message.action === "notificationUserAction" ||
                               message.action === "openReminderSettings";

    if (message.action === "getReminderSettings") {
        if (window.cachedReminderSettings) {
            console.log('使用缓存的提醒设置数据');
            return Promise.resolve({ success: true, settings: window.cachedReminderSettings });
        }
    }

    if (window.isClosing && !isCriticalOperation) {
        console.log(`窗口正在关闭，取消发送非关键消息: ${message.action}`);
        if (message.action === "getReminderSettings") {
            return Promise.resolve({
                success: true,
                settings: {
                    reminderEnabled: true, firstReminderMinutes: 10,
                    secondReminderMinutes: 30, thirdReminderMinutes: 120, repeatReminderDays: 2
                }
            });
        }
        return Promise.resolve({ success: false, error: 'Window is closing', cancelled: true });
    }

    return new Promise((resolve, reject) => {
        let hasResponded = false;
        let timeoutId = null;

        try {
            console.log(`发送消息: ${message.action}`);
            browserAPI.runtime.sendMessage(message, (response) => {
                if (timeoutId) { clearTimeout(timeoutId); }
                if (hasResponded) return;
                hasResponded = true;

                const error = browserAPI.runtime.lastError;
                if (error) {
                    if (window.isClosing && message.action === "getTimerDebugInfo") {
                        console.log('窗口关闭过程中忽略计时器信息获取错误');
                        resolve({ success: false, error: '窗口正在关闭', state: { elapsedTime: 15000 } });
                        return;
                    }
                    if (message.action === "getReminderSettings") {
                        console.log('获取提醒设置失败，使用默认值:', error.message);
                        const defaultSettings = { reminderEnabled: true, firstReminderMinutes: 10, secondReminderMinutes: 30, thirdReminderMinutes: 120, repeatReminderDays: 2 };
                        resolve({ success: true, settings: defaultSettings });
                        return;
                    }
                    if (message.action === "getTimerDebugInfo") {
                        console.log('计时器消息出错，但不影响操作:', error.message);
                        resolve({ success: false, error: error.message || '未知错误', state: { elapsedTime: 15000, timerId: null, startTime: null, reminderShown: false, isActive: true, manualBackupDone: false } });
                        return;
                    }
                    console.warn(`消息 ${message.action} 发送错误:`, error.message || '未知错误');
                    reject(error);
                } else if (!response) {
                    console.warn(`消息 ${message.action} 没有返回数据`);
                    if (message.action === "getTimerDebugInfo") {
                        resolve({ success: false, error: '无响应数据', state: { elapsedTime: 15000 } });
                    } else if (message.action === "getReminderSettings") {
                        resolve({ success: true, settings: { reminderEnabled: true, firstReminderMinutes: 10, secondReminderMinutes: 30, thirdReminderMinutes: 120, repeatReminderDays: 2 } });
                    } else {
                        resolve(null);
                    }
                } else {
                    console.log(`消息 ${message.action} 收到响应:`, response);
                    if (message.action === "getReminderSettings" && response.success && response.settings) {
                        window.cachedReminderSettings = response.settings;
                    }
                    resolve(response);
                }
            });

            timeoutId = setTimeout(() => {
                if (hasResponded) return;
                hasResponded = true;
                console.warn(`消息 ${message.action} 请求超时`);
                if (message.action === "getTimerDebugInfo") {
                    console.log('计时器请求超时，返回备用数据');
                    resolve({ success: false, error: '请求超时', state: { elapsedTime: 15000 } });
                } else if (message.action === "getReminderSettings") {
                    console.log('获取提醒设置超时，使用默认值');
                    resolve({ success: true, settings: { reminderEnabled: true, firstReminderMinutes: 10, secondReminderMinutes: 30, thirdReminderMinutes: 120, repeatReminderDays: 2 } });
                } else {
                    reject(new Error('请求超时，但操作可能已成功'));
                }
            }, 2000);
        } catch (error) {
            console.error(`消息 ${message.action} 发送过程出错:`, error);
            if (hasResponded) return;
            hasResponded = true;
            if (message.action === "getTimerDebugInfo") {
                resolve({ success: false, error: error.message || '发送消息出错', state: { elapsedTime: 15000 } });
            } else if (message.action === "getReminderSettings") {
                console.log('获取提醒设置出错，使用默认值');
                resolve({ success: true, settings: { reminderEnabled: true, firstReminderMinutes: 10, secondReminderMinutes: 30, thirdReminderMinutes: 120, repeatReminderDays: 2 } });
            } else {
                reject(error);
            }
        }
    });
}

/**
 * 更新自定义开关的视觉状态。
 * @param {HTMLElement} toggleButton - 开关按钮元素。
 * @param {boolean} isEnabled - 是否启用。
 */
function updateToggleState(toggleButton, isEnabled) {
    if (!toggleButton) return;
    const circle = toggleButton.querySelector('.toggle-circle');
    if (!circle) return;

    if (isEnabled) {
        toggleButton.setAttribute('data-state', 'on');
        toggleButton.style.backgroundColor = '#4CAF50';
        circle.style.left = 'auto';
        circle.style.right = '3px';
    } else {
        toggleButton.setAttribute('data-state', 'off');
        toggleButton.style.backgroundColor = '#ccc';
        circle.style.right = 'auto';
        circle.style.left = '3px';
    }
}

/**
 * 获取自定义开关的当前状态。
 * @param {HTMLElement} toggleButton - 开关按钮元素。
 * @returns {boolean} - 开关是否启用。
 */
function getToggleState(toggleButton) {
    if (!toggleButton) return false;
    return toggleButton.getAttribute('data-state') === 'on';
}

/**
 * 显示设置已保存指示器。
 */
function showSettingsSavedIndicator() {
    const settingsSavedIndicator = document.getElementById('settingsSavedIndicator');
    if (!settingsSavedIndicator) return;

    settingsSavedIndicator.style.display = 'block';
    settingsSavedIndicator.style.opacity = '0';

    setTimeout(() => {
        settingsSavedIndicator.style.opacity = '1';
        setTimeout(() => {
            settingsSavedIndicator.style.opacity = '0';
            setTimeout(() => {
                settingsSavedIndicator.style.display = 'none';
            }, 300);
        }, 1500);
    }, 10);
}

/**
 * 加载提醒设置。
 */
async function loadReminderSettings() {
    const reminderToggle = document.getElementById('reminderToggle');
    const firstReminderMinutes = document.getElementById('firstReminderMinutes');
    const fixedTimeToggle1 = document.getElementById('fixedTimeToggle1');
    const fixedTime1 = document.getElementById('fixedTime1');
    const fixedTimeToggle2 = document.getElementById('fixedTimeToggle2');
    const fixedTime2 = document.getElementById('fixedTime2');

    const defaultSettings = {
        reminderEnabled: true, firstReminderMinutes: 30,
        fixedTimeEnabled1: true, fixedTime1: "09:30",
        fixedTimeEnabled2: false, fixedTime2: "16:00"
    };

    try {
        const result = await browserAPI.storage.local.get('reminderSettings');
        const settings = result.reminderSettings || defaultSettings;

        if (reminderToggle) updateToggleState(reminderToggle, settings.reminderEnabled !== false);
        if (firstReminderMinutes) firstReminderMinutes.value = settings.firstReminderMinutes !== undefined ? settings.firstReminderMinutes : defaultSettings.firstReminderMinutes;
        if (fixedTimeToggle1) updateToggleState(fixedTimeToggle1, settings.fixedTimeEnabled1 === true);
        if (fixedTime1) fixedTime1.value = settings.fixedTime1 || defaultSettings.fixedTime1;
        if (fixedTimeToggle2) updateToggleState(fixedTimeToggle2, settings.fixedTimeEnabled2 === true);
        if (fixedTime2) fixedTime2.value = settings.fixedTime2 || defaultSettings.fixedTime2;

        console.log('备份提醒设置已加载到通知窗口设置UI:', settings);
    } catch (error) {
        console.error('加载备份提醒设置失败:', error);
        if (reminderToggle) updateToggleState(reminderToggle, defaultSettings.reminderEnabled);
        if (firstReminderMinutes) firstReminderMinutes.value = defaultSettings.firstReminderMinutes;
        if (fixedTimeToggle1) updateToggleState(fixedTimeToggle1, defaultSettings.fixedTimeEnabled1);
        if (fixedTime1) fixedTime1.value = defaultSettings.fixedTime1;
        if (fixedTimeToggle2) updateToggleState(fixedTimeToggle2, defaultSettings.fixedTimeEnabled2);
        if (fixedTime2) fixedTime2.value = defaultSettings.fixedTime2;
    }
}

/**
 * 保存提醒设置。
 * @returns {Promise<boolean>} - 保存是否成功。
 */
async function saveReminderSettingsFunc() {
    const reminderToggle = document.getElementById('reminderToggle');
    const firstReminderMinutes = document.getElementById('firstReminderMinutes');
    const fixedTimeToggle1 = document.getElementById('fixedTimeToggle1');
    const fixedTime1 = document.getElementById('fixedTime1');
    const fixedTimeToggle2 = document.getElementById('fixedTimeToggle2');
    const fixedTime2 = document.getElementById('fixedTime2');

    const defaultSettings = {
        reminderEnabled: true, firstReminderMinutes: 30,
        fixedTimeEnabled1: true, fixedTime1: "09:30",
        fixedTimeEnabled2: false, fixedTime2: "16:00"
    };

    try {
        const settings = {
            reminderEnabled: reminderToggle ? getToggleState(reminderToggle) : defaultSettings.reminderEnabled,
            firstReminderMinutes: firstReminderMinutes ? (parseInt(firstReminderMinutes.value) || 0) : defaultSettings.firstReminderMinutes,
            fixedTimeEnabled1: fixedTimeToggle1 ? getToggleState(fixedTimeToggle1) : defaultSettings.fixedTimeEnabled1,
            fixedTime1: fixedTime1 ? fixedTime1.value : defaultSettings.fixedTime1,
            fixedTimeEnabled2: fixedTimeToggle2 ? getToggleState(fixedTimeToggle2) : defaultSettings.fixedTimeEnabled2,
            fixedTime2: fixedTime2 ? fixedTime2.value : defaultSettings.fixedTime2
        };

        await browserAPI.storage.local.set({ reminderSettings: settings });
        console.log('备份提醒设置已从通知窗口保存:', settings);

        console.log('发送更新设置消息 (不重置计时器)');
        await browserAPI.runtime.sendMessage({
            action: "updateReminderSettings",
            settings: settings,
            resetTimer: false,
            restartTimer: false
        }).then(response => {
            console.log('设置更新消息已发送:', response);
        }).catch(error => {
            console.error('发送更新设置消息失败:', error);
        });

        showSettingsSavedIndicator();
        return true;
    } catch (error) {
        console.error('保存备份提醒设置失败:', error);
        return false;
    }
}

/**
 * 恢复通知窗口的自动关闭计时器。
 */
async function resumeNotificationAutoCloseTimer() {
    let currentNotificationId = null;
    let fallbackApplied = false;
    const storedId = localStorage.getItem('lastActiveNotificationId');
    const fallbackId = storedId ? parseInt(storedId, 10) : null;

    try {
        const timeoutPromise = new Promise((_, reject) => { setTimeout(() => reject(new Error('获取通知窗口ID请求超时')), 2000); });
        const responsePromise = browserAPI.runtime.sendMessage({ action: "getActiveNotificationId" });
        const response = await Promise.race([responsePromise, timeoutPromise]);

        if (response && typeof response.notificationId === 'number') {
            currentNotificationId = response.notificationId;
            console.log(`尝试恢复计时器时获取到通知窗口ID: ${currentNotificationId}`);
            localStorage.setItem('lastActiveNotificationId', currentNotificationId.toString());
        } else {
            console.warn('恢复计时器：未能从后台获取到有效的通知窗口ID，尝试使用后备ID');
            if (fallbackId !== null) {
                currentNotificationId = fallbackId;
                fallbackApplied = true;
                console.log(`使用后备通知窗口ID: ${currentNotificationId}`);
            } else {
                console.warn('没有可用的后备ID，创建新的临时ID');
                currentNotificationId = Date.now();
                console.log(`创建新的临时通知窗口ID: ${currentNotificationId}`);
                localStorage.setItem('lastActiveNotificationId', currentNotificationId.toString());
            }
        }
    } catch (err) {
        console.error('恢复计时器：请求当前通知窗口ID失败:', err);
        if (fallbackId !== null) {
            currentNotificationId = fallbackId;
            fallbackApplied = true;
            console.log(`发生错误后使用后备通知窗口ID: ${currentNotificationId}`);
        } else {
            console.warn('错误处理：没有可用的后备ID，创建新的临时ID');
            currentNotificationId = Date.now();
            console.log(`错误处理：创建新的临时通知窗口ID: ${currentNotificationId}`);
            localStorage.setItem('lastActiveNotificationId', currentNotificationId.toString());
        }
    }

    if (currentNotificationId !== null) {
        try {
            console.log(`请求恢复通知窗口自动关闭计时器，使用ID: ${currentNotificationId}${fallbackApplied ? ' (后备ID)' : ''}`);
            await browserAPI.runtime.sendMessage({ action: "resumeNotificationAutoClose", windowId: currentNotificationId });
            console.log('恢复请求已发送');
            if (fallbackApplied) {
                localStorage.removeItem('lastActiveNotificationId');
                console.log('已清除临时存储的后备通知窗口ID');
            }
        } catch (err) {
            console.error('发送恢复自动关闭请求失败:', err);
        }
    }
}

/**
 * 加载备份信息并更新UI。
 * @param {string} changeDescriptionParam - 从URL参数获取的变化描述。
 * @returns {Promise<boolean>} 操作是否成功。
 */
async function loadBackupInfo(changeDescriptionParam) {
    const lastBackupTimeElement = document.getElementById('lastBackupTime');
    const bookmarkCountElement = document.getElementById('bookmarkCount');
    const changeDescriptionElement = document.getElementById('changeDescription');

    try {
        let backupResponse;
        try {
            backupResponse = await sendMessagePromise({ action: "getBackupStats" });
            console.log('获取备份统计数据完整响应:', backupResponse);
        } catch (error) {
            console.log('获取备份统计数据失败:', error);
            backupResponse = { success: false, error: error.message };
        }

        let timerStateResponse;
        try {
            timerStateResponse = await sendMessagePromise({ action: "getTimerDebugInfo" });
        } catch (error) {
            console.log('获取计时器状态失败:', error);
            timerStateResponse = { success: false, error: error.message };
        }

        let reminderSettingsResponse;
        try {
            reminderSettingsResponse = await sendMessagePromise({ action: "getReminderSettings" });
        } catch (error) {
            console.log('获取提醒设置失败:', error);
            reminderSettingsResponse = { success: true, settings: { reminderEnabled: true, firstReminderMinutes: 30, repeatReminderDays: 2 } };
        }

        if (backupResponse && backupResponse.success) {
            if (backupResponse.lastSyncTime) {
                lastBackupTimeElement.textContent = formatDateTime(backupResponse.lastSyncTime);
            }

            if (backupResponse && backupResponse.success && backupResponse.stats) {
                const bookmarkCount = backupResponse.stats.bookmarkCount || 0;
                const folderCount = backupResponse.stats.folderCount || 0;

                let countHtml;
                if (currentLang === 'zh_CN') {
                    countHtml = `<span style="font-weight: bold; color: var(--text-primary);">${bookmarksStrings['zh_CN']} ${bookmarkCount} 个, ${foldersStrings['zh_CN']} ${folderCount} 个</span>`;
                } else {
                    const bookmarkText = (bookmarkCount === 1 || bookmarkCount === -1 || bookmarkCount === 0) ? bookmarkSingularString['en'] : bookmarksStrings['en'];
                    const folderText = (folderCount === 1 || folderCount === -1 || folderCount === 0) ? folderSingularString['en'] : foldersStrings['en'];
                    countHtml = `<span style="font-weight: bold; color: var(--text-primary);">${bookmarkCount} ${bookmarkText}, ${folderCount} ${folderText}</span>`;
                }
                bookmarkCountElement.innerHTML = countHtml;
            }
        }

        if (changeDescriptionElement) {
            if (changeDescriptionParam) {
                changeDescriptionElement.innerHTML = formatChangeDescription(changeDescriptionParam);
                changeDescriptionElement.style.display = 'block';
            } else {
                changeDescriptionElement.style.display = 'none';
            }
        }

        if (timerStateResponse && timerStateResponse.state) {
            const elapsedTime = timerStateResponse.state.elapsedTime || 0;
            console.log('已过时间:', elapsedTime);
        }
        return true;
    } catch (error) {
        console.error("加载备份信息失败:", error);
        return false;
    }
}

/**
 * 应用本地化内容到DOM元素。
 * @param {string} lang - 目标语言 ('zh_CN' 或 'en')。
 */
function applyLocalizedContent(lang) {
    const reminderSettingsDialogTitle = document.querySelector('#reminderSettingsDialog h3');
    if (reminderSettingsDialogTitle) { reminderSettingsDialogTitle.textContent = reminderSettingsStrings[lang] || reminderSettingsStrings['zh_CN']; }

    const notificationTitle = document.getElementById('notificationTitle');
    if (notificationTitle) {
        const urlParams = new URLSearchParams(window.location.search);
        const isTestNotification = urlParams.has('test');
        const timeLabel = urlParams.get('timeLabel');

        if (isTestNotification) { notificationTitle.textContent = testNotificationTitleStrings[lang] || testNotificationTitleStrings['zh_CN']; }
        else if (timeLabel) {
            const title = fixedTimeNotificationTitleStrings[lang] || fixedTimeNotificationTitleStrings['zh_CN'];
            if (lang === 'en' && timeLabel.includes('准点定时')) {
                const timeMatch = timeLabel.match(/\((\d+:\d+)\)$/);
                if (timeMatch && timeMatch[1]) { notificationTitle.textContent = `${title}(${timeMatch[1]})`; }
                else { notificationTitle.textContent = title; }
            } else { notificationTitle.textContent = `${title}(${timeLabel})`; }
        } else { notificationTitle.textContent = notificationTitleStrings[lang] || notificationTitleStrings['zh_CN']; }
    }

    const lastChangeLabel = document.querySelector('.info-label:first-child');
    if (lastChangeLabel) { lastChangeLabel.textContent = lastChangeStrings[lang] || lastChangeStrings['zh_CN']; }

    const currentQuantityLabel = document.querySelectorAll('.info-label')[1];
    if (currentQuantityLabel) { currentQuantityLabel.textContent = currentQuantityStrings[lang] || currentQuantityStrings['zh_CN']; }

    const lastBackupTime = document.getElementById('lastBackupTime');
    if (lastBackupTime && lastBackupTime.textContent.trim() === '暂无备份记录') { lastBackupTime.textContent = noBackupRecordStrings[lang] || noBackupRecordStrings['zh_CN']; }

    const bookmarkCount = document.getElementById('bookmarkCount');
    if (bookmarkCount && bookmarkCount.textContent.includes('书签') && bookmarkCount.textContent.includes('文件夹')) {
        const content = bookmarkCount.textContent;
        const numbers = content.match(/\d+/g) || ['0', '0'];
        const bookmarksText = bookmarksStrings[lang] || bookmarksStrings['zh_CN'];
        const foldersText = foldersStrings[lang] || foldersStrings['zh_CN'];

        if (lang === 'zh_CN') {
            bookmarkCount.innerHTML = `<span style="font-weight: bold; color: var(--text-primary);">${bookmarksText} ${numbers[0]} 个, ${foldersText} ${numbers[1]} 个</span>`;
        } else {
            const bookmarkText = (numbers[0] === '1' || numbers[0] === '-1' || numbers[0] === '0') ? bookmarkSingularString['en'] : bookmarksStrings['en'];
            const folderText = (numbers[1] === '1' || numbers[1] === '-1' || numbers[1] === '0') ? folderSingularString['en'] : foldersStrings['en'];
            bookmarkCount.innerHTML = `<span style="font-weight: bold; color: var(--text-primary);">${numbers[0]} ${bookmarkText}, ${numbers[1]} ${folderText}</span>`;
        }
    }

    const notificationMessage = document.querySelector('.notification-message');
    if (notificationMessage) { notificationMessage.innerHTML = backupSuggestionStrings[lang] || backupSuggestionStrings['zh_CN']; }

    const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
    if (reminderSettingsBtn) { reminderSettingsBtn.textContent = settingsButtonStrings[lang] || settingsButtonStrings['zh_CN']; }

    const toggleAutoBackupBtn = document.getElementById('toggleAutoBackup');
    if (toggleAutoBackupBtn) { toggleAutoBackupBtn.textContent = toggleAutoBackupStrings[lang] || toggleAutoBackupStrings['zh_CN']; }

    const manualBackupBtn = document.getElementById('manualBackup');
    if (manualBackupBtn) { manualBackupBtn.textContent = backupNowStrings[lang] || backupNowStrings['zh_CN']; }

    const cyclicReminderText = document.querySelector('.cyclic-reminder-text');
    if (cyclicReminderText) { cyclicReminderText.textContent = cyclicReminderStrings[lang] || cyclicReminderStrings['zh_CN']; }

    const minutesUnit = document.querySelector('#reminderSettingsDialog .unit');
    if (minutesUnit) { minutesUnit.textContent = minutesUnitStrings[lang] || minutesUnitStrings['zh_CN']; }

    const allSettingLabelTexts = document.querySelectorAll('#reminderSettingsDialog .setting-label-text');
    for (let i = 0; i < allSettingLabelTexts.length; i++) {
        if (i === 1) {
            const labelText = fixedTime1Strings[lang] || fixedTime1Strings['zh_CN'];
            const separator = lang === 'en' ? ': ' : '：';
            allSettingLabelTexts[i].innerHTML = `<span>${labelText}</span>${separator}`;
        } else if (i === 2) {
            const labelText = fixedTime2Strings[lang] || fixedTime2Strings['zh_CN'];
            const separator = lang === 'en' ? ': ' : '：';
            allSettingLabelTexts[i].innerHTML = `<span>${labelText}</span>${separator}`;
        }
    }

    const manualBackupReminderDesc = document.getElementById('manualBackupReminderDesc');
    const reminderExample = document.getElementById('reminderExample');

    if (manualBackupReminderDesc) { manualBackupReminderDesc.innerHTML = manualBackupReminderDescStrings[lang] || manualBackupReminderDescStrings['zh_CN']; }
    if (reminderExample) { reminderExample.innerHTML = reminderExampleStrings[lang] || reminderExampleStrings['zh_CN']; }

    if (!manualBackupReminderDesc || !reminderExample) {
        const reminderDescriptionElements = document.querySelectorAll('.setting-block div[style*="margin-bottom: 6px"]');
        if (reminderDescriptionElements.length > 0) { reminderDescriptionElements[0].innerHTML = manualBackupReminderDescStrings[lang] || manualBackupReminderDescStrings['zh_CN']; }
        const exampleElements = document.querySelectorAll('.setting-block div:not([style*="margin-bottom"])');
        if (exampleElements.length > 0) { exampleElements[0].innerHTML = reminderExampleStrings[lang] || reminderExampleStrings['zh_CN']; }
    }

    const restoreDefaultBtn = document.getElementById('restoreDefaultSettings');
    if (restoreDefaultBtn) { restoreDefaultBtn.textContent = restoreDefaultStrings[lang] || restoreDefaultStrings['zh_CN']; }

    const saveReminderSettingsBtn = document.getElementById('saveReminderSettings');
    if (saveReminderSettingsBtn) { saveReminderSettingsBtn.textContent = saveSettingsStrings[lang] || saveSettingsStrings['zh_CN']; }

    const settingsSavedIndicator = document.getElementById('settingsSavedIndicator');
    if (settingsSavedIndicator) { settingsSavedIndicator.textContent = settingsSavedStrings[lang] || settingsSavedStrings['zh_CN']; }

    const cyclicReminderLabelEl = document.getElementById('cyclicReminderLabel');
    if (cyclicReminderLabelEl) {
        cyclicReminderLabelEl.textContent = cyclicReminderLabelStrings[lang];
        const settingLabelDiv = cyclicReminderLabelEl.parentElement;
        const modalContent = document.querySelector('#reminderSettingsDialog .modal-content');

        if (lang === 'zh_CN') {
            cyclicReminderLabelEl.style.textAlign = 'right'; cyclicReminderLabelEl.style.width = '85px';
            cyclicReminderLabelEl.style.marginRight = '5px'; cyclicReminderLabelEl.style.whiteSpace = 'nowrap';
            cyclicReminderLabelEl.style.paddingLeft = '0px';
            if (settingLabelDiv) { settingLabelDiv.style.justifyContent = 'flex-start'; settingLabelDiv.style.marginLeft = '0px'; settingLabelDiv.style.paddingLeft = '0px'; }
            if (modalContent) { modalContent.style.width = '400px'; }
        } else {
            cyclicReminderLabelEl.style.textAlign = 'right'; cyclicReminderLabelEl.style.width = '140px';
            cyclicReminderLabelEl.style.whiteSpace = 'normal'; cyclicReminderLabelEl.style.marginRight = '15px';
            cyclicReminderLabelEl.style.paddingLeft = '0px';
            if (settingLabelDiv) { settingLabelDiv.style.justifyContent = 'flex-start'; settingLabelDiv.style.marginLeft = '0px'; settingLabelDiv.style.paddingLeft = '15px'; }
            if (modalContent) { modalContent.style.width = '500px'; }
        }
    }

    const fixedTime1LabelEl = document.getElementById('fixedTime1Label');
    if (fixedTime1LabelEl) {
        fixedTime1LabelEl.textContent = fixedTime1LabelStrings[lang];
        const settingLabelDiv = fixedTime1LabelEl.parentElement;
        if (lang === 'zh_CN') {
            fixedTime1LabelEl.style.textAlign = 'right'; fixedTime1LabelEl.style.width = '85px';
            fixedTime1LabelEl.style.marginRight = '5px'; fixedTime1LabelEl.style.whiteSpace = 'nowrap';
            fixedTime1LabelEl.style.paddingLeft = '0px';
            if (settingLabelDiv) { settingLabelDiv.style.justifyContent = 'flex-start'; settingLabelDiv.style.marginLeft = '0px'; settingLabelDiv.style.paddingLeft = '0px'; }
        } else {
            fixedTime1LabelEl.style.textAlign = 'right'; fixedTime1LabelEl.style.width = '140px';
            fixedTime1LabelEl.style.whiteSpace = 'normal'; fixedTime1LabelEl.style.marginRight = '15px';
            fixedTime1LabelEl.style.paddingLeft = '0px';
            if (settingLabelDiv) { settingLabelDiv.style.justifyContent = 'flex-start'; settingLabelDiv.style.marginLeft = '0px'; settingLabelDiv.style.paddingLeft = '15px'; }
        }
    }

    const fixedTime2LabelEl = document.getElementById('fixedTime2Label');
    if (fixedTime2LabelEl) {
        fixedTime2LabelEl.textContent = fixedTime2LabelStrings[lang];
        const settingLabelDiv = fixedTime2LabelEl.parentElement;
        if (lang === 'zh_CN') {
            fixedTime2LabelEl.style.textAlign = 'right'; fixedTime2LabelEl.style.width = '85px';
            fixedTime2LabelEl.style.marginRight = '5px'; fixedTime2LabelEl.style.whiteSpace = 'nowrap';
            fixedTime2LabelEl.style.paddingLeft = '0px';
            if (settingLabelDiv) { settingLabelDiv.style.justifyContent = 'flex-start'; settingLabelDiv.style.marginLeft = '0px'; settingLabelDiv.style.paddingLeft = '0px'; }
        } else {
            fixedTime2LabelEl.style.textAlign = 'right'; fixedTime2LabelEl.style.width = '140px';
            fixedTime2LabelEl.style.whiteSpace = 'normal'; fixedTime2LabelEl.style.marginRight = '15px';
            fixedTime2LabelEl.style.paddingLeft = '0px';
            if (settingLabelDiv) { settingLabelDiv.style.justifyContent = 'flex-start'; settingLabelDiv.style.marginLeft = '0px'; settingLabelDiv.style.paddingLeft = '15px'; }
        }
    }
}

// =======================================================
// DOMContentLoaded 事件监听与初始化
// =======================================================
// 应用初始主题
applyTheme();

document.addEventListener('DOMContentLoaded', async () => {
    // 获取元素
    const toggleAutoBackupBtn = document.getElementById('toggleAutoBackup');
    const manualBackupBtn = document.getElementById('manualBackup');
    const closeButton = document.getElementById('closeButton');
    const operationStatusElement = document.getElementById('operationStatus');
    const reminderSettingsBtn = document.getElementById('reminderSettingsBtn');
    const notificationTitle = document.getElementById('notificationTitle');

    // 新增：获取设置对话框相关元素
    const reminderSettingsDialog = document.getElementById('reminderSettingsDialog');
    const closeReminderSettings = document.getElementById('closeReminderSettings');
    const reminderToggle = document.getElementById('reminderToggle');
    const firstReminderMinutes = document.getElementById('firstReminderMinutes');
    const fixedTimeToggle1 = document.getElementById('fixedTimeToggle1');
    const fixedTime1 = document.getElementById('fixedTime1');
    const fixedTimeToggle2 = document.getElementById('fixedTimeToggle2');
    const fixedTime2 = document.getElementById('fixedTime2');
    const restoreDefaultSettings = document.getElementById('restoreDefaultSettings');
    const saveReminderSettings = document.getElementById('saveReminderSettings');
    const settingsSavedIndicator = document.getElementById('settingsSavedIndicator');

    // 获取当前语言设置
    try {
        const result = await browserAPI.storage.local.get('preferredLang');
        if (result && result.preferredLang) { currentLang = result.preferredLang; console.log('从存储中获取的语言设置:', currentLang); }
        else {
            const browserLang = navigator.language.toLowerCase();
            if (browserLang.startsWith('zh')) { currentLang = 'zh_CN'; }
            else { currentLang = 'en'; }
            console.log('根据浏览器语言设置的当前语言:', currentLang);
        }
    } catch (error) { console.error('获取语言设置失败，使用默认中文:', error); }

    // 应用国际化文本
    applyLocalizedContent(currentLang);

    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    const isTestNotification = urlParams.has('test');
    const alarmName = urlParams.get('alarmName');
    const timeLabel = urlParams.get('timeLabel');
    const phaseLabel = urlParams.get('phaseLabel');
    const changeDescriptionParam = urlParams.get('changeDescription');

    // 设置通知标题
    if (timeLabel) {
        // 直接使用timeLabel作为标题，因为在notification.js中已经包含了完整的本地化文本
        notificationTitle.textContent = timeLabel;
    } else if (phaseLabel) { 
        notificationTitle.textContent = phaseLabel; 
    }

    if (isTestNotification) {
        if (currentLang === 'zh_CN') { notificationTitle.textContent = '书签备份提醒(测试)'; }
        else { notificationTitle.textContent = 'Bookmark Backup Reminder(Test)'; }
        browserAPI.runtime.sendMessage({ action: "notificationUserAction" }).catch(error => { console.log('发送测试通知标记失败，但不影响功能:', error); });
    }
    else if (timeLabel) {
        browserAPI.runtime.sendMessage({ action: "notificationUserAction", type: "fixed_time" }).catch(error => { console.log('发送准点定时提醒标记失败，但不影响功能:', error); });
    }

    // 加载备份信息
    await loadBackupInfo(changeDescriptionParam);

    // 关闭按钮点击事件
    closeButton.addEventListener('click', () => {
        browserAPI.runtime.sendMessage({ action: "notificationUserClose", closeMethod: "xButton", preserveMode: true });
        localStorage.removeItem('lastActiveNotificationId');
        console.log('窗口关闭，已清除临时存储的通知窗口ID');
        window.isClosing = true;
        window.close();
    });

    // 切换为自动备份按钮点击事件
    toggleAutoBackupBtn.addEventListener('click', async () => {
        console.log('用户点击了"切换为自动备份"按钮');
        const urlParams = new URLSearchParams(window.location.search);
        const changeDescription = urlParams.get('changeDescription') || "";
        console.log('通知窗口获取到的 changeDescription:', changeDescription);

        let notificationHadChanges = false;
        if (changeDescription && changeDescription.trim() !== "" && !changeDescription.includes('无变化')) { notificationHadChanges = true; }
        console.log('通知窗口判断是否有变化:', notificationHadChanges);

        toggleAutoBackupBtn.disabled = true;
        manualBackupBtn.disabled = true;
        operationStatusElement.style.display = 'none';

        try {
            await browserAPI.runtime.sendMessage({ action: "toggleAutoSync", enabled: true });
            console.log('已发送 toggleAutoSync(true) 消息到 background');
        } catch (error) { console.warn('发送 toggleAutoSync 消息失败:', error); }

        if (notificationHadChanges) {
            console.log('通知窗口检测到变化，发送 syncBookmarks(isSwitchToAutoBackup=true) 消息');
            try {
                await browserAPI.runtime.sendMessage({ action: "syncBookmarks", isSwitchToAutoBackup: true });
                console.log('syncBookmarks(isSwitchToAutoBackup=true) 消息已发送');
                showOperationStatus(statusStrings.detectingChangesBackingUp[currentLang] || statusStrings.detectingChangesBackingUp['zh_CN'], 'success');
            } catch (error) {
                console.warn('发送 syncBookmarks 切换备份消息失败:', error);
                showOperationStatus(statusStrings.requestBackupFailed[currentLang] || statusStrings.requestBackupFailed['zh_CN'], 'error');
                toggleAutoBackupBtn.disabled = false;
                manualBackupBtn.disabled = false;
                return;
            }
        } else {
            console.log('通知窗口未检测到变化，不触发切换备份');
            showOperationStatus(statusStrings.switchToAutoBackup[currentLang] || statusStrings.switchToAutoBackup['zh_CN'], 'success');
        }

        let operationCompleted = false;
        const forceCloseTimeoutId = setTimeout(() => {
            console.log('切换/备份操作超时，强制关闭窗口');
            window.isClosing = true;
            window.close();
        }, 5000);

        const closeTimeoutId = setTimeout(() => {
            if (!operationCompleted) {
                console.log('切换/备份请求已发送，关闭窗口');
                operationCompleted = true;
                clearTimeout(forceCloseTimeoutId);

                window.isClosing = true;
                browserAPI.runtime.sendMessage({ action: "readyToClose", windowId: browserAPI.windows.WINDOW_ID_CURRENT }).catch(error => { console.log('发送readyToClose消息失败，直接关闭窗口:', error); });
                setTimeout(() => window.close(), 50);
            }
        }, notificationHadChanges ? 800 : 400);
    });

    // 立即手动备份按钮点击事件
    manualBackupBtn.addEventListener('click', async () => {
        console.log('用户点击了"立即手动备份"按钮');
        operationStatusElement.style.display = 'none';

        browserAPI.runtime.sendMessage({ action: "notificationUserAction", button: "manualBackup", alarmName: alarmName, windowId: browserAPI.windows.WINDOW_ID_CURRENT }).catch(error => console.warn("发送手动备份用户操作信号失败:", error));

        toggleAutoBackupBtn.disabled = true;
        manualBackupBtn.disabled = true;

        showOperationStatus(statusStrings.manualBackupCompleted[currentLang] || statusStrings.manualBackupCompleted['zh_CN'], 'success');
        console.log('显示成功状态...');

        let operationCompleted = false;
        const forceCloseTimeoutId = setTimeout(() => {
            console.log('手动备份超时，强制关闭窗口');
            window.isClosing = true;
            window.close();
        }, 5000);

        const closeTimeoutId = setTimeout(() => {
            if (!operationCompleted) {
                console.log('手动备份请求已发送，但未收到明确响应，关闭窗口');
                operationCompleted = true;
                clearTimeout(closeTimeoutId);
                clearTimeout(forceCloseTimeoutId);

                try {
                    browserAPI.runtime.sendMessage({ action: "notificationAction", buttonIndex: 1 });
                    // 备份完成后直接设置角标为蓝色
                    const badgeColor = '#0000FF'; // 蓝色，与自动备份模式相同
                    if (browserAPI.action && typeof browserAPI.action.setBadgeBackgroundColor === 'function') {
                        browserAPI.action.setBadgeBackgroundColor({ color: badgeColor })
                            .then(() => console.log('直接在通知窗口设置角标颜色为蓝色成功'))
                            .catch(err => console.error('直接设置角标颜色失败:', err));
                    } else if (typeof browserAPI.browserAction !== 'undefined' && typeof browserAPI.browserAction.setBadgeBackgroundColor === 'function') {
                        browserAPI.browserAction.setBadgeBackgroundColor({ color: badgeColor });
                        console.log('使用browserAction API设置角标颜色为蓝色');
                    }
                    
                    browserAPI.runtime.sendMessage({
                        action: "syncBookmarks", direction: "upload", isManual: true,
                        bookmarkStats: { bookmarkMoved: false, folderMoved: false, bookmarkModified: false, folderModified: false },
                        fromNotification: true
                    }).then(() => {
                        browserAPI.runtime.sendMessage({ action: "manualBackupCompleted" });
                        console.log('已发送所有必要的消息确保手动备份成功执行并重置操作状态');
                    }).catch(error => { console.log('发送syncBookmarks消息失败:', error); });
                } catch (e) { console.log('发送备份完成消息失败，但继续关闭窗口:', e); }

                setTimeout(() => {
                    window.isClosing = true;
                    browserAPI.runtime.sendMessage({ action: "readyToClose", windowId: browserAPI.windows.WINDOW_ID_CURRENT }).catch(error => { console.log('发送readyToClose消息失败，直接关闭窗口:', error); });
                    setTimeout(() => window.close(), 200);
                }, 500);
            }
        }, 500);
    });

    // 设置按钮点击事件
    if (reminderSettingsBtn) {
        reminderSettingsBtn.addEventListener('click', async () => {
            console.log('用户点击了通知窗口的"设置"按钮');
            let currentNotificationId = null;
            try {
                const response = await browserAPI.runtime.sendMessage({ action: "getActiveNotificationId" });
                if (response && typeof response.notificationId === 'number') {
                    currentNotificationId = response.notificationId;
                    console.log(`获取到当前通知窗口ID: ${currentNotificationId}`);
                } else {
                    console.warn('未能从后台获取到有效的通知窗口ID，使用临时ID');
                    currentNotificationId = Date.now();
                    localStorage.setItem('lastActiveNotificationId', currentNotificationId.toString());
                }
            } catch (err) { console.error('请求当前通知窗口ID失败:', err); }

            if (currentNotificationId !== null) {
                 try {
                      console.log('请求暂停通知窗口自动关闭计时器');
                      await browserAPI.runtime.sendMessage({ action: "pauseNotificationAutoClose", windowId: currentNotificationId });
                      console.log('暂停请求已发送');
                 } catch (err) { console.error('发送暂停自动关闭请求失败:', err); }
            } else { console.log("无法获取当前通知窗口ID，无法暂停计时器，但仍尝试打开设置对话框"); }

            if (reminderSettingsDialog) {
                 await loadReminderSettings();
                 reminderSettingsDialog.style.display = 'flex';
                 console.log('设置对话框已显示');
            } else { console.error('找不到设置对话框元素'); }
        });
    }

    // 关闭设置对话框按钮点击事件
    if (closeReminderSettings) {
        closeReminderSettings.addEventListener('click', async () => {
            console.log('用户点击了设置对话框的关闭按钮');
            if (reminderSettingsDialog) { reminderSettingsDialog.style.display = 'none'; console.log('设置对话框已关闭'); }
            await resumeNotificationAutoCloseTimer();
        });
    }

    // 点击对话框外部关闭对话框
    if (reminderSettingsDialog) {
        reminderSettingsDialog.addEventListener('click', async (event) => {
            if (event.target === reminderSettingsDialog) {
                reminderSettingsDialog.style.display = 'none';
                console.log('点击对话框外部，对话框关闭');
                await resumeNotificationAutoCloseTimer();
            }
        });
    }

    // 绑定开关按钮点击事件
    if (reminderToggle) { reminderToggle.addEventListener('click', function() { const currentState = getToggleState(this); updateToggleState(this, !currentState); }); }
    if (fixedTimeToggle1) { fixedTimeToggle1.addEventListener('click', function() { const currentState = getToggleState(this); updateToggleState(this, !currentState); }); }
    if (fixedTimeToggle2) { fixedTimeToggle2.addEventListener('click', function() { const currentState = getToggleState(this); updateToggleState(this, !currentState); }); }

    // 绑定恢复默认设置按钮点击事件
    if (restoreDefaultSettings) {
        restoreDefaultSettings.addEventListener('click', async () => {
            // 默认值
            const defaultSettings = {
                reminderEnabled: true,
                firstReminderMinutes: 30,
                fixedTimeEnabled1: true,
                fixedTime1: "09:30",
                fixedTimeEnabled2: false,
                fixedTime2: "16:00"
            };
            // 恢复默认设置UI
            updateToggleState(reminderToggle, defaultSettings.reminderEnabled);
            firstReminderMinutes.value = defaultSettings.firstReminderMinutes;
            updateToggleState(fixedTimeToggle1, defaultSettings.fixedTimeEnabled1);
            fixedTime1.value = defaultSettings.fixedTime1;
            updateToggleState(fixedTimeToggle2, defaultSettings.fixedTimeEnabled2);
            fixedTime2.value = defaultSettings.fixedTime2;

            // 设置提示文本为"已恢复默认设置"，此文本将被 saveReminderSettingsFunc 使用
            // (currentLang is available in this scope from DOMContentLoaded)
            if (settingsSavedIndicator) {
                settingsSavedIndicator.textContent = restoreDefaultSettingsDoneStrings[currentLang] || restoreDefaultSettingsDoneStrings['zh_CN'];
                settingsSavedIndicator.style.color = ''; // 重置文本颜色
            }

            // 尝试保存这些恢复后的默认设置
            // saveReminderSettingsFunc 会在内部调用 showSettingsSavedIndicator (如果成功)
            const saveSuccess = await saveReminderSettingsFunc();

            if (!saveSuccess) {
                // 如果保存失败，显示错误信息
                if (settingsSavedIndicator) {
                    settingsSavedIndicator.textContent = statusStrings.savingSettingsFailed[currentLang] || statusStrings.savingSettingsFailed['zh_CN'];
                    settingsSavedIndicator.style.color = '#c62828'; // 使用标准错误颜色
                    showSettingsSavedIndicator(); // 显示错误提示
                } else {
                    // Fallback if indicator somehow not found, though unlikely
                    showOperationStatus(statusStrings.savingSettingsFailed[currentLang] || statusStrings.savingSettingsFailed['zh_CN'], 'error');
                }
            }
            // 如果 saveSuccess 为 true，则 saveReminderSettingsFunc 已成功显示了"已恢复默认设置"的提示
        });
    }

    // 绑定保存设置按钮点击事件
    if (saveReminderSettings) {
        saveReminderSettings.addEventListener('click', async function() {
            console.log('点击保存手动备份动态提醒设置');
            const success = await saveReminderSettingsFunc();

            if (success) {
                settingsSavedIndicator.textContent = settingsSavedStrings[currentLang] || settingsSavedStrings['zh_CN'];
                showSettingsSavedIndicator();
                setTimeout(() => {
                    if (reminderSettingsDialog) { reminderSettingsDialog.style.display = 'none'; }
                    console.log('保存设置后关闭对话框，计时器已使用新设置重新开始计时');
                }, 1000);
            } else {
                settingsSavedIndicator.textContent = statusStrings.savingSettingsFailed[currentLang] || statusStrings.savingSettingsFailed['zh_CN'];
                settingsSavedIndicator.style.color = '#c62828';
                showSettingsSavedIndicator();
            }
        });
    }
});

// =======================================================
// 浏览器运行时消息监听器 (通用)
// =======================================================
/**
 * 监听来自浏览器运行时（如Background Script）的通用消息。
 * @param {object} message - 消息对象。
 * @param {object} sender - 发送者信息。
 * @param {function} sendResponse - 回复函数。
 * @returns {boolean} - 是否异步响应。
 */
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('通知窗口收到消息:', message);
    if (message.action === "closeNotificationFromSettings") {
        console.log('收到从设置页面关闭通知窗口的消息');
        window.close();
        return true;
    }
    return false;
});
