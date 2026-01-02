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
const browserAPI = (function () {
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
    },

    /**
     * 清除主计时器闹钟。
     * @returns {boolean} 是否成功清除。
     */
    clearMainTimer() {
        browserAPI.alarms.clear(BACKUP_REMINDER_ALARM);
        return true;
    },

    /**
     * 清除进度跟踪器闹钟。
     * @returns {boolean} 是否成功清除。
     */
    clearProgressTracker() {
        browserAPI.alarms.clear(PROGRESS_TRACKER_ALARM);
        return true;
    },

    /**
     * 清除所有准点定时闹钟。
     * @returns {boolean} 是否成功清除。
     */
    clearFixedTimeAlarms() {
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
    isPaused: false,           // 是否已暂停
    remainingTime: 0,          // 暂停时剩余时间
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
    recordPhaseChange: function (oldPhase, newPhase, reason) {
        const timestamp = new Date().toISOString();
        const record = { timestamp, oldPhase, newPhase, reason };
        this.phaseHistory.unshift(record);
        if (this.phaseHistory.length > 20) { this.phaseHistory.pop(); }
        console.log('阶段变更记录:', record);
        browserAPI.storage.local.set({ phaseHistoryDebug: this.phaseHistory });
    },

    /**
     * 获取阶段历史。
     * @returns {Promise<Array<object>>} 阶段历史记录数组。
     */
    getPhaseHistory: async function () {
        try {
            const data = await browserAPI.storage.local.get('phaseHistoryDebug');
            if (data.phaseHistoryDebug) { this.phaseHistory = data.phaseHistoryDebug; }
            return this.phaseHistory;
        } catch (error) {
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
        return Number.MAX_SAFE_INTEGER;
    }
    if (settings.firstReminderMinutes <= 0) {
        return Number.MAX_SAFE_INTEGER;
    }
    const delayMs = (settings.firstReminderMinutes || 1) * 60 * 1000;
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
        const settings = await getReminderSettings();
        if (!settings.reminderEnabled) { addLog(`手动备份提醒功能已禁用，无需显示提醒`); return false; }
        const reminderTime = await getCurrentPhaseDelay();
        if (reminderState.currentPhase === REMINDER_PHASE.FIRST && settings.firstReminderMinutes === 0) { addLog(`第一次提醒已禁用，无需显示提醒`); return false; }
        if (reminderState.currentPhase === REMINDER_PHASE.SECOND && settings.secondReminderMinutes === 0) { addLog(`第二次提醒已禁用，无需显示提醒`); setupNextPhase(true); startReminderTimer(true); return false; }
        if (reminderState.currentPhase === REMINDER_PHASE.THIRD && settings.thirdReminderMinutes === 0) { addLog(`第三次提醒已禁用，无需显示提醒`); reminderState.currentPhase = REMINDER_PHASE.REPEAT; startReminderTimer(true); return false; }
        if (reminderState.currentPhase === REMINDER_PHASE.REPEAT && settings.repeatReminderDays === 0) { addLog(`重复提醒已禁用，无需显示提醒`); resetReminderState(); return false; }
        return true;
    } catch (error) {
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
        addLog(`检查点: ${new Date(checkpoints[0]).toLocaleString()}, 目标时间: ${new Date(targetTime).toLocaleString()}`);
    } else {
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
            const parts = timeStr.split(':');
            if (parts.length === 2) {
                let hour = parseInt(parts[0], 10);
                let minute = parseInt(parts[1], 10);
                if (!isNaN(hour)) { hour = Math.max(0, Math.min(23, hour)); } else { addLog(`无法解析小时值: ${parts[0]}`); return null; }
                if (!isNaN(minute)) { minute = Math.max(0, Math.min(59, minute)); } else { addLog(`无法解析分钟值: ${parts[1]}`); return null; }
                const fixedTimeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
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
        return { bookmarkCount, folderCount };
    } catch (error) {
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

    // 优先使用 background 预热/缓存的“净变化摘要”（Git 风格：对比上次备份的最终状态）
    // 这样可避免：移动/修改后又改回去仍被算作变更；以及“加减相同数量但内容不同”被漏检。
    try {
        const { cachedBookmarkAnalysisSnapshot } = await browserAPI.storage.local.get(['cachedBookmarkAnalysisSnapshot']);
        const snapshot = cachedBookmarkAnalysisSnapshot;
        if (snapshot && typeof snapshot === 'object') {
            const bmAdded = typeof snapshot.bookmarkAdded === 'number' ? snapshot.bookmarkAdded : 0;
            const bmDeleted = typeof snapshot.bookmarkDeleted === 'number' ? snapshot.bookmarkDeleted : 0;
            const fdAdded = typeof snapshot.folderAdded === 'number' ? snapshot.folderAdded : 0;
            const fdDeleted = typeof snapshot.folderDeleted === 'number' ? snapshot.folderDeleted : 0;

            const movedCount = typeof snapshot.movedCount === 'number' ? snapshot.movedCount : 0;
            const modifiedCount = typeof snapshot.modifiedCount === 'number' ? snapshot.modifiedCount : 0;

            const hasQuantityChanges = bmAdded > 0 || bmDeleted > 0 || fdAdded > 0 || fdDeleted > 0 ||
                (typeof snapshot.bookmarkDiff === 'number' && snapshot.bookmarkDiff !== 0) ||
                (typeof snapshot.folderDiff === 'number' && snapshot.folderDiff !== 0);

            const hasStructuralChanges = movedCount > 0 || modifiedCount > 0 ||
                snapshot.bookmarkMoved || snapshot.folderMoved || snapshot.bookmarkModified || snapshot.folderModified;

            currentHasChanges = hasQuantityChanges || hasStructuralChanges;

            if (currentHasChanges) {
                const changeInfo = [];

                // 数量变化：优先用新增/删除分开显示；否则回退到净差
                if (bmAdded > 0) changeInfo.push(`+${bmAdded} 书签`);
                if (bmDeleted > 0) changeInfo.push(`-${bmDeleted} 书签`);
                if (fdAdded > 0) changeInfo.push(`+${fdAdded} 文件夹`);
                if (fdDeleted > 0) changeInfo.push(`-${fdDeleted} 文件夹`);

                if (bmAdded === 0 && bmDeleted === 0 && typeof snapshot.bookmarkDiff === 'number' && snapshot.bookmarkDiff !== 0) {
                    changeInfo.push(`${snapshot.bookmarkDiff > 0 ? '+' : ''}${snapshot.bookmarkDiff} 书签`);
                }
                if (fdAdded === 0 && fdDeleted === 0 && typeof snapshot.folderDiff === 'number' && snapshot.folderDiff !== 0) {
                    changeInfo.push(`${snapshot.folderDiff > 0 ? '+' : ''}${snapshot.folderDiff} 文件夹`);
                }

                const movedCountTotal = (typeof snapshot.movedCount === 'number') ? snapshot.movedCount :
                    ((typeof snapshot.movedBookmarkCount === 'number' ? snapshot.movedBookmarkCount : 0) +
                        (typeof snapshot.movedFolderCount === 'number' ? snapshot.movedFolderCount : 0));

                const modifiedCountTotal = (typeof snapshot.modifiedCount === 'number') ? snapshot.modifiedCount :
                    ((typeof snapshot.modifiedBookmarkCount === 'number' ? snapshot.modifiedBookmarkCount : 0) +
                        (typeof snapshot.modifiedFolderCount === 'number' ? snapshot.modifiedFolderCount : 0));

                if (movedCountTotal > 0) {
                    changeInfo.push(`${movedCountTotal} 移动`);
                } else if (snapshot.bookmarkMoved || snapshot.folderMoved) {
                    changeInfo.push("移动");
                }

                if (modifiedCountTotal > 0) {
                    changeInfo.push(`${modifiedCountTotal} 修改`);
                } else if (snapshot.bookmarkModified || snapshot.folderModified) {
                    changeInfo.push("修改");
                }

                currentChangeDescription = `(${changeInfo.join('，')})`;
            } else {
                currentChangeDescription = "无变化";
            }

            return { currentChangeDescription, currentHasChanges };
        }
    } catch (_) { }

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
        const isSyncHistoryEmpty = !syncHistory || syncHistory.length === 0;

        if (isSyncHistoryEmpty) {
            if (cachedRecordAfterClear && cachedRecordAfterClear.bookmarkStats) {
                const prevStats = cachedRecordAfterClear.bookmarkStats;
                const prevBookmarkCount = prevStats.currentBookmarkCount ?? prevStats.currentBookmarks ?? 0;
                const prevFolderCount = prevStats.currentFolderCount ?? prevStats.currentFolders ?? 0;
                const bookmarkDiff = currentBookmarkCount - prevBookmarkCount;
                const folderDiff = currentFolderCount - prevFolderCount;
                const bookmarkMoved = lastSyncOperations?.bookmarkMoved || false;
                const folderMoved = lastSyncOperations?.folderMoved || false;
                const bookmarkModified = lastSyncOperations?.bookmarkModified || false;
                const folderModified = lastSyncOperations?.folderModified || false;
                const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified;
                const hasNumericalChanges = bookmarkDiff !== 0 || folderDiff !== 0;
                currentHasChanges = hasStructuralChanges || hasNumericalChanges;

                if (currentHasChanges) {
                    let changeInfo = [];
                    if (bookmarkDiff !== 0) changeInfo.push(`${bookmarkDiff > 0 ? '+' : ''}${bookmarkDiff} 书签`);
                    if (folderDiff !== 0) changeInfo.push(`${folderDiff > 0 ? '+' : ''}${folderDiff} 文件夹`);
                    if (bookmarkModified || bookmarkMoved || folderModified || folderMoved) {
                        const movedCount = (lastSyncOperations?.movedBookmarkCount || 0) + (lastSyncOperations?.movedFolderCount || 0);
                        const modifiedCount = (lastSyncOperations?.modifiedBookmarkCount || 0) + (lastSyncOperations?.modifiedFolderCount || 0);

                        if (movedCount > 0) changeInfo.push(`${movedCount} 移动`);
                        else if (bookmarkMoved || folderMoved) changeInfo.push("移动");

                        if (modifiedCount > 0) changeInfo.push(`${modifiedCount} 修改`);
                        else if (bookmarkModified || folderModified) changeInfo.push("修改");
                    }
                    currentChangeDescription = `(${changeInfo.join('，')})`;
                } else {
                    currentChangeDescription = "无变化 (与缓存记录比较)";
                }
            } else {
                currentHasChanges = false;
                currentChangeDescription = "无历史记录可比较";
            }
        } else {
            const latestRecord = syncHistory[syncHistory.length - 1];
            let prevBookmarkCount = 0;
            let prevFolderCount = 0;

            if (latestRecord && latestRecord.bookmarkStats) {
                prevBookmarkCount = latestRecord.bookmarkStats.currentBookmarkCount ?? latestRecord.bookmarkStats.currentBookmarks ?? 0;
                prevFolderCount = latestRecord.bookmarkStats.currentFolderCount ?? latestRecord.bookmarkStats.currentFolders ?? 0;
                const bookmarkDiff = currentBookmarkCount - prevBookmarkCount;
                const folderDiff = currentFolderCount - prevFolderCount;
                const bookmarkMoved = lastSyncOperations?.bookmarkMoved || false;
                const folderMoved = lastSyncOperations?.folderMoved || false;
                const bookmarkModified = lastSyncOperations?.bookmarkModified || false;
                const folderModified = lastSyncOperations?.folderModified || false;
                const hasStructuralChanges = bookmarkMoved || folderMoved || bookmarkModified || folderModified;
                const hasNumericalChanges = bookmarkDiff !== 0 || folderDiff !== 0;
                currentHasChanges = hasStructuralChanges || hasNumericalChanges;

                if (currentHasChanges) {
                    let changeInfo = [];
                    if (bookmarkDiff !== 0) changeInfo.push(`${bookmarkDiff > 0 ? '+' : ''}${bookmarkDiff} 书签`);
                    if (folderDiff !== 0) changeInfo.push(`${folderDiff > 0 ? '+' : ''}${folderDiff} 文件夹`);
                    if (bookmarkModified || bookmarkMoved || folderModified || folderMoved) {
                        // 尝试从 lastSyncOperations 获取具体数量（如果有）
                        const movedCount = (lastSyncOperations?.movedBookmarkCount || 0) + (lastSyncOperations?.movedFolderCount || 0);
                        const modifiedCount = (lastSyncOperations?.modifiedBookmarkCount || 0) + (lastSyncOperations?.modifiedFolderCount || 0);

                        if (movedCount > 0) changeInfo.push(`${movedCount} 移动`);
                        else if (bookmarkMoved || folderMoved) changeInfo.push("移动");

                        if (modifiedCount > 0) changeInfo.push(`${modifiedCount} 修改`);
                        else if (bookmarkModified || folderModified) changeInfo.push("修改");
                    }
                    currentChangeDescription = `(${changeInfo.join('，')})`;
                } else {
                    currentChangeDescription = "无变化";
                }
            } else {
                currentHasChanges = true;
                currentChangeDescription = "(无法计算具体变化)";
            }
        }
    } catch (error) {
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
            isPaused: reminderState.isPaused,
            remainingTime: reminderState.remainingTime,
            currentPhase: reminderState.currentPhase,
            progressCheckpoints: reminderState.progressCheckpoints
        };
        browserAPI.storage.local.set({ reminderState: stateToSave });
    } catch (error) {
    }
}

/**
 * 从存储加载计时器状态。
 */
async function loadReminderState() {
    try {
        const data = await browserAPI.storage.local.get(['reminderState', 'autoSync', 'lastReminderDate']);
        const autoSync = data.autoSync !== undefined ? data.autoSync : true;

        const today = new Date().toISOString().split('T')[0];
        const lastDate = data.lastReminderDate || '';
        const isNewDay = today !== lastDate;

        await browserAPI.storage.local.set({ lastReminderDate: today });

        if (isNewDay && data.reminderState && data.reminderState.startTime) {
            timerController.clearAllTimers();
            reminderState.startTime = null; reminderState.targetTime = null; reminderState.elapsedTime = 0;
            reminderState.reminderShown = false; reminderState.isActive = true; reminderState.manualBackupDone = false;
            reminderState.pauseTime = null; reminderState.isPaused = false; reminderState.remainingTime = 0; reminderState.currentPhase = REMINDER_PHASE.FIRST;
            reminderState.progressCheckpoints = [];
            saveReminderState();
            if (!autoSync) {
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
            }
            return;
        }

        timerController.clearAllTimers();

        if (data.reminderState) {
            if (!autoSync) {
                resetReminderState();
                manualStartupResetHandled = true;
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
                return;
            }

            reminderState.elapsedTime = data.reminderState.elapsedTime || 0;
            reminderState.reminderShown = data.reminderState.reminderShown || false;
            reminderState.isActive = data.reminderState.isActive || true;
            reminderState.manualBackupDone = data.reminderState.manualBackupDone || false;
            reminderState.pauseTime = data.reminderState.pauseTime || null;
            reminderState.isPaused = data.reminderState.isPaused || false;
            reminderState.remainingTime = data.reminderState.remainingTime || 0;
            reminderState.startTime = data.reminderState.startTime || null;
            reminderState.targetTime = data.reminderState.targetTime || null;
            reminderState.currentPhase = data.reminderState.currentPhase || REMINDER_PHASE.FIRST;
            reminderState.progressCheckpoints = data.reminderState.progressCheckpoints || [];

            if (reminderState.targetTime && !reminderState.reminderShown && !reminderState.manualBackupDone && !autoSync) {
                const now = Date.now();
                if (now < reminderState.targetTime) {
                    const remainingTime = reminderState.targetTime - now;
                    setTimeout(async () => {
                        await timerController.setMainTimer(remainingTime);
                        const newCheckpoints = createProgressCheckpoints(remainingTime);
                        reminderState.progressCheckpoints = newCheckpoints;
                        await setNextProgressCheckpoint(newCheckpoints);
                    }, 100);
                } else {
                    setTimeout(() => { timerTriggered(); }, 500);
                }
            } else if (!autoSync && !reminderState.reminderShown && !reminderState.manualBackupDone) {
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
            }
        } else {
            reminderState.currentPhase = REMINDER_PHASE.FIRST;
            if (!autoSync) {
                // 直接调用，不使用setTimeout
                await startReminderTimer(true);
            }
        }
    } catch (error) {
    }
}

// 确保在加载提醒状态后也加载阶段历史
const originalLoadReminderState = loadReminderState;
loadReminderState = async function () {
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
                return browserAPI.storage.local.set({ lastCheckedDate: today })
                    .then(() => { return { dateChanged: true, previousDate: lastCheckedDate, currentDate: today, timestamp: Date.now() }; });
            }
            return { dateChanged: false, currentDate: today, previousDate: lastCheckedDate, timestamp: Date.now() };
        })
        .catch(err => {
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
        return true; // 返回true以避免调用者认为启动失败
    }
    lastTimerStartAttemptTime = now;

    if (!globalThis.startReminderTimerRecursionCount) { globalThis.startReminderTimerRecursionCount = 0; }
    globalThis.startReminderTimerRecursionCount++;
    if (globalThis.startReminderTimerRecursionCount > 5) {
        globalThis.startReminderTimerRecursionCount = 0;
        return false;
    }

    try {
        if (globalThis.isCleaningUp) {
            setTimeout(() => startReminderTimer(skipInitialReminder), 500);
            return false;
        }

        const delayMs = await getCurrentPhaseDelay();
        timerController.clearMainTimer();

        let shouldShowReminder = false;
        let changeDescriptionToShow = "";

        if (!skipInitialReminder) {
            shouldShowReminder = await checkReminderStatus();
            if (shouldShowReminder) {
                try {
                    const changes = await calculateChanges();
                    changeDescriptionToShow = changes.currentChangeDescription || "";
                } catch (calcError) {
                    changeDescriptionToShow = "";
                }
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
            reminderState.progressCheckpoints = [];
        } else {
            const checkpoints = createProgressCheckpoints(delayMs);
            reminderState.progressCheckpoints = checkpoints;
            await setNextProgressCheckpoint(checkpoints);
        }

        if (!reminderState.progressCheckpoints || reminderState.progressCheckpoints.length === 0) { addLog(`没有可用的检查点`); }
        await saveReminderState();
        globalThis.startReminderTimerRecursionCount = 0;
        return true;
    } catch (error) {
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
    timerController.clearAllTimers();
    reminderState.startTime = null; reminderState.targetTime = null; reminderState.elapsedTime = 0;
    reminderState.reminderShown = false; reminderState.isActive = true; reminderState.manualBackupDone = false;
    reminderState.pauseTime = null; reminderState.isPaused = false; reminderState.remainingTime = 0; reminderState.currentPhase = REMINDER_PHASE.FIRST;
    reminderState.progressCheckpoints = [];
    saveReminderState();
}

/**
 * 暂停循环提醒计时器。
 * @returns {void}
 */
function pauseReminderTimer() {
    browserAPI.alarms.get(BACKUP_REMINDER_ALARM, (alarm) => {
        if (!alarm) {
            return;
        }

        const remainingTime = alarm.scheduledTime - Date.now();
        if (remainingTime > 0) {
            timerController.clearAllTimers();
            reminderState.pauseTime = Date.now();
            reminderState.remainingTime = remainingTime;
            reminderState.isPaused = true;
            saveReminderState();
        } else {
        }
    });
}

/**
 * 恢复循环提醒计时器。
 * @returns {Promise<boolean>} 是否成功恢复。
 */
async function resumeReminderTimer() {
    const { reminderState: storedState } = await browserAPI.storage.local.get('reminderState');

    if (storedState && storedState.isPaused && storedState.remainingTime > 0) {
        // 清除可能存在的旧闹钟
        timerController.clearMainTimer();

        // 使用剩余时间创建新的闹钟
        await timerController.setMainTimer(storedState.remainingTime);

        // 更新状态
        const newState = {
            ...storedState,
            isPaused: false,
            pauseTime: null,
            remainingTime: 0,
            // 重新计算目标时间
            targetTime: Date.now() + storedState.remainingTime
        };
        await browserAPI.storage.local.set({ reminderState: newState });

    } else {
    }
}

/**
 * 标记手动备份已完成，并根据情况推进提醒阶段。
 * @returns {void}
 */
function markManualBackupDone() {
    reminderState.manualBackupDone = true;
    reminderState.reminderShown = false;
    browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck');
    startReminderTimer(true);
}

/**
 * 计时器触发函数。
 * @returns {Promise<void>}
 */
async function timerTriggered() {
    try {
        timerController.clearAllTimers();

        const { autoSync } = await browserAPI.storage.local.get(['autoSync']);
        if (autoSync) { addLog(`当前为自动备份模式，忽略循环提醒触发`); return; }
        const { hasBookmarkActivitySinceLastCheck, lastNotificationClosedReason } = await browserAPI.storage.local.get(['hasBookmarkActivitySinceLastCheck', 'lastNotificationClosedReason']);
        await browserAPI.storage.local.remove('lastNotificationClosedReason');
        if (hasBookmarkActivitySinceLastCheck) {
            const { currentChangeDescription, currentHasChanges } = await calculateChanges();
            if (currentHasChanges) {
                const timeAllows = await checkReminderStatus();
                if (timeAllows) {
                    await browserAPI.storage.local.set({ lastNotificationChangeDescription: currentChangeDescription });
                    await showBackupReminder(reminderState.currentPhase, currentChangeDescription);
                } else {
                    startReminderTimer(true);
                }
            } else {
                startReminderTimer(true);
            }
        } else {
            if (lastNotificationClosedReason === 'timeout' || lastNotificationClosedReason === 'manual_close') {
                const { currentChangeDescription, currentHasChanges } = await calculateChanges();
                if (currentHasChanges) {
                    const timeAllows = await checkReminderStatus();
                    if (timeAllows) {
                        await browserAPI.storage.local.set({ lastNotificationChangeDescription: currentChangeDescription });
                        await showBackupReminder(reminderState.currentPhase, currentChangeDescription);
                    } else {
                        startReminderTimer(true);
                    }
                } else {
                    startReminderTimer(true);
                }
            } else {
                startReminderTimer(true);
            }
        }
    } catch (error) {
        try {
            await browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck');
            await browserAPI.storage.local.remove('lastNotificationClosedReason');
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
    if (alarmName === BACKUP_REMINDER_ALARM) {
        timerTriggered();
    } else if (alarmName === PROGRESS_TRACKER_ALARM) {
        if (reminderState.startTime && !reminderState.reminderShown) {
            const elapsedTime = Date.now() - reminderState.startTime;
            reminderState.elapsedTime = elapsedTime;
            saveReminderState();
            const targetTime = reminderState.targetTime;
            if (reminderState.progressCheckpoints && reminderState.progressCheckpoints.length > 0) {
                setNextProgressCheckpoint(reminderState.progressCheckpoints);
            }
        }
    } else if (alarmName === FIXED_TIME_ALARM_1 || alarmName === FIXED_TIME_ALARM_2) {
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
        timerController.clearFixedTimeAlarm(alarmName);
        const settings = await getReminderSettings();
        const autoBackupEnabled = await isAutoBackupEnabled();

        if (autoBackupEnabled) {
            await resetFixedTimeAlarm(alarmName, 0);
            return;
        }

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
        let shouldShowNotification = false;
        let changeDescriptionToShow = "";

        if (hasBookmarkActivitySinceLastCheck) {
            try {
                const { currentChangeDescription, currentHasChanges } = await calculateChanges();
                if (currentHasChanges) {
                    await browserAPI.storage.local.set({ [descriptionKey]: currentChangeDescription });
                    changeDescriptionToShow = currentChangeDescription;
                    shouldShowNotification = true;
                } else {
                    shouldShowNotification = false;
                }
            } catch (error) {
                await browserAPI.storage.local.remove(descriptionKey);
                changeDescriptionToShow = "(检查备份状态时出错)";
                shouldShowNotification = true;
            }
        } else {
            if (lastNotificationClosedReason === 'timeout' || lastNotificationClosedReason === 'manual_close') {
                let currentChanges = { currentChangeDescription: "", currentHasChanges: false };
                try {
                    currentChanges = await calculateChanges();
                } catch (calcError) {
                    currentChanges.currentHasChanges = false;
                }

                if (currentChanges.currentHasChanges) {
                    changeDescriptionToShow = currentChanges.currentChangeDescription;
                    await browserAPI.storage.local.set({ [descriptionKey]: currentChanges.currentChangeDescription });
                    shouldShowNotification = true;
                } else {
                    shouldShowNotification = false;
                }
            } else {
                shouldShowNotification = false;
            }
        }

        if (shouldShowNotification) {
            const timeLabel = alarmName === FIXED_TIME_ALARM_1 ?
                `准点定时1 (${settings.fixedTime1 || '未设置'})` :
                `准点定时2 (${settings.fixedTime2 || '未设置'})`;
            await showBackupReminder(alarmName, changeDescriptionToShow);
        } else {
            await resetFixedTimeAlarm(alarmName, 0);
        }
    } catch (error) {
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
                if (retryCount < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return resetFixedTimeAlarm(alarmName, retryCount + 1);
                }
            }
            return { success: !!result, alarm: FIXED_TIME_ALARM_1 };
        } else if (alarmName === FIXED_TIME_ALARM_2 && settings.fixedTimeEnabled2 && settings.fixedTime2) {
            result = await timerController.setFixedTimeAlarm2(settings.fixedTime2, true);
            if (result) { addLog(`准点定时闹钟2已重置为明天 ${settings.fixedTime2}`); }
            else {
                if (retryCount < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return resetFixedTimeAlarm(alarmName, retryCount + 1);
                }
            }
            return { success: !!result, alarm: FIXED_TIME_ALARM_2 };
        } else {
            return { success: false, alarm: alarmName, error: '设置已禁用或无效' };
        }
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
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
    addLog('重置循环提醒状态');
    stopReminderTimer();
    reminderState.manualBackupDone = false;
    saveReminderState();
}

/**
 * 获取调试信息。
 * @returns {object} 调试信息对象。
 */
function getDebugInfo() {
    return {
        state: { ...reminderState },
        initialization: {
            isReminderTimerSystemInitialized,
            isInitializationInProgress,
            initializationAttempts,
            manualStartupResetHandled,
            lastTimerStartAttemptTime,
            MIN_TIMER_START_INTERVAL
        }
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
    initializationAttempts++;
    const logPrefix = `[备份提醒计时器] [${formatDateTimeForLog(new Date().toISOString())}] [准点定时]`;
    if (isInitializationInProgress) {
        return;
    }
    isInitializationInProgress = true;

    try {
        // 1. 初始化闹钟监听器 (对所有闹钟都必要)
        initAlarmListeners();

        // 2. 加载设置并初始化准点定时闹钟
        const settings = await getReminderSettings();
        await setupFixedTimeAlarms(settings);

        // 3. 设置日期变更检查器 (对准点定时必要)
        setupDateChangeChecker();

        isReminderTimerSystemInitialized = true;
    } catch (error) {
        isReminderTimerSystemInitialized = false;
    } finally {
        isInitializationInProgress = false;
    }
}

/**
 * 初始化闹钟监听器。
 */
function initAlarmListeners() {
    try {
        if (browserAPI.alarms && browserAPI.alarms.onAlarm.hasListener(handleAlarm)) {
            browserAPI.alarms.onAlarm.removeListener(handleAlarm);
        }
    } catch (removeError) { addLog(`尝试移除旧闹钟监听器失败 (可能不支持): ${removeError.message}`); }

    if (browserAPI.alarms) {
        browserAPI.alarms.onAlarm.addListener(handleAlarm);
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
            } else {
                results.fixedTime1 = await timerController.setFixedTimeAlarm1(settings.fixedTime1);
            }
        } else { addLog('准点定时1未启用或时间无效'); }

        if (settings.fixedTimeEnabled2 && settings.fixedTime2) {
            const [hours, minutes] = settings.fixedTime2.split(':').map(Number);
            const todayTarget = new Date(now);
            todayTarget.setHours(hours, minutes, 0, 0);
            if (todayTarget > now) {
                results.fixedTime2 = await timerController.setFixedTimeAlarm2(settings.fixedTime2);
            } else {
                results.fixedTime2 = await timerController.setFixedTimeAlarm2(settings.fixedTime2);
            }
        } else { addLog('准点定时2未启用或时间无效'); }
        return { success: true, results: results };
    } catch (error) {
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
    try {
        const settings = await getReminderSettings();
        await timerController.clearFixedTimeAlarms();
        let results = [];

        if (settings.fixedTimeEnabled1) {
            const today = new Date();
            const [hours, minutes] = settings.fixedTime1.split(':').map(num => parseInt(num));
            const todayTarget = new Date();
            todayTarget.setHours(hours, minutes, 0, 0);
            if (todayTarget > today) {
                await timerController.setFixedTimeAlarm1(settings.fixedTime1, false);
            } else { addLog(`准点定时1今天 ${settings.fixedTime1} 已过，不设置闹钟`); }
        } else { addLog("准点定时1未启用，跳过设置"); }

        if (settings.fixedTimeEnabled2) {
            const today = new Date();
            const [hours, minutes] = settings.fixedTime2.split(':').map(num => parseInt(num));
            const todayTarget = new Date();
            todayTarget.setHours(hours, minutes, 0, 0);
            if (todayTarget > today) {
                await timerController.setFixedTimeAlarm2(settings.fixedTime2, false);
            } else { addLog(`准点定时2今天 ${settings.fixedTime2} 已过，不设置闹钟`); }
        } else { addLog("准点定时2未启用，跳过设置"); }

        if (settings.reminderEnabled && !await isAutoBackupEnabled()) {
            if (manualStartupResetHandled) {
                manualStartupResetHandled = false;
            } else {
                const firstReminderMinutes = settings.firstReminderMinutes || 30;
                if (firstReminderMinutes > 0) {
                    resetReminderState();
                    await startReminderTimer(true);
                } else { addLog('循环提醒时间间隔为0，不启动计时器'); }
            }
        } else { addLog(`循环提醒未启用或自动备份已开启，不启动计时器`); }
        return { success: true, message: "准点定时功能已初始化" };
    } catch (error) {
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
    setTimeout(() => { scheduleMidnightCheck(); }, msUntilMidnightPlus5);

    function scheduleMidnightCheck() {
        checkDateChange().then(dateCheck => {
            if (dateCheck.dateChanged) {
                setupFixedTimeAlarmsOnStartup().catch(err => { addLog(`重新设置准点定时闹钟失败: ${err.message}`); });
            }
            const nextCheckTime = new Date();
            nextCheckTime.setHours(24, 0, 5, 0);
            const timeToNextCheck = nextCheckTime.getTime() - Date.now();
            setTimeout(() => { scheduleMidnightCheck(); }, timeToNextCheck);
        }).catch(err => {
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
            if (functionName === 'pauseReminderTimer' && message.pausedBy === 'settingsUI') {
                try {
                    setTimerPausedBySettingsUI(true);
                } catch (e) { addLog(`[handleTimerMessages] 调用 setTimerPausedBySettingsUI(true) 失败: ${e.message}`); }
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
                    sendResponse({ success: false, error: `函数 ${functionName} 不存在或不可调用` });
                    return true;
            }

            if (result instanceof Promise) {
                result.then(value => { sendResponse({ success: true, result: value }); }).catch(error => {
                    sendResponse({ success: false, error: error.message });
                });
                return true;
            } else { sendResponse({ success: true, result }); }
        } catch (error) {
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

// 添加一个模块级的时间戳，用于startLoopReminder的防抖
let lastLoopReminderStartTime = 0;
const MIN_LOOP_REMINDER_INTERVAL = 2000; // 2秒

/**
 * 启动循环提醒功能。
 * 这是循环提醒的总入口。
 */
export async function startLoopReminder() {
    const now = Date.now();
    if (now - lastLoopReminderStartTime < MIN_LOOP_REMINDER_INTERVAL) {
        return;
    }
    lastLoopReminderStartTime = now;

    const { autoSync } = await browserAPI.storage.local.get({ autoSync: true });
    if (autoSync) {
        return;
    }

    // 从 loadReminderState 加载状态，它会处理启动时的状态检查
    await loadReminderState();

    // loadReminderState 会在需要时调用 startReminderTimer
}

/**
 * 停止循环提醒功能。
 */
export function stopLoopReminder() {
    stopReminderTimer();
}
