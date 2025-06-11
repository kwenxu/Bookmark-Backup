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
 * 日志记录函数 (保持与timer.js一致)。
 * @param {string} message - 要记录的消息。
 */
function addLog(message) {
    const now = new Date();
    const timeString = now.toLocaleString();
    const fullMessage = `[备份提醒通知] [${timeString}] ${message}`;
    console.log(fullMessage);
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
        addLog(`[rgbToHex] Unexpected color format: ${JSON.stringify(colorData)}`);
        return '';
    }

    try {
        const r = rgbaArray[0].toString(16).padStart(2, '0');
        const g = rgbaArray[1].toString(16).padStart(2, '0');
        const b = rgbaArray[2].toString(16).padStart(2, '0');
        return `#${r}${g}${b}`.toLowerCase();
    } catch (e) {
        addLog(`[rgbToHex] Error converting RGBA to hex: ${e.message}`);
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
    addLog(`处理窗口关闭事件: windowId=${windowId}, activeNotificationInfo=${JSON.stringify(activeNotificationInfo)}`);

    if (activeNotificationInfo && windowId === activeNotificationInfo.windowId) {
        const closedAlarmName = activeNotificationInfo.alarmName;
        addLog(`检测到当前活跃的通知窗口 (ID: ${windowId}, Alarm: ${closedAlarmName}) 已关闭`);

        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        isAutoClosePaused = false;
        addLog('自动关闭计时器已清除或重置');

        const reasonKey = getReasonStorageKey(closedAlarmName);
        let finalReason = null;
        try {
            const data = await browserAPI.storage.local.get(reasonKey);
            if (data[reasonKey]) {
                finalReason = data[reasonKey];
                addLog(`从 storage (${reasonKey}) 中获取到关闭原因: ${finalReason}`);
            } else {
                finalReason = 'manual_close';
                addLog(`未在 storage (${reasonKey}) 中找到关闭原因，判定为 manual_close`);
                await browserAPI.storage.local.set({ [reasonKey]: 'manual_close' });
            }
        } catch (error) {
             addLog(`检查或设置关闭原因 (${reasonKey}) 时出错: ${error.message}, 默认为 manual_close`);
             finalReason = 'manual_close';
             try { await browserAPI.storage.local.set({ [reasonKey]: 'manual_close' }); } catch (e) { /* ignore */ }
        }
        addLog(`最终确定通知窗口 ${windowId} (Alarm: ${closedAlarmName}) 关闭原因: ${finalReason}`);

        const previousActiveInfo = activeNotificationInfo; // 捕获旧信息
        updateActiveNotificationWindowId(null); // 兼容旧接口
        activeNotificationInfo = null;
        addLog('活动通知信息已重置');

        try {
            if (closedAlarmName === 'fixedTimeAlarm1' || closedAlarmName === 'fixedTimeAlarm2') {
                addLog(`通知窗口关闭 (Alarm: ${closedAlarmName})，请求重置准点定时闹钟到下一天`);
                await resetFixedTimeAlarm(closedAlarmName, 0);
            } else {
                addLog(`通知窗口关闭 (Alarm: ${closedAlarmName})，请求启动下一个循环提醒周期 (跳过初始提醒)`);
                await startReminderTimer(true);
            }
        } catch (error) {
            addLog(`调用 ${closedAlarmName.includes('fixed') ? 'resetFixedTimeAlarm' : 'startReminderTimer'} 时出错: ${error.message}`);
        }
    } else {
        addLog(`关闭的窗口 (ID: ${windowId}) 不是当前活跃的通知窗口 (${activeNotificationInfo ? activeNotificationInfo.windowId : '无活动窗口'})，忽略`);
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
        addLog('通知窗口自动关闭计时器已暂停');
    } else {
        addLog('没有活动的自动关闭计时器可暂停');
    }
}

/**
 * 恢复通知窗口的自动关闭计时器。
 * @param {number} targetNotificationId - 需要恢复计时器的通知窗口 ID。
 */
function resumeAutoCloseTimer(targetNotificationId) {
    addLog(`请求恢复通知窗口 ${targetNotificationId} 的自动关闭计时器`);

    if (!isAutoClosePaused) {
        addLog(`计时器未被暂停，无需恢复 (请求ID: ${targetNotificationId})`);
        return;
    }

    if (activeNotificationInfo === null) {
        addLog(`当前没有活动的通知窗口，无法恢复计时器 (请求ID: ${targetNotificationId})`);
        isAutoClosePaused = false;
        return;
    }

    if (activeNotificationInfo.windowId !== targetNotificationId) {
        addLog(`请求恢复的通知窗口ID ${targetNotificationId} 与当前活动窗口ID ${activeNotificationInfo.windowId} 不匹配，不恢复计时器`);
        isAutoClosePaused = false;
        return;
    }

    isAutoClosePaused = false;
    if (closeTimer) clearTimeout(closeTimer);

    closeTimer = setTimeout(() => {
        if (!isAutoClosePaused && activeNotificationInfo && activeNotificationInfo.windowId === targetNotificationId) {
             closeNotification(targetNotificationId, '自动');
        } else {
            addLog(`自动关闭时间到，但计时器已被暂停或活动窗口已改变 (目标ID: ${targetNotificationId}，当前ID: ${activeNotificationInfo.windowId})，不关闭窗口`);
        }
    }, AUTO_CLOSE_DELAY);
    addLog(`通知窗口 ${targetNotificationId} 自动关闭计时器已恢复，将在 ${AUTO_CLOSE_DELAY / 1000} 秒后关闭`);
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
        addLog(`[BUG 1 防御 A] 检测到异常 changeDescription 格式，阻止通知显示。Alarm: ${alarmName}, Description: ${changeDescription}`);
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
                     addLog(`[BUG 1 防御 B] 手动模式下 changeDescription 非空 ("${changeDescription}") 但角标颜色非黄色 (${currentColorHex} / ${JSON.stringify(badgeColorData)}), 阻止通知显示。Alarm: ${alarmName}`);
                     return null;
                }
            }
        } catch (badgeError) {
             addLog(`[BUG 1 防御 B] 检查角标颜色失败: ${badgeError.message}, 无法执行额外检查。`);
        }
    }

    addLog(`请求显示备份提醒窗口，Alarm: ${alarmName}, 变化: ${changeDescription}`);

    if (activeNotificationInfo && activeNotificationInfo.windowId) {
        addLog(`检测到已有活动通知窗口 (ID: ${activeNotificationInfo.windowId}, Alarm: ${activeNotificationInfo.alarmName})，先尝试关闭它`);
        try {
            await closeNotification(activeNotificationInfo.windowId, '清理旧通知');
            addLog(`旧通知窗口 (ID: ${activeNotificationInfo.windowId}) 已请求关闭`);
            await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
            addLog(`请求关闭旧通知窗口 (ID: ${activeNotificationInfo.windowId}) 出错: ${error.message}`);
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
        } else { addLog('browserAPI.system.display.getInfo 不可用，使用默认位置'); }
    } catch (error) { addLog(`获取屏幕信息失败: ${error.message}，使用默认位置`); }

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
    } catch (e) { addLog("获取设置以添加标签失败: " + e.message); }

    const notificationUrl = getExtensionURL(`backup_reminder/notification_popup.html`) + `?${urlParams.toString()}`;

    try {
        addLog(`尝试创建窗口，URL: ${notificationUrl}`);
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
        addLog(`成功创建通知窗口，ID: ${activeNotificationInfo.windowId}, Alarm: ${activeNotificationInfo.alarmName}`);

        isAutoClosePaused = false;
        const currentWindowId = activeNotificationInfo.windowId;
        const currentAlarmName = activeNotificationInfo.alarmName;
        closeTimer = setTimeout(async () => {
            if (!isAutoClosePaused && activeNotificationInfo && activeNotificationInfo.windowId === currentWindowId) {
                 const reasonKey = getReasonStorageKey(currentAlarmName);
                 try {
                    await browserAPI.storage.local.set({ [reasonKey]: 'timeout' });
                    addLog(`自动关闭计时器触发 (Alarm: ${currentAlarmName})，记录关闭原因为 timeout (${reasonKey})`);
                 } catch (error) { addLog(`记录 timeout 关闭原因 (${reasonKey}) 失败: ${error.message}`); }
                 closeNotification(currentWindowId, '自动');
            } else {
                 addLog(`自动关闭时间到，但计时器已被暂停或活动窗口/闹钟已改变，不关闭窗口 (Target: ${currentWindowId}/${currentAlarmName}, Active: ${activeNotificationInfo ? `${activeNotificationInfo.windowId}/${activeNotificationInfo.alarmName}` : 'None'})`);
            }
        }, AUTO_CLOSE_DELAY);
        addLog(`已为窗口 ${currentWindowId} (Alarm: ${currentAlarmName}) 设置 ${AUTO_CLOSE_DELAY / 1000} 秒后自动关闭计时器`);

    } catch (error) {
        addLog(`创建通知窗口失败: ${error.message}`);
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
        addLog('没有有效的窗口ID可关闭');
        return;
    }

    addLog(`请求关闭通知窗口 (ID: ${windowIdToClose})，原因: ${reason}`);

    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
    }
    isAutoClosePaused = false;
    addLog('自动关闭计时器已清除，暂停状态已重置');

    try {
        if (typeof windowIdToClose !== 'number') {
             addLog(`无效的窗口ID类型: ${typeof windowIdToClose}，值: ${windowIdToClose}`);
             if (windowIdToClose === activeNotificationInfo && activeNotificationInfo) {
                 handleNotificationClosed(windowIdToClose);
             }
             return;
        }

        await browserAPI.windows.remove(windowIdToClose);
        addLog(`通知窗口 (ID: ${windowIdToClose}) 已成功移除 (${reason}关闭)`);
    } catch (error) {
        addLog(`关闭通知窗口 (ID: ${windowIdToClose}) 出错 (可能已被关闭): ${error.message}`);
        if (windowIdToClose === activeNotificationInfo && activeNotificationInfo) {
            addLog(`关闭出错，但ID匹配当前活动窗口，强制调用关闭处理程序`);
            handleNotificationClosed(windowIdToClose);
        }
    }
}

/**
 * 清除可能存在的通知窗口（例如，在扩展更新或禁用时）。
 */
async function clearNotification() {
    if (activeNotificationInfo && activeNotificationInfo.windowId) {
        addLog(`请求清除当前通知窗口 (ID: ${activeNotificationInfo.windowId})`);
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
                console.log('扩展tabs权限检查结果:', result);
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
        console.log('显示测试通知...');
        const notificationUrl = getExtensionURL('backup_reminder/notification.html') +
            '?type=test' +
            (activeWindowId ? `&windowId=${activeWindowId}` : '');

        if (isCreatingNotification) {
            console.log('已有通知正在创建，跳过测试通知');
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
                    else { console.log(`测试通知窗口已创建，ID: ${window.id}`); resolve({ windowId: window.id }); }
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
        console.log('强制显示备份提醒通知...');
        const notificationUrl = getExtensionURL('backup_reminder/notification.html') +
            '?force=true&emergency=true&t=' + Date.now() +
            (activeWindowId ? `&windowId=${activeWindowId}` : '');

        if (isCreatingNotification) {
            console.log('已有通知正在创建，跳过强制通知');
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
                    else { console.log(`强制通知窗口已创建，ID: ${window.id}`); resolve(window.id); }
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
    addLog('已添加窗口关闭监听器');
} else if (browserAPI.windows && browserAPI.windows.onRemoved) {
    addLog('窗口关闭监听器已存在');
} else {
    addLog('浏览器不支持 windows.onRemoved 监听器');
}

/**
 * 监听来自通知弹窗的用户操作信号和其他消息。
 */
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'notificationUserAction' && activeNotificationInfo && message.windowId === activeNotificationInfo.windowId) {
        const expectedAlarmName = activeNotificationInfo.alarmName;
        if (message.alarmName !== expectedAlarmName) {
             addLog(`收到用户操作信号，但 alarmName 不匹配 (预期: ${expectedAlarmName}, 收到: ${message.alarmName})，已忽略`);
             return false;
        }

        addLog(`收到来自通知窗口 ${message.windowId} (Alarm: ${message.alarmName}) 的用户操作信号 (按钮: ${message.button || '未知'})`);
        const reasonKey = getReasonStorageKey(message.alarmName);
        browserAPI.storage.local.set({ [reasonKey]: 'user_action' })
            .then(() => addLog(`已记录通知关闭原因 (${reasonKey}): user_action (来自按钮点击)`))
            .catch(err => addLog(`记录 user_action 关闭原因 (${reasonKey}) 失败: ${err.message}`));

    } else if (message.action === 'pauseNotificationAutoClose' && activeNotificationInfo && message.windowId === activeNotificationInfo.windowId) {
        pauseAutoCloseTimer();
    } else if (message.action === 'resumeNotificationAutoClose' && activeNotificationInfo && message.windowId === activeNotificationInfo.windowId) {
        resumeAutoCloseTimer(activeNotificationInfo.windowId);
    }
    return false;
});
addLog('已添加 runtime 消息监听器 (用于 notification user action)');

// =======================================================
// 模块导出
// =======================================================
export { showBackupReminder, closeNotification, clearNotification, checkNotificationPermission, showTestNotification, showForceBackupReminder, resumeAutoCloseTimer };
