// =======================================================
// 自动备份定时器 - 模块入口
// Auto Backup Timer - Module Entry Point
// =======================================================

// 导出存储管理模块
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
    getPendingSchedules,
    markMissedBackupExecuted,
    isMissedBackupExecutedToday,
    updateLastMissedCheckTime,
    shouldCheckMissed
} from './storage.js';

// 导出定时器模块
export {
    setCallbacks,
    initializeTimerSystem,
    stopTimerSystem,
    restartTimerSystem,
    handleAlarmTrigger,
    checkMissedBackups,
    triggerAutoBackup,
    setupRegularTimeAlarms,
    setupSpecificTimeAlarms
} from './timer.js';

// 导出UI模块
export {
    createAutoBackupTimerUI,
    initializeUIEvents,
    loadSettings as loadAutoBackupSettings,
    applyLanguageToUI,
    renderSchedulesList
} from './settings-ui.js';
