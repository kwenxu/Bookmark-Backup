// =======================================================
// 自动备份定时器 - 模块入口
// Auto Backup Timer - Module Entry Point
// =======================================================

// 导出定时器模块（供 background.js 使用）
export {
    setCallbacks,
    initializeTimerSystem,
    stopTimerSystem,
    restartTimerSystem,
    handleAlarmTrigger,
    checkMissedBackups
} from './timer.js';

// 导出UI模块（供 popup.js 使用）
export {
    createAutoBackupTimerUI,
    initializeUIEvents,
    loadSettings as loadAutoBackupSettings,
    applyLanguageToUI
} from './settings-ui.js';
