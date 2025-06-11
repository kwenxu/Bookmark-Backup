// =======================================================
// 模块导入
// =======================================================
// 导入通知模块的相关函数
import { showBackupReminder, clearNotification, checkNotificationPermission, showTestNotification, showForceBackupReminder, resumeAutoCloseTimer } from './notification.js';
// 导入计时器模块的相关函数
import { startReminderTimer, stopReminderTimer, pauseReminderTimer, resumeReminderTimer, markManualBackupDone, resetReminderState, getDebugInfo, initializeReminderTimerSystem, setupFixedTimeAlarms, checkFixedTimeAlarmsOnActive, timerTriggered } from './timer.js';

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
    console.log(`更新活动通知窗口ID：${activeNotificationWindowId} -> ${windowId}`);
    activeNotificationWindowId = windowId;
}

/**
 * 设置计时器是否因设置UI而暂停的状态。
 * @param {boolean} isPaused - 计时器是否暂停。
 */
function setTimerPausedBySettingsUI(isPaused) {
    console.log(`[index.js] 设置 isTimerPausedBySettingsUI -> ${isPaused}`);
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
        console.error('获取备份信息时出错:', error);
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
        console.error('获取书签树失败:', error);
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
    // 添加时间戳检查，防止重复初始化
    const now = Date.now();
    if (now - lastInitAttemptTime < MIN_INIT_INTERVAL) {
        console.log(`备份提醒系统最近已尝试初始化 (${Math.round((now - lastInitAttemptTime) / 1000)}秒前)，跳过此次调用`);
        return;
    }
    lastInitAttemptTime = now;
    
    initializationAttempts++; // 增加初始化尝试次数

    // 如果已经初始化完成，则跳过
    if (isBackupReminderInitialized) {
        console.log(`备份提醒系统已初始化完成，跳过重复初始化(第${initializationAttempts}次尝试)`);
        return;
    }

    // 如果正在初始化中，则跳过
    if (isBackupReminderInitializationInProgress) {
        console.log(`备份提醒系统正在初始化中，跳过重复初始化(第${initializationAttempts}次尝试)`);
        return;
    }

    isBackupReminderInitializationInProgress = true; // 标记为正在初始化
    console.log(`开始初始化备份提醒系统...(第${initializationAttempts}次尝试)`);

    try {
        await initializeReminderTimerSystem(); // 初始化计时器系统

        // 使用浏览器默认的idle/active状态变化，不设置特定的检测时间
        // 这样任何idle/active状态变化都会立即触发相应处理
        console.log("使用浏览器默认的idle/active状态变化检测机制");

        // 监听浏览器活跃状态变化
        if (!browserAPI.idle.onStateChanged.hasListener(handleIdleStateChange)) {
            browserAPI.idle.onStateChanged.addListener(handleIdleStateChange);
            console.log("已添加浏览器活跃状态变化监听器");
        } else {
            console.log("浏览器活跃状态变化监听器已存在，无需重复添加");
        }

        // 监听来自popup窗口的消息
        if (!browserAPI.runtime.onMessage.hasListener(handleRuntimeMessage)) {
            browserAPI.runtime.onMessage.addListener(handleRuntimeMessage);
            console.log("已添加runtime消息监听器");
        } else {
            console.log("runtime消息监听器已存在，无需重复添加");
        }

        // 监听窗口关闭事件 - 确保只添加一次
        if (!browserAPI.windows.onRemoved.hasListener(handleWindowRemoved)) {
            browserAPI.windows.onRemoved.addListener(handleWindowRemoved);
            console.log("已添加窗口关闭事件监听器");
        } else {
            console.log("窗口关闭事件监听器已存在，无需重复添加");
        }

        isBackupReminderInitialized = true; // 标记为已初始化
        console.log('备份提醒系统已初始化完成');
    } catch (error) {
        console.error(`初始化备份提醒系统失败: ${error.message}`);
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
 * 处理浏览器活跃状态变化。
 * @param {string} state - 新的活跃状态 ('active', 'idle', 'locked')。
 */
async function handleIdleStateChange(state) {
    console.log(`浏览器状态变化: ${state}`);
    try {
        // 检查自动备份模式状态
        const { autoSync = true } = await browserAPI.storage.local.get({'autoSync': true });
        console.log(`[handleIdleStateChange] 当前自动备份状态: ${autoSync}`);

        // 只有在手动备份模式下才处理计时器的暂停/恢复
        if (!autoSync) {
            // 获取动态提醒设置中的三个开关状态
            const settings = await browserAPI.storage.local.get('reminderSettings');
            const reminderSettings = settings.reminderSettings || {};
            const {
                reminderEnabled = true,    // 循环提醒开关
                fixedTimeEnabled1 = true,  // 准点定时1开关
                fixedTimeEnabled2 = false  // 准点定时2开关
            } = reminderSettings;
            
            console.log(`[handleIdleStateChange] 当前开关状态: 循环提醒=${reminderEnabled}, 准点定时1=${fixedTimeEnabled1}, 准点定时2=${fixedTimeEnabled2}`);
            
            if (state === 'active') {
                // 浏览器变为活跃状态
                console.log('浏览器变为活跃状态 (手动模式)');
                
                // 只有开启了循环提醒时才恢复循环提醒计时器
                if (reminderEnabled) {
                    console.log('循环提醒已开启，恢复计时器');
                    resumeReminderTimer();
                } else {
                    console.log('循环提醒未开启，不恢复计时器');
                }
                
                // 只有开启了准点定时时才检查准点定时间间
                if (fixedTimeEnabled1 || fixedTimeEnabled2) {
                    console.log('准点定时已开启，检查准点定时设置');
                    checkFixedTimeAlarmsOnActive().catch(error => { 
                        console.error('检查准点定时设置失败:', error); 
                    });
                } else {
                    console.log('所有准点定时未开启，不检查准点定时');
                }
            } else {
                // 浏览器变为非活跃状态
                console.log('浏览器变为非活跃状态 (手动模式)');
                
                // 只有开启了循环提醒时才暂停循环提醒计时器
                if (reminderEnabled) {
                    console.log('循环提醒已开启，暂停计时器');
                    pauseReminderTimer();
                } else {
                    console.log('循环提醒未开启，无需暂停计时器');
                }
                // 准点定时不需要特殊处理，因为它们由浏览器的间间机制管理
            }
        } else {
            console.log('自动备份模式，忽略浏览器状态变化对计时器的影响');
        }
    } catch (error) {
        console.error('[handleIdleStateChange] 处理浏览器状态变化失败:', error);
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
            console.log(`记录用户操作关闭的窗口 ID: ${sender.tab.windowId}`);
            userClosedWindowIds.add(sender.tab.windowId);
        } else if (activeNotificationWindowId !== null) {
            console.log(`记录用户操作关闭的窗口 ID: ${activeNotificationWindowId}`);
            userClosedWindowIds.add(activeNotificationWindowId);
        } else {
            console.warn('收到 notificationUserAction 但无法获取窗口 ID');
        }
        return false;
    }

    if (message.action === "zeroChangeDetected") {
        console.log(`收到零变化检测消息，类型: ${message.type}`);
        console.log('注意: 零变化检测已在timer.js中提前处理，该消息不再需要');
        return false;
    }

    if (message.action === "closeNotificationFromSettings") {
        console.log('收到从设置页面关闭通知窗口的请求');
        try {
            if (activeNotificationWindowId !== null) {
                await clearNotification(activeNotificationWindowId);
                console.log(`从设置页面关闭了通知窗口 ID: ${activeNotificationWindowId}`);
                updateActiveNotificationWindowId(null);
                sendResponse({ success: true });
            } else {
                console.log('没有活动的通知窗口可关闭');
                sendResponse({ success: false, error: 'No active notification window' });
            }
        } catch (error) {
            console.error('关闭通知窗口时出错:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    if (message.action === "readyToClose") {
        console.log('收到窗口准备关闭的消息，窗口ID:', message.windowId);
        try {
            if (activeNotificationWindowId !== null) {
                try {
                    await browserAPI.windows.get(activeNotificationWindowId);
                    clearNotification(activeNotificationWindowId);
                } catch (err) {
                    console.log(`准备关闭窗口时，窗口 ${activeNotificationWindowId} 已不存在`);
                }
                updateActiveNotificationWindowId(null);
            }
        } catch (error) {
            console.error('处理readyToClose消息时出错:', error);
        }
        return false;
    }

    if (message.action === "autoBackupToggled") {
        console.log('收到自动备份切换消息，状态:', message.enabled);
        onAutoBackupToggled(message.enabled, false);
        return false;
    }

    if (message.action === "notificationAction") {
        console.log(`收到通知窗口按钮操作: buttonIndex=${message.buttonIndex}`);
        if (message.buttonIndex === 0) {
            console.log('执行切换为自动备份操作');
            toggleAutoBackup(true);
            sendResponse({ success: true, action: "toggleAutoBackup", status: "执行中" });
        } else if (message.buttonIndex === 1) {
            console.log('执行立即手动备份操作');
            performManualBackup();
            sendResponse({ success: true, action: "manualBackup", status: "执行中" });
        } else {
            console.log(`未知的按钮索引: ${message.buttonIndex}`);
            sendResponse({ success: false, error: "未知按钮索引" });
        }
        return true;
    } else if (message.action === "getBackupInfo") {
        getBackupInfo().then(info => {
            sendResponse(info);
        }).catch(error => {
            console.error('获取备份信息失败:', error);
            sendResponse({ error: error.message });
        });
        return true;
    } else if (message.action === "getTimerDebugInfo") {
        try {
            const debugInfo = getDebugInfo();
            console.log('提供计时器调试信息:', debugInfo);
            sendResponse(debugInfo);
        } catch (error) {
            console.error('获取计时器调试信息失败:', error);
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
            console.log('收到重置提醒状态请求，keepTimer:', message.keepTimer);
            resetReminderState();
            sendResponse({ success: true });
        } catch (error) {
            console.error('重置提醒状态失败:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "startNextReminderCycle") {
        try {
            console.log('收到开始下一次循环提醒请求');
            resetReminderState();
            setTimeout(async () => {
                await startReminderTimer();
                console.log('已成功开始下一次循环提醒');
            }, 300);
            sendResponse({ success: true });
        } catch (error) {
            console.error('开始下一次循环提醒失败:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "resetFixedTimeAlarm") {
        try {
            console.log('收到重置准点定时闹钟请求:', message.alarmName);
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
            console.error('重置准点定时闹钟失败:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "forceSendNotification") {
        try {
            console.log('收到强制发送通知请求');
            let hasResponded = false;
            let notificationShown = false;
            const timeoutId = setTimeout(() => {
                if (!hasResponded) {
                    console.log('强制发送通知请求超时，但可能已成功');
                    hasResponded = true;
                    sendResponse({ success: true, method: 'timeout', message: '通知请求超时，但可能已成功' });
                }
            }, 3000);

            if (activeNotificationWindowId !== null) {
                try {
                    const existingWindow = await browserAPI.windows.get(activeNotificationWindowId);
                    if (existingWindow) {
                        console.log(`已有活动通知窗口 ID: ${activeNotificationWindowId}，将其置于前台`);
                        await browserAPI.windows.update(activeNotificationWindowId, { focused: true });
                        if (!hasResponded) {
                            clearTimeout(timeoutId); hasResponded = true;
                            sendResponse({ success: true, windowId: activeNotificationWindowId, method: 'existing' });
                        }
                        notificationShown = true;
                        return true;
                    }
                } catch (err) {
                    console.log(`全局活动窗口 ID ${activeNotificationWindowId} 无效，将重置并创建新窗口`);
                    activeNotificationWindowId = null;
                }
            }

            if (!notificationShown) {
                try {
                    const forceWindowId = await showForceBackupReminder(activeNotificationWindowId);
                    if (forceWindowId) {
                        notificationShown = true; activeNotificationWindowId = forceWindowId;
                        console.log(`强制通知窗口已创建，活动 ID: ${activeNotificationWindowId}`);
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
                        console.log(`普通通知窗口已创建，活动 ID: ${activeNotificationWindowId}`);
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
                            console.log('存在活动窗口，不创建新窗口');
                            if (!hasResponded) {
                                clearTimeout(timeoutId); hasResponded = true;
                                sendResponse({ success: true, windowId: activeNotificationWindowId, method: 'existing' });
                            }
                            return true;
                        } catch (err) {
                            console.log('活动窗口ID已失效，重置窗口ID');
                            activeNotificationWindowId = null;
                        }
                    }
                    const url = browserAPI.runtime.getURL('backup_reminder/notification_popup.html') + '?force=true&emergency=true&t=' + Date.now();
                    const window = await browserAPI.windows.create({ url: url, type: 'popup', width: 620, height: 580, focused: true });
                    notificationShown = true; activeNotificationWindowId = window.id;
                    console.log(`直接创建通知窗口已创建，活动 ID: ${activeNotificationWindowId}`);
                    if (!hasResponded) {
                        clearTimeout(timeoutId); hasResponded = true;
                        sendResponse({ success: true, windowId: window.id, method: 'direct' });
                    }
                } catch (directError) {
                    console.error('强制发送通知方法3失败:', directError);
                    if (!hasResponded) {
                        clearTimeout(timeoutId); hasResponded = true;
                        sendResponse({ success: false, error: directError.message || '所有通知方法都失败' });
                    }
                }
            }
        } catch (error) {
            console.error('处理强制通知请求失败:', error);
            sendResponse({ success: false, error: error.message || '未知错误' });
        }
        return true;
    } else if (message.action === "showTestNotification") {
        console.log('收到显示测试通知请求');
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
                    console.log('测试通知设置为不进行后续计时');
                    userClosedWindowIds.add(windowId);
                }
                sendResponse({ success: true, windowId });
            } else { sendResponse({ success: false, error: '创建测试通知失败' }); }
        } catch (error) {
            console.error('处理showTestNotification请求失败:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "openReminderSettings") {
        console.log('收到打开提醒设置对话框的请求');
        try {
            browserAPI.runtime.sendMessage({ action: "showReminderSettings" }, (response) => {
                const error = browserAPI.runtime.lastError;
                if (error) { console.log('发送showReminderSettings消息时出错:', error.message); sendResponse({ success: false, error: error.message }); }
                else { console.log('showReminderSettings消息发送成功'); sendResponse({ success: true }); }
            });
        } catch (error) {
            console.error('处理openReminderSettings请求失败:', error);
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
            console.error('获取提醒设置失败:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "updateReminderSettings") {
        console.log('[index.js] 收到更新备份提醒设置消息:', message.settings);
        try {
            console.log('[index.js] 尝试保存设置到 storage.local...');
            await browserAPI.storage.local.set({ reminderSettings: message.settings });
            console.log('[index.js] 设置已保存到 storage.local');
            console.log('[index.js] 尝试设置准点定时闹钟...');
            await setupFixedTimeAlarms(message.settings);
            console.log('[index.js] 准点定时闹钟已设置');

            if (message.settings.reminderEnabled === false) {
                console.log('[index.js] 循环提醒功能已禁用，停止计时器');
                stopReminderTimer();
            } else {
                console.log('[index.js] 检查是否需要重新启动循环计时器...');
                const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
                console.log(`[index.js] 当前自动备份状态: ${autoSync}`);

                if (!autoSync) {
                    console.log('[index.js] 自动备份关闭，停止当前计时器准备重置...');
                    stopReminderTimer();
                    if (message.resetTimer) {
                        console.log('[index.js] 检测到 resetTimer 标志，重置提醒状态...');
                        await resetReminderState();
                        console.log('[index.js] 提醒状态已重置');
                    }
                    const newMinutes = message.settings.firstReminderMinutes;
                    console.log(`[index.js] 新的循环提醒间隔: ${newMinutes} 分钟`);
                    if (newMinutes > 0) {
                        console.log(`[index.js] 使用新的时间间隔 ${newMinutes} 分钟重新启动计时器 (跳过初始提醒)`);
                        await startReminderTimer(true);
                        console.log(`[index.js] 循环计时器已重新启动`);
                    } else { console.log('[index.js] 新设置的时间间隔为0或无效，不启动计时器'); }
                } else { console.log('[index.js] 自动备份已启用，不启动循环计时器'); }
            }
            console.log('[index.js] updateReminderSettings 处理成功');
            sendResponse({ success: true });
        } catch (error) {
            console.error(`[index.js] 更新备份提醒设置失败: ${error.message}${error.stack ? '\n' + error.stack : ''}`);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    } else if (message.action === "pauseReminderTimer") {
        console.log('收到暂停计时器请求', message.pausedBy ? `(来源: ${message.pausedBy})` : '');
        if (message.pausedBy === 'settingsUI') { isTimerPausedBySettingsUI = true; console.log('计时器因设置UI打开而被标记为暂停'); }
        pauseReminderTimer();
        sendResponse({ success: true });
        return true;
    } else if (message.action === "resumeReminderTimer") {
        console.log('收到恢复计时器请求');
        isTimerPausedBySettingsUI = false;
        resumeReminderTimer();
        sendResponse({ success: true });
        return true;
    } else if (message.action === "stopReminderTimer") {
        console.log('收到停止提醒计时器请求');
        try { stopReminderTimer(); sendResponse({ success: true }); }
        catch (error) { console.error('停止提醒计时器失败:', error); sendResponse({ success: false, error: error.message }); }
        return true;
    } else if (message.action === "getActiveNotificationId") {
        console.log('收到获取活动通知窗口ID的请求');
        sendResponse({ notificationId: activeNotificationWindowId });
        return false;
    }
    return false; // 未处理的消息
}

/**
 * 处理窗口关闭事件。
 * @param {number} windowId - 关闭的窗口ID。
 */
function handleWindowRemoved(windowId) {
    console.log(`窗口关闭事件: ${windowId}`);
    if (windowId === activeNotificationWindowId) {
        console.log(`活动的通知窗口 (${windowId}) 已关闭`);
        updateActiveNotificationWindowId(null);
    } else {
        if (userClosedWindowIds.has(windowId)) {
            console.log(`用户关闭的通知窗口 (${windowId}) 已被移除`);
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
    console.log(`备份提醒系统收到自动备份开关切换为 ${isAutoBackupEnabled}`);
    try {
        if (isAutoBackupEnabled) {
            stopReminderTimer();
            console.log('自动备份已开启，提醒计时器已停止');
            if (shouldCloseWindow && activeNotificationWindowId) {
                 console.log(`自动备份开启，尝试关闭通知窗口 ID: ${activeNotificationWindowId}`);
                 await clearNotification();
            }
        } else {
            console.log('自动备份已关闭，启动提醒计时器');
            await resetReminderState();
            await startReminderTimer(true);
            console.log('提醒计时器已启动');
        }

        const { autoSync } = await browserAPI.storage.local.get({ autoSync: false });
        const badgeText = autoSync ? '自' : '手';
        const badgeColor = autoSync ? '#4CAF50' : '#FF9800';

        if (browserAPI.action && typeof browserAPI.action.setBadgeText === 'function') {
            await browserAPI.action.setBadgeText({ text: badgeText });
            if (typeof browserAPI.action.setBadgeBackgroundColor === 'function') {
                 await browserAPI.action.setBadgeBackgroundColor({ color: badgeColor });
                 console.log(`已设置角标为${autoSync ? '自动' : '手动'}模式`);
            }
        } else {
            browserAPI.browserAction.setBadgeText({ text: badgeText });
            browserAPI.browserAction.setBadgeBackgroundColor({ color: badgeColor });
            console.log(`已设置角标为${autoSync ? '自动' : '手动'}模式 (旧版API)`);
        }
    } catch (error) {
        console.error(`处理自动备份开关切换失败: ${error.message}`);
    }
}

/**
 * 处理手动备份完成事件。
 */
async function onManualBackupCompleted() {
    console.log('备份提醒系统收到手动备份完成通知');
    markManualBackupDone();
    
    // 备份完成后将角标颜色更新为蓝色（与自动备份模式一致）
    console.log('备份完成，更新角标颜色为蓝色');
    try {
        const badgeColor = '#4CAF50'; // 蓝色，与自动备份模式相同
        if (browserAPI.action && typeof browserAPI.action.setBadgeBackgroundColor === 'function') {
            await browserAPI.action.setBadgeBackgroundColor({ color: badgeColor });
        } else if (typeof browserAPI.browserAction.setBadgeBackgroundColor === 'function') {
            browserAPI.browserAction.setBadgeBackgroundColor({ color: badgeColor });
        }
    } catch (error) {
        console.error(`更新备份后角标颜色失败: ${error.message}`);
    }
}

/**
 * 切换自动备份状态。
 * @param {boolean} enable - 是否启用自动备份。
 */
async function toggleAutoBackup(enable) {
    console.log(`请求切换自动备份状态为: ${enable}`);
    try {
        await browserAPI.runtime.sendMessage({ action: "toggleAutoSync", enabled: enable });
        console.log(`已发送 toggleAutoSync(${enable}) 消息给 background.js`);
    } catch (error) {
        console.error(`切换自动备份状态失败 (从 index.js 调用): ${error.message}`);
    }
}

/**
 * 执行立即手动备份。
 */
async function performManualBackup() {
     console.log('请求执行立即手动备份');
     try {
        const response = await browserAPI.runtime.sendMessage({ action: "syncBookmarks", direction: "upload" });
        console.log('手动备份请求已发送，响应:', response);
     } catch (error) {
        console.error(`执行手动备份失败: ${error.message}`);
     }
}

// =======================================================
// 运行时连接处理 (保持不变，但增加注释)
// =======================================================

/**
 * 监听浏览器运行时连接事件。
 */
browserAPI.runtime.onConnect.addListener((port) => {
    console.log(`收到新的连接请求，端口名: ${port.name}`);

    // 处理来自 Popup UI 的连接
    if (port.name === "popupConnect") {
        popupPort = port;
        if (port.sender && port.sender.tab && typeof port.sender.tab.windowId === 'number') {
            popupWindowId = port.sender.tab.windowId;
        } else {
            popupWindowId = null; // 明确设置为 null
        }

        port.onDisconnect.addListener(() => {
            const disconnectReason = browserAPI.runtime.lastError ? browserAPI.runtime.lastError.message : "正常断开";
            console.log(`Popup 连接断开。原因: ${disconnectReason}`);

            const disconnectedWindowId = popupWindowId;
            if (popupPort === port) {
                popupPort = null;
                popupWindowId = null;
            }

            if (isTimerPausedBySettingsUI) {
                console.log('Popup 关闭时，计时器因设置UI而暂停');
                let isUserClosed = false;
                try {
                    browserAPI.tabs.sendMessage(disconnectedWindowId, {action: "checkDialogUserClosed"}, function(response) {
                        if (response && response.userClosed) { isUserClosed = true; }
                    });
                } catch (error) { console.log('预期的错误：无法检查对话框关闭方式'); }

                const wasPaused = isTimerPausedBySettingsUI;
                setTimeout(() => {
                    if (wasPaused && isTimerPausedBySettingsUI) {
                        console.log('延迟检查后计时器仍然暂停，现在恢复循环计时器');
                        resumeReminderTimer();
                        setTimerPausedBySettingsUI(false);
                    } else if (wasPaused && !isTimerPausedBySettingsUI) {
                        console.log('计时器已被其他进程恢复，无需操作');
                    }
                }, 1000);
            }
        });

    // 处理来自设置窗口 (为某个通知打开) 的连接
    } else if (port.name && port.name.startsWith('settings-for-notification-')) {
        const parts = port.name.split('-');
        const notificationId = parseInt(parts[parts.length - 1], 10);

        if (!isNaN(notificationId)) {
            console.log(`已确认来自设置窗口的连接，关联通知窗口 ID: ${notificationId}`);
            port.onDisconnect.addListener(() => {
                console.log(`设置窗口 (关联通知 ID: ${notificationId}) 的连接已断开`);
                try {
                    resumeAutoCloseTimer(notificationId);
                    console.log(`已请求恢复通知窗口 ${notificationId} 的自动关闭计时器`);
                } catch (error) {
                    console.error(`请求恢复通知窗口 ${notificationId} 计时器时出错:`, error);
                }
            });
        } else {
            console.warn(`连接端口名称格式错误，无法解析通知 ID: ${port.name}`);
        }

    // 处理其他未知连接
    } else {
        console.log(`收到其他或未知连接: ${port.name}`);
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
    console.log('通用消息监听器收到消息:', message);
    
    // 处理获取活动通知窗口ID的请求
    if (message.action === "getActiveNotificationId") {
        console.log('收到获取活动通知窗口ID的请求');
        sendResponse({ notificationId: activeNotificationWindowId });
    }
    
    // 处理手动备份完成消息
    if (message.action === "manualBackupCompleted") {
        console.log('收到手动备份完成消息，调用onManualBackupCompleted');
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
    console.error('首次初始化备份提醒系统失败:', error);
});
