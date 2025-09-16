// =======================================================
// 自动备份时间管理系统模块
// 支持实时、循环和定时三种自动备份模式
// =======================================================

// 导入浏览器兼容性API
const browserAPI = (function() {
    if (typeof chrome !== 'undefined') {
        if (typeof browser !== 'undefined') {
            return browser; // Firefox
        }
        return chrome; // Chrome, Edge
    }
    throw new Error('不支持的浏览器');
})();

// =======================================================
// 常量定义
// =======================================================
const AUTO_BACKUP_ALARMS = {
    CYCLIC: 'cyclicAutoBackupAlarm',
    SCHEDULED_1: 'scheduledAutoBackupAlarm1',
    SCHEDULED_2: 'scheduledAutoBackupAlarm2',
    FOCUS_TRACKER: 'autoBackupFocusTracker'
};

const AUTO_BACKUP_MODES = {
    REALTIME: 'realtime',
    CYCLIC: 'cyclic', 
    SCHEDULED: 'scheduled'
};

const TIME_CONSTANTS = {
    MINUTE: 60 * 1000,          // 1分钟 = 60000毫秒
    HOUR: 60 * 60 * 1000,       // 1小时 = 3600000毫秒  
    DAY: 24 * 60 * 60 * 1000    // 1天 = 86400000毫秒
};

// =======================================================
// 全局状态管理
// =======================================================
const autoBackupState = {
    currentMode: AUTO_BACKUP_MODES.REALTIME,
    isActive: false,
    lastFocusTime: null,
    lastActiveCheckTime: null,
    cyclicSettings: {
        enabled: false,
        days: 0,
        hours: 0, 
        minutes: 30
    },
    scheduledSettings: {
        time1: { enabled: false, time: '09:30' },
        time2: { enabled: false, time: '16:00' }
    },
    hasBookmarkChanges: false,
    hasUsageActivity: false
};

// =======================================================
// 时间转换工具函数
// =======================================================

/**
 * 将天、小时、分钟转换为毫秒
 * @param {number} days - 天数
 * @param {number} hours - 小时数 
 * @param {number} minutes - 分钟数
 * @returns {number} 总毫秒数
 */
function convertTimeToMilliseconds(days = 0, hours = 0, minutes = 0) {
    return (days * TIME_CONSTANTS.DAY) + 
           (hours * TIME_CONSTANTS.HOUR) + 
           (minutes * TIME_CONSTANTS.MINUTE);
}

/**
 * 计算下一个准点定时的时间戳
 * @param {string} timeStr - 时间字符串，格式为"HH:MM"
 * @param {boolean} forceNextDay - 是否强制设置为明天
 * @returns {number|null} 下一个定时点的时间戳，失败返回null
 */
function calculateNextScheduledTime(timeStr, forceNextDay = false) {
    try {
        const [hours, minutes] = timeStr.split(':').map(num => parseInt(num, 10));
        if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }

        const now = new Date();
        const targetTime = new Date();
        targetTime.setHours(hours, minutes, 0, 0);

        // 如果目标时间已经过去或者强制设置为明天，则设置为明天
        if (forceNextDay || targetTime <= now) {
            targetTime.setDate(targetTime.getDate() + 1);
        }

        return targetTime.getTime();
    } catch (error) {
        console.error('计算准点定时时间失败:', error);
        return null;
    }
}

// =======================================================
// 书签变化检测
// =======================================================

/**
 * 检查是否有书签变化
 * @returns {Promise<boolean>} 是否有变化
 */
async function hasBookmarkChanges() {
    try {
        const result = await browserAPI.runtime.sendMessage({ action: 'getBackupStats' });
        if (!result || !result.success || !result.stats) {
            return false;
        }

        const stats = result.stats;
        // 检查数量变化或结构变化
        return (stats.bookmarkDiff !== 0) || 
               (stats.folderDiff !== 0) || 
               stats.bookmarkMoved || 
               stats.folderMoved || 
               stats.bookmarkModified || 
               stats.folderModified;
    } catch (error) {
        console.error('检测书签变化失败:', error);
        return false;
    }
}

/**
 * 重置书签变化状态
 */
async function resetBookmarkChangeStatus() {
    try {
        await browserAPI.runtime.sendMessage({ action: 'resetOperationStatus' });
        autoBackupState.hasBookmarkChanges = false;
    } catch (error) {
        console.error('重置书签变化状态失败:', error);
    }
}

// =======================================================
// 浏览器活跃状态检测
// =======================================================

/**
 * 初始化窗口焦点监听
 */
function initializeFocusTracking() {
    // 监听窗口焦点变化
    if (!browserAPI.windows.onFocusChanged.hasListener(handleAutoBackupFocusChange)) {
        browserAPI.windows.onFocusChanged.addListener(handleAutoBackupFocusChange);
    }
}

/**
 * 处理窗口焦点变化（自动备份专用）
 * @param {number} windowId - 窗口ID
 */
async function handleAutoBackupFocusChange(windowId) {
    const now = Date.now();
    
    if (windowId === browserAPI.windows.WINDOW_ID_NONE) {
        // 所有窗口失去焦点，暂停活跃状态
        autoBackupState.isActive = false;
    } else {
        // 有窗口获得焦点，记录为活跃状态
        autoBackupState.isActive = true;
        autoBackupState.lastFocusTime = now;
        autoBackupState.hasUsageActivity = true;
    }
}

/**
 * 检查是否有实际使用活动
 * @returns {boolean} 是否有使用活动
 */
function hasUsageActivity() {
    return autoBackupState.hasUsageActivity && autoBackupState.isActive;
}

/**
 * 重置使用活动状态
 */
function resetUsageActivity() {
    autoBackupState.hasUsageActivity = false;
}

// =======================================================
// 定时器管理
// =======================================================

/**
 * 清除所有自动备份定时器
 */
async function clearAllAutoBackupTimers() {
    try {
        await browserAPI.alarms.clear(AUTO_BACKUP_ALARMS.CYCLIC);
        await browserAPI.alarms.clear(AUTO_BACKUP_ALARMS.SCHEDULED_1);
        await browserAPI.alarms.clear(AUTO_BACKUP_ALARMS.SCHEDULED_2);
        await browserAPI.alarms.clear(AUTO_BACKUP_ALARMS.FOCUS_TRACKER);
        console.log('已清除所有自动备份定时器');
    } catch (error) {
        console.error('清除自动备份定时器失败:', error);
    }
}

/**
 * 设置循环自动备份定时器
 * @param {number} days - 天数
 * @param {number} hours - 小时数
 * @param {number} minutes - 分钟数
 */
async function setCyclicTimer(days = 0, hours = 0, minutes = 30) {
    try {
        const intervalMs = convertTimeToMilliseconds(days, hours, minutes);
        if (intervalMs <= 0) {
            console.warn('循环备份时间间隔无效:', { days, hours, minutes });
            return false;
        }

        const intervalMinutes = intervalMs / (60 * 1000); // 转换为分钟
        await browserAPI.alarms.clear(AUTO_BACKUP_ALARMS.CYCLIC);
        await browserAPI.alarms.create(AUTO_BACKUP_ALARMS.CYCLIC, {
            periodInMinutes: intervalMinutes
        });

        console.log(`循环自动备份定时器已设置: ${days}天 ${hours}小时 ${minutes}分钟 (${intervalMinutes}分钟间隔)`);
        return true;
    } catch (error) {
        console.error('设置循环备份定时器失败:', error);
        return false;
    }
}

/**
 * 设置准点定时备份定时器
 * @param {number} slotNumber - 定时器槽位(1或2)
 * @param {string} timeStr - 时间字符串 "HH:MM"
 */
async function setScheduledTimer(slotNumber, timeStr) {
    try {
        const alarmName = slotNumber === 1 ? AUTO_BACKUP_ALARMS.SCHEDULED_1 : AUTO_BACKUP_ALARMS.SCHEDULED_2;
        const whenTime = calculateNextScheduledTime(timeStr);
        
        if (!whenTime) {
            console.warn(`准点定时${slotNumber}时间无效:`, timeStr);
            return false;
        }

        await browserAPI.alarms.clear(alarmName);
        await browserAPI.alarms.create(alarmName, { when: whenTime });

        console.log(`准点定时${slotNumber}备份定时器已设置: ${timeStr} (${new Date(whenTime).toLocaleString()})`);
        return true;
    } catch (error) {
        console.error(`设置准点定时${slotNumber}备份定时器失败:`, error);
        return false;
    }
}

// =======================================================
// 备份执行逻辑
// =======================================================

/**
 * 执行自动备份
 * @param {string} triggerType - 触发类型 'realtime', 'cyclic', 'scheduled'
 * @param {string} comment - 备份注释
 */
async function executeAutoBackup(triggerType, comment = '') {
    try {
        // 检查双重条件：使用活动 + 书签变化
        const hasActivity = hasUsageActivity();
        const hasChanges = await hasBookmarkChanges();

        if (!hasActivity || !hasChanges) {
            console.log(`自动备份跳过 - 使用活动: ${hasActivity}, 书签变化: ${hasChanges}`);
            return { success: false, reason: '无使用活动或无书签变化' };
        }

        // 生成备份注释和类型标识
        let backupComment = comment;
        let syncType = 'auto'; // 默认为自动备份
        
        if (!backupComment) {
            switch (triggerType) {
                case AUTO_BACKUP_MODES.REALTIME:
                    backupComment = '实时自动备份';
                    syncType = 'auto_realtime';
                    break;
                case AUTO_BACKUP_MODES.CYCLIC:
                    backupComment = '循环自动备份';
                    syncType = 'auto_cyclic';
                    break;
                case AUTO_BACKUP_MODES.SCHEDULED:
                    backupComment = '准点定时自动备份';
                    syncType = 'auto_scheduled';
                    break;
                default:
                    backupComment = '自动备份';
                    syncType = 'auto';
            }
        }

        // 执行实际备份操作
        const backupResult = await performActualBackup(backupComment, syncType);
        
        if (backupResult.success) {
            // 重置状态
            await resetBookmarkChangeStatus();
            resetUsageActivity();
            
            console.log(`${backupComment}执行成功`);
            
            // 通知UI更新角标和状态
            try {
                await browserAPI.runtime.sendMessage({ action: 'setBadge' });
            } catch (uiError) {
                // UI更新失败不影响备份结果
                console.warn('更新UI状态失败:', uiError);
            }
            
            return { 
                success: true, 
                type: triggerType,
                comment: backupComment,
                syncType: syncType
            };
        } else {
            console.error(`${backupComment}执行失败:`, backupResult);
            return { 
                success: false, 
                error: backupResult.error || '未知错误',
                type: triggerType
            };
        }
    } catch (error) {
        console.error('执行自动备份时发生错误:', error);
        return { 
            success: false, 
            error: error.message,
            type: triggerType
        };
    }
}

/**
 * 执行实际的备份操作
 * @param {string} comment - 备份注释
 * @param {string} syncType - 同步类型
 */
async function performActualBackup(comment, syncType) {
    try {
        // 获取当前书签数据
        const bookmarks = await new Promise((resolve) => {
            browserAPI.bookmarks.getTree((bookmarks) => resolve(bookmarks));
        });
        
        if (!bookmarks || !bookmarks.length) {
            throw new Error('无法获取书签数据');
        }

        // 检查WebDAV和本地备份配置
        const [webDAVConfig, localConfig] = await Promise.all([
            browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']),
            browserAPI.storage.local.get([
                'defaultDownloadEnabled', 'customFolderEnabled', 'customFolderPath',
                'localBackupPath', 'localBackupEnabled'
            ])
        ]);

        // 判断哪些备份方式可用
        const webDAVAvailable = webDAVConfig.serverAddress && 
                              webDAVConfig.username && 
                              webDAVConfig.password && 
                              webDAVConfig.webDAVEnabled !== false;
                              
        const localBackupAvailable = localConfig.defaultDownloadEnabled || 
                                    localConfig.customFolderEnabled || 
                                    localConfig.localBackupEnabled;

        if (!webDAVAvailable && !localBackupAvailable) {
            throw new Error('没有可用的备份方式，请先配置WebDAV或本地备份');
        }

        let webDAVSuccess = false;
        let localSuccess = false;
        const errors = [];
        const syncTime = new Date().toISOString();

        // 尝试WebDAV备份
        if (webDAVAvailable) {
            try {
                const uploadResult = await uploadBookmarksToWebDAV(bookmarks);
                webDAVSuccess = uploadResult.success;
                if (!webDAVSuccess && uploadResult.error) {
                    errors.push(`WebDAV: ${uploadResult.error}`);
                }
            } catch (error) {
                errors.push(`WebDAV: ${error.message}`);
            }
        }

        // 尝试本地备份
        if (localBackupAvailable) {
            try {
                const localResult = await uploadBookmarksToLocal(bookmarks);
                localSuccess = localResult.success;
                if (!localSuccess && localResult.error) {
                    errors.push(`本地: ${localResult.error}`);
                }
            } catch (error) {
                errors.push(`本地: ${error.message}`);
            }
        }

        // 确定备份结果和方向
        const overallSuccess = webDAVSuccess || localSuccess;
        let direction = 'none';
        
        if (webDAVSuccess && localSuccess) {
            direction = 'both';
        } else if (webDAVSuccess) {
            direction = 'webdav';
        } else if (localSuccess) {
            direction = 'local';
        }

        // 更新备份状态和历史记录
        const status = overallSuccess ? 'success' : 'error';
        const errorMessage = errors.length > 0 ? errors.join('; ') : '';
        
        await updateSyncStatusForAutoBackup(direction, syncTime, status, errorMessage, syncType, comment);

        return {
            success: overallSuccess,
            webDAVSuccess,
            localSuccess,
            direction,
            error: errorMessage || null
        };
        
    } catch (error) {
        // 记录失败状态
        const syncTime = new Date().toISOString();
        await updateSyncStatusForAutoBackup('none', syncTime, 'error', error.message, syncType, comment);
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 为自动备份更新同步状态
 * @param {string} direction - 备份方向
 * @param {string} time - 备份时间
 * @param {string} status - 备份状态
 * @param {string} errorMessage - 错误信息
 * @param {string} syncType - 同步类型
 * @param {string} comment - 备份注释
 */
async function updateSyncStatusForAutoBackup(direction, time, status, errorMessage, syncType, comment) {
    try {
        // 调用后台的updateSyncStatus函数
        await browserAPI.runtime.sendMessage({
            action: 'updateSyncStatus',
            direction: direction,
            time: time,
            status: status,
            errorMessage: errorMessage,
            syncType: syncType,
            comment: comment
        });
    } catch (error) {
        console.error('更新自动备份状态失败:', error);
        // 不抛出错误，允许备份继续
    }
}

/**
 * 上传书签到WebDAV
 * @param {Array} bookmarks - 书签数据
 */
async function uploadBookmarksToWebDAV(bookmarks) {
    try {
        // 调用background.js中的uploadBookmarks函数
        const result = await browserAPI.runtime.sendMessage({
            action: 'uploadBookmarks',
            bookmarks: bookmarks
        });
        
        return result;
    } catch (error) {
        return {
            success: false,
            error: error.message || 'WebDAV上传失败'
        };
    }
}

/**
 * 上传书签到本地
 * @param {Array} bookmarks - 书签数据
 */
async function uploadBookmarksToLocal(bookmarks) {
    try {
        // 调用background.js中的uploadBookmarksToLocal函数
        const result = await browserAPI.runtime.sendMessage({
            action: 'uploadBookmarksToLocal',
            bookmarks: bookmarks
        });
        
        return result;
    } catch (error) {
        return {
            success: false,
            error: error.message || '本地上传失败'
        };
    }
}

// =======================================================
// 定时器事件处理
// =======================================================

/**
 * 处理定时器触发事件
 * @param {object} alarm - 定时器对象
 */
async function handleAutoBackupAlarm(alarm) {
    if (!alarm || !alarm.name) return;

    try {
        switch (alarm.name) {
            case AUTO_BACKUP_ALARMS.CYCLIC:
                await executeAutoBackup(AUTO_BACKUP_MODES.CYCLIC);
                break;
                
            case AUTO_BACKUP_ALARMS.SCHEDULED_1:
                await executeAutoBackup(AUTO_BACKUP_MODES.SCHEDULED, '准点定时自动备份 (定时1)');
                // 重新设置下一天的定时器
                if (autoBackupState.scheduledSettings.time1.enabled) {
                    await setScheduledTimer(1, autoBackupState.scheduledSettings.time1.time);
                }
                break;
                
            case AUTO_BACKUP_ALARMS.SCHEDULED_2:
                await executeAutoBackup(AUTO_BACKUP_MODES.SCHEDULED, '准点定时自动备份 (定时2)');
                // 重新设置下一天的定时器
                if (autoBackupState.scheduledSettings.time2.enabled) {
                    await setScheduledTimer(2, autoBackupState.scheduledSettings.time2.time);
                }
                break;
        }
    } catch (error) {
        console.error('处理自动备份定时器事件失败:', error);
    }
}

// =======================================================
// 配置管理
// =======================================================

/**
 * 加载自动备份配置
 */
async function loadAutoBackupSettings() {
    try {
        const result = await browserAPI.storage.local.get([
            'autoBackupMode',
            'cyclicAutoBackupSettings', 
            'scheduledAutoBackupSettings'
        ]);

        autoBackupState.currentMode = result.autoBackupMode || AUTO_BACKUP_MODES.REALTIME;
        
        if (result.cyclicAutoBackupSettings) {
            Object.assign(autoBackupState.cyclicSettings, result.cyclicAutoBackupSettings);
        }
        
        if (result.scheduledAutoBackupSettings) {
            Object.assign(autoBackupState.scheduledSettings, result.scheduledAutoBackupSettings);
        }

        console.log('自动备份配置已加载:', autoBackupState);
    } catch (error) {
        console.error('加载自动备份配置失败:', error);
    }
}

/**
 * 保存自动备份配置
 */
async function saveAutoBackupSettings() {
    try {
        await browserAPI.storage.local.set({
            autoBackupMode: autoBackupState.currentMode,
            cyclicAutoBackupSettings: autoBackupState.cyclicSettings,
            scheduledAutoBackupSettings: autoBackupState.scheduledSettings
        });
        console.log('自动备份配置已保存');
    } catch (error) {
        console.error('保存自动备份配置失败:', error);
    }
}

/**
 * 更新自动备份设置
 * @param {object} settings - 新的设置对象
 */
async function updateAutoBackupSettings(settings) {
    try {
        // 验证设置
        const validatedSettings = validateAutoBackupSettings(settings);
        if (!validatedSettings.isValid) {
            throw new Error('设置验证失败: ' + validatedSettings.errors.join(', '));
        }

        // 停止当前系统
        await stopAutoBackupSystem();

        // 更新状态
        if (settings.mode) {
            autoBackupState.currentMode = settings.mode;
        }

        if (settings.cyclicSettings) {
            Object.assign(autoBackupState.cyclicSettings, settings.cyclicSettings);
        }

        if (settings.scheduledSettings) {
            Object.assign(autoBackupState.scheduledSettings, settings.scheduledSettings);
        }

        // 保存配置
        await saveAutoBackupSettings();

        // 重新启动系统
        await startAutoBackupSystem(autoBackupState.currentMode);

        console.log('自动备份设置已更新并重新启动:', settings);
        return { success: true };

    } catch (error) {
        console.error('更新自动备份设置失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 验证自动备份设置
 * @param {object} settings - 待验证的设置
 * @returns {object} 验证结果
 */
function validateAutoBackupSettings(settings) {
    const errors = [];

    // 验证模式
    if (settings.mode && !Object.values(AUTO_BACKUP_MODES).includes(settings.mode)) {
        errors.push('无效的备份模式');
    }

    // 验证循环设置
    if (settings.cyclicSettings) {
        const { days, hours, minutes, enabled } = settings.cyclicSettings;
        
        if (enabled) {
            if (typeof days !== 'number' || days < 0 || days > 30) {
                errors.push('天数必须在0-30之间');
            }
            if (typeof hours !== 'number' || hours < 0 || hours > 24) {
                errors.push('小时必须在0-24之间');
            }
            if (typeof minutes !== 'number' || minutes < 0 || minutes > 60) {
                errors.push('分钟必须在0-60之间');
            }
            
            const totalMinutes = days * 1440 + hours * 60 + minutes;
            if (totalMinutes <= 0) {
                errors.push('循环备份时间间隔必须大于0');
            }
        }
    }

    // 验证准点定时设置
    if (settings.scheduledSettings) {
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        
        ['time1', 'time2'].forEach((timeSlot, index) => {
            const timeConfig = settings.scheduledSettings[timeSlot];
            if (timeConfig && timeConfig.enabled) {
                if (!timeRegex.test(timeConfig.time)) {
                    errors.push(`定时${index + 1}的时间格式无效`);
                }
            }
        });
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * 恢复默认设置
 */
async function restoreDefaultSettings() {
    try {
        // 重置为默认值
        autoBackupState.currentMode = AUTO_BACKUP_MODES.REALTIME;
        autoBackupState.cyclicSettings = {
            enabled: false,
            days: 0,
            hours: 0,
            minutes: 30
        };
        autoBackupState.scheduledSettings = {
            time1: { enabled: false, time: '09:30' },
            time2: { enabled: false, time: '16:00' }
        };

        // 停止当前系统
        await stopAutoBackupSystem();
        
        // 保存默认配置
        await saveAutoBackupSettings();
        
        // 启动实时模式
        await startAutoBackupSystem(AUTO_BACKUP_MODES.REALTIME);
        
        console.log('已恢复自动备份默认设置');
        return { success: true };
        
    } catch (error) {
        console.error('恢复默认设置失败:', error);
        return { success: false, error: error.message };
    }
}

// =======================================================
// 主要控制函数
// =======================================================

/**
 * 启动自动备份系统
 * @param {string} mode - 备份模式
 */
async function startAutoBackupSystem(mode = AUTO_BACKUP_MODES.REALTIME) {
    try {
        // 清除现有定时器
        await clearAllAutoBackupTimers();
        
        // 初始化焦点跟踪
        initializeFocusTracking();
        
        // 设置当前模式
        autoBackupState.currentMode = mode;
        
        switch (mode) {
            case AUTO_BACKUP_MODES.REALTIME:
                // 实时模式不需要设置定时器，依靠书签变化监听
                console.log('实时自动备份已启动');
                break;
                
            case AUTO_BACKUP_MODES.CYCLIC:
                if (autoBackupState.cyclicSettings.enabled) {
                    const { days, hours, minutes } = autoBackupState.cyclicSettings;
                    await setCyclicTimer(days, hours, minutes);
                }
                break;
                
            case AUTO_BACKUP_MODES.SCHEDULED:
                if (autoBackupState.scheduledSettings.time1.enabled) {
                    await setScheduledTimer(1, autoBackupState.scheduledSettings.time1.time);
                }
                if (autoBackupState.scheduledSettings.time2.enabled) {
                    await setScheduledTimer(2, autoBackupState.scheduledSettings.time2.time);
                }
                break;
        }
        
        await saveAutoBackupSettings();
        console.log(`自动备份系统已启动，模式: ${mode}`);
        
    } catch (error) {
        console.error('启动自动备份系统失败:', error);
    }
}

/**
 * 停止自动备份系统
 */
async function stopAutoBackupSystem() {
    try {
        await clearAllAutoBackupTimers();
        
        // 移除焦点监听器
        if (browserAPI.windows.onFocusChanged.hasListener(handleAutoBackupFocusChange)) {
            browserAPI.windows.onFocusChanged.removeListener(handleAutoBackupFocusChange);
        }
        
        console.log('自动备份系统已停止');
    } catch (error) {
        console.error('停止自动备份系统失败:', error);
    }
}

/**
 * 实时模式 - 立即检查并执行备份
 */
async function triggerRealtimeBackup() {
    if (autoBackupState.currentMode === AUTO_BACKUP_MODES.REALTIME) {
        return await executeAutoBackup(AUTO_BACKUP_MODES.REALTIME);
    }
    return { success: false, reason: '当前不是实时自动备份模式' };
}

// =======================================================
// 导出接口
// =======================================================

// 如果在模块环境中，导出函数
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // 主要控制
        startAutoBackupSystem,
        stopAutoBackupSystem, 
        triggerRealtimeBackup,
        
        // 配置管理
        loadAutoBackupSettings,
        saveAutoBackupSettings,
        updateAutoBackupSettings,
        validateAutoBackupSettings,
        restoreDefaultSettings,
        
        // 定时器事件处理
        handleAutoBackupAlarm,
        
        // 工具函数
        convertTimeToMilliseconds,
        calculateNextScheduledTime,
        hasBookmarkChanges,
        hasUsageActivity,
        
        // 常量
        AUTO_BACKUP_MODES,
        AUTO_BACKUP_ALARMS,
        
        // 状态访问
        getAutoBackupState: () => autoBackupState
    };
}
