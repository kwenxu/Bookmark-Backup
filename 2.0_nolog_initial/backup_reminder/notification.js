// =======================================================
// 模块导入
// =======================================================
// 从主模块导入活动通知窗口ID和更新函数
import { activeNotificationWindowId, updateActiveNotificationWindowId } from './index.js';
// 从 timer.js 导入计时器相关函数
import { startReminderTimer, resetFixedTimeAlarm, getReminderSettings } from './timer.js';

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
// 全局状态与常量
// =======================================================
let closeTimer = null; // 自动关闭计时器
const AUTO_CLOSE_DELAY = 20000; // 自动关闭延迟时间 (20秒)
let isAutoClosePaused = false; // 标志，标记自动关闭是否被暂停
let activeNotificationInfo = null; // 存储活动通知信息 { windowId: number, alarmName: string }

// =======================================================
// 辅助函数
// =======================================================

/**
 * 获取扩展资源的绝对路径。
 * @param {string} relativePath - 相对路径。
 * @returns {string} 绝对路径。
 */
function getExtensionURL(relativePath) {
    if (browserAPI && browserAPI.runtime && browserAPI.runtime.getURL) {
        return browserAPI.runtime.getURL(relativePath);
    } else {
        console.error("无法获取 browserAPI.runtime.getURL 函数");
        return relativePath; // 返回相对路径作为备用方案
    }
}

/**
 * 转换 RGBA 颜色数据为十六进制字符串。
 * @param {Array<number>|object} colorData - RGBA 数组 [r, g, b, a] 或包含 color 属性的对象。
 * @returns {string} 十六进制颜色字符串 #rrggbb。
 */
function rgbToHex(colorData) {
    let rgbaArray = null;
    if (Array.isArray(colorData) && colorData.length >= 3) {
        rgbaArray = colorData;
    } else if (typeof colorData === 'object' && colorData !== null && Array.isArray(colorData.color) && colorData.color.length >= 3) {
        rgbaArray = colorData.color;
    } else {
        if (typeof colorData === 'string' && colorData.startsWith('#')) {
            return colorData.toLowerCase();
        }
        return '';
    }

    try {
        const r = rgbaArray[0].toString(16).padStart(2, '0');
        const g = rgbaArray[1].toString(16).padStart(2, '0');
        const b = rgbaArray[2].toString(16).padStart(2, '0');
        return `#${r}${g}${b}`.toLowerCase();
    } catch (e) {
        return '';
    }
}

/**
 * 根据 alarmName 获取对应的存储键。
 * @param {string} alarmName - 闹钟名称。
 * @returns {string} 对应的存储键。
 */
function getReasonStorageKey(alarmName) {
    if (alarmName === 'fixedTimeAlarm1') return 'lastFT1NotificationClosedReason';
    if (alarmName === 'fixedTimeAlarm2') return 'lastFT2NotificationClosedReason';
    return 'lastNotificationClosedReason'; // 默认或循环提醒使用通用的 key
}

// =======================================================
// 通知窗口生命周期管理
// =======================================================

/**
 * 处理通知窗口关闭事件。
 * @param {number} windowId - 关闭的窗口ID。
 */
async function handleNotificationClosed(windowId) {

    if (activeNotificationInfo && windowId === activeNotificationInfo.windowId) {
        const closedAlarmName = activeNotificationInfo.alarmName;

        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        isAutoClosePaused = false;

        const reasonKey = getReasonStorageKey(closedAlarmName);
        let finalReason = null;
        try {
            const data = await browserAPI.storage.local.get(reasonKey);
            if (data[reasonKey]) {
                finalReason = data[reasonKey];
                    } else {
                finalReason = 'manual_close';
                        await browserAPI.storage.local.set({ [reasonKey]: 'manual_close' });
            }
        } catch (error) {
                  finalReason = 'manual_close';
             try { await browserAPI.storage.local.set({ [reasonKey]: 'manual_close' }); } catch (e) { /* ignore */ }
        }

        const previousActiveInfo = activeNotificationInfo; // 捕获旧信息
        updateActiveNotificationWindowId(null); // 兼容旧接口
        activeNotificationInfo = null;

        try {
            if (closedAlarmName === 'fixedTimeAlarm1' || closedAlarmName === 'fixedTimeAlarm2') {
                        await resetFixedTimeAlarm(closedAlarmName, 0);
            } else {
                        await startReminderTimer(true);
            }
        } catch (error) {
            }
    } else {
    }
}

/**
 * 暂停通知窗口的自动关闭计时器。
 */
function pauseAutoCloseTimer() {
    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
        isAutoClosePaused = true;
    } else {
    }
}

/**
 * 恢复通知窗口的自动关闭计时器。
 * @param {number} targetNotificationId - 需要恢复计时器的通知窗口 ID。
 */
function resumeAutoCloseTimer(targetNotificationId) {

    if (!isAutoClosePaused) {
        return;
    }

    if (activeNotificationInfo === null) {
        isAutoClosePaused = false;
        return;
    }

    if (activeNotificationInfo.windowId !== targetNotificationId) {
        isAutoClosePaused = false;
        return;
    }

    isAutoClosePaused = false;
    if (closeTimer) clearTimeout(closeTimer);

    closeTimer = setTimeout(() => {
        if (!isAutoClosePaused && activeNotificationInfo && activeNotificationInfo.windowId === targetNotificationId) {
             closeNotification(targetNotificationId, '自动');
        } else {
            }
    }, AUTO_CLOSE_DELAY);
}

/**
 * 显示备份提醒通知窗口。
 * @param {string} alarmName - 触发此通知的闹钟名称 ('first', 'second', 'fixedTimeAlarm1', etc.)。
 * @param {string} [changeDescription=""] - 可选的变化描述字符串。
 * @returns {Promise<number|null>} 返回新创建的窗口ID或null。
 */
async function showBackupReminder(alarmName, changeDescription = "") {
    // 防御 A: 检查已知异常格式
    if (typeof changeDescription === 'string' && changeDescription.includes('上次变动：') && changeDescription.includes('当前数量/结构：')) {
        return null;
    }

    // 防御 B: 手动模式下检查角标颜色与变化描述是否一致
    if (changeDescription && changeDescription.trim() !== "") {
        try {
            const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
            if (!autoSync) {
                const badgeColorData = await browserAPI.action.getBadgeBackgroundColor({});
                const currentColorHex = rgbToHex(badgeColorData);
                const yellowHex = '#ffff00';

                if (currentColorHex !== yellowHex) {

                     return null;
                }
            }
        } catch (badgeError) {
             }
    }

    if (activeNotificationInfo && activeNotificationInfo.windowId) {
        try {
            await closeNotification(activeNotificationInfo.windowId, '清理旧通知');
                await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
                updateActiveNotificationWindowId(null);
            activeNotificationInfo = null;
        }
    }

    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }
    isAutoClosePaused = false;

    const width = 720;
    const height = 640;
    let left = 20;
    let top = 20;

    try {
        if (browserAPI.system && browserAPI.system.display && browserAPI.system.display.getInfo) {
            const displays = await browserAPI.system.display.getInfo();
            if (displays && displays.length > 0) {
                const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];
                const workArea = primaryDisplay.workArea;
                left = Math.round(workArea.left + (workArea.width - width) / 2);
                top = Math.round(workArea.top + (workArea.height - height) / 2);
            }
        } else {
 }
    } catch (error) {
 }

    const urlParams = new URLSearchParams();
    urlParams.set('alarmName', alarmName);
    if (changeDescription) { urlParams.set('changeDescription', changeDescription); }

    try {
        const settings = await getReminderSettings();
        // 获取当前语言设置
        const result = await new Promise(resolve => chrome.storage.local.get(['preferredLang'], resolve));
        const currentLang = result.preferredLang || 'zh_CN';
        
        if (alarmName === 'fixedTimeAlarm1' && settings.fixedTime1) {
            // 根据当前语言选择正确的文本
            const fixedTimeLabel = currentLang === 'en' ? 
                `Fixed Time 1 (${settings.fixedTime1})` : 
                `准点定时1 (${settings.fixedTime1})`;
            urlParams.set('timeLabel', fixedTimeLabel);
            
        } else if (alarmName === 'fixedTimeAlarm2' && settings.fixedTime2) {
            // 根据当前语言选择正确的文本
            const fixedTimeLabel = currentLang === 'en' ? 
                `Fixed Time 2 (${settings.fixedTime2})` : 
                `准点定时2 (${settings.fixedTime2})`;
            urlParams.set('timeLabel', fixedTimeLabel);
            
        } else if (!alarmName.includes('fixed')) {
            // 循环提醒也需要根据语言设置
            // 根据用户反馈，简化显示格式，去除阶段名称
            const cyclicReminderLabel = currentLang === 'en' ? 
                `Cyclic Reminder` : 
                `循环提醒`;
            urlParams.set('phaseLabel', cyclicReminderLabel);
        }
    } catch (e) {
 }

    const notificationUrl = getExtensionURL(`backup_reminder/notification_popup.html`) + `?${urlParams.toString()}`;

    try {
        const createdWindow = await browserAPI.windows.create({
                    url: notificationUrl,
                    type: 'popup',
                    width: width,
                    height: height,
                    left: left,
                    top: top,
            focused: true
        });

        if (!createdWindow || !createdWindow.id) { throw new Error('窗口创建后未返回有效的窗口对象或ID'); }

        activeNotificationInfo = { windowId: createdWindow.id, alarmName: alarmName };
        updateActiveNotificationWindowId(createdWindow.id);

        isAutoClosePaused = false;
        const currentWindowId = activeNotificationInfo.windowId;
        const currentAlarmName = activeNotificationInfo.alarmName;
        closeTimer = setTimeout(async () => {
            if (!isAutoClosePaused && activeNotificationInfo && activeNotificationInfo.windowId === currentWindowId) {
                 const reasonKey = getReasonStorageKey(currentAlarmName);
                 try {
                    await browserAPI.storage.local.set({ [reasonKey]: 'timeout' });
                             } catch (error) {
 }
                 closeNotification(currentWindowId, '自动');
            } else {
                     }
        }, AUTO_CLOSE_DELAY);

    } catch (error) {
        updateActiveNotificationWindowId(null);
        activeNotificationInfo = null;
        isAutoClosePaused = false;
    }
    return activeNotificationInfo ? activeNotificationInfo.windowId : null;
}

/**
 * 关闭通知窗口。
 * @param {number} windowIdToClose - 要关闭的窗口ID。
 * @param {string} reason - 关闭原因 ('手动'或'自动')。
 */
async function closeNotification(windowIdToClose, reason) {
    if (!windowIdToClose) {
        return;
    }


    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }
    isAutoClosePaused = false;

    try {
        if (typeof windowIdToClose !== 'number') {
                  if (windowIdToClose === activeNotificationInfo && activeNotificationInfo) {
                 handleNotificationClosed(windowIdToClose);
             }
             return;
        }

        await browserAPI.windows.remove(windowIdToClose);
    } catch (error) {
        if (windowIdToClose === activeNotificationInfo && activeNotificationInfo) {
                handleNotificationClosed(windowIdToClose);
        }
    }
}

/**
 * 清除可能存在的通知窗口（例如，在扩展更新或禁用时）。
 */
async function clearNotification() {
    if (activeNotificationInfo && activeNotificationInfo.windowId) {
        await closeNotification(activeNotificationInfo.windowId, '清理');
    }
}

/**
 * 检查通知权限。
 * @returns {Promise<{granted: boolean, status: string}>} 权限状态。
 */
async function checkNotificationPermission() {
    if (!browserAPI.windows) {
        console.error('windows API不可用');
        return { granted: false, status: 'windows API不可用' };
    }

    try {
        if (browserAPI.permissions) {
            try {
                const result = await browserAPI.permissions.contains({ permissions: ['tabs'] });
                if (!result) { return { granted: false, status: '扩展tabs权限未被授予' }; }
            } catch (error) { console.error('检查扩展tabs权限时出错:', error); }
        }
        return { granted: true, status: '窗口创建权限已授予' };
    } catch (error) {
        console.error('检查窗口创建权限时发生错误:', error);
        return { granted: false, status: '检查权限出错: ' + error.message };
    }
}

/**
 * 显示测试通知。
 * @param {number|null} activeWindowId - 当前活动窗口ID，可选。
 * @returns {Promise<Object>} 返回包含窗口ID的对象。
 */
async function showTestNotification(activeWindowId) {
    let isCreatingNotification = false;
    try {
        const notificationUrl = getExtensionURL('backup_reminder/notification.html') +
            '?type=test' +
            (activeWindowId ? `&windowId=${activeWindowId}` : '');

        if (isCreatingNotification) {
            return { windowId: null, error: 'already_creating' };
        }
        isCreatingNotification = true;

        try {
            return await new Promise((resolve, reject) => {
                browserAPI.windows.create({
                    url: notificationUrl, type: 'popup', width: 400, height: 250, focused: true
                }, (window) => {
                    const error = browserAPI.runtime.lastError;
                    isCreatingNotification = false;
                    if (error) { console.error('创建测试通知窗口失败:', error); reject({ windowId: null, error }); }
                    else if (!window) { console.error('创建测试通知窗口失败，无窗口对象返回'); reject({ windowId: null, error: 'no_window_returned' }); }
                    else { resolve({ windowId: window.id }); }
                });
            });
        } catch (error) {
            isCreatingNotification = false;
            console.error('调用windows API时出错:', error);
            return { windowId: null, error };
        }
    } catch (error) {
        isCreatingNotification = false;
        console.error('showTestNotification 函数错误:', error);
        return { windowId: null, error };
    }
}

/**
 * 强制显示备份提醒通知。
 * @param {number|null} activeWindowId - 活动窗口ID，可选。
 * @returns {Promise<number|null>} 返回新创建的窗口ID或null。
 */
async function showForceBackupReminder(activeWindowId) {
    let isCreatingNotification = false;
    try {
        const notificationUrl = getExtensionURL('backup_reminder/notification.html') +
            '?force=true&emergency=true&t=' + Date.now() +
            (activeWindowId ? `&windowId=${activeWindowId}` : '');

        if (isCreatingNotification) {
            return null;
        }
        isCreatingNotification = true;

        try {
            const result = await new Promise((resolve, reject) => {
                browserAPI.windows.create({
                    url: notificationUrl, type: 'popup', width: 620, height: 580, focused: true
                }, (window) => {
                    const error = browserAPI.runtime.lastError;
                    isCreatingNotification = false;
                    if (error) { console.error('创建强制通知窗口失败:', error); reject(null); }
                    else if (!window) { console.error('创建强制通知窗口失败，无窗口对象返回'); reject(null); }
                    else { resolve(window.id); }
                });
            });
            return result;
        } catch (error) {
            isCreatingNotification = false;
            console.error('调用windows API时出错:', error);
            return null;
        }
    } catch (error) {
        isCreatingNotification = false;
        console.error('showForceBackupReminder 函数错误:', error);
        return null;
    }
}

// =======================================================
// 事件监听器
// =======================================================

// 添加窗口关闭监听器
if (browserAPI.windows && browserAPI.windows.onRemoved && !browserAPI.windows.onRemoved.hasListener(handleNotificationClosed)) {
    browserAPI.windows.onRemoved.addListener(handleNotificationClosed);
} else if (browserAPI.windows && browserAPI.windows.onRemoved) {
} else {
}

/**
 * 监听来自通知弹窗的用户操作信号和其他消息。
 */
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'notificationUserAction' && activeNotificationInfo && message.windowId === activeNotificationInfo.windowId) {
        const expectedAlarmName = activeNotificationInfo.alarmName;
        if (message.alarmName !== expectedAlarmName) {
                  return false;
        }

        const reasonKey = getReasonStorageKey(message.alarmName);
        browserAPI.storage.local.set({ [reasonKey]: 'user_action' })
            .then(() => {} /* Log call removed */)
            .catch(err => {} /* Log call removed */);

    } else if (message.action === 'pauseNotificationAutoClose' && activeNotificationInfo && message.windowId === activeNotificationInfo.windowId) {
        pauseAutoCloseTimer();
    } else if (message.action === 'resumeNotificationAutoClose' && activeNotificationInfo && message.windowId === activeNotificationInfo.windowId) {
        resumeAutoCloseTimer(activeNotificationInfo.windowId);
    }
    return false;
});

// =======================================================
// 模块导出
// =======================================================
export { showBackupReminder, closeNotification, clearNotification, checkNotificationPermission, showTestNotification, showForceBackupReminder, resumeAutoCloseTimer };
