// =======================================================
// 自动备份定时器 - 存储管理模块
// Auto Backup Timer - Storage Management Module
// =======================================================

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
// 默认配置
// =======================================================

const DEFAULT_SETTINGS = {
    // 备份模式：'realtime', 'regular', 'specific'
    backupMode: 'regular',
    
    // 常规时间配置
    regularTime: {
        enabled: true,
        // 周开关：0=周日, 1=周一, ..., 6=周六
        weekDays: [true, true, true, true, true, true, true],
        defaultTime: '10:00',
        // 小时间隔配置
        hourInterval: {
            enabled: false,
            hours: 2  // 每N小时
        },
        // 分钟间隔配置
        minuteInterval: {
            enabled: true,
            minutes: 30  // 每N分钟
        }
    },
    
    // 特定时间配置（最多5个）
    specificTime: {
        enabled: false,
        schedules: []  // [{id, datetime, enabled, executed}]
    }
};

// =======================================================
// 存储操作函数
// =======================================================

/**
 * 获取自动备份定时器设置
 * @returns {Promise<Object>} 设置对象
 */
async function getAutoBackupSettings() {
    try {
        const data = await browserAPI.storage.local.get('autoBackupTimerSettings');
        return data.autoBackupTimerSettings || DEFAULT_SETTINGS;
    } catch (error) {
        console.error('获取自动备份定时器设置失败:', error);
        return DEFAULT_SETTINGS;
    }
}

/**
 * 保存自动备份定时器设置
 * @param {Object} settings - 设置对象
 * @returns {Promise<boolean>} 是否成功
 */
async function saveAutoBackupSettings(settings) {
    try {
        await browserAPI.storage.local.set({ autoBackupTimerSettings: settings });
        return true;
    } catch (error) {
        console.error('保存自动备份定时器设置失败:', error);
        return false;
    }
}

/**
 * 更新备份模式
 * @param {string} mode - 'realtime', 'regular', 'specific'
 * @returns {Promise<boolean>}
 */
async function updateBackupMode(mode) {
    try {
        const settings = await getAutoBackupSettings();
        settings.backupMode = mode;
        return await saveAutoBackupSettings(settings);
    } catch (error) {
        console.error('更新备份模式失败:', error);
        return false;
    }
}

/**
 * 更新常规时间配置
 * @param {Object} regularConfig - 常规时间配置对象
 * @returns {Promise<boolean>}
 */
async function updateRegularTimeConfig(regularConfig) {
    try {
        const settings = await getAutoBackupSettings();
        settings.regularTime = { ...settings.regularTime, ...regularConfig };
        return await saveAutoBackupSettings(settings);
    } catch (error) {
        console.error('更新常规时间配置失败:', error);
        return false;
    }
}

/**
 * 添加特定时间计划
 * @param {Object} schedule - {datetime, enabled}
 * @returns {Promise<Object|null>} 添加的计划对象（含id）或null
 */
async function addSpecificTimeSchedule(schedule) {
    try {
        const settings = await getAutoBackupSettings();
        
        // 检查是否已达到最大数量（5个）
        if (settings.specificTime.schedules.length >= 5) {
            console.error('特定时间计划已达到最大数量（5个）');
            return null;
        }
        
        // 生成唯一ID
        const id = `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newSchedule = {
            id,
            datetime: schedule.datetime,
            enabled: schedule.enabled !== false,
            executed: false,
            createdAt: new Date().toISOString()
        };
        
        settings.specificTime.schedules.push(newSchedule);
        await saveAutoBackupSettings(settings);
        
        return newSchedule;
    } catch (error) {
        console.error('添加特定时间计划失败:', error);
        return null;
    }
}

/**
 * 删除特定时间计划
 * @param {string} scheduleId - 计划ID
 * @returns {Promise<boolean>}
 */
async function removeSpecificTimeSchedule(scheduleId) {
    try {
        const settings = await getAutoBackupSettings();
        settings.specificTime.schedules = settings.specificTime.schedules.filter(
            s => s.id !== scheduleId
        );
        return await saveAutoBackupSettings(settings);
    } catch (error) {
        console.error('删除特定时间计划失败:', error);
        return false;
    }
}

/**
 * 更新特定时间计划
 * @param {string} scheduleId - 计划ID
 * @param {Object} updates - 更新的字段
 * @returns {Promise<boolean>}
 */
async function updateSpecificTimeSchedule(scheduleId, updates) {
    try {
        const settings = await getAutoBackupSettings();
        const schedule = settings.specificTime.schedules.find(s => s.id === scheduleId);
        
        if (!schedule) {
            console.error('未找到指定的计划:', scheduleId);
            return false;
        }
        
        Object.assign(schedule, updates);
        return await saveAutoBackupSettings(settings);
    } catch (error) {
        console.error('更新特定时间计划失败:', error);
        return false;
    }
}

/**
 * 标记特定时间计划为已执行
 * @param {string} scheduleId - 计划ID
 * @returns {Promise<boolean>}
 */
async function markScheduleAsExecuted(scheduleId) {
    return await updateSpecificTimeSchedule(scheduleId, { 
        executed: true,
        executedAt: new Date().toISOString()
    });
}

/**
 * 获取待执行的特定时间计划
 * @returns {Promise<Array>} 待执行的计划列表
 */
async function getPendingSchedules() {
    try {
        const settings = await getAutoBackupSettings();
        const now = new Date().getTime();
        
        return settings.specificTime.schedules.filter(schedule => {
            if (!schedule.enabled || schedule.executed) {
                return false;
            }
            
            const scheduleTime = new Date(schedule.datetime).getTime();
            return scheduleTime <= now;
        });
    } catch (error) {
        console.error('获取待执行计划失败:', error);
        return [];
    }
}

// =======================================================
// 模块导出
// =======================================================

export {
    DEFAULT_SETTINGS,
    getAutoBackupSettings,
    saveAutoBackupSettings,
    updateBackupMode,
    updateRegularTimeConfig,
    addSpecificTimeSchedule,
    removeSpecificTimeSchedule,
    updateSpecificTimeSchedule,
    markScheduleAsExecuted,
    getPendingSchedules
};
