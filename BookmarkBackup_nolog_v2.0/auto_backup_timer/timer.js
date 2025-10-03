// =======================================================
// 自动备份定时器 - 核心定时器模块
// Auto Backup Timer - Core Timer Module
// =======================================================

import { 
    getAutoBackupSettings,
    updateBackupMode,
    markScheduleAsExecuted,
    getPendingSchedules
} from './storage.js';

const browserAPI = (function() {
    if (typeof chrome !== 'undefined') {
        if (typeof browser !== 'undefined') {
            return browser;
        }
        return chrome;
    }
    throw new Error('不支持的浏览器');
})();

// =======================================================
// 常量定义
// =======================================================

const ALARM_NAMES = {
    REGULAR_CHECK: 'autoBackupRegularCheck',
    SPECIFIC_CHECK: 'autoBackupSpecificCheck',
    HOUR_INTERVAL: 'autoBackupHourInterval',
    MINUTE_INTERVAL: 'autoBackupMinuteInterval'
};

// =======================================================
// 全局状态
// =======================================================

let isInitialized = false;
let lastBackupCheck = null;

// 回调函数引用（由 background.js 设置）
let checkBookmarkChangesCallback = null;
let syncBookmarksCallback = null;

/**
 * 设置回调函数（由 background.js 调用）
 * @param {Function} checkChanges - 检查书签变化的函数
 * @param {Function} syncBookmarks - 执行备份的函数
 */
export function setCallbacks(checkChanges, syncBookmarks) {
    checkBookmarkChangesCallback = checkChanges;
    syncBookmarksCallback = syncBookmarks;
}

// =======================================================
// 辅助函数
// =======================================================

/**
 * 添加日志
 * @param {string} message - 日志消息
 */
function addLog(message) {
    const now = new Date();
    const timeString = now.toLocaleString();
    console.log(`[自动备份定时器] [${timeString}] ${message}`);
}

/**
 * 获取下一个执行时间（周+默认时间）
 * @param {Array} weekDays - 周开关数组
 * @param {string} defaultTime - 默认时间 HH:MM
 * @returns {number|null} 时间戳或null
 */
function getNextWeeklyTime(weekDays, defaultTime) {
    try {
        const [hours, minutes] = defaultTime.split(':').map(Number);
        const now = new Date();
        
        // 从今天开始检查接下来7天
        for (let i = 0; i < 7; i++) {
            const checkDate = new Date(now);
            checkDate.setDate(now.getDate() + i);
            checkDate.setHours(hours, minutes, 0, 0);
            
            const dayOfWeek = checkDate.getDay();
            
            // 如果是今天，且时间已过，跳过
            if (i === 0 && checkDate.getTime() <= now.getTime()) {
                continue;
            }
            
            // 检查该天是否启用
            if (weekDays[dayOfWeek]) {
                return checkDate.getTime();
            }
        }
        
        return null;
    } catch (error) {
        addLog(`计算下一个周时间失败: ${error.message}`);
        return null;
    }
}

/**
 * 获取下一个小时间隔时间
 * @param {number} hourInterval - 小时间隔
 * @returns {number} 时间戳
 */
function getNextHourIntervalTime(hourInterval) {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    
    // 计算下一个整点时刻
    let nextHour = Math.ceil(currentHour / hourInterval) * hourInterval;
    
    // 如果计算出的小时等于当前小时，且已经过了整点，需要跳到下一个间隔
    if (nextHour === currentHour && (currentMinute > 0 || currentSecond > 0)) {
        nextHour += hourInterval;
    }
    
    const nextTime = new Date(now);
    nextTime.setHours(nextHour, 0, 0, 0);
    
    // 如果超过今天，调整到明天
    if (nextTime.getDate() !== now.getDate()) {
        nextTime.setDate(now.getDate() + 1);
    }
    
    // 最后确保计算出的时间一定是未来时间
    if (nextTime.getTime() <= now.getTime()) {
        // 如果还是过去或当前时间，再加一个间隔
        nextTime.setHours(nextTime.getHours() + hourInterval, 0, 0, 0);
    }
    
    return nextTime.getTime();
}

/**
 * 获取下一个分钟间隔时间
 * @param {number} minuteInterval - 分钟间隔
 * @param {boolean} includeZeroMinute - 是否包含整点（0分）
 * @returns {number} 时间戳
 */
function getNextMinuteIntervalTime(minuteInterval, includeZeroMinute) {
    const now = new Date();
    const currentMinute = now.getMinutes();
    const currentSecond = now.getSeconds();
    
    // 计算下一个分钟点
    let nextMinute = Math.ceil(currentMinute / minuteInterval) * minuteInterval;
    
    // 如果计算出的分钟点等于当前分钟（且当前秒数>0），说明已经过了这个分钟点，需要跳到下一个
    if (nextMinute === currentMinute && currentSecond > 0) {
        nextMinute += minuteInterval;
    }
    
    // 如果不包含整点，且计算结果是0或60，则跳到下一个间隔
    if (!includeZeroMinute && (nextMinute === 0 || nextMinute === 60)) {
        nextMinute = minuteInterval;
    }
    
    const nextTime = new Date(now);
    
    if (nextMinute >= 60) {
        nextTime.setHours(nextTime.getHours() + 1);
        nextTime.setMinutes(nextMinute - 60, 0, 0);
    } else {
        nextTime.setMinutes(nextMinute, 0, 0);
    }
    
    // 最后确保计算出的时间一定是未来时间
    if (nextTime.getTime() <= now.getTime()) {
        // 如果还是过去或当前时间，再加一个间隔
        nextTime.setMinutes(nextTime.getMinutes() + minuteInterval, 0, 0);
    }
    
    return nextTime.getTime();
}

/**
 * 获取当前星期几的文本
 * @param {string} lang - 语言 'zh_CN' 或 'en'
 * @returns {string} 周几
 */
function getCurrentWeekDayText(lang = 'zh_CN') {
    const isEn = lang === 'en';
    const daysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const daysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = isEn ? daysEn : daysZh;
    return days[new Date().getDay()];
}

// =======================================================
// 核心备份触发逻辑
// =======================================================

/**
 * 检查是否有书签变化
 * @returns {Promise<Object>} {hasChanges, changeDescription}
 */
async function checkBookmarkChanges() {
    try {
        // 直接调用 background.js 的检查函数（通过回调）
        if (!checkBookmarkChangesCallback) {
            addLog(`检查书签变化回调未设置，将假定有变化并执行备份`);
            return { 
                hasChanges: true, 
                changeDescription: '(回调未设置，强制备份)' 
            };
        }
        
        const response = await checkBookmarkChangesCallback();
        
        if (response && response.success) {
            return {
                hasChanges: response.hasChanges,
                changeDescription: response.changeDescription || ''
            };
        }
        
        return { hasChanges: false, changeDescription: '' };
    } catch (error) {
        // 如果调用失败，假设有变化并执行备份，以避免遗漏变化
        addLog(`检查书签变化失败: ${error.message}，将假定有变化并执行备份`);
        return { 
            hasChanges: true, 
            changeDescription: '(无法检测变化，强制备份)' 
        };
    }
}

// 添加防重复触发的变量
let isBackupInProgress = false;
let lastBackupTriggerTime = 0;
const MIN_BACKUP_INTERVAL = 5000; // 最小备份间隔：5秒

/**
 * 触发自动备份
 * @param {string} reason - 备份原因（用于记录）
 * @returns {Promise<boolean>} 是否成功
 */
async function triggerAutoBackup(reason) {
    try {
        // 防止重复触发：如果正在备份中，或者距离上次触发不到5秒，则跳过
        const now = Date.now();
        if (isBackupInProgress) {
            addLog(`备份正在进行中，跳过本次触发 (${reason})`);
            return false;
        }
        if (now - lastBackupTriggerTime < MIN_BACKUP_INTERVAL) {
            addLog(`距离上次备份触发不到${MIN_BACKUP_INTERVAL/1000}秒，跳过本次触发 (${reason})`);
            return false;
        }
        
        lastBackupTriggerTime = now;
        addLog(`触发自动备份，原因: ${reason}`);
        
        // 检查是否有变化
        const { hasChanges, changeDescription } = await checkBookmarkChanges();
        
        if (!hasChanges) {
            addLog('没有检测到书签变化，跳过备份');
            return false;
        }
        
        addLog(`检测到变化: ${changeDescription}，开始备份`);
        
        // 标记备份正在进行
        isBackupInProgress = true;
        
        // 直接调用 background.js 的备份函数（通过回调）
        if (!syncBookmarksCallback) {
            addLog(`备份回调未设置，无法执行备份`);
            return false;
        }
        
        const response = await syncBookmarksCallback(
            false,          // isManual
            'upload',       // direction
            false,          // showProgress
            reason          // note (备份原因作为备注)
        );
        
        if (response && response.success) {
            addLog('自动备份成功');
            lastBackupCheck = Date.now();
            return true;
        } else {
            addLog('自动备份失败: ' + (response?.error || '未知错误'));
            return false;
        }
    } catch (error) {
        addLog(`触发自动备份异常: ${error.message}`);
        return false;
    } finally {
        // 无论成功还是失败，都要重置备份进行中的标志
        isBackupInProgress = false;
    }
}

// =======================================================
// 定时器管理
// =======================================================

/**
 * 清除所有定时器
 */
async function clearAllAlarms() {
    try {
        await browserAPI.alarms.clear(ALARM_NAMES.REGULAR_CHECK);
        await browserAPI.alarms.clear(ALARM_NAMES.SPECIFIC_CHECK);
        await browserAPI.alarms.clear(ALARM_NAMES.HOUR_INTERVAL);
        await browserAPI.alarms.clear(ALARM_NAMES.MINUTE_INTERVAL);
        addLog('已清除所有定时器');
    } catch (error) {
        addLog(`清除定时器失败: ${error.message}`);
    }
}

/**
 * 设置常规时间定时器
 * @param {Object} regularConfig - 常规时间配置
 * @returns {Promise<boolean>} 是否成功
 */
async function setupRegularTimeAlarms(regularConfig) {
    try {
        if (!regularConfig.enabled) {
            addLog('常规时间未启用');
            return false;
        }
        
        // 第二级：小时间隔
        if (regularConfig.hourInterval.enabled && regularConfig.hourInterval.hours > 0) {
            const nextTime = getNextHourIntervalTime(regularConfig.hourInterval.hours);
            await browserAPI.alarms.create(ALARM_NAMES.HOUR_INTERVAL, { when: nextTime });
            addLog(`已设置小时间隔定时器: ${new Date(nextTime).toLocaleString()}`);
        }
        
        // 第三级：分钟间隔
        if (regularConfig.minuteInterval.enabled && regularConfig.minuteInterval.minutes > 0) {
            // 判断是否包含整点：只有第三级开启且第二级关闭时，才包含整点
            const includeZeroMinute = !regularConfig.hourInterval.enabled;
            const nextTime = getNextMinuteIntervalTime(
                regularConfig.minuteInterval.minutes, 
                includeZeroMinute
            );
            await browserAPI.alarms.create(ALARM_NAMES.MINUTE_INTERVAL, { when: nextTime });
            addLog(`已设置分钟间隔定时器: ${new Date(nextTime).toLocaleString()}`);
        }
        
        // 第一级：周+默认时间
        const nextWeeklyTime = getNextWeeklyTime(regularConfig.weekDays, regularConfig.defaultTime);
        if (nextWeeklyTime) {
            await browserAPI.alarms.create(ALARM_NAMES.REGULAR_CHECK, { when: nextWeeklyTime });
            addLog(`已设置周定时器: ${new Date(nextWeeklyTime).toLocaleString()}`);
        }
        
        return true;
    } catch (error) {
        addLog(`设置常规时间定时器失败: ${error.message}`);
        return false;
    }
}

/**
 * 设置特定时间定时器
 * @param {Object} specificConfig - 特定时间配置
 * @returns {Promise<boolean>} 是否成功
 */
async function setupSpecificTimeAlarms(specificConfig) {
    try {
        if (!specificConfig.enabled) {
            addLog('特定时间未启用');
            return false;
        }
        
        // 查找最近的未执行计划
        const now = Date.now();
        let nearestSchedule = null;
        let nearestTime = Infinity;
        
        for (const schedule of specificConfig.schedules) {
            if (!schedule.enabled || schedule.executed) {
                continue;
            }
            
            const scheduleTime = new Date(schedule.datetime).getTime();
            if (scheduleTime > now && scheduleTime < nearestTime) {
                nearestTime = scheduleTime;
                nearestSchedule = schedule;
            }
        }
        
        if (nearestSchedule) {
            await browserAPI.alarms.create(ALARM_NAMES.SPECIFIC_CHECK, { when: nearestTime });
            addLog(`已设置特定时间定时器: ${new Date(nearestTime).toLocaleString()}`);
            return true;
        } else {
            addLog('没有待执行的特定时间计划');
            return false;
        }
    } catch (error) {
        addLog(`设置特定时间定时器失败: ${error.message}`);
        return false;
    }
}

/**
 * 初始化定时器系统
 * @returns {Promise<boolean>} 是否成功
 */
async function initializeTimerSystem() {
    if (isInitialized) {
        addLog('定时器系统已初始化');
        return true;
    }
    
    try {
        addLog('开始初始化定时器系统');
        
        // 清除旧的定时器
        await clearAllAlarms();
        
        // 获取设置
        const settings = await getAutoBackupSettings();
        
        // 根据模式设置定时器
        if (settings.backupMode === 'regular') {
            await setupRegularTimeAlarms(settings.regularTime);
        } else if (settings.backupMode === 'specific') {
            await setupSpecificTimeAlarms(settings.specificTime);
        }
        
        // 检查是否有遗漏的备份任务
        await checkMissedBackups();
        
        isInitialized = true;
        addLog('定时器系统初始化完成');
        return true;
    } catch (error) {
        addLog(`初始化定时器系统失败: ${error.message}`);
        return false;
    }
}

/**
 * 检查遗漏的备份任务（浏览器休眠后恢复时）
 * @returns {Promise<void>}
 */
async function checkMissedBackups() {
    try {
        const settings = await getAutoBackupSettings();
        const lang = await getCurrentLanguage();
        
        // 检查特定时间的遗漏任务
        if (settings.backupMode === 'specific' && settings.specificTime.enabled) {
            const pendingSchedules = await getPendingSchedules();
            
            for (const schedule of pendingSchedules) {
                addLog(`发现遗漏的特定时间任务: ${schedule.datetime}`);
                const note = generateBackupNote('specific', schedule.datetime, lang);
                const success = await triggerAutoBackup(note);
                
                if (success) {
                    await markScheduleAsExecuted(schedule.id);
                }
            }
        }
        
        // 常规时间的遗漏逻辑由 alarm 触发处理
    } catch (error) {
        addLog(`检查遗漏备份任务失败: ${error.message}`);
    }
}

/**
 * 停止定时器系统
 * @returns {Promise<void>}
 */
async function stopTimerSystem() {
    try {
        await clearAllAlarms();
        isInitialized = false;
        addLog('定时器系统已停止');
    } catch (error) {
        addLog(`停止定时器系统失败: ${error.message}`);
    }
}

/**
 * 重启定时器系统
 * @returns {Promise<boolean>}
 */
async function restartTimerSystem() {
    try {
        await stopTimerSystem();
        return await initializeTimerSystem();
    } catch (error) {
        addLog(`重启定时器系统失败: ${error.message}`);
        return false;
    }
}

// =======================================================
// 辅助函数 - 生成备注
// =======================================================

/**
 * 生成备注（支持中英文）
 * @param {string} type - 备注类型：'hour', 'minute', 'specific', 'weekly'
 * @param {*} value - 相关值
 * @param {string} lang - 语言 'zh_CN' 或 'en'
 * @returns {string}
 */
function generateBackupNote(type, value, lang = 'zh_CN') {
    const isEn = lang === 'en';
    
    switch (type) {
        case 'hour':
            return isEn ? `${value}h` : `${value}小时`;
        case 'minute':
            return isEn ? `${value}min` : `${value}分钟`;
        case 'specific':
            // 从 "2024-01-02T17:23" 提取时间部分
            const timeMatch = value.match(/T(\d{2}:\d{2})/);
            const time = timeMatch ? timeMatch[1] : value;
            return time;
        case 'weekly':
            // value 是周几的文本（已经根据语言生成）
            return value;
        default:
            return value;
    }
}

/**
 * 获取当前语言设置
 * @returns {Promise<string>}
 */
async function getCurrentLanguage() {
    try {
        const result = await browserAPI.storage.local.get('preferredLang');
        return result.preferredLang || 'zh_CN';
    } catch (error) {
        return 'zh_CN';
    }
}

// =======================================================
// 闹钟处理器
// =======================================================

/**
 * 处理定时器触发
 * @param {chrome.alarms.Alarm} alarm - 闹钟对象
 * @returns {Promise<void>}
 */
async function handleAlarmTrigger(alarm) {
    try {
        const settings = await getAutoBackupSettings();
        const lang = await getCurrentLanguage();
        
        if (alarm.name === ALARM_NAMES.REGULAR_CHECK) {
            // 周定时触发
            const weekDay = getCurrentWeekDayText(lang);
            const note = generateBackupNote('weekly', weekDay, lang);
            await triggerAutoBackup(note);
            
            // 重新设置下一个周定时
            await setupRegularTimeAlarms(settings.regularTime);
            
        } else if (alarm.name === ALARM_NAMES.HOUR_INTERVAL) {
            // 小时间隔触发
            const note = generateBackupNote('hour', settings.regularTime.hourInterval.hours, lang);
            await triggerAutoBackup(note);
            
            // 重新设置下一个小时间隔
            const nextTime = getNextHourIntervalTime(settings.regularTime.hourInterval.hours);
            await browserAPI.alarms.create(ALARM_NAMES.HOUR_INTERVAL, { when: nextTime });
            
        } else if (alarm.name === ALARM_NAMES.MINUTE_INTERVAL) {
            // 分钟间隔触发
            const note = generateBackupNote('minute', settings.regularTime.minuteInterval.minutes, lang);
            await triggerAutoBackup(note);
            
            // 重新设置下一个分钟间隔
            const includeZeroMinute = !settings.regularTime.hourInterval.enabled;
            const nextTime = getNextMinuteIntervalTime(
                settings.regularTime.minuteInterval.minutes,
                includeZeroMinute
            );
            await browserAPI.alarms.create(ALARM_NAMES.MINUTE_INTERVAL, { when: nextTime });
            
        } else if (alarm.name === ALARM_NAMES.SPECIFIC_CHECK) {
            // 特定时间触发
            const pendingSchedules = await getPendingSchedules();
            
            for (const schedule of pendingSchedules) {
                const note = generateBackupNote('specific', schedule.datetime, lang);
                const success = await triggerAutoBackup(note);
                if (success) {
                    await markScheduleAsExecuted(schedule.id);
                }
            }
            
            // 设置下一个特定时间
            await setupSpecificTimeAlarms(settings.specificTime);
        }
    } catch (error) {
        addLog(`处理定时器触发失败: ${error.message}`);
    }
}

// =======================================================
// 模块导出
// =======================================================

export {
    initializeTimerSystem,
    stopTimerSystem,
    restartTimerSystem,
    handleAlarmTrigger,
    checkMissedBackups,
    triggerAutoBackup,
    setupRegularTimeAlarms,
    setupSpecificTimeAlarms
};
