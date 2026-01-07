// 在文件顶部添加全局错误处理，捕获并忽略特定的连接错误
self.addEventListener('unhandledrejection', function (event) {
    // 检查错误消息是否是想要抑制的连接错误
    if (event.reason &&
        event.reason.message &&
        event.reason.message.includes('Could not establish connection') &&
        event.reason.message.includes('Receiving end does not exist')) {

        // 阻止错误显示在控制台
        event.preventDefault();
        event.stopPropagation();

        // 可选：记录一个更友好的调试信息
        return false; // 阻止错误传播
    }
});

// =================================================================================
// I. IMPORTS, GLOBAL DEFINITIONS & INITIALIZATIONS (导入、全局定义和初始化)
// =================================================================================

// 导入备份提醒系统
import {
    initializeBackupReminder,
    onAutoBackupToggled,
    onManualBackupCompleted
} from './backup_reminder/index.js';

// 从timer.js直接导入函数
import { pauseReminderTimer, resumeReminderTimer, handleAlarm, startLoopReminder, stopLoopReminder } from './backup_reminder/timer.js';

// 导入自动备份定时器系统
import {
    setCallbacks as setAutoBackupCallbacks,
    initializeTimerSystem as initializeAutoBackupTimerSystem,
    stopTimerSystem as stopAutoBackupTimerSystem,
    restartTimerSystem as restartAutoBackupTimerSystem,
    handleAlarmTrigger as handleAutoBackupAlarmTrigger,
    checkMissedBackups as checkMissedBackupsFromTimer
} from './auto_backup_timer/index.js';

// 导入活跃时间追踪模块
import {
    initialize as initializeActiveTimeTracker,
    setupEventListeners as setupActiveTimeTrackerListeners,
    setTrackingEnabled,
    isTrackingEnabled,
    getCurrentActiveSessions,
    getSessionsByUrl,
    getSessionsByTimeRange,
    getBookmarkActiveTimeStats,
    getTrackingStats,
    rebuildBookmarkCache as rebuildActiveTimeBookmarkCache,
    clearAllSessions,
    clearTrackingDisplayData,  // 清除显示数据（兼容旧接口）
    clearCurrentTrackingSessions,  // 仅清除正在追踪
    clearTrackingStatsByRange,  // 按时间范围清除综合排行
    syncTrackingData,  // 数据一致性检查
    noteAutoBookmarkNavigation,
    saveAllActiveSessions
} from './active_time_tracker/index.js';

// 导入 GitHub Repository 云端模块（云端2）
import { getRepoInfo, testRepoConnection, upsertRepoFile } from './github/repo-api.js';

// 浏览器兼容性处理
// 注意：Edge 也可能暴露 `browser` 命名空间，但其行为与 Firefox 不完全一致。
// 本项目在 MV3 下同时使用了回调式与 Promise 式 API，因此优先使用 `chrome`（Chrome/Edge）。
const browserAPI = (function () {
    if (typeof chrome !== 'undefined') return chrome; // Chrome, Edge
    if (typeof browser !== 'undefined') return browser; // Firefox 等
    throw new Error('不支持的浏览器');
})();

// Global Constants
const SYNC_LOCK_TIMEOUT = 30 * 1000;      // 30秒锁定超时
const badgeTextMap = { // 添加角标文本的国际化映射对象 - 在文件顶部添加
    'auto': {
        'zh_CN': '自',
        'en': 'A'
    },
    'manual': {
        'zh_CN': '手',
        'en': 'M'
    },
    'error': {
        'zh_CN': '!',
        'en': '!'
    }
};

// Unified Export Folder Paths - 统一的导出文件夹路径（根据语言动态选择）
// const EXPORT_ROOT_FOLDER = 'Bookmark Git & Toolbox';  // 父文件夹保持英文 - REMOVED

function getExportRootFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签快照 & 工具箱' : 'Bookmark Git & Toolbox';
}

function getLegacyExportRootFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签快照 & 工具箱' : 'Bookmark Git & Toolbox';
}

function getAllExportRootFolderCandidates() {
    return [
        getExportRootFolderByLang('zh_CN'),
        getExportRootFolderByLang('en'),
        getLegacyExportRootFolderByLang('zh_CN'),
        getLegacyExportRootFolderByLang('en')
    ];
}

async function getExportRootFolder() {
    const lang = await getCurrentLang();
    return getExportRootFolderByLang(lang);
}

// 异步获取当前语言的辅助函数
async function getCurrentLang() {
    try {
        const { currentLang, preferredLang } = await browserAPI.storage.local.get(['currentLang', 'preferredLang']);
        return currentLang || preferredLang || 'zh_CN';
    } catch (e) {
        return 'zh_CN';
    }
}

// 获取本地化的文件夹名称
function getBackupFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签备份' : 'Bookmark Backup';
}

function getHistoryFolderByLang(lang) {
    return lang === 'zh_CN' ? '备份历史' : 'Bookmarks_History';
}

function getCurrentChangesFolderByLang(lang) {
    return lang === 'zh_CN' ? '当前变化' : 'Current Changes';
}

function getCanvasFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签画布' : 'Canvas';
}

function getRecordsFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签记录' : 'Records';
}

function getClickHistoryFolderByLang(lang) {
    return lang === 'zh_CN' ? '点击记录' : 'Click History';
}

async function getBackupFolder() {
    const lang = await getCurrentLang();
    return getBackupFolderByLang(lang);
}

async function getHistoryFolder() {
    const lang = await getCurrentLang();
    return getHistoryFolderByLang(lang);
}

async function getCurrentChangesFolder() {
    const lang = await getCurrentLang();
    return getCurrentChangesFolderByLang(lang);
}

async function getCanvasFolder() {
    const lang = await getCurrentLang();
    return getCanvasFolderByLang(lang);
}

async function getRecordsFolder() {
    const lang = await getCurrentLang();
    return getRecordsFolderByLang(lang);
}

async function getClickHistoryFolder() {
    const lang = await getCurrentLang();
    return getClickHistoryFolderByLang(lang);
}

function resolveExportSubFolderByKey(folderKey, lang) {
    const key = String(folderKey || '').trim();
    switch (key) {
        case 'backup':
            return getBackupFolderByLang(lang);
        case 'history':
            return getHistoryFolderByLang(lang);
        case 'current_changes':
            return getCurrentChangesFolderByLang(lang);
        case 'canvas':
            return getCanvasFolderByLang(lang);
        case 'records':
            return getRecordsFolderByLang(lang);
        case 'click_history':
            return getClickHistoryFolderByLang(lang);
        default:
            return getHistoryFolderByLang(lang);
    }
}

// Global Variables
// 添加文件锁定状态追踪
let lastLockTime = null;
let consecutiveLockCount = 0;
// 添加变量保存原始下载栏状态
let originalDownloadShelfState = true; // 默认为显示
let isBookmarkBackupInProgress = false; // 标记是否正在进行书签备份
let bookmarkDownloadIds = new Set(); // 存储书签备份相关的下载ID
let nonBookmarkDownloadCount = 0; // 追踪非书签备份下载的数量
// 跟踪书签和文件夹的操作状态
let bookmarkMoved = false;
let folderMoved = false;
let bookmarkModified = false;
let folderModified = false;
// 添加一个变量标记备份提醒系统是否已初始化
let hasInitializedBackupReminder = false;
// 添加一个变量来标记是否正在进行备份
let isSyncing = false;
let bookmarkChangeTimeout = null;
// 添加一个变量标记是否是从syncDownloadState调用的onCreated处理
let isProcessingHistoricalDownloads = false;
// 记录扩展启动时间，用于区分历史下载和新下载
const extensionStartupTime = Date.now();
// 智能缓存书签分析结果
let cachedBookmarkAnalysis = null;

// 最近移动的节点（用于前端稳定显示蓝色移动标识）
const RECENT_MOVED_TTL_MS = Infinity; // 永久记录移动历史，取消2分钟限制


// 重置操作状态的函数
function resetOperationStatus() {
    bookmarkMoved = false;
    folderMoved = false;
    bookmarkModified = false;
    folderModified = false;

    // 保存到storage以便在不同会话之间保持状态
    browserAPI.storage.local.set({
        lastSyncOperations: {
            bookmarkMoved: false,
            folderMoved: false,
            bookmarkModified: false,
            folderModified: false,
            resetTime: new Date().toISOString()
        },
        // 同时清除移动、修改和新增的历史记录（书签Git风格：备份后重置基线）
        recentMovedIds: [],
        recentModifiedIds: [],
        recentAddedIds: []
    });
}


// =================================================================================
// Keyboard commands for opening history views (Alt/Option + 1~4)
// =================================================================================

async function openHistoryViewFromCommand(view) {
    try {
        const url = browserAPI.runtime.getURL(`history_html/history.html?view=${view}`);
        await browserAPI.tabs.create({ url });
    } catch (e) {
        console.warn('[Commands] 打开视图失败:', view, e);
    }
}

if (browserAPI.commands && browserAPI.commands.onCommand) {
    browserAPI.commands.onCommand.addListener((command) => {
        switch (command) {
            case 'open_current_changes_view':
                openHistoryViewFromCommand('current-changes');
                break;
            case 'open_backup_history_view':
                openHistoryViewFromCommand('history');
                break;
            case 'open_canvas_view':
                openHistoryViewFromCommand('canvas');
                break;
            case 'open_additions_view':
                openHistoryViewFromCommand('additions');
                break;
            case 'open_recommend_view':
                openHistoryViewFromCommand('recommend');
                break;
            default:
                break;
        }
    });
}

// 初始化操作状态跟踪 - 实现「书签Git」风格的变化检测
// 核心原则：与上次备份进行对比，而不是累计操作次数
function initializeOperationTracking() {

    // 辅助函数：记录移动的节点（去重，同一ID只记录一次）
    async function recordRecentMovedId(movedId, info) {
        try {
            const now = Date.now();
            const data = await browserAPI.storage.local.get(['recentMovedIds']);
            const list = Array.isArray(data.recentMovedIds) ? data.recentMovedIds : [];
            // 过滤掉过期的记录
            const filtered = list.filter(r => (now - (r.time || 0)) < RECENT_MOVED_TTL_MS);
            // 去重：如果已存在该ID，更新而不是新增（书签Git风格：只记录最终位置）
            const existingIndex = filtered.findIndex(r => r.id === movedId);
            const newRecord = { id: movedId, time: now, parentId: info && info.parentId, oldParentId: info && info.oldParentId, index: info && info.index };
            if (existingIndex >= 0) {
                filtered[existingIndex] = newRecord; // 更新现有记录
            } else {
                filtered.push(newRecord); // 新增记录
            }
            await browserAPI.storage.local.set({ recentMovedIds: filtered });
        } catch (e) {
            // 忽略
        }
    }

    // 辅助函数：记录修改的节点（去重，同一ID只记录一次）
    async function recordRecentModifiedId(modifiedId, info) {
        try {
            const now = Date.now();
            const data = await browserAPI.storage.local.get(['recentModifiedIds']);
            const list = Array.isArray(data.recentModifiedIds) ? data.recentModifiedIds : [];
            // 过滤掉过期的记录
            const filtered = list.filter(r => (now - (r.time || 0)) < RECENT_MOVED_TTL_MS);
            // 去重：如果已存在该ID，更新而不是新增
            const existingIndex = filtered.findIndex(r => r.id === modifiedId);
            const newRecord = { id: modifiedId, time: now, changeInfo: info };
            if (existingIndex >= 0) {
                filtered[existingIndex] = newRecord; // 更新现有记录
            } else {
                filtered.push(newRecord); // 新增记录
            }
            await browserAPI.storage.local.set({ recentModifiedIds: filtered });
        } catch (e) {
            // 忽略
        }
    }

    // 辅助函数：记录新增的节点
    async function recordRecentAddedId(addedId, info) {
        try {
            const now = Date.now();
            const data = await browserAPI.storage.local.get(['recentAddedIds']);
            const list = Array.isArray(data.recentAddedIds) ? data.recentAddedIds : [];
            // 过滤掉过期的记录
            const filtered = list.filter(r => (now - (r.time || 0)) < RECENT_MOVED_TTL_MS);
            // 去重
            const existingIndex = filtered.findIndex(r => r.id === addedId);
            const newRecord = { id: addedId, time: now, ...info };
            if (existingIndex >= 0) {
                filtered[existingIndex] = newRecord;
            } else {
                filtered.push(newRecord);
            }
            await browserAPI.storage.local.set({ recentAddedIds: filtered });
        } catch (e) {
            // 忽略
        }
    }

    // 辅助函数：从所有记录中移除已删除的节点（书签Git风格：删除后不再显示为"新增"或"移动"）
    async function removeFromAllRecords(removedId) {
        try {
            const data = await browserAPI.storage.local.get(['recentMovedIds', 'recentModifiedIds', 'recentAddedIds']);
            const movedList = Array.isArray(data.recentMovedIds) ? data.recentMovedIds : [];
            const modifiedList = Array.isArray(data.recentModifiedIds) ? data.recentModifiedIds : [];
            const addedList = Array.isArray(data.recentAddedIds) ? data.recentAddedIds : [];

            const filteredMoved = movedList.filter(r => r.id !== removedId);
            const filteredModified = modifiedList.filter(r => r.id !== removedId);
            const filteredAdded = addedList.filter(r => r.id !== removedId);

            await browserAPI.storage.local.set({
                recentMovedIds: filteredMoved,
                recentModifiedIds: filteredModified,
                recentAddedIds: filteredAdded
            });

            console.log('[书签Git] 已从记录中移除删除的节点:', removedId);
        } catch (e) {
            console.warn('[书签Git] 移除删除节点失败:', e);
        }
    }

    // 监听书签创建事件
    browserAPI.bookmarks.onCreated.addListener((id, bookmark) => {
        cachedBookmarkAnalysis = null; // Invalidate cache
        // 记录新增的节点
        try {
            recordRecentAddedId(id, {
                title: bookmark.title,
                url: bookmark.url,
                parentId: bookmark.parentId,
                index: bookmark.index,
                isFolder: !bookmark.url
            });
        } catch (_) { }
    });

    // 监听书签删除事件
    browserAPI.bookmarks.onRemoved.addListener((id, removeInfo) => {
        cachedBookmarkAnalysis = null; // Invalidate cache
        // 从所有记录中移除该节点（书签Git风格）
        try {
            removeFromAllRecords(id);
        } catch (_) { }
    });

    // 监听书签移动事件
    browserAPI.bookmarks.onMoved.addListener((id, moveInfo) => {
        cachedBookmarkAnalysis = null; // Invalidate cache
        // 确定被移动的是书签还是文件夹
        browserAPI.bookmarks.get(id, (nodes) => {
            if (nodes && nodes.length > 0) {
                const node = nodes[0];
                if (node.url) {
                    // 是书签
                    bookmarkMoved = true;
                } else {
                    // 是文件夹
                    folderMoved = true;
                }

                // 保存状态
                browserAPI.storage.local.set({
                    lastSyncOperations: {
                        bookmarkMoved: bookmarkMoved,
                        folderMoved: folderMoved,
                        bookmarkModified: bookmarkModified,
                        folderModified: folderModified,
                        lastUpdateTime: new Date().toISOString()
                    }
                });
                // 记录最近移动的节点，供前端稳定打标（去重）
                try {
                    recordRecentMovedId(id, { parentId: moveInfo.parentId, oldParentId: moveInfo.oldParentId, index: moveInfo.index });
                    // 立即广播本次移动，避免依赖后续分析刷新导致的首次后不再标蓝问题
                    try { browserAPI.runtime.sendMessage({ action: 'recentMovedBroadcast', id }); } catch (_) { }
                } catch (_) { }
            }
        });
    });

    // 监听文件夹子项重排事件：
    // - 某些"同父级排序/批量调整"场景可能只触发 onChildrenReordered（未必逐个触发 onMoved）
    // - 如果不记录为结构变化，角标不会变黄（用户会误以为没有变化）
    try {
        if (browserAPI.bookmarks.onChildrenReordered) {
            browserAPI.bookmarks.onChildrenReordered.addListener((parentId, reorderInfo) => {
                cachedBookmarkAnalysis = null; // Invalidate cache
                try {
                    // 重排本质上就是"结构变化（移动）"
                    // 这里无法可靠区分被重排的是书签还是文件夹，因此同时置为 true，保证变化检测准确触发。
                    bookmarkMoved = true;
                    folderMoved = true;

                    // 保存状态
                    browserAPI.storage.local.set({
                        lastSyncOperations: {
                            bookmarkMoved: bookmarkMoved,
                            folderMoved: folderMoved,
                            bookmarkModified: bookmarkModified,
                            folderModified: folderModified,
                            lastUpdateTime: new Date().toISOString()
                        }
                    });
                } catch (_) { }
            });
        }
    } catch (_) { }

    // 监听书签修改事件
    browserAPI.bookmarks.onChanged.addListener((id, changeInfo) => {
        cachedBookmarkAnalysis = null; // Invalidate cache
        // 确定被修改的是书签还是文件夹
        browserAPI.bookmarks.get(id, (nodes) => {
            if (nodes && nodes.length > 0) {
                const node = nodes[0];
                if (node.url) {
                    // 是书签
                    bookmarkModified = true;

                    // 如果URL被修改，通知历史查看器清除favicon缓存
                    if (changeInfo.url) {
                        try {
                            browserAPI.runtime.sendMessage({
                                action: 'clearFaviconCache',
                                url: changeInfo.url
                            });
                        } catch (e) {
                            // 如果没有监听器也没关系
                        }
                    }
                } else {
                    // 是文件夹
                    folderModified = true;
                }

                // 保存状态
                browserAPI.storage.local.set({
                    lastSyncOperations: {
                        bookmarkMoved: bookmarkMoved,
                        folderMoved: folderMoved,
                        bookmarkModified: bookmarkModified,
                        folderModified: folderModified,
                        lastUpdateTime: new Date().toISOString()
                    }
                });

                // 记录最近修改的节点（去重）
                try {
                    recordRecentModifiedId(id, changeInfo);
                } catch (_) { }
            }
        });
    });
}


// 在初始化时设置角标
async function initializeBadge() {
    try {
        const { autoSync, lastSyncStatus, isYellowHandActive } = await browserAPI.storage.local.get({
            autoSync: true,
            lastSyncStatus: 'success',
            isYellowHandActive: false // 新增：获取黄色角标状态
        });

        if (!autoSync) {
            // 如果是手动模式，根据 isYellowHandActive 状态决定是否启动循环提醒
            if (isYellowHandActive) {
                await startLoopReminder();
            } else {
                await stopLoopReminder(); // 确保是停止状态
            }
        }

        // 初始设置角标颜色和文字
        await setBadge();
    } catch (error) {
        await browserAPI.action.setBadgeText({ text: '!' });
        await browserAPI.action.setBadgeBackgroundColor({ color: '#FF0000' }); // 红色
    }
}

// 初始化时设置自动备份
async function initializeAutoSync() {
    try {
        // 获取自动备份设置
        const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);

        // 清除现有的定时器（如果有）
        // if (autoSyncInterval) { // autoSyncInterval not defined globally, this was from original comments
        //     clearInterval(autoSyncInterval);
        //     autoSyncInterval = null;
        // }

        // 如果启用了自动备份，创建新的定时任务
        /* 注释掉自动备份检测
        if (autoSync) {
            autoSyncInterval = setInterval(async () => {
                try {
                    await syncBookmarks(false, null, false, null);
                } catch (error) {
}
            }, 10 * 60 * 1000); // 每10分钟执行一次

} else {
}
        */
    } catch (error) {
    }
}

// 创建或更新定时备份任务
async function updateSyncAlarm() {
    try {
        // 获取自动备份设置
        const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);

        // 清除现有的定时任务
        await browserAPI.alarms.clear("syncBookmarks");

        // 注释掉定时器创建
        /* if (autoSync) {
            browserAPI.alarms.create("syncBookmarks", {
                periodInMinutes: 10  // 每10分钟检查一次
            });
} else {
} */
    } catch (error) {
    }
}

// 页面加载时初始化操作状态跟踪
initializeOperationTracking();

// 确保页面加载时初始化备份提醒系统
if (!hasInitializedBackupReminder) {
    hasInitializedBackupReminder = true;
    initializeBackupReminder().catch(error => {
        hasInitializedBackupReminder = false; // 重置标志以允许未来重试
    });
}


// =================================================================================
// II. CORE EVENT LISTENERS (核心事件监听器)
// =================================================================================

// 初始化定时任务
browserAPI.runtime.onInstalled.addListener(async (details) => { // 添加 async 和 details 参数
    // 新增：初始化存储，确保首次运行时有基准
    if (details.reason === 'install' || details.reason === 'update') {
        try {
            const currentData = await browserAPI.storage.local.get([
                'lastBookmarkData',
                'lastCalculatedDiff',
                'lastSyncStats', // 可选：也初始化 lastSyncStats
                'bookmarkCanvasThumbnail'
            ]);
            const updateObj = {};
            if (!currentData.lastBookmarkData) {
                updateObj.lastBookmarkData = null; // 明确设为 null
            }
            if (!currentData.lastCalculatedDiff) {
                updateObj.lastCalculatedDiff = { bookmarkDiff: 0, folderDiff: 0, timestamp: null }; // 设为默认值
            }
            if (!currentData.lastSyncStats) {
                updateObj.lastSyncStats = null; // 明确设为 null
            }

            if (Object.keys(updateObj).length > 0) {
                await browserAPI.storage.local.set(updateObj);
            }
        } catch (error) {
        }
    }

    updateSyncAlarm();
    await initializeBadge(); // 使用 await 确保 badge 初始化完成
    // initializeAutoSync(); // Not awaiting it as per original structure potentially

    // 初始化备份提醒系统（如果尚未初始化）
    if (!hasInitializedBackupReminder) {
        hasInitializedBackupReminder = true;
        initializeBackupReminder().catch(error => {
            hasInitializedBackupReminder = false; // 重置标志以允许未来重试
        });
    } else {
    }
});

// 确保定时器在浏览器启动时也能正确创建
// 注意：此处不调用 initializeBadge()，避免与下方统一的 onStartup 重复
browserAPI.runtime.onStartup.addListener(async () => {
    updateSyncAlarm();
    // initializeBadge(); // 已移除：避免重复调用（下方统一的 onStartup 会调用）
    // initializeAutoSync(); // Not awaiting it as per original structure potentially

    // 初始化备份提醒系统（如果尚未初始化）
    if (!hasInitializedBackupReminder) {
        hasInitializedBackupReminder = true;
        initializeBackupReminder().catch(error => {
            hasInitializedBackupReminder = false; // 重置标志以允许未来重试
        });
    } else {
    }

    // 初始化自动备份定时器系统
    try {
        // 设置定时器系统的回调函数（必须在任何定时器操作前设置）
        setAutoBackupCallbacks(
            checkBookmarkChangesForAutoBackup,  // 检查书签变化
            syncBookmarks                        // 执行备份
        );
        console.log('[自动备份定时器] 回调函数已设置');
    } catch (error) {
        console.error('[自动备份定时器] 回调函数设置失败:', error);
    }

    // 使用主动查询方法同步下载状态，避免大量onCreated日志
    syncDownloadState();
    // 首次启动时预热缓存
    await updateAndCacheAnalysis();

    // 浏览器启动后，直接初始化定时器系统（包含遗漏检查）
    try {
        const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
        if (autoSync) {
            console.log('[自动备份定时器] 浏览器启动，初始化定时器并检查遗漏任务');

            // 检查是否有变化（角标是否应该黄）
            const changeResult = await checkBookmarkChangesForAutoBackup();
            if (changeResult && changeResult.hasChanges) {
                console.log('[自动备份定时器] 检测到书签变化，启动定时器系统');
                // 直接初始化定时器系统，传入 true 强制检查遗漏
                await initializeAutoBackupTimerSystem(true);
                autoBackupTimerRunning = true; // 标记为运行中
            } else {
                console.log('[自动备份定时器] 无书签变化，跳过遗漏检查和定时器启动');
            }
        }
    } catch (error) {
        console.error('[自动备份定时器] 定时器初始化失败:', error);
    }
});

/**
 * 主动同步下载状态，用于替代依赖onCreated的被动通知方式
 * 这将减少启动时的大量日志输出，同时保持状态的准确性
 */
async function syncDownloadState() {
    try {
        // 获取所有可能的父文件夹名称（兼容：中/英 + 新/旧命名）
        const exportRootFolderCandidates = getAllExportRootFolderCandidates();

        // 查询由本扩展创建的书签相关下载（最近500项）
        const bookmarkDownloads = await new Promise(resolve => {
            browserAPI.downloads.search({
                limit: 500,
                orderBy: ['-startTime']
            }, items => {
                resolve(items.filter(item => {
                    // 使用更准确的条件识别书签备份下载
                    if (!item.filename) return false;

                    // 检查是否为书签备份文件 - 使用统一文件夹路径
                    return (
                        // 1. 路径中包含统一父文件夹
                        exportRootFolderCandidates.some(root => item.filename.includes(`/${root}/`)) ||
                        // 2. 路径中包含Bookmarks目录（兼容旧版）
                        item.filename.includes('/Bookmarks/') ||
                        // 3. 路径中包含Bookmarks_History目录（兼容旧版）
                        item.filename.includes('/Bookmarks_History/') ||
                        // 4. 数据URL方式的HTML内容
                        (item.url && item.url.includes('data:text/html') && item.url.includes('charset=utf-8'))
                    );
                }));
            });
        });

        // 筛选进行中的书签下载
        const activeBookmarkDownloads = bookmarkDownloads.filter(
            item => item.state && item.state === 'in_progress'
        );

        // 筛选最近完成但可能尚未被处理的书签下载
        const recentlyCompletedDownloads = bookmarkDownloads.filter(
            item => item.state && item.state === 'complete' &&
                item.endTime && (new Date(item.endTime).getTime() > extensionStartupTime - 60000)  // 最近1分钟完成的
        );

        // 处理进行中的和最近完成的书签下载
        const downloadsToProcess = [...activeBookmarkDownloads, ...recentlyCompletedDownloads];

        if (downloadsToProcess.length > 0) {
            // 将历史处理标志设为true，以避免onCreated处理器输出大量日志
            isProcessingHistoricalDownloads = true;

            // 处理每个需要关注的下载项
            for (const download of downloadsToProcess) {
                // 模拟onCreated事件的处理，但不输出冗长日志
                bookmarkDownloadIds.add(download.id);
            }

            // 处理完成后重置标志
            isProcessingHistoricalDownloads = false;

        } else {
        }
    } catch (error) {
        isProcessingHistoricalDownloads = false; // 确保在出错时重置标志
    }
}

// 添加下载开始事件监听器
browserAPI.downloads.onCreated.addListener(async (downloadItem) => {
    try {
        // 不再输出"下载开始"日志

        // 获取所有可能的父文件夹名称（兼容：中/英 + 新/旧命名）
        const exportRootFolderCandidates = getAllExportRootFolderCandidates();

        // 使用更准确的条件识别书签备份下载 - 使用统一文件夹路径
        const isBookmarkDownload = downloadItem.filename && (
            // 1. 路径中包含统一父文件夹
            exportRootFolderCandidates.some(root => downloadItem.filename.includes(`/${root}/`)) ||
            // 2. 路径中包含Bookmarks目录（兼容旧版）
            downloadItem.filename.includes('/Bookmarks/') ||
            // 3. 路径中包含Bookmarks_History目录（兼容旧版）
            downloadItem.filename.includes('/Bookmarks_History/') ||
            // 4. 数据URL方式的HTML内容
            (downloadItem.url && downloadItem.url.includes('data:text/html') && downloadItem.url.includes('charset=utf-8'))
        );

        // 判断是否为历史下载项的重新通知（根据启动时间或处理标志）
        const isHistoricalDownload = isProcessingHistoricalDownloads ||
            (downloadItem.startTime && new Date(downloadItem.startTime).getTime() < extensionStartupTime);

        if (isBookmarkDownload) {
            // 将此下载ID加入书签下载集合
            bookmarkDownloadIds.add(downloadItem.id);
            // 不再输出"检测到书签备份下载"日志
        } else if (isBookmarkBackupInProgress) {
            // 如果有正在进行的书签备份，且有其他非书签备份下载，需要特殊处理
            nonBookmarkDownloadCount++; // 增加计数
            // 获取当前防干扰设置
            const { hideDownloadShelf } = await browserAPI.storage.local.get(['hideDownloadShelf']);
            const shouldHideDownloadShelf = hideDownloadShelf !== false; // 默认为true

            // 检查是否有下载栏权限
            const hasDownloadShelfPermission = await new Promise(resolve => {
                try {
                    browserAPI.permissions.contains({
                        permissions: ['downloads.shelf']
                    }, result => {
                        resolve(result);
                    });
                } catch (error) {
                    resolve(false);
                }
            });

            // 如果开启了防干扰功能，且当前有其他下载，临时显示下载栏
            if (shouldHideDownloadShelf && hasDownloadShelfPermission && nonBookmarkDownloadCount === 1) {
                // 只在第一个非书签下载时恢复下载栏显示
                await browserAPI.downloads.setShelfEnabled(true);
            }

            // 监听这个下载的完成事件
            const onDownloadComplete = async (delta) => {
                if (delta.id === downloadItem.id && (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted'))) {
                    // 移除监听器
                    browserAPI.downloads.onChanged.removeListener(onDownloadComplete);

                    // 减少非书签下载计数
                    nonBookmarkDownloadCount = Math.max(0, nonBookmarkDownloadCount - 1);
                    // 如果书签备份仍在进行，且需要隐藏下载栏，且没有其他非书签下载了，则恢复隐藏状态
                    if (isBookmarkBackupInProgress && shouldHideDownloadShelf &&
                        hasDownloadShelfPermission && nonBookmarkDownloadCount === 0) {
                        await browserAPI.downloads.setShelfEnabled(false);
                    }
                }
            };

            // 添加监听器
            browserAPI.downloads.onChanged.addListener(onDownloadComplete);
        }
    } catch (error) {
    }
});

// 监听下载完成事件，清理书签下载ID记录
browserAPI.downloads.onChanged.addListener((downloadDelta) => {
    if (downloadDelta.state &&
        (downloadDelta.state.current === 'complete' || downloadDelta.state.current === 'interrupted')) {
        // 如果是书签备份下载完成，从集合中移除
        if (bookmarkDownloadIds.has(downloadDelta.id)) {
            bookmarkDownloadIds.delete(downloadDelta.id);
            // 不再输出"书签备份下载完成"的日志
        }
    }
});

// =============================================================================
// 书签快照缓存（供 UI 读取，减少重复 getTree）
// =============================================================================

// 批量导入/重排期间：避免频繁重建快照/分析导致卡顿或 Service Worker 负载飙升
// - Chrome 书签管理器“导入书签”会触发 onImportBegan/onImportEnded（并伴随大量 onCreated/onMoved 等）
// - 导入期间允许 UI 继续读旧快照，等导入结束后再统一刷新
let isBookmarkImporting = false;
let bookmarkImportFlushTimer = null;

const BookmarkSnapshotCache = {
    tree: null,
    version: 0,
    stale: true,
    buildPromise: null,
    rebuildTimer: null,
    lastBuildAt: 0,

    async ensureFresh() {
        if (this.buildPromise) return this.buildPromise;
        if (!this.stale) return this.tree;
        // 导入期间：如果已有快照，避免被 UI 读取触发频繁 getTree（等导入结束后统一刷新）
        if (isBookmarkImporting && this.tree) return this.tree;

        this.buildPromise = (async () => {
            const tree = await new Promise((resolve) => {
                try {
                    browserAPI.bookmarks.getTree((nodes) => resolve(nodes));
                } catch (_) {
                    resolve(null);
                }
            });
            if (tree && tree.length) {
                this.tree = tree;
                this.stale = false;
                this.version += 1;
                this.lastBuildAt = Date.now();
            } else {
                this.tree = tree || null;
                this.stale = false;
                this.version += 1;
                this.lastBuildAt = Date.now();
            }
            return this.tree;
        })().finally(() => {
            this.buildPromise = null;
        });

        return this.buildPromise;
    },

    markStale(reason = '') {
        this.stale = true;
        if (this.rebuildTimer) {
            clearTimeout(this.rebuildTimer);
            this.rebuildTimer = null;
        }
        // 导入期间只标记 stale，不自动 rebuild；避免导入过程中出现“停顿间隙触发 rebuild”
        if (isBookmarkImporting) {
            return;
        }
        this.rebuildTimer = setTimeout(() => {
            this.rebuildTimer = null;
            this.ensureFresh().catch((e) => {
                console.warn('[BookmarkSnapshotCache] rebuild failed:', reason, e);
            });
        }, 800);
    }
};

// 监听来自popup的消息
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 基础校验
    if (!message || typeof message !== 'object' || !message.action) {
        sendResponse({ success: false, error: '无效的消息格式' });
        return;
    }

    try {
        if (message.action === "extensionBookmarkOpen") {
            (async () => {
                try {
                    const url = message.url;
                    const tabId = typeof message.tabId === 'number' ? message.tabId : null;
                    const title = typeof message.title === 'string' ? message.title : '';
                    const bookmarkId = typeof message.bookmarkId === 'string' ? message.bookmarkId : null;

                    if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                        sendResponse({ success: false, error: '无效URL' });
                        return;
                    }

                    const visitTime = Date.now();
                    if (tabId != null) {
                        noteAutoBookmarkNavigation({
                            tabId,
                            bookmarkUrl: url,
                            bookmarkId,
                            bookmarkTitle: title || '',
                            timeStamp: visitTime,
                            source: 'extension'
                        });
                    }

                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error?.message || String(error) });
                }
            })();
            return true;
        }
        if (message.action === "attributedBookmarkOpen") {
            (async () => {
                try {
                    const url = message.url;
                    const title = typeof message.title === 'string' ? message.title : '';
                    const transition = typeof message.transition === 'string' ? message.transition : 'attributed';

                    if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                        sendResponse({ success: false, error: '无效URL' });
                        return;
                    }

                    const visitTime = Date.now();
                    await appendPendingAutoBookmarkClick({
                        id: `attributed-${Math.floor(visitTime)}`,
                        title: title || url,
                        url,
                        visitTime,
                        transition
                    });
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error?.message || String(error) });
                }
            })();
            return true;
        }
        if (message.action === "getBookmarkSnapshot") {
            (async () => {
                try {
                    const tree = await BookmarkSnapshotCache.ensureFresh();
                    sendResponse({ success: true, tree, version: BookmarkSnapshotCache.version });
                } catch (error) {
                    sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
                }
            })();
            return true;
        }
	        if (message.action === "toggleAutoSync") {
	            const useSpecificValue = message.hasOwnProperty('enabled');

            const handleToggle = async () => {
                try {
                    const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
                    const previousAutoSyncState = autoSync;

                    let newAutoSyncState;
                    if (useSpecificValue) {
                        newAutoSyncState = !!message.enabled;
                    } else {
                        newAutoSyncState = !autoSync;
                    }

                    if (newAutoSyncState === previousAutoSyncState) {
                        return { success: true, autoSync: previousAutoSyncState, message: '状态未变化' };
                    }

                    // 更新存储中的 autoSync 状态
                    await browserAPI.storage.local.set({ autoSync: newAutoSyncState });
                    // 确保清除活动标志 (无论切换到哪个模式，都清除一次以保证状态正确)
                    await browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck');
                    // 直接调用 onAutoBackupToggled 函数
                    await onAutoBackupToggled(newAutoSyncState);

                    // 如果从自动模式切换到手动模式：不做切换备份，不重置“需要更新的”状态
                    if (!newAutoSyncState) {
                        // 手动模式：仅停止自动备份定时器，其他状态交给 setBadge 根据当前变化计算
                        if (autoBackupTimerRunning) {
                            try {
                                await stopAutoBackupTimerSystem();
                                autoBackupTimerRunning = false;
                            } catch (error) {
                                console.error('[自动备份定时器] 切换到手动模式时停止定时器失败:', error);
                            }
                        }
                        // 重新计算并设置角标/提醒（保持“需要更新的”不变）
                        await setBadge();
                    } else {
                        // 切换到自动模式：由 setBadge 根据是否有变化决定是否启动定时器
                        await setBadge();
                    }

                    return { success: true, autoSync: newAutoSyncState, message: '自动备份状态已更新' };

                } catch (error) {
                    return { success: false, error: error.message || '切换失败' };
                }
            };

            handleToggle().then(response => {
                try {
                    sendResponse(response);
                } catch (e) {
                    if (!(e.message.includes('Receiving end does not exist') || e.message.includes('Port closed'))) {
                    }
                }
            });

	            return true;

	        } else if (message.action === "testWebDAVConnection") {
	            (async () => {
	                try {
	                    const serverAddressRaw = typeof message.serverAddress === 'string' ? message.serverAddress : '';
	                    const usernameRaw = typeof message.username === 'string' ? message.username : '';
	                    const passwordRaw = typeof message.password === 'string' ? message.password : '';

	                    const serverAddress = serverAddressRaw.trim();
	                    const username = usernameRaw.trim();
	                    const password = passwordRaw.trim();

	                    if (!serverAddress || !username || !password) {
	                        sendResponse({ success: false, error: 'WebDAV 配置不完整' });
	                        return;
	                    }

	                    const normalizedServerAddress = serverAddress.replace(/\/+$/, '/') || serverAddress;
	                    const authHeader = 'Basic ' + safeBase64(`${username}:${password}`);
	                    const propfindBody = '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>';

	                    let response;
	                    try {
	                        response = await fetch(normalizedServerAddress, {
	                            method: 'PROPFIND',
	                            headers: {
	                                'Authorization': authHeader,
	                                'Depth': '0',
	                                'Content-Type': 'application/xml'
	                            },
	                            body: propfindBody
	                        });
	                    } catch (fetchError) {
	                        sendResponse({ success: false, error: fetchError?.message || '无法连接到WebDAV服务器' });
	                        return;
	                    }

	                    // 某些服务不允许 PROPFIND 在特定入口，降级到 OPTIONS
	                    if (response && response.status === 405) {
	                        try {
	                            response = await fetch(normalizedServerAddress, {
	                                method: 'OPTIONS',
	                                headers: { 'Authorization': authHeader }
	                            });
	                        } catch (fetchError) {
	                            sendResponse({ success: false, error: fetchError?.message || '无法连接到WebDAV服务器' });
	                            return;
	                        }
	                    }

	                    if (!response) {
	                        sendResponse({ success: false, error: '无法连接到WebDAV服务器' });
	                        return;
	                    }

	                    if (response.status === 401) {
	                        sendResponse({ success: false, error: 'WebDAV认证失败，请检查账号密码是否正确' });
	                        return;
	                    }
	                    if (response.status === 403) {
	                        sendResponse({ success: false, error: 'WebDAV拒绝访问（403），请检查权限或路径是否正确' });
	                        return;
	                    }
	                    if (response.status === 404) {
	                        sendResponse({ success: false, error: 'WebDAV地址不存在（404），请检查服务器地址是否正确' });
	                        return;
	                    }
	                    if (!response.ok) {
	                        sendResponse({ success: false, error: `连接失败: ${response.status} - ${response.statusText}` });
	                        return;
	                    }

	                    sendResponse({ success: true });
	                } catch (error) {
	                    sendResponse({ success: false, error: error?.message || '未知错误' });
	                }
	            })();
	            return true;

			        } else if (message.action === "testGitHubRepoConnection") {
			            // GitHub Repository 连接测试（云端2）
			            (async () => {
			                try {
			                    const token = message.token || message.githubRepoToken || message.githubToken;
			                    const owner = message.owner || message.githubRepoOwner;
			                    const repo = message.repo || message.githubRepoName;
			                    const branch = message.branch || message.githubRepoBranch;
			                    const basePath = message.basePath || message.githubRepoBasePath;

			                    if (!token) {
			                        sendResponse({ success: false, error: 'GitHub Token 未配置' });
			                        return;
			                    }

			                    if (!owner || !repo) {
			                        sendResponse({ success: false, error: '仓库未配置' });
			                        return;
			                    }

			                    const result = await testRepoConnection({ token, owner, repo, branch, basePath });
			                    if (result && result.success === true) {
			                        sendResponse({
			                            success: true,
			                            repo: result.repo || null,
			                            resolvedBranch: result.resolvedBranch || null,
			                            basePathExists: typeof result.basePathExists === 'boolean' ? result.basePathExists : null
			                        });
			                    } else {
			                        sendResponse({ success: false, error: result?.error || '未知错误' });
			                    }
			                } catch (error) {
			                    sendResponse({ success: false, error: error?.message || '未知错误' });
			                }
			            })();
			            return true;

			        } else if (message.action === "ensureGitHubRepoInitialized") {
			            // 确保 GitHub 仓库配置可用（用于在配置保存后展示仓库信息）
			            (async () => {
			                try {
			                    const config = await browserAPI.storage.local.get([
			                        'githubRepoToken',
			                        'githubRepoOwner',
			                        'githubRepoName',
			                        'githubRepoBranch',
			                        'githubRepoBasePath',
			                        'githubRepoEnabled'
			                    ]);

			                    if (!config.githubRepoToken) {
			                        sendResponse({ success: false, error: 'GitHub Token 未配置' });
			                        return;
			                    }
			                    if (!config.githubRepoOwner || !config.githubRepoName) {
			                        sendResponse({ success: false, error: '仓库未配置' });
			                        return;
			                    }
			                    if (config.githubRepoEnabled === false) {
			                        sendResponse({ success: false, error: 'GitHub 仓库备份已禁用' });
			                        return;
			                    }

			                    const result = await testRepoConnection({
			                        token: config.githubRepoToken,
			                        owner: config.githubRepoOwner,
			                        repo: config.githubRepoName,
			                        branch: config.githubRepoBranch,
			                        basePath: config.githubRepoBasePath
			                    });

			                    if (!result || result.success !== true) {
			                        sendResponse({ success: false, error: result?.error || '获取仓库信息失败' });
			                        return;
			                    }

			                    const hasBranchConfigured =
			                        typeof config.githubRepoBranch === 'string' && config.githubRepoBranch.trim().length > 0;
			                    if (!hasBranchConfigured && result.resolvedBranch) {
			                        try {
			                            await browserAPI.storage.local.set({ githubRepoBranch: result.resolvedBranch });
			                        } catch (_) { }
			                    }

			                    sendResponse({
			                        success: true,
			                        repo: result.repo || null,
			                        resolvedBranch: result.resolvedBranch || null,
			                        basePathExists: typeof result.basePathExists === 'boolean' ? result.basePathExists : null
			                    });
			                } catch (error) {
			                    sendResponse({ success: false, error: error?.message || '获取仓库信息失败' });
			                }
			            })();
			            return true;

			        } else if (message.action === "exportHistoryToGitHubRepo") {
			            // 导出历史记录到 GitHub Repository（云端2）
			            (async () => {
			                try {
			                    if (!message.content) {
			                        throw new Error('缺少导出内容');
			                    }

			                    const content = message.content;
			                    const baseFileName =
			                        message.fileName ||
			                        `书签备份历史记录_${new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '_').slice(0, -4)}.txt`;
			                    const lang = message.lang || await getCurrentLang();

			                    const config = await browserAPI.storage.local.get([
			                        'githubRepoToken',
			                        'githubRepoOwner',
			                        'githubRepoName',
			                        'githubRepoBranch',
			                        'githubRepoBasePath',
			                        'githubRepoEnabled'
			                    ]);

			                    if (!config.githubRepoToken) {
			                        throw new Error('GitHub Token 未配置');
			                    }
			                    if (!config.githubRepoOwner || !config.githubRepoName) {
			                        throw new Error('仓库未配置');
			                    }
			                    if (config.githubRepoEnabled === false) {
			                        throw new Error('GitHub 仓库备份已禁用');
			                    }

			                    const filePath = buildGitHubRepoFilePath({
			                        basePath: config.githubRepoBasePath,
			                        lang,
			                        folderKey: 'history',
			                        fileName: baseFileName
			                    });

			                    const commitMessage = `Bookmark Backup: export history ${baseFileName}`;
			                    const result = await upsertRepoFile({
			                        token: config.githubRepoToken,
			                        owner: config.githubRepoOwner,
			                        repo: config.githubRepoName,
			                        branch: config.githubRepoBranch,
			                        path: filePath,
			                        message: commitMessage,
			                        contentBase64: textToBase64(String(content ?? ''))
			                    });

			                    if (!result || result.success !== true) {
			                        throw new Error(result?.error || '上传到 GitHub 仓库失败');
			                    }

			                    sendResponse({
			                        success: true,
			                        message: '历史记录已成功上传到GitHub仓库',
			                        path: result.path || filePath,
			                        htmlUrl: result.htmlUrl || null
			                    });
			                } catch (error) {
			                    sendResponse({
			                        success: false,
			                        error: error.message || '导出历史记录到GitHub仓库失败'
			                    });
			                }
			            })();
			            return true; // 保持消息通道开放

		        } else if (message.action === "exportHistoryToWebDAV") {
		            // 处理导出历史记录到WebDAV的请求
		            // 使用异步立即执行函数处理
		            (async () => {
	                try {
                    // 检查必要参数
                    if (!message.content) {
                        throw new Error('缺少导出内容');
                    }

                    const content = message.content;
                    const fileName = message.fileName || `书签备份历史记录_${new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '_').slice(0, -4)}.txt`;
                    const lang = message.lang || 'zh_CN';

                    // 获取WebDAV配置
                    const config = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']);

                    // 验证WebDAV配置
                    if (!config.serverAddress || !config.username || !config.password) {
                        throw new Error('WebDAV 配置不完整');
                    }

                    if (config.webDAVEnabled === false) {
                        throw new Error('WebDAV 已禁用');
                    }

                    // 构建WebDAV路径 - 使用统一文件夹结构（根据语言动态选择）
                    const serverAddress = config.serverAddress.replace(/\/+$/, '/');
                    const historyFolder = getHistoryFolderByLang(lang);
                    const exportRootFolder = getExportRootFolderByLang(lang);
                    const folderPath = `${exportRootFolder}/${historyFolder}/`;
                    const fullUrl = `${serverAddress}${folderPath}${fileName}`;
                    const folderUrl = `${serverAddress}${folderPath}`;
                    const parentFolderUrl = `${serverAddress}${exportRootFolder}/`;

                    // 认证头
                    const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

                    // 检查并创建父文件夹（如果不存在）
                    const checkParentResponse = await fetch(parentFolderUrl, {
                        method: 'PROPFIND',
                        headers: {
                            'Authorization': authHeader,
                            'Depth': '0',
                            'Content-Type': 'application/xml'
                        },
                        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
                    });

                    if (checkParentResponse.status === 404) {
                        // 创建父文件夹
                        const mkcolParentResponse = await fetch(parentFolderUrl, {
                            method: 'MKCOL',
                            headers: { 'Authorization': authHeader }
                        });
                        if (!mkcolParentResponse.ok && mkcolParentResponse.status !== 405) {
                            throw new Error(`创建父文件夹失败: ${mkcolParentResponse.status} - ${mkcolParentResponse.statusText}`);
                        }
                    } else if (checkParentResponse.status === 401) {
                        throw new Error('WebDAV认证失败，请检查账号密码是否正确');
                    }

                    // 检查子文件夹是否存在
                    const checkFolderResponse = await fetch(folderUrl, {
                        method: 'PROPFIND',
                        headers: {
                            'Authorization': authHeader,
                            'Depth': '0',
                            'Content-Type': 'application/xml'
                        },
                        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
                    });

                    // 处理各种可能的错误情况
                    if (checkFolderResponse.status === 401) {
                        throw new Error('WebDAV认证失败，请检查账号密码是否正确');
                    } else if (checkFolderResponse.status === 404) {
                        const mkcolResponse = await fetch(folderUrl, {
                            method: 'MKCOL',
                            headers: {
                                'Authorization': authHeader
                            }
                        });

                        if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
                            throw new Error(`创建历史记录文件夹失败: ${mkcolResponse.status} - ${mkcolResponse.statusText}`);
                        }
                    } else if (!checkFolderResponse.ok) {
                        throw new Error(`检查历史记录文件夹失败: ${checkFolderResponse.status} - ${checkFolderResponse.statusText}`);
                    }

                    // 上传内容到WebDAV
                    const response = await fetch(fullUrl, {
                        method: 'PUT',
                        headers: {
                            'Authorization': authHeader,
                            'Content-Type': 'text/plain;charset=utf-8',
                            'Overwrite': 'T'
                        },
                        body: content
                    });

                    if (!response.ok) {
                        const responseText = await response.text();
                        throw new Error(`上传失败: ${response.status} - ${response.statusText}`);
                    }

                    sendResponse({
                        success: true,
                        message: '历史记录已成功上传到WebDAV'
                    });
                } catch (error) {
                    sendResponse({
                        success: false,
                        error: error.message || '导出历史记录到WebDAV失败'
                    });
                }
            })();

            return true;  // 保持消息通道开放
        } else if (message.action === "exportHistoryToLocal") {
            // 处理导出历史记录到本地的请求
            // 使用异步立即执行函数处理
            (async () => {
                try {
                    // 检查必要参数
                    if (!message.content) {
                        throw new Error('缺少导出内容');
                    }

                    const content = message.content;
                    const fileName = message.fileName || `书签备份历史记录_${new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '_').slice(0, -4)}.txt`;

                    // 获取本地备份配置
                    const config = await browserAPI.storage.local.get([
                        'defaultDownloadEnabled',
                        'customFolderEnabled',
                        'customFolderPath',
                        'localBackupPath',
                        'localBackupEnabled',
                        'hideDownloadShelf'
                    ]);

                    // 检查是否有本地配置
                    const defaultDownloadEnabled = config.defaultDownloadEnabled === true;
                    const customFolderEnabled = config.customFolderEnabled === true && config.customFolderPath;
                    const oldConfigEnabled = config.localBackupEnabled === true && config.localBackupPath;
                    const localBackupConfigured = defaultDownloadEnabled || customFolderEnabled || oldConfigEnabled;

                    if (!localBackupConfigured) {
                        throw new Error('本地备份未配置');
                    }

                    // 制作数据URL
                    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);

                    // 尝试显示下载栏
                    if (browserAPI.downloads.setShelfEnabled) {
                        try {
                            await browserAPI.downloads.setShelfEnabled(true);
                        } catch (shelfError) {
                        }
                    }

                    // 执行下载 - 使用统一文件夹结构（根据语言动态选择）
                    const lang = message.lang || await getCurrentLang();
                    const localHistoryFolder = getHistoryFolderByLang(lang);
                    const exportRootFolder = getExportRootFolderByLang(lang);
                    const downloadId = await new Promise((resolve, reject) => {
                        browserAPI.downloads.download({
                            url: dataUrl,
                            filename: `${exportRootFolder}/${localHistoryFolder}/${fileName}`,
                            saveAs: false
                        }, (id) => {
                            if (browserAPI.runtime.lastError) {
                                reject(new Error(browserAPI.runtime.lastError.message));
                            } else {
                                resolve(id);
                            }
                        });
                    });

                    sendResponse({
                        success: true,
                        message: '历史记录已成功下载到本地',
                        downloadId: downloadId
                    });
                } catch (error) {
                    sendResponse({
                        success: false,
                        error: error.message || '导出历史记录到本地失败'
                    });
                }
            })();

            return true;  // 保持消息通道开放
        } else if (message.action === "exportFileToClouds") {
            // 通用导出：同步到云端1(WebDAV) + 云端2(GitHub Repo)
            (async () => {
                try {
                    const fileName = String(message.fileName || '').trim();
                    const folderKey = String(message.folderKey || '').trim();
                    const contentType = message.contentType;
                    const contentArrayBuffer = message.contentArrayBuffer || null;
                    const content = message.content;

                    if (!fileName) throw new Error('缺少文件名');
                    if (!folderKey) throw new Error('缺少导出类型');
                    if (!contentArrayBuffer && (content == null || content === '')) throw new Error('缺少导出内容');

                    const lang = message.lang || await getCurrentLang();

                    const [webdav, githubRepo] = await Promise.all([
                        uploadExportFileToWebDAV({
                            lang,
                            folderKey,
                            fileName,
                            content,
                            contentArrayBuffer,
                            contentType
                        }),
                        uploadExportFileToGitHubRepo({
                            lang,
                            folderKey,
                            fileName,
                            content,
                            contentArrayBuffer
                        })
                    ]);

                    const success =
                        (webdav && webdav.success === true) || (githubRepo && githubRepo.success === true);

                    sendResponse({
                        success,
                        webdav,
                        githubRepo
                    });
                } catch (error) {
                    sendResponse({
                        success: false,
                        error: error?.message || '导出到云端失败'
                    });
                }
            })();

            return true; // 保持消息通道开放
        } else if (message.action === "syncBookmarks") {
            // <--- Log 6

            // 检查消息中是否包含 isSwitchToAutoBackup 标志
            const isSwitchTriggered = message.isSwitchToAutoBackup === true;
            const syncDirection = message.direction || null; // 获取方向
            const isManualFromMessage = message.isManual === true; // 获取是否手动备份
            const autoBackupReason = message.autoBackupReason || null; // 获取自动备份原因
            // <--- Log 7

            if (isSwitchTriggered) {
                // <--- Log 8a
                // 调用 syncBookmarks，设置 isManual=false, isSwitchToAutoBackup=true
                syncBookmarks(false, syncDirection, true, autoBackupReason)
                    .then(result => sendResponse(result))
                    .catch(error => sendResponse({ success: false, error: error.message }));
            } else {
                // <--- Log 8b
                // 调用 syncBookmarks，根据消息中的 isManual 值
                const isManual = isManualFromMessage ? true : !autoBackupReason; // 如果有 autoBackupReason，说明是自动备份
                syncBookmarks(isManual, syncDirection, false, autoBackupReason)
                    .then(result => sendResponse(result))
                    .catch(error => sendResponse({ success: false, error: error.message }));
            }
            return true; // 保持消息通道开放
        } else if (message.action === "manualBackupCompleted") {
            // 处理手动备份完成消息
            // 使用异步立即执行函数处理
            (async () => {
                try {
                    // 重置备份提醒系统
                    await onManualBackupCompleted(); // 使用已有函数

                    // 重置操作状态跟踪
                    await browserAPI.storage.local.set({
                        lastSyncOperations: {
                            bookmarkMoved: false,
                            folderMoved: false,
                            bookmarkModified: false,
                            folderModified: false,
                            lastUpdateTime: new Date().toISOString()
                        }
                    });

                    // 强制更新缓存分析数据
                    await updateAndCacheAnalysis();

                    // 确保角标显示为蓝色（手动模式无变动）
                    try {
                        const { autoSync = false, preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['autoSync', 'preferredLang']);
                        if (!autoSync) {
                            // 手动模式下，确保角标为蓝色
                            const badgeText = badgeTextMap.manual[preferredLang] || badgeTextMap.manual.en;
                            await browserAPI.action.setBadgeText({ text: badgeText });
                            await browserAPI.action.setBadgeBackgroundColor({ color: '#0000FF' }); // 蓝色
                            await browserAPI.storage.local.set({ isYellowHandActive: false });
                        } else {
                            // 自动模式下，使用正常的setBadge
                            await setBadge();
                        }
                    } catch (badgeError) {
                        await setBadge(); // 回退到正常的setBadge
                    }

                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();

            return true;  // 保持消息通道开放
        } else if (message.action === "resetAllData") {
            // 使用异步立即执行函数处理
            (async () => {
                try {
                    await resetAllData();
                    // 立即响应
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message || '重置失败' });
                }
            })();

            return true;  // 保持消息通道开放，异步响应

        } else if (message.action === 'revertAllToLastBackup') {
            // 撤销全部变化：将当前书签恢复到 lastBookmarkData.bookmarkTree
            (async () => {
                try {
                    const { lastBookmarkData = null, preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['lastBookmarkData', 'preferredLang']);
                    if (!lastBookmarkData || !lastBookmarkData.bookmarkTree || !Array.isArray(lastBookmarkData.bookmarkTree)) {
                        sendResponse({ success: false, error: preferredLang === 'en' ? 'No last backup snapshot' : '没有上次备份快照' });
                        return;
                    }

                    // 获取当前整棵书签
                    const currentTree = await new Promise((resolve) => {
                        browserAPI.bookmarks.getTree((bookmarks) => resolve(bookmarks));
                    });

                    // 计算需要清空的根下内容（保留根节点）
                    const currentRoots = currentTree && currentTree[0] && currentTree[0].children ? currentTree[0].children : [];

                    // 构建快照根映射（按平台根ID或标题归一化）
                    const snapshotRootChildren = (lastBookmarkData.bookmarkTree[0] && lastBookmarkData.bookmarkTree[0].children) ? lastBookmarkData.bookmarkTree[0].children : [];
                    const normalizeKey = (id, title) => {
                        if (!id && !title) return 'unknown';
                        // 常见平台根ID映射
                        if (id === '1' || id === 'toolbar_____') return 'toolbar';
                        if (id === '2' || id === 'menu________') return 'menu';
                        if (id === '3' || id === 'unfiled_____') return 'unfiled';
                        if (id === 'mobile______') return 'mobile';
                        const t = (title || '').toLowerCase();
                        if (t.includes('toolbar') || t.includes('书签栏')) return 'toolbar';
                        if (t.includes('menu') || t.includes('菜单') || t.includes('其他书签')) return 'menu';
                        if (t.includes('unfiled')) return 'unfiled';
                        if (t.includes('mobile') || t.includes('移动')) return 'mobile';
                        return id || t || 'unknown';
                    };
                    const snapshotRootMap = new Map();
                    for (const sRoot of snapshotRootChildren) {
                        snapshotRootMap.set(normalizeKey(sRoot.id, sRoot.title), sRoot);
                    }

                    // 递归创建函数：根据快照还原
                    const createNodeRecursive = async (parentId, snapshotNode) => {
                        if (!snapshotNode) return;
                        if (snapshotNode.url) {
                            await browserAPI.bookmarks.create({ parentId, title: snapshotNode.title || '', url: snapshotNode.url, index: snapshotNode.index });
                        } else {
                            const folder = await browserAPI.bookmarks.create({ parentId, title: snapshotNode.title || '', index: snapshotNode.index });
                            if (snapshotNode.children && snapshotNode.children.length) {
                                for (const child of snapshotNode.children) {
                                    await createNodeRecursive(folder.id, child);
                                }
                            }
                        }
                    };

                    // 限流并发的批处理工具
                    const runBatched = async (items, worker, concurrency = 8) => {
                        let idx = 0; const running = new Set();
                        const runNext = () => {
                            if (idx >= items.length) return Promise.resolve();
                            const i = idx++; const p = Promise.resolve().then(() => worker(items[i])).catch(() => { }).finally(() => running.delete(p));
                            running.add(p);
                            if (running.size >= concurrency) {
                                return Promise.race(running).then(runNext);
                            }
                            return runNext();
                        };
                        await runNext();
                        await Promise.allSettled([...running]);
                    };

                    // 删除所有根下节点（分批并发）
                    for (const root of currentRoots) {
                        if (!root || !root.id) continue;
                        const children = (root.children && root.children.length > 0) ? [...root.children] : [];
                        await runBatched(children, async (child) => {
                            try {
                                if (child.children && child.children.length) {
                                    await browserAPI.bookmarks.removeTree(child.id);
                                } else {
                                    await browserAPI.bookmarks.remove(child.id);
                                }
                            } catch (_) { }
                        }, 10);
                    }

                    // 恢复：按根匹配并分批创建
                    for (const root of currentRoots) {
                        if (!root || !root.id) continue;
                        const key = normalizeKey(root.id, root.title);
                        const snapshotRoot = snapshotRootMap.get(key);
                        if (snapshotRoot && snapshotRoot.children && snapshotRoot.children.length) {
                            await runBatched(snapshotRoot.children, async (child) => {
                                await createNodeRecursive(root.id, child);
                            }, 6);
                        }
                    }

                    // 更新 lastBookmarkData 为当前还原后的树，避免视图根据旧ID计算出大量标识/diff
                    try {
                        const restoredTree = await new Promise((resolve) => {
                            browserAPI.bookmarks.getTree((bookmarks) => resolve(bookmarks));
                        });
                        const currentBookmarkCount = countAllBookmarks(restoredTree);
                        const currentFolderCount = countAllFolders(restoredTree);
                        const currentPrints = generateFingerprints(restoredTree);
                        await browserAPI.storage.local.set({
                            lastBookmarkData: {
                                bookmarkCount: currentBookmarkCount,
                                folderCount: currentFolderCount,
                                bookmarkPrints: currentPrints.bookmarks,
                                folderPrints: currentPrints.folders,
                                bookmarkTree: restoredTree,
                                // 保留原来的时间戳，避免被误认为新备份
                                timestamp: lastBookmarkData.timestamp || new Date().toISOString()
                            }
                        });
                    } catch (e) {
                        // 不影响主流程
                    }

                    // 清理状态并更新角标与缓存
                    resetOperationStatus();
                    try { await browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck'); } catch (_) { }
                    await updateAndCacheAnalysis();
                    await setBadge();

                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
                }
            })();
            return true;

        } else if (message.action === "initSync") {
            if (message.direction === "upload") {
                // 上传本地书签到云端/本地
                browserAPI.bookmarks.getTree()
                    .then(async (bookmarks) => {
                        try {
	                            let webDAVSuccess = false;
	                            let githubRepoSuccess = false;
	                            let localSuccess = false;
	                            let errors = [];

                            // 添加结果对象用于存储过程信息
                            const result = {
                                localFileName: null
                            };

                            // 添加errorMessages数组用于收集错误信息
                            const errorMessages = [];

	                            // 检查云端1：WebDAV配置
	                            const webDAVconfig = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']);
	                            const webDAVConfigured = webDAVconfig.serverAddress && webDAVconfig.username && webDAVconfig.password;
	                            const webDAVEnabled = webDAVconfig.webDAVEnabled !== false;

	                            // 检查云端2：GitHub Repository 配置
	                            const githubRepoConfig = await browserAPI.storage.local.get([
	                                'githubRepoToken',
	                                'githubRepoOwner',
	                                'githubRepoName',
	                                'githubRepoEnabled'
	                            ]);
	                            const githubRepoConfigured = !!(
	                                githubRepoConfig &&
	                                githubRepoConfig.githubRepoToken &&
	                                githubRepoConfig.githubRepoOwner &&
	                                githubRepoConfig.githubRepoName
	                            );
	                            const githubRepoEnabled = githubRepoConfig.githubRepoEnabled !== false;

                            // 检查本地备份配置
                            const localConfig = await browserAPI.storage.local.get([
                                'defaultDownloadEnabled',
                                'customFolderEnabled',
                                'customFolderPath',
                                'localBackupPath',
                                'localBackupEnabled'
                            ]);

                            // 检查是否启用任一本地备份方式
                            const defaultDownloadEnabled = localConfig.defaultDownloadEnabled === true;
                            const customFolderEnabled = localConfig.customFolderEnabled === true && localConfig.customFolderPath;
                            const oldConfigEnabled = localConfig.localBackupEnabled === true && localConfig.localBackupPath;

                            // 检查至少有一种备份方式已配置
                            const localBackupConfigured = defaultDownloadEnabled || customFolderEnabled || oldConfigEnabled;
                            // const hasAtLeastOneConfigured = (webDAVConfigured && webDAVEnabled) || localBackupConfigured; // Original was this

                            // 上传到WebDAV（如果启用且已配置）
                            if (webDAVConfigured && webDAVEnabled) {
                                try {
                                    const uploadResult = await uploadBookmarks(bookmarks);
                                    if (uploadResult.success) {
                                        webDAVSuccess = true;
                                    } else if (uploadResult.webDAVNotConfigured) {
                                    } else {
                                        errors.push(uploadResult.error || '上传到WebDAV失败');
                                    }
                                } catch (error) {
                                    errors.push(error.message || '上传到WebDAV失败');
                                }
                            }

	                            // 上传到 GitHub 仓库（如果启用且已配置）
	                            if (githubRepoConfigured && githubRepoEnabled) {
	                                try {
	                                    const uploadResult = await uploadBookmarksToGitHubRepo(bookmarks);
	                                    if (uploadResult && uploadResult.success) {
	                                        githubRepoSuccess = true;
	                                    } else if (uploadResult && uploadResult.repoNotConfigured) {
	                                        // ignore
	                                    } else {
	                                        errors.push(uploadResult?.error || '上传到GitHub仓库失败');
	                                    }
	                                } catch (error) {
	                                    errors.push(error.message || '上传到GitHub仓库失败');
	                                }
	                            }

	                            // 上传到本地（如果启用且已配置）
	                            if (localBackupConfigured) {
	                                try {
	                                    const localResult = await uploadBookmarksToLocal(bookmarks);
	                                    localSuccess = true;
                                    // 记录文件名信息，以便返回给调用者
                                    result.localFileName = localResult.fileName;
                                } catch (error) {
                                    errors.push(`本地备份失败: ${error.message}`);
                                }
                            }

	                            // 确定备份方向
	                            let syncDirection = 'none';
	                            if (localSuccess && webDAVSuccess && githubRepoSuccess) {
	                                syncDirection = 'cloud_local';
	                            } else if (localSuccess && webDAVSuccess) {
	                                syncDirection = 'webdav_local';
	                            } else if (localSuccess && githubRepoSuccess) {
	                                syncDirection = 'github_repo_local';
	                            } else if (localSuccess) {
	                                syncDirection = 'local';
	                            } else if (webDAVSuccess && githubRepoSuccess) {
	                                syncDirection = 'cloud';
	                            } else if (webDAVSuccess) {
	                                syncDirection = 'webdav';
	                            } else if (githubRepoSuccess) {
	                                syncDirection = 'github_repo';
	                            } else {
	                                syncDirection = 'none';
	                            }

                            // 添加首次上传记录
                            const syncTime = new Date().toISOString();
	                            const syncStatus = (webDAVSuccess || githubRepoSuccess || localSuccess) ? 'success' : 'error';
                            const errorMessage = errors.length > 0 ? errors.join('; ') : '';
                            // --- 修改：传递 'auto' 作为 syncType ---
                            await updateSyncStatus(syncDirection, syncTime, syncStatus, errorMessage, 'auto', null);

                            // --- 新增：在成功后调用 setBadge ---
                            if (syncStatus === 'success') {
                                try {
                                    await setBadge(); // 更新角标为自动状态
                                } catch (badgeError) {
                                }
                            }
                            // --- 结束新增 ---

	                            sendResponse({
	                                success: (webDAVSuccess || githubRepoSuccess || localSuccess),
	                                webDAVSuccess,
	                                githubRepoSuccess,
	                                localSuccess,
	                                localFileName: result.localFileName, // 添加文件名到响应
	                                error: errors.length > 0 ? errors.join('; ') : null
	                            });
                        } catch (error) {
                            sendResponse({
                                success: false,
                                error: error.message || '上传失败'
                            });
                        }
                    })
                    .catch(error => {
                        sendResponse({
                            success: false,
                            error: error.message || '获取书签失败'
                        });
                    });
                return true;  // 保持消息通道开放
            } else if (message.direction === "download") {
                // 从云端下载书签
                downloadBookmarks()
                    .then(async (serverBookmarksResult) => {
                        try {
                            if (serverBookmarksResult.success && serverBookmarksResult.bookmarks) {
                                await updateLocalBookmarks(serverBookmarksResult.bookmarks);

                                // 添加下载成功记录
                                const syncTime = new Date().toISOString();
                                // --- 修改：传递 'auto' 作为 syncType ---
                                await updateSyncStatus('download', syncTime, 'success', '', 'auto', null);

                                // --- 新增：在成功后调用 setBadge ---
                                try {
                                    await setBadge(); // 更新角标为自动状态
                                } catch (badgeError) {
                                }
                                // --- 结束新增 ---

                                sendResponse({ success: true });
                            } else if (serverBookmarksResult.webDAVNotConfigured) {
                                sendResponse({
                                    success: false,
                                    error: "WebDAV 未配置，无法下载书签"
                                });
                            } else {
                                sendResponse({
                                    success: false,
                                    error: serverBookmarksResult.error || "云端没有书签数据"
                                });
                            }
                        } catch (error) {
                            sendResponse({
                                success: false,
                                error: error.message || '更新本地书签失败'
                            });
                        }
                    })
                    .catch(error => {
                        sendResponse({
                            success: false,
                            error: error.message || '下载失败'
                        });
                    });
            }
            return true;  // 保持消息通道开放
        } else if (message.action === "searchBookmarks") {
            // 功能已移除，返回错误消息
            sendResponse({
                success: false,
                error: '搜索功能已被移除'
            });
            return true;  // 保持消息通道开放
        } else if (message.action === "resetAll") { // Duplicate of resetAllData in original
            resetAllData()
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch(error => {
                    sendResponse({
                        success: false,
                        error: error.message || '重置失败'
                    });
                });
            return true;  // 保持消息通道开放
        } else if (message.action === 'getBackupStats') {
            // 使用统一的内部函数，确保数据一致性和缓存机制
            // 支持 forceRefresh 参数，强制重新计算（用于History Viewer初始化）
            const forceRefresh = message.forceRefresh === true;

            if (forceRefresh) {
                console.log('[getBackupStats] 强制刷新缓存...');
                updateAndCacheAnalysis()
                    .then(stats => {
                        browserAPI.storage.local.get(['lastSyncTime'], (data) => {
                            sendResponse({
                                lastSyncTime: data.lastSyncTime || null,
                                stats: stats,
                                success: true
                            });
                        });
                    })
                    .catch(error => {
                        sendResponse({
                            success: false,
                            error: error.message || '获取备份统计失败',
                            stats: null
                        });
                    });
            } else {
                getBackupStatsInternal()
                    .then(response => {
                        sendResponse(response);
                    })
                    .catch(error => {
                        sendResponse({
                            success: false,
                            error: error.message || '获取备份统计失败',
                            stats: null
                        });
                    });
            }
            return true; // 保持消息通道开放
        } else if (message.action === "getSyncHistory") {
            // 从存储中获取备份历史记录
            browserAPI.storage.local.get(['syncHistory'], (data) => {
                const syncHistory = data.syncHistory || [];
                sendResponse({
                    success: true,
                    syncHistory: syncHistory
                });
            });
            return true; // 保持消息通道开放
        } else if (message.action === "openReminderSettings") {
            // 打开主UI并直接触发"手动备份动态提醒设置"按钮
            try {
                // 在新窗口中打开popup.html，并添加参数，直接打开手动备份动态提醒设置
                browserAPI.windows.create({
                    url: browserAPI.runtime.getURL("popup.html") + "?openReminderDialog=true",
                    type: "popup",
                    width: 850,
                    height: 700,
                    focused: true
                }, (window) => {
                    sendResponse({ success: true, message: "主UI窗口已打开，将自动打开手动备份动态提醒设置" });
                });
            } catch (error) {
                sendResponse({ success: false, error: error.message || "处理请求失败" });
            }
            return true; // 保持消息通道开放
        } else if (message.action === "saveLocalBackupConfig") {
            // 更新为支持新的配置结构
            browserAPI.storage.local.set({
                defaultDownloadEnabled: message.defaultDownloadEnabled === true,
                customFolderEnabled: message.customFolderEnabled === true,
                customFolderPath: message.customFolderPath || '',
                customFolderHandle: message.customFolderHandle || null,
                // 兼容旧版本
                localBackupPath: message.customFolderPath || message.path || '',
                localBackupEnabled: (message.defaultDownloadEnabled || message.customFolderEnabled || message.enabled) === true
            }).then(() => {
                sendResponse({ success: true });
            }, error => {
                sendResponse({
                    success: false,
                    error: error.message || '保存本地备份配置失败'
                });
            });
            return true;
        } else if (message.action === 'selectDirectory') {
            // MV3 Service Worker 环境没有 DOM，无法在这里弹出文件夹选择器（Edge/Chrome 都一样）。
            // 如需选择目录，请在可见的扩展页面（popup/options）中完成，再把结果通过 storage 或 message 传回。
            sendResponse({
                success: false,
                error: '当前环境不支持选择文件夹（MV3 Service Worker 无法打开文件选择器）'
            });
            return false;
        } else if (message.action === "getDownloadPath") {
            // 直接返回估计的下载路径，不尝试在chrome://页面执行脚本
            fallbackToEstimatedPath();
            return true;

            // 如果无法从页面获取，返回估计的路径
            async function fallbackToEstimatedPath() {
                // 估计默认下载路径（根据语言动态选择）
                const estimatedBackupFolder = await getBackupFolder();
                const exportRootFolder = await getExportRootFolder();
                let defaultPath = '';
                const isWindows = navigator.platform.indexOf('Win') > -1;
                const isMac = navigator.platform.indexOf('Mac') > -1;
                const isLinux = navigator.platform.indexOf('Linux') > -1;

                if (isWindows) {
                    defaultPath = `C:\\Users\\<username>\\Downloads\\${exportRootFolder}\\${estimatedBackupFolder}\\`;
                } else if (isMac) {
                    defaultPath = `/Users/<username>/Downloads/${exportRootFolder}/${estimatedBackupFolder}/`;
                } else if (isLinux) {
                    defaultPath = `/home/<username>/Downloads/${exportRootFolder}/${estimatedBackupFolder}/`;
                } else {
                    defaultPath = `您浏览器的默认下载文件夹/${exportRootFolder}/${estimatedBackupFolder}/`;
                }

                sendResponse({
                    success: true,
                    path: defaultPath,
                    note: '这是估计的路径，实际路径可能因您的系统设置而异'
                });
            }
        } else if (message.action === "openDownloadSettings") {
            // 尝试打开下载设置页面
            try {
                const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
                const isEdge = ua.includes('Edg/');
                const settingsUrl = isEdge ? 'edge://settings/downloads' : 'chrome://settings/downloads';

                // 方法1：直接尝试打开浏览器设置页面
                browserAPI.tabs.create({ url: settingsUrl }, function (tab) {
                    if (browserAPI.runtime.lastError) {
                        sendResponse({ success: false, error: browserAPI.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true });
                    }
                });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
            return true;
        } else if (message.action === 'showManualBackupNotification') {
            // 处理来自 popup 的手动备份通知请求
            if (message.statusText) {
                // 使用传递过来的 statusText 创建通知
                browserAPI.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png', // 扩展图标路径
                    title: '手动备份完成',
                    message: message.statusText, // 直接使用 popup 传递的文本
                    priority: 0 // 默认优先级
                }, (notificationId) => {
                    if (browserAPI.runtime.lastError) {
                        sendResponse({ success: false, error: browserAPI.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true, notificationId: notificationId });
                    }
                });

                return true; // 异步处理响应
            } else {
                sendResponse({ success: false, error: '缺少状态文本' });
            }
        } else if (message.action === "resetOperationStatus") {
            // 重置操作状态
            resetOperationStatus();
            sendResponse({ success: true, message: '已重置操作状态' });

        } else if (message.action === "setBadge") {
            // 直接调用setBadge函数更新角标
            setBadge().then(() => {
                sendResponse({ success: true });
            }).catch(error => {
                sendResponse({ success: false, error: error.message });
            });
            return true; // 保持消息通道开放

        } else if (message.action === "clearSyncHistory") {
            // 清空备份历史记录
            // 关键：在清空前保存最后一条记录的 bookmarkTree，以便清空后的第一条记录可以用它来对比
            (async () => {
                try {
                    const data = await browserAPI.storage.local.get(['syncHistory']);
                    const syncHistory = data.syncHistory || [];

                    // 找到最后一条成功且有 bookmarkTree 的记录
                    let lastValidRecord = null;
                    for (let i = syncHistory.length - 1; i >= 0; i--) {
                        if (syncHistory[i].status === 'success' && syncHistory[i].bookmarkTree) {
                            lastValidRecord = syncHistory[i];
                            break;
                        }
                    }

                    // 准备保存的缓存记录（仅保留必要的字段）
                    const cachedRecord = lastValidRecord ? {
                        bookmarkTree: lastValidRecord.bookmarkTree,
                        bookmarkStats: lastValidRecord.bookmarkStats,
                        time: lastValidRecord.time
                    } : null;

                    // 清空历史并保存缓存记录
                    const updates = { syncHistory: [] };
                    if (cachedRecord) {
                        updates.cachedRecordAfterClear = cachedRecord;
                    }

                    await browserAPI.storage.local.set(updates);

                    // 如果没有有效记录，也要删除旧的缓存
                    if (!cachedRecord) {
                        await browserAPI.storage.local.remove(['cachedRecordAfterClear']);
                    }

                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({
                        success: false,
                        error: error?.message || '清空备份历史记录失败'
                    });
                }
            })();
            return true; // 异步响应

        } else if (message.action === "clearSyncHistoryPartial") {
            // 部分删除备份历史记录（删除最旧的N条，保留最新的记录）
            console.log('[clearSyncHistoryPartial] Received request, deleteCount:', message.deleteCount);

            const deleteCount = parseInt(message.deleteCount, 10) || 0;
            if (deleteCount <= 0) {
                console.log('[clearSyncHistoryPartial] deleteCount is 0 or invalid, returning success');
                sendResponse({ success: true, deleted: 0 });
                return true;
            }

            (async () => {
                try {
                    const data = await browserAPI.storage.local.get(['syncHistory']);
                    let syncHistory = data.syncHistory || [];

                    console.log('[clearSyncHistoryPartial] Current history length:', syncHistory.length);

                    if (syncHistory.length === 0) {
                        console.log('[clearSyncHistoryPartial] No history to delete');
                        sendResponse({ success: true, deleted: 0, remaining: 0 });
                        return;
                    }

                    // 计算实际要删除的数量（不能超过总数）
                    const actualDeleteCount = Math.min(deleteCount, syncHistory.length);
                    console.log('[clearSyncHistoryPartial] Actual delete count:', actualDeleteCount);

                    // 保留最新的记录（删除最旧的）
                    const remainingHistory = syncHistory.slice(actualDeleteCount);

                    // 如果删除后还有记录，找到第一条有效的书签树作为对比基准
                    let cachedRecord = null;
                    if (remainingHistory.length > 0) {
                        // 找最后一条被删除的记录中有书签树的，作为新的对比基准
                        const deletedRecords = syncHistory.slice(0, actualDeleteCount);
                        for (let i = deletedRecords.length - 1; i >= 0; i--) {
                            if (deletedRecords[i].status === 'success' && deletedRecords[i].bookmarkTree) {
                                cachedRecord = {
                                    bookmarkTree: deletedRecords[i].bookmarkTree,
                                    bookmarkStats: deletedRecords[i].bookmarkStats,
                                    time: deletedRecords[i].time
                                };
                                break;
                            }
                        }
                    }

                    // 更新存储
                    const updates = { syncHistory: remainingHistory };
                    if (cachedRecord) {
                        updates.cachedRecordAfterClear = cachedRecord;
                    }
                    await browserAPI.storage.local.set(updates);

                    // 如果删除后没有记录，也要更新 cachedRecordAfterClear
                    if (remainingHistory.length === 0 && cachedRecord) {
                        await browserAPI.storage.local.set({ cachedRecordAfterClear: cachedRecord });
                    } else if (remainingHistory.length === 0 && !cachedRecord) {
                        await browserAPI.storage.local.remove(['cachedRecordAfterClear']);
                    }

                    console.log('[clearSyncHistoryPartial] Success, deleted:', actualDeleteCount, 'remaining:', remainingHistory.length);
                    sendResponse({
                        success: true,
                        deleted: actualDeleteCount,
                        remaining: remainingHistory.length
                    });
                } catch (error) {
                    console.error('[clearSyncHistoryPartial] Error:', error);
                    sendResponse({
                        success: false,
                        error: error?.message || '部分删除备份历史记录失败'
                    });
                }
            })();
            return true; // 异步响应

        } else if (message.action === "deleteSyncHistoryItems") {
            // 删除指定的备份历史记录
            const fingerprintsToDelete = message.fingerprints || [];
            if (!fingerprintsToDelete.length) {
                sendResponse({ success: true });
                return true;
            }

            browserAPI.storage.local.get(['syncHistory'], (data) => {
                let syncHistory = data.syncHistory || [];
                const initialLength = syncHistory.length;

                // 过滤掉要删除的记录
                syncHistory = syncHistory.filter(item => !fingerprintsToDelete.includes(item.fingerprint));

                if (syncHistory.length !== initialLength) {
                    const updates = { syncHistory: syncHistory };

                    const setPromise = browserAPI.storage.local.set(updates);
                    const removePromise = syncHistory.length === 0
                        ? browserAPI.storage.local.remove(['cachedRecordAfterClear'])
                        : Promise.resolve();

                    Promise.all([setPromise, removePromise])
                        .then(() => {
                            sendResponse({ success: true });
                        })
                        .catch(error => {
                            sendResponse({
                                success: false,
                                error: error?.message || '删除记录失败'
                            });
                        });
                } else {
                    sendResponse({ success: true });
                }
            });
            return true; // 异步响应
        } else if (message.action === "deleteSyncHistoryItemsByTime") {
            const timesToDelete = Array.isArray(message.times) ? message.times.map(t => String(t)) : [];
            if (!timesToDelete.length) {
                sendResponse({ success: true });
                return true;
            }

            browserAPI.storage.local.get(['syncHistory'], (data) => {
                let syncHistory = data.syncHistory || [];
                const initialLength = syncHistory.length;

                syncHistory = syncHistory.filter(item => !timesToDelete.includes(String(item.time)));

                const updates = { syncHistory: syncHistory };

                const setPromise = browserAPI.storage.local.set(updates);
                const removePromise = syncHistory.length === 0
                    ? browserAPI.storage.local.remove(['cachedRecordAfterClear'])
                    : Promise.resolve();

                Promise.all([setPromise, removePromise])
                    .then(() => {
                        const deleted = initialLength - syncHistory.length;
                        sendResponse({ success: true, deleted, remaining: syncHistory.length });
                    })
                    .catch(error => {
                        sendResponse({
                            success: false,
                            error: error?.message || '删除记录失败'
                        });
                    });
            });
            return true; // 异步响应
        } else if (message.action === "downloadWithNotification") {
            // 处理带通知的下载
            const options = message.options || {};

            try {
                // 确保显示下载通知栏
                const downloadOptions = {
                    url: options.url,
                    filename: options.filename,
                    saveAs: options.saveAs
                };

                // 执行下载
                browserAPI.downloads.download(downloadOptions, (downloadId) => {
                    if (browserAPI.runtime.lastError) {
                        sendResponse({ success: false, error: browserAPI.runtime.lastError.message });
                    } else {
                        // 确保下载架(shelf)可见
                        if (browserAPI.downloads.setShelfEnabled) {
                            browserAPI.downloads.setShelfEnabled(true);
                        }

                        // 记录这不是书签备份下载，不需要隐藏下载栏
                        sendResponse({ success: true, downloadId: downloadId });
                    }
                });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }

            return true; // 异步响应
        } else if (message.action === "downloadBlobUrl") {
            // 处理来自 content script 的 blob URL 下载（用于大文件导出，支持子目录）
            (async () => {
                try {
                    const url = message.url;
                    const filename = message.filename;
                    if (!url || !filename) throw new Error('缺少下载参数');

                    const downloadId = await new Promise((resolve, reject) => {
                        browserAPI.downloads.download({
                            url,
                            filename,
                            saveAs: false,
                            conflictAction: 'uniquify'
                        }, (id) => {
                            if (browserAPI.runtime.lastError) {
                                reject(new Error(browserAPI.runtime.lastError.message));
                            } else {
                                resolve(id);
                            }
                        });
                    });

                    sendResponse({ success: true, downloadId });
                } catch (error) {
                    sendResponse({ success: false, error: error.message || '下载失败' });
                }
            })();

            return true; // 异步响应
        } else if (message.action === "autoBackupStateChangedInBackground") {
            // 此处理器现在可能是多余的，如果所有状态更改都通过 onAutoBackupToggled 处理，请考虑删除。
            // 如果 popup 打开，则可能会更新 UI 元素
            return false;

        } else if (message.action === 'showReminderSettings') {
            // 处理来自 popup 的手动备份通知请求
            if (message.statusText) {
                // 使用传递过来的 statusText 创建通知
                browserAPI.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png', // 扩展图标路径
                    title: '手动备份完成',
                    message: message.statusText, // 直接使用 popup 传递的文本
                    priority: 0 // 默认优先级
                }, (notificationId) => {
                    if (browserAPI.runtime.lastError) {
                        sendResponse({ success: false, error: browserAPI.runtime.lastError.message });
                    } else {
                        sendResponse({ success: true, notificationId: notificationId });
                    }
                });

                return true; // 异步处理响应
            } else {
                sendResponse({ success: false, error: '缺少状态文本' });
            }
        }

        // ===== 自动备份定时器相关消息处理 =====
        else if (message.action === "autoBackupModeChanged") {
            // 备份模式切换（realtime, regular, specific）
            (async () => {
                try {
                    const { mode } = message;
                    // 重新设置回调函数
                    setAutoBackupCallbacks(
                        checkBookmarkChangesForAutoBackup,
                        syncBookmarks
                    );
                    // 不再无条件重启，由 setBadge() 根据是否有变化决定
                    await setBadge();
                    sendResponse({ success: true, mode });
                } catch (error) {
                    console.error('[自动备份定时器] 模式切换失败:', error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "restartAutoBackupTimer") {
            // 重启定时器系统
            (async () => {
                try {
                    // 重新设置回调函数
                    setAutoBackupCallbacks(
                        checkBookmarkChangesForAutoBackup,
                        syncBookmarks
                    );
                    // 不再无条件重启，由 setBadge() 根据是否有变化决定
                    await setBadge();
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('[自动备份定时器] 重启失败:', error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "checkBookmarkChanges") {
            // 检查书签变化（供自动备份定时器调用）
            (async () => {
                try {
                    const result = await checkBookmarkChangesForAutoBackup();
                    sendResponse(result);
                } catch (error) {
                    console.error('[自动备份定时器] 检查书签变化失败:', error);
                    sendResponse({
                        success: false,
                        hasChanges: false,
                        changeDescription: '',
                        error: error.message
                    });
                }
            })();
            return true;
        }
        // =============================================================================
        // 活跃时间追踪 API
        // =============================================================================
        else if (message.action === "setTrackingEnabled") {
            (async () => {
                try {
                    await setTrackingEnabled(message.enabled);
                    sendResponse({ success: true, enabled: message.enabled });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "isTrackingEnabled") {
            (async () => {
                try {
                    const enabled = await isTrackingEnabled();
                    sendResponse({ success: true, enabled });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "getCurrentActiveSessions") {
            (async () => {
                try {
                    const sessions = await getCurrentActiveSessions();
                    sendResponse({ success: true, sessions });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;  // 异步响应
        }
        else if (message.action === "getBookmarkActiveTime") {
            (async () => {
                try {
                    const stats = await getBookmarkActiveTimeStats(message.bookmarkId);
                    sendResponse({ success: true, ...stats });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "getActiveSessions") {
            (async () => {
                try {
                    const sessions = await getSessionsByTimeRange(message.startTime, message.endTime);
                    sendResponse({ success: true, sessions });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "getActiveSessionsByUrl") {
            (async () => {
                try {
                    const sessions = await getSessionsByUrl(message.url, message.startTime, message.endTime);
                    sendResponse({ success: true, sessions });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "getTrackingStats") {
            (async () => {
                try {
                    const stats = await getTrackingStats();
                    sendResponse({ success: true, stats });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        // S值计算相关消息
        else if (message.action === "computeBookmarkScores") {
            (async () => {
                try {
                    const success = await computeAllBookmarkScores();
                    sendResponse({ success });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "updateBookmarkScore") {
            (async () => {
                try {
                    await updateSingleBookmarkScore(message.bookmarkId);
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "updateBookmarkScoreByUrl") {
            // 根据URL更新对应书签的S值
            if (message.url) {
                scheduleScoreUpdateByUrl(message.url);
            }
            sendResponse({ success: true });
            return false;
        }
        else if (message.action === "trackingDataUpdated") {
            // T值数据更新，触发对应URL的S值增量更新
            if (message.url) {
                scheduleScoreUpdateByUrl(message.url);
            }
            // 不需要sendResponse，让消息继续传递给其他监听者（如history.js）
            return false;
        }
        else if (message.action === "clearAllTrackingSessions") {
            // 兼容旧接口：清除全部显示数据
            (async () => {
                try {
                    await clearTrackingDisplayData();
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "clearCurrentTrackingSessions") {
            // 仅清除正在追踪的会话
            (async () => {
                try {
                    await clearCurrentTrackingSessions();
                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "clearTrackingStatsByRange") {
            // 按时间范围清除综合排行数据
            (async () => {
                try {
                    const result = await clearTrackingStatsByRange(message.range);
                    sendResponse({ success: true, ...result });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }
        else if (message.action === "syncTrackingData") {
            // 数据一致性检查
            (async () => {
                try {
                    const result = await syncTrackingData();
                    sendResponse({ success: true, ...result });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
        }

    } catch (error) {
        sendResponse({ success: false, error: error.message || '未知错误' });
    }

    // 对于不需要异步处理的消息，返回false
    return false;
});

// 监听计时器警报
browserAPI.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "syncBookmarks") {
        try {
            // 自动备份时传入完整参数
            const result = await syncBookmarks(false, null, false, null);
            // 在备份完成后调用 updateBadgeAfterSync
            updateBadgeAfterSync(result.success);
        } catch (error) {
            // 备份失败也要更新角标为错误状态
            updateBadgeAfterSync(false);
        }
    }
    // 处理自动备份定时器的 alarms
    else if (alarm.name.startsWith('autoBackup')) {
        try {
            // Service Worker 唤醒时，重新设置回调函数
            setAutoBackupCallbacks(
                checkBookmarkChangesForAutoBackup,
                syncBookmarks
            );
            await handleAutoBackupAlarmTrigger(alarm);
        } catch (error) {
            console.error('[自动备份定时器] 处理 alarm 失败:', error);
        }
    }
    // 移除对backupReminderAlarm的处理逻辑，防止与timer.js中的handleAlarm重复处理
    // 由timer.js的handleAlarm函数专门处理backupReminderAlarm
});

// 添加书签变化监听器
browserAPI.bookmarks.onCreated.addListener(handleBookmarkChange);
browserAPI.bookmarks.onRemoved.addListener(handleBookmarkChange);
browserAPI.bookmarks.onChanged.addListener(handleBookmarkChange);
browserAPI.bookmarks.onMoved.addListener(handleBookmarkChange);
// 这些事件在“批量导入/重排”场景下也会改变树结构/顺序，需同步标记快照失效
try {
    if (browserAPI.bookmarks.onChildrenReordered) {
        browserAPI.bookmarks.onChildrenReordered.addListener(handleBookmarkChange);
    }
    if (browserAPI.bookmarks.onImportBegan) {
        browserAPI.bookmarks.onImportBegan.addListener(() => {
            try {
                isBookmarkImporting = true;
                // 导入开始：停止任何已安排的刷新，避免导入过程中触发分析/快照 rebuild
                if (bookmarkImportFlushTimer) {
                    clearTimeout(bookmarkImportFlushTimer);
                    bookmarkImportFlushTimer = null;
                }
                if (bookmarkChangeTimeout) {
                    clearTimeout(bookmarkChangeTimeout);
                    bookmarkChangeTimeout = null;
                }
                // 标记快照失效，并取消自动 rebuild 定时器（导入期间不 rebuild）
                try { BookmarkSnapshotCache.stale = true; } catch (_) { }
                if (BookmarkSnapshotCache && BookmarkSnapshotCache.rebuildTimer) {
                    clearTimeout(BookmarkSnapshotCache.rebuildTimer);
                    BookmarkSnapshotCache.rebuildTimer = null;
                }
            } catch (_) { }
        });
    }
    if (browserAPI.bookmarks.onImportEnded) {
        browserAPI.bookmarks.onImportEnded.addListener(() => {
            try {
                isBookmarkImporting = false;
                // 导入结束后延迟一次统一刷新，避免最后一波事件还在收尾
                if (bookmarkImportFlushTimer) clearTimeout(bookmarkImportFlushTimer);
                bookmarkImportFlushTimer = setTimeout(() => {
                    bookmarkImportFlushTimer = null;
                    try { handleBookmarkChange(); } catch (_) { }
                }, 1000);
            } catch (_) { }
        });
    }
} catch (_) { }

// 处理书签变化的函数
async function handleBookmarkChange() {
    try {
        BookmarkSnapshotCache.markStale('bookmarks event');
    } catch (_) { }

    if (bookmarkChangeTimeout) {
        clearTimeout(bookmarkChangeTimeout);
    }

    bookmarkChangeTimeout = setTimeout(async () => {
        try {
            // 导入期间：避免触发昂贵的分析/通信/可能的实时备份；导入结束后会统一 flush
            if (isBookmarkImporting) {
                return;
            }
            // 读取自动模式和自动备份定时器设置
            const { autoSync = true, autoBackupTimerSettings } = await browserAPI.storage.local.get(['autoSync', 'autoBackupTimerSettings']);
            const backupMode = autoBackupTimerSettings?.backupMode || 'regular';

            // 更新最后书签变更时间（无论模式如何）
            await browserAPI.storage.local.set({
                lastBookmarkChangeTime: Date.now()
            });
            // 只有在手动备份模式下才设置活动标志
            if (!autoSync) {
                await browserAPI.storage.local.set({ hasBookmarkActivitySinceLastCheck: true });
            }

            // 先更新分析缓存，再更新角标：
            // - 避免 setBadge() 读到旧的 cachedBookmarkAnalysis，导致“移动/修改（数量不变）时角标不变黄”
            // - updateAndCacheAnalysis() 会把 lastSyncOperations 的最新标记纳入分析，并广播给前端
            try {
                await updateAndCacheAnalysis();
            } catch (_) {
                // 出错时不阻塞角标更新：setBadge 内部会自行兜底为红色/错误角标
            }

            // 更新角标（无论模式如何）
            await setBadge(); // 使用新的不带参数的setBadge

            // 向Popup页面发送消息，通知书签已更改
            try {
                const response = await browserAPI.runtime.sendMessage({ action: "bookmarkChanged" });
                if (!response || !response.success) {
                }
            } catch (error) {
                // 如果Popup页面未打开，会抛出错误，忽略即可
                if (error.message && error.message.includes('Receiving end does not exist')) {
                } else {
                }
            }

            // 仅在自动备份模式且备份模式为"实时"时才立即触发自动备份
            // 常规时间和特定时间模式下，备份由定时器触发，而非书签变化立即触发
            if (autoSync && backupMode === 'realtime') {
                syncBookmarks(false, null, false, null).then(result => { // 传递完整参数
                    // 在备份完成后调用 updateBadgeAfterSync
                    updateBadgeAfterSync(result.success);
                    // 如果成功，则更新缓存
                    if (result.success) {
                        updateAndCacheAnalysis();
                    }
                }).catch(error => {
                    // 备份失败也要更新角标为错误状态
                    updateBadgeAfterSync(false);
                });
            }
        } catch (error) {
        }
    }, 250); // 延迟250毫秒，合并短时间内的多次变化（降低角标反馈延迟）
}

// 添加快捷键监听
browserAPI.commands.onCommand.addListener((command) => {
    // 快捷键处理逻辑
    // 此处已删除打开书签搜索的功能
});


// =================================================================================
// III. CLOUD FUNCTIONS (云端功能)
// =================================================================================

// 修改上传书签到服务器的函数
async function uploadBookmarks(bookmarks) {
    const config = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'is123Pan']);
    if (!config.serverAddress || !config.username || !config.password) {
        // 不再抛出错误，而是返回一个状态表明WebDAV未配置
        return { success: false, error: "WebDAV 信息未配置", webDAVNotConfigured: true };
    }

    const serverAddress = config.serverAddress.replace(/\/+$/, '/');
    // 获取本地化的文件夹名称
    const backupFolder = await getBackupFolder();
    const exportRootFolder = await getExportRootFolder();
    const folderPath = `${exportRootFolder}/${backupFolder}/`; // 使用统一的文件夹结构（根据语言动态选择）
    // 获取当前日期和时间作为文件名，精确到秒
    const currentDate = new Date();
    const fileName = `${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}${currentDate.getDate().toString().padStart(2, '0')}_${currentDate.getHours().toString().padStart(2, '0')}${currentDate.getMinutes().toString().padStart(2, '0')}${currentDate.getSeconds().toString().padStart(2, '0')}.html`;
    const fullUrl = `${serverAddress}${folderPath}${fileName}`;
    const folderUrl = `${serverAddress}${folderPath}`;
    const parentFolderUrl = `${serverAddress}${exportRootFolder}/`;

    const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

    try {
        // 检查并创建父文件夹（如果不存在）
        const checkParentResponse = await fetch(parentFolderUrl, {
            method: 'PROPFIND',
            headers: {
                'Authorization': authHeader,
                'Depth': '0',
                'Content-Type': 'application/xml'
            },
            body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
        });

        if (checkParentResponse.status === 404) {
            // 创建父文件夹
            const mkcolParentResponse = await fetch(parentFolderUrl, {
                method: 'MKCOL',
                headers: { 'Authorization': authHeader }
            });
            if (!mkcolParentResponse.ok && mkcolParentResponse.status !== 405) {
                throw new Error(`创建父文件夹失败: ${mkcolParentResponse.status} - ${mkcolParentResponse.statusText}`);
            }
        } else if (checkParentResponse.status === 401) {
            throw new Error('WebDAV认证失败，请检查账号密码是否正确');
        }

        // 检查子文件夹是否存在
        const checkFolderResponse = await fetch(folderUrl, {
            method: 'PROPFIND',
            headers: {
                'Authorization': authHeader,
                'Depth': '0',
                'Content-Type': 'application/xml'
            },
            body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
        });

        // 处理各种可能的错误情况
        if (checkFolderResponse.status === 401) {
            throw new Error('WebDAV认证失败，请检查账号密码是否正确');
        } else if (checkFolderResponse.status === 404) {
            const mkcolResponse = await fetch(folderUrl, {
                method: 'MKCOL',
                headers: {
                    'Authorization': authHeader
                }
            });

            if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
                throw new Error(`创建文件夹失败: ${mkcolResponse.status} - ${mkcolResponse.statusText}`);
            }
        } else if (!checkFolderResponse.ok) {
            throw new Error(`检查文件夹失败: ${checkFolderResponse.status} - ${checkFolderResponse.statusText}`);
        }

        // 将书签数据转换为Edge格式的HTML
        const htmlContent = convertToEdgeHTML(bookmarks);

        // 尝试删除已存在的文件
        try {
            await fetch(fullUrl, {
                method: 'DELETE',
                headers: {
                    'Authorization': authHeader
                }
            });
        } catch (error) {
        }

        // 上传新文件
        const response = await fetch(fullUrl, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'text/html',
                'Overwrite': 'T'
            },
            body: htmlContent
        });

        if (!response.ok) {
            const responseText = await response.text();
            throw new Error(`上传失败: ${response.status} - ${response.statusText}`);
        }

        return { success: true };
    } catch (error) {
        if (error.message.includes('Failed to fetch')) {
            throw new Error('无法连接到WebDAV服务器，请检查地址是否正确或网络是否正常');
        }
        throw error;
    }
}

// 上传书签到 GitHub Repository（云端2）
async function uploadBookmarksToGitHubRepo(bookmarks) {
    const config = await browserAPI.storage.local.get([
        'githubRepoToken',
        'githubRepoOwner',
        'githubRepoName',
        'githubRepoBranch',
        'githubRepoBasePath',
        'githubRepoEnabled'
    ]);

    if (!config.githubRepoToken) {
        return { success: false, error: "GitHub Token 未配置", repoNotConfigured: true };
    }
    if (!config.githubRepoOwner || !config.githubRepoName) {
        return { success: false, error: "仓库未配置", repoNotConfigured: true };
    }
    if (config.githubRepoEnabled === false) {
        return { success: false, error: "GitHub 仓库已禁用", repoDisabled: true };
    }

    // 将书签数据转换为Edge格式的HTML
    const htmlContent = convertToEdgeHTML(bookmarks);

    // 文件名：与 WebDAV “不覆盖”一致，使用时间戳精确到秒
    const currentDate = new Date();
    const timestamp = `${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}${currentDate.getDate().toString().padStart(2, '0')}_${currentDate.getHours().toString().padStart(2, '0')}${currentDate.getMinutes().toString().padStart(2, '0')}${currentDate.getSeconds().toString().padStart(2, '0')}`;
    const baseFileName = `${timestamp}.html`;
    const lang = await getCurrentLang();

    const filePath = buildGitHubRepoFilePath({
        basePath: config.githubRepoBasePath,
        lang,
        folderKey: 'backup',
        fileName: baseFileName
    });

    const result = await upsertRepoFile({
        token: config.githubRepoToken,
        owner: config.githubRepoOwner,
        repo: config.githubRepoName,
        branch: config.githubRepoBranch,
        path: filePath,
        message: `Bookmark Backup: add backup ${baseFileName}`,
        contentBase64: textToBase64(htmlContent)
    });

    if (result && result.success === true) {
        return { success: true, path: result.path || filePath, htmlUrl: result.htmlUrl || null };
    }

    return { success: false, error: result?.error || '上传到 GitHub 仓库失败' };
}

function sanitizeGitHubRepoPathPart(part) {
    let s = String(part == null ? '' : part);
    s = s.replace(/[\x00-\x1F\x7F]/g, ''); // 移除控制字符
    s = s.replace(/[\\/]/g, '_'); // 防止注入路径分隔符
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

function buildGitHubRepoFilePath({ basePath, lang, folderKey, fileName }) {
    const baseRaw = String(basePath || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const baseParts = baseRaw
        ? baseRaw.split('/').filter(Boolean).map(sanitizeGitHubRepoPathPart).filter(Boolean)
        : [];
    const root = sanitizeGitHubRepoPathPart(getExportRootFolderByLang(lang));
    const sub = sanitizeGitHubRepoPathPart(resolveExportSubFolderByKey(folderKey, lang));
    const leaf = sanitizeGitHubRepoPathPart(String(fileName || '').split('/').pop());
    const joined = [...baseParts, root, sub, leaf].filter(Boolean).join('/');
    return joined || 'export.txt';
}

function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x2000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function textToBase64(text) {
    const encoder = new TextEncoder();
    const buf = encoder.encode(String(text ?? '')).buffer;
    return arrayBufferToBase64(buf);
}

async function ensureWebDAVCollectionExists(url, authHeader, errorPrefix) {
    const checkResponse = await fetch(url, {
        method: 'PROPFIND',
        headers: {
            'Authorization': authHeader,
            'Depth': '0',
            'Content-Type': 'application/xml'
        },
        body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
    });

    if (checkResponse.status === 401) {
        throw new Error('WebDAV认证失败，请检查账号密码是否正确');
    }

    if (checkResponse.status === 404) {
        const mkcolResponse = await fetch(url, {
            method: 'MKCOL',
            headers: { 'Authorization': authHeader }
        });
        if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
            throw new Error(`${errorPrefix}: ${mkcolResponse.status} - ${mkcolResponse.statusText}`);
        }
        return;
    }

    if (!checkResponse.ok) {
        throw new Error(`${errorPrefix}: ${checkResponse.status} - ${checkResponse.statusText}`);
    }
}

async function uploadExportFileToWebDAV({ lang, folderKey, fileName, content, contentArrayBuffer, contentType }) {
    const config = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']);
    if (!config.serverAddress || !config.username || !config.password) {
        return { success: false, skipped: true, error: "WebDAV 配置不完整" };
    }
    if (config.webDAVEnabled === false) {
        return { success: false, skipped: true, error: "WebDAV 已禁用" };
    }

    const serverAddress = config.serverAddress.replace(/\/+$/, '/');
    const exportRootFolder = getExportRootFolderByLang(lang);
    const exportSubFolder = resolveExportSubFolderByKey(folderKey, lang);
    const folderPath = `${exportRootFolder}/${exportSubFolder}/`;

    const fullUrl = `${serverAddress}${folderPath}${fileName}`;
    const folderUrl = `${serverAddress}${folderPath}`;
    const parentFolderUrl = `${serverAddress}${exportRootFolder}/`;

    const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

    try {
        await ensureWebDAVCollectionExists(parentFolderUrl, authHeader, '创建父文件夹失败');
        await ensureWebDAVCollectionExists(folderUrl, authHeader, '创建导出文件夹失败');

        const response = await fetch(fullUrl, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': contentType || 'text/plain;charset=utf-8',
                'Overwrite': 'T'
            },
            body: contentArrayBuffer ? contentArrayBuffer : String(content ?? '')
        });

        if (!response.ok) {
            throw new Error(`上传失败: ${response.status} - ${response.statusText}`);
        }

        return { success: true };
    } catch (error) {
        if (String(error?.message || '').includes('Failed to fetch')) {
            return { success: false, error: '无法连接到WebDAV服务器，请检查地址是否正确或网络是否正常' };
        }
        return { success: false, error: error?.message || '上传到WebDAV失败' };
    }
}

async function uploadExportFileToGitHubRepo({ lang, folderKey, fileName, content, contentArrayBuffer }) {
    const config = await browserAPI.storage.local.get([
        'githubRepoToken',
        'githubRepoOwner',
        'githubRepoName',
        'githubRepoBranch',
        'githubRepoBasePath',
        'githubRepoEnabled'
    ]);

    if (!config.githubRepoToken) {
        return { success: false, skipped: true, error: "GitHub Token 未配置" };
    }
    if (!config.githubRepoOwner || !config.githubRepoName) {
        return { success: false, skipped: true, error: "仓库未配置" };
    }
    if (config.githubRepoEnabled === false) {
        return { success: false, skipped: true, error: "GitHub 仓库已禁用" };
    }

    const filePath = buildGitHubRepoFilePath({ basePath: config.githubRepoBasePath, lang, folderKey, fileName });

    const leaf = String(fileName || '').split('/').pop() || 'export';
    const commitMessage = `Bookmark Backup: export ${folderKey} ${leaf}`;

    const contentBase64 = contentArrayBuffer ? arrayBufferToBase64(contentArrayBuffer) : textToBase64(content);

    try {
        const result = await upsertRepoFile({
            token: config.githubRepoToken,
            owner: config.githubRepoOwner,
            repo: config.githubRepoName,
            branch: config.githubRepoBranch,
            path: filePath,
            message: commitMessage,
            contentBase64
        });

        if (result && result.success === true) {
            return { success: true, path: result.path || filePath, htmlUrl: result.htmlUrl || null };
        }

        return { success: false, error: result?.error || '上传到 GitHub 仓库失败' };
    } catch (error) {
        return { success: false, error: error?.message || '上传到 GitHub 仓库失败' };
    }
}

// 从服务器下载书签
async function downloadBookmarks() {
    // 功能已移除，返回错误信息
    return { success: false, error: "功能已移除", webDAVNotConfigured: true };
}

// 从坚果云获取书签
async function updateBookmarksFromNutstore() {
    try {
        const config = await browserAPI.storage.local.get(['serverAddress', 'username', 'password']);

        if (!config.serverAddress || !config.username || !config.password) {
            throw new Error("请先配置 WebDAV 信息");
        }

        // 构建完整的 WebDAV URL - 使用统一文件夹结构（根据语言动态选择）
        const backupFolderName = await getBackupFolder();
        const exportRootFolder = await getExportRootFolder();
        const folderPath = `/${exportRootFolder}/${backupFolderName}/`;
        const fileName = 'chrome_bookmarks.json';
        const fullUrl = `${config.serverAddress}${folderPath}${fileName}`;

        // 从 WebDAV 获取书签数据
        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Authorization': 'Basic ' + safeBase64(config.username + ':' + config.password)
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const bookmarksData = await response.json();

        // 更新浏览器书签
        await updateBookmarks(bookmarksData);

        return true;
    } catch (error) {
        throw error;
    }
}


// =================================================================================
// IV. LOCAL FUNCTIONS (本地功能)
// =================================================================================

// 上传书签到本地
async function uploadBookmarksToLocal(bookmarks) {
    // 获取本地备份配置
    const config = await browserAPI.storage.local.get([
        'defaultDownloadEnabled',
        'customFolderEnabled',
        'customFolderPath',
        'customFolderHandle',
        'localBackupPath',     // 兼容旧版本
        'localBackupEnabled',  // 兼容旧版本
        'hideDownloadShelf'    // 控制是否隐藏下载栏
    ]);

    // 检查是否启用任一本地备份方式
    const defaultDownloadEnabled = config.defaultDownloadEnabled === true;
    const customFolderEnabled = config.customFolderEnabled === true && config.customFolderPath;
    const oldConfigEnabled = config.localBackupEnabled === true && config.localBackupPath;

    if (!defaultDownloadEnabled && !customFolderEnabled && !oldConfigEnabled) {
        throw new Error("本地备份未启用或路径未配置");
    }

    try {
        const htmlContent = convertToEdgeHTML(bookmarks);

        // 获取当前日期和时间作为文件名，精确到秒
        const currentDate = new Date();
        const fileName = `${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}${currentDate.getDate().toString().padStart(2, '0')}_${currentDate.getHours().toString().padStart(2, '0')}${currentDate.getMinutes().toString().padStart(2, '0')}${currentDate.getSeconds().toString().padStart(2, '0')}.html`;

        // 记录结果，包含文件名信息
        const result = {
            success: false,
            fileName: fileName
        };

        // 默认下载方式
        if (defaultDownloadEnabled) {
            // 根据设置决定是否临时禁用下载通知栏
            const shouldHideDownloadShelf = config.hideDownloadShelf !== false; // 默认为true

            // 检查是否有下载栏权限
            const hasDownloadShelfPermission = await new Promise(resolve => {
                try {
                    browserAPI.permissions.contains({
                        permissions: ['downloads.shelf']
                    }, result => {
                        resolve(result);
                    });
                } catch (error) {
                    resolve(false);
                }
            });

            // 标记开始书签备份
            isBookmarkBackupInProgress = true;

            // 临时禁用下载通知栏（如果设置了且有权限）
            if (shouldHideDownloadShelf && hasDownloadShelfPermission) {
                try {
                    // 直接设置下载栏为隐藏状态，不再尝试先获取当前状态
                    // 因为Chrome没有提供getShelfEnabled API
                    await browserAPI.downloads.setShelfEnabled(false);
                } catch (error) {
                }
            } else if (shouldHideDownloadShelf && !hasDownloadShelfPermission) {
            }

            try {
                // 使用downloads API直接保存到默认下载位置（根据语言动态选择文件夹名）
                const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
                const localBackupFolder = await getBackupFolder();
                const exportRootFolder = await getExportRootFolder();

                const downloadId = await new Promise((resolve, reject) => {
                    browserAPI.downloads.download({
                        url: dataUrl,
                        filename: `${exportRootFolder}/${localBackupFolder}/${fileName}`,
                        saveAs: false
                    }, (id) => {
                        if (browserAPI.runtime.lastError) {
                            reject(new Error(browserAPI.runtime.lastError.message));
                        } else {
                            // 将此下载ID记录为书签备份下载
                            bookmarkDownloadIds.add(id);
                            resolve(id);
                        }
                    });
                });

                // 监听下载完成事件
                await new Promise(resolve => {
                    const onDownloadComplete = (delta) => {
                        if (delta.id === downloadId && (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted'))) {
                            browserAPI.downloads.onChanged.removeListener(onDownloadComplete);
                            resolve();
                        }
                    };

                    browserAPI.downloads.onChanged.addListener(onDownloadComplete);

                    // 设置安全超时，以防下载事件未触发
                    setTimeout(resolve, 5000);
                });

                // 恢复下载通知栏显示
                if (shouldHideDownloadShelf && hasDownloadShelfPermission) {
                    try {
                        await browserAPI.downloads.setShelfEnabled(true);
                    } catch (error) {
                    }
                }

                // 标记书签备份结束
                isBookmarkBackupInProgress = false;

                // 更新结果
                result.success = true;
            } catch (error) {
                // 出错时也要确保恢复下载栏
                if (shouldHideDownloadShelf && hasDownloadShelfPermission) {
                    try {
                        await browserAPI.downloads.setShelfEnabled(true);
                    } catch (restoreError) {
                    }
                }

                // 标记书签备份结束
                isBookmarkBackupInProgress = false;
                throw error;
            }
        }

        // 自定义文件夹方式
        if (customFolderEnabled) {
            // 待实现：使用FileSystem Access API
            // TODO: 由于Chrome扩展的限制，这里暂时不实现
            // 实际上，我们需要在用户界面直接使用FileSystem Access API
        }

        // 兼容旧版本（根据语言动态选择文件夹名）
        if (oldConfigEnabled) {
            const legacyBackupFolder = await getBackupFolder();
            const exportRootFolder = await getExportRootFolder();
            const folderPath = config.localBackupPath.endsWith('/') ? config.localBackupPath : config.localBackupPath + '/';
            const fullPath = `${folderPath}${exportRootFolder}/${legacyBackupFolder}/${fileName}`;

            // 创建文件夹（如果不存在）
            await ensureDirectoryExists(`${folderPath}${exportRootFolder}/${legacyBackupFolder}/`);

            // 写入文件
            await writeFile(fullPath, htmlContent);

            // 更新结果
            result.success = true;
        }

        return result;
    } catch (error) {
        throw error;
    }
}

// 确保目录存在
function ensureDirectoryExists(dirPath) {
    return new Promise((resolve, reject) => {
        try {
            // 在Chrome扩展中，可以使用HTML5的文件系统API
            // 但这需要用户授权和选择目录
            // 这里改为通过消息传递，让用户在popup界面选择目录
            // 假设目录已存在，或者已在选择目录时创建
            // 这个函数在实际应用中应由Native App或用户交互来处理
            resolve(true);
        } catch (error) {
            reject(error);
        }
    });
}

// 写入文件（根据语言动态选择文件夹名）
async function writeFile(filePath, content) {
    // 在外层获取本地化的文件夹名，避免在内嵌函数中使用 await
    const writeBackupFolder = await getBackupFolder();
    const writeExportRootFolder = await getExportRootFolder();

    return new Promise((resolve, reject) => {
        try {
            // 在Chrome扩展的service worker中，不能使用URL.createObjectURL
            // 提取文件名
            const fileName = filePath.split('/').pop();

            // 检查内容大小，如果过大则分块处理
            const isLargeContent = content.length > 500000; // 约0.5MB

            if (isLargeContent) {
                // 对于大文件，使用blob URL创建方式在main世界执行
                // 我们需要向活动标签页注入脚本来执行此操作

                // 首先获取当前的活动标签页
                browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs.length === 0) {
                        // 如果没有活动标签页，尝试使用data:URL方法
                        useDataUrlMethod();
                        return;
                    }

                    const activeTab = tabs[0];

                    // 注入执行下载的脚本
                    browserAPI.scripting.executeScript({
                        target: { tabId: activeTab.id },
                        func: (content, filePath) => {
                            const blob = new Blob([content], { type: 'text/html' });
                            const url = URL.createObjectURL(blob);
                            const leafName = String(filePath || '').split('/').pop() || 'bookmarks.html';

                            return new Promise((resolve) => {
                                try {
                                    chrome.runtime.sendMessage({
                                        action: 'downloadBlobUrl',
                                        url,
                                        filename: filePath
                                    }, (resp) => {
                                        if (chrome.runtime && chrome.runtime.lastError) {
                                            // 降级：直接触发下载（不保证子目录）
                                            try {
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = leafName;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                            } catch (_) { }
                                            setTimeout(() => {
                                                try { URL.revokeObjectURL(url); } catch (_) { }
                                            }, 10000);
                                            resolve(true);
                                            return;
                                        }

                                        if (!resp || resp.success !== true) {
                                            // 降级：直接触发下载（不保证子目录）
                                            try {
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = leafName;
                                                document.body.appendChild(a);
                                                a.click();
                                                document.body.removeChild(a);
                                            } catch (_) { }
                                            setTimeout(() => {
                                                try { URL.revokeObjectURL(url); } catch (_) { }
                                            }, 10000);
                                            resolve(true);
                                            return;
                                        }

                                        setTimeout(() => {
                                            try { URL.revokeObjectURL(url); } catch (_) { }
                                        }, 10000);
                                        resolve(true);
                                    });
                                } catch (_) {
                                    // 降级：直接触发下载（不保证子目录）
                                    try {
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = leafName;
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                    } catch (_) { }
                                    setTimeout(() => {
                                        try { URL.revokeObjectURL(url); } catch (_) { }
                                    }, 10000);
                                    resolve(true);
                                }
                            });
                        },
                        args: [content, `${writeExportRootFolder}/${writeBackupFolder}/${fileName}`]
                    }, (results) => {
                        if (browserAPI.runtime.lastError) {
                            // 回退到data:URL方法
                            useDataUrlMethod();
                        } else if (results && results[0] && results[0].result === true) {
                            resolve(true);
                        } else {
                            // 回退到data:URL方法
                            useDataUrlMethod();
                        }
                    });
                });
            } else {
                // 对于较小的文件，直接使用data:URL方法
                useDataUrlMethod();
            }

            // 使用data:URL方法的辅助函数（使用预获取的文件夹名）
            function useDataUrlMethod() {
                try {
                    // 创建data:URL
                    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(content);

                    // 使用下载API下载文件
                    browserAPI.downloads.download({
                        url: dataUrl,
                        filename: `${writeExportRootFolder}/${writeBackupFolder}/${fileName}`,
                        saveAs: false
                    }, (downloadId) => {
                        if (browserAPI.runtime.lastError) {
                            reject(new Error(browserAPI.runtime.lastError.message));
                        } else {
                            resolve(true);
                        }
                    });
                } catch (error) {
                    reject(error);
                }
            }
        } catch (error) {
            reject(error);
        }
    });
}

// 辅助函数：导出历史记录为TXT文件
async function exportHistoryToTxt(records, lang) {
    // 复用或对齐 popup.js 中的国际化字符串和Markdown格式逻辑
    const i18n = {
        en: {
            exportTitle: "# Bookmark Backup History",
            exportNote: "Note: This file (.txt) contains content in Markdown table format.\n" +
                "You can either:\n" +
                "1. Copy and paste the content of this file into a Markdown-supporting editor (e.g., Typora, Obsidian) to view the table.\n" +
                "2. Or, change the file extension from (.txt) to (.md) and open it with a Markdown viewer.",
            tableHeaders: {
                timestamp: "Timestamp",
                notes: "Notes",
                bookmarkChange: "BKM Change",
                folderChange: "FLD Change",
                movedCount: "Moved",
                modifiedCount: "Modified",
                location: "Location",
                type: "Type",
                status: "Status/Error"
            },
            locationValues: {
                local: "Local",
                upload: "Cloud",
                cloud: "Cloud 1 & Cloud 2",
                webdav: "Cloud 1 (WebDAV)",
                github_repo: "Cloud 2 (GitHub Repo)",
                gist: "Cloud 2 (GitHub Repo)", // legacy
                cloud_local: "Cloud 1 & Cloud 2 & Local",
                webdav_local: "Cloud 1 (WebDAV) & Local",
                github_repo_local: "Cloud 2 (GitHub Repo) & Local",
                gist_local: "Cloud 2 (GitHub Repo) & Local", // legacy
                both: "Cloud 1 (WebDAV) & Local",
                none: "None",
                download: "Local"
            },
            typeValues: { auto: "Auto", manual: "Manual", switch: "Switch", auto_switch: "Switch", migration: "Migration", check: "Check" },
            statusValues: { success: "Success", error: "Error", locked: "File Locked", no_backup_needed: "No backup needed", check_completed: "Check completed" },
            filenameBase: "Bookmark_Backup_History",
            na: "N/A"
        },
        zh_CN: {
            exportTitle: "# 书签备份历史记录",
            exportNote: "注意：此文件 (.txt) 包含 Markdown 表格格式的内容。\n" +
                "您可以：\n" +
                "1. 将此文件内容复制粘贴到支持 Markdown 的编辑器（如 Typora, Obsidian 等）中查看表格。\n" +
                "2. 或者，将此文件的扩展名从 .txt 修改为 .md 后，使用 Markdown 查看器打开。",
            tableHeaders: {
                timestamp: "时间戳",
                notes: "备注",
                bookmarkChange: "书签变化",
                folderChange: "文件夹变化",
                movedCount: "移动",
                modifiedCount: "修改",
                location: "位置",
                type: "类型",
                status: "状态/错误"
            },
            locationValues: {
                local: "本地",
                upload: "云端",
                cloud: "云端1&云端2",
                webdav: "云端1(WebDAV)",
                github_repo: "云端2(GitHub仓库)",
                gist: "云端2(GitHub仓库)", // legacy
                cloud_local: "云端1&云端2与本地",
                webdav_local: "云端1(WebDAV)与本地",
                github_repo_local: "云端2(GitHub仓库)与本地",
                gist_local: "云端2(GitHub仓库)与本地", // legacy
                both: "云端1(WebDAV)与本地",
                none: "无",
                download: "本地"
            },
            typeValues: { auto: "自动", manual: "手动", switch: "切换", auto_switch: "切换", migration: "迁移", check: "检查" },
            statusValues: { success: "成功", error: "错误", locked: "文件锁定", no_backup_needed: "无需备份", check_completed: "检查完成" },
            filenameBase: "书签备份历史记录",
            na: "无"
        }
    };

    const t = i18n[lang] || i18n.zh_CN;

    let txtContent = t.exportTitle + "\n\n";
    txtContent += t.exportNote + "\n\n";

    // 新格式：9列（与 popup.js 一致）
    txtContent += `| ${t.tableHeaders.timestamp} | ${t.tableHeaders.notes} | ${t.tableHeaders.bookmarkChange} | ${t.tableHeaders.folderChange} | ${t.tableHeaders.movedCount} | ${t.tableHeaders.modifiedCount} | ${t.tableHeaders.location} | ${t.tableHeaders.type} | ${t.tableHeaders.status} |\n`;
    txtContent += "|---|---|---|---|---|---|---|---|---|\n";

    const formatTimeForExport = (isoString) => {
        if (!isoString) return t.na;
        try {
            const date = new Date(isoString);
            return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
        } catch (e) {
            return isoString;
        }
    };

    // 对记录按时间排序，新的在前
    const sortedRecords = [...records].sort((a, b) => new Date(b.time) - new Date(a.time));

    // 添加日期分界线的处理
    let previousDateStr = null;

    for (const record of sortedRecords) {
        const recordDate = new Date(record.time);
        const time = formatTimeForExport(record.time);

        // 检查日期是否变化（年月日）
        const currentDateStr = `${recordDate.getFullYear()}-${recordDate.getMonth() + 1}-${recordDate.getDate()}`;

        // 如果日期变化，添加分界线
        if (previousDateStr && previousDateStr !== currentDateStr) {
            // 使用Markdown格式添加日期分界线，并入表格中
            const formattedPreviousDate = lang === 'en' ?
                `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
                `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;

            // 添加简洁的分界线，并入表格中（9列）
            txtContent += `| ${formattedPreviousDate} |  |  |  |  |  |  |  |  |\n`;
        }

        // 更新前一个日期
        previousDateStr = currentDateStr;

        // 备注
        const noteText = record.note || '';

        // 直接使用记录中保存的绝对值（与 popup.js 保持一致）
        const bookmarkAdded = typeof record.bookmarkStats?.bookmarkAdded === 'number' ? record.bookmarkStats.bookmarkAdded : 0;
        const bookmarkDeleted = typeof record.bookmarkStats?.bookmarkDeleted === 'number' ? record.bookmarkStats.bookmarkDeleted : 0;
        const folderAdded = typeof record.bookmarkStats?.folderAdded === 'number' ? record.bookmarkStats.folderAdded : 0;
        const folderDeleted = typeof record.bookmarkStats?.folderDeleted === 'number' ? record.bookmarkStats.folderDeleted : 0;

        // 格式化书签变化
        let bookmarkChangeText = '';
        if (bookmarkAdded > 0 && bookmarkDeleted > 0) {
            bookmarkChangeText = `+${bookmarkAdded}/-${bookmarkDeleted}`;
        } else if (bookmarkAdded > 0) {
            bookmarkChangeText = `+${bookmarkAdded}`;
        } else if (bookmarkDeleted > 0) {
            bookmarkChangeText = `-${bookmarkDeleted}`;
        } else {
            const diff = record.bookmarkStats?.bookmarkDiff ?? 0;
            bookmarkChangeText = diff > 0 ? `+${diff}` : (diff < 0 ? `${diff}` : '0');
        }

        // 格式化文件夹变化
        let folderChangeText = '';
        if (folderAdded > 0 && folderDeleted > 0) {
            folderChangeText = `+${folderAdded}/-${folderDeleted}`;
        } else if (folderAdded > 0) {
            folderChangeText = `+${folderAdded}`;
        } else if (folderDeleted > 0) {
            folderChangeText = `-${folderDeleted}`;
        } else {
            const diff = record.bookmarkStats?.folderDiff ?? 0;
            folderChangeText = diff > 0 ? `+${diff}` : (diff < 0 ? `${diff}` : '0');
        }

        // 移动数量
        let movedTotal = 0;
        if (typeof record.bookmarkStats?.movedCount === 'number' && record.bookmarkStats.movedCount > 0) {
            movedTotal = record.bookmarkStats.movedCount;
        } else {
            const bookmarkMovedCount = typeof record.bookmarkStats?.bookmarkMoved === 'number'
                ? record.bookmarkStats.bookmarkMoved
                : (record.bookmarkStats?.bookmarkMoved ? 1 : 0);
            const folderMovedCount = typeof record.bookmarkStats?.folderMoved === 'number'
                ? record.bookmarkStats.folderMoved
                : (record.bookmarkStats?.folderMoved ? 1 : 0);
            movedTotal = bookmarkMovedCount + folderMovedCount;
        }
        const movedText = movedTotal > 0 ? String(movedTotal) : '-';

        // 修改数量
        let modifiedTotal = 0;
        if (typeof record.bookmarkStats?.modifiedCount === 'number' && record.bookmarkStats.modifiedCount > 0) {
            modifiedTotal = record.bookmarkStats.modifiedCount;
        } else {
            const bookmarkModifiedCount = typeof record.bookmarkStats?.bookmarkModified === 'number'
                ? record.bookmarkStats.bookmarkModified
                : (record.bookmarkStats?.bookmarkModified ? 1 : 0);
            const folderModifiedCount = typeof record.bookmarkStats?.folderModified === 'number'
                ? record.bookmarkStats.folderModified
                : (record.bookmarkStats?.folderModified ? 1 : 0);
            modifiedTotal = bookmarkModifiedCount + folderModifiedCount;
        }
        const modifiedText = modifiedTotal > 0 ? String(modifiedTotal) : '-';

        // 位置
        const recordDirection = record.direction?.toLowerCase() || 'none';
        const locationText = t.locationValues[recordDirection] || t.locationValues.none;

        // 类型
        const recordTypeKey = record.type?.toLowerCase();
        const typeText = t.typeValues[recordTypeKey] || recordTypeKey || t.na;

        // 状态
        let statusText = t.na;
        const recordStatusKey = record.status?.toLowerCase();
        if (recordStatusKey === 'success') {
            if (recordDirection === 'none' || recordTypeKey === 'check') {
                statusText = t.statusValues.check_completed || t.statusValues.no_backup_needed;
            } else {
                statusText = t.statusValues.success;
            }
        } else if (recordStatusKey === 'error') {
            statusText = record.errorMessage ? `${t.statusValues.error}: ${record.errorMessage}` : t.statusValues.error;
        } else if (t.statusValues[recordStatusKey]) {
            statusText = t.statusValues[recordStatusKey];
        } else if (record.status) {
            statusText = record.status;
        }

        txtContent += `| ${time} | ${noteText} | ${bookmarkChangeText} | ${folderChangeText} | ${movedText} | ${modifiedText} | ${locationText} | ${typeText} | ${statusText} |\n`;
    }

    // 添加最后一个日期的分界线
    if (previousDateStr) {
        const formattedPreviousDate = lang === 'en' ?
            `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
            `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;

        // 添加简洁的分界线，并入表格中（9列）
        txtContent += `| ${formattedPreviousDate} |  |  |  |  |  |  |  |  |\n`;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '_').slice(0, -4);
    const fileName = `${t.filenameBase}_${timestamp}.txt`;

    // 获取配置信息，确定导出方式
    const config = await browserAPI.storage.local.get([
        // WebDAV配置
        'serverAddress', 'username', 'password', 'webDAVEnabled',
        // 本地配置
        'defaultDownloadEnabled', 'customFolderEnabled', 'customFolderPath',
        'localBackupPath', 'localBackupEnabled', 'hideDownloadShelf'
    ]);

    // 检查WebDAV配置
    const webDAVConfigured = config.serverAddress && config.username && config.password;
    const webDAVEnabled = config.webDAVEnabled !== false;

    // 检查本地备份配置
    const defaultDownloadEnabled = config.defaultDownloadEnabled === true;
    const customFolderEnabled = config.customFolderEnabled === true && config.customFolderPath;
    const oldConfigEnabled = config.localBackupEnabled === true && config.localBackupPath;
    const localBackupConfigured = defaultDownloadEnabled || customFolderEnabled || oldConfigEnabled;

    let webDAVSuccess = false;
    let localSuccess = false;
    let exportResults = [];

    // WebDAV导出（根据语言动态选择文件夹名）
    if (webDAVConfigured && webDAVEnabled) {
        try {
            const serverAddress = config.serverAddress.replace(/\/+$/, '/');
            const archiveHistoryFolder = await getHistoryFolder();
            const exportRootFolder = await getExportRootFolder();
            const folderPath = `${exportRootFolder}/${archiveHistoryFolder}/`; // 使用统一的文件夹结构（根据语言动态选择）
            const fullUrl = `${serverAddress}${folderPath}${fileName}`;
            const folderUrl = `${serverAddress}${folderPath}`;
            const parentFolderUrl = `${serverAddress}${exportRootFolder}/`;

            const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

            // 检查并创建父文件夹（如果不存在）
            const checkParentResponse = await fetch(parentFolderUrl, {
                method: 'PROPFIND',
                headers: {
                    'Authorization': authHeader,
                    'Depth': '0',
                    'Content-Type': 'application/xml'
                },
                body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
            });

            if (checkParentResponse.status === 404) {
                // 创建父文件夹
                const mkcolParentResponse = await fetch(parentFolderUrl, {
                    method: 'MKCOL',
                    headers: { 'Authorization': authHeader }
                });
                if (!mkcolParentResponse.ok && mkcolParentResponse.status !== 405) {
                    exportResults.push(`创建父文件夹失败: ${mkcolParentResponse.status} - ${mkcolParentResponse.statusText}`);
                }
            } else if (checkParentResponse.status === 401) {
                exportResults.push('WebDAV认证失败，请检查账号密码是否正确');
            }

            // 检查子文件夹是否存在
            const checkFolderResponse = await fetch(folderUrl, {
                method: 'PROPFIND',
                headers: {
                    'Authorization': authHeader,
                    'Depth': '0',
                    'Content-Type': 'application/xml'
                },
                body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
            });

            // 处理各种可能的错误情况
            if (checkFolderResponse.status === 401) {
                exportResults.push('WebDAV认证失败，请检查账号密码是否正确');
            } else if (checkFolderResponse.status === 404) {
                const mkcolResponse = await fetch(folderUrl, {
                    method: 'MKCOL',
                    headers: {
                        'Authorization': authHeader
                    }
                });

                if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
                    exportResults.push(`创建历史记录文件夹失败: ${mkcolResponse.status} - ${mkcolResponse.statusText}`);
                }
            } else if (!checkFolderResponse.ok) {
                exportResults.push(`检查历史记录文件夹失败: ${checkFolderResponse.status} - ${checkFolderResponse.statusText}`);
            }

            // 上传TXT内容
            const response = await fetch(fullUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'text/plain;charset=utf-8',
                    'Overwrite': 'T'
                },
                body: txtContent
            });

            if (!response.ok) {
                const responseText = await response.text();
                exportResults.push(`上传历史记录到WebDAV失败: ${response.status} - ${response.statusText}`);
            } else {
                webDAVSuccess = true;
                exportResults.push(`历史记录已成功上传到WebDAV: ${fileName}`);
            }
        } catch (error) {
            exportResults.push(`WebDAV导出失败: ${error.message}`);
        }
    }

    // 本地导出 (保留原有的下载方式)
    if (localBackupConfigured || (!webDAVConfigured && !webDAVEnabled)) {
        try {
            // 制作数据URL
            const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(txtContent);

            // 尝试显示下载栏
            if (browserAPI.downloads.setShelfEnabled) {
                try {
                    await browserAPI.downloads.setShelfEnabled(true);
                } catch (shelfError) {
                }
            }

            // 确保文件夹存在（根据语言动态选择文件夹名）
            const localArchiveHistoryFolder = await getHistoryFolder();
            const exportRootFolder = await getExportRootFolder();
            const downloadId = await new Promise((resolve, reject) => {
                browserAPI.downloads.download({
                    url: dataUrl,
                    filename: `${exportRootFolder}/${localArchiveHistoryFolder}/${fileName}`,
                    saveAs: false
                }, (id) => {
                    if (browserAPI.runtime.lastError) {
                        reject(new Error(browserAPI.runtime.lastError.message));
                    } else {
                        resolve(id);
                    }
                });
            });

            localSuccess = true;
            exportResults.push(`历史记录已成功下载到本地: ${fileName}`);
        } catch (error) {
            exportResults.push(`本地下载失败: ${error.message}`);
        }
    }

    // 返回导出结果
    return {
        success: webDAVSuccess || localSuccess,
        webDAVSuccess,
        localSuccess,
        fileName,
        messages: exportResults
    };
}


// =================================================================================
// V. AUTOMATIC FUNCTIONS (自动功能)
// =================================================================================
// (Covered by updateSyncAlarm, handleBookmarkChange which calls syncBookmarks,
//  the syncBookmarks alarm listener, and initializeAutoSync, all defined above)


// =================================================================================
// VI. MANUAL FUNCTIONS (手动功能)
// =================================================================================
// (Manual sync is typically triggered via onMessage -> syncBookmarks(true, ...))


// =================================================================================
// VII. TIMER/SCHEDULED FUNCTIONS (计时功能 - Backup Reminder System)
// =================================================================================
// (Imports from backup_reminder/index.js and backup_reminder/timer.js are at the top)
// (initializeBackupReminder calls are handled in onInstalled/onStartup and globally)

// 设置闹钟监听器 (For backup_reminder/timer.js's handleAlarm)
if (browserAPI.alarms) {
    browserAPI.alarms.onAlarm.addListener(handleAlarm); // This is the imported handleAlarm
}


// =================================================================================
// VIII. CORE SYNC LOGIC (核心同步逻辑)
// =================================================================================

// 双向备份书签
async function syncBookmarks(isManual = false, direction = null, isSwitchToAutoBackup = false, autoBackupReason = null) { // 添加 autoBackupReason 参数
    console.log('[syncBookmarks] 参数:', { isManual, direction, isSwitchToAutoBackup, autoBackupReason });

    if (isSyncing) {
        return { success: false, error: '已有备份操作正在进行' };
    }

    isSyncing = true;
    try {
        // 结果对象，用于存储过程中的信息
        const result = {
            localFileName: null
        };

        // 确定要备份的方向
        let syncDirection = direction;

        // 检查云端1：WebDAV 配置
        const webDAVconfig = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']);
        const webDAVConfigured = webDAVconfig.serverAddress && webDAVconfig.username && webDAVconfig.password;
        const webDAVEnabled = webDAVconfig.webDAVEnabled !== false;

        // 检查云端2：GitHub Repository 配置
        const githubRepoConfig = await browserAPI.storage.local.get([
            'githubRepoToken',
            'githubRepoOwner',
            'githubRepoName',
            'githubRepoEnabled'
        ]);
        const githubRepoConfigured = !!(
            githubRepoConfig &&
            githubRepoConfig.githubRepoToken &&
            githubRepoConfig.githubRepoOwner &&
            githubRepoConfig.githubRepoName
        );
        const githubRepoEnabled = githubRepoConfig.githubRepoEnabled !== false;

        // 检查本地备份配置
        const localConfig = await browserAPI.storage.local.get([
            'defaultDownloadEnabled',
            'customFolderEnabled',
            'customFolderPath',
            'localBackupPath',
            'localBackupEnabled'
        ]);

        // 检查是否启用任一本地备份方式
        const defaultDownloadEnabled = localConfig.defaultDownloadEnabled === true;
        const customFolderEnabled = localConfig.customFolderEnabled === true && localConfig.customFolderPath;
        const oldConfigEnabled = localConfig.localBackupEnabled === true && localConfig.localBackupPath;

        // 检查至少有一种备份方式已配置
        const localBackupConfigured = defaultDownloadEnabled || customFolderEnabled || oldConfigEnabled;
        const hasAtLeastOneConfigured =
            (webDAVConfigured && webDAVEnabled) ||
            (githubRepoConfigured && githubRepoEnabled) ||
            localBackupConfigured;

        // 如果两种配置都未启用，则跳过备份
        if (!hasAtLeastOneConfigured) {
            return { success: false, error: '备份配置未完成或未启用' };
        }

        // 检查自动备份状态
        const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);

        // 如果是普通的自动备份请求，并且自动备份已关闭，则跳过
        // 允许 isSwitchToAutoBackup 为 true 的情况通过
        if (!isManual && !isSwitchToAutoBackup && !autoSync) {
            return { success: false, error: '自动备份已关闭' };
        }

        // 获取本地书签
        const localBookmarks = await new Promise((resolve) => {
            browserAPI.bookmarks.getTree((bookmarks) => resolve(bookmarks));
        });

        // 执行备份操作 - 修改为并行执行
        let webDAVSuccess = false;
        let githubRepoSuccess = false;
        let localSuccess = false;
        let errorMessages = [];

        // 创建并行执行任务数组
        const backupTasks = [];

        // WebDAV备份任务
        if (webDAVConfigured && webDAVEnabled) {
            const webDAVTask = (async () => {
                try {
                    // 只处理上传
                    if (direction === 'upload' || !direction) {
                        const uploadResult = await uploadBookmarks(localBookmarks);
                        if (uploadResult.success) {
                            webDAVSuccess = true;
                            return { success: true };
                        } else if (uploadResult.webDAVNotConfigured) {
                            return { success: false, error: 'WebDAV未配置' };
                        } else {
                            return { success: false, error: uploadResult.error || 'WebDAV上传失败' };
                        }
                    }
                    return { success: true };
                } catch (error) {
                    return { success: false, error: `WebDAV备份失败: ${error.message}` };
                }
            })();
            backupTasks.push(webDAVTask);
        }

        // GitHub 仓库 备份任务
        if (githubRepoConfigured && githubRepoEnabled) {
            const githubRepoTask = (async () => {
                try {
                    // 只处理上传
                    if (direction === 'upload' || !direction) {
                        const uploadResult = await uploadBookmarksToGitHubRepo(localBookmarks);
                        if (uploadResult && uploadResult.success) {
                            githubRepoSuccess = true;
                            return { success: true };
                        } else if (uploadResult && uploadResult.repoNotConfigured) {
                            return { success: false, error: 'GitHub 仓库未配置' };
                        } else if (uploadResult && uploadResult.repoDisabled) {
                            return { success: false, error: 'GitHub 仓库已禁用' };
                        } else {
                            return { success: false, error: uploadResult?.error || 'GitHub 仓库上传失败' };
                        }
                    }
                    return { success: true };
                } catch (error) {
                    return { success: false, error: `GitHub 仓库备份失败: ${error.message}` };
                }
            })();
            backupTasks.push(githubRepoTask);
        }

        // 本地备份任务
        if (localBackupConfigured) {
            const localTask = (async () => {
                try {
                    const localResult = await uploadBookmarksToLocal(localBookmarks);
                    localSuccess = true;
                    // 记录文件名信息
                    result.localFileName = localResult.fileName;
                    return { success: true, fileName: localResult.fileName };
                } catch (error) {
                    return { success: false, error: `本地备份失败: ${error.message}` };
                }
            })();
            backupTasks.push(localTask);
        }

        // 等待所有备份任务完成
        const backupResults = await Promise.all(backupTasks);

        // 处理任务结果
        backupResults.forEach(taskResult => {
            if (!taskResult.success && taskResult.error) {
                errorMessages.push(taskResult.error);
            }
        });

        // 确定备份状态
        const syncTime = new Date().toISOString();
        let syncStatus = 'error';
        // 修改: 统一使用 'switch' 而不是 'auto_switch'
        let syncType = isManual ? 'manual' : (isSwitchToAutoBackup ? 'switch' : 'auto');
        let errorMessage = errorMessages.join('; ');
        let syncSuccess = false; // 用于判断是否清除标志

        if (webDAVSuccess || githubRepoSuccess || localSuccess) { // 只要有一个成功就算成功
            syncStatus = 'success';
            syncSuccess = true;
            if (localSuccess && webDAVSuccess && githubRepoSuccess) {
                syncDirection = 'cloud_local';
            } else if (localSuccess && webDAVSuccess) {
                syncDirection = 'webdav_local';
            } else if (localSuccess && githubRepoSuccess) {
                syncDirection = 'github_repo_local';
            } else if (localSuccess) {
                syncDirection = 'local';
            } else if (webDAVSuccess && githubRepoSuccess) {
                syncDirection = 'cloud';
            } else if (webDAVSuccess) {
                syncDirection = 'webdav';
            } else if (githubRepoSuccess) {
                syncDirection = 'github_repo';
            } else {
                syncDirection = 'none';
            }
        }

        // 更新备份状态
        await updateSyncStatus(syncDirection, syncTime, syncStatus, errorMessage, syncType, autoBackupReason);

        // 如果备份成功，并且是手动备份或切换到自动模式触发的备份，则清除活动标志
        if (syncSuccess && (isManual || isSwitchToAutoBackup)) {
            try {
                await browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck');
            } catch (clearError) {
            }
        }

        // 备份成功后，更新角标和缓存
        if (syncSuccess) {
            try {
                // 更新缓存分析数据
                await updateAndCacheAnalysis();
                // 更新角标
                await setBadge();
                // 清理移动和修改历史，避免备份后仍然出现蓝色移动标识或错误的数量统计
                try {
                    await browserAPI.storage.local.set({ recentMovedIds: [], recentModifiedIds: [] });
                } catch (_) { }
                try {
                    browserAPI.runtime.sendMessage({ action: 'clearExplicitMoved' });
                } catch (_) { }
            } catch (updateError) {
                console.error('[syncBookmarks] 更新角标和缓存失败:', updateError);
            }
        }

        return {
            success: syncSuccess,
            webDAVSuccess,
            githubRepoSuccess,
            localSuccess,
            localFileName: result && result.localFileName, // 添加文件名
            error: errorMessages.length > 0 ? errorMessages.join('; ') : null
            // Original did not explicitly return direction and time here, they were part of updateSyncStatus
        };
    } catch (error) {
        return { success: false, error: error.message || '备份失败' };
    } finally {
        isSyncing = false;
    }
}


// =================================================================================
// IX. OTHER FUNCTIONS / UTILITIES (其他功能 / 工具函数)
// =================================================================================

// 添加安全的Base64编码函数，处理包含Unicode字符的字符串
function safeBase64(str) {
    try {
        return btoa(str);
    } catch (e) {
        // 如果直接btoa失败，使用UTF-8安全的方式
        return btoa(unescape(encodeURIComponent(str)));
    }
}

// 以下是简化版的searchBookmarks函数，只返回"功能已被移除"的消息
async function searchBookmarks(query) {
    return { success: false, error: '搜索功能已被移除' };
}

// 添加重置所有数据的函数
// 简化版：清除所有持久化存储 + chrome.runtime.reload()
async function resetAllData() {
    try {
        console.log('[resetAllData] 开始完全重置扩展...');

        // 1. 关闭所有扩展页面，释放 IndexedDB 连接
        try {
            const extensionOrigin = browserAPI.runtime.getURL('');
            const allTabs = await browserAPI.tabs.query({});
            for (const tab of allTabs) {
                if (tab.url && tab.url.startsWith(extensionOrigin) && !tab.url.includes('popup.html')) {
                    await browserAPI.tabs.remove(tab.id).catch(() => { });
                }
            }
        } catch (e) { /* 忽略 */ }

        // 2. 删除 IndexedDB 数据库
        ['BookmarkFaviconCache', 'BookmarkActiveTimeDB'].forEach(dbName => {
            try { indexedDB.deleteDatabase(dbName); } catch (e) { /* 忽略 */ }
        });

        // 3. 清除 chrome.storage.local
        await browserAPI.storage.local.clear();

        // 4. 设置标志让将来打开的页面清除 localStorage
        await browserAPI.storage.local.set({ needClearLocalStorage: true });

        // 5. 清除所有闹钟
        await browserAPI.alarms.clearAll();

        console.log('[resetAllData] 存储已清除，重新加载扩展...');

        // 6. 重新加载扩展（这会自动重置所有内存变量）
        setTimeout(() => { browserAPI.runtime.reload(); }, 200);

        return true;
    } catch (error) {
        console.error('[resetAllData] 重置失败:', error);
        throw error;
    }
}

// 将书签数据转换为Edge格式的HTML
function convertToEdgeHTML(bookmarks) {
    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>`;

    function processBookmarks(bookmarks, level = 0) { // This was the original inner function name
        bookmarks.forEach(bookmark => {
            if (bookmark.children) {
                // 这是一个文件夹
                html += `${'    '.repeat(level)}<DT><H3>${bookmark.title}</H3>\n`;
                html += `${'    '.repeat(level)}<DL><p>\n`;
                processBookmarks(bookmark.children, level + 1);
                html += `${'    '.repeat(level)}</DL><p>\n`;
            } else {
                // 这是一个书签
                html += `${'    '.repeat(level)}<DT><A HREF="${bookmark.url}">${bookmark.title}</A>\n`;
            }
        });
    }

    processBookmarks(bookmarks); // Original called with the direct bookmarks argument
    html += '</DL><p>';
    return html;
}


// 解析Edge格式的书签HTML
function parseEdgeBookmarks(doc) {
    // 功能已移除
    return [];
}

// 更新本地书签
async function updateLocalBookmarks(newBookmarks) {
    // 功能已移除
    return;
}

// 获取浏览器信息
function getBrowserInfo() {
    const userAgent = navigator.userAgent;
    let browserName = "unknown";
    let browserVersion = "unknown";

    if (userAgent.includes("Edge")) {
        browserName = "Edge";
        browserVersion = userAgent.match(/Edge\/(\d+)/)?.[1] ||
            userAgent.match(/Edg\/(\d+)/)?.[1];
    } else if (userAgent.includes("Chrome")) {
        browserName = "Chrome";
        browserVersion = userAgent.match(/Chrome\/(\d+)/)?.[1];
    } else if (userAgent.includes("Firefox")) {
        browserName = "Firefox";
        browserVersion = userAgent.match(/Firefox\/(\d+)/)?.[1];
    }

    return {
        name: browserName,
        version: browserVersion,
        userAgent: userAgent
    };
}

// (Helper for updateBookmarksFromNutstore, should be identical to original)
async function updateBookmarks(bookmarksData) {
    // TODO: 实现书签更新逻辑
}

// 更新备份状态的辅助函数
async function updateSyncStatus(direction, time, status = 'success', errorMessage = '', syncType = 'auto', autoBackupReason = null) {
    // <--- Log 11
    console.log('[updateSyncStatus] 参数:', { direction, time, status, errorMessage, syncType, autoBackupReason });

    try {
        const { syncHistory = [], lastBookmarkData = null, lastSyncOperations = {}, preferredLang = 'zh_CN', recentMovedIds = [], recentModifiedIds = [], recentAddedIds = [] } = await browserAPI.storage.local.get([
            'syncHistory',
            'lastBookmarkData',
            'lastSyncOperations',
            'preferredLang',
            'recentMovedIds',
            'recentModifiedIds',
            'recentAddedIds'
        ]);

        // 计算移动、修改、新增的数量（优先使用“与上次备份对比”的净变化；否则回退到 recentXxxIds）
        let movedCount = Array.isArray(recentMovedIds) ? recentMovedIds.length : 0;
        let modifiedCount = Array.isArray(recentModifiedIds) ? recentModifiedIds.length : 0;
        let addedCount = Array.isArray(recentAddedIds) ? recentAddedIds.length : 0;
        let deletedCount = 0;
        let bookmarkAdded = 0;
        let bookmarkDeleted = 0;
        let folderAdded = 0;
        let folderDeleted = 0;
        let movedBookmarkCount = 0;
        let movedFolderCount = 0;
        let modifiedBookmarkCount = 0;
        let modifiedFolderCount = 0;
        let explicitMovedIdListForRecord = [];


        // 计算书签操作统计
        let bookmarkStats = null;
        let bookmarkDiff = 0; // 初始化 diff 变量
        let folderDiff = 0;
        let localBookmarks = null; // 声明在外部作用域，以便在 newSyncRecord 中使用

        if (status === 'success' && (direction === 'upload' || direction === 'download' || direction === 'webdav' || direction === 'github_repo' || direction === 'gist' || direction === 'cloud' || direction === 'webdav_local' || direction === 'github_repo_local' || direction === 'gist_local' || direction === 'cloud_local' || direction === 'local' || direction === 'both')) {
            localBookmarks = await new Promise((resolve) => {
                browserAPI.bookmarks.getTree((bookmarks) => resolve(bookmarks));
            });

            const prevBookmarkCount = lastBookmarkData ? lastBookmarkData.bookmarkCount : 0;
            const prevFolderCount = lastBookmarkData ? lastBookmarkData.folderCount : 0;

            const currentBookmarkCount = countAllBookmarks(localBookmarks);
            const currentFolderCount = countAllFolders(localBookmarks);

            bookmarkDiff = currentBookmarkCount - prevBookmarkCount;
            folderDiff = currentFolderCount - prevFolderCount;

            // 如果是第一次备份（没有历史数据），不显示差异，保持为0
            if (!lastBookmarkData || (!lastBookmarkData.bookmarkCount && !lastBookmarkData.folderCount)) {
                bookmarkDiff = 0;
                folderDiff = 0;
            }

            // 计算净变化（与上次备份的 bookmarkTree 对比）：
            // - 支持“+/-同时存在但净差为0”的显示
            // - 支持“移动/修改后又改回去”自动归零
            try {
                if (lastBookmarkData && lastBookmarkData.bookmarkTree) {
                    const explicitMovedIdSet = new Set(
                        (Array.isArray(recentMovedIds) ? recentMovedIds : [])
                            .map(r => r && r.id)
                            .filter(Boolean)
                    );
                    const diffSummary = computeBookmarkGitDiffSummary(lastBookmarkData.bookmarkTree, localBookmarks, {
                        explicitMovedIds: explicitMovedIdSet
                    });

                    bookmarkAdded = diffSummary.bookmarkAdded;
                    bookmarkDeleted = diffSummary.bookmarkDeleted;
                    folderAdded = diffSummary.folderAdded;
                    folderDeleted = diffSummary.folderDeleted;
                    movedBookmarkCount = diffSummary.movedBookmarkCount;
                    movedFolderCount = diffSummary.movedFolderCount;
                    modifiedBookmarkCount = diffSummary.modifiedBookmarkCount;
                    modifiedFolderCount = diffSummary.modifiedFolderCount;

                    movedCount = diffSummary.movedCount;
                    modifiedCount = diffSummary.modifiedCount;
                    addedCount = diffSummary.bookmarkAdded + diffSummary.folderAdded;
                    deletedCount = diffSummary.bookmarkDeleted + diffSummary.folderDeleted;

                    // 保存“显式移动ID”（用于备份历史复现同级移动蓝标：只标记被拖动对象）
                    // 说明：
                    // - recentMovedIds 可能包含“移动后又移回去”的操作，这里按净变化过滤
                    // - 仅保存数量受控的 ID 列表，避免记录过大
                    try {
                        if (explicitMovedIdSet.size > 0) {
                            const oldIndex = buildTreeIndexForDiff(lastBookmarkData.bookmarkTree);
                            const newIndex = buildTreeIndexForDiff(localBookmarks);

                            const commonPosCache = new Map(); // parentId -> { oldPosById, newPosById }
                            const getCommonPositions = (parentId) => {
                                if (commonPosCache.has(parentId)) return commonPosCache.get(parentId);

                                const oldList = oldIndex.byParent.get(parentId) || [];
                                const newList = newIndex.byParent.get(parentId) || [];
                                const newIdSet = new Set(newList.map(x => x.id));

                                const oldPosById = new Map();
                                let oldPos = 0;
                                for (const item of oldList) {
                                    if (newIdSet.has(item.id)) oldPosById.set(item.id, oldPos++);
                                }

                                const newPosById = new Map();
                                let newPos = 0;
                                for (const item of newList) {
                                    if (oldPosById.has(item.id)) newPosById.set(item.id, newPos++);
                                }

                                const entry = { oldPosById, newPosById };
                                commonPosCache.set(parentId, entry);
                                return entry;
                            };

                            for (const rawId of explicitMovedIdSet) {
                                const id = String(rawId);
                                const o = oldIndex.nodes.get(id);
                                const n = newIndex.nodes.get(id);
                                if (!o || !n) continue;
                                if (!o.parentId || !n.parentId) continue;

                                // 跨级移动：直接记录
                                if (o.parentId !== n.parentId) {
                                    explicitMovedIdListForRecord.push(id);
                                    continue;
                                }

                                // 同级移动：按 common ids 的相对位置判断（可抵消 add/delete 导致的 index 假象）
                                const parentId = n.parentId;
                                const { oldPosById, newPosById } = getCommonPositions(parentId);
                                const oldPos = oldPosById.get(id);
                                const newPos = newPosById.get(id);
                                if (typeof oldPos === 'number' && typeof newPos === 'number' && oldPos !== newPos) {
                                    explicitMovedIdListForRecord.push(id);
                                }
                            }

                            explicitMovedIdListForRecord = Array.from(new Set(explicitMovedIdListForRecord));
                            const MAX_EXPLICIT_MOVED_IDS = 2000;
                            if (explicitMovedIdListForRecord.length > MAX_EXPLICIT_MOVED_IDS) {
                                explicitMovedIdListForRecord = explicitMovedIdListForRecord.slice(0, MAX_EXPLICIT_MOVED_IDS);
                            }
                        }
                    } catch (e) {
                        console.warn('[updateSyncStatus] 计算显式移动ID列表失败:', e);
                    }
                }
            } catch (e) {
                console.warn('[updateSyncStatus] 计算净变化失败，回退到 recentXxxIds:', e);
            }

            bookmarkStats = {
                currentBookmarkCount: currentBookmarkCount,
                currentFolderCount: currentFolderCount,
                prevBookmarkCount: prevBookmarkCount,
                prevFolderCount: prevFolderCount,
                bookmarkDiff: bookmarkDiff,
                folderDiff: folderDiff,
                // 保存净变化：新增/删除（用于“+/-同时存在但净差为0”的情况）
                bookmarkAdded: bookmarkAdded,
                bookmarkDeleted: bookmarkDeleted,
                folderAdded: folderAdded,
                folderDeleted: folderDeleted,
                // 备份历史复现用：显式移动 ID（只用于 UI 打标，不参与计数计算）
                explicitMovedIds: explicitMovedIdListForRecord,

                // 结构变化（优先用净变化；回退到操作标记）
                bookmarkMoved: (movedBookmarkCount > 0) || lastSyncOperations.bookmarkMoved || bookmarkMoved,
                folderMoved: (movedFolderCount > 0) || lastSyncOperations.folderMoved || folderMoved,
                bookmarkModified: (modifiedBookmarkCount > 0) || lastSyncOperations.bookmarkModified || bookmarkModified,
                folderModified: (modifiedFolderCount > 0) || lastSyncOperations.folderModified || folderModified,

                // 保存移动、修改、新增、删除的具体数量（书签Git风格）
                movedCount: movedCount,
                modifiedCount: modifiedCount,
                addedCount: addedCount,
                deletedCount: deletedCount,

                // 细分统计（可用于UI显示更精确的数字）
                movedBookmarkCount: movedBookmarkCount,
                movedFolderCount: movedFolderCount,
                modifiedBookmarkCount: modifiedBookmarkCount,
                modifiedFolderCount: modifiedFolderCount
            };



            // 生成当前书签指纹（使用已经声明的 localBookmarks 变量）
            const currentPrints = generateFingerprints(localBookmarks);

            await browserAPI.storage.local.set({
                lastBookmarkData: {
                    bookmarkCount: currentBookmarkCount,
                    folderCount: currentFolderCount,
                    bookmarkPrints: currentPrints.bookmarks,
                    folderPrints: currentPrints.folders,
                    bookmarkTree: localBookmarks,  // 保存完整的书签树，用于生成 Git diff
                    timestamp: time
                }
            });

            resetOperationStatus();

            // 备份成功后，差异应该重置为 0（因为 lastBookmarkData 已经更新为当前值）
            bookmarkDiff = 0;
            folderDiff = 0;
        }

        // 只为成功的备份保存 bookmarkTree（用于生成历史详情）
        const shouldSaveTree = status === 'success';

        // Generate a simple commit fingerprint (deterministic per record content)
        const fingerprint = (() => {
            try {
                const payload = JSON.stringify({
                    time,
                    direction,
                    status,
                    syncType,
                    errorMessage: errorMessage || '',
                    stats: bookmarkStats || null
                });
                // Simple non-crypto hash
                let h = 2166136261 >>> 0;
                for (let i = 0; i < payload.length; i++) {
                    h ^= payload.charCodeAt(i);
                    h = Math.imul(h, 16777619) >>> 0;
                }
                // Return short hex
                return ('00000000' + h.toString(16)).slice(-8);
            } catch (_) { return (Date.now() % 0xffffffff).toString(16); }
        })();

        // 生成默认备注（区分中英文）
        let defaultNote = '';
        try {
            if (preferredLang === 'en') {
                defaultNote = (syncType === 'switch') ? 'Switch Backup'
                    : (syncType === 'manual') ? 'Manual Backup'
                        : 'Auto Backup';
            } else {
                defaultNote = (syncType === 'switch') ? '切换备份'
                    : (syncType === 'manual') ? '手动备份'
                        : '自动备份';
            }
        } catch (_) { }

        // 计算永久序号：取历史中最大序号 + 1，没有历史则从 1 开始
        // 这样部分删除后序号不会重置，只有全部清除时才重置
        let nextSeqNumber = 1;
        if (syncHistory && syncHistory.length > 0) {
            // 找到历史中最大的序号
            const maxSeq = syncHistory.reduce((max, record) => {
                const seq = record.seqNumber || 0;
                return seq > max ? seq : max;
            }, 0);
            nextSeqNumber = maxSeq + 1;
        }

        const newSyncRecord = {
            time: time,
            seqNumber: nextSeqNumber, // 永久序号，部分删除后不会重置
            direction: direction,
            type: syncType, // 存储键值: 'auto', 'manual', 'auto_switch'
            status: status,
            errorMessage: errorMessage,
            bookmarkStats: bookmarkStats,
            // 仅在“真正的首次备份（没有任何历史 + 没有基准快照）”时标记为首次备份；
            // 这样用户清空备份历史后，再次备份不会被误判为“首次备份”
            isFirstBackup: (!syncHistory || syncHistory.length === 0) && (!lastBookmarkData || !lastBookmarkData.bookmarkTree),
            // 如果有 autoBackupReason 则附加，否则使用默认备注（中英文）
            note: (autoBackupReason && typeof autoBackupReason === 'string' && autoBackupReason.trim())
                ? `${defaultNote}${preferredLang === 'en' ? ' - ' : ' - '}${autoBackupReason.trim()}`
                : defaultNote,
            bookmarkTree: shouldSaveTree ? localBookmarks : null, // 只保存最近10条的书签树
            fingerprint: fingerprint
        };

        let currentSyncHistory = [...syncHistory, newSyncRecord];

        // 已移除：书签树20条限制清理（现在所有记录都保留完整的书签树数据）
        // 已移除：100条记录自动导出并清理前50条的功能（用户可手动管理历史记录）

        let historyToStore = currentSyncHistory;

        const updateData = {
            lastSyncTime: time,
            lastSyncDirection: status === 'success' ? direction : status,
            syncHistory: historyToStore,
            lastCalculatedDiff: {
                bookmarkDiff: bookmarkDiff,
                folderDiff: folderDiff,
                timestamp: time
            }
        };

        if (status === 'success' &&
            (direction === 'upload' || direction === 'webdav' || direction === 'github_repo' || direction === 'gist' || direction === 'cloud' || direction === 'webdav_local' || direction === 'github_repo_local' || direction === 'gist_local' || direction === 'cloud_local' || direction === 'local' || direction === 'both')) {
            updateData.lastBookmarkUpdate = time;
        }

        await browserAPI.storage.local.set(updateData);

        const isInitSync = (!syncHistory || syncHistory.length === 0) && newSyncRecord.isFirstBackup; // More precise check for initial sync completion effect
        if (isInitSync && status === 'success' && (direction === 'upload' || direction === 'webdav' || direction === 'github_repo' || direction === 'gist' || direction === 'cloud' || direction === 'webdav_local' || direction === 'github_repo_local' || direction === 'gist_local' || direction === 'cloud_local' || direction === 'local' || direction === 'both')) {
            await browserAPI.storage.local.set({ isInitialized: true });

            await browserAPI.storage.local.set({
                lastSyncOperations: {
                    bookmarkMoved: false,
                    folderMoved: false,
                    bookmarkModified: false,
                    folderModified: false,
                    lastUpdateTime: new Date().toISOString()
                }
            });

            await setBadge();
        }

    } catch (error) {
        throw error;
    }
}

// --- Bookmark Counting/Diffing Helpers (Original Versions) ---
// 获取所有书签的辅助函数
function getAllBookmarks(bookmarks) {
    const result = [];
    function traverse(node) {
        if (node.url) {
            result.push({
                id: node.id,
                url: node.url,
                title: node.title,
                parentId: node.parentId
            });
        }
        if (node.children) {
            node.children.forEach(traverse);
        }
    }
    traverse(bookmarks[0]);
    return result;
}

function countRemovedBookmarks(current, previous) {
    const currentUrls = new Set(getAllUrls(current));
    const previousUrls = new Set(getAllUrls(previous));
    let count = 0;
    for (const url of previousUrls) {
        if (!currentUrls.has(url)) {
            count++;
        }
    }
    return count;
}

// 优化文件夹计数函数 (Original name, original logic)
function countFolderChanges(current, previous) {
    const currentFolders = new Set(getAllFolders(current));
    const previousFolders = new Set(getAllFolders(previous));

    // 计算新增的文件夹
    let added = 0;
    for (const folder of currentFolders) {
        if (!previousFolders.has(folder)) {
            added++;
        }
    }

    // 计算删除的文件夹
    let removed = 0;
    for (const folder of previousFolders) {
        if (!currentFolders.has(folder)) {
            removed++;
        }
    }

    return { added, removed };
}

// 获取所有文件夹的辅助函数
function getAllFolders(bookmarks) {
    const folders = [];
    function traverse(node, currentPath = '') {
        if (node.children && !node.url) {
            // 使用完整路径作为文件夹标识
            const path = currentPath ? `${currentPath}/${node.title}` : node.title;
            folders.push(path);
            node.children.forEach(child => traverse(child, path));
        }
    }
    traverse(bookmarks[0]);
    return folders;
}

function getAllUrls(bookmarks) {
    const urls = [];
    function traverse(node) {
        if (node.url) {
            urls.push(node.url);
        }
        if (node.children) {
            node.children.forEach(traverse);
        }
    }
    traverse(bookmarks[0]);
    return urls;
}

// 获取所有文件夹节点的辅助函数
function getAllFolderNodes(bookmarks) {
    let allFolders = [];

    function traverse(node) {
        // 如果节点没有URL属性但有children属性，则认为是文件夹
        if (!node.url && node.children) {
            // 排除根文件夹（通常ID为0或1）
            if (node.id !== '0' && node.id !== '1') {
                allFolders.push(node);
            }
        }

        if (node.children) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }

    for (const bookmark of bookmarks) {
        traverse(bookmark);
    }

    return allFolders;
}

// 计算所有书签总数的函数
function countAllBookmarks(bookmarks) {
    let count = 0;
    function traverse(node) {
        if (node.url) {
            count++;
        }
        if (node.children) {
            node.children.forEach(traverse);
        }
    }
    if (bookmarks && bookmarks.length > 0) {
        bookmarks.forEach(traverse);
    }
    // 需要从总数中减去节点本身（如果根节点被计入），但这取决于 traverse 的起始点
    // 假设 traverse 从 root 开始，根节点本身不是书签，所以不需要调整
    return count;
}

// 计算所有用户创建的文件夹的总数 (修正) (Original name, original logic)
function countAllFolders(bookmarks) {
    let folderCount = 0;

    function traverse(node) {
        // 检查当前节点是否是文件夹
        if (node.children && !node.url) {
            folderCount++; // 计算此文件夹
            // 递归进入子节点
            node.children.forEach(traverse);
        }
        // 书签节点 (node.url) 直接忽略
    }

    // 从根节点 ('0') 的子节点开始遍历 ('1', '2', '3'等)
    if (bookmarks && bookmarks.length > 0 && bookmarks[0].children) {
        bookmarks[0].children.forEach(traverse);
    }
    return folderCount;
}

// --- Badge Related Functions ---
// 模块级变量：追踪自动备份定时器状态（避免race condition）
let autoBackupTimerRunning = false;

// 修改 setBadge 函数
async function setBadge() { // 不再接收 status 参数
    try {
        // 首先获取当前模式
        const { autoSync } = await browserAPI.storage.local.get({ autoSync: true });

        let badgeText = '';
        let badgeColor = '';
        let hasChanges = false;

        if (autoSync) {
            // 自动备份模式
            const { preferredLang = 'zh_CN', autoBackupTimerSettings } = await browserAPI.storage.local.get([
                'preferredLang',
                'autoBackupTimerSettings'
            ]);
            badgeText = badgeTextMap['auto'][preferredLang] || '自';

            // 获取备份模式
            const backupMode = autoBackupTimerSettings?.backupMode || 'regular';

            if (backupMode === 'realtime') {
                // 实时备份：绿色角标（会在备份时闪烁）
                badgeColor = '#00FF00'; // 亮绿色
            } else {
                // 常规时间/特定时间：检查是否有变化
                const stats = await getBackupStatsInternal();

                if (stats && stats.success && stats.stats) {
                    // 任何数量或结构的变化都算作变化
                    if (
                        stats.stats.bookmarkDiff !== 0 ||
                        stats.stats.folderDiff !== 0 ||
                        (typeof stats.stats.bookmarkAdded === 'number' && stats.stats.bookmarkAdded > 0) ||
                        (typeof stats.stats.bookmarkDeleted === 'number' && stats.stats.bookmarkDeleted > 0) ||
                        (typeof stats.stats.folderAdded === 'number' && stats.stats.folderAdded > 0) ||
                        (typeof stats.stats.folderDeleted === 'number' && stats.stats.folderDeleted > 0) ||
                        (typeof stats.stats.movedCount === 'number' && stats.stats.movedCount > 0) ||
                        (typeof stats.stats.modifiedCount === 'number' && stats.stats.modifiedCount > 0) ||
                        stats.stats.bookmarkMoved ||
                        stats.stats.bookmarkModified ||
                        stats.stats.folderMoved ||
                        stats.stats.folderModified
                    ) {
                        hasChanges = true;
                    }
                }

                if (hasChanges) {
                    badgeColor = '#FFFF00'; // 黄色，表示有变动

                    // 检查定时器是否真的在运行（通过检查alarm是否存在）
                    const alarms = await browserAPI.alarms.getAll();
                    const hasAlarm = alarms.some(alarm =>
                        alarm.name.startsWith('autoBackup_')
                    );

                    // 有变化但定时器未运行：启动自动备份定时器
                    if (!hasAlarm) {
                        console.log('[自动备份定时器] 角标变黄（检测到变化），启动定时器');
                        try {
                            // 设置回调函数
                            setAutoBackupCallbacks(
                                checkBookmarkChangesForAutoBackup,
                                syncBookmarks
                            );
                            // 使用 'auto' 模式：根据时间间隔自动判断是否检查遗漏
                            // 这样可以处理休眠恢复的情况（距离上次检查超过10分钟则检查）
                            await initializeAutoBackupTimerSystem('auto');
                            autoBackupTimerRunning = true; // 标记为运行中
                        } catch (timerError) {
                            console.error('[自动备份定时器] 启动失败:', timerError);
                            autoBackupTimerRunning = false;
                        }
                    } else if (!autoBackupTimerRunning) {
                        // alarm存在但标志为false，说明浏览器重启后alarm持久化了
                        console.log('[自动备份定时器] 检测到持久化的alarm，更新运行标志');
                        autoBackupTimerRunning = true;
                    }
                } else {
                    badgeColor = '#00FF00'; // 绿色，表示无变动

                    // 检查是否有alarm在运行
                    const alarms = await browserAPI.alarms.getAll();
                    const hasAlarm = alarms.some(alarm =>
                        alarm.name.startsWith('autoBackup_')
                    );

                    // 无变化但定时器仍在运行：停止自动备份定时器
                    if (hasAlarm) {
                        console.log('[自动备份定时器] 角标变绿（无变化），停止定时器');
                        try {
                            await stopAutoBackupTimerSystem();
                            autoBackupTimerRunning = false; // 标记为已停止
                        } catch (timerError) {
                            console.error('[自动备份定时器] 停止失败:', timerError);
                        }
                    } else if (autoBackupTimerRunning) {
                        // 没有alarm但标志为true，说明定时器已被清除但标志未更新
                        console.log('[自动备份定时器] 检测到定时器已停止，更新运行标志');
                        autoBackupTimerRunning = false;
                    }
                }
            }
        } else {
            // 手动模式
            const { preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);
            badgeText = badgeTextMap['manual'][preferredLang] || '手';

            // 在手动模式下，检查是否有变化
            const stats = await getBackupStatsInternal();

            if (stats) {
                // 任何数量或结构的变化都算作变化
                if (
                    stats.stats.bookmarkDiff !== 0 ||
                    stats.stats.folderDiff !== 0 ||
                    (typeof stats.stats.bookmarkAdded === 'number' && stats.stats.bookmarkAdded > 0) ||
                    (typeof stats.stats.bookmarkDeleted === 'number' && stats.stats.bookmarkDeleted > 0) ||
                    (typeof stats.stats.folderAdded === 'number' && stats.stats.folderAdded > 0) ||
                    (typeof stats.stats.folderDeleted === 'number' && stats.stats.folderDeleted > 0) ||
                    (typeof stats.stats.movedCount === 'number' && stats.stats.movedCount > 0) ||
                    (typeof stats.stats.modifiedCount === 'number' && stats.stats.modifiedCount > 0) ||
                    stats.stats.bookmarkMoved ||
                    stats.stats.bookmarkModified ||
                    stats.stats.folderMoved ||
                    stats.stats.folderModified
                ) {
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                badgeColor = '#FFFF00'; // 黄色，表示有变动
                await browserAPI.storage.local.set({ isYellowHandActive: true });
                // --- 新增逻辑 ---
                await startLoopReminder();
                // --- 结束 ---
            } else {
                badgeColor = '#0000FF'; // 蓝色，表示无变动
                await browserAPI.storage.local.set({ isYellowHandActive: false });
                // --- 新增逻辑 ---
                await stopLoopReminder();
                // --- 结束 ---
            }
        }

        await browserAPI.action.setBadgeText({ text: badgeText });
        await browserAPI.action.setBadgeBackgroundColor({ color: badgeColor });

    } catch (error) {
        await browserAPI.action.setBadgeText({ text: '!' });
        await browserAPI.action.setBadgeBackgroundColor({ color: '#FF0000' }); // 红色表示错误
        await browserAPI.storage.local.set({ isYellowHandActive: false });
    }
}

// 修改闪烁角标函数，传入语言参数
async function flashBadge(preferredLang = 'zh_CN') {
    try {
        // 保存当前状态
        const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
        if (!autoSync) return; // 只在自动备份模式下闪烁

        // 按照绿-蓝-绿-蓝-绿的顺序闪烁两次
        // 第一次：绿到蓝
        await browserAPI.action.setBadgeBackgroundColor({ color: '#0000FF' }); // 蓝色
        await browserAPI.action.setBadgeText({ text: badgeTextMap['auto'][preferredLang] || '自' });

        // 第一次：蓝到绿
        setTimeout(async () => {
            await browserAPI.action.setBadgeBackgroundColor({ color: '#00FF00' }); // 绿色
            await browserAPI.action.setBadgeText({ text: badgeTextMap['auto'][preferredLang] || '自' });

            // 第二次：绿到蓝
            setTimeout(async () => {
                await browserAPI.action.setBadgeBackgroundColor({ color: '#0000FF' }); // 蓝色
                await browserAPI.action.setBadgeText({ text: badgeTextMap['auto'][preferredLang] || '自' });

                // 第二次：蓝到绿
                setTimeout(async () => {
                    await browserAPI.action.setBadgeBackgroundColor({ color: '#00FF00' }); // 绿色
                    await browserAPI.action.setBadgeText({ text: badgeTextMap['auto'][preferredLang] || '自' });

                    // 确保最终回到亮绿色状态
                    setTimeout(async () => {
                        if (autoSync) { // 再次检查是否仍在自动模式
                            const { preferredLang: currentLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);
                            await browserAPI.action.setBadgeBackgroundColor({ color: '#00FF00' }); // 亮绿色
                            await browserAPI.action.setBadgeText({ text: badgeTextMap['auto'][currentLang] || '自' });
                        }
                    }, 500); // 延迟500毫秒确保最终状态正确
                }, 250);
            }, 250);
        }, 250);
    } catch (error) {
        // 出错时也尝试恢复到亮绿色
        try {
            const { autoSync = true } = await browserAPI.storage.local.get(['autoSync']);
            if (autoSync) {
                const { preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);
                await browserAPI.action.setBadgeBackgroundColor({ color: '#00FF00' }); // 亮绿色
                await browserAPI.action.setBadgeText({ text: badgeTextMap['auto'][preferredLang] || '自' });
            }
        } catch (recoveryError) {
        }
    }
}

// 在备份状态变化时更新角标
async function updateBadgeAfterSync(success) {
    if (!success) {
        // 设置错误角标
        try {
            // 获取当前语言
            const { preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);
            await browserAPI.action.setBadgeBackgroundColor({ color: '#FF0000' }); // Red
            await browserAPI.action.setBadgeText({ text: badgeTextMap['error'][preferredLang] || '!' });
        } catch (badgeError) {
        }
    } else {
        // 备份成功，检查是否有变化
        try {
            const stats = await getBackupStatsInternal(); // 获取最新统计信息
            const hasChanges = (
                (stats.stats.bookmarkDiff !== 0) ||
                (stats.stats.folderDiff !== 0) ||
                (typeof stats.stats.bookmarkAdded === 'number' && stats.stats.bookmarkAdded > 0) ||
                (typeof stats.stats.bookmarkDeleted === 'number' && stats.stats.bookmarkDeleted > 0) ||
                (typeof stats.stats.folderAdded === 'number' && stats.stats.folderAdded > 0) ||
                (typeof stats.stats.folderDeleted === 'number' && stats.stats.folderDeleted > 0) ||
                (typeof stats.stats.movedCount === 'number' && stats.stats.movedCount > 0) ||
                (typeof stats.stats.modifiedCount === 'number' && stats.stats.modifiedCount > 0) ||
                stats.stats.bookmarkMoved ||
                stats.stats.folderMoved ||
                stats.stats.bookmarkModified ||
                stats.stats.folderModified
            );

            if (hasChanges) {
                // 有变化，执行闪烁
                // 获取当前语言传入flashBadge
                const { preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);
                await flashBadge(preferredLang);
            } else {
                // 无变化，调用 setBadge 显示静态成功状态
                await setBadge();
            }
        } catch (error) {
            // 出错时，默认显示静态成功状态
            await setBadge();
        }
    }
}

// --- Internal Helpers for Stats (Original Versions) ---
/**
 * 为书签树构建索引，便于做“与上次备份对比”的净变化计算（Git 风格：看最终状态，而不是累计操作次数）。
 * @param {Array} tree - chrome.bookmarks.getTree() 的返回值。
 * @returns {{nodes: Map<string, {id: string, title: string, url?: string, parentId?: string|null, index?: number|null}>, byParent: Map<string, Array<{id: string, index: number|null}>>}}
 */
function buildTreeIndexForDiff(tree) {
    const nodes = new Map();
    const byParent = new Map();

    const traverse = (node, parentId = null) => {
        if (!node || !node.id) return;

        const record = {
            id: node.id,
            title: node.title || '',
            url: node.url,
            parentId: node.parentId || parentId,
            index: typeof node.index === 'number' ? node.index : null
        };

        nodes.set(record.id, record);

        if (record.parentId) {
            if (!byParent.has(record.parentId)) byParent.set(record.parentId, []);
            byParent.get(record.parentId).push({ id: record.id, index: record.index });
        }

        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                traverse(child, node.id);
            }
        }
    };

    if (Array.isArray(tree) && tree[0]) {
        traverse(tree[0], null);
    }

    // 保证同父级列表按 index 排序（稳定对比）
    for (const list of byParent.values()) {
        list.sort((a, b) => {
            const ai = typeof a.index === 'number' ? a.index : 0;
            const bi = typeof b.index === 'number' ? b.index : 0;
            return ai - bi;
        });
    }

    return { nodes, byParent };
}

/**
 * 计算“与上次备份对比”的净变化摘要（支持 +/-, 以及移动/修改回滚后归零）。
 * 说明：
 * - moved：跨级移动（parentId变化）+ 同级排序移动（index变化，但父级无 add/delete 干扰）
 * - modified：title/url 变化（文件夹仅看 title）
 * - added/deleted：按节点 id 直接对比（能识别“加减相同数量但内容不同”的情况）
 *
 * @param {Array|null} oldTree - 上次备份保存的书签树（lastBookmarkData.bookmarkTree）。
 * @param {Array|null} newTree - 当前书签树（chrome.bookmarks.getTree())。
 * @param {{explicitMovedIds?: Set<string>}} [options]
 * @returns {{
 *   bookmarkAdded:number, bookmarkDeleted:number, folderAdded:number, folderDeleted:number,
 *   movedCount:number, modifiedCount:number,
 *   movedBookmarkCount:number, movedFolderCount:number, modifiedBookmarkCount:number, modifiedFolderCount:number,
 *   bookmarkMoved:boolean, folderMoved:boolean, bookmarkModified:boolean, folderModified:boolean
 * }}
 */
function computeBookmarkGitDiffSummary(oldTree, newTree, options = {}) {
    const explicitMovedIds = options.explicitMovedIds instanceof Set ? options.explicitMovedIds : null;

    const summary = {
        bookmarkAdded: 0,
        bookmarkDeleted: 0,
        folderAdded: 0,
        folderDeleted: 0,
        movedCount: 0,
        modifiedCount: 0,
        movedBookmarkCount: 0,
        movedFolderCount: 0,
        modifiedBookmarkCount: 0,
        modifiedFolderCount: 0,
        bookmarkMoved: false,
        folderMoved: false,
        bookmarkModified: false,
        folderModified: false
    };

    if (!Array.isArray(oldTree) || !Array.isArray(newTree) || !oldTree[0] || !newTree[0]) {
        return summary;
    }

    const oldIndex = buildTreeIndexForDiff(oldTree);
    const newIndex = buildTreeIndexForDiff(newTree);

    const addedIds = new Set();
    const deletedIds = new Set();
    const modifiedIds = new Set();
    const movedIds = new Set();
    const crossParentMovedIds = new Set();

    // 新增 / 修改 / 跨级移动
    for (const [id, n] of newIndex.nodes.entries()) {
        const o = oldIndex.nodes.get(id);
        if (!o) {
            addedIds.add(id);
            continue;
        }

        const isFolder = !n.url;
        const isModified = isFolder ? (o.title !== n.title) : (o.title !== n.title || o.url !== n.url);
        if (isModified) modifiedIds.add(id);

        const crossMove = o.parentId !== n.parentId;
        if (crossMove) {
            movedIds.add(id);
            crossParentMovedIds.add(id);
        }
    }

    // 删除
    for (const id of oldIndex.nodes.keys()) {
        if (!newIndex.nodes.has(id)) deletedIds.add(id);
    }

    // 建立“子节点集合发生变化”的父级集合（避免因为 add/delete / 跨级移动导致的被动位移被误判为 moved）
    const parentsWithChildSetChange = new Set();
    for (const id of addedIds) {
        const node = newIndex.nodes.get(id);
        if (node && node.parentId) parentsWithChildSetChange.add(node.parentId);
    }
    for (const id of deletedIds) {
        const node = oldIndex.nodes.get(id);
        if (node && node.parentId) parentsWithChildSetChange.add(node.parentId);
    }
    for (const id of crossParentMovedIds) {
        const o = oldIndex.nodes.get(id);
        const n = newIndex.nodes.get(id);
        if (o && o.parentId) parentsWithChildSetChange.add(o.parentId);
        if (n && n.parentId) parentsWithChildSetChange.add(n.parentId);
    }

    const hasExplicitMovedInfo = explicitMovedIds && explicitMovedIds.size > 0;

    // 同级排序移动（重要：只标记“被拖动”的对象；不标记同级被动位移）
    // - 有显式 moved IDs（onMoved）时：仅按显式集合打标（即使该父级 children 集合也发生了变化）
    // - 无显式 moved IDs 时：仅在该父级 children 集合未变化时，用 LIS 推导最小 moved 集合
    if (hasExplicitMovedInfo) {
        const commonPosCache = new Map(); // parentId -> { oldPosById, newPosById }（只针对 common ids）
        const getCommonPositions = (parentId) => {
            if (commonPosCache.has(parentId)) return commonPosCache.get(parentId);

            const oldList = oldIndex.byParent.get(parentId) || [];
            const newList = newIndex.byParent.get(parentId) || [];
            const newIdSet = new Set(newList.map(x => x.id));

            const oldPosById = new Map();
            let oldPos = 0;
            for (const item of oldList) {
                if (newIdSet.has(item.id)) {
                    oldPosById.set(item.id, oldPos++);
                }
            }

            const newPosById = new Map();
            let newPos = 0;
            for (const item of newList) {
                if (oldPosById.has(item.id)) {
                    newPosById.set(item.id, newPos++);
                }
            }

            const entry = { oldPosById, newPosById };
            commonPosCache.set(parentId, entry);
            return entry;
        };

        for (const id of explicitMovedIds) {
            const o = oldIndex.nodes.get(id);
            const n = newIndex.nodes.get(id);
            if (!o || !n) continue; // added/deleted: Git 口径不算 moved
            if (!o.parentId || !n.parentId) continue;
            if (o.parentId !== n.parentId) continue; // 跨级 moved 已在上方加入 movedIds

            const parentId = n.parentId;
            const { oldPosById, newPosById } = getCommonPositions(parentId);
            const oldPos = oldPosById.get(id);
            const newPos = newPosById.get(id);
            if (typeof oldPos === 'number' && typeof newPos === 'number' && oldPos !== newPos) {
                movedIds.add(id);
            }
        }
    } else {
        for (const [parentId, newList] of newIndex.byParent.entries()) {
            if (parentsWithChildSetChange.has(parentId)) continue;

            const oldList = oldIndex.byParent.get(parentId) || [];
            if (oldList.length === 0 || newList.length === 0) continue;
            if (oldList.length !== newList.length) continue;

            // 快速判等（完全一致则跳过）
            let sameOrder = true;
            for (let i = 0; i < oldList.length; i++) {
                if (oldList[i].id !== newList[i].id) {
                    sameOrder = false;
                    break;
                }
            }
            if (sameOrder) continue;

            const oldPosById = new Map();
            for (let i = 0; i < oldList.length; i++) {
                oldPosById.set(oldList[i].id, i);
            }

            const seq = [];
            for (const item of newList) {
                const oldPos = oldPosById.get(item.id);
                if (typeof oldPos !== 'number') {
                    seq.length = 0;
                    break;
                }
                seq.push({ id: item.id, oldPos });
            }
            if (seq.length === 0) continue;

            // 计算 LIS（基于 oldPos，得到最大稳定子序列），其余视为 moved
            const tails = [];
            const tailsIdx = [];
            const prevIdx = new Array(seq.length).fill(-1);

            for (let i = 0; i < seq.length; i++) {
                const v = seq[i].oldPos;
                let lo = 0;
                let hi = tails.length;
                while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (tails[mid] < v) lo = mid + 1;
                    else hi = mid;
                }
                const pos = lo;
                if (pos > 0) prevIdx[i] = tailsIdx[pos - 1];
                if (pos === tails.length) {
                    tails.push(v);
                    tailsIdx.push(i);
                } else {
                    tails[pos] = v;
                    tailsIdx[pos] = i;
                }
            }

            const stableIds = new Set();
            let k = tailsIdx.length ? tailsIdx[tailsIdx.length - 1] : -1;
            while (k >= 0) {
                stableIds.add(seq[k].id);
                k = prevIdx[k];
            }

            for (const item of seq) {
                if (!stableIds.has(item.id)) {
                    movedIds.add(item.id);
                }
            }
        }
    }

    // Git 风格：新增的东西不算“移动/修改”，只算新增
    for (const id of addedIds) {
        movedIds.delete(id);
        modifiedIds.delete(id);
    }

    const isBookmark = (node) => !!(node && node.url);

    for (const id of addedIds) {
        const node = newIndex.nodes.get(id);
        if (isBookmark(node)) summary.bookmarkAdded++;
        else summary.folderAdded++;
    }

    for (const id of deletedIds) {
        const node = oldIndex.nodes.get(id);
        if (isBookmark(node)) summary.bookmarkDeleted++;
        else summary.folderDeleted++;
    }

    for (const id of movedIds) {
        const node = newIndex.nodes.get(id);
        if (isBookmark(node)) summary.movedBookmarkCount++;
        else summary.movedFolderCount++;
    }

    for (const id of modifiedIds) {
        const node = newIndex.nodes.get(id);
        if (isBookmark(node)) summary.modifiedBookmarkCount++;
        else summary.modifiedFolderCount++;
    }

    summary.movedCount = summary.movedBookmarkCount + summary.movedFolderCount;
    summary.modifiedCount = summary.modifiedBookmarkCount + summary.modifiedFolderCount;
    summary.bookmarkMoved = summary.movedBookmarkCount > 0;
    summary.folderMoved = summary.movedFolderCount > 0;
    summary.bookmarkModified = summary.modifiedBookmarkCount > 0;
    summary.folderModified = summary.modifiedFolderCount > 0;

    return summary;
}

/**
 * 分析当前书签状态与上次备份的差异，返回详细的变更对象。
 * 这是变化检测的核心函数。
 * @returns {Promise<object>}
 */
async function analyzeBookmarkChanges() {
    const {
        lastBookmarkData,
        recentMovedIds = [],
        recentModifiedIds = [],
        recentAddedIds = []
    } = await browserAPI.storage.local.get([
        'lastBookmarkData',
        'recentMovedIds',
        'recentModifiedIds',
        'recentAddedIds'
    ]);

    console.log('[analyzeBookmarkChanges] lastBookmarkData:', lastBookmarkData);

    // 获取当前书签树（一次 getTree 同时用于计数与净变化计算）
    const localBookmarks = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));

    const currentBookmarkCount = countAllBookmarks(localBookmarks);
    const currentFolderCount = countAllFolders(localBookmarks);

    const prevBookmarkCount = lastBookmarkData?.bookmarkCount ?? 0;
    const prevFolderCount = lastBookmarkData?.folderCount ?? 0;

    let bookmarkDiff = currentBookmarkCount - prevBookmarkCount;
    let folderDiff = currentFolderCount - prevFolderCount;

    // 如果没有上次备份数据，说明是首次运行或还未进行过备份：
    // 此时不应该显示为"有变化"，而应该等待用户进行第一次备份
    if (!lastBookmarkData) {
        bookmarkDiff = 0;
        folderDiff = 0;
        return {
            bookmarkCount: currentBookmarkCount,
            folderCount: currentFolderCount,
            prevBookmarkCount: prevBookmarkCount,
            prevFolderCount: prevFolderCount,
            bookmarkDiff: bookmarkDiff,
            folderDiff: folderDiff,
            bookmarkAdded: 0,
            bookmarkDeleted: 0,
            folderAdded: 0,
            folderDeleted: 0,
            movedCount: 0,
            modifiedCount: 0,
            movedBookmarkCount: 0,
            movedFolderCount: 0,
            modifiedBookmarkCount: 0,
            modifiedFolderCount: 0,
            bookmarkMoved: false,
            folderMoved: false,
            bookmarkModified: false,
            folderModified: false
        };
    }

    // 优先使用“与上次备份对比”的净变化（Git 风格）
    let diffSummary = null;
    try {
        if (lastBookmarkData && lastBookmarkData.bookmarkTree) {
            const explicitMovedIdSet = new Set(
                (Array.isArray(recentMovedIds) ? recentMovedIds : [])
                    .map(r => r && r.id)
                    .filter(Boolean)
            );
            diffSummary = computeBookmarkGitDiffSummary(lastBookmarkData.bookmarkTree, localBookmarks, {
                explicitMovedIds: explicitMovedIdSet
            });

            // 归并/清理 recentXxxIds：回滚后不再显示；新增的也不算移动/修改
            try {
                const oldTree = lastBookmarkData.bookmarkTree;
                if (Array.isArray(oldTree) && oldTree[0]) {
                    const oldIndex = buildTreeIndexForDiff(oldTree);
                    const newIndex = buildTreeIndexForDiff(localBookmarks);

                    const addedIds = new Set();
                    const deletedIds = new Set();
                    for (const id of newIndex.nodes.keys()) {
                        if (!oldIndex.nodes.has(id)) addedIds.add(id);
                    }
                    for (const id of oldIndex.nodes.keys()) {
                        if (!newIndex.nodes.has(id)) deletedIds.add(id);
                    }

                    const movedIds = new Set();
                    const modifiedIds = new Set();
                    const crossParentMovedIds = new Set();

                    // 跨级移动/修改
                    for (const [id, n] of newIndex.nodes.entries()) {
                        const o = oldIndex.nodes.get(id);
                        if (!o) continue;
                        const isFolder = !n.url;
                        const isModified = isFolder ? (o.title !== n.title) : (o.title !== n.title || o.url !== n.url);
                        if (isModified) modifiedIds.add(id);
                        if (o.parentId !== n.parentId) {
                            movedIds.add(id);
                            crossParentMovedIds.add(id);
                        }
                    }

                    // 建立“子节点集合发生变化”的父级集合（避免因为 add/delete / 跨级移动导致的被动位移被误判为 moved）
                    const parentsWithChildSetChange = new Set();
                    for (const id of addedIds) {
                        const node = newIndex.nodes.get(id);
                        if (node && node.parentId) parentsWithChildSetChange.add(node.parentId);
                    }
                    for (const id of deletedIds) {
                        const node = oldIndex.nodes.get(id);
                        if (node && node.parentId) parentsWithChildSetChange.add(node.parentId);
                    }
                    for (const id of crossParentMovedIds) {
                        const o = oldIndex.nodes.get(id);
                        const n = newIndex.nodes.get(id);
                        if (o && o.parentId) parentsWithChildSetChange.add(o.parentId);
                        if (n && n.parentId) parentsWithChildSetChange.add(n.parentId);
                    }

                    const hasExplicitMovedInfo = explicitMovedIdSet instanceof Set && explicitMovedIdSet.size > 0;

                    // 同级排序移动（按 computeBookmarkGitDiffSummary 的口径）
                    if (hasExplicitMovedInfo) {
                        const commonPosCache = new Map(); // parentId -> { oldPosById, newPosById }
                        const getCommonPositions = (parentId) => {
                            if (commonPosCache.has(parentId)) return commonPosCache.get(parentId);

                            const oldList = oldIndex.byParent.get(parentId) || [];
                            const newList = newIndex.byParent.get(parentId) || [];
                            const newIdSet = new Set(newList.map(x => x.id));

                            const oldPosById = new Map();
                            let oldPos = 0;
                            for (const item of oldList) {
                                if (newIdSet.has(item.id)) oldPosById.set(item.id, oldPos++);
                            }

                            const newPosById = new Map();
                            let newPos = 0;
                            for (const item of newList) {
                                if (oldPosById.has(item.id)) newPosById.set(item.id, newPos++);
                            }

                            const entry = { oldPosById, newPosById };
                            commonPosCache.set(parentId, entry);
                            return entry;
                        };

                        for (const id of explicitMovedIdSet) {
                            const o = oldIndex.nodes.get(id);
                            const n = newIndex.nodes.get(id);
                            if (!o || !n) continue;
                            if (!o.parentId || !n.parentId) continue;
                            if (o.parentId !== n.parentId) continue; // 跨级 moved 已加入 movedIds

                            const parentId = n.parentId;
                            const { oldPosById, newPosById } = getCommonPositions(parentId);
                            const oldPos = oldPosById.get(id);
                            const newPos = newPosById.get(id);
                            if (typeof oldPos === 'number' && typeof newPos === 'number' && oldPos !== newPos) {
                                movedIds.add(id);
                            }
                        }
                    } else {
                        for (const [parentId, newList] of newIndex.byParent.entries()) {
                            if (parentsWithChildSetChange.has(parentId)) continue;
                            const oldList = oldIndex.byParent.get(parentId) || [];
                            if (oldList.length === 0 || newList.length === 0) continue;
                            if (oldList.length !== newList.length) continue;

                            // 快速判等
                            let sameOrder = true;
                            for (let i = 0; i < oldList.length; i++) {
                                if (oldList[i].id !== newList[i].id) {
                                    sameOrder = false;
                                    break;
                                }
                            }
                            if (sameOrder) continue;

                            const oldPosById = new Map();
                            for (let i = 0; i < oldList.length; i++) oldPosById.set(oldList[i].id, i);

                            const seq = [];
                            for (const item of newList) {
                                const oldPos = oldPosById.get(item.id);
                                if (typeof oldPos !== 'number') {
                                    seq.length = 0;
                                    break;
                                }
                                seq.push({ id: item.id, oldPos });
                            }
                            if (seq.length === 0) continue;

                            const tails = [];
                            const tailsIdx = [];
                            const prevIdx = new Array(seq.length).fill(-1);

                            for (let i = 0; i < seq.length; i++) {
                                const v = seq[i].oldPos;
                                let lo = 0;
                                let hi = tails.length;
                                while (lo < hi) {
                                    const mid = (lo + hi) >> 1;
                                    if (tails[mid] < v) lo = mid + 1;
                                    else hi = mid;
                                }
                                const pos = lo;
                                if (pos > 0) prevIdx[i] = tailsIdx[pos - 1];
                                if (pos === tails.length) {
                                    tails.push(v);
                                    tailsIdx.push(i);
                                } else {
                                    tails[pos] = v;
                                    tailsIdx[pos] = i;
                                }
                            }

                            const stableIds = new Set();
                            let k = tailsIdx.length ? tailsIdx[tailsIdx.length - 1] : -1;
                            while (k >= 0) {
                                stableIds.add(seq[k].id);
                                k = prevIdx[k];
                            }

                            for (const item of seq) {
                                if (!stableIds.has(item.id)) {
                                    movedIds.add(item.id);
                                }
                            }
                        }
                    }

                    // 新增的不算移动/修改
                    for (const id of addedIds) {
                        movedIds.delete(id);
                        modifiedIds.delete(id);
                    }

                    // 只做过滤，不做“补全”（避免误判/膨胀）
                    const normalizedRecentMoved = (Array.isArray(recentMovedIds) ? recentMovedIds : []).filter(r => r && movedIds.has(r.id));
                    const normalizedRecentModified = (Array.isArray(recentModifiedIds) ? recentModifiedIds : []).filter(r => r && modifiedIds.has(r.id));
                    const normalizedRecentAdded = (Array.isArray(recentAddedIds) ? recentAddedIds : []).filter(r => r && addedIds.has(r.id));

                    // 仅在数量发生变化时写入，减少 storage 写放大
                    if (normalizedRecentMoved.length !== (Array.isArray(recentMovedIds) ? recentMovedIds.length : 0) ||
                        normalizedRecentModified.length !== (Array.isArray(recentModifiedIds) ? recentModifiedIds.length : 0) ||
                        normalizedRecentAdded.length !== (Array.isArray(recentAddedIds) ? recentAddedIds.length : 0)) {
                        await browserAPI.storage.local.set({
                            recentMovedIds: normalizedRecentMoved,
                            recentModifiedIds: normalizedRecentModified,
                            recentAddedIds: normalizedRecentAdded
                        });
                    }
                }
            } catch (_) { }
        }
    } catch (e) {
        console.warn('[analyzeBookmarkChanges] 净变化计算失败，回退到旧逻辑:', e);
    }

    if (!diffSummary) {
        // 回退：至少保证不崩溃（数量差异仍可用）
        diffSummary = {
            bookmarkAdded: bookmarkDiff > 0 ? bookmarkDiff : 0,
            bookmarkDeleted: bookmarkDiff < 0 ? Math.abs(bookmarkDiff) : 0,
            folderAdded: folderDiff > 0 ? folderDiff : 0,
            folderDeleted: folderDiff < 0 ? Math.abs(folderDiff) : 0,
            movedCount: 0,
            modifiedCount: 0,
            movedBookmarkCount: 0,
            movedFolderCount: 0,
            modifiedBookmarkCount: 0,
            modifiedFolderCount: 0,
            bookmarkMoved: false,
            folderMoved: false,
            bookmarkModified: false,
            folderModified: false
        };
    }

    return {
        bookmarkCount: currentBookmarkCount,
        folderCount: currentFolderCount,
        prevBookmarkCount: prevBookmarkCount,
        prevFolderCount: prevFolderCount,
        bookmarkDiff: bookmarkDiff,
        folderDiff: folderDiff,
        ...diffSummary
    };
}

// 添加一个内部函数来获取备份统计信息，以便在 background.js 内部调用
async function getBackupStatsInternal() {
    try {
        const { lastSyncTime } = await browserAPI.storage.local.get(['lastSyncTime']);
        // 优先使用缓存，如果缓存不存在（例如首次运行），则触发一次分析和缓存
        const stats = cachedBookmarkAnalysis || await updateAndCacheAnalysis();

        const response = {
            lastSyncTime: lastSyncTime || null,
            stats: stats,
            success: true
        };

        return response;

    } catch (error) {
        return { success: false, error: error.message, stats: null };
    }
}

// 为自动备份定时器提供的书签变化检测接口
async function checkBookmarkChangesForAutoBackup() {
    try {
        const stats = await getBackupStatsInternal();

        if (!stats || !stats.success || !stats.stats) {
            return {
                success: false,
                hasChanges: false,
                changeDescription: '',
                error: '无法获取备份统计信息'
            };
        }

        const { preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);

        // 检查是否有任何变化（支持“+/-同时存在但净差为0”的场景）
        const hasChanges = (
            stats.stats.bookmarkDiff !== 0 ||
            stats.stats.folderDiff !== 0 ||
            (typeof stats.stats.bookmarkAdded === 'number' && stats.stats.bookmarkAdded > 0) ||
            (typeof stats.stats.bookmarkDeleted === 'number' && stats.stats.bookmarkDeleted > 0) ||
            (typeof stats.stats.folderAdded === 'number' && stats.stats.folderAdded > 0) ||
            (typeof stats.stats.folderDeleted === 'number' && stats.stats.folderDeleted > 0) ||
            (typeof stats.stats.movedCount === 'number' && stats.stats.movedCount > 0) ||
            (typeof stats.stats.modifiedCount === 'number' && stats.stats.modifiedCount > 0) ||
            stats.stats.bookmarkMoved ||
            stats.stats.bookmarkModified ||
            stats.stats.folderMoved ||
            stats.stats.folderModified
        );

        // 构建变化描述
        let changeDescription = '';
        if (hasChanges) {
            const changes = [];
            // 数量变化：优先用新增/删除分开显示；否则回退到净差
            const bmAdded = typeof stats.stats.bookmarkAdded === 'number' ? stats.stats.bookmarkAdded : 0;
            const bmDeleted = typeof stats.stats.bookmarkDeleted === 'number' ? stats.stats.bookmarkDeleted : 0;
            const fdAdded = typeof stats.stats.folderAdded === 'number' ? stats.stats.folderAdded : 0;
            const fdDeleted = typeof stats.stats.folderDeleted === 'number' ? stats.stats.folderDeleted : 0;

            if (bmAdded > 0) {
                changes.push(`+${bmAdded} ${preferredLang === 'zh_CN' ? '书签' : 'bookmarks'}`);
            }
            if (bmDeleted > 0) {
                changes.push(`-${bmDeleted} ${preferredLang === 'zh_CN' ? '书签' : 'bookmarks'}`);
            }
            if (fdAdded > 0) {
                changes.push(`+${fdAdded} ${preferredLang === 'zh_CN' ? '文件夹' : 'folders'}`);
            }
            if (fdDeleted > 0) {
                changes.push(`-${fdDeleted} ${preferredLang === 'zh_CN' ? '文件夹' : 'folders'}`);
            }

            // 回退：如果没有新增/删除数据，再使用净差
            if (bmAdded === 0 && bmDeleted === 0 && stats.stats.bookmarkDiff !== 0) {
                changes.push(`${stats.stats.bookmarkDiff > 0 ? '+' : ''}${stats.stats.bookmarkDiff} ${preferredLang === 'zh_CN' ? '书签' : 'bookmarks'}`);
            }
            if (fdAdded === 0 && fdDeleted === 0 && stats.stats.folderDiff !== 0) {
                changes.push(`${stats.stats.folderDiff > 0 ? '+' : ''}${stats.stats.folderDiff} ${preferredLang === 'zh_CN' ? '文件夹' : 'folders'}`);
            }

            // 结构变化：优先用计数；否则回退到布尔标记
            const movedCount = typeof stats.stats.movedCount === 'number' ? stats.stats.movedCount : 0;
            const modifiedCount = typeof stats.stats.modifiedCount === 'number' ? stats.stats.modifiedCount : 0;

            if (movedCount > 0 || stats.stats.bookmarkMoved || stats.stats.folderMoved) {
                if (movedCount > 0) {
                    changes.push(preferredLang === 'zh_CN' ? `${movedCount}个移动` : `${movedCount} moved`);
                } else {
                    changes.push(preferredLang === 'zh_CN' ? '移动' : 'moved');
                }
            }
            if (modifiedCount > 0 || stats.stats.bookmarkModified || stats.stats.folderModified) {
                if (modifiedCount > 0) {
                    changes.push(preferredLang === 'zh_CN' ? `${modifiedCount}个修改` : `${modifiedCount} modified`);
                } else {
                    changes.push(preferredLang === 'zh_CN' ? '修改' : 'modified');
                }
            }
            changeDescription = `(${changes.join('，')})`;
        }

        return {
            success: true,
            hasChanges,
            changeDescription
        };
    } catch (error) {
        console.error('[书签变化检测] 检测失败:', error);
        return {
            success: false,
            hasChanges: false,
            changeDescription: '',
            error: error.message
        };
    }
}

// [重构] 不再是async，而是纯粹的计数函数
function countBookmarksAndFolders(bookmarkNodes) {
    let bookmarks = 0;
    let folders = 0;

    function countItemsRecursive(node) {
        if (node.url) {
            bookmarks++;
        } else if (node.children) {
            folders++;
            for (const child of node.children) {
                countItemsRecursive(child);
            }
        }
    }

    if (bookmarkNodes && bookmarkNodes.length > 0) {
        for (const rootChild of bookmarkNodes[0].children) {
            countItemsRecursive(rootChild);
        }
    }

    return { bookmarks, folders };
}

// 假设有一个内部版本的 getCurrentBookmarkCounts
async function getCurrentBookmarkCountsInternal() {
    return new Promise((resolve) => {
        browserAPI.bookmarks.getTree((nodes) => {
            const counts = countBookmarksAndFolders(nodes);
            resolve(counts);
        });
    });
}

// =================================================================================
// X. LATE INITIALIZATIONS / FINAL SETUP (后续初始化/最终设置) - IF ANY
// =================================================================================
// (Most initializations are now grouped at the top or with their respective systems)

/**
 * 为书签和文件夹生成唯一的、基于路径的指纹。
 * @param {Array} bookmarkNodes - 浏览器书签树的根节点。
 * @returns {{bookmarks: Array<string>, folders: Array<string>}} 包含书签和文件夹指纹数组的对象。
 */
function generateFingerprints(bookmarkNodes) {
    const bookmarkPrints = new Set();
    const folderPrints = new Set();

    /**
     * 递归遍历书签树，为每个项目生成指纹。
     * @param {Array} nodes - 当前要遍历的节点数组。
     * @param {string} path - 父文件夹的完整路径。
     */
    function traverse(nodes, path) {
        for (const node of nodes) {
            if (node.url) {
                // 书签的身份 = 它所在的完整路径 + 它的名称 + 它的URL
                const bookmarkFingerprint = `B:${path}|${node.title}|${node.url}`;
                bookmarkPrints.add(bookmarkFingerprint);
            } else if (node.children) {
                // 文件夹的完整路径
                const currentPath = path ? `${path}/${node.title}` : node.title;

                // 计算其直接包含的内容数量
                let directBookmarkCount = 0;
                let directFolderCount = 0;
                for (const child of node.children) {
                    if (child.url) {
                        directBookmarkCount++;
                    } else if (child.children) {
                        directFolderCount++;
                    }
                }

                // 文件夹的身份 = 它的完整路径 + 它的名称 + 它包含的内容（数量限定）
                const contentQuantitySignature = `c:${directBookmarkCount},${directFolderCount}`;
                const folderFingerprint = `F:${currentPath}|${contentQuantitySignature}`;
                folderPrints.add(folderFingerprint);

                // 递归进入子文件夹
                traverse(node.children, currentPath);
            }
        }
    }

    // 从根目录的子节点开始遍历，初始路径为空
    if (bookmarkNodes && bookmarkNodes.length > 0 && bookmarkNodes[0].children) {
        traverse(bookmarkNodes[0].children, '');
    }

    return {
        bookmarks: [...bookmarkPrints],
        folders: [...folderPrints]
    };
}

/**
 * 比较两个Set对象的内容是否完全相等。
 * @param {Set<any>} setA - 第一个Set。
 * @param {Set<any>} setB - 第二个Set。
 * @returns {boolean} 如果两个Set内容相同则返回true。
 */
function areSetsEqual(setA, setB) {
    if (setA.size !== setB.size) {
        return false;
    }
    for (const item of setA) {
        if (!setB.has(item)) {
            return false;
        }
    }
    return true;
}

/**
 * [新] 核心分析函数，执行一次遍历，完成所有计算，并更新缓存。
 * 这是所有状态获取的权威来源。
 */
async function updateAndCacheAnalysis() {
    try {
        console.log('[updateAndCacheAnalysis] 开始分析书签变化...');
        const analysis = await analyzeBookmarkChanges();
        cachedBookmarkAnalysis = analysis;
        console.log('[updateAndCacheAnalysis] 分析完成:', {
            bookmarkDiff: analysis.bookmarkDiff,
            folderDiff: analysis.folderDiff,
            bookmarkCount: analysis.bookmarkCount,
            folderCount: analysis.folderCount
        });

        // 将摘要快照持久化到 storage（供提醒系统/页面在缓存未命中时兜底使用）
        try {
            await browserAPI.storage.local.set({
                cachedBookmarkAnalysisSnapshot: analysis,
                cachedBookmarkAnalysisSnapshotTime: Date.now()
            });
        } catch (_) { }

        // 分析完成后，向前端发送消息（analysis + 最近移动兜底）
        browserAPI.runtime.sendMessage({ action: "analysisUpdated", ...analysis }).catch(() => {
            // 忽略错误，因为popup可能未打开
        });

        // 同步广播最近移动ID，增加前端打标稳定性
        try {
            const { recentMovedIds = [] } = await browserAPI.storage.local.get(['recentMovedIds']);
            const now = Date.now();
            const fresh = recentMovedIds.filter(r => (now - (r.time || 0)) < RECENT_MOVED_TTL_MS);
            for (const r of fresh) {
                browserAPI.runtime.sendMessage({ action: 'recentMovedBroadcast', id: r.id }).catch(() => { });
            }
        } catch (_) { }

        return cachedBookmarkAnalysis;
    } catch (error) {
        console.error('[updateAndCacheAnalysis] 分析失败:', error);
        // 出错时清除缓存，以防数据不一致
        cachedBookmarkAnalysis = null;
        throw error; // 重新抛出错误
    }
}

/**
 * 新增：初始化语言偏好函数
 * 在扩展首次启动时检测浏览器语言并存储。
 */
async function initializeLanguagePreference() {
    try {
        const result = await browserAPI.storage.local.get('languageAutoDetected');
        if (!result.languageAutoDetected) {
            const browserLang = browserAPI.i18n.getUILanguage().toLowerCase();
            let preferredLang;

            // 判断是否为中文，并设置对应语言
            if (browserLang.startsWith('zh')) {
                // 浏览器语言是中文
                preferredLang = 'zh_CN';
            } else {
                // 浏览器语言为任何非中文语言
                preferredLang = 'en';
            }

            await browserAPI.storage.local.set({
                preferredLang: preferredLang,
                languageAutoDetected: true
            });
        }
    } catch (e) {
    }
}

// 全局变量
// ... existing code ...
// 浏览器启动、安装或更新时执行的初始化
browserAPI.runtime.onStartup.addListener(async () => {
    await initializeLanguagePreference(); // 新增：初始化语言偏好
    await initializeBadge();
    await initializeAutoSync();
    initializeOperationTracking();

    // 初始化活跃时间追踪
    await initializeActiveTimeTracker();
    setupActiveTimeTrackerListeners();
});

// =================================================================================
// VII. TAB FAVICON UPDATE SYSTEM (Tab Favicon 更新系统)
// =================================================================================

// 防抖：记录已处理的 URL，避免重复更新
const processedFavicons = new Map(); // url -> timestamp
const FAVICON_UPDATE_COOLDOWN = 5000; // 5秒内同一URL不重复更新

/**
 * 监听 tab 更新，当书签被打开时获取最新的 favicon 并更新缓存
 */
browserAPI.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 只处理 favIconUrl 变化的情况（最精确的触发条件）
    if (changeInfo.favIconUrl && tab.url) {
        // 防抖检查：如果最近处理过这个URL，跳过
        const now = Date.now();
        const lastProcessed = processedFavicons.get(tab.url);
        if (lastProcessed && (now - lastProcessed) < FAVICON_UPDATE_COOLDOWN) {
            return; // 5秒内已处理过，跳过
        }
        // 过滤掉扩展页面、chrome:// 等
        if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
            return;
        }

        // 检查是否是本地/内网地址（静默）
        try {
            const urlObj = new URL(tab.url);
            const hostname = urlObj.hostname.toLowerCase();

            // 本地地址
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                return;
            }

            // 内网地址
            if (hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/)) {
                return;
            }

            // .local 域名
            if (hostname.endsWith('.local')) {
                return;
            }
        } catch (e) {
            return;
        }

        // 记录处理时间
        processedFavicons.set(tab.url, now);

        // 定期清理旧记录（避免内存泄漏）
        if (processedFavicons.size > 1000) {
            const entries = Array.from(processedFavicons.entries());
            entries.sort((a, b) => a[1] - b[1]); // 按时间排序
            entries.slice(0, 500).forEach(([url]) => processedFavicons.delete(url)); // 删除一半旧记录
        }

        // 将 favicon URL 转换为 Base64
        try {
            const faviconUrl = changeInfo.favIconUrl || tab.favIconUrl;
            const dataUrl = await convertFaviconToBase64(faviconUrl);

            // 发送消息给 history.js 更新缓存
            browserAPI.runtime.sendMessage({
                action: 'updateFaviconFromTab',
                url: tab.url,
                favIconUrl: dataUrl || tab.favIconUrl
            }).catch(() => {
                // 忽略错误，history.js 可能未打开
            });

            // 简洁日志：只显示域名
            // 静默更新缓存
        } catch (error) {
            // 静默处理
        }
    }
});

/**
 * 将 favicon URL 转换为 Base64 Data URL
 */
async function convertFaviconToBase64(faviconUrl) {
    return new Promise((resolve) => {
        try {
            // 使用 fetch 获取 favicon
            fetch(faviconUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Fetch failed');
                    }
                    return response.blob();
                })
                .then(blob => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        resolve(reader.result);
                    };
                    reader.onerror = () => {
                        resolve(null);
                    };
                    reader.readAsDataURL(blob);
                })
                .catch(() => {
                    resolve(null);
                });
        } catch (e) {
            resolve(null);
        }
    });
}

// =================================================================================
// VIII. INITIALIZATION (初始化)
// =================================================================================

browserAPI.runtime.onInstalled.addListener(async (details) => {
    await initializeLanguagePreference(); // 新增：初始化语言偏好
    await initializeBadge();
    await initializeAutoSync();
    initializeOperationTracking();

    // 初始化活跃时间追踪
    await initializeActiveTimeTracker();
    setupActiveTimeTrackerListeners();

    if (details.reason === 'install') {
        // browserAPI.tabs.create({ url: 'welcome.html' });
    } else if (details.reason === 'update') {
        const previousVersion = details.previousVersion;
    }
});

// =================================================================================
// IX. 顶层初始化 - 确保 Service Worker 每次加载时都初始化活跃时间追踪
// =================================================================================
// 在 Manifest V3 中，Service Worker 可能会被卸载并重新加载，
// 此时 onInstalled/onStartup 事件不会再触发。
// 因此需要在顶层代码中进行初始化。

(async function initializeOnLoad() {
    console.log('[Background] Service Worker 加载，执行顶层初始化...');

    try {
        // 初始化活跃时间追踪（包含 IndexedDB 和书签缓存）
        await initializeActiveTimeTracker();
        setupActiveTimeTrackerListeners();
        console.log('[Background] 活跃时间追踪模块已初始化');
    } catch (error) {
        console.error('[Background] 活跃时间追踪初始化失败:', error);
    }
})();

// 最后一个窗口关闭时保存所有活跃会话（浏览器即将退出）
if (browserAPI.windows && browserAPI.windows.onRemoved) {
    browserAPI.windows.onRemoved.addListener(async (windowId) => {
        try {
            const allWindows = await browserAPI.windows.getAll();
            if (allWindows.length === 0) {
                console.log('[Background] 最后一个窗口关闭，保存所有活跃会话...');
                await saveAllActiveSessions();
            }
        } catch (error) {
            console.error('[Background] 检查窗口状态失败:', error);
        }
    });
}

// =================================================================================
// X. 书签打开监测（用于「点击记录」与「时间追踪」归因）
// =================================================================================

const PENDING_AUTO_BOOKMARK_CLICKS_KEY = 'bb_pending_auto_bookmark_clicks_v1';
const PENDING_AUTO_BOOKMARK_CLICKS_MAX = 5000;
const PENDING_AUTO_BOOKMARK_CLICKS_KEEP_MS = 400 * 24 * 60 * 60 * 1000; // ~400天

async function appendPendingAutoBookmarkClick(event) {
    try {
        const result = await browserAPI.storage.local.get([PENDING_AUTO_BOOKMARK_CLICKS_KEY]);
        const existing = result[PENDING_AUTO_BOOKMARK_CLICKS_KEY];
        const list = Array.isArray(existing) ? existing : [];

        list.push(event);

        const now = Date.now();
        const cutoff = now - PENDING_AUTO_BOOKMARK_CLICKS_KEEP_MS;
        const pruned = list
            .filter(e => e && typeof e.visitTime === 'number' && e.visitTime >= cutoff)
            .slice(-PENDING_AUTO_BOOKMARK_CLICKS_MAX);

        await browserAPI.storage.local.set({ [PENDING_AUTO_BOOKMARK_CLICKS_KEY]: pruned });
    } catch (error) {
        console.warn('[AutoBookmarkOpen] 写入待消费点击记录失败:', error);
    }
}

function setupAutoBookmarkOpenMonitoring() {
    try {
        if (!browserAPI.webNavigation || !browserAPI.webNavigation.onCommitted) {
            return;
        }

        browserAPI.webNavigation.onCommitted.addListener(async (details) => {
            try {
                if (!details || details.frameId !== 0) return;
                if (details.transitionType !== 'auto_bookmark') return;

                const url = details.url;
                if (!url || (typeof url !== 'string')) return;
                if (!url.startsWith('http://') && !url.startsWith('https://')) return;

                let bookmarkId = null;
                let bookmarkTitle = '';

                try {
                    const matches = await browserAPI.bookmarks.search({ url });
                    if (Array.isArray(matches) && matches.length > 0) {
                        bookmarkId = matches[0].id || null;
                        bookmarkTitle = matches[0].title || '';
                    }
                } catch (_) { }

                if (!bookmarkTitle) {
                    try {
                        const tab = await browserAPI.tabs.get(details.tabId);
                        bookmarkTitle = tab?.title || '';
                    } catch (_) { }
                }

                noteAutoBookmarkNavigation({
                    tabId: details.tabId,
                    bookmarkUrl: url,
                    bookmarkId,
                    bookmarkTitle,
                    timeStamp: typeof details.timeStamp === 'number' ? details.timeStamp : Date.now(),
                    source: 'browser_auto_bookmark'
                });
            } catch (error) {
                console.warn('[AutoBookmarkOpen] 处理失败:', error);
            }
        });
    } catch (error) {
        console.warn('[AutoBookmarkOpen] 初始化失败:', error);
    }
}

setupAutoBookmarkOpenMonitoring();

// =================================================================================
// XI. 书签推荐 S值计算系统（在background.js中统一管理）
// =================================================================================

let isComputingScores = false;

// 获取公式配置（从storage读取）
async function getFormulaConfig() {
    // 使用 trackingEnabled 键名（与 active_time_tracker 一致）
    const result = await browserAPI.storage.local.get(['recommendFormulaConfig', 'trackingEnabled']);
    const config = result.recommendFormulaConfig || {
        weights: { freshness: 0.15, coldness: 0.25, shallowRead: 0.20, forgetting: 0.25, laterReview: 0.15 },
        thresholds: { freshness: 90, coldness: 10, shallowRead: 5, forgetting: 14 }
    };
    // 追踪是否开启（默认开启）
    config.trackingEnabled = result.trackingEnabled !== false;
    return config;
}

// 获取屏蔽数据
async function getBlockedDataForScore() {
    const result = await browserAPI.storage.local.get(['blockedBookmarks', 'blockedDomains', 'blockedFolders']);
    return {
        bookmarks: new Set(result.blockedBookmarks || []),
        domains: new Set(result.blockedDomains || []),
        folders: new Set(result.blockedFolders || [])
    };
}

// 获取S值缓存
async function getScoresCache() {
    const result = await browserAPI.storage.local.get(['recommend_scores_cache']);
    return result.recommend_scores_cache || {};
}

// 保存S值缓存（带配额错误处理）
async function saveScoresCache(cache) {
    try {
        await browserAPI.storage.local.set({ recommend_scores_cache: cache });
    } catch (error) {
        // 处理存储配额不足的情况
        if (error.message && error.message.includes('QUOTA')) {
            console.warn('[S值缓存] 存储配额不足，尝试清理...');
            try {
                // 清理过期数据：已翻阅记录、过期待复习、缩略图缓存
                const keysToCheck = ['flippedBookmarks', 'thumbnailCache', 'recommend_postponed'];
                const data = await browserAPI.storage.local.get(keysToCheck);

                // 清理已翻阅（只保留最近7天）
                if (data.flippedBookmarks) {
                    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
                    const filtered = {};
                    for (const [id, time] of Object.entries(data.flippedBookmarks)) {
                        if (time > oneWeekAgo) filtered[id] = time;
                    }
                    await browserAPI.storage.local.set({ flippedBookmarks: filtered });
                }

                // 清理缩略图缓存（全部清除以腾出空间）
                if (data.thumbnailCache) {
                    await browserAPI.storage.local.remove(['thumbnailCache']);
                }

                // 重试保存
                await browserAPI.storage.local.set({ recommend_scores_cache: cache });
                console.log('[S值缓存] 清理后保存成功');
            } catch (retryError) {
                console.error('[S值缓存] 清理后仍然保存失败:', retryError);
            }
        } else {
            console.error('[S值缓存] 保存失败:', error);
        }
    }
}

// 获取待复习数据
async function getPostponedBookmarksForScore() {
    const result = await browserAPI.storage.local.get(['recommend_postponed']);
    return result.recommend_postponed || [];
}

// 获取复习数据
async function getReviewDataForScore() {
    const result = await browserAPI.storage.local.get(['recommend_reviews']);
    return result.recommend_reviews || {};
}

// 获取追踪数据（从 trackingStats 读取，与综合排行一致）
async function getTrackingDataForScore() {
    try {
        const stats = await getTrackingStats();
        const byUrl = new Map();
        const byTitle = new Map();
        const byBookmarkId = new Map();

        for (const [key, stat] of Object.entries(stats)) {
            const data = {
                url: stat.url,
                title: stat.title || key,
                compositeMs: stat.totalCompositeMs || 0,
                bookmarkId: stat.bookmarkId || null
            };
            if (stat.url) byUrl.set(stat.url, data);
            if (stat.title) byTitle.set(stat.title, data);
            if (stat.bookmarkId) byBookmarkId.set(stat.bookmarkId, data);
        }

        return { byUrl, byTitle, byBookmarkId };
    } catch (e) {
        console.warn('[S值计算] 获取追踪数据失败:', e);
        return { byUrl: new Map(), byTitle: new Map(), byBookmarkId: new Map() };
    }
}

// 计算因子值（0-1）
function calculateFactorValue(value, threshold, inverse = false) {
    if (value <= 0) return inverse ? 1 : 0;
    const safeThreshold = Math.max(1, threshold || 1);
    const decayed = 1 / (1 + Math.pow(value / safeThreshold, 0.7));
    return inverse ? decayed : (1 - decayed);
}

// 计算单个书签的S值
function calculateBookmarkScore(bookmark, historyStats, trackingData, config, postponedList, reviewData) {
    const now = Date.now();
    const thresholds = config.thresholds;

    // 获取历史统计（URL匹配优先，然后标题匹配）
    let history = historyStats.get(bookmark.url);
    if (!history || history.visitCount === 0) {
        // 尝试标题匹配
        if (bookmark.title && historyStats.titleMap) {
            history = historyStats.titleMap.get(bookmark.title);
        }
    }
    history = history || { visitCount: 0, lastVisitTime: 0 };

    // 获取追踪数据（T值）- bookmarkId 匹配优先，然后 URL 匹配；
    // 标题只作为“安全兜底”：仅在能确认对应到同一书签时才使用，避免把同名书签/浏览历史关联误算到别的书签上。
    let compositeMs = 0;
    if (bookmark.id && trackingData.byBookmarkId && trackingData.byBookmarkId.has(bookmark.id)) {
        compositeMs = trackingData.byBookmarkId.get(bookmark.id).compositeMs;
    } else if (bookmark.url && trackingData.byUrl.has(bookmark.url)) {
        compositeMs = trackingData.byUrl.get(bookmark.url).compositeMs;
    } else if (bookmark.title && trackingData.byTitle && trackingData.byTitle.has(bookmark.title)) {
        const titleHit = trackingData.byTitle.get(bookmark.title);
        if (titleHit) {
            if (bookmark.id && titleHit.bookmarkId && titleHit.bookmarkId === bookmark.id) {
                compositeMs = titleHit.compositeMs;
            } else if (!bookmark.id && !titleHit.bookmarkId) {
                // 兼容极旧数据：两边都没有 bookmarkId 时，允许标题兜底
                compositeMs = titleHit.compositeMs;
            }
        }
    }

    // F (新鲜度)
    const daysSinceAdded = (now - (bookmark.dateAdded || now)) / (1000 * 60 * 60 * 24);
    const F = calculateFactorValue(daysSinceAdded, thresholds.freshness, true);

    // C (冷门度)
    const C = calculateFactorValue(history.visitCount, thresholds.coldness, true);

    // T (时间度)
    const compositeMinutes = compositeMs / (1000 * 60);
    const T = calculateFactorValue(compositeMinutes, thresholds.shallowRead, true);

    // D (遗忘度)
    let daysSinceLastVisit = thresholds.forgetting;
    if (history.lastVisitTime > 0) {
        daysSinceLastVisit = (now - history.lastVisitTime) / (1000 * 60 * 60 * 24);
    }
    const D = calculateFactorValue(daysSinceLastVisit, thresholds.forgetting, false);

    // L (待复习)
    let L = 0;
    const postponeInfo = postponedList.find(p => p.bookmarkId === bookmark.id);
    if (postponeInfo && postponeInfo.manuallyAdded) {
        L = 1;
    }

    // R (记忆度)
    let R = 1;
    const review = reviewData[bookmark.id];
    if (review) {
        const daysSinceReview = (now - review.lastReview) / (1000 * 60 * 60 * 24);
        const reviewCount = review.reviewCount || 1;
        const stabilityTable = [3, 7, 14, 30, 60];
        const stability = stabilityTable[Math.min(reviewCount - 1, stabilityTable.length - 1)];
        const needReview = 1 - Math.pow(0.9, daysSinceReview / stability);
        R = 0.7 + 0.3 * needReview;
        R = Math.max(0.7, Math.min(1, R));
    }

    // 获取权重
    let w1 = config.weights.freshness || 0.15;
    let w2 = config.weights.coldness || 0.25;
    let w3 = config.weights.shallowRead || 0.20;
    let w4 = config.weights.forgetting || 0.25;
    let w5 = config.weights.laterReview || 0.15;

    // 追踪关闭时，T权重变0，其他权重重新归一化
    if (!config.trackingEnabled) {
        const remaining = w1 + w2 + w4 + w5;
        if (remaining > 0) {
            w1 = w1 / remaining;
            w2 = w2 / remaining;
            w4 = w4 / remaining;
            w5 = w5 / remaining;
        }
        w3 = 0;
    }

    const basePriority = w1 * F + w2 * C + w3 * T + w4 * D + w5 * L;
    const priority = basePriority * R;
    const randomFactor = (Math.random() - 0.5) * 0.1;
    const S = Math.max(0, Math.min(1, priority + randomFactor));

    return { S, F, C, T, D, L, R };
}

// 批量获取历史数据（带URL和标题双索引）
async function getBatchHistoryDataWithTitle() {
    const urlMap = new Map();
    const titleMap = new Map();

    if (!browserAPI.history) return { urlMap, titleMap };

    try {
        // 获取最近180天的历史记录（折中：相比90天更完整，同时避免一年/10万条带来的峰值压力）
        // 说明：如果后续仍遇到重度历史导致卡顿，可再引入“自适应回退”（先180天，必要时扩展到365天）
        const oneHundredEightyDaysAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
        const historyItems = await new Promise(resolve => {
            browserAPI.history.search({
                text: '',
                startTime: oneHundredEightyDaysAgo,
                maxResults: 50000
            }, resolve);
        });

        for (const item of historyItems) {
            if (!item.url) continue;
            const data = {
                visitCount: item.visitCount || 0,
                lastVisitTime: item.lastVisitTime || 0
            };

            // URL映射
            urlMap.set(item.url, data);

            // 标题映射（合并同标题的访问）
            const title = item.title && item.title.trim();
            if (title) {
                if (!titleMap.has(title)) {
                    titleMap.set(title, data);
                } else {
                    const existing = titleMap.get(title);
                    titleMap.set(title, {
                        visitCount: existing.visitCount + data.visitCount,
                        lastVisitTime: Math.max(existing.lastVisitTime, data.lastVisitTime)
                    });
                }
            }
        }

        console.log('[S值计算] 历史数据已加载:', urlMap.size, '条URL,', titleMap.size, '条标题');
    } catch (e) {
        console.warn('[S值计算] 批量获取历史数据失败:', e);
    }

    // 返回带titleMap的对象
    const result = urlMap;
    result.titleMap = titleMap;
    return result;
}

// 全量计算所有书签S值
async function computeAllBookmarkScores() {
    if (isComputingScores) {
        console.log('[S值计算] 已有计算任务在运行，跳过');
        return false;
    }

    isComputingScores = true;
    console.log('[S值计算] 开始全量计算...');

    try {
        // 获取所有书签
        const tree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
        const allBookmarks = [];
        function traverse(nodes) {
            for (const node of nodes) {
                if (node.url) allBookmarks.push(node);
                if (node.children) traverse(node.children);
            }
        }
        traverse(tree);

        if (allBookmarks.length === 0) {
            isComputingScores = false;
            return true;
        }

        // 获取屏蔽数据和配置
        const [blocked, config, historyStats, trackingData, postponedList, reviewData] = await Promise.all([
            getBlockedDataForScore(),
            getFormulaConfig(),
            getBatchHistoryDataWithTitle(),
            getTrackingDataForScore(),
            getPostponedBookmarksForScore(),
            getReviewDataForScore()
        ]);

        // 过滤屏蔽书签
        const isBlockedDomain = (bookmark) => {
            if (blocked.domains.size === 0 || !bookmark.url) return false;
            try {
                const url = new URL(bookmark.url);
                return blocked.domains.has(url.hostname);
            } catch {
                return false;
            }
        };

        const availableBookmarks = allBookmarks.filter(b =>
            !blocked.bookmarks.has(b.id) &&
            !blocked.folders.has(b.parentId) &&
            !isBlockedDomain(b)
        );

        const totalCount = availableBookmarks.length;
        console.log('[S值计算] 需要计算的书签数量:', totalCount, '(总计:', allBookmarks.length, ')');

        // 根据书签数量确定批次数（与history.js一致）
        let batchCount = 1;
        if (totalCount > 1000) {
            batchCount = 3;
        } else if (totalCount > 500) {
            batchCount = 2;
        }
        const batchSize = Math.ceil(totalCount / batchCount);

        // 分批计算
        const newCache = {};
        for (let i = 0; i < batchCount; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, totalCount);
            const batchBookmarks = availableBookmarks.slice(start, end);

            console.log('[S值计算] 第', i + 1, '批，书签', start + 1, '-', end);

            for (const bookmark of batchBookmarks) {
                const scores = calculateBookmarkScore(bookmark, historyStats, trackingData, config, postponedList, reviewData);
                newCache[bookmark.id] = scores;
            }

            // 批次间暂停50ms，避免阻塞
            if (i < batchCount - 1) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // 保存缓存
        await saveScoresCache(newCache);
        console.log('[S值计算] 全量计算完成，共', Object.keys(newCache).length, '个书签');

        isComputingScores = false;
        return true;
    } catch (error) {
        console.error('[S值计算] 全量计算失败:', error);
        isComputingScores = false;
        return false;
    }
}

// 增量更新单个书签S值
async function updateSingleBookmarkScore(bookmarkId) {
    try {
        const bookmarks = await new Promise(resolve => browserAPI.bookmarks.get([bookmarkId], resolve));
        if (!bookmarks || bookmarks.length === 0) return;

        const bookmark = bookmarks[0];

        // 获取该书签的历史数据（URL和标题双匹配）
        const historyStats = new Map();
        if (browserAPI.history && bookmark.url) {
            const visits = await new Promise(resolve => {
                browserAPI.history.getVisits({ url: bookmark.url }, resolve);
            });
            historyStats.set(bookmark.url, {
                visitCount: visits?.length || 0,
                lastVisitTime: visits?.length > 0 ? Math.max(...visits.map(v => v.visitTime)) : 0
            });

            // 如果需要标题匹配，可以搜索历史
            if (bookmark.title) {
                historyStats.titleMap = new Map();
                try {
                    const historyItems = await new Promise(resolve => {
                        browserAPI.history.search({ text: bookmark.title, maxResults: 100 }, resolve);
                    });
                    for (const item of historyItems) {
                        if (item.title?.trim() === bookmark.title.trim()) {
                            const existing = historyStats.titleMap.get(bookmark.title) || { visitCount: 0, lastVisitTime: 0 };
                            historyStats.titleMap.set(bookmark.title, {
                                visitCount: existing.visitCount + (item.visitCount || 0),
                                lastVisitTime: Math.max(existing.lastVisitTime, item.lastVisitTime || 0)
                            });
                        }
                    }
                } catch (e) {
                    // 忽略标题搜索错误
                }
            }
        }

        const [config, trackingData, postponedList, reviewData] = await Promise.all([
            getFormulaConfig(),
            getTrackingDataForScore(),
            getPostponedBookmarksForScore(),
            getReviewDataForScore()
        ]);

        const scores = calculateBookmarkScore(bookmark, historyStats, trackingData, config, postponedList, reviewData);

        const cache = await getScoresCache();
        cache[bookmarkId] = scores;
        await saveScoresCache(cache);

        console.log('[S值计算] 增量更新:', bookmark.title?.substring(0, 20), 'S=', scores.S.toFixed(3));
    } catch (e) {
        console.warn('[S值计算] 增量更新失败:', e);
    }
}

// 根据URL增量更新对应书签
let pendingUrlUpdates = new Set();
let urlUpdateTimer = null;

async function scheduleScoreUpdateByUrl(url) {
    if (!url) return;
    pendingUrlUpdates.add(url);

    if (urlUpdateTimer) clearTimeout(urlUpdateTimer);

    urlUpdateTimer = setTimeout(async () => {
        const urls = [...pendingUrlUpdates];
        pendingUrlUpdates.clear();
        urlUpdateTimer = null;

        try {
            const tree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
            const bookmarks = [];
            function traverse(nodes) {
                for (const node of nodes) {
                    if (node.url && urls.includes(node.url)) bookmarks.push(node);
                    if (node.children) traverse(node.children);
                }
            }
            traverse(tree);

            for (const bookmark of bookmarks) {
                await updateSingleBookmarkScore(bookmark.id);
            }

            if (bookmarks.length > 0) {
                console.log('[S值计算] URL增量更新完成，共', bookmarks.length, '个书签');
            }
        } catch (e) {
            console.warn('[S值计算] URL增量更新失败:', e);
        }
    }, 1000);
}

// 监听历史访问事件（增量更新）
if (browserAPI.history && browserAPI.history.onVisited) {
    browserAPI.history.onVisited.addListener((result) => {
        if (result && result.url) {
            scheduleScoreUpdateByUrl(result.url);
        }
    });
}

// 监听书签创建事件
browserAPI.bookmarks.onCreated.addListener((id, bookmark) => {
    if (bookmark.url) {
        setTimeout(() => updateSingleBookmarkScore(id), 500);
    }
});

// 监听书签删除事件
browserAPI.bookmarks.onRemoved.addListener(async (id) => {
    const cache = await getScoresCache();
    if (cache[id]) {
        delete cache[id];
        await saveScoresCache(cache);
    }
});

// 监听书签修改事件（URL或标题变化时更新S值）
browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
    if (changeInfo.url || changeInfo.title) {
        console.log('[S值计算] 书签修改，更新S值:', id);
        await updateSingleBookmarkScore(id);
    }
});
