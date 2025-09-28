// =======================================================
// 模块导入
// =======================================================
// 导入通知模块的相关函数
import { showBackupReminder, clearNotification, checkNotificationPermission, showTestNotification, showForceBackupReminder, resumeAutoCloseTimer } from './notification.js';
// 导入计时器模块的相关函数
import { startReminderTimer, stopReminderTimer, pauseReminderTimer, resumeReminderTimer, markManualBackupDone, resetReminderState, getDebugInfo, initializeReminderTimerSystem, setupFixedTimeAlarms, checkFixedTimeAlarmsOnActive, timerTriggered, stopLoopReminder } from './timer.js';

// =======================================================
// 浏览器兼容性处理
// =======================================================
/**
 * 封装浏览器API，提供跨浏览器兼容性。
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
// 全局变量与状态
// =======================================================
export let activeNotificationWindowId = null; // 当前活动的通知窗口ID
const userClosedWindowIds = new Set(); // 用户主动关闭的通知窗口ID集合
const userActionWindowIds = new Set(); // 用户操作关闭的窗口ID集合 (目前未直接使用，但保留)
let isTimerPausedBySettingsUI = false; // 跟踪计时器是否因设置UI暂停
let popupPort = null; // 存储来自 popup 的连接端口
let popupWindowId = null; // 存储 popup 的窗口 ID

// 初始化标记与尝试次数
let isBackupReminderInitialized = false; // 备份提醒系统是否已初始化完成
let isBackupReminderInitializationInProgress = false; // 备份提醒系统是否正在初始化中
let initializationAttempts = 0; // 初始化尝试次数
// 添加时间戳变量，防止短时间内重复初始化
let lastInitAttemptTime = 0;
const MIN_INIT_INTERVAL = 3000; // 3秒内不允许重复初始化

// =======================================================
// 辅助函数
// =======================================================

/**
 * 更新当前活动的通知窗口ID。
 * @param {number|null} windowId - 新的窗口ID。
 */
function updateActiveNotificationWindowId(windowId) {
activeNotificationWindowId = windowId;
}

/**
 * 设置计时器是否因设置UI而暂停的状态。
 * @param {boolean} isPaused - 计时器是否暂停。
 */
function setTimerPausedBySettingsUI(isPaused) {
isTimerPausedBySettingsUI = isPaused;
}

/**
 * 获取备份信息 (最后备份时间, 书签/文件夹数量)。
 * @returns {Promise<object>} 备份信息对象。
 */
async function getBackupInfo() {
    try {
        // 获取最后备份时间
        const syncHistoryData = await browserAPI.storage.local.get('syncHistory');
        const syncHistory = syncHistoryData.syncHistory || [];
        // 假设 syncHistory[0] 是最新的记录，如果不是，需要调整索引
        const lastSync = syncHistory.length > 0 ? syncHistory[0] : null;
        const lastSyncTime = lastSync ? lastSync.timestamp : null;

        // 获取当前书签/文件夹数量
        const counts = await getBookmarkCount();

        return {
            lastBackupTime: lastSyncTime,
            bookmarkCount: counts.bookmarks,
            folderCount: counts.folders
        };
    } catch (error) {
return { lastBackupTime: null, bookmarkCount: 0, folderCount: 0, error: error.message };
    }
}

/**
 * 获取当前书签和文件夹数量。
 * @returns {Promise<{bookmarks: number, folders: number}>} 包含书签和文件夹数量的对象。
 */
async function getBookmarkCount() {
    try {
        const tree = await browserAPI.bookmarks.getTree();
        const counts = countItems(tree);
        return { bookmarks: counts.bookmarks, folders: counts.folders };
    } catch (error) {
return { bookmarks: 0, folders: 0 };
    }

    /**
     * 递归计算书签和文件夹数量。
     * @param {Array<object>} nodes - 书签树节点数组。
     * @returns {{bookmarks: number, folders: number}} 包含书签和文件夹数量的对象。
     */
    function countItems(nodes) {
        let bookmarks = 0;
        let folders = 0;
        for (const node of nodes) {
            if (node.children) {
                // 根节点或特殊节点不计入文件夹数量
                if (node.id !== '0' && node.id !== 'root________' && node.id !== 'unfiled_____') {
                     // 只计算实际的文件夹，排除根节点等
                     if (node.title !== "" || (node.children && node.children.length > 0)) {
                         folders++;
                    }
                }
                const counts = countItems(node.children);
                bookmarks += counts.bookmarks;
                folders += counts.folders;
            } else {
                bookmarks++;
            }
        }
        return { bookmarks, folders };
    }
}

// =======================================================
// 主初始化函数
// =======================================================

/**
 * 初始化备份提醒系统。
 */
async function initializeBackupReminder() {
    try {
        const { autoSync } = await browserAPI.storage.local.get({ autoSync: true });
        if (autoSync) {
return;
        }
    } catch (error) {
}
    // 添加时间戳检查，防止重复初始化
    const now = Date.now();
    if (now - lastInitAttemptTime < MIN_INIT_INTERVAL) {
return;
    }
    lastInitAttemptTime = now;
    
    initializationAttempts++; // 增加初始化尝试次数

    // 如果已经初始化完成，则跳过
    if (isBackupReminderInitialized) {
return;
    }

    // 如果正在初始化中，则跳过
    if (isBackupReminderInitializationInProgress) {
return;
    }

    isBackupReminderInitializationInProgress = true; // 标记为正在初始化
try {
        await initializeReminderTimerSystem(); // 初始化计时器系统

        // 监听浏览器窗口焦点变化
        if (!browserAPI.windows.onFocusChanged.hasListener(handleWindowFocusChange)) {
            browserAPI.windows.onFocusChanged.addListener(handleWindowFocusChange);
} else {
}

        // 监听来自popup窗口的消息
        if (!browserAPI.runtime.onMessage.hasListener(handleRuntimeMessage)) {
            browserAPI.runtime.onMessage.addListener(handleRuntimeMessage);
} else {
}

        // 监听窗口关闭事件 - 确保只添加一次
        if (!browserAPI.windows.onRemoved.hasListener(handleWindowRemoved)) {
            browserAPI.windows.onRemoved.addListener(handleWindowRemoved);
} else {
}

        isBackupReminderInitialized = true; // 标记为已初始化
} catch (error) {
isBackupReminderInitializationInProgress = false; // 重置初始化状态，允许下次重试
        throw error;
    } finally {
        isBackupReminderInitializationInProgress = false; // 完成初始化过程
    }
}

// =======================================================
// 事件处理函数
// =======================================================

/**
 * 处理浏览器窗口焦点变化，以替代idle API，实现更精确的活跃状态检测。
 * @param {number} windowId - 发生焦点变化的窗口ID。如果所有窗口都失去焦点，则为 -1 (chrome.windows.WINDOW_ID_NONE)。
 */
async function handleWindowFocusChange(windowId) {
    try {
        const data = await browserAPI.storage.local.get(['isYellowHandActive', 'autoSync', 'reminderSettings']);
        const { isYellowHandActive, autoSync = true } = data;
        const reminderSettings = data.reminderSettings || {};
        const { reminderEnabled = true } = reminderSettings;

        // 仅在手动模式、黄手图标激活（有变动）且循环提醒开启时应用此逻辑
        if (!autoSync && isYellowHandActive && reminderEnabled) {
            if (windowId === browserAPI.windows.WINDOW_ID_NONE) {
pauseReminderTimer();
            } else {
resumeReminderTimer();
            }
        }
    } catch (error) {
}
}

/**
 * 处理来自通知弹窗或Popup的消息。
 * @param {object} message - 消息对象。
 * @param {object} sender - 发送者信息。
 * @param {function} sendResponse - 回复函数。
 * @returns {boolean} - 是否异步响应。
 */
async function handleRuntimeMessage(message, sender, sendResponse) {
    if (message.action === "notificationUserAction") {
        if (sender.tab && sender.tab.windowId) {
userClosedWindowIds.add(sender.tab.windowId);
        } else if (activeNotificationWindowId !== null) {
userClosedWindowIds.add(activeNotificationWindowId);
        } else {
}
        return false;
    }

    if (message.action === "zeroChangeDetected") {
console.log('注意: 零变化检测已在timer.js中提前处理，该消息不再需要');
        return false;
    }

    if (message.action === "closeNotificationFromSettings") {
try {
            if (activeNotificationWindowId !== null) {
                await clearNotification(activeNotificationWindowId);
updateActiveNotificationWindowId(null);
                sendResponse({ success: true });
            } else {
sendResponse({ success: false, error: 'No active notification window' });
            }
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    if (message.action === "readyToClose") {
try {
            if (activeNotificationWindowId !== null) {
                try {
                    await browserAPI.windows.get(activeNotificationWindowId);
                    clearNotification(activeNotificationWindowId);
                } catch (err) {
}
                updateActiveNotificationWindowId(null);
            }
        } catch (error) {
}
        return false;
    }

    if (message.action === "autoBackupToggled") {
onAutoBackupToggled(message.enabled, false);
        return false;
    }

    if (message.action === "notificationAction") {
if (message.buttonIndex === 0) {
toggleAutoBackup(true);
            sendResponse({ success: true, action: "toggleAutoBackup", status: "执行中" });
        } else if (message.buttonIndex === 1) {
performManualBackup();
            sendResponse({ success: true, action: "manualBackup", status: "执行中" });
        } else {
sendResponse({ success: false, error: "未知按钮索引" });
        }
        return true;
    } else if (message.action === "getBackupInfo") {
        getBackupInfo().then(info => {
            sendResponse(info);
        }).catch(error => {
sendResponse({ error: error.message });
        });
        return true;
    } else if (message.action === "getTimerDebugInfo") {
        try {
            const debugInfo = getDebugInfo();
sendResponse(debugInfo);
        } catch (error) {
sendResponse({
                success: false,
                error: error.message,
                state: {
                    elapsedTime: 15000,
                    timerId: null,
                    startTime: null,
                    reminderShown: false,
                    isActive: true,
                    manualBackupDone: false
                }
            });
        }
        return true;
    } else if (message.action === "resetReminderState") {
        try {
resetReminderState();
            sendResponse({ success: true });
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "startNextReminderCycle") {
        try {
resetReminderState();
            setTimeout(async () => {
                await startReminderTimer();
}, 300);
            sendResponse({ success: true });
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "resetFixedTimeAlarm") {
        try {
if (typeof resetFixedTimeAlarm === 'function') { // This function is not imported or defined in index.js
                const result = await resetFixedTimeAlarm(message.alarmName);
                sendResponse({ success: true, result });
            } else {
                // Forward the message to timer.js if resetFixedTimeAlarm is not directly available
                await browserAPI.runtime.sendMessage({
                    action: "callTimerFunction",
                    function: "resetFixedTimeAlarm",
                    args: [message.alarmName]
                });
                sendResponse({ success: true, method: 'forwarded' });
            }
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "forceSendNotification") {
        try {
let hasResponded = false;
            let notificationShown = false;
            const timeoutId = setTimeout(() => {
                if (!hasResponded) {
hasResponded = true;
                    sendResponse({ success: true, method: 'timeout', message: '通知请求超时，但可能已成功' });
                }
            }, 3000);

            if (activeNotificationWindowId !== null) {
                try {
                    const existingWindow = await browserAPI.windows.get(activeNotificationWindowId);
                    if (existingWindow) {
await browserAPI.windows.update(activeNotificationWindowId, { focused: true });
                        if (!hasResponded) {
                            clearTimeout(timeoutId); hasResponded = true;
                            sendResponse({ success: true, windowId: activeNotificationWindowId, method: 'existing' });
                        }
                        notificationShown = true;
                        return true;
                    }
                } catch (err) {
activeNotificationWindowId = null;
                }
            }

            if (!notificationShown) {
                try {
                    const forceWindowId = await showForceBackupReminder(activeNotificationWindowId);
                    if (forceWindowId) {
                        notificationShown = true; activeNotificationWindowId = forceWindowId;
if (!hasResponded) {
                            clearTimeout(timeoutId); hasResponded = true;
                            sendResponse({ success: true, windowId: forceWindowId, method: 'force' });
                        }
                    }
                } catch (forceError) { console.error('强制发送通知方法1失败:', forceError); }
            }

            if (!notificationShown) {
                try {
                    const normalWindowId = await showBackupReminder(activeNotificationWindowId);
                    if (normalWindowId) {
                        notificationShown = true; activeNotificationWindowId = normalWindowId;
if (!hasResponded) {
                            clearTimeout(timeoutId); hasResponded = true;
                            sendResponse({ success: true, windowId: normalWindowId, method: 'normal' });
                        }
                    }
                } catch (normalError) { console.error('强制发送通知方法2失败:', normalError); }
            }

            if (!notificationShown) {
                try {
                    if (activeNotificationWindowId !== null) {
                        try {
                            await browserAPI.windows.get(activeNotificationWindowId);
if (!hasResponded) {
                                clearTimeout(timeoutId); hasResponded = true;
                                sendResponse({ success: true, windowId: activeNotificationWindowId, method: 'existing' });
                            }
                            return true;
                        } catch (err) {
activeNotificationWindowId = null;
                        }
                    }
                    const url = browserAPI.runtime.getURL('backup_reminder/notification_popup.html') + '?force=true&emergency=true&t=' + Date.now();
                    const window = await browserAPI.windows.create({ url: url, type: 'popup', width: 620, height: 580, focused: true });
                    notificationShown = true; activeNotificationWindowId = window.id;
if (!hasResponded) {
                        clearTimeout(timeoutId); hasResponded = true;
                        sendResponse({ success: true, windowId: window.id, method: 'direct' });
                    }
                } catch (directError) {
if (!hasResponded) {
                        clearTimeout(timeoutId); hasResponded = true;
                        sendResponse({ success: false, error: directError.message || '所有通知方法都失败' });
                    }
                }
            }
        } catch (error) {
sendResponse({ success: false, error: error.message || '未知错误' });
        }
        return true;
    } else if (message.action === "showTestNotification") {
try {
            if (activeNotificationWindowId !== null) {
                try { await clearNotification(activeNotificationWindowId); }
                catch (err) { console.log('清除现有通知窗口失败，但继续创建测试通知:', err); }
                updateActiveNotificationWindowId(null);
            }
            const windowId = await showTestNotification(null);
            if (windowId !== null) {
                updateActiveNotificationWindowId(windowId);
                if (message.noTimer === true) {
userClosedWindowIds.add(windowId);
                }
                sendResponse({ success: true, windowId });
            } else { sendResponse({ success: false, error: '创建测试通知失败' }); }
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "openReminderSettings") {
try {
            browserAPI.runtime.sendMessage({ action: "showReminderSettings" }, (response) => {
                const error = browserAPI.runtime.lastError;
                if (error) { console.log('发送showReminderSettings消息时出错:', error.message); sendResponse({ success: false, error: error.message }); }
                else { console.log('showReminderSettings消息发送成功'); sendResponse({ success: true }); }
            });
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "getReminderSettings") {
        try {
            const data = await browserAPI.storage.local.get('reminderSettings');
            const defaultSettings = {
                reminderEnabled: true, firstReminderMinutes: 10,
                secondReminderMinutes: 30, thirdReminderMinutes: 120, repeatReminderDays: 2
            };
            const settings = data.reminderSettings || defaultSettings;
            sendResponse({ success: true, settings: settings });
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "updateReminderSettings") {
try {
await browserAPI.storage.local.set({ reminderSettings: message.settings });
console.log('[index.js] 尝试设置准点定时闹钟...');
            await setupFixedTimeAlarms(message.settings);
if (message.settings.reminderEnabled === false) {
stopReminderTimer();
            } else {
const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
if (!autoSync) {
stopReminderTimer();
                    if (message.resetTimer) {
await resetReminderState();
}
                    const newMinutes = message.settings.firstReminderMinutes;
if (newMinutes > 0) {
await startReminderTimer(true);
} else { console.log('[index.js] 新设置的时间间隔为0或无效，不启动计时器'); }
                } else { console.log('[index.js] 自动备份已启用，不启动循环计时器'); }
            }
sendResponse({ success: true });
        } catch (error) {
sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "pauseReminderTimer") {
if (message.pausedBy === 'settingsUI') { isTimerPausedBySettingsUI = true; console.log('计时器因设置UI打开而被标记为暂停'); }
        pauseReminderTimer();
        sendResponse({ success: true });
        return true;
    } else if (message.action === "resumeReminderTimer") {
isTimerPausedBySettingsUI = false;
        resumeReminderTimer();
        sendResponse({ success: true });
        return true;
    } else if (message.action === "stopReminderTimer") {
try { stopReminderTimer(); sendResponse({ success: true }); }
        catch (error) { console.error('停止提醒计时器失败:', error); sendResponse({ success: false, error: error.message }); }
        return true;
    } else if (message.action === "getActiveNotificationId") {
sendResponse({ notificationId: activeNotificationWindowId });
    }
    return false; // 未处理的消息
}

/**
 * 处理窗口关闭事件。
 * @param {number} windowId - 关闭的窗口ID。
 */
function handleWindowRemoved(windowId) {
if (windowId === activeNotificationWindowId) {
updateActiveNotificationWindowId(null);
    } else {
        if (userClosedWindowIds.has(windowId)) {
userClosedWindowIds.delete(windowId);
        }
    }
}

// =======================================================
// 动作函数
// =======================================================

/**
 * 处理自动备份开关状态变化。
 * @param {boolean} isAutoBackupEnabled - 是否启用自动备份。
 * @param {boolean} [shouldCloseWindow=true] - 是否应该关闭通知窗口（如果存在）。
 */
async function onAutoBackupToggled(isAutoBackupEnabled, shouldCloseWindow = true) {
try {
        if (isAutoBackupEnabled) {
            // 切换到自动模式时，停止所有提醒
            stopLoopReminder();
// 注意：此处不移除 onFocusChanged 等监听器，因为它们在手动模式下才有实际作用，
            // 留在自动模式下不会产生影响，且避免了反复增删监听器的复杂性。
            if (shouldCloseWindow && activeNotificationWindowId) {
await clearNotification();
            }
        } else {
// 错误修正：调用总初始化函数，以确保所有监听器（包括焦点检测）都被激活。
            await initializeBackupReminder();
        }

        const { autoSync } = await browserAPI.storage.local.get({ autoSync: false });
        const badgeText = autoSync ? '自' : '手';
        const badgeColor = autoSync ? '#4CAF50' : '#FF9800';

        if (browserAPI.action && typeof browserAPI.action.setBadgeText === 'function') {
            await browserAPI.action.setBadgeText({ text: badgeText });
            if (typeof browserAPI.action.setBadgeBackgroundColor === 'function') {
                 await browserAPI.action.setBadgeBackgroundColor({ color: badgeColor });
}
        } else {
            browserAPI.browserAction.setBadgeText({ text: badgeText });
            browserAPI.browserAction.setBadgeBackgroundColor({ color: badgeColor });
}
    } catch (error) {
}
}

/**
 * 处理手动备份完成事件。
 */
async function onManualBackupCompleted() {
markManualBackupDone();
    
    // 备份完成后将角标颜色更新为蓝色（与自动备份模式一致）
try {
        const badgeColor = '#0000FF'; // 蓝色，表示手动模式无变动
        if (browserAPI.action && typeof browserAPI.action.setBadgeBackgroundColor === 'function') {
            await browserAPI.action.setBadgeBackgroundColor({ color: badgeColor });
        } else if (typeof browserAPI.browserAction.setBadgeBackgroundColor === 'function') {
            browserAPI.browserAction.setBadgeBackgroundColor({ color: badgeColor });
        }
    } catch (error) {
}
}

/**
 * 切换自动备份状态。
 * @param {boolean} enable - 是否启用自动备份。
 */
async function toggleAutoBackup(enable) {
try {
        await browserAPI.runtime.sendMessage({ action: "toggleAutoSync", enabled: enable });
} catch (error) {
}
}

/**
 * 执行立即手动备份。
 */
async function performManualBackup() {
try {
        const response = await browserAPI.runtime.sendMessage({ action: "syncBookmarks", direction: "upload" });
} catch (error) {
}
}

// =======================================================
// 运行时连接处理 (保持不变，但增加注释)
// =======================================================

/**
 * 监听浏览器运行时连接事件。
 */
browserAPI.runtime.onConnect.addListener((port) => {
// 处理来自 Popup UI 的连接 - 相关功能已移除
    if (port.name === "popupConnect") {
// 不再保留 port 引用或添加 onDisconnect 监听器

    // 处理来自设置窗口 (为某个通知打开) 的连接
    } else if (port.name && port.name.startsWith('settings-for-notification-')) {
        const parts = port.name.split('-');
        const notificationId = parseInt(parts[parts.length - 1], 10);

        if (!isNaN(notificationId)) {
port.onDisconnect.addListener(() => {
try {
                    resumeAutoCloseTimer(notificationId);
} catch (error) {
}
            });
        } else {
}

    // 处理其他未知连接
    } else {
}
});

// =======================================================
// 浏览器运行时消息监听器 (通用)
// =======================================================
/**
 * 监听来自浏览器运行时（如Popup、Content Script等）的通用消息。
 * 此监听器与 `handleRuntimeMessage` 共同处理消息，但 `handleRuntimeMessage` 优先级更高。
 * @param {object} message - 消息对象。
 * @param {object} sender - 发送者信息。
 * @param {function} sendResponse - 回复函数。
 * @returns {boolean} - 是否异步响应。
 */
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
// 处理手动备份完成消息
    if (message.action === "manualBackupCompleted") {
onManualBackupCompleted();
    }
    
    // 更好的做法是将所有消息处理逻辑合并到一个 onMessage 监听器中
    // 但为了清晰地添加新功能，暂时分开写，后续应考虑合并
    return false;
});
// =======================================================
// 模块导出
// =======================================================
export { initializeBackupReminder }; // 初始化函数
export { onAutoBackupToggled, onManualBackupCompleted }; // 状态更新函数
export { updateActiveNotificationWindowId }; // 更新活动窗口ID的函数（如果 background.js 需要控制）
export { setTimerPausedBySettingsUI }; // 新增的函数

// =======================================================
// 首次运行时初始化
// =======================================================
initializeBackupReminder().catch(error => {
});
