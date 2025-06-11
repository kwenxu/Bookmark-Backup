// =======================================================
// 模块导入
// =======================================================
// 导入通知模块的相关函数
import { showBackupReminder, clearNotification } from './notification.js';
// 导入主模块的活动通知窗口ID和更新函数
import { activeNotificationWindowId, updateActiveNotificationWindowId, setTimerPausedBySettingsUI } from './index.js';

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
// 常量定义
// =======================================================
// 闹钟名称常量
const BACKUP_REMINDER_ALARM = 'backupReminderAlarm';
const PROGRESS_TRACKER_ALARM = 'backupReminderProgressAlarm';
const FIXED_TIME_ALARM_1 = 'fixedTimeAlarm1';
const FIXED_TIME_ALARM_2 = 'fixedTimeAlarm2';

// 日志记录相关常量
const MAX_LOGS = 100; // 最大日志条数

// 提醒阶段常量
const REMINDER_PHASE = {
    FIRST: 'first',
    SECOND: 'second',
    THIRD: 'third',
    REPEAT: 'repeat'
};

// =======================================================
// 全局变量与状态
// =======================================================
const recentLogs = []; // 保存最近的日志
let isReminderTimerSystemInitialized = false; // 系统初始化标记
let isInitializationInProgress = false; // 初始化过程标记
let initializationAttempts = 0; // 初始化次数计数
let manualStartupResetHandled = false; // 标记 loadReminderState 是否处理了手动模式启动重置
// 添加时间戳变量，防止短时间内重复启动计时器
let lastTimerStartAttemptTime = 0;
const MIN_TIMER_START_INTERVAL = 1000; // 1秒内不允许重复启动计时器

// 确保全局变量在不同环境中都能正常使用
if (typeof globalThis.isCleaningUp === 'undefined') {
    globalThis.isCleaningUp = false;
}
if (typeof globalThis.phaseAdvancedByBackup === 'undefined') {
    globalThis.phaseAdvancedByBackup = {};
}
if (typeof globalThis.lastMarkManualBackupDoneTime === 'undefined') {
    globalThis.lastMarkManualBackupDoneTime = 0;
}
if (typeof globalThis.startReminderTimerRecursionCount === 'undefined') {
    globalThis.startReminderTimerRecursionCount = 0;
}

// 全局计时器控制器 - 使用chrome.alarms API替代setTimeout/clearTimeout
const timerController = {
    timerGeneration: 0, // 计时器代数，每次创建新计时器时递增

    /**
     * 取消所有循环提醒相关的计时器。
     */
    clearAllTimers() {
        this.clearMainTimer();
        this.clearProgressTracker();
        this.timerGeneration++; // 递增计数器代数
        addLog(`计时器控制器: 已清除循环提醒计时器，新代数 ${this.timerGeneration}`);
    },

    /**
     * 清除主计时器闹钟。
     * @returns {boolean} 是否成功清除。
     */
    clearMainTimer() {
        addLog(`计时器控制器: 清除主计时器 ${BACKUP_REMINDER_ALARM}`);
        browserAPI.alarms.clear(BACKUP_REMINDER_ALARM);
        return true;
    },

    /**
     * 清除进度跟踪器闹钟。
     * @returns {boolean} 是否成功清除。
     */
    clearProgressTracker() {
        addLog(`计时器控制器: 清除进度跟踪器 ${PROGRESS_TRACKER_ALARM}`);
        browserAPI.alarms.clear(PROGRESS_TRACKER_ALARM);
        return true;
    },

    /**
     * 清除所有准点定时闹钟。
     * @returns {boolean} 是否成功清除。
     */
    clearFixedTimeAlarms() {
        addLog(`计时器控制器: 清除准点定时闹钟`);
        browserAPI.alarms.clear(FIXED_TIME_ALARM_1);
        browserAPI.alarms.clear(FIXED_TIME_ALARM_2);
        return true;
    },

    /**
     * 清除特定的准点定时闹钟。
     * @param {string} alarmName - 闹钟名称 (FIXED_TIME_ALARM_1 或 FIXED_TIME_ALARM_2)。
     * @returns {boolean} 是否成功清除。
     */
    clearFixedTimeAlarm(alarmName) {
        addLog(`计时器控制器: 清除准点定时闹钟 ${alarmName}`);
        browserAPI.alarms.clear(alarmName);
        return true;
    },

    /**
     * 设置新的主计时器闹钟。
     * @param {number} delay - 延迟时间（毫秒）。
     * @returns {Promise<string>} 闹钟名称。
     */
    async setMainTimer(delay) {
        this.clearMainTimer();
        const currentGeneration = this.timerGeneration;
        const whenTime = Date.now() + delay;
        await browserAPI.alarms.create(BACKUP_REMINDER_ALARM, { when: whenTime });
        const delayInSeconds = delay / 1000;
        addLog(`计时器控制器: 创建新的闹钟 ${BACKUP_REMINDER_ALARM}，代数 ${currentGeneration}，延迟 ${delayInSeconds}秒，触发时间: ${new Date(whenTime).toLocaleString()}`);
        return BACKUP_REMINDER_ALARM;
    },

    /**
     * 设置新的进度跟踪器闹钟。
     * @param {number} interval - 间隔时间（毫秒）。
     * @returns {Promise<string>} 闹钟名称。
     */
    async setProgressTracker(interval) {
        this.clearProgressTracker();
        const currentGeneration = this.timerGeneration;
        const intervalInMinutes = interval / 60000;
        await browserAPI.alarms.create(PROGRESS_TRACKER_ALARM, { periodInMinutes: intervalInMinutes });
        addLog(`计时器控制器: 创建新的进度跟踪闹钟 ${PROGRESS_TRACKER_ALARM}，代数 ${currentGeneration}，间隔 ${interval}ms (${intervalInMinutes}分钟)`);
        return PROGRESS_TRACKER_ALARM;
    },

    /**
     * 设置准点定时闹钟1。
     * @param {string} timeStr - 时间字符串 (HH:MM格式)。
     * @param {boolean} [forceNextDay=false] - 是否强制设置为明天。
     * @returns {Promise<string|null>} 闹钟名称或null。
     */
    async setFixedTimeAlarm1(timeStr, forceNextDay = false) {
        this.clearFixedTimeAlarm(FIXED_TIME_ALARM_1);
        const currentGeneration = this.timerGeneration;
        const whenTime = calculateNextFixedTime(timeStr, forceNextDay);
        if (!whenTime) { addLog(`计时器控制器: 无法为时间 ${timeStr} 创建准点定时闹钟1`); return null; }
        await browserAPI.alarms.create(FIXED_TIME_ALARM_1, { when: whenTime });
        addLog(`计时器控制器: 创建新的准点定时闹钟1 ${FIXED_TIME_ALARM_1}，代数 ${currentGeneration}，时间: ${timeStr}，触发时间: ${new Date(whenTime).toLocaleString()}`);
        return FIXED_TIME_ALARM_1;
    },

    /**
     * 设置准点定时闹钟2。
     * @param {string} timeStr - 时间字符串 (HH:MM格式)。
     * @param {boolean} [forceNextDay=false] - 是否强制设置为明天。
     * @returns {Promise<string|null>} 闹钟名称或null。
     */
    async setFixedTimeAlarm2(timeStr, forceNextDay = false) {
        this.clearFixedTimeAlarm(FIXED_TIME_ALARM_2);
        const currentGeneration = this.timerGeneration;
        const whenTime = calculateNextFixedTime(timeStr, forceNextDay);
        if (!whenTime) { addLog(`计时器控制器: 无法为时间 ${timeStr} 创建准点定时闹钟2`); return null; }
        await browserAPI.alarms.create(FIXED_TIME_ALARM_2, { when: whenTime });
        addLog(`计时器控制器: 创建新的准点定时闹钟2 ${FIXED_TIME_ALARM_2}，代数 ${currentGeneration}，时间: ${timeStr}，触发时间: ${new Date(whenTime).toLocaleString()}`);
        return FIXED_TIME_ALARM_2;
    }
};

// 全局状态对象 - 用于跟踪计时器状态
const reminderState = {
    startTime: null,           // 计时器启动时间戳
    targetTime: null,          // 目标触发时间戳
    elapsedTime: 0,            // 已经过时间（毫秒）
    reminderShown: false,      // 是否已显示提醒
    isActive: true,            // 浏览器是否处于活跃状态
    manualBackupDone: false,   // 是否已完成手动备份
    pauseTime: null,           // 暂停时间戳
    currentPhase: REMINDER_PHASE.FIRST, // 当前提醒阶段
    progressCheckpoints: []    // 进度检查点时间戳数组
};

// 状态调试工具简化版
const debugTools = {
    phaseHistory: [], // 跟踪当前阶段历史

    /**
     * 记录阶段变更。
     * @param {string} oldPhase - 旧阶段。
     * @param {string} newPhase - 新阶段。
     * @param {string} reason - 变更原因。
     */
    recordPhaseChange: function(oldPhase, newPhase, reason) {
        const timestamp = new Date().toISOString();
        const record = { timestamp, oldPhase, newPhase, reason };
        this.phaseHistory.unshift(record);
        if (this.phaseHistory.length > 20) { this.phaseHistory.pop(); }
        addLog(`阶段变更记录: ${oldPhase} -> ${newPhase}, 原因: ${reason}`);
        console.log('阶段变更记录:', record);
        browserAPI.storage.local.set({ phaseHistoryDebug: this.phaseHistory });
    },

    /**
     * 获取阶段历史。
     * @returns {Promise<Array<object>>} 阶段历史记录数组。
     */
    getPhaseHistory: async function() {
        try {
            const data = await browserAPI.storage.local.get('phaseHistoryDebug');
            if (data.phaseHistoryDebug) { this.phaseHistory = data.phaseHistoryDebug; }
            return this.phaseHistory;
        } catch (error) {
            console.error('获取阶段历史失败:', error);
            return [];
        }
    }
};

// =======================================================
// 辅助函数
// =======================================================

/**
 * 日志记录函数。
 * @param {string} message - 要记录的消息。
 */
function addLog(message) {
    const now = new Date();
    const timeString = now.toLocaleString();
    const fullMessage = `[备份提醒计时器] [${timeString}] [循环提醒] ${message}`;
    console.log(fullMessage);
    recentLogs.push(fullMessage);
    if (recentLogs.length > MAX_LOGS) { recentLogs.shift(); }
}

/**
 * 格式化日期时间用于日志。
 * @param {string} isoString - ISO 格式的日期时间字符串。
 * @returns {string} 格式化后的日期时间字符串。
 */
function formatDateTimeForLog(isoString) {
    if (!isoString) return 'N/A';
    try {
        return new Date(isoString).toLocaleString('zh-CN', { hour12: false });
    } catch (e) {
        return 'Invalid Date';
    }
}

/**
 * 获取提醒设置。
 * @returns {Promise<object>} 提醒设置。
 */
async function getReminderSettings() {
    try {
        const data = await browserAPI.storage.local.get('reminderSettings');
        const defaultSettings = {
            reminderEnabled: true, firstReminderMinutes: 30,
            fixedTimeEnabled1: true, fixedTime1: "09:30",
            fixedTimeEnabled2: false, fixedTime2: "16:00"
        };
        const settings = data.reminderSettings || {};
        return { ...defaultSettings, ...settings };
    } catch (error) {
        addLog(`获取提醒设置失败: ${error.message}`);
        return {
            reminderEnabled: true, firstReminderMinutes: 30,
            fixedTimeEnabled1: true, fixedTime1: "09:30",
            fixedTimeEnabled2: false, fixedTime2: "16:00"
        };
    }
}

/**
 * 获取当前阶段的提醒配置。
 * @param {string} phase - 当前阶段。
 * @param {object} settings - 提醒设置。
 * @returns {object} 包含提醒时间和文本的配置对象。
 */
function getPhaseConfig(phase, settings) {
    const result = { minutes: 0, displayText: '备份提醒', isDisabled: false };
    result.minutes = settings.firstReminderMinutes || 1;
    result.displayText = '循环提醒';
    result.isDisabled = settings.firstReminderMinutes === 0 || settings.reminderEnabled === false;
    return result;
}

/**
 * 获取当前阶段的延迟时间（毫秒）。
 * @returns {Promise<number>} 延迟时间（毫秒）。
 */
async function getCurrentPhaseDelay() {
    const settings = await getReminderSettings();
    if (settings.reminderEnabled === false) {
        addLog('循环提醒功能已禁用，返回最大安全整数作为延迟');
        return Number.MAX_SAFE_INTEGER;
    }
    if (settings.firstReminderMinutes <= 0) {
        addLog('循环提醒间隔设置为0或负数，视为禁用');
        return Number.MAX_SAFE_INTEGER;
    }
    const delayMs = (settings.firstReminderMinutes || 1) * 60 * 1000;
    addLog(`循环提醒延迟时间计算结果: ${delayMs}毫秒 (${settings.firstReminderMinutes}分钟)`);
    return delayMs;
}

/**
 * 检查是否应该显示提醒。
 * @returns {Promise<boolean>} 是否应该显示提醒。
 */
async function checkReminderStatus() {
    try {
        const autoBackupEnabled = await isAutoBackupEnabled();
        if (autoBackupEnabled) { addLog(`当前自动备份状态: 已启用，无需显示提醒`); return false; }
        addLog(`当前自动备份状态: 已禁用`);
        const settings = await getReminderSettings();
        if (!settings.reminderEnabled) { addLog(`手动备份提醒功能已禁用，无需显示提醒`); return false; }
        const reminderTime = await getCurrentPhaseDelay();
        if (reminderState.currentPhase === REMINDER_PHASE.FIRST && settings.firstReminderMinutes === 0) { addLog(`第一次提醒已禁用，无需显示提醒`); return false; }
        if (reminderState.currentPhase === REMINDER_PHASE.SECOND && settings.secondReminderMinutes === 0) { addLog(`第二次提醒已禁用，无需显示提醒`); setupNextPhase(true); startReminderTimer(true); return false; }
        if (reminderState.currentPhase === REMINDER_PHASE.THIRD && settings.thirdReminderMinutes === 0) { addLog(`第三次提醒已禁用，无需显示提醒`); reminderState.currentPhase = REMINDER_PHASE.REPEAT; startReminderTimer(true); return false; }
        if (reminderState.currentPhase === REMINDER_PHASE.REPEAT && settings.repeatReminderDays === 0) { addLog(`重复提醒已禁用，无需显示提醒`); resetReminderState(); return false; }
        addLog(`循环提醒时间为 ${reminderTime / 60000} 分钟，各项条件检查通过，应该显示提醒`);
        return true;
    } catch (error) {
        addLog(`检查提醒状态时出错: ${error.message}`);
        return true;
    }
}

/**
 * 设置下一个提醒阶段。
 * @param {boolean} skipCurrent - 是否跳过当前阶段。
 */
function setupNextPhase(skipCurrent) {
    reminderState.reminderShown = false;
    reminderState.currentPhase = REMINDER_PHASE.FIRST;
    saveReminderState();
}

/**
 * 为长时间延迟创建进度检查点。
 * @param {number} totalDelay - 总延迟时间（毫秒）。
 * @returns {Array<number>} 检查点时间戳数组。
 */
function createProgressCheckpoints(totalDelay) {
    const checkpoints = [];
    const now = Date.now();
    const targetTime = now + totalDelay;
    const preCheckInterval = Math.min(60 * 1000, totalDelay * 0.05);

    if (totalDelay > 2 * 60 * 1000) {
        checkpoints.push(targetTime - preCheckInterval);
        addLog(`创建了1个预检查点，总时间: ${totalDelay/1000}秒，预检查点设置在目标时间前${preCheckInterval/1000}秒`);
        addLog(`检查点: ${new Date(checkpoints[0]).toLocaleString()}, 目标时间: ${new Date(targetTime).toLocaleString()}`);
    } else {
        addLog(`总时间较短 (${totalDelay/1000}秒)，不设置额外检查点，直接等待目标时间`);
    }
    return checkpoints;
}

/**
 * 设置下一个进度检查点。
 * @param {Array<number>} checkpoints - 检查点时间戳数组。
 * @returns {Promise<boolean>} 是否设置了下一个检查点。
 */
async function setNextProgressCheckpoint(checkpoints) {
    if (!checkpoints || checkpoints.length === 0) { addLog('没有可用的检查点'); return false; }
    const now = Date.now();
    const nextCheckpoint = checkpoints.find(checkpoint => checkpoint > now);
    if (!nextCheckpoint) { addLog('没有未来的检查点可用'); return false; }
    const delay = nextCheckpoint - now;
    timerController.clearProgressTracker();
    await browserAPI.alarms.create(PROGRESS_TRACKER_ALARM, { when: nextCheckpoint });
    const delayInSeconds = delay / 1000;
    addLog(`设置下一个进度检查点: ${new Date(nextCheckpoint).toLocaleString()}, 延迟: ${delayInSeconds}秒`);
    reminderState.progressCheckpoints = checkpoints;
    saveReminderState();
    return true;
}

/**
 * 计算下一个准点定时的时间点。
 * @param {string} timeStr - 时间字符串 (HH:MM格式)。
 * @param {boolean} [forceNextDay=false] - 是否强制设置为明天。
 * @returns {number|null} 时间戳，或null如果无效。
 */
function calculateNextFixedTime(timeStr, forceNextDay = false) {
    try {
        if (!timeStr || typeof timeStr !== 'string') { addLog(`无效的时间字符串: ${timeStr} (${typeof timeStr})`); return null; }
        const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
        if (!timePattern.test(timeStr)) {
            addLog(`时间字符串格式不符合 HH:MM: ${timeStr}`);
            const parts = timeStr.split(':');
            if (parts.length === 2) {
                let hour = parseInt(parts[0], 10);
                let minute = parseInt(parts[1], 10);
                if (!isNaN(hour)) { hour = Math.max(0, Math.min(23, hour)); } else { addLog(`无法解析小时值: ${parts[0]}`); return null; }
                if (!isNaN(minute)) { minute = Math.max(0, Math.min(59, minute)); } else { addLog(`无法解析分钟值: ${parts[1]}`); return null; }
                const fixedTimeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                addLog(`已修复时间格式: ${timeStr} -> ${fixedTimeStr}`);
                timeStr = fixedTimeStr;
            } else { addLog(`无法修复时间格式: ${timeStr}`); return null; }
        }
        const [hourStr, minuteStr] = timeStr.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);
        if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) { addLog(`无效的时间值: 小时=${hour}, 分钟=${minute}`); return null; }
        const now = new Date();
        const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
        if (forceNextDay || targetTime.getTime() <= now.getTime()) {
            targetTime.setDate(targetTime.getDate() + 1);
            if (forceNextDay) { addLog(`按要求强制将目标时间 ${timeStr} 设置为明天 ${targetTime.toLocaleString()}`); }
            else { addLog(`目标时间 ${timeStr} 今天已过，设置为明天 ${targetTime.toLocaleString()}`); }
        } else { addLog(`目标时间 ${timeStr} 设置为今天 ${targetTime.toLocaleString()}`); }
        return targetTime.getTime();
    } catch (error) {
        addLog(`计算准点时间出错: ${error.message}`);
        return null;
    }
}

/**
 * 统计书签数量的函数。
 * @returns {Promise<{bookmarkCount: number, folderCount: number}>}
 */
async function countBookmarks() {
    try {
        const bookmarks = await browserAPI.bookmarks.getTree();
        let bookmarkCount = 0;
        let folderCount = 0;

        function countItemsRecursive(node) {
            let bmCount = 0;
            let fldCount = 0;
            if (node.url) { bmCount = 1; }
            else if (node.children) {
                if (node.id !== "0" && node.id !== "root________" &&
                    node.id !== "menu________" && node.id !== "toolbar_____" &&
                    node.id !== "unfiled_____" && node.id !== "mobile______") {
                    fldCount = 1;
                }
                for (let i = 0; i < node.children.length; i++) {
                    const childCounts = countItemsRecursive(node.children[i]);
                    bmCount += childCounts.bookmarks;
                    fldCount += childCounts.folders;
                }
            }
            return { bookmarks: bmCount, folders: fldCount };
        }

        if (bookmarks && bookmarks.length > 0 && bookmarks[0].children) {
             for (const rootChild of bookmarks[0].children) {
                  const counts = countItemsRecursive(rootChild);
                  bookmarkCount += counts.bookmarks;
                  folderCount += counts.folders;
             }
        }
        addLog(`准确计数: 书签=${bookmarkCount}, 文件夹=${folderCount}`);
        return { bookmarkCount, folderCount };
    } catch (error) {
        addLog(`统计书签数量出错: ${error.message}`);
        return { bookmarkCount: 0, folderCount: 0 };
    }
}

/**
 * 检查是否启用了自动备份。
 * @returns {Promise<boolean>} 是否启用自动备份。
 */
async function isAutoBackupEnabled() {
    try {
        const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
        return autoSync;
    } catch (error) {
        addLog(`检查自动备份状态失败: ${error.message}`);
        return true;
    }
}

/**
 * 计算书签和文件夹的变化。
 * @returns {Promise<{currentChangeDescription: string, currentHasChanges: boolean}>} 变化描述和是否有变化。
 */
async function calculateChanges() {
    let currentChangeDescription = "无变化";
    let currentHasChanges = false;
    try {
        const {
            lastSyncTime,
            syncHistory,
            lastSyncOperations,
            cachedRecordAfterClear
        } = await browserAPI.storage.local.get([
            'lastSyncTime',
            'syncHistory',
            'lastSyncOperations',
            'cachedRecordAfterClear'
        ]);

        const currentCounts = await countBookmarks();
        const currentBookmarkCount = currentCounts.bookmarkCount;
        const currentFolderCount = currentCounts.folderCount;
        addLog(`计算变化: 当前书签/文件夹数量: ${currentBookmarkCount} / ${currentFolderCount}`);

        const isSyncHistoryEmpty = !syncHistory || syncHistory.length === 0;

        if (isSyncHistoryEmpty) {
            addLog("计算变化: syncHistory为空，尝试使用cachedRecordAfterClear");
            if (cachedRecordAfterClear && cachedRecordAfterClear.bookmarkStats) {
                const prevStats = cachedRecordAfterClear.bookmarkStats;
                const prevBookmarkCount = prevStats.currentBookmarkCount ?? prevStats.currentBookmarks ?? 0;
                const prevFolderCount = prevStats.currentFolderCount ?? prevStats.currentFolders ?? 0;
                addLog(`计算变化: 上次备份数量 (来自cachedRecord): 书签=${prevBookmarkCount}, 文件夹=${prevFolderCount}`);

                const bookmarkDiff = currentBookmarkCount - prevBookmarkCount;
                const folderDiff = currentFolderCount - prevFolderCount;
                addLog(`计算变化 (来自cachedRecord): 数量差异: 书签=${bookmarkDiff}, 文件夹=${folderDiff}`);

                const bookmarkMoved = lastSyncOperations?.bookmarkMoved || false;
                const folderMoved = lastSyncOperations?.folderMoved || false;
                const bookmarkModified = lastSyncOperations?.bookmarkModified || false;
                const folderModified = lastSyncOperations?.folderModified || false;
                addLog(`计算变化 (来自cachedRecord): 结构变化标志 (基于当前lastSyncOperations): 书签移动=${bookmarkMoved}, 文件夹移动=${folderMoved}, 书签修改=${bookmarkModified}, 文件夹修改=${folderModified}`);

                const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified;
                const hasNumericalChanges = bookmarkDiff !== 0 || folderDiff !== 0;
                currentHasChanges = hasStructuralChanges || hasNumericalChanges;

                if (currentHasChanges) {
                    let changeInfo = [];
                    if (bookmarkDiff !== 0) changeInfo.push(`${bookmarkDiff > 0 ? '+' : ''}${bookmarkDiff} 书签`);
                    if (folderDiff !== 0) changeInfo.push(`${folderDiff > 0 ? '+' : ''}${folderDiff} 文件夹`);
                    if (bookmarkModified || bookmarkMoved) changeInfo.push("书签变动");
                    if (folderModified || folderMoved) changeInfo.push("文件夹变动");
                    currentChangeDescription = `(${changeInfo.join('，')})`;
                } else {
                    currentChangeDescription = "无变化 (与缓存记录比较)";
                }
                addLog(`计算变化 (来自cachedRecord): 最终结果: ${currentChangeDescription}, 有变化=${currentHasChanges}`);
            } else {
                addLog("计算变化: syncHistory为空且无有效缓存记录，判定为无历史可比较的变化");
                currentHasChanges = false;
                currentChangeDescription = "无历史记录可比较";
            }
        } else {
            addLog("计算变化: syncHistory不为空，使用最新历史记录");
            const latestRecord = syncHistory[syncHistory.length - 1];
            let prevBookmarkCount = 0;
            let prevFolderCount = 0;

            if (latestRecord && latestRecord.bookmarkStats) {
                prevBookmarkCount = latestRecord.bookmarkStats.currentBookmarkCount ?? latestRecord.bookmarkStats.currentBookmarks ?? 0;
                prevFolderCount = latestRecord.bookmarkStats.currentFolderCount ?? latestRecord.bookmarkStats.currentFolders ?? 0;
                addLog(`计算变化: 上次备份数量 (来自 syncHistory): 书签=${prevBookmarkCount}, 文件夹=${prevFolderCount}`);

                const bookmarkDiff = currentBookmarkCount - prevBookmarkCount;
                const folderDiff = currentFolderCount - prevFolderCount;
                addLog(`计算变化: 数量差异: 书签=${bookmarkDiff}, 文件夹=${folderDiff}`);

                const bookmarkMoved = lastSyncOperations?.bookmarkMoved || false;
                const folderMoved = lastSyncOperations?.folderMoved || false;
                const bookmarkModified = lastSyncOperations?.bookmarkModified || false;
                const folderModified = lastSyncOperations?.folderModified || false;
                addLog(`计算变化: 结构变化标志: 书签移动=${bookmarkMoved}, 文件夹移动=${folderMoved}, 书签修改=${bookmarkModified}, 文件夹修改=${folderModified}`);

                const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified;
                const hasNumericalChanges = bookmarkDiff !== 0 || folderDiff !== 0;
                currentHasChanges = hasStructuralChanges || hasNumericalChanges;

                if (currentHasChanges) {
                    let changeInfo = [];
                    if (bookmarkDiff !== 0) changeInfo.push(`${bookmarkDiff > 0 ? '+' : ''}${bookmarkDiff} 书签`);
                    if (folderDiff !== 0) changeInfo.push(`${folderDiff > 0 ? '+' : ''}${folderDiff} 文件夹`);
                    if (bookmarkModified || bookmarkMoved) changeInfo.push("书签变动");
                    if (folderModified || folderMoved) changeInfo.push("文件夹变动");
                    currentChangeDescription = `(${changeInfo.join('，')})`;
                } else {
                    currentChangeDescription = "无变化";
                }
                addLog(`计算变化: 最终结果: ${currentChangeDescription}, 有变化=${currentHasChanges}`);
            } else {
                addLog("计算变化: 警告 - syncHistory中最新记录无有效统计数据");
                currentHasChanges = true;
                currentChangeDescription = "(无法计算具体变化)";
            }
        }
    } catch (error) {
        addLog(`计算变化函数出错: ${error.message}`);
        currentHasChanges = true;
        currentChangeDescription = "(检查备份状态时出错)";
    }
    return { currentChangeDescription, currentHasChanges };
}

/**
 * 保存提醒状态到存储。
 */
function saveReminderState() {
    try {
        const stateToSave = {
            startTime: reminderState.startTime,
            targetTime: reminderState.targetTime,
            elapsedTime: reminderState.elapsedTime,
            reminderShown: reminderState.reminderShown,
            isActive: reminderState.isActive,
            manualBackupDone: reminderState.manualBackupDone,
            pauseTime: reminderState.pauseTime,
            currentPhase: reminderState.currentPhase,
            progressCheckpoints: reminderState.progressCheckpoints
        };
        browserAPI.storage.local.set({ reminderState: stateToSave });
    } catch (error) {
        addLog(`保存提醒状态失败: ${error.message}`);
    }
}

/**
 * 从存储加载计时器状态。
 */
async function loadReminderState() {
    console.log('加载备份提醒状态...');
    try {
        const data = await browserAPI.storage.local.get(['reminderState', 'autoSync', 'lastReminderDate']);
        const autoSync = data.autoSync !== undefined ? data.autoSync : true;

        const today = new Date().toISOString().split('T')[0];
        const lastDate = data.lastReminderDate || '';
        const isNewDay = today !== lastDate;

        await browserAPI.storage.local.set({ lastReminderDate: today });

        if (isNewDay && data.reminderState && data.reminderState.startTime) {
            addLog(`发现日期已变更: ${lastDate} -> ${today}，按"当天事当天了结"原则重置循环提醒状态`);
            timerController.clearAllTimers();
            reminderState.startTime = null; reminderState.targetTime = null; reminderState.elapsedTime = 0;
            reminderState.reminderShown = false; reminderState.isActive = true; reminderState.manualBackupDone = false;
            reminderState.pauseTime = null; reminderState.currentPhase = REMINDER_PHASE.FIRST;
            reminderState.progressCheckpoints = [];
            saveReminderState();
            if (!autoSync) {
                addLog('新的一天开始，自动启动新的循环提醒计时器');
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
            }
            return;
        }

        timerController.clearAllTimers();

        if (data.reminderState) {
            if (!autoSync) {
                addLog('手动模式启动，检测到旧状态，将重置并开始新周期');
                resetReminderState();
                manualStartupResetHandled = true;
                addLog('设置 manualStartupResetHandled = true');
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
                return;
            }

            reminderState.elapsedTime = data.reminderState.elapsedTime || 0;
            reminderState.reminderShown = data.reminderState.reminderShown || false;
            reminderState.isActive = data.reminderState.isActive || true;
            reminderState.manualBackupDone = data.reminderState.manualBackupDone || false;
            reminderState.pauseTime = data.reminderState.pauseTime || null;
            reminderState.startTime = data.reminderState.startTime || null;
            reminderState.targetTime = data.reminderState.targetTime || null;
            reminderState.currentPhase = data.reminderState.currentPhase || REMINDER_PHASE.FIRST;
            reminderState.progressCheckpoints = data.reminderState.progressCheckpoints || [];

            console.log('已加载备份提醒状态:', data.reminderState);

            if (reminderState.targetTime && !reminderState.reminderShown && !reminderState.manualBackupDone && !autoSync) {
                const now = Date.now();
                if (now < reminderState.targetTime) {
                    const remainingTime = reminderState.targetTime - now;
                    setTimeout(async () => {
                        await timerController.setMainTimer(remainingTime);
                        const newCheckpoints = createProgressCheckpoints(remainingTime);
                        reminderState.progressCheckpoints = newCheckpoints;
                        await setNextProgressCheckpoint(newCheckpoints);
                        addLog(`从存储恢复计时器，剩余时间: ${remainingTime / 1000}秒，当前阶段: ${reminderState.currentPhase}`);
                    }, 100);
                } else {
                    addLog('已超过计时器触发时间，立即显示提醒');
                    setTimeout(() => { timerTriggered(); }, 500);
                }
            } else if (!autoSync && !reminderState.reminderShown && !reminderState.manualBackupDone) {
                addLog('需要启动新的计时器');
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
            }
        } else {
            addLog('存储中没有备份提醒状态，使用默认值');
            reminderState.currentPhase = REMINDER_PHASE.FIRST;
            if (!autoSync) {
                addLog('手动备份模式，启动计时器');
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
            }
        }
    } catch (error) {
        addLog(`加载备份提醒状态失败: ${error.message}`);
    }
}

// 确保在加载提醒状态后也加载阶段历史
const originalLoadReminderState = loadReminderState;
loadReminderState = async function() {
    await originalLoadReminderState();
    await debugTools.getPhaseHistory();
};

/**
 * 检查日期是否发生变化。
 * @returns {Promise<object>} 包含日期变化信息的对象。
 */
async function checkDateChange() {
    const today = new Date().toISOString().split('T')[0];
    return browserAPI.storage.local.get(['lastCheckedDate'])
        .then(data => {
            const lastCheckedDate = data.lastCheckedDate || today;
            const dateChanged = lastCheckedDate !== today;
            if (dateChanged) {
                addLog(`检测到日期变更: ${lastCheckedDate} -> ${today}`);
                return browserAPI.storage.local.set({ lastCheckedDate: today })
                    .then(() => { return { dateChanged: true, previousDate: lastCheckedDate, currentDate: today, timestamp: Date.now() }; });
            }
            return { dateChanged: false, currentDate: today, previousDate: lastCheckedDate, timestamp: Date.now() };
        })
        .catch(err => {
            addLog(`检查日期变更出错: ${err.message}`);
            return { dateChanged: false, currentDate: today, previousDate: today, timestamp: Date.now(), error: err.message };
        });
}

// =======================================================
// 核心计时器逻辑
// =======================================================

/**
 * 启动循环提醒计时器。
 * @param {boolean} [skipInitialReminder=false] - 是否跳过初始提醒，即使满足条件也不显示。
 * @returns {Promise<boolean>} 是否成功启动。
 */
async function startReminderTimer(skipInitialReminder = false) {
    // 添加时间戳检查，防止重复启动
    const now = Date.now();
    if (now - lastTimerStartAttemptTime < MIN_TIMER_START_INTERVAL) {
        addLog(`计时器最近已尝试启动 (${Math.round((now - lastTimerStartAttemptTime) / 1000)}秒前)，跳过此次调用`);
        return true; // 返回true以避免调用者认为启动失败
    }
    lastTimerStartAttemptTime = now;
    
    if (!globalThis.startReminderTimerRecursionCount) { globalThis.startReminderTimerRecursionCount = 0; }
    globalThis.startReminderTimerRecursionCount++;
    if (globalThis.startReminderTimerRecursionCount > 5) {
        addLog(`启动循环提醒计时器...递归太深，中止操作`);
        globalThis.startReminderTimerRecursionCount = 0;
        return false;
    }

    try {
        addLog(`启动循环提醒计时器... ${skipInitialReminder ? '(跳过初始提醒)' : ''}`);
        if (globalThis.isCleaningUp) {
            addLog(`系统正在清理，延迟500ms后重试启动计时器`);
            setTimeout(() => startReminderTimer(skipInitialReminder), 500);
            return false;
        }

        addLog(`当前阶段：${reminderState.currentPhase}`);
        const delayMs = await getCurrentPhaseDelay();
        addLog(`循环提醒延迟时间计算结果: ${delayMs}毫秒 (${delayMs / 60000}分钟)`);
        timerController.clearMainTimer();

        let shouldShowReminder = false;
        let changeDescriptionToShow = "";

        if (!skipInitialReminder) {
            shouldShowReminder = await checkReminderStatus();
            if (shouldShowReminder) {
                try {
                    const changes = await calculateChanges();
                    changeDescriptionToShow = changes.currentChangeDescription || "";
                    addLog(`初始提醒需要显示，获取到的变化: ${changeDescriptionToShow || '无变化'}`);
                } catch (calcError) {
                     addLog(`获取初始提醒变化描述失败: ${calcError.message}, 将显示无变化`);
                     changeDescriptionToShow = "";
                }
                addLog(`显示提醒窗口，循环提醒 (初始)`);
                await showBackupReminder(reminderState.currentPhase, changeDescriptionToShow);
            } else { addLog(`不满足显示条件，跳过初始提醒`); }
        } else { addLog(`已指定跳过初始提醒，仅设置计时器`); }

        const startTime = Date.now();
        const targetTime = startTime + delayMs;
        reminderState.startTime = startTime;
        reminderState.targetTime = targetTime;
        reminderState.reminderShown = shouldShowReminder;
        await timerController.setMainTimer(delayMs);

        if (delayMs <= 5 * 60 * 1000) {
            addLog(`总时间较短 (${delayMs / 1000}秒)，不设置额外检查点，直接等待目标时间`);
            reminderState.progressCheckpoints = [];
        } else {
            const checkpoints = createProgressCheckpoints(delayMs);
            reminderState.progressCheckpoints = checkpoints;
            await setNextProgressCheckpoint(checkpoints);
        }

        if (!reminderState.progressCheckpoints || reminderState.progressCheckpoints.length === 0) { addLog(`没有可用的检查点`); }
        await saveReminderState();
        addLog(`循环提醒计时器已启动，当前阶段: ${reminderState.currentPhase}, 延迟: ${delayMs / 60000}分钟(${delayMs / 1000}秒), 目标时间: ${new Date(targetTime).toLocaleString()}`);
        globalThis.startReminderTimerRecursionCount = 0;
        return true;
    } catch (error) {
        addLog(`启动循环提醒计时器出错: ${error.message}`);
        globalThis.startReminderTimerRecursionCount = 0;
        return false;
    }
}

/**
 * 停止循环提醒计时器。
 * @returns {void}
 */
function stopReminderTimer() {
    if (!reminderState.startTime) { addLog('没有正在运行的循环提醒计时器，忽略停止操作'); return; }
    addLog('停止循环提醒计时器...');
    timerController.clearAllTimers();
    reminderState.startTime = null; reminderState.targetTime = null; reminderState.elapsedTime = 0;
    reminderState.reminderShown = false; reminderState.isActive = true; reminderState.manualBackupDone = false;
    reminderState.pauseTime = null; reminderState.currentPhase = REMINDER_PHASE.FIRST;
    reminderState.progressCheckpoints = [];
    saveReminderState();
    addLog("循环提醒计时器已停止");
}

/**
 * 暂停循环提醒计时器。
 * @returns {void}
 */
function pauseReminderTimer() {
    if (reminderState.isActive && reminderState.startTime && !reminderState.reminderShown) {
        addLog('暂停循环提醒计时器...');
        timerController.clearAllTimers();
        reminderState.elapsedTime = Date.now() - reminderState.startTime;
        reminderState.pauseTime = Date.now();
        reminderState.isActive = false;
        saveReminderState();
        addLog(`循环提醒计时器已暂停，已经过时间: ${reminderState.elapsedTime / 1000}秒`);
    }
}

/**
 * 恢复循环提醒计时器。
 * @returns {Promise<boolean>} 是否成功恢复。
 */
async function resumeReminderTimer() {
    try {
        setTimerPausedBySettingsUI(false);
        addLog('[resumeReminderTimer] 已通知 index.js 计时器不再因设置UI暂停');
    } catch(e) { addLog(`[resumeReminderTimer] 调用 setTimerPausedBySettingsUI(false) 失败: ${e.message}`); }

    if (!reminderState.isActive && reminderState.startTime && !reminderState.reminderShown) {
        addLog('恢复循环提醒计时器...');
        const pauseDuration = reminderState.pauseTime ? Date.now() - reminderState.pauseTime : 0;
        reminderState.pauseTime = null;
        reminderState.isActive = true;
        const currentSettingDelay = await getCurrentPhaseDelay();
        let remainingTime = 0;

        if (reminderState.targetTime) {
            if (pauseDuration > 0) {
                reminderState.targetTime += pauseDuration;
                addLog(`由于暂停了 ${pauseDuration/1000} 秒，目标时间调整为: ${new Date(reminderState.targetTime).toLocaleString()}`);
            }
            remainingTime = Math.max(0, reminderState.targetTime - Date.now());
            if (remainingTime > currentSettingDelay * 2) {
                addLog(`剩余时间 (${remainingTime/1000}秒) 异常，超过设置时间的两倍，重置为当前设置: ${currentSettingDelay/1000}秒`);
                remainingTime = currentSettingDelay;
                reminderState.targetTime = Date.now() + remainingTime;
            }
        } else {
            addLog(`没有有效的目标时间，使用当前设置的延迟时间: ${currentSettingDelay/1000}秒`);
            remainingTime = currentSettingDelay;
            reminderState.targetTime = Date.now() + remainingTime;
        }

        if (remainingTime < 10000) {
            addLog(`剩余时间过短 (${remainingTime/1000}秒)，设置为最小延迟10秒`);
            remainingTime = 10000;
            reminderState.targetTime = Date.now() + remainingTime;
        }

        await timerController.setMainTimer(remainingTime);
        const newCheckpoints = createProgressCheckpoints(remainingTime);
        reminderState.progressCheckpoints = newCheckpoints;
        await setNextProgressCheckpoint(newCheckpoints);
        saveReminderState();
        addLog(`循环提醒计时器已恢复，暂停时长: ${pauseDuration / 1000}秒，剩余时间: ${remainingTime / 1000}秒，目标时间: ${new Date(reminderState.targetTime).toLocaleString()}`);
    }
    return true;
}

/**
 * 标记手动备份已完成。
 * @returns {void}
 */
function markManualBackupDone() {
    addLog(`手动备份已完成，更新状态`);
    reminderState.manualBackupDone = true;
    reminderState.reminderShown = false;
    browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck');
    addLog('手动备份完成，已重置书签活动标志');
    startReminderTimer(true);
}

/**
 * 计时器触发函数。
 * @returns {Promise<void>}
 */
async function timerTriggered() {
    try {
        addLog(`计时器触发函数被调用，准备检查是否需要显示提醒`);
        timerController.clearAllTimers();

        const { autoSync } = await browserAPI.storage.local.get(['autoSync']);
        if (autoSync) { addLog(`当前为自动备份模式，忽略循环提醒触发`); return; }
        addLog(`当前为手动备份模式，检查状态`);

        const { hasBookmarkActivitySinceLastCheck, lastNotificationClosedReason } = await browserAPI.storage.local.get(['hasBookmarkActivitySinceLastCheck', 'lastNotificationClosedReason']);
        await browserAPI.storage.local.remove('lastNotificationClosedReason');
        addLog(`上次通知关闭原因: ${lastNotificationClosedReason}`);

        if (hasBookmarkActivitySinceLastCheck) {
            addLog(`检测到书签活动标志`);
            const { currentChangeDescription, currentHasChanges } = await calculateChanges();
            addLog(`调用 calculateChanges 结果: 有变化=${currentHasChanges}, 描述='${currentChangeDescription}'`);

            if (currentHasChanges) {
                const timeAllows = await checkReminderStatus();
                if (timeAllows) {
                    addLog(`检测到新变化且满足时间规则，将显示通知: ${currentChangeDescription}`);
                    await browserAPI.storage.local.set({ lastNotificationChangeDescription: currentChangeDescription });
                    await showBackupReminder(reminderState.currentPhase, currentChangeDescription);
                    addLog(`已请求显示通知窗口，等待其关闭以启动下一计时器...`);
                } else {
                    addLog(`检测到新变化但不满足时间规则，不显示通知`);
                    startReminderTimer(true);
                }
            } else {
                addLog(`有活动标志但 calculateChanges 计算无变化，不显示通知。描述: '${currentChangeDescription}'`);
                startReminderTimer(true);
            }
        } else {
            addLog(`无书签活动标志`);
            if (lastNotificationClosedReason === 'timeout' || lastNotificationClosedReason === 'manual_close') {
                addLog(`上次通知关闭原因 (${lastNotificationClosedReason}) 表明可能需要再次提醒，重新检查当前变化...`);
                const { currentChangeDescription, currentHasChanges } = await calculateChanges();
                addLog(`无活动标志，重新调用 calculateChanges 结果: 有变化=${currentHasChanges}, 描述='${currentChangeDescription}'`);

                if (currentHasChanges) {
                    const timeAllows = await checkReminderStatus();
                    if (timeAllows) {
                        addLog(`无活动标志但重新计算有变化且满足时间规则，将显示通知: ${currentChangeDescription}`);
                        await browserAPI.storage.local.set({ lastNotificationChangeDescription: currentChangeDescription });
                        await showBackupReminder(reminderState.currentPhase, currentChangeDescription);
                        addLog(`已请求显示通知窗口，等待其关闭以启动下一计时器...`);
                    } else {
                        addLog(`无活动标志但重新计算有变化但不满足时间规则，不显示通知`);
                        startReminderTimer(true);
                    }
                } else {
                    addLog(`无活动标志，重新计算也无变化，取消本次提醒`);
                    startReminderTimer(true);
                }
            } else {
                addLog(`上次通知已处理 ('${lastNotificationClosedReason}') 或无记录，跳过本次通知`);
                startReminderTimer(true);
            }
        }
    } catch (error) {
        addLog(`计时器触发函数顶层出错: ${error.message}`);
        try {
            await browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck');
            await browserAPI.storage.local.remove('lastNotificationClosedReason');
            addLog('顶层错误处理中重置相关标志');
        } catch (removeError) { addLog(`顶层错误处理中重置标志失败: ${removeError.message}`); }
        startReminderTimer(true);
    }
}

/**
 * 处理alarm事件的监听器。
 * @param {chrome.alarms.Alarm} alarm - 触发的闹钟。
 */
function handleAlarm(alarm) {
    const alarmName = alarm.name;
    addLog(`收到闹钟触发：${alarmName}`);
    if (alarmName === BACKUP_REMINDER_ALARM) {
        timerTriggered();
    } else if (alarmName === PROGRESS_TRACKER_ALARM) {
        if (reminderState.startTime && !reminderState.reminderShown) {
            const elapsedTime = Date.now() - reminderState.startTime;
            reminderState.elapsedTime = elapsedTime;
            saveReminderState();
            const targetTime = reminderState.targetTime;
            addLog(`已经过时间: ${elapsedTime / 1000}秒，目标时间: ${targetTime ? new Date(targetTime).toLocaleString() : '未设置'}`);
            if (reminderState.progressCheckpoints && reminderState.progressCheckpoints.length > 0) {
                setNextProgressCheckpoint(reminderState.progressCheckpoints);
            }
        }
    } else if (alarmName === FIXED_TIME_ALARM_1 || alarmName === FIXED_TIME_ALARM_2) {
        addLog(`准点定时闹钟${alarmName}触发，开始处理...`);
        handleFixedTimeAlarm(alarmName).catch(error => { addLog(`处理准点定时闹钟${alarmName}失败: ${error.message}`); });
    }
}

/**
 * 处理准点定时闹钟事件。
 * @param {string} alarmName - 闹钟名称 (FIXED_TIME_ALARM_1 或 FIXED_TIME_ALARM_2)。
 * @returns {Promise<void>}
 */
async function handleFixedTimeAlarm(alarmName) {
    try {
        addLog(`收到准点定时闹钟触发：${alarmName}`);
        timerController.clearFixedTimeAlarm(alarmName);
        const settings = await getReminderSettings();
        const autoBackupEnabled = await isAutoBackupEnabled();

        if (autoBackupEnabled) {
            addLog(`自动备份已启用，跳过准点定时提醒 ${alarmName}`);
            await resetFixedTimeAlarm(alarmName, 0);
            return;
        }

        addLog(`手动模式，处理准点定时提醒 ${alarmName}`);
        const reasonKey = alarmName === FIXED_TIME_ALARM_1 ? 'lastFT1NotificationClosedReason' : 'lastFT2NotificationClosedReason';
        const descriptionKey = alarmName === FIXED_TIME_ALARM_1 ? 'lastFT1NotificationChangeDescription' : 'lastFT2NotificationChangeDescription';

        const {
            hasBookmarkActivitySinceLastCheck,
            [reasonKey]: lastNotificationClosedReason,
            [descriptionKey]: lastNotificationChangeDescription
        } = await browserAPI.storage.local.get([
            'hasBookmarkActivitySinceLastCheck',
            reasonKey,
            descriptionKey
        ]);

        await browserAPI.storage.local.remove(reasonKey);
        addLog(`上次 ${alarmName} 通知关闭原因: ${lastNotificationClosedReason}`);

        let shouldShowNotification = false;
        let changeDescriptionToShow = "";

        if (hasBookmarkActivitySinceLastCheck) {
            addLog(`${alarmName}: 检测到书签活动标志`);
            try {
                const {currentChangeDescription, currentHasChanges} = await calculateChanges();
                if (currentHasChanges) {
                    addLog(`${alarmName}: 检测到新变化，将显示通知: ${currentChangeDescription}`);
                    await browserAPI.storage.local.set({ [descriptionKey]: currentChangeDescription });
                    changeDescriptionToShow = currentChangeDescription;
                    shouldShowNotification = true;
                } else {
                     addLog(`${alarmName}: 有活动标志但计算无变化，不显示通知`);
                     shouldShowNotification = false;
                }
            } catch (error) {
                 addLog(`${alarmName}: 计算变化数据出错: ${error.message}`);
                 await browserAPI.storage.local.remove(descriptionKey);
                 changeDescriptionToShow = "(检查备份状态时出错)";
                 shouldShowNotification = true;
                 addLog(`${alarmName}: 计算变化失败，仍显示通用通知`);
            }
        } else {
            addLog(`${alarmName}: 无书签活动标志`);
            if (lastNotificationClosedReason === 'timeout' || lastNotificationClosedReason === 'manual_close') {
                 addLog(`${alarmName}: 上次通知关闭原因 (${lastNotificationClosedReason}) 表明可能需要再次提醒，重新检查当前变化...`);
                 let currentChanges = { currentChangeDescription: "", currentHasChanges: false };
                 try {
                     currentChanges = await calculateChanges();
                     addLog(`${alarmName}: 重新检查结果: ${currentChanges.currentChangeDescription}, 有变化=${currentChanges.currentHasChanges}`);
                 } catch(calcError) {
                     addLog(`${alarmName}: 重新计算变化时出错: ${calcError.message}`);
                     currentChanges.currentHasChanges = false;
                 }

                 if (currentChanges.currentHasChanges) {
                     addLog(`${alarmName}: 检测到实际变化，将显示通知`);
                     changeDescriptionToShow = currentChanges.currentChangeDescription;
                     await browserAPI.storage.local.set({ [descriptionKey]: currentChanges.currentChangeDescription });
                     shouldShowNotification = true;
                 } else {
                     addLog(`${alarmName}: 备份后已无实际变化，取消本次提醒`);
                     shouldShowNotification = false;
                 }
            } else {
                addLog(`${alarmName}: 上次通知已处理 ('${lastNotificationClosedReason}') 或无记录，跳过本次通知`);
                shouldShowNotification = false;
            }
        }

        if (shouldShowNotification) {
            const timeLabel = alarmName === FIXED_TIME_ALARM_1 ?
                `准点定时1 (${settings.fixedTime1 || '未设置'})` :
                `准点定时2 (${settings.fixedTime2 || '未设置'})`;
            addLog(`${alarmName}: 显示准点定时提醒窗口 ${timeLabel}, 变化: ${changeDescriptionToShow}`);
            await showBackupReminder(alarmName, changeDescriptionToShow);
            addLog(`${alarmName}: 已请求显示通知窗口，等待其关闭以重置闹钟...`);
        } else {
            addLog(`${alarmName}: 无需显示通知，直接重置闹钟到下一天`);
            await resetFixedTimeAlarm(alarmName, 0);
        }
    } catch (error) {
        addLog(`处理准点定时闹钟 ${alarmName} 顶层出错: ${error.message}`);
        try { await resetFixedTimeAlarm(alarmName, 0); }
        catch (resetError) { addLog(`在错误处理中重置准点定时闹钟 ${alarmName} 也失败了: ${resetError.message}`); }
    }
}

/**
 * 闹钟触发后重设下一个准点定时闹钟。
 * @param {string} alarmName - 闹钟名称。
 * @param {number} [retryCount=0] - 重试次数。
 * @returns {Promise<object>} 设置结果。
 */
async function resetFixedTimeAlarm(alarmName, retryCount = 0) {
    const MAX_RETRIES = 2;
    try {
        const settings = await getReminderSettings();
        let result = null;

        if (alarmName === FIXED_TIME_ALARM_1 && settings.fixedTimeEnabled1 && settings.fixedTime1) {
            result = await timerController.setFixedTimeAlarm1(settings.fixedTime1, true);
            if (result) { addLog(`准点定时闹钟1已重置为明天 ${settings.fixedTime1}`); }
            else {
                addLog(`准点定时闹钟1重置失败`);
                if (retryCount < MAX_RETRIES) {
                    addLog(`准备重试设置准点定时闹钟1 (${retryCount + 1}/${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return resetFixedTimeAlarm(alarmName, retryCount + 1);
                }
            }
            return { success: !!result, alarm: FIXED_TIME_ALARM_1 };
        } else if (alarmName === FIXED_TIME_ALARM_2 && settings.fixedTimeEnabled2 && settings.fixedTime2) {
            result = await timerController.setFixedTimeAlarm2(settings.fixedTime2, true);
            if (result) { addLog(`准点定时闹钟2已重置为明天 ${settings.fixedTime2}`); }
            else {
                addLog(`准点定时闹钟2重置失败`);
                if (retryCount < MAX_RETRIES) {
                    addLog(`准备重试设置准点定时闹钟2 (${retryCount + 1}/${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return resetFixedTimeAlarm(alarmName, retryCount + 1);
                }
            }
            return { success: !!result, alarm: FIXED_TIME_ALARM_2 };
        } else {
            addLog(`无法重置准点定时闹钟 ${alarmName}，因为相关设置已禁用或无效`);
            return { success: false, alarm: alarmName, error: '设置已禁用或无效' };
        }
    } catch (error) {
        addLog(`重置准点定时闹钟 ${alarmName} 失败: ${error.message}`);
        if (retryCount < MAX_RETRIES) {
            addLog(`准备重试设置准点定时闹钟 ${alarmName} (${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return resetFixedTimeAlarm(alarmName, retryCount + 1);
        }
        return { success: false, alarm: alarmName, error: error.message };
    }
}

/**
 * 重置提醒状态。
 * @returns {void}
 */
function resetReminderState() {
    console.log('重置循环提醒状态');
    addLog('重置循环提醒状态');
    stopReminderTimer();
    reminderState.manualBackupDone = false;
    saveReminderState();
    addLog('循环提醒状态已重置');
}

/**
 * 获取调试信息。
 * @returns {object} 调试信息对象。
 */
function getDebugInfo() {
    return {
        startTime: reminderState.startTime,
        targetTime: reminderState.targetTime,
        elapsedTime: reminderState.elapsedTime,
        reminderShown: reminderState.reminderShown,
        isActive: reminderState.isActive,
        manualBackupDone: reminderState.manualBackupDone,
        pauseTime: reminderState.pauseTime,
        currentPhase: reminderState.currentPhase,
        now: Date.now()
    };
}

// =======================================================
// 系统初始化
// =======================================================

/**
 * 初始化计时器系统。
 * @returns {Promise<boolean>} 是否成功初始化。
 */
async function initializeReminderTimerSystem() {
    try {
        addLog('初始化备份提醒计时器系统...(第1次尝试)');
        if (isReminderTimerSystemInitialized) { addLog('备份提醒计时器系统已初始化，跳过重复初始化'); return true; }

        isInitializationInProgress = true;
        const currentDate = new Date();
        addLog(`当前日期: ${currentDate.toISOString().split('T')[0]}`);

        initAlarmListeners();
        globalThis.isReminderBackgroundActive = true;
        await resetReminderState();
        isReminderTimerSystemInitialized = true;
        isInitializationInProgress = false;
        addLog('全局变量已初始化');

        addLog('初始化循环提醒计时器...');
        await loadReminderState();
        const timerResult = await startReminderTimer(true);

        addLog('初始化准点定时闹钟...');
        const settings = await getReminderSettings();
        await setupFixedTimeAlarms(settings);
        addLog('所有准点定时功能初始化完成');

        setupDateChangeChecker();
        addLog(`计时器系统初始化完成，循环提醒已${settings.reminderEnabled ? '启用' : '禁用'}，准点定时1已${settings.fixedTimeEnabled1 ? '启用' : '禁用'}，准点定时2已${settings.fixedTimeEnabled2 ? '启用' : '禁用'}`);
        return true;
    } catch (error) {
        addLog(`初始化备份提醒计时器系统出错: ${error.message}`);
        isInitializationInProgress = false;
        return false;
    }
}

/**
 * 初始化闹钟监听器。
 */
function initAlarmListeners() {
    addLog("初始化闹钟监听器...");
    try {
        if (browserAPI.alarms && browserAPI.alarms.onAlarm.hasListener(handleAlarm)) {
            browserAPI.alarms.onAlarm.removeListener(handleAlarm);
            addLog("已移除旧的闹钟监听器 (初始化时)。");
        }
    } catch (removeError) { addLog(`尝试移除旧闹钟监听器失败 (可能不支持): ${removeError.message}`); }

    if (browserAPI.alarms) {
        browserAPI.alarms.onAlarm.addListener(handleAlarm);
        addLog("已成功添加闹钟监听器。");
    } else { addLog("错误：浏览器不支持 alarms API，无法设置监听器。", 'error'); }
}

/**
 * 设置准点定时闹钟。
 * @param {object} settings - 提醒设置。
 * @returns {Promise<object>} 设置结果。
 */
async function setupFixedTimeAlarms(settings) {
    try {
        timerController.clearFixedTimeAlarms();
        const results = { fixedTime1: null, fixedTime2: null };
        const now = new Date();

        if (settings.fixedTimeEnabled1 && settings.fixedTime1) {
            const [hours, minutes] = settings.fixedTime1.split(':').map(Number);
            const todayTarget = new Date(now);
            todayTarget.setHours(hours, minutes, 0, 0);
            if (todayTarget > now) {
                results.fixedTime1 = await timerController.setFixedTimeAlarm1(settings.fixedTime1);
                addLog(`准点定时1已设置为今天 ${settings.fixedTime1}`);
            } else {
                results.fixedTime1 = await timerController.setFixedTimeAlarm1(settings.fixedTime1);
                addLog(`准点定时1已设置为明天 ${settings.fixedTime1}，今天的时间点已过`);
            }
        } else { addLog('准点定时1未启用或时间无效'); }

        if (settings.fixedTimeEnabled2 && settings.fixedTime2) {
            const [hours, minutes] = settings.fixedTime2.split(':').map(Number);
            const todayTarget = new Date(now);
            todayTarget.setHours(hours, minutes, 0, 0);
            if (todayTarget > now) {
                results.fixedTime2 = await timerController.setFixedTimeAlarm2(settings.fixedTime2);
                addLog(`准点定时2已设置为今天 ${settings.fixedTime2}`);
            } else {
                results.fixedTime2 = await timerController.setFixedTimeAlarm2(settings.fixedTime2);
                addLog(`准点定时2已设置为明天 ${settings.fixedTime2}，今天的时间点已过`);
            }
        } else { addLog('准点定时2未启用或时间无效'); }
        return { success: true, results: results };
    } catch (error) {
        addLog(`设置准点定时闹钟失败: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * 扩展启动时检查准点定时设置并设置闹钟。
 * 原则：错过的闹钟不触发，只设置未来的闹钟。
 * 如果所有闹钟都已过期，则不设置任何闹钟，当天事当天了结。
 * @returns {Promise<object>} 设置结果。
 */
async function setupFixedTimeAlarmsOnStartup() {
    addLog("初始化准点定时功能...");
    try {
        const settings = await getReminderSettings();
        await timerController.clearFixedTimeAlarms();
        let results = [];

        if (settings.fixedTimeEnabled1) {
            addLog(`设置准点定时1: ${settings.fixedTime1}`);
            const today = new Date();
            const [hours, minutes] = settings.fixedTime1.split(':').map(num => parseInt(num));
            const todayTarget = new Date();
            todayTarget.setHours(hours, minutes, 0, 0);
            if (todayTarget > today) {
                addLog(`准点定时1已设置为今天 ${settings.fixedTime1}，触发时间: ${todayTarget.toLocaleString()}`);
                await timerController.setFixedTimeAlarm1(settings.fixedTime1, false);
            } else { addLog(`准点定时1今天 ${settings.fixedTime1} 已过，不设置闹钟`); }
        } else { addLog("准点定时1未启用，跳过设置"); }

        if (settings.fixedTimeEnabled2) {
            addLog(`设置准点定时2: ${settings.fixedTime2}`);
            const today = new Date();
            const [hours, minutes] = settings.fixedTime2.split(':').map(num => parseInt(num));
            const todayTarget = new Date();
            todayTarget.setHours(hours, minutes, 0, 0);
            if (todayTarget > today) {
                addLog(`准点定时2已设置为今天 ${settings.fixedTime2}，触发时间: ${todayTarget.toLocaleString()}`);
                await timerController.setFixedTimeAlarm2(settings.fixedTime2, false);
            } else { addLog(`准点定时2今天 ${settings.fixedTime2} 已过，不设置闹钟`); }
        } else { addLog("准点定时2未启用，跳过设置"); }

        if (settings.reminderEnabled && !await isAutoBackupEnabled()) {
            if (manualStartupResetHandled) {
                manualStartupResetHandled = false;
                addLog('loadReminderState 已处理手动启动重置，此处跳过启动循环提醒');
            } else {
                const firstReminderMinutes = settings.firstReminderMinutes || 30;
                if (firstReminderMinutes > 0) {
                    addLog(`初始化循环提醒，时间间隔: ${firstReminderMinutes}分钟`);
                    resetReminderState();
                    await startReminderTimer(true);
                } else { addLog('循环提醒时间间隔为0，不启动计时器'); }
            }
        } else { addLog(`循环提醒未启用或自动备份已开启，不启动计时器`); }
        addLog("所有准点定时功能初始化完成");
        return { success: true, message: "准点定时功能已初始化" };
    } catch (error) {
        addLog(`初始化准点定时功能失败: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * 每天零点后5秒检查日期变更的函数。
 */
function setupDateChangeChecker() {
    const now = new Date();
    const midnightPlus5Sec = new Date(now);
    midnightPlus5Sec.setHours(24, 0, 5, 0);
    const msUntilMidnightPlus5 = midnightPlus5Sec.getTime() - now.getTime();
    addLog(`设置零点后5秒的日期变更检查，将在 ${new Date(midnightPlus5Sec).toLocaleString()} (${msUntilMidnightPlus5/1000}秒后) 检查日期变更`);
    setTimeout(() => { scheduleMidnightCheck(); }, msUntilMidnightPlus5);

    function scheduleMidnightCheck() {
        checkDateChange().then(dateCheck => {
            if (dateCheck.dateChanged) {
                addLog(`零点后检查检测到日期变更，重新初始化准点定时闹钟`);
                setupFixedTimeAlarmsOnStartup().catch(err => { addLog(`重新设置准点定时闹钟失败: ${err.message}`); });
            }
            const nextCheckTime = new Date();
            nextCheckTime.setHours(24, 0, 5, 0);
            const timeToNextCheck = nextCheckTime.getTime() - Date.now();
            setTimeout(() => { scheduleMidnightCheck(); }, timeToNextCheck);
            addLog(`已设置下一次零点后5秒的日期变更检查，将在 ${nextCheckTime.toLocaleString()} 检查`);
        }).catch(err => {
            addLog(`零点后检查日期变更出错: ${err.message}`);
            setTimeout(() => { scheduleMidnightCheck(); }, 30 * 60 * 1000);
        });
    }
}

/**
 * 浏览器变为活跃状态时检查准点定时。
 * 如果当天的准点时间未到，且闹钟不存在，则设置闹钟。
 * 如果时间已过，则不设置闹钟，避免过时提醒。
 * @returns {Promise<boolean>} 是否设置了闹钟。
 */
async function checkFixedTimeAlarmsOnActive() {
    addLog('浏览器变为活跃状态，检查准点定时设置...');
    const now = new Date();
    const settings = await getReminderSettings();
    let hasSetAlarm = false;

    if (settings.fixedTimeEnabled1 && settings.fixedTime1) {
        const [hours, minutes] = settings.fixedTime1.split(':').map(Number);
        const todayTarget = new Date(now);
        todayTarget.setHours(hours, minutes, 0, 0);
        if (todayTarget > now) {
            const alarms = await browserAPI.alarms.getAll();
            const existingAlarm = alarms.find(a => a.name === FIXED_TIME_ALARM_1);
            if (!existingAlarm) {
                await timerController.setFixedTimeAlarm1(settings.fixedTime1);
                addLog(`浏览器活跃后设置准点定时1为今天 ${settings.fixedTime1}，触发时间: ${todayTarget.toLocaleString()}`);
            } else { addLog(`准点定时1已存在，触发时间: ${new Date(existingAlarm.scheduledTime).toLocaleString()}`); }
            hasSetAlarm = true;
        } else { addLog(`准点定时1今天 ${settings.fixedTime1} 已过，不设置闹钟`); }
    }

    if (settings.fixedTimeEnabled2 && settings.fixedTime2) {
        const [hours, minutes] = settings.fixedTime2.split(':').map(Number);
        const todayTarget = new Date(now);
        todayTarget.setHours(hours, minutes, 0, 0);
        if (todayTarget > now) {
            const alarms = await browserAPI.alarms.getAll();
            const existingAlarm = alarms.find(a => a.name === FIXED_TIME_ALARM_2);
            if (!existingAlarm) {
                await timerController.setFixedTimeAlarm2(settings.fixedTime2);
                addLog(`浏览器活跃后设置准点定时2为今天 ${settings.fixedTime2}，触发时间: ${todayTarget.toLocaleString()}`);
            } else { addLog(`准点定时2已存在，触发时间: ${new Date(existingAlarm.scheduledTime).toLocaleString()}`); }
            hasSetAlarm = true;
        } else { addLog(`准点定时2今天 ${settings.fixedTime2} 已过，不设置闹钟`); }
    }

    if (!hasSetAlarm) { addLog(`浏览器活跃后检查：今天所有准点定时时间已过或已禁用，无需设置闹钟`); }
    return hasSetAlarm;
}

// =======================================================
// 消息处理
// =======================================================

/**
 * 处理针对timer.js模块的消息。
 * @param {object} message - 消息对象。
 * @param {object} sender - 发送者信息。
 * @param {function} sendResponse - 回复函数。
 * @returns {boolean} 是否保持通道开放。
 */
function handleTimerMessages(message, sender, sendResponse) {
    if (message.action === "callTimerFunction") {
        try {
            const functionName = message.function;
            const args = message.args || [];
            addLog(`通过消息调用timer.js函数: ${functionName}(${args.join(', ')})`);

            if (functionName === 'pauseReminderTimer' && message.pausedBy === 'settingsUI') {
                try {
                    setTimerPausedBySettingsUI(true);
                    addLog('[handleTimerMessages] 已通知 index.js 计时器因设置UI暂停');
                } catch(e) { addLog(`[handleTimerMessages] 调用 setTimerPausedBySettingsUI(true) 失败: ${e.message}`); }
            }

            let result;
            switch (functionName) {
                case "setupFixedTimeAlarms": result = setupFixedTimeAlarms(...args); break;
                case "resetFixedTimeAlarm": result = resetFixedTimeAlarm(...args); break;
                case "startReminderTimer": result = startReminderTimer(...args); break;
                case "stopReminderTimer": result = stopReminderTimer(...args); break;
                case "pauseReminderTimer": result = pauseReminderTimer(...args); break;
                case "resumeReminderTimer": result = resumeReminderTimer(...args); break;
                case "markManualBackupDone": result = markManualBackupDone(...args); break;
                case "resetReminderState": result = resetReminderState(...args); break;
                case "getDebugInfo": result = getDebugInfo(...args); break;
                default:
                    addLog(`请求的函数 ${functionName} 不存在或不可调用`);
                    sendResponse({ success: false, error: `函数 ${functionName} 不存在或不可调用` });
                    return true;
            }

            if (result instanceof Promise) {
                result.then(value => { sendResponse({ success: true, result: value }); }).catch(error => {
                    addLog(`函数 ${functionName} 执行出错: ${error.message}`);
                    sendResponse({ success: false, error: error.message });
                });
                return true;
            } else { sendResponse({ success: true, result }); }
        } catch (error) {
            addLog(`处理timer消息时出错: ${error.message}`);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }
    return false;
}

// =======================================================
// 模块导出
// =======================================================
export {
    startReminderTimer,
    stopReminderTimer,
    pauseReminderTimer,
    resumeReminderTimer,
    markManualBackupDone,
    resetReminderState,
    getDebugInfo,
    initializeReminderTimerSystem,
    handleAlarm,
    timerTriggered,
    setupFixedTimeAlarms,
    resetFixedTimeAlarm,
    handleTimerMessages,
    countBookmarks,
    checkFixedTimeAlarmsOnActive,
    getReminderSettings
};
