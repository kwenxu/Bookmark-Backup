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
// const EXPORT_ROOT_FOLDER = 'Bookmark Backup';  // 父文件夹保持英文 - REMOVED

function getExportRootFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签备份' : 'Bookmark Backup';
}

// Legacy folder names (compat)
function getLegacyExportRootFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签备份' : 'Bookmark Backup';
}

function getOlderExportRootFolderByLang(lang) {
    return lang === 'zh_CN' ? '书签备份' : 'Bookmark Backup';
}

function getAllExportRootFolderCandidates() {
    return [
        getExportRootFolderByLang('zh_CN'),
        getExportRootFolderByLang('en'),
        getLegacyExportRootFolderByLang('zh_CN'),
        getLegacyExportRootFolderByLang('en'),
        getOlderExportRootFolderByLang('zh_CN'),
        getOlderExportRootFolderByLang('en')
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
    return lang === 'zh_CN' ? '备份历史/自动备份归档' : 'Backup_History/Auto_Archive';
}

function getCurrentChangesFolderByLang(lang) {
    return lang === 'zh_CN' ? '当前变化' : 'Current Changes';
}

function getOverwriteFolderByLang(lang) {
    return lang === 'zh_CN' ? '覆盖' : 'Overwrite';
}

function formatSyncTimeForFileName(syncTime) {
    const date = syncTime ? new Date(syncTime) : new Date();
    const d = Number.isNaN(date.getTime()) ? new Date() : date;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function computeSyncFingerprintByTime(syncTime) {
    try {
        const input = String(syncTime || '');
        let h = 2166136261 >>> 0;
        for (let i = 0; i < input.length; i++) {
            h ^= input.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        const raw = ('00000000' + h.toString(16)).slice(-8).toLowerCase();
        return /^\d+$/.test(raw) ? `a${raw.slice(1)}` : raw;
    } catch (_) {
        const raw = ('00000000' + ((Date.now() >>> 0).toString(16))).slice(-8).toLowerCase();
        return /^\d+$/.test(raw) ? `a${raw.slice(1)}` : raw;
    }
}

function normalizeSyncFingerprint(value) {
    const text = String(value || '').trim().toLowerCase();
    return /^[0-9a-f]{6,12}$/i.test(text) ? text : '';
}

function buildSnapshotNamingContext(options = {}) {
    const syncTime = String(options.syncTime || new Date().toISOString());
    const providedFingerprint = normalizeSyncFingerprint(options.fingerprint);
    const fromSnapshotName = (() => {
        const candidate = String(options.snapshotFileName || options.snapshotFolderName || '');
        const match = /(\d{8}_\d{6}_([0-9a-f]{6,12}))/i.exec(candidate);
        return match ? normalizeSyncFingerprint(match[2]) : '';
    })();
    const fingerprint = providedFingerprint || fromSnapshotName || computeSyncFingerprintByTime(syncTime);
    const timePart = formatSyncTimeForFileName(syncTime);
    const snapshotName = `${timePart}_${fingerprint}.html`;
    const snapshotFolder = `${timePart}_${fingerprint}`;
    return {
        syncTime,
        fingerprint,
        timePart,
        snapshotName,
        snapshotFolder
    };
}

function getOverwriteSnapshotFileName() {
    return 'bookmark_backup.html';
}

function buildCurrentChangesOverwriteLeafName({ mode, format }) {
    const modeText = mode === 'detailed'
        ? 'detailed'
        : (mode === 'collection' ? 'collection' : 'simple');
    const ext = format === 'html' ? 'html' : 'json';
    return `bookmark-changes-${modeText}.${ext}`;
}

function isOverwriteFolderPathLike(pathText) {
    const parts = String(pathText || '')
        .split('/')
        .map(part => String(part || '').trim().toLowerCase())
        .filter(Boolean);
    return parts.some(part => part === '覆盖' || part === 'overwrite');
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


function resolveExportSubFolderByKey(folderKey, lang) {
    const key = String(folderKey || '').trim();
    if (key.startsWith('backup_root/')) {
        return key.slice('backup_root/'.length).replace(/^\/+/, '').replace(/\/+$/, '');
    }
    if (key === 'backup_root') {
        return '';
    }
    if (key === 'backup_root_overwrite') {
        return getOverwriteFolderByLang(lang);
    }
    if (key.startsWith('backup/')) {
        const suffix = key.slice('backup/'.length).replace(/^\/+/, '').replace(/\/+$/, '');
        const base = getBackupFolderByLang(lang);
        return suffix ? `${base}/${suffix}` : base;
    }
    switch (key) {
        case 'backup':
            return getBackupFolderByLang(lang);
        case 'backup_overwrite':
            return `${getBackupFolderByLang(lang)}/${getOverwriteFolderByLang(lang)}`;
        case 'history':
            return getHistoryFolderByLang(lang);
        case 'current_changes':
            return getCurrentChangesFolderByLang(lang);
        case 'backup_history':
            return lang === 'zh_CN' ? '备份历史' : 'Backup_History';
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

// 角标闪烁动画相关变量（用于初始化上传等操作的进度指示）
let badgeBlinkIntervalId = null;
let badgeBlinkState = false;

/**
 * 启动角标呼吸闪烁动画
 * @param {string} text - 闪烁时显示的文字（默认为 "..."）
 * @param {string} color1 - 颜色1（默认橙色）
 * @param {string} color2 - 颜色2（默认浅橙色）
 * @param {number} interval - 闪烁间隔毫秒数（默认500ms）
 */
function startBadgeBlink(text = '...', color1 = '#FF9800', color2 = '#FFE0B2', interval = 500) {
    // 如果已经在闪烁，先停止
    stopBadgeBlink();

    badgeBlinkState = false;

    // 设置初始状态
    browserAPI.action.setBadgeText({ text: text });
    browserAPI.action.setBadgeBackgroundColor({ color: color1 });

    // 启动闪烁定时器
    badgeBlinkIntervalId = setInterval(() => {
        badgeBlinkState = !badgeBlinkState;
        const color = badgeBlinkState ? color2 : color1;
        browserAPI.action.setBadgeBackgroundColor({ color: color });
    }, interval);
}

/**
 * 停止角标闪烁动画并恢复正常状态
 */
function stopBadgeBlink() {
    if (badgeBlinkIntervalId) {
        clearInterval(badgeBlinkIntervalId);
        badgeBlinkIntervalId = null;
    }
    badgeBlinkState = false;
}

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
// Keyboard commands for opening history views (Alt/Option + 1~2)
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
        if (isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging) return;
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
        if (isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging) return;
        cachedBookmarkAnalysis = null; // Invalidate cache
        // 从所有记录中移除该节点（书签Git风格）
        try {
            removeFromAllRecords(id);
        } catch (_) { }
    });

    // 监听书签移动事件
    browserAPI.bookmarks.onMoved.addListener((id, moveInfo) => {
        if (isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging) return;
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
                if (isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging) {
                    return;
                }
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
        if (isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging) return;
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

// 迁移到分离存储架构（Index vs Data）
async function migrateToSplitStorage() {
    try {
        const { syncHistory } = await browserAPI.storage.local.get(['syncHistory']);
        if (!syncHistory || !Array.isArray(syncHistory) || syncHistory.length === 0) return;

        // 检查是否需要迁移（记录中仍包含 bookmarkTree）
        const needsMigration = syncHistory.some(r => r.bookmarkTree !== undefined && r.bookmarkTree !== null);
        if (!needsMigration) return;

        console.log('[Migration] Starting migration to split storage (Index vs Data)...');
        const newIndex = [];
        const storageUpdates = {};

        for (const record of syncHistory) {
            const indexRecord = { ...record };
            if (record.bookmarkTree) {
                const treeKey = `backup_data_${record.time}`;
                storageUpdates[treeKey] = record.bookmarkTree;
                delete indexRecord.bookmarkTree;
                indexRecord.hasData = true;
            } else {
                delete indexRecord.bookmarkTree;
                indexRecord.hasData = indexRecord.hasData === true;
            }
            newIndex.push(indexRecord);
        }

        storageUpdates.syncHistory = newIndex;
        await browserAPI.storage.local.set(storageUpdates);
        console.log('[Migration] Migration completed. Records processed:', newIndex.length);
    } catch (e) {
        console.error('[Migration] Failed:', e);
    }
}

async function removeBackupDataByTimes(times) {
    const keys = (Array.isArray(times) ? times : [])
        .filter(t => t !== undefined && t !== null && String(t).trim() !== '')
        .map(t => `backup_data_${t}`);
    if (keys.length > 0) {
        await browserAPI.storage.local.remove(keys);
    }
}


// =================================================================================
// II. CORE EVENT LISTENERS (核心事件监听器)
// =================================================================================

// 初始化定时任务
browserAPI.runtime.onInstalled.addListener(async (details) => { // 添加 async 和 details 参数
    // 立即尝试迁移旧数据
    await migrateToSplitStorage();

    // 新增：初始化存储，确保首次运行时有基准
    if (details.reason === 'install' || details.reason === 'update') {
        try {
            const currentData = await browserAPI.storage.local.get([
                'lastBookmarkData',
                'lastCalculatedDiff',
                'lastSyncStats' // 可选：也初始化 lastSyncStats
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
    // 启动时也尝试迁移旧数据
    await migrateToSplitStorage();

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
let isBookmarkRestoring = false; // 书签恢复期间暂停监听
let isBookmarkBulkChanging = false; // 大量变化期间：暂停昂贵计算
let bookmarkImportFlushTimer = null;

// 大量变化检测：当书签事件短时间内爆发时，进入 Bulk Mode
const BOOKMARK_BULK_WINDOW_MS = 1500;
const BOOKMARK_BULK_THRESHOLD = 30;
const BOOKMARK_BULK_QUIET_MS = 1200;
let bookmarkBulkWindowStart = 0;
let bookmarkBulkEventCount = 0;
let bookmarkBulkExitTimer = null;
let skipNextBulkGuardCount = false;

// =============================================================================
// “当前变化”持久缓存：增量更新（避免每次小改动全量重算）
// =============================================================================

const CURRENT_CHANGES_CACHE_KEY = 'current-changes-cache:v1';
let pendingChangeCacheDeltas = [];
let pendingChangeCacheFlushTimer = null;

function __buildBookmarkFingerprintKey(item) {
    if (!item) return '';
    const path = typeof item.path === 'string' ? item.path : '';
    const title = typeof item.title === 'string' ? item.title : '';
    const url = typeof item.url === 'string' ? item.url : '';
    return `B:${path}|${title}|${url}`;
}

function __getFolderPathByIdFromIndex(id) {
    try {
        if (!id) return '';
        const idx = BookmarkSnapshotCache.index;
        if (!idx || !(idx instanceof Map)) return '';
        let cur = String(id);
        const parts = [];
        let guard = 0;
        while (cur && guard++ < 64) {
            if (cur === '0') break;
            const info = idx.get(cur);
            if (!info) break;
            if (info.title) parts.push(info.title);
            cur = info.parentId;
            if (!cur) break;
        }
        parts.reverse();
        return parts.join('/');
    } catch (_) {
        return '';
    }
}

function __normalizeChangeDataShape(data) {
    const out = data && typeof data === 'object' ? data : { hasChanges: false };
    out.added = Array.isArray(out.added) ? out.added : [];
    out.deleted = Array.isArray(out.deleted) ? out.deleted : [];
    out.moved = Array.isArray(out.moved) ? out.moved : [];
    out.modified = Array.isArray(out.modified) ? out.modified : [];
    return out;
}

function __indexListByKey(list) {
    const m = new Map();
    (Array.isArray(list) ? list : []).forEach((it) => {
        const k = __buildBookmarkFingerprintKey(it);
        if (k) m.set(k, it);
    });
    return m;
}

function __mapToArrayStable(map) {
    try { return Array.from(map.values()); } catch (_) { return []; }
}

function __applyDeltasToChangeData(changeData, deltas) {
    const data = __normalizeChangeDataShape(changeData);
    const addedMap = __indexListByKey(data.added);
    const deletedMap = __indexListByKey(data.deleted);
    const movedMap = __indexListByKey(data.moved);
    const modifiedMap = __indexListByKey(data.modified);

    const bump = (k, delta) => {
        if (!data.stats || typeof data.stats !== 'object') return;
        if (typeof data.stats[k] === 'number') data.stats[k] += delta;
    };

    for (const d of deltas) {
        if (!d || !d.kind) continue;
        if (d.nodeType === 'folder') {
            if (d.kind === 'created') bump('folderAdded', 1);
            if (d.kind === 'removed') bump('folderDeleted', 1);
            if (d.kind === 'moved') data.stats && (data.stats.folderMoved = true);
            if (d.kind === 'changed') data.stats && (data.stats.folderModified = true);
            continue;
        }

        const item = d.item;
        if (!item || !item.url) continue;
        const key = __buildBookmarkFingerprintKey(item);
        if (!key) continue;

        if (d.kind === 'created') {
            if (deletedMap.has(key)) {
                deletedMap.delete(key);
                bump('bookmarkDeleted', -1);
            } else {
                addedMap.set(key, item);
                bump('bookmarkAdded', 1);
            }
            continue;
        }

        if (d.kind === 'removed') {
            if (addedMap.has(key)) {
                addedMap.delete(key);
                bump('bookmarkAdded', -1);
            } else {
                deletedMap.set(key, item);
                bump('bookmarkDeleted', 1);
            }
            continue;
        }

        if (d.kind === 'moved') {
            // moved 以“新位置 fingerprint”为 key；如该书签之前是 added，则只更新其 path（仍归类为 added）
            const old = d.oldItem;
            const oldKey = old ? __buildBookmarkFingerprintKey(old) : '';

            if (oldKey && addedMap.has(oldKey)) {
                addedMap.delete(oldKey);
                addedMap.set(key, item);
            } else {
                const movedItem = { ...item, oldPath: d.oldPath || (old ? old.path : '') || '', oldTitle: d.oldTitle || (old ? old.title : '') || '', changeType: 'moved' };
                movedMap.set(key, movedItem);
                data.stats && (data.stats.bookmarkMoved = true);
                if (typeof data.stats.movedCount === 'number') data.stats.movedCount += 1;
            }
            continue;
        }

        if (d.kind === 'changed') {
            const old = d.oldItem;
            const oldKey = old ? __buildBookmarkFingerprintKey(old) : '';

            if (oldKey && addedMap.has(oldKey)) {
                addedMap.delete(oldKey);
                addedMap.set(key, item);
            } else {
                const modItem = { ...item, oldTitle: d.oldTitle || (old ? old.title : '') || '', changeType: 'modified' };
                modifiedMap.set(key, modItem);
                data.stats && (data.stats.bookmarkModified = true);
                if (typeof data.stats.modifiedCount === 'number') data.stats.modifiedCount += 1;
            }
            continue;
        }
    }

    data.added = __mapToArrayStable(addedMap);
    data.deleted = __mapToArrayStable(deletedMap);
    data.moved = __mapToArrayStable(movedMap);
    data.modified = __mapToArrayStable(modifiedMap);
    data.hasChanges = true;
    return data;
}

function enqueueChangeCacheDelta(delta) {
    try {
        if (!delta) return;
        pendingChangeCacheDeltas.push(delta);
        if (pendingChangeCacheFlushTimer) clearTimeout(pendingChangeCacheFlushTimer);
        pendingChangeCacheFlushTimer = setTimeout(() => {
            pendingChangeCacheFlushTimer = null;
            flushChangeCacheDeltas().catch(() => { });
        }, 900);
    } catch (_) { }
}

async function flushChangeCacheDeltas() {
    const deltas = pendingChangeCacheDeltas;
    pendingChangeCacheDeltas = [];
    if (!deltas.length) return;

    const store = await browserAPI.storage.local.get([CURRENT_CHANGES_CACHE_KEY, 'lastBookmarkData', 'lastBookmarkChangeTime']);
    const payload = store ? store[CURRENT_CHANGES_CACHE_KEY] : null;
    if (!payload || !payload.data || !payload.meta) return;

    const baselineTs = store?.lastBookmarkData?.timestamp || null;
    if (payload.meta.lastBookmarkDataTimestamp !== baselineTs) return;

    // 确保 index 是新鲜的（用来计算 path / title / url）
    try { await BookmarkSnapshotCache.ensureFresh(); } catch (_) { }
    if (!BookmarkSnapshotCache.index) {
        try { BookmarkSnapshotCache.buildIndex(BookmarkSnapshotCache.tree); } catch (_) { }
    }

    const normalized = [];
    for (const d of deltas) {
        if (!d || !d.kind) continue;
        if (d.nodeType === 'folder') {
            normalized.push(d);
            continue;
        }

        const id = d.id ? String(d.id) : '';
        const idx = BookmarkSnapshotCache.index;
        const nowInfo = (idx && id) ? idx.get(id) : null;

        // 构造当前 item
        const title = d.titleOverride || (nowInfo ? nowInfo.title : d.title) || '';
        const url = d.urlOverride || (nowInfo ? nowInfo.url : d.url) || '';
        const parentId = d.parentIdOverride || (nowInfo ? nowInfo.parentId : d.parentId) || '';
        const path = __getFolderPathByIdFromIndex(parentId);

        const item = { path, title, url };

        // 构造 oldItem（用于 moved/changed）
        let oldItem = null;
        if (d.oldParentId || d.oldTitle || d.oldUrl || d.oldPath) {
            oldItem = {
                path: typeof d.oldPath === 'string' ? d.oldPath : __getFolderPathByIdFromIndex(d.oldParentId || ''),
                title: typeof d.oldTitle === 'string' ? d.oldTitle : title,
                url: typeof d.oldUrl === 'string' ? d.oldUrl : url
            };
        }

        normalized.push({
            kind: d.kind,
            nodeType: 'bookmark',
            id,
            item,
            oldItem,
            oldPath: d.oldPath || (oldItem ? oldItem.path : ''),
            oldTitle: d.oldTitle || (oldItem ? oldItem.title : '')
        });
    }

    const updated = __applyDeltasToChangeData(payload.data, normalized);
    const lastChangeTime = typeof store?.lastBookmarkChangeTime === 'number' ? store.lastBookmarkChangeTime : 0;

    await browserAPI.storage.local.set({
        [CURRENT_CHANGES_CACHE_KEY]: {
            meta: { lastBookmarkDataTimestamp: baselineTs, lastBookmarkChangeTime: lastChangeTime },
            data: updated,
            cachedAt: Date.now()
        }
    });
}

const BookmarkSnapshotCache = {
    tree: null,
    index: null,
    version: 0,
    stale: true,
    buildPromise: null,
    rebuildTimer: null,
    lastBuildAt: 0,

     // MV3 service worker may be suspended; keep a session-level snapshot to speed up UI refresh.
     // This avoids a cold-start bookmarks.getTree() in many refresh scenarios.
     sessionKey: 'bookmarkSnapshotCache:v1',

     async loadFromSession() {
         try {
             if (!browserAPI?.storage?.session) return null;
             const data = await browserAPI.storage.session.get([this.sessionKey]);
             const payload = data ? data[this.sessionKey] : null;
             if (!payload || !Array.isArray(payload.tree)) return null;
             return payload;
         } catch (_) {
             return null;
         }
     },

     async saveToSession() {
         try {
             if (!browserAPI?.storage?.session) return;
             if (!this.tree) return;
             const payload = {
                 tree: this.tree,
                 version: this.version,
                 lastBuildAt: this.lastBuildAt
             };
             await browserAPI.storage.session.set({ [this.sessionKey]: payload });
         } catch (_) {
             // ignore
         }
     },

     buildIndex(tree) {
         try {
             const map = new Map();
             if (!Array.isArray(tree) || !tree.length) {
                 this.index = map;
                 return map;
             }
             const stack = [...tree];
             while (stack.length) {
                 const n = stack.pop();
                 if (!n || typeof n.id === 'undefined' || n.id === null) continue;
                 const id = String(n.id);
                 map.set(id, {
                     id,
                     title: typeof n.title === 'string' ? n.title : '',
                     url: typeof n.url === 'string' ? n.url : '',
                     parentId: (typeof n.parentId === 'string' || typeof n.parentId === 'number') ? String(n.parentId) : ''
                 });
                 if (Array.isArray(n.children) && n.children.length) {
                     for (let i = n.children.length - 1; i >= 0; i--) {
                         const c = n.children[i];
                         if (c && (typeof c.parentId === 'undefined' || c.parentId === null)) {
                             try { c.parentId = n.id; } catch (_) { }
                         }
                         stack.push(c);
                     }
                 }
             }
             this.index = map;
             return map;
         } catch (_) {
             this.index = new Map();
             return this.index;
         }
     },

    async ensureFresh() {
        if (this.buildPromise) return this.buildPromise;
        if (!this.stale) return this.tree;
        // 导入期间：如果已有快照，避免被 UI 读取触发频繁 getTree（等导入结束后统一刷新）
        if (isBookmarkImporting && this.tree) return this.tree;

         // Cold start: try restore from session cache first.
         // If this succeeds we can immediately serve UI without waiting for bookmarks.getTree().
          if (!this.tree) {
              const restored = await this.loadFromSession();
              if (restored) {
                  this.tree = restored.tree;
                  this.version = typeof restored.version === 'number' ? restored.version : this.version;
                  this.lastBuildAt = typeof restored.lastBuildAt === 'number' ? restored.lastBuildAt : this.lastBuildAt;
                  this.buildIndex(this.tree);
                  this.stale = false;
                  return this.tree;
              }
          }

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

             this.buildIndex(this.tree);

              await this.saveToSession();
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

// =============================================================================
// 大量变化防护（Bulk Mode）
// - 用于“批量导入/批量删除/大范围移动/恢复”等场景
// - 策略：暂停昂贵的分析/通信，等待安静期后再统一刷新
// =============================================================================

function scheduleBookmarkBulkExit() {
    if (bookmarkBulkExitTimer) {
        clearTimeout(bookmarkBulkExitTimer);
    }

    bookmarkBulkExitTimer = setTimeout(() => {
        bookmarkBulkExitTimer = null;
        exitBookmarkBulkChangeMode().catch(() => { });
    }, BOOKMARK_BULK_QUIET_MS);
}

async function enterBookmarkBulkChangeMode(reason = '') {
    if (isBookmarkBulkChanging) {
        scheduleBookmarkBulkExit();
        return;
    }

    isBookmarkBulkChanging = true;
    console.log('[BulkGuard] Enter bulk bookmark change mode:', reason);

    try {
        await browserAPI.storage.local.set({ bookmarkBulkChangeFlag: true });
    } catch (_) { }

    scheduleBookmarkBulkExit();
}

async function exitBookmarkBulkChangeMode() {
    if (!isBookmarkBulkChanging) return;

    isBookmarkBulkChanging = false;
    bookmarkBulkWindowStart = 0;
    bookmarkBulkEventCount = 0;

    console.log('[BulkGuard] Exit bulk bookmark change mode');

    try {
        await browserAPI.storage.local.set({ bookmarkBulkChangeFlag: false });
    } catch (_) { }

    // 结束后统一触发一次变更处理（角标/分析/可能的实时备份）
    try {
        skipNextBulkGuardCount = true;
        handleBookmarkChange();
    } catch (_) { }
}

function noteBookmarkEventForBulkGuard() {
    // 内部主动 flush 时跳过计数，避免自触发进入 bulk
    if (skipNextBulkGuardCount) {
        skipNextBulkGuardCount = false;
        return;
    }

    // 导入/恢复本身有独立的 flag，不需要重复进入 bulk
    if (isBookmarkImporting || isBookmarkRestoring) {
        return;
    }

    const now = Date.now();
    if (!bookmarkBulkWindowStart || (now - bookmarkBulkWindowStart) > BOOKMARK_BULK_WINDOW_MS) {
        bookmarkBulkWindowStart = now;
        bookmarkBulkEventCount = 0;
    }

    bookmarkBulkEventCount += 1;

    if (!isBookmarkBulkChanging && bookmarkBulkEventCount >= BOOKMARK_BULK_THRESHOLD) {
        enterBookmarkBulkChangeMode(`events=${bookmarkBulkEventCount}`).catch(() => { });
    }

    if (isBookmarkBulkChanging) {
        scheduleBookmarkBulkExit();
    }
}

// 监听来自popup的消息
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 基础校验
    if (!message || typeof message !== 'object' || !message.action) {
        sendResponse({ success: false, error: '无效的消息格式' });
        return;
    }

    try {
        if (message.action === "extensionBookmarkOpen") {
            // 书签备份项目不维护推荐/追踪归因，收到该消息时直接忽略以避免报错
            sendResponse({ success: true, ignored: true });
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
                        'hideDownloadShelf'
                    ]);

                    // 检查是否有本地配置
                    const defaultDownloadEnabled = config.defaultDownloadEnabled === true;
                    const localBackupConfigured = defaultDownloadEnabled;

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
                    // 支持两种方式传递二进制数据：
                    // 1. contentArrayBuffer - 直接传递 ArrayBuffer（可能在某些情况下丢失）
                    // 2. contentBase64Binary - Base64 编码的二进制数据（推荐，可靠传递）
                    let contentArrayBuffer = message.contentArrayBuffer || null;

                    // 如果收到 Base64 编码的二进制数据，转换回 ArrayBuffer
                    if (!contentArrayBuffer && message.contentBase64Binary) {
                        try {
                            const base64 = message.contentBase64Binary;
                            const binaryString = atob(base64);
                            const len = binaryString.length;
                            const bytes = new Uint8Array(len);
                            for (let i = 0; i < len; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            contentArrayBuffer = bytes.buffer;
                        } catch (e) {
                            console.error('[exportFileToClouds] Base64 解码失败:', e);
                        }
                    }

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
        } else if (message.action === "setBookmarkRestoringFlag") {
            const next = !!message.value;
            isBookmarkRestoring = next;
            try {
                browserAPI.storage.local.set({ bookmarkRestoringFlag: isBookmarkRestoring }, () => { });
            } catch (_) { }
            sendResponse({ success: true, isRestoring: isBookmarkRestoring });
            return false;
        } else if (message.action === "triggerRestoreBackup") {
            (async () => {
                try {
                    const note = String(message.note || '').trim();
                    const sourceSeqNumber = message.sourceSeqNumber;
                    const sourceTime = message.sourceTime;
                    const sourceNote = message.sourceNote || '';
                    const strategy = message.strategy || 'overwrite';
                    const sourceFingerprint = message.sourceFingerprint || '';

                    const {
                        syncHistory: historyBeforeRestoreRecord = [],
                        cachedRecordAfterClear = null,
                        restoreBaselineSnapshot = null
                    } = await browserAPI.storage.local.get([
                        'syncHistory',
                        'cachedRecordAfterClear',
                        'restoreBaselineSnapshot'
                    ]);

                    let baselineTree = null;
                    let baselineTime = '';

                    try {
                        const capturedAt = Number(restoreBaselineSnapshot?.capturedAt || 0);
                        const ageMs = Date.now() - capturedAt;
                        if (
                            capturedAt > 0 &&
                            ageMs >= 0 &&
                            ageMs <= 10 * 60 * 1000 &&
                            isBookmarkTreeShapeValid(restoreBaselineSnapshot?.bookmarkTree)
                        ) {
                            baselineTree = Array.isArray(restoreBaselineSnapshot.bookmarkTree)
                                ? restoreBaselineSnapshot.bookmarkTree
                                : [restoreBaselineSnapshot.bookmarkTree];
                            baselineTime = restoreBaselineSnapshot?.capturedAtIso || '';
                        }
                    } catch (_) { }

                    if (!baselineTree && isBookmarkTreeShapeValid(cachedRecordAfterClear?.bookmarkTree)) {
                        baselineTree = Array.isArray(cachedRecordAfterClear.bookmarkTree)
                            ? cachedRecordAfterClear.bookmarkTree
                            : [cachedRecordAfterClear.bookmarkTree];
                        baselineTime = String(cachedRecordAfterClear?.time || '');
                    }

                    if (restoreBaselineSnapshot) {
                        try {
                            await browserAPI.storage.local.remove(['restoreBaselineSnapshot']);
                        } catch (_) { }
                    }

                    // 恢复/覆盖/导入合并：始终写入一条独立历史记录（不依赖外部备份配置）。
                    const syncTime = new Date().toISOString();
                    await updateSyncStatus('local', syncTime, 'success', '', 'manual', null);

                    const { syncHistory = [] } = await browserAPI.storage.local.get(['syncHistory']);
                    if (syncHistory.length > 0) {
                        let targetIndex = syncHistory.findIndex(r => String(r?.time) === String(syncTime));
                        if (targetIndex < 0) targetIndex = syncHistory.length - 1;

                        const targetRecord = syncHistory[targetIndex];
                        if (targetRecord) {
                            targetRecord.type = 'restore';
                            if (note) targetRecord.note = note;
                            targetRecord.restoreInfo = {
                                sourceSeqNumber,
                                sourceTime,
                                sourceNote,
                                sourceFingerprint,
                                strategy,
                                baselineTime
                            };

                            // 首条恢复记录也应尽量按“恢复前基线”计算变化，避免被误判为“首次备份全量新增”。
                            if (baselineTree && baselineTree.length > 0) {
                                try {
                                    const treeKey = `backup_data_${syncTime}`;
                                    const treeData = await browserAPI.storage.local.get([treeKey]);
                                    let currentTree = treeData[treeKey];

                                    if (!isBookmarkTreeShapeValid(currentTree)) {
                                        currentTree = await browserAPI.bookmarks.getTree();
                                    }

                                    if (isBookmarkTreeShapeValid(currentTree)) {
                                        const normalizedCurrentTree = Array.isArray(currentTree) ? currentTree : [currentTree];
                                        const diffSummary = computeBookmarkGitDiffSummary(baselineTree, normalizedCurrentTree);
                                        const prevBookmarkCount = countAllBookmarks(baselineTree);
                                        const prevFolderCount = countAllFolders(baselineTree);
                                        const currentBookmarkCount = countAllBookmarks(normalizedCurrentTree);
                                        const currentFolderCount = countAllFolders(normalizedCurrentTree);

                                        targetRecord.bookmarkStats = {
                                            currentBookmarkCount,
                                            currentFolderCount,
                                            prevBookmarkCount,
                                            prevFolderCount,
                                            bookmarkDiff: currentBookmarkCount - prevBookmarkCount,
                                            folderDiff: currentFolderCount - prevFolderCount,
                                            bookmarkAdded: diffSummary.bookmarkAdded,
                                            bookmarkDeleted: diffSummary.bookmarkDeleted,
                                            folderAdded: diffSummary.folderAdded,
                                            folderDeleted: diffSummary.folderDeleted,
                                            explicitMovedIds: [],
                                            bookmarkMoved: !!diffSummary.bookmarkMoved,
                                            folderMoved: !!diffSummary.folderMoved,
                                            bookmarkModified: !!diffSummary.bookmarkModified,
                                            folderModified: !!diffSummary.folderModified,
                                            movedCount: diffSummary.movedCount || 0,
                                            modifiedCount: diffSummary.modifiedCount || 0,
                                            addedCount: (diffSummary.bookmarkAdded || 0) + (diffSummary.folderAdded || 0),
                                            deletedCount: (diffSummary.bookmarkDeleted || 0) + (diffSummary.folderDeleted || 0),
                                            movedBookmarkCount: diffSummary.movedBookmarkCount || 0,
                                            movedFolderCount: diffSummary.movedFolderCount || 0,
                                            modifiedBookmarkCount: diffSummary.modifiedBookmarkCount || 0,
                                            modifiedFolderCount: diffSummary.modifiedFolderCount || 0
                                        };

                                        targetRecord.isFirstBackup = false;
                                    }
                                } catch (diffError) {
                                    console.warn('[triggerRestoreBackup] 基线差异计算失败:', diffError);
                                }
                            }

                            syncHistory[targetIndex] = targetRecord;
                            await browserAPI.storage.local.set({ syncHistory });
                        }
                    }

                    // 当历史为空时，保留恢复前基线，便于 HTML 页面首条记录计算变化。
                    if (baselineTree && historyBeforeRestoreRecord.length === 0) {
                        try {
                            await browserAPI.storage.local.set({
                                cachedRecordAfterClear: {
                                    bookmarkTree: baselineTree,
                                    bookmarkStats: null,
                                    time: baselineTime || syncTime
                                }
                            });
                        } catch (_) { }
                    }

                    await updateBadgeAfterSync(true);
                    await updateAndCacheAnalysis();
                    await setBadge();

                    try {
                        await browserAPI.runtime.sendMessage({
                            action: 'bookmarkChanged',
                            source: 'restore'
                        });
                    } catch (_) { }

                    sendResponse({ success: true, syncTime, strategy });
                } catch (error) {
                    console.error('[triggerRestoreBackup] 失败:', error);
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true;
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
            // 撤销全部变化：根据变化比例自动选择补丁撤销/覆盖撤销
            (async () => {
                try {
                    const { lastBookmarkData = null, preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['lastBookmarkData', 'preferredLang']);
                    const tree = lastBookmarkData && lastBookmarkData.bookmarkTree;
                    const hasValidTree = isBookmarkTreeShapeValid(tree);
                    if (!hasValidTree) {
                        sendResponse({ success: false, error: preferredLang === 'en' ? 'No valid backup snapshot' : '没有可用的备份快照' });
                        return;
                    }

                    if (!hasBookmarkTreeContent(tree)) {
                        const currentCount = await getCurrentRestorableNodeCount();
                        if (currentCount > 0) {
                            sendResponse({ success: false, error: buildEmptySnapshotError(preferredLang, 'revert') });
                            return;
                        }
                        sendResponse({ success: true, skipped: true, message: buildEmptySnapshotNoopMessage(preferredLang, 'revert'), strategy: 'overwrite' });
                        return;
                    }

                    const requestedStrategy = normalizeRevertStrategySelection(message.strategy);
                    const thresholdConfig = resolveRevertPatchThreshold(message.thresholdPercent);
                    const currentTree = await browserAPI.bookmarks.getTree();
                    const diffSummary = computeIdStrictRevertDiffSummary(currentTree, tree);

                    let baselineNodeCount = Number(lastBookmarkData && lastBookmarkData.bookmarkCount) + Number(lastBookmarkData && lastBookmarkData.folderCount);
                    if (!Number.isFinite(baselineNodeCount) || baselineNodeCount <= 0) {
                        baselineNodeCount = countAllBookmarks(tree) + countAllFolders(tree);
                    }

                    const decision = selectRevertStrategyForLastBackup({
                        requestedStrategy,
                        diffSummary,
                        baselineNodeCount,
                        thresholdRatio: thresholdConfig.thresholdRatio,
                        thresholdPercent: thresholdConfig.thresholdPercent
                    });

                    let appliedStrategy = decision.strategy;
                    let patchResult = null;

                    if (appliedStrategy === 'patch') {
                        try {
                            patchResult = await executePatchBookmarkRevert(tree, {
                                baselineTimestamp: lastBookmarkData.timestamp,
                                preferredLang
                            });
                        } catch (patchError) {
                            if (requestedStrategy === 'patch') {
                                throw patchError;
                            }
                            console.warn('[revertAllToLastBackup] Patch revert failed, fallback to overwrite:', patchError);
                            appliedStrategy = 'overwrite';
                            await restoreSnapshotTree(tree, {
                                baselineTimestamp: lastBookmarkData.timestamp,
                                preferredLang
                            });
                        }
                    } else {
                        await restoreSnapshotTree(tree, {
                            baselineTimestamp: lastBookmarkData.timestamp,
                            preferredLang
                        });
                    }

                    sendResponse({
                        success: true,
                        strategy: appliedStrategy,
                        requestedStrategy,
                        changeRatio: decision.changeRatio,
                        changeScore: decision.changeScore,
                        baselineNodeCount: decision.baselineNodeCount,
                        thresholdRatio: decision.thresholdRatio,
                        thresholdPercent: decision.thresholdPercent,
                        fallbackApplied: decision.strategy !== appliedStrategy,
                        ...(patchResult || {})
                    });
                } catch (error) {
                    sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
                }
            })();
            return true;

        } else if (message.action === 'restoreToHistoryRecord') {
            // 恢复到指定备份记录
            (async () => {
                try {
                    const recordTime = message.time;
                    const strategy = message.strategy || 'overwrite';
                    const { preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);
                    if (!recordTime) {
                        sendResponse({ success: false, error: preferredLang === 'en' ? 'Missing record time' : '缺少记录时间' });
                        return;
                    }

                    const { syncHistory = [] } = await browserAPI.storage.local.get(['syncHistory']);
                    const record = syncHistory.find(r => String(r.time) === String(recordTime));
                    if (!record) {
                        sendResponse({ success: false, error: preferredLang === 'en' ? 'Record not found' : '未找到对应记录' });
                        return;
                    }

                    let tree = record.bookmarkTree;
                    if (!tree && record.hasData) {
                        const treeKey = `backup_data_${record.time}`;
                        const treeData = await browserAPI.storage.local.get([treeKey]);
                        tree = treeData[treeKey];
                    }

                    if (!tree) {
                        sendResponse({ success: false, error: preferredLang === 'en' ? 'No snapshot data' : '没有可用的快照数据' });
                        return;
                    }

                    const mode = strategy === 'merge' ? 'merge' : 'overwrite';

                    if (!hasBookmarkTreeContent(tree)) {
                        if (mode === 'merge') {
                            throw new Error(buildEmptySnapshotError(preferredLang, 'merge'));
                        }

                        const currentCount = await getCurrentRestorableNodeCount();
                        if (currentCount > 0) {
                            throw new Error(buildEmptySnapshotError(preferredLang, 'overwrite'));
                        }

                        sendResponse({ success: true, skipped: true, message: buildEmptySnapshotNoopMessage(preferredLang, 'overwrite') });
                        return;
                    }

                    assertBookmarkTreeContent(tree, preferredLang, mode);

                    if (strategy === 'merge') {
                        await mergeSnapshotTree(tree, { preferredLang });
                    } else {
                        await restoreSnapshotTree(tree, {
                            baselineTimestamp: record.time,
                            preferredLang
                        });
                    }

                    sendResponse({ success: true });
                } catch (error) {
                    sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
                }
            })();
            return true;

        } else if (message.action === "initSync") {
            if (message.direction === "upload") {
                // 启动角标呼吸闪烁，提示用户正在进行初始化上传
                startBadgeBlink('...', '#FF9800', '#FFE0B2', 400);

                // 上传本地书签到云端/本地
                browserAPI.bookmarks.getTree()
                    .then(async (bookmarks) => {
                        try {
                            const syncTime = new Date().toISOString();
                            const snapshotNaming = buildSnapshotNamingContext({ syncTime });

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
                                'defaultDownloadEnabled'
                            ]);

                            // 检查是否启用任一本地备份方式
                            const defaultDownloadEnabled = localConfig.defaultDownloadEnabled === true;
                            // 检查至少有一种备份方式已配置
                            const localBackupConfigured = defaultDownloadEnabled;
                            // const hasAtLeastOneConfigured = (webDAVConfigured && webDAVEnabled) || localBackupConfigured; // Original was this

                            // 上传到WebDAV（如果启用且已配置）
                            if (webDAVConfigured && webDAVEnabled) {
                                try {
                                    const uploadResult = await uploadBookmarks(bookmarks, snapshotNaming);
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
                                    const uploadResult = await uploadBookmarksToGitHubRepo(bookmarks, snapshotNaming);
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
                                    const localResult = await uploadBookmarksToLocal(bookmarks, snapshotNaming);
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
                            const syncStatus = (webDAVSuccess || githubRepoSuccess || localSuccess) ? 'success' : 'error';
                            const errorMessage = errors.length > 0 ? errors.join('; ') : '';
                            // --- 修改：传递 'auto' 作为 syncType ---
                            await updateSyncStatus(syncDirection, syncTime, syncStatus, errorMessage, 'auto', null, snapshotNaming.fingerprint);

                            // --- 新增：在成功后调用 setBadge ---
                            // 停止角标闪烁
                            stopBadgeBlink();

                            // 恢复正常角标状态
                            try {
                                await setBadge(); // 更新角标为正常状态
                            } catch (badgeError) {
                                console.error('[initSync] 更新角标失败:', badgeError);
                            }
                            // --- 结束新增 ---

                            // 注意：角标闪烁已停止，用户可通过角标恢复正常状态判断操作完成

                            sendResponse({
                                success: (webDAVSuccess || githubRepoSuccess || localSuccess),
                                webDAVSuccess,
                                githubRepoSuccess,
                                localSuccess,
                                localFileName: result.localFileName, // 添加文件名到响应
                                error: errors.length > 0 ? errors.join('; ') : null
                            });
                        } catch (error) {
                            // 停止角标闪烁
                            stopBadgeBlink();
                            // 尝试恢复正常角标状态
                            try {
                                await setBadge();
                            } catch (e) { }

                            sendResponse({
                                success: false,
                                error: error.message || '上传失败'
                            });
                        }
                    })
                    .catch(async (error) => {
                        // 停止角标闪烁
                        stopBadgeBlink();
                        // 尝试恢复正常角标状态
                        try {
                            await setBadge();
                        } catch (e) { }

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
        } else if (message.action === 'buildCurrentChangesManualExport') {
            (async () => {
                try {
                    const requestedMode = String(message.mode || '').toLowerCase();
                    const mode = requestedMode === 'detailed'
                        ? 'detailed'
                        : (requestedMode === 'collection' ? 'collection' : 'simple');
                    const format = String(message.format || '').toLowerCase() === 'json' ? 'json' : 'html';
                    const lang = message.lang === 'zh_CN' || message.lang === 'en'
                        ? message.lang
                        : await getCurrentLang();

                    const localBookmarks = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
                    const optionMovedIds = Array.isArray(message.explicitMovedIds)
                        ? message.explicitMovedIds.map(v => String(v || '').trim()).filter(Boolean)
                        : [];

                    const movedStore = await browserAPI.storage.local.get(['recentMovedIds']);
                    const storageMovedIds = Array.isArray(movedStore?.recentMovedIds)
                        ? movedStore.recentMovedIds.map(r => String((r && r.id) || '').trim()).filter(Boolean)
                        : [];

                    const explicitMovedIds = Array.from(new Set(optionMovedIds.length > 0 ? optionMovedIds : storageMovedIds));
                    const forceExpandedIds = Array.isArray(message.expandedIds) ? message.expandedIds : null;

                    const artifact = await buildCurrentChangesManualExportArtifact({
                        mode,
                        format,
                        lang,
                        explicitMovedIds,
                        localBookmarks,
                        forceExpandedIds
                    });

                    if (!artifact || typeof artifact.content !== 'string') {
                        throw new Error(lang === 'zh_CN' ? '未生成导出内容' : 'No export content generated');
                    }

                    sendResponse({
                        success: true,
                        mode,
                        format,
                        content: artifact.content,
                        contentType: artifact.contentType || (format === 'json' ? 'application/json;charset=utf-8' : 'text/html;charset=utf-8'),
                        fileName: artifact.leafName || ''
                    });
                } catch (error) {
                    sendResponse({
                        success: false,
                        error: error?.message || '构建当前变化导出失败'
                    });
                }
            })();
            return true; // 保持消息通道开放
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
                const syncHistory = Array.isArray(data.syncHistory) ? data.syncHistory : [];

                const paged = message && message.paged === true;
                const rawPageSize = Number(message && message.pageSize);
                const rawPage = Number(message && message.page);
                const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0
                    ? Math.min(rawPageSize, 200)
                    : 10;

                if (paged) {
                    const totalRecords = syncHistory.length;
                    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
                    let currentPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
                    if (currentPage > totalPages) currentPage = totalPages;

                    // syncHistory 是时间升序（旧 -> 新）；分页按“最新优先”返回
                    const endExclusive = Math.max(0, totalRecords - ((currentPage - 1) * pageSize));
                    const startInclusive = Math.max(0, endExclusive - pageSize);
                    const pageRecords = syncHistory.slice(startInclusive, endExclusive).reverse();

                    sendResponse({
                        success: true,
                        paged: true,
                        syncHistory: pageRecords,
                        totalRecords,
                        totalPages,
                        currentPage,
                        pageSize
                    });
                    return;
                }

                const rawRecentLimit = Number(message && message.recentLimit);
                const recentLimit = Number.isInteger(rawRecentLimit) && rawRecentLimit > 0
                    ? Math.min(rawRecentLimit, 1000)
                    : null;

                const payloadHistory = recentLimit
                    ? syncHistory.slice(-recentLimit)
                    : syncHistory;

                sendResponse({
                    success: true,
                    syncHistory: payloadHistory,
                    totalRecords: syncHistory.length,
                    totalPages: Math.max(1, Math.ceil(syncHistory.length / (recentLimit || Math.max(1, syncHistory.length || 1))))
                });
            });
            return true; // 保持消息通道开放
        } else if (message.action === "getPreviousHistoryRecord") {
            const targetTime = String(message.time || '').trim();
            if (!targetTime) {
                sendResponse({ success: false, error: 'Missing time parameter', record: null });
                return false;
            }

            browserAPI.storage.local.get(['syncHistory'], (data) => {
                const syncHistory = Array.isArray(data.syncHistory) ? data.syncHistory : [];
                const idx = syncHistory.findIndex(r => String(r?.time) === targetTime);

                if (idx < 0) {
                    sendResponse({ success: true, record: null });
                    return;
                }

                let previousRecord = null;
                for (let i = idx - 1; i >= 0; i--) {
                    const candidate = syncHistory[i];
                    if (!candidate || candidate.status !== 'success') continue;
                    if (candidate.hasData || candidate.bookmarkTree) {
                        previousRecord = candidate;
                        break;
                    }
                }

                sendResponse({ success: true, record: previousRecord || null });
            });
            return true;
        } else if (message.action === "getBackupData") {
            // 按需加载单个备份的详细数据
            const recordTime = message.time;
            if (!recordTime) {
                sendResponse({ success: false, error: 'Missing time parameter' });
                return false;
            }

            (async () => {
                try {
                    const treeKey = `backup_data_${recordTime}`;
                    const data = await browserAPI.storage.local.get([treeKey]);
                    const bookmarkTree = data[treeKey];

                    if (bookmarkTree) {
                        sendResponse({ success: true, bookmarkTree });
                    } else {
                        // 回退：旧数据可能仍在 syncHistory 中
                        const { syncHistory = [] } = await browserAPI.storage.local.get(['syncHistory']);
                        const record = syncHistory.find(r => String(r.time) === String(recordTime));
                        if (record && record.bookmarkTree) {
                            sendResponse({ success: true, bookmarkTree: record.bookmarkTree });
                        } else {
                            sendResponse({ success: false, error: 'Data not found' });
                        }
                    }
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
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
                customFolderEnabled: false,
                customFolderPath: '',
                customFolderHandle: null
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
                const exportRootFolder = await getExportRootFolder();
                let defaultPath = '';
                const isWindows = navigator.platform.indexOf('Win') > -1;
                const isMac = navigator.platform.indexOf('Mac') > -1;
                const isLinux = navigator.platform.indexOf('Linux') > -1;

                if (isWindows) {
                    defaultPath = `C:\\Users\\<username>\\Downloads\\${exportRootFolder}\\`;
                } else if (isMac) {
                    defaultPath = `/Users/<username>/Downloads/${exportRootFolder}/`;
                } else if (isLinux) {
                    defaultPath = `/home/<username>/Downloads/${exportRootFolder}/`;
                } else {
                    defaultPath = `您浏览器的默认下载文件夹/${exportRootFolder}/`;
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
                        if (syncHistory[i].status === 'success' && (syncHistory[i].bookmarkTree || syncHistory[i].hasData)) {
                            lastValidRecord = syncHistory[i];
                            break;
                        }
                    }

                    // 准备保存的缓存记录（仅保留必要的字段）
                    let cachedRecord = null;
                    if (lastValidRecord) {
                        let tree = lastValidRecord.bookmarkTree;
                        if (!tree && lastValidRecord.hasData) {
                            const treeKey = `backup_data_${lastValidRecord.time}`;
                            const treeData = await browserAPI.storage.local.get([treeKey]);
                            tree = treeData[treeKey];
                        }
                        if (tree) {
                            cachedRecord = {
                                bookmarkTree: tree,
                                bookmarkStats: lastValidRecord.bookmarkStats,
                                time: lastValidRecord.time
                            };
                        }
                    }

                    // 清理所有分离存储的备份数据
                    try {
                        await removeBackupDataByTimes(syncHistory.map(r => r.time));
                    } catch (_) { }

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
                            const candidate = deletedRecords[i];
                            if (candidate.status === 'success' && (candidate.bookmarkTree || candidate.hasData)) {
                                let tree = candidate.bookmarkTree;
                                if (!tree && candidate.hasData) {
                                    const treeKey = `backup_data_${candidate.time}`;
                                    const treeData = await browserAPI.storage.local.get([treeKey]);
                                    tree = treeData[treeKey];
                                }
                                if (tree) {
                                    cachedRecord = {
                                        bookmarkTree: tree,
                                        bookmarkStats: candidate.bookmarkStats,
                                        time: candidate.time
                                    };
                                    break;
                                }
                            }
                        }
                    }

                    // 清理被删除记录对应的分离存储数据
                    try {
                        const deletedRecords = syncHistory.slice(0, actualDeleteCount);
                        await removeBackupDataByTimes(deletedRecords.map(r => r.time));
                    } catch (_) { }

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
                const deletedRecords = syncHistory.filter(item => fingerprintsToDelete.includes(item.fingerprint));

                // 过滤掉要删除的记录
                syncHistory = syncHistory.filter(item => !fingerprintsToDelete.includes(item.fingerprint));

                if (syncHistory.length !== initialLength) {
                    const updates = { syncHistory: syncHistory };

                    const setPromise = browserAPI.storage.local.set(updates);
                    const removeDataPromise = (async () => {
                        try {
                            await removeBackupDataByTimes(deletedRecords.map(r => r.time));
                        } catch (_) { }
                    })();
                    const removePromise = syncHistory.length === 0
                        ? browserAPI.storage.local.remove(['cachedRecordAfterClear'])
                        : Promise.resolve();

                    Promise.all([setPromise, removePromise, removeDataPromise])
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
                const removeDataPromise = (async () => {
                    try {
                        await removeBackupDataByTimes(timesToDelete);
                    } catch (_) { }
                })();
                const removePromise = syncHistory.length === 0
                    ? browserAPI.storage.local.remove(['cachedRecordAfterClear'])
                    : Promise.resolve();

                Promise.all([setPromise, removePromise, removeDataPromise])
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
        } else if (message.action === 'scanAndParseRestoreSource') {
            scanAndParseRestoreSource(message.source, message.localFiles)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
            return true;
        } else if (message.action === 'buildOverwriteRestorePreview') {
            buildOverwriteRestorePreview({
                restoreRef: message.restoreRef,
                localPayload: message.localPayload
            })
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
            return true;
        } else if (message.action === 'computeRestoreDiffSummaryAgainstCurrent') {
            computeRestoreDiffSummaryAgainstCurrent({
                restoreRef: message.restoreRef,
                localPayload: message.localPayload
            })
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
            return true;
        } else if (message.action === 'buildMergeRestorePreview') {
            buildMergeRestorePreview({
                restoreRef: message.restoreRef,
                localPayload: message.localPayload,
                mergeViewMode: message.mergeViewMode
            })
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
            return true;
        } else if (message.action === 'getBookmarkRootContainers') {
            getBookmarkRootContainers()
                .then(result => sendResponse({ success: true, roots: result }))
                .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
            return true;
        } else if (message.action === 'restoreSelectedVersion') {
            restoreSelectedVersion({
                restoreRef: message.restoreRef,
                strategy: message.strategy,
                localPayload: message.localPayload,
                mergeViewMode: message.mergeViewMode,
                manualMatches: message.manualMatches,
                importParentId: message.importParentId
            })
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
            return true;
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

// 添加书签变化监听器（同时做“当前变化缓存”的增量更新）
browserAPI.bookmarks.onCreated.addListener((id, bookmark) => {
    const shouldSkipDelta = isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging;
    if (!shouldSkipDelta) {
        try {
            enqueueChangeCacheDelta({
                kind: 'created',
                nodeType: (bookmark && bookmark.url) ? 'bookmark' : 'folder',
                id,
                parentId: bookmark?.parentId,
                title: bookmark?.title,
                url: bookmark?.url
            });
        } catch (_) { }
    }
    handleBookmarkChange();
});
browserAPI.bookmarks.onRemoved.addListener((id, removeInfo) => {
    const shouldSkipDelta = isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging;
    if (!shouldSkipDelta) {
        try {
            const sid = (id != null) ? String(id) : '';
            const idx = BookmarkSnapshotCache.index;
            const nodeFromIndex = (idx && sid) ? idx.get(sid) : null;
            const node = removeInfo && removeInfo.node ? removeInfo.node : nodeFromIndex;
            enqueueChangeCacheDelta({
                kind: 'removed',
                nodeType: (node && node.url) ? 'bookmark' : 'folder',
                id,
                parentId: removeInfo?.parentId || node?.parentId,
                title: node?.title,
                url: node?.url,
                oldParentId: node?.parentId
            });
        } catch (_) { }
    }
    handleBookmarkChange();
});
browserAPI.bookmarks.onMoved.addListener((id, moveInfo) => {
    const shouldSkipDelta = isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging;
    if (!shouldSkipDelta) {
        try {
            const idx = BookmarkSnapshotCache.index;
            const old = (idx && id) ? idx.get(String(id)) : null;
            enqueueChangeCacheDelta({
                kind: 'moved',
                nodeType: (old && old.url) ? 'bookmark' : 'folder',
                id,
                parentId: moveInfo?.parentId,
                oldParentId: moveInfo?.oldParentId,
                oldTitle: old?.title || '',
                oldUrl: old?.url || ''
            });
        } catch (_) { }
    }
    handleBookmarkChange();
});
browserAPI.bookmarks.onChanged.addListener((id, changeInfo) => {
    const shouldSkipDelta = isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging;
    if (!shouldSkipDelta) {
        try {
            const idx = BookmarkSnapshotCache.index;
            const old = (idx && id) ? idx.get(String(id)) : null;
            enqueueChangeCacheDelta({
                kind: 'changed',
                nodeType: (old && old.url) ? 'bookmark' : 'folder',
                id,
                // parentId 不变（changed 事件不含），由 flush 时从 index 取
                titleOverride: changeInfo?.title,
                urlOverride: changeInfo?.url,
                oldTitle: old?.title || '',
                oldUrl: old?.url || '',
                oldParentId: old?.parentId || ''
            });
        } catch (_) { }
    }
    handleBookmarkChange();
});
// 这些事件在“批量导入/重排”场景下也会改变树结构/顺序，需同步标记快照失效
try {
    if (browserAPI.bookmarks.onChildrenReordered) {
        browserAPI.bookmarks.onChildrenReordered.addListener(handleBookmarkChange);
    }
    if (browserAPI.bookmarks.onImportBegan) {
        browserAPI.bookmarks.onImportBegan.addListener(() => {
            try {
                isBookmarkImporting = true;
                try { browserAPI.storage.local.set({ bookmarkImportingFlag: true }, () => { }); } catch (_) { }
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
                try { browserAPI.storage.local.set({ bookmarkImportingFlag: false }, () => { }); } catch (_) { }
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

    try {
        noteBookmarkEventForBulkGuard();
    } catch (_) { }

    if (bookmarkChangeTimeout) {
        clearTimeout(bookmarkChangeTimeout);
    }

    bookmarkChangeTimeout = setTimeout(async () => {
        try {
            // 导入/恢复/大量变化期间：避免触发昂贵的分析/通信/可能的实时备份
            if (isBookmarkImporting || isBookmarkRestoring || isBookmarkBulkChanging) {
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
async function uploadBookmarks(bookmarks, options = {}) {
    const config = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'is123Pan']);
    if (!config.serverAddress || !config.username || !config.password) {
        // 不再抛出错误，而是返回一个状态表明WebDAV未配置
        return { success: false, error: "WebDAV 信息未配置", webDAVNotConfigured: true };
    }

    // 获取覆盖策略设置
    const { overwriteMode = 'versioned' } = await browserAPI.storage.local.get(['overwriteMode']);

    const serverAddress = config.serverAddress.replace(/\/+$/, '/');
    const exportRootFolder = await getExportRootFolder();

    const naming = buildSnapshotNamingContext(options);
    const snapshotFileName = String(options.snapshotFileName || naming.snapshotName).trim() || naming.snapshotName;
    const snapshotFolderName = String(options.snapshotFolderName || naming.snapshotFolder).trim() || naming.snapshotFolder;
    const overwriteSubFolder = getOverwriteFolderByLang(await getCurrentLang());

    // 根据覆盖策略决定文件名与目录
    let fileName = snapshotFileName;
    let folderPath = `${exportRootFolder}/${snapshotFolderName}/`;
    if (overwriteMode === 'overwrite') {
        fileName = getOverwriteSnapshotFileName();
        folderPath = `${exportRootFolder}/${overwriteSubFolder}/`;
    }
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
async function uploadBookmarksToGitHubRepo(bookmarks, options = {}) {
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

    // 获取覆盖策略设置
    const { overwriteMode = 'versioned' } = await browserAPI.storage.local.get(['overwriteMode']);

    const naming = buildSnapshotNamingContext(options);
    const baseFileName = overwriteMode === 'overwrite'
        ? getOverwriteSnapshotFileName()
        : (String(options.snapshotFileName || naming.snapshotName).trim() || naming.snapshotName);
    const snapshotFolderName = String(options.snapshotFolderName || naming.snapshotFolder).trim() || naming.snapshotFolder;
    const lang = await getCurrentLang();

    const folderKey = overwriteMode === 'overwrite'
        ? 'backup_root_overwrite'
        : `backup_root/${snapshotFolderName}`;

    const filePath = buildGitHubRepoFilePath({
        basePath: config.githubRepoBasePath,
        lang,
        folderKey,
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

    const subRaw = String(resolveExportSubFolderByKey(folderKey, lang) || '').trim();
    const subParts = subRaw
        ? subRaw.split('/').filter(Boolean).map(sanitizeGitHubRepoPathPart).filter(Boolean)
        : [];

    const fileRaw = String(fileName || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const fileParts = fileRaw
        ? fileRaw.split('/').filter(Boolean).map(sanitizeGitHubRepoPathPart).filter(Boolean)
        : [];

    const joined = [...baseParts, root, ...subParts, ...fileParts].filter(Boolean).join('/');
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

function getVersionFolderCandidates() {
    return Array.from(new Set([
        getOverwriteFolderByLang('zh_CN'),
        getOverwriteFolderByLang('en')
    ].map(s => String(s || '').trim()).filter(Boolean)));
}

function __sanitizePathPart(part) {
    return String(part == null ? '' : part)
        .replace(/[\\/]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildCurrentChangesArtifactLeafName({ naming, mode, format, lang }) {
    const isZh = lang === 'zh_CN';
    const modeText = mode === 'detailed'
        ? (isZh ? '详细' : 'detailed')
        : (mode === 'collection' ? (isZh ? '集合' : 'collection') : (isZh ? '简略' : 'simple'));
    const prefix = isZh ? '书签变化' : 'bookmark-changes';
    const ext = format === 'html' ? 'html' : 'json';
    return `${prefix}_${modeText}_${naming.timePart}_${naming.fingerprint}.${ext}`;
}

function buildCurrentChangesStatsLine(stats, lang) {
    const isZh = lang === 'zh_CN';
    const labels = isZh
        ? { added: '新增', deleted: '删除', modified: '修改', moved: '移动', b: '书签', f: '文件夹', none: '无变化' }
        : { added: 'Added', deleted: 'Deleted', modified: 'Modified', moved: 'Moved', b: 'BKM', f: 'FLD', none: 'No changes' };

    const toNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const bookmarkAdded = toNum(stats?.bookmarkAdded);
    const bookmarkDeleted = toNum(stats?.bookmarkDeleted);
    const folderAdded = toNum(stats?.folderAdded);
    const folderDeleted = toNum(stats?.folderDeleted);
    const movedCount = toNum(stats?.movedCount);
    const modifiedCount = toNum(stats?.modifiedCount);

    const formatPair = (bookmarks, folders) => {
        const parts = [];
        if (bookmarks > 0) parts.push(`${bookmarks}${labels.b}`);
        if (folders > 0) parts.push(`${folders}${labels.f}`);
        return parts.join(' ');
    };

    const parts = [];
    const addedPart = formatPair(bookmarkAdded, folderAdded);
    const deletedPart = formatPair(bookmarkDeleted, folderDeleted);

    if (addedPart) parts.push(`${labels.added}:${addedPart}`);
    if (deletedPart) parts.push(`${labels.deleted}:${deletedPart}`);
    if (movedCount > 0) parts.push(`${labels.moved}:${movedCount}`);
    if (modifiedCount > 0) parts.push(`${labels.modified}:${modifiedCount}`);

    return parts.length > 0 ? parts.join('  ') : labels.none;
}

function buildCurrentChangesNetscapeHtml({ lang, payload, payloadJsonText }) {
    const isZh = lang === 'zh_CN';
    const title = isZh ? '书签变化' : 'Bookmark Changes';
    const heading = title;
    const scriptSafeJson = String(payloadJsonText || '').replace(/<\/script/gi, '<\\/script');

    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    html += `<TITLE>${escapeHtmlBg(title)}</TITLE>\n`;
    html += `<H1>${escapeHtmlBg(heading)}</H1>\n`;
    html += `<script type="application/json" id="bookmarkCurrentChangesData">${scriptSafeJson}</script>\n`;
    html += '<DL><p>\n';

    const walk = (nodes, level = 1) => {
        if (!Array.isArray(nodes) || nodes.length === 0) return;

        nodes.forEach(node => {
            if (!node || typeof node !== 'object') return;

            const indent = '    '.repeat(level);
            const nodeTitle = escapeHtmlBg(node.title || (isZh ? '(无标题)' : '(Untitled)'));
            const hasChildren = Array.isArray(node.children);
            const isFolder = hasChildren || (!node.url && node.type === 'folder');

            if (isFolder) {
                html += `${indent}<DT><H3>${nodeTitle}</H3>\n`;
                html += `${indent}<DL><p>\n`;
                walk(hasChildren ? node.children : [], level + 1);
                html += `${indent}</DL><p>\n`;
            } else {
                const href = escapeHtmlBg(node.url || 'about:blank');
                html += `${indent}<DT><A HREF="${href}">${nodeTitle}</A>\n`;
            }
        });
    };

    walk(Array.isArray(payload?.children) ? payload.children : []);

    html += '</DL><p>\n';
    return html;
}


function buildCurrentChangesExportTree(bookmarkTree, changeMap, options = {}) {
    const mode = options?.mode === 'detailed'
        ? 'detailed'
        : (options?.mode === 'collection' ? 'collection' : 'simple');
    const expandedIds = options?.expandedIds instanceof Set ? options.expandedIds : null;
    const isZh = options?.lang === 'zh_CN';
    const stats = options?.stats || {};
    // 与 history_html 当前变化导出保持一致：只要传入 Set（即便为空）就按 WYSIWYG 处理
    const useWysiwygExpansion = mode === 'detailed' && (expandedIds instanceof Set);

    const safeTitle = (t) => {
        const title = String(t || '').trim();
        return title ? title : (isZh ? '(无标题)' : '(Untitled)');
    };

    const hasChangesRecursive = (node) => {
        if (!node) return false;
        if (node.id && changeMap && changeMap.has(node.id)) return true;
        if (Array.isArray(node.children)) {
            return node.children.some(child => hasChangesRecursive(child));
        }
        return false;
    };

    const getChangeInfo = (change) => {
        if (!change || !change.type) return { prefix: '', changeType: '' };
        const changeType = String(change.type);
        const types = changeType.split('+');
        if (types.includes('added')) return { prefix: '[+] ', changeType };
        if (types.includes('deleted')) return { prefix: '[-] ', changeType };
        if (types.includes('modified') && types.includes('moved')) return { prefix: '[~>>] ', changeType };
        if (types.includes('modified')) return { prefix: '[~] ', changeType };
        if (types.includes('moved')) return { prefix: '[>>] ', changeType };
        return { prefix: '', changeType };
    };

    const buildCollectionTree = () => {
        const safeNumberLocal = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

        const bookmarkAdded = safeNumberLocal(stats?.bookmarkAdded);
        const folderAdded = safeNumberLocal(stats?.folderAdded);
        const bookmarkDeleted = safeNumberLocal(stats?.bookmarkDeleted);
        const folderDeleted = safeNumberLocal(stats?.folderDeleted);
        const movedCount = safeNumberLocal(stats?.movedCount);
        const modifiedCount = safeNumberLocal(stats?.modifiedCount);
        const movedBookmarkCount = safeNumberLocal(stats?.movedBookmarkCount);
        const movedFolderCount = safeNumberLocal(stats?.movedFolderCount);
        const modifiedBookmarkCount = safeNumberLocal(stats?.modifiedBookmarkCount);
        const modifiedFolderCount = safeNumberLocal(stats?.modifiedFolderCount);

        const buckets = {
            added: [],
            deleted: [],
            moved: [],
            modified: []
        };

        const formatBookmarkFolderCounts = (bookmarkCount, folderCount) => {
            const parts = [];
            if (bookmarkCount > 0) {
                parts.push(isZh ? `${bookmarkCount}个书签` : `${bookmarkCount} bookmarks`);
            }
            if (folderCount > 0) {
                parts.push(isZh ? `${folderCount}个文件夹` : `${folderCount} folders`);
            }
            return parts.join(isZh ? '，' : ', ');
        };

        const buildCollectionGroupTitle = ({ marker, zhVerb, enVerb, bookmarkCount, folderCount, fallbackCount }) => {
            const breakdown = formatBookmarkFolderCounts(bookmarkCount, folderCount);
            if (breakdown) {
                return isZh ? `${marker} ${zhVerb}${breakdown}` : `${marker} ${enVerb} ${breakdown}`;
            }
            if (fallbackCount > 0) {
                return isZh ? `${marker} ${zhVerb}${fallbackCount}项` : `${marker} ${enVerb} ${fallbackCount} items`;
            }
            return isZh ? `${marker} ${zhVerb}` : `${marker} ${enVerb}`;
        };

        const buildFullSubtreeEntry = (node, changeType = '') => {
            const title = safeTitle(node?.title);
            const url = node?.url || '';
            const isFolder = !url && Array.isArray(node?.children);

            const entry = {
                title,
                type: isFolder ? 'folder' : 'bookmark',
                ...(url ? { url } : {}),
                ...(changeType ? { changeType } : {})
            };

            if (isFolder) {
                entry.children = node.children
                    .map(child => buildFullSubtreeEntry(child, ''))
                    .filter(Boolean);
            }

            return entry;
        };

        const appendEntry = (bucketKey, node, changeType, options = {}) => {
            const includeDescendants = options?.includeDescendants === true;
            if (includeDescendants) {
                buckets[bucketKey].push(buildFullSubtreeEntry(node, changeType));
                return;
            }

            const title = safeTitle(node?.title);
            const url = node?.url || '';
            const isFolder = !url && Array.isArray(node?.children);
            buckets[bucketKey].push({
                title,
                type: isFolder ? 'folder' : 'bookmark',
                ...(url ? { url } : {}),
                ...(changeType ? { changeType } : {})
            });
        };

        const traverse = (node) => {
            if (!node) return;

            const change = node.id ? changeMap.get(node.id) : null;
            const changeType = change && change.type ? String(change.type) : '';
            const types = changeType ? changeType.split('+') : [];
            const isFolder = !node.url && Array.isArray(node.children);

            if (types.includes('added')) appendEntry('added', node, changeType);
            if (types.includes('deleted')) appendEntry('deleted', node, changeType);

            const isMoved = types.includes('moved');
            const isModified = types.includes('modified');

            if (isMoved) {
                appendEntry('moved', node, changeType, { includeDescendants: isFolder });
            }
            if (isModified) {
                appendEntry('modified', node, changeType, { includeDescendants: isFolder });
            }

            if (Array.isArray(node.children)) {
                node.children.forEach(child => traverse(child));
            }
        };

        const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
        nodes.forEach(node => {
            if (!node || !Array.isArray(node.children)) return;
            node.children.forEach(child => traverse(child));
        });

        const addedTitle = buildCollectionGroupTitle({
            marker: '[+]',
            zhVerb: '增加了',
            enVerb: 'Added',
            bookmarkCount: bookmarkAdded,
            folderCount: folderAdded,
            fallbackCount: bookmarkAdded + folderAdded
        });

        const deletedTitle = buildCollectionGroupTitle({
            marker: '[-]',
            zhVerb: '删除了',
            enVerb: 'Deleted',
            bookmarkCount: bookmarkDeleted,
            folderCount: folderDeleted,
            fallbackCount: bookmarkDeleted + folderDeleted
        });

        const movedTitle = buildCollectionGroupTitle({
            marker: '[>>]',
            zhVerb: '移动了',
            enVerb: 'Moved',
            bookmarkCount: movedBookmarkCount,
            folderCount: movedFolderCount,
            fallbackCount: movedCount
        });

        const modifiedTitle = buildCollectionGroupTitle({
            marker: '[~]',
            zhVerb: '修改了',
            enVerb: 'Modified',
            bookmarkCount: modifiedBookmarkCount,
            folderCount: modifiedFolderCount,
            fallbackCount: modifiedCount
        });

        return [
            { title: addedTitle, type: 'folder', children: buckets.added },
            { title: deletedTitle, type: 'folder', children: buckets.deleted },
            { title: movedTitle, type: 'folder', children: buckets.moved },
            { title: modifiedTitle, type: 'folder', children: buckets.modified }
        ].filter(group => Array.isArray(group.children) && group.children.length > 0);
    };

    if (mode === 'collection') {
        return buildCollectionTree();
    }

    const extractTree = (node, forceInclude = false) => {
        if (!node) return null;

        const nodeHasChanges = hasChangesRecursive(node);
        if (mode !== 'detailed' && !forceInclude && !nodeHasChanges) return null;

        const title = safeTitle(node.title);
        const url = node.url || '';
        const isFolder = !url && Array.isArray(node.children);

        const change = node.id ? changeMap.get(node.id) : null;
        const { prefix, changeType } = getChangeInfo(change);

        const item = {
            title: prefix + title,
            type: isFolder ? 'folder' : 'bookmark',
            ...(url ? { url } : {}),
            ...(changeType ? { changeType } : {})
        };

        if (isFolder) {
            const shouldForceIncludeChildren = mode !== 'detailed' && !forceInclude && !!changeType;
            const nextForceInclude = forceInclude || shouldForceIncludeChildren;

            let shouldRecurse = false;
            if (mode === 'detailed') {
                if (useWysiwygExpansion) {
                    shouldRecurse = expandedIds.has(String(node.id));
                } else {
                    shouldRecurse = nodeHasChanges;
                }
            } else {
                shouldRecurse = true;
            }

            if (shouldRecurse) {
                item.children = node.children
                    .map(child => extractTree(child, nextForceInclude))
                    .filter(Boolean);
            } else {
                item.children = [];
            }
        }

        return item;
    };

    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    const children = [];
    nodes.forEach(node => {
        if (!node || !Array.isArray(node.children)) return;
        node.children.forEach(child => {
            const extracted = extractTree(child, false);
            if (extracted) children.push(extracted);
        });
    });

    return children;
}

function normalizeCurrentChangesArchiveSettings(settings = {}) {
    const enabled = settings.currentChangesArchiveEnabled !== false;

    const format = Array.isArray(settings.currentChangesArchiveFormats)
        ? settings.currentChangesArchiveFormats.map(v => String(v || '').toLowerCase()).find(v => v === 'html' || v === 'json')
        : null;
    const mode = Array.isArray(settings.currentChangesArchiveModes)
        ? settings.currentChangesArchiveModes.map(v => String(v || '').toLowerCase()).find(v => v === 'simple' || v === 'detailed' || v === 'collection')
        : null;

    const formats = [format || 'html'];
    const modes = [mode || 'simple'];

    return { enabled, formats, modes };
}

async function buildCurrentChangesSnapshotArtifacts({ localBookmarks, syncTime, lang, explicitMovedIds, previousBookmarks = null, usePreviousBookmarks = false, forceFormats = null, forceModes = null, forceEnabled = null, forceExpandedIds = null }) {
    if (!Array.isArray(localBookmarks) || !localBookmarks.length) {
        return [];
    }

    const naming = buildSnapshotNamingContext({ syncTime });
    const currentTree = localBookmarks;
    const baseData = await browserAPI.storage.local.get(['lastBookmarkData', 'currentChangesViewMode']);
    const previousTree = usePreviousBookmarks
        ? (Array.isArray(previousBookmarks) && previousBookmarks.length ? previousBookmarks : null)
        : (baseData?.lastBookmarkData?.bookmarkTree || null);

    let treeToExport = currentTree;
    let changeMap = new Map();
    let diffSummary = {
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

    const explicitMovedIdSet = new Set(
        (Array.isArray(explicitMovedIds) ? explicitMovedIds : [])
            .map(v => String(v || '').trim())
            .filter(Boolean)
    );

    if (previousTree && Array.isArray(previousTree) && previousTree.length) {
        changeMap = detectTreeChangesFastBg(previousTree, currentTree, {
            explicitMovedIdSet: explicitMovedIdSet.size > 0 ? explicitMovedIdSet : null
        });

        diffSummary = computeBookmarkGitDiffSummary(previousTree, currentTree, {
            explicitMovedIds: explicitMovedIdSet.size > 0 ? explicitMovedIdSet : null
        });

        let hasDeleted = false;
        for (const [, change] of changeMap) {
            if (change?.type && String(change.type).includes('deleted')) {
                hasDeleted = true;
                break;
            }
        }
        if (hasDeleted) {
            try {
                treeToExport = rebuildTreeWithDeletedBg(previousTree, currentTree, changeMap);
            } catch (_) {
                treeToExport = currentTree;
            }
        }
    } else {
        const allNodes = flattenBookmarkTreeBg(currentTree);
        allNodes.forEach(item => {
            if (!item?.id) return;
            changeMap.set(item.id, { type: 'added' });
            if (item.isFolder) diffSummary.folderAdded += 1;
            else diffSummary.bookmarkAdded += 1;
        });
    }

    const normalizedStats = buildRestoreStats(diffSummary);

    const viewMode = String(baseData?.currentChangesViewMode || 'detailed').toLowerCase() === 'compact' ? 'compact' : 'detailed';
    const settings = await browserAPI.storage.local.get(['currentChangesArchiveFormats', 'currentChangesArchiveModes', 'currentChangesArchiveEnabled']);
    const archiveSettings = normalizeCurrentChangesArchiveSettings(settings);

    if (typeof forceEnabled === 'boolean') {
        archiveSettings.enabled = forceEnabled;
    }

    if (Array.isArray(forceFormats)) {
        const normalizedFormats = Array.from(new Set(
            forceFormats
                .map(v => String(v || '').toLowerCase())
                .filter(v => v === 'html' || v === 'json')
        ));
        if (normalizedFormats.length > 0) {
            archiveSettings.formats = normalizedFormats;
        }
    }

    if (Array.isArray(forceModes)) {
        const normalizedModes = Array.from(new Set(
            forceModes
                .map(v => String(v || '').toLowerCase())
                .filter(v => v === 'simple' || v === 'detailed' || v === 'collection')
        ));
        if (normalizedModes.length > 0) {
            archiveSettings.modes = normalizedModes;
        }
    }

    if (!archiveSettings.enabled) return [];

    const artifacts = [];

    for (const mode of archiveSettings.modes) {
        const exportMode = mode === 'detailed'
            ? 'detailed'
            : (mode === 'collection' ? 'collection' : 'simple');

        let expandedIdsSet = null;
        if (exportMode === 'detailed') {
            if (forceExpandedIds instanceof Set) {
                expandedIdsSet = new Set(Array.from(forceExpandedIds).map(v => String(v)));
            } else if (Array.isArray(forceExpandedIds)) {
                expandedIdsSet = new Set(forceExpandedIds.map(v => String(v)));
            } else {
                try {
                    const scope = viewMode === 'compact' ? 'compact' : 'detailed';
                    const storeKey = `changesPreviewExpandedNodes:${scope}`;
                    const data = await browserAPI.storage.local.get([storeKey]);
                    const hasStoredExpansionState = data && Object.prototype.hasOwnProperty.call(data, storeKey);
                    const raw = hasStoredExpansionState ? data[storeKey] : null;
                    if (hasStoredExpansionState && Array.isArray(raw)) {
                        expandedIdsSet = new Set(raw.map(v => String(v)));
                    }
                } catch (_) { }
            }
        }

        const exportChildren = buildCurrentChangesExportTree(treeToExport, changeMap, {
            mode: exportMode,
            expandedIds: expandedIdsSet,
            lang,
            stats: normalizedStats
        });

        const isZh = lang === 'zh_CN';
        const exportTimeText = new Date().toLocaleString(isZh ? 'zh-CN' : 'en-US');
        const countsLine = buildCurrentChangesStatsLine(normalizedStats, lang);
        const legendTitle = isZh
            ? `前缀说明: [+]新增  [-]删除  [~]修改  [>>]移动`
            : `Prefix legend: [+]Added  [-]Deleted  [~]Modified  [>>]Moved`;

        const exportPayload = {
            title: isZh ? '书签变化导出' : 'Bookmark Changes Export',
            children: [
                {
                    title: legendTitle,
                    children: [
                        {
                            title: `${isZh ? '操作统计' : 'Operation Counts'}: ${countsLine}`,
                            url: 'about:blank'
                        },
                        {
                            title: `${isZh ? '导出时间' : 'Export Time'}: ${exportTimeText}`,
                            url: 'about:blank'
                        }
                    ]
                },
                ...exportChildren
            ],
            _exportInfo: {
                exportDate: new Date().toISOString(),
                exportMode: exportMode,
                source: 'bookmark-backup-changes',
                legend: {
                    '[+]': isZh ? '新增' : 'Added',
                    '[-]': isZh ? '删除' : 'Deleted',
                    '[~]': isZh ? '修改' : 'Modified',
                    '[>>]': isZh ? '移动' : 'Moved'
                }
            }
        };

        const payloadText = JSON.stringify(exportPayload, null, 2);

        if (archiveSettings.formats.includes('json')) {
            const leaf = buildCurrentChangesArtifactLeafName({ naming, mode: exportMode, format: 'json', lang });
            artifacts.push({
                mode: exportMode,
                format: 'json',
                leafName: leaf,
                content: payloadText,
                contentType: 'application/json;charset=utf-8',
                stats: normalizedStats
            });
        }

        if (archiveSettings.formats.includes('html')) {
            const html = buildCurrentChangesNetscapeHtml({
                lang,
                payload: exportPayload,
                payloadJsonText: payloadText
            });
            const leaf = buildCurrentChangesArtifactLeafName({ naming, mode: exportMode, format: 'html', lang });
            artifacts.push({
                mode: exportMode,
                format: 'html',
                leafName: leaf,
                content: html,
                contentType: 'text/html;charset=utf-8',
                stats: normalizedStats
            });
        }
    }

    return artifacts;
}

async function buildCurrentChangesManualExportArtifact({ mode, format, lang, explicitMovedIds = null, localBookmarks = null, syncTime = null, previousBookmarks = null, usePreviousBookmarks = false, forceExpandedIds = null }) {
    const normalizedMode = String(mode || '').toLowerCase() === 'detailed'
        ? 'detailed'
        : (String(mode || '').toLowerCase() === 'collection' ? 'collection' : 'simple');
    const normalizedFormat = String(format || '').toLowerCase() === 'json' ? 'json' : 'html';

    const bookmarks = Array.isArray(localBookmarks) && localBookmarks.length
        ? localBookmarks
        : await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));

    const artifacts = await buildCurrentChangesSnapshotArtifacts({
        localBookmarks: bookmarks,
        syncTime: syncTime || new Date().toISOString(),
        lang,
        explicitMovedIds,
        previousBookmarks,
        usePreviousBookmarks,
        forceFormats: [normalizedFormat],
        forceModes: [normalizedMode],
        forceEnabled: true,
        forceExpandedIds
    });

    if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
    return artifacts.find(item => item && item.mode === normalizedMode && item.format === normalizedFormat) || artifacts[0] || null;
}

async function uploadCurrentChangesArtifactsToTargets({ artifacts, naming, lang, overwriteMode }) {
    const list = Array.isArray(artifacts) ? artifacts : [];
    if (list.length === 0) return { success: true, skipped: true };

    const exportRootFolder = getExportRootFolderByLang(lang);
    const overwriteFolder = getOverwriteFolderByLang(lang);

    const localConfig = await browserAPI.storage.local.get([
        'defaultDownloadEnabled'
    ]);
    const localEnabled = localConfig.defaultDownloadEnabled === true;

    const tasks = [];

    for (const artifact of list) {
        if (!artifact || !artifact.content) continue;

        const relativeSnapshotFolder = overwriteMode === 'overwrite' ? overwriteFolder : naming.snapshotFolder;
        const cloudFolderKey = `backup_root/${relativeSnapshotFolder}`;
        const fileName = overwriteMode === 'overwrite'
            ? buildCurrentChangesOverwriteLeafName({ mode: artifact.mode, format: artifact.format })
            : String(artifact.leafName || '').trim();
        if (!fileName) continue;

        tasks.push((async () => {
            try {
                const [webdav, githubRepo] = await Promise.all([
                    uploadExportFileToWebDAV({
                        lang,
                        folderKey: cloudFolderKey,
                        fileName,
                        content: artifact.content,
                        contentType: artifact.contentType
                    }),
                    uploadExportFileToGitHubRepo({
                        lang,
                        folderKey: cloudFolderKey,
                        fileName,
                        content: artifact.content
                    })
                ]);

                const localPath = `${exportRootFolder}/${relativeSnapshotFolder}/${fileName}`;
                let local = { success: false, skipped: true, error: 'Local backup disabled' };

                if (localEnabled) {
                    const dataUrl = `data:${artifact.contentType || 'text/plain;charset=utf-8'},${encodeURIComponent(String(artifact.content))}`;
                    local = await new Promise((resolve) => {
                        browserAPI.downloads.download({
                            url: dataUrl,
                            filename: localPath,
                            saveAs: false,
                            conflictAction: overwriteMode === 'overwrite' ? 'overwrite' : 'uniquify'
                        }, (downloadId) => {
                            if (browserAPI.runtime?.lastError) {
                                resolve({ success: false, error: browserAPI.runtime.lastError.message });
                            } else {
                                resolve({ success: true, downloadId });
                            }
                        });
                    });
                }

                return {
                    success: (webdav?.success === true) || (githubRepo?.success === true) || (local?.success === true),
                    webdav,
                    githubRepo,
                    local,
                    fileName: localPath
                };
            } catch (error) {
                return { success: false, error: error?.message || 'upload current changes artifact failed' };
            }
        })());
    }

    const results = await Promise.all(tasks);
    const success = results.some(r => r && r.success === true);
    return { success, results };
}


async function exportCurrentChangesArchiveToCloud(options = {}) {
    try {
        const lang = await getCurrentLang();
        const overwriteCfg = await browserAPI.storage.local.get(['overwriteMode', 'recentMovedIds']);
        const overwriteMode = options.overwriteMode === 'overwrite'
            ? 'overwrite'
            : (overwriteCfg?.overwriteMode === 'overwrite' ? 'overwrite' : 'versioned');
        const optionMovedIds = Array.isArray(options.explicitMovedIds)
            ? options.explicitMovedIds.map(v => String(v || '').trim()).filter(Boolean)
            : [];
        const storageMovedIds = Array.isArray(overwriteCfg?.recentMovedIds)
            ? overwriteCfg.recentMovedIds.map(r => String((r && r.id) || '').trim()).filter(Boolean)
            : [];
        const explicitMovedIds = Array.from(new Set(optionMovedIds.length > 0 ? optionMovedIds : storageMovedIds));

        const localBookmarks = Array.isArray(options.localBookmarks) && options.localBookmarks.length
            ? options.localBookmarks
            : await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));

        const syncTime = String(options.syncTime || new Date().toISOString());
        const naming = buildSnapshotNamingContext({
            syncTime,
            fingerprint: options.fingerprint || undefined
        });

        const usePreviousBookmarks = Object.prototype.hasOwnProperty.call(options, 'previousBookmarks');
        const previousBookmarks = usePreviousBookmarks ? options.previousBookmarks : null;

        const artifacts = await buildCurrentChangesSnapshotArtifacts({
            localBookmarks,
            syncTime,
            lang,
            explicitMovedIds,
            previousBookmarks,
            usePreviousBookmarks
        });

        return await uploadCurrentChangesArtifactsToTargets({
            artifacts,
            naming,
            lang,
            overwriteMode
        });
    } catch (error) {
        console.warn('[exportCurrentChangesArchiveToCloud] failed:', error);
        return { success: false, error: error?.message || '导出当前变化自动归档失败' };
    }
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
async function uploadBookmarksToLocal(bookmarks, options = {}) {
    // 获取本地备份配置
    const config = await browserAPI.storage.local.get([
        'defaultDownloadEnabled',
        'hideDownloadShelf'    // 控制是否隐藏下载栏
    ]);

    // 仅支持默认下载方式（浏览器下载目录）
    const defaultDownloadEnabled = config.defaultDownloadEnabled === true;

    if (!defaultDownloadEnabled) {
        throw new Error("本地备份未启用或路径未配置");
    }

    try {
        const htmlContent = convertToEdgeHTML(bookmarks);

        // 获取覆盖策略设置
        const { overwriteMode = 'versioned' } = await browserAPI.storage.local.get(['overwriteMode']);

        const naming = buildSnapshotNamingContext(options);
        const fileName = overwriteMode === 'overwrite'
            ? getOverwriteSnapshotFileName()
            : (String(options.snapshotFileName || naming.snapshotName).trim() || naming.snapshotName);
        const snapshotFolderName = String(options.snapshotFolderName || naming.snapshotFolder).trim() || naming.snapshotFolder;

        // 记录结果，包含文件名信息
        const result = {
            success: false,
            fileName: fileName,
            snapshotFolderName
        };

        const exportRootFolder = await getExportRootFolder();
        const currentLang = await getCurrentLang();
        const overwriteSubFolder = getOverwriteFolderByLang(currentLang);
        const relativePath = overwriteMode === 'overwrite'
            ? `${exportRootFolder}/${overwriteSubFolder}/${fileName}`
            : `${exportRootFolder}/${snapshotFolderName}/${fileName}`;

        // 默认下载方式
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
            const downloadId = await new Promise((resolve, reject) => {
                browserAPI.downloads.download({
                    url: dataUrl,
                    filename: relativePath,
                    saveAs: false,
                    conflictAction: overwriteMode === 'overwrite' ? 'overwrite' : 'uniquify'
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
                cloud: "Cloud 1, Cloud 2",
                webdav: "Cloud 1 (WebDAV)",
                github_repo: "Cloud 2 (GitHub Repo)",
                gist: "Cloud 2 (GitHub Repo)", // legacy
                cloud_local: "Cloud 1, Cloud 2, Local",
                webdav_local: "Cloud 1 (WebDAV), Local",
                github_repo_local: "Cloud 2 (GitHub Repo), Local",
                gist_local: "Cloud 2 (GitHub Repo), Local", // legacy
                both: "Cloud 1 (WebDAV), Local",
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
                cloud: "云端1, 云端2",
                webdav: "云端1(WebDAV)",
                github_repo: "云端2(GitHub仓库)",
                gist: "云端2(GitHub仓库)", // legacy
                cloud_local: "云端1, 云端2, 本地",
                webdav_local: "云端1(WebDAV), 本地",
                github_repo_local: "云端2(GitHub仓库), 本地",
                gist_local: "云端2(GitHub仓库), 本地", // legacy
                both: "云端1(WebDAV), 本地",
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
        'defaultDownloadEnabled', 'hideDownloadShelf'
    ]);

    // 检查WebDAV配置
    const webDAVConfigured = config.serverAddress && config.username && config.password;
    const webDAVEnabled = config.webDAVEnabled !== false;

    // 检查本地备份配置
    const defaultDownloadEnabled = config.defaultDownloadEnabled === true;
    const localBackupConfigured = defaultDownloadEnabled;

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

function escapeHtmlBg(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 准备导出数据（树 + 变化映射）
 * @param {Object} record - 当前记录
 * @param {Array} syncHistory - 完整历史
 * @returns {Object} { treeToExport, changeMap }
 */
function prepareDataForExportBg(record, syncHistory) {
    let changeMap = new Map();
    const recordIndex = syncHistory.findIndex(r => r.time === record.time);
    let previousRecord = null;

    if (recordIndex > 0) {
        for (let i = recordIndex - 1; i >= 0; i--) {
            if (syncHistory[i].status === 'success' && syncHistory[i].bookmarkTree) {
                previousRecord = syncHistory[i];
                break;
            }
        }
    }

    let treeToExport = record.bookmarkTree;

    if (previousRecord && previousRecord.bookmarkTree) {
        changeMap = detectTreeChangesFastBg(previousRecord.bookmarkTree, record.bookmarkTree, {
            explicitMovedIdSet: (record.bookmarkStats && Array.isArray(record.bookmarkStats.explicitMovedIds))
                ? record.bookmarkStats.explicitMovedIds
                : null
        });

        // 检查是否有删除
        let hasDeleted = false;
        for (const [, change] of changeMap) {
            if (change.type && change.type.includes('deleted')) {
                hasDeleted = true;
                break;
            }
        }
        if (hasDeleted) {
            try {
                treeToExport = rebuildTreeWithDeletedBg(previousRecord.bookmarkTree, record.bookmarkTree, changeMap);
            } catch (error) {
                treeToExport = record.bookmarkTree;
            }
        }
    } else if (record.isFirstBackup) {
        const allNodes = flattenBookmarkTreeBg(record.bookmarkTree);
        allNodes.forEach(item => {
            if (item.id) changeMap.set(item.id, { type: 'added' });
        });
    }

    return { treeToExport, changeMap };
}

/**
 * 生成完整书签树的 HTML（Netscape Bookmark 格式）
 * 使用变化检测，添加 [+]、[-]、[~]、[↔] 等前缀标记
 * 与 history.js 的全局导出一致
 * @param {Object} record - 备份记录
 * @param {Object} historyViewSettings - 视图设置（包含展开状态）
 * @param {string} lang - 语言
 * @param {Array} syncHistory - 完整历史（用于变化检测）
 * @returns {string} HTML 内容
 */
function generateFullBookmarkTreeHtml(record, historyViewSettings, lang = 'zh_CN', syncHistory = []) {
    try {
        const isZh = lang === 'zh_CN';
        const stats = record?.bookmarkStats || {};

        // 使用变化检测准备数据（添加错误处理）
        let treeToExport = record?.bookmarkTree;
        let changeMap = new Map();

        try {
            const prepared = prepareDataForExportBg(record, syncHistory);
            if (prepared) {
                treeToExport = prepared.treeToExport || record?.bookmarkTree;
                changeMap = prepared.changeMap || new Map();
            }
        } catch (prepError) {
            console.warn('[generateFullBookmarkTreeHtml] 变化检测失败，使用原始树:', prepError);
        }

        // 获取展开状态（WYSIWYG）
        const recordTimeKey = String(record?.time || Date.now());
        const expandedIds = historyViewSettings?.recordExpandedStates?.[recordTimeKey] || [];
        const expandedSet = new Set(expandedIds.map(id => String(id)));
        const hasExpandedState = expandedSet.size > 0;

        // 格式化时间
        const backupTime = new Date(record?.time || Date.now()).toLocaleString(isZh ? 'zh-CN' : 'en-US');
        const exportTime = new Date().toLocaleString(isZh ? 'zh-CN' : 'en-US');

        let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
        html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
        html += `<TITLE>${isZh ? '书签变化' : 'Bookmark Changes'}</TITLE>\n`;
        html += `<H1>${isZh ? '书签变化' : 'Bookmark Changes'}</H1>\n`;
        html += '<DL><p>\n';

        // 添加图例和元数据
        const legendText = isZh
            ? '📋 前缀说明: [+]新增  [-]删除  [~]修改  [↔]移动'
            : '📋 Prefix legend: [+]Added  [-]Deleted  [~]Modified  [↔]Moved';
        html += `    <DT><H3>${legendText}</H3>\n`;
        html += '    <DL><p>\n';

        // 统计信息
        const statsText = [];
        if (stats.bookmarkAdded) statsText.push(`[+]${isZh ? '书签' : 'Bookmark'}:${stats.bookmarkAdded}`);
        if (stats.bookmarkDeleted) statsText.push(`[-]${isZh ? '书签' : 'Bookmark'}:${stats.bookmarkDeleted}`);
        if (stats.folderAdded) statsText.push(`[+]${isZh ? '文件夹' : 'Folder'}:${stats.folderAdded}`);
        if (stats.folderDeleted) statsText.push(`[-]${isZh ? '文件夹' : 'Folder'}:${stats.folderDeleted}`);
        if (stats.movedCount) statsText.push(`[↔]${isZh ? '移动' : 'Moved'}:${stats.movedCount}`);
        if (stats.modifiedCount) statsText.push(`[~]${isZh ? '修改' : 'Modified'}:${stats.modifiedCount}`);

        html += `        <DT><A HREF="about:blank">${isZh ? '操作统计' : 'Operation Counts'}: ${statsText.length > 0 ? statsText.join(' ') : (isZh ? '无变化' : 'No changes')}</A>\n`;
        html += `        <DT><A HREF="about:blank">${isZh ? '导出时间' : 'Export Time'}: ${escapeHtmlBg(exportTime)}</A>\n`;
        html += `        <DT><A HREF="about:blank">${isZh ? '备份时间' : 'Backup Time'}: ${escapeHtmlBg(backupTime)}</A>\n`;
        html += `        <DT><A HREF="about:blank">${isZh ? '备注' : 'Note'}: ${escapeHtmlBg(record.note || (isZh ? '无备注' : 'No note'))}</A>\n`;
        html += '    </DL><p>\n';

        // 检查某个节点或其子节点是否有变化
        function hasChangesRecursive(node) {
            if (!node) return false;
            if (changeMap.has(node.id)) return true;
            if (node.children) {
                return node.children.some(child => hasChangesRecursive(child));
            }
            return false;
        }

        // 递归生成书签树（带变化标记）
        function generateNode(node, indentLevel) {
            if (!node) return '';

            // 检查该节点或其子节点是否有变化
            const nodeHasChanges = hasChangesRecursive(node);

            let result = '';
            const indent = '    '.repeat(indentLevel);
            const title = node.title || (isZh ? '(无标题)' : '(Untitled)');
            const url = node.url;
            const isFolder = !url && node.children;

            // 检查变化类型并添加前缀
            let prefix = '';
            const change = changeMap.get(node.id);
            if (change) {
                const types = change.type ? change.type.split('+') : [];
                if (types.includes('added')) {
                    prefix = '[+] ';
                } else if (types.includes('deleted')) {
                    prefix = '[-] ';
                } else if (types.includes('modified') && types.includes('moved')) {
                    prefix = '[~↔] ';
                } else if (types.includes('modified')) {
                    prefix = '[~] ';
                } else if (types.includes('moved')) {
                    prefix = '[↔] ';
                }
            }

            const displayTitle = prefix + escapeHtmlBg(title);

            if (isFolder) {
                result += `${indent}<DT><H3>${displayTitle}</H3>\n`;
                result += `${indent}<DL><p>\n`;

                // 检查是否应该展开（WYSIWYG）
                let shouldExpand = false;
                if (hasExpandedState) {
                    // WYSIWYG: 只展开用户手动展开过的节点
                    shouldExpand = expandedSet.has(String(node.id));
                } else {
                    // 默认行为：只有有变化的路径才展开
                    shouldExpand = nodeHasChanges;
                }

                if (node.children && node.children.length > 0 && shouldExpand) {
                    node.children.forEach(child => {
                        result += generateNode(child, indentLevel + 1);
                    });
                }

                result += `${indent}</DL><p>\n`;
            } else if (url) {
                result += `${indent}<DT><A HREF="${escapeHtmlBg(url)}">${displayTitle}</A>\n`;
            }

            return result;
        }

        // 生成所有子节点
        if (treeToExport) {
            const nodes = Array.isArray(treeToExport) ? treeToExport : [treeToExport];
            nodes.forEach(node => {
                if (node && node.children) {
                    node.children.forEach(child => {
                        html += generateNode(child, 1);
                    });
                }
            });
        } else {
            html += `    <DT><H3>${isZh ? '(无书签数据)' : '(No bookmark data)'}</H3>\n`;
        }

        html += '</DL><p>\n';
        return html;
    } catch (error) {
        console.error('[generateFullBookmarkTreeHtml] 生成失败:', error);
        const isZh = lang === 'zh_CN';
        return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>${isZh ? '书签备份（错误）' : 'Bookmark Backup (Error)'}</TITLE>
<H1>${isZh ? '生成失败' : 'Generation Failed'}</H1>
<DL><p>
    <DT><A HREF="about:blank">${isZh ? '错误信息' : 'Error'}: ${escapeHtmlBg(error.message)}</A>
</DL><p>
`;
    }
}

/**
 * 生成完整书签树的 JSON
 * 使用变化检测，添加变化类型标记
 * 与 history.js 的全局导出一致
 * @param {Object} record - 备份记录
 * @param {Object} historyViewSettings - 视图设置（包含展开状态）
 * @param {string} lang - 语言
 * @param {Array} syncHistory - 完整历史（用于变化检测）
 * @returns {string} JSON 内容
 */
function generateFullBookmarkTreeJson(record, historyViewSettings, lang = 'zh_CN', syncHistory = []) {
    try {
        const isZh = lang === 'zh_CN';
        const stats = record?.bookmarkStats || {};

        // 使用变化检测准备数据（添加错误处理）
        let treeToExport = record?.bookmarkTree;
        let changeMap = new Map();

        try {
            const prepared = prepareDataForExportBg(record, syncHistory);
            if (prepared) {
                treeToExport = prepared.treeToExport || record?.bookmarkTree;
                changeMap = prepared.changeMap || new Map();
            }
        } catch (prepError) {
            console.warn('[generateFullBookmarkTreeJson] 变化检测失败，使用原始树:', prepError);
        }

        // 获取展开状态（WYSIWYG）
        const recordTimeKey = String(record?.time || Date.now());
        const expandedIds = historyViewSettings?.recordExpandedStates?.[recordTimeKey] || [];
        const expandedSet = new Set(expandedIds.map(id => String(id)));
        const hasExpandedState = expandedSet.size > 0;

        // 检查某个节点或其子节点是否有变化
        function hasChangesRecursive(node) {
            if (!node) return false;
            if (changeMap.has(node.id)) return true;
            if (node.children) {
                return node.children.some(child => hasChangesRecursive(child));
            }
            return false;
        }

        // 递归提取树（带变化标记）
        function extractNode(node) {
            if (!node) return null;

            const nodeHasChanges = hasChangesRecursive(node);
            const title = node.title || (isZh ? '(无标题)' : '(Untitled)');
            const url = node.url;
            const isFolder = !url && node.children;

            // 检查变化类型并添加前缀
            let prefix = '';
            let changeType = null;
            const change = changeMap.get(node.id);
            if (change) {
                changeType = change.type;
                const types = change.type ? change.type.split('+') : [];
                if (types.includes('added')) {
                    prefix = '[+] ';
                } else if (types.includes('deleted')) {
                    prefix = '[-] ';
                } else if (types.includes('modified') && types.includes('moved')) {
                    prefix = '[~↔] ';
                } else if (types.includes('modified')) {
                    prefix = '[~] ';
                } else if (types.includes('moved')) {
                    prefix = '[↔] ';
                }
            }

            const item = {
                id: node.id || null,  // 保存 ID 用于恢复
                title: prefix + title,
                type: isFolder ? 'folder' : 'bookmark',
                ...(url ? { url } : {}),
                ...(changeType ? { changeType } : {})
            };

            if (isFolder && node.children) {
                // 检查是否应该展开（WYSIWYG）
                let shouldExpand = false;
                if (hasExpandedState) {
                    shouldExpand = expandedSet.has(String(node.id));
                } else {
                    shouldExpand = nodeHasChanges;
                }

                if (shouldExpand) {
                    item.children = node.children
                        .map(child => extractNode(child))
                        .filter(child => child !== null);
                } else {
                    item.children = [];
                    item._collapsed = true;
                }
            }

            return item;
        }

        const exportData = {
            title: isZh ? '书签变化导出' : 'Bookmark Changes Export',
            _exportInfo: {
                backupTime: record?.time,
                exportTime: new Date().toISOString(),
                note: record?.note || null,
                seqNumber: record?.seqNumber,
                fingerprint: record?.fingerprint,
                stats: stats,
                // 恢复支持：保存展开状态
                expandedIds: expandedIds,
                viewMode: hasExpandedState ? 'detailed' : 'auto'
            },
            // 恢复支持：保存原始书签树（用于完整恢复）
            _rawBookmarkTree: record?.bookmarkTree || null,
            children: []
        };

        if (treeToExport) {
            const nodes = Array.isArray(treeToExport) ? treeToExport : [treeToExport];
            nodes.forEach(node => {
                if (node && node.children) {
                    node.children.forEach(child => {
                        const extracted = extractNode(child);
                        if (extracted) exportData.children.push(extracted);
                    });
                }
            });
        }

        return JSON.stringify(exportData, null, 2);
    } catch (error) {
        console.error('[generateFullBookmarkTreeJson] 生成失败:', error);
        const isZh = lang === 'zh_CN';
        return JSON.stringify({
            title: isZh ? '书签备份（错误）' : 'Bookmark Backup (Error)',
            error: error.message,
            children: []
        }, null, 2);
    }
}

async function blobToBase64(blob) {
    if (!blob) return '';
    const buf = await blob.arrayBuffer();
    return arrayBufferToBase64(buf);
}

/**
 * 导出备份历史到云端
 * 支持两种打包模式：
 * - zip: 生成 ZIP 归档文件，每条记录作为独立文件
 * - merge: 生成单一合并文件，所有记录合并在一起
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 导出结果
 */
async function exportSyncHistoryToCloud(options = {}) {
    try {
        // 获取设置和数据（包括统一存储的视图设置）
        const settings = await browserAPI.storage.local.get([
            'syncHistory',
            'historyViewSettings',  // 统一存储的视图设置（WYSIWYG）
            'historySyncEnabled', // 备份历史自动同步开关
            'historySyncFormat',
            'historySyncPackMode', // 打包模式：'zip' 或 'merge'
            'serverAddress',
            'username',
            'password',
            'webDAVEnabled',
            'githubRepoToken',
            'githubRepoOwner',
            'githubRepoName',
            'githubRepoBranch',
            'githubRepoBasePath',
            'githubRepoEnabled',
            'defaultDownloadEnabled'
        ]);

        // 检查是否启用备份历史自动同步
        if (settings.historySyncEnabled === false) {
            console.log('[exportSyncHistoryToCloud] 备份历史同步已禁用，跳过导出');
            return { success: true, skipped: true, reason: 'disabled' };
        }

        const syncHistory = settings.syncHistory || [];
        if (syncHistory.length === 0) {
            console.log('[exportSyncHistoryToCloud] 无备份历史，跳过导出');
            return { success: true, skipped: true };
        }

        // 获取视图设置（用于 WYSIWYG 导出）
        const historyViewSettings = settings.historyViewSettings || {
            defaultMode: 'detailed',
            recordModes: {},
            recordExpandedStates: {}
        };
        console.log('[exportSyncHistoryToCloud] 视图设置:', {
            defaultMode: historyViewSettings.defaultMode,
            recordModesCount: Object.keys(historyViewSettings.recordModes || {}).length,
            expandedStatesCount: Object.keys(historyViewSettings.recordExpandedStates || {}).length
        });

        const format = settings.historySyncFormat || 'json'; // 默认 JSON（包含完整恢复信息）
        const packMode = settings.historySyncPackMode || 'merge'; // 默认 Merge（生成 backup_history.json）
        const lang = await getCurrentLang();
        const isZh = lang === 'zh_CN';

        // 生成时间戳
        const timestamp = new Date();
        const timestampStr = `${timestamp.getFullYear()}${(timestamp.getMonth() + 1).toString().padStart(2, '0')}${timestamp.getDate().toString().padStart(2, '0')}_${timestamp.getHours().toString().padStart(2, '0')}${timestamp.getMinutes().toString().padStart(2, '0')}${timestamp.getSeconds().toString().padStart(2, '0')}`;

        const tasks = [];
        const exportRootFolder = getExportRootFolderByLang(lang);
        const historyFolder = isZh ? '备份历史' : 'Backup_History';

        // 检查导出目标
        const webDAVConfigured = settings.serverAddress && settings.username && settings.password;
        const webDAVEnabled = settings.webDAVEnabled !== false;
        const githubConfigured = settings.githubRepoToken && settings.githubRepoOwner && settings.githubRepoName;
        const githubEnabled = settings.githubRepoEnabled !== false;
        const localEnabled = settings.defaultDownloadEnabled;

        // ============= ZIP 归档模式 =============
        if (packMode === 'zip') {
            console.log('[exportSyncHistoryToCloud] 使用 ZIP 归档模式');

            // Split storage：Zip 模式需要从独立 key 加载 bookmarkTree
            try {
                const dataKeys = Array.from(new Set(syncHistory
                    .filter(r => r && r.hasData && r.time)
                    .map(r => `backup_data_${r.time}`)));

                if (dataKeys.length > 0) {
                    const data = await browserAPI.storage.local.get(dataKeys);
                    for (const r of syncHistory) {
                        if (!r) continue;
                        if (!r.bookmarkTree && r.hasData) {
                            const key = `backup_data_${r.time}`;
                            if (data && data[key]) {
                                r.bookmarkTree = data[key];
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[exportSyncHistoryToCloud] Zip 模式预加载 bookmarkTree 失败:', e);
            }

            const files = [];
            const zipPrefix = isZh ? '备份历史归档' : 'Backup_History_Archive';
            const zipRootFolder = `${zipPrefix}_${timestampStr}`;
            const seqWidth = String(syncHistory.length).length;

            // 按时间倒序排列（新的在前）
            const sortedHistory = [...syncHistory].sort((a, b) => {
                const timeA = new Date(a.time).getTime();
                const timeB = new Date(b.time).getTime();
                return timeB - timeA;
            });

            // 直接从存储生成完整书签树（不依赖 history.html 页面）
            for (let idx = 0; idx < sortedHistory.length; idx++) {
                const record = sortedHistory[idx];

                try {
                    const seqNumber = record.seqNumber || (syncHistory.length - idx);
                    const seqStr = String(seqNumber).padStart(seqWidth, '0');
                    const recordTime = new Date(record.time);
                    const dateStr = `${recordTime.getFullYear()}${(recordTime.getMonth() + 1).toString().padStart(2, '0')}${recordTime.getDate().toString().padStart(2, '0')}_${recordTime.getHours().toString().padStart(2, '0')}${recordTime.getMinutes().toString().padStart(2, '0')}`;
                    const fingerprint = record.fingerprint ? `_${record.fingerprint.substring(0, 7)}` : '';
                    const cleanNote = record.note ? record.note.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').substring(0, 30) : '';
                    const notePrefix = cleanNote || (isZh ? '备份' : 'backup');

                    const baseName = `${seqStr}_${notePrefix}${fingerprint}_${dateStr}`;
                    const filePath = `${zipRootFolder}/${baseName}`;

                    // 使用 generateFullBookmarkTreeHtml/Json 生成完整书签树（支持变化检测和 WYSIWYG 展开状态）
                    if (format === 'html') {
                        console.log('[exportSyncHistoryToCloud] 生成 HTML:', record.time);
                        const htmlContent = generateFullBookmarkTreeHtml(record, historyViewSettings, lang, syncHistory);
                        files.push({
                            name: `${filePath}.html`,
                            data: __toUint8(htmlContent)
                        });
                    }
                    if (format === 'json') {
                        console.log('[exportSyncHistoryToCloud] 生成 JSON:', record.time);
                        const jsonContent = generateFullBookmarkTreeJson(record, historyViewSettings, lang, syncHistory);
                        files.push({
                            name: `${filePath}.json`,
                            data: __toUint8(jsonContent)
                        });
                    }
                } catch (recordError) {
                    console.error('[exportSyncHistoryToCloud] 处理记录失败:', record.time, recordError);
                }
            }

            console.log('[exportSyncHistoryToCloud] 生成文件数量:', files.length);

            if (files.length > 0) {
                // 创建 ZIP Blob
                const zipBlob = __zipStore(files);
                // 使用固定文件名（覆盖模式）- ZIP 内部仍然按时间组织
                const zipFileName = isZh ? '备份历史归档.zip' : 'Backup_History_Archive.zip';
                const zipBase64 = await blobToBase64(zipBlob);

                // 上传到 WebDAV
                if (webDAVConfigured && webDAVEnabled) {
                    tasks.push(uploadHistoryBinaryToWebDAV(zipBase64, zipFileName, exportRootFolder, historyFolder, settings));
                }

                // 上传到 GitHub
                if (githubConfigured && githubEnabled) {
                    tasks.push(uploadHistoryBinaryToGitHub(zipBase64, zipFileName, historyFolder, settings, lang));
                }

                // 本地下载
                if (localEnabled) {
                    tasks.push(downloadHistoryBinaryLocal(zipBlob, zipFileName, exportRootFolder, historyFolder));
                }
            }
        }
        // ============= 合并历史模式（用于恢复版本选择） =============
        else if (packMode === 'merge') {
            console.log('[exportSyncHistoryToCloud] 使用合并历史模式: backup_history.json');

            if (format !== 'json') {
                console.warn('[exportSyncHistoryToCloud] 合并历史模式仅支持 JSON，已忽略 format:', format);
            }

            // 按时间倒序排列（新的在前）
            const sortedHistory = [...syncHistory].sort((a, b) => {
                const timeA = new Date(a.time).getTime();
                const timeB = new Date(b.time).getTime();
                return timeB - timeA;
            });

            const exportTime = new Date().toISOString();
            const mergedRecords = [];

            for (const record of sortedHistory) {
                try {
                    let bookmarkTree = record?.bookmarkTree || null;
                    if (!bookmarkTree && record?.hasData) {
                        const key = `backup_data_${record.time}`;
                        const data = await browserAPI.storage.local.get([key]);
                        bookmarkTree = data?.[key] || null;
                    }

                    if (!bookmarkTree) {
                        continue;
                    }

                    mergedRecords.push({
                        _exportInfo: {
                            backupTime: record?.time || null,
                            exportTime: exportTime,
                            note: record?.note || null,
                            seqNumber: record?.seqNumber || null,
                            fingerprint: record?.fingerprint || null,
                            stats: record?.bookmarkStats || {}
                        },
                        _rawBookmarkTree: bookmarkTree
                    });
                } catch (recordError) {
                    console.error('[exportSyncHistoryToCloud] 合并历史记录处理失败:', record?.time, recordError);
                }
            }

            const fileName = 'backup_history.json';
            const jsonContent = JSON.stringify(mergedRecords, null, 2);

            if (webDAVConfigured && webDAVEnabled) {
                tasks.push(uploadHistoryToWebDAV(jsonContent, fileName, exportRootFolder, historyFolder, settings));
            }
            if (githubConfigured && githubEnabled) {
                tasks.push(uploadHistoryToGitHub(jsonContent, fileName, historyFolder, settings, lang));
            }
            if (localEnabled) {
                tasks.push(downloadHistoryLocal(jsonContent, fileName, exportRootFolder, historyFolder, 'overwrite'));
            }
        }

        if (tasks.length === 0) {
            console.log('[exportSyncHistoryToCloud] 没有配置任何导出目标');
            return { success: true, skipped: true };
        }

        await Promise.all(tasks);
        console.log('[exportSyncHistoryToCloud] 备份历史导出完成');
        return { success: true };

    } catch (error) {
        console.error('[exportSyncHistoryToCloud] 导出失败:', error);
        return { success: false, error: error.message };
    }
}

function shouldIgnoreDownloadsLastErrorMessage(message) {
    const msg = String(message || '');
    return msg.includes('already deleted') || msg.includes('Download file already deleted');
}

async function downloadsRemoveFileSafe(downloadId) {
    const id = Number(downloadId);
    if (!Number.isFinite(id) || id <= 0) return;
    await new Promise((resolve) => {
        try {
            browserAPI.downloads.removeFile(id, () => {
                const err = browserAPI.runtime?.lastError;
                if (err && !shouldIgnoreDownloadsLastErrorMessage(err.message)) {
                    console.warn('[downloadsRemoveFileSafe] removeFile failed:', err.message);
                }
                resolve();
            });
        } catch (e) {
            resolve();
        }
    });
}

async function downloadsEraseSafe(query) {
    const q = query && typeof query === 'object' ? query : null;
    if (!q) return;
    await new Promise((resolve) => {
        try {
            browserAPI.downloads.erase(q, () => {
                const err = browserAPI.runtime?.lastError;
                if (err && !shouldIgnoreDownloadsLastErrorMessage(err.message)) {
                    console.warn('[downloadsEraseSafe] erase failed:', err.message);
                }
                resolve();
            });
        } catch (e) {
            resolve();
        }
    });
}

// 辅助函数：上传二进制文件到 WebDAV (用于 ZIP)
async function uploadHistoryBinaryToWebDAV(base64Content, fileName, rootFolder, subFolder, settings) {
    try {
        const serverAddress = settings.serverAddress.replace(/\/+$/, '/');
        const folderPath = `${rootFolder}/${subFolder}/`;
        const fullUrl = `${serverAddress}${folderPath}${fileName}`;
        const folderUrl = `${serverAddress}${folderPath}`;
        const parentUrl = `${serverAddress}${rootFolder}/`;

        const authHeader = 'Basic ' + safeBase64(`${settings.username}:${settings.password}`);

        // 确保文件夹存在
        await ensureWebDAVCollectionExists(parentUrl, authHeader, '创建父文件夹失败');
        await ensureWebDAVCollectionExists(folderUrl, authHeader, '创建备份历史文件夹失败');

        // 将 Base64 转换为 ArrayBuffer
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // 上传文件
        await fetch(fullUrl, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/zip',
                'Overwrite': 'T'
            },
            body: bytes.buffer
        });

        console.log(`[uploadHistoryBinaryToWebDAV] 上传成功: ${fileName}`);
    } catch (e) {
        console.warn('[uploadHistoryBinaryToWebDAV] 上传失败:', e);
    }
}

// 辅助函数：上传二进制文件到 GitHub (用于 ZIP)
async function uploadHistoryBinaryToGitHub(base64Content, fileName, subFolder, settings, lang) {
    try {
        const filePath = buildGitHubRepoFilePath({
            basePath: settings.githubRepoBasePath,
            lang,
            folderKey: 'backup_history',
            fileName
        });

        await upsertRepoFile({
            token: settings.githubRepoToken,
            owner: settings.githubRepoOwner,
            repo: settings.githubRepoName,
            branch: settings.githubRepoBranch,
            path: filePath,
            message: `Backup History Archive: ${fileName}`,
            contentBase64: base64Content
        });

        console.log(`[uploadHistoryBinaryToGitHub] 上传成功: ${fileName}`);
    } catch (e) {
        console.warn('[uploadHistoryBinaryToGitHub] 上传失败:', e);
    }
}

// 辅助函数：本地下载二进制文件 (用于 ZIP)
// 使用与书签备份相同的覆盖策略：ID 持久化 + 预删除
async function downloadHistoryBinaryLocal(blob, fileName, rootFolder, subFolder, overwriteMode = 'overwrite') {
    try {
        // Manifest V3 Service Worker 不支持 URL.createObjectURL
        // 使用 Data URL 代替
        const base64 = await blobToBase64(blob);
        const url = `data:application/zip;base64,${base64}`;
        const fullFilePath = `${rootFolder}/${subFolder}/${fileName}`;
        const storageKey = 'lastLocalHistoryZipId'; // ZIP 文件专用的持久化 ID

        // 覆盖模式：尝试删除旧文件
        if (overwriteMode === 'overwrite') {
            try {
                let deleted = false;

                // 方法1：尝试通过持久化存储的 ID 删除（最可靠）
                const storageResult = await browserAPI.storage.local.get([storageKey]);
                const lastId = storageResult[storageKey];

                if (lastId) {
                    try {
                        // 检查该 ID 是否还存在于下载历史中
                        const exists = await new Promise(resolve => {
                            browserAPI.downloads.search({ id: lastId }, results => {
                                resolve(results && results.length > 0);
                            });
                        });

                        if (exists) {
                            await downloadsRemoveFileSafe(lastId);
                            await downloadsEraseSafe({ id: lastId });
                            console.log('[downloadHistoryBinaryLocal] 通过ID已删除旧ZIP文件:', lastId);
                            deleted = true;
                        }
                    } catch (e) {
                        console.warn('[downloadHistoryBinaryLocal] ZIP ID删除失败:', e);
                    }
                }

                // 方法2：如果方法1失效，尝试通过文件名搜索删除（备选）
                if (!deleted) {
                    const existingDownloads = await new Promise((resolve) => {
                        browserAPI.downloads.search({
                            filenameRegex: `.*${fileName.replace('.', '\\\\.')}$`,
                            state: 'complete'
                        }, (results) => {
                            resolve(results || []);
                        });
                    });

                    for (const item of existingDownloads) {
                        if (item.filename && item.filename.endsWith(fileName)) {
                            try {
                                await downloadsRemoveFileSafe(item.id);
                                await downloadsEraseSafe({ id: item.id });
                                console.log('[downloadHistoryBinaryLocal] 通过搜索已删除旧ZIP文件:', item.filename);
                            } catch (err) {
                                console.warn('[downloadHistoryBinaryLocal] ZIP搜索删除失败:', err);
                            }
                        }
                    }
                }
            } catch (cleanupError) {
                console.warn('[downloadHistoryBinaryLocal] 清理旧ZIP文件失败:', cleanupError);
            }
        }

        await new Promise((resolve, reject) => {
            browserAPI.downloads.download({
                url: url,
                filename: fullFilePath,
                saveAs: false,
                conflictAction: 'overwrite'
            }, (id) => {
                if (browserAPI.runtime.lastError) {
                    reject(new Error(browserAPI.runtime.lastError.message));
                } else {
                    // 覆盖模式下：保存新的下载ID（用于下次覆盖）
                    if (overwriteMode === 'overwrite') {
                        const updates = {};
                        updates[storageKey] = id;
                        browserAPI.storage.local.set(updates);
                    }
                    resolve(id);
                }
            });
        });

        console.log(`[downloadHistoryBinaryLocal] 下载成功: ${fileName}`);
    } catch (e) {
        console.warn('[downloadHistoryBinaryLocal] 下载失败:', e);
    }
}

// 辅助函数：上传到 WebDAV
async function uploadHistoryToWebDAV(content, fileName, rootFolder, subFolder, settings) {
    try {
        const serverAddress = settings.serverAddress.replace(/\/+$/, '/');
        const folderPath = `${rootFolder}/${subFolder}/`;
        const fullUrl = `${serverAddress}${folderPath}${fileName}`;
        const folderUrl = `${serverAddress}${folderPath}`;
        const parentUrl = `${serverAddress}${rootFolder}/`;

        const authHeader = 'Basic ' + safeBase64(`${settings.username}:${settings.password}`);

        // 确保文件夹存在
        await ensureWebDAVCollectionExists(parentUrl, authHeader, '创建父文件夹失败');
        await ensureWebDAVCollectionExists(folderUrl, authHeader, '创建备份历史文件夹失败');

        // 上传文件
        const contentType = fileName.endsWith('.json') ? 'application/json' : 'text/html';
        await fetch(fullUrl, {
            method: 'PUT',
            headers: {
                'Authorization': authHeader,
                'Content-Type': `${contentType}; charset=utf-8`,
                'Overwrite': 'T'
            },
            body: content
        });

        console.log(`[uploadHistoryToWebDAV] 上传成功: ${fileName}`);
    } catch (e) {
        console.warn('[uploadHistoryToWebDAV] 上传失败:', e);
    }
}

// 辅助函数：上传到 GitHub
async function uploadHistoryToGitHub(content, fileName, subFolder, settings, lang) {
    try {
        const filePath = buildGitHubRepoFilePath({
            basePath: settings.githubRepoBasePath,
            lang,
            folderKey: 'backup_history',
            fileName
        });

        await upsertRepoFile({
            token: settings.githubRepoToken,
            owner: settings.githubRepoOwner,
            repo: settings.githubRepoName,
            branch: settings.githubRepoBranch,
            path: filePath,
            message: `Backup History: ${fileName}`,
            contentBase64: textToBase64(content)
        });

        console.log(`[uploadHistoryToGitHub] 上传成功: ${fileName}`);
    } catch (e) {
        console.warn('[uploadHistoryToGitHub] 上传失败:', e);
    }
}

// 辅助函数：本地下载文件 (用于 JSON)
async function downloadHistoryLocal(content, fileName, rootFolder, subFolder, overwriteMode = 'overwrite') {
    try {
        const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(content);
        const fullFilePath = `${rootFolder}/${subFolder}/${fileName}`;
        const storageKey = 'lastLocalHistoryJsonId';

        // 覆盖模式：尝试删除旧文件
        if (overwriteMode === 'overwrite') {
            try {
                let deleted = false;

                const storageResult = await browserAPI.storage.local.get([storageKey]);
                const lastId = storageResult[storageKey];
                if (lastId) {
                    try {
                        const exists = await new Promise(resolve => {
                            browserAPI.downloads.search({ id: lastId }, results => {
                                resolve(results && results.length > 0);
                            });
                        });
                        if (exists) {
                            await downloadsRemoveFileSafe(lastId);
                            await downloadsEraseSafe({ id: lastId });
                            deleted = true;
                        }
                    } catch (_) { }
                }

                if (!deleted) {
                    const existingDownloads = await new Promise((resolve) => {
                        browserAPI.downloads.search({
                            filenameRegex: `.*${fileName.replace('.', '\\\\.')}$`,
                            state: 'complete'
                        }, (results) => resolve(results || []));
                    });
                    for (const item of existingDownloads) {
                        if (item.filename && item.filename.endsWith(fileName)) {
                            try {
                                await downloadsRemoveFileSafe(item.id);
                                await downloadsEraseSafe({ id: item.id });
                            } catch (_) { }
                        }
                    }
                }
            } catch (_) { }
        }

        await new Promise((resolve, reject) => {
            browserAPI.downloads.download({
                url: dataUrl,
                filename: fullFilePath,
                saveAs: false,
                conflictAction: 'overwrite'
            }, (id) => {
                if (browserAPI.runtime.lastError) {
                    reject(new Error(browserAPI.runtime.lastError.message));
                } else {
                    if (overwriteMode === 'overwrite') {
                        const updates = {};
                        updates[storageKey] = id;
                        browserAPI.storage.local.set(updates);
                    }
                    resolve(id);
                }
            });
        });
    } catch (e) {
        console.warn('[downloadHistoryLocal] 下载失败:', e);
    }
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
            'defaultDownloadEnabled'
        ]);

        // 检查是否启用任一本地备份方式
        const defaultDownloadEnabled = localConfig.defaultDownloadEnabled === true;
        // 检查至少有一种备份方式已配置
        const localBackupConfigured = defaultDownloadEnabled;
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

        const syncTime = new Date().toISOString();
        const snapshotNaming = buildSnapshotNamingContext({ syncTime });

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
                        const uploadResult = await uploadBookmarks(localBookmarks, snapshotNaming);
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
                        const uploadResult = await uploadBookmarksToGitHubRepo(localBookmarks, snapshotNaming);
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
                    const localResult = await uploadBookmarksToLocal(localBookmarks, snapshotNaming);
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
        await updateSyncStatus(syncDirection, syncTime, syncStatus, errorMessage, syncType, autoBackupReason, snapshotNaming.fingerprint);

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
        ['BookmarkFaviconCache'].forEach(dbName => {
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

function normalizeRootKey(id, title) {
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
}

function countBookmarkTreeContentNodes(snapshotTree) {
    if (!snapshotTree) return 0;

    const roots = Array.isArray(snapshotTree) ? snapshotTree : [snapshotTree];
    if (!roots.length) return 0;

    let count = 0;

    const countAsContentNode = (node) => {
        if (!node || typeof node !== 'object') return;
        count += 1;

        if (Array.isArray(node.children) && node.children.length) {
            for (const child of node.children) {
                countAsContentNode(child);
            }
        }
    };

    const hasTopWrapper =
        roots.length === 1 &&
        roots[0] &&
        typeof roots[0] === 'object' &&
        !roots[0].url &&
        Array.isArray(roots[0].children);

    if (!hasTopWrapper) {
        for (const node of roots) {
            countAsContentNode(node);
        }
        return count;
    }

    const topRoot = roots[0];
    const topContainers = Array.isArray(topRoot.children) ? topRoot.children : [];
    for (const container of topContainers) {
        if (!container || typeof container !== 'object') continue;

        if (container.url) {
            count += 1;
            continue;
        }

        const children = Array.isArray(container.children) ? container.children : [];
        for (const child of children) {
            countAsContentNode(child);
        }
    }

    return count;
}

function hasBookmarkTreeContent(snapshotTree) {
    return countBookmarkTreeContentNodes(snapshotTree) > 0;
}

function buildEmptySnapshotError(preferredLang = 'zh_CN', mode = 'overwrite') {
    const isEn = preferredLang === 'en';
    if (mode === 'merge') {
        return isEn
            ? 'Target bookmark tree is empty. Import merge is blocked.'
            : '目标书签树为空，已阻止导入合并。';
    }
    if (mode === 'revert') {
        return isEn
            ? 'Target bookmark tree is empty. Revert is blocked to avoid deleting current bookmarks.'
            : '目标书签树为空，已阻止撤销以避免误删当前书签。';
    }
    return isEn
        ? 'Target bookmark tree is empty. Overwrite restore is blocked to avoid wiping current bookmarks.'
        : '目标书签树为空，已阻止覆盖恢复以避免清空当前书签。';
}

function buildEmptySnapshotNoopMessage(preferredLang = 'zh_CN', mode = 'overwrite') {
    const isEn = preferredLang === 'en';
    if (mode === 'revert') {
        return isEn
            ? 'Current bookmarks already match the empty target bookmark tree. No overwrite revert is needed.'
            : '当前书签已与目标空书签树一致，无需执行覆盖撤销。';
    }

    return isEn
        ? 'Current bookmarks already match the empty target bookmark tree. No overwrite restore is needed.'
        : '当前书签已与目标空书签树一致，无需执行覆盖恢复。';
}

async function getCurrentRestorableNodeCount() {
    const currentTree = await browserAPI.bookmarks.getTree();
    return countBookmarkTreeContentNodes(currentTree);
}

function isBookmarkTreeShapeValid(snapshotTree) {
    if (!snapshotTree) return false;

    const roots = Array.isArray(snapshotTree) ? snapshotTree : [snapshotTree];
    if (!roots.length) return false;

    return roots.some(node =>
        !!node &&
        typeof node === 'object' &&
        (Array.isArray(node.children) || typeof node.url === 'string')
    );
}

function assertBookmarkTreeContent(snapshotTree, preferredLang = 'zh_CN', mode = 'overwrite') {
    if (!isBookmarkTreeShapeValid(snapshotTree)) {
        throw new Error(preferredLang === 'en' ? 'Invalid snapshot data' : '快照数据无效');
    }

    if (hasBookmarkTreeContent(snapshotTree)) return;

    throw new Error(buildEmptySnapshotError(preferredLang, mode));
}

const REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT = 40;
const REVERT_PATCH_THRESHOLD_MIN_PERCENT = 1;
const REVERT_PATCH_THRESHOLD_MAX_PERCENT = 99;
const REVERT_PATCH_RATIO_THRESHOLD = REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT / 100;

function normalizeRevertPatchThresholdPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT;
    return Math.min(
        REVERT_PATCH_THRESHOLD_MAX_PERCENT,
        Math.max(REVERT_PATCH_THRESHOLD_MIN_PERCENT, Math.round(num))
    );
}

function resolveRevertPatchThreshold(value) {
    const percent = normalizeRevertPatchThresholdPercent(value);
    return {
        thresholdPercent: percent,
        thresholdRatio: percent / 100
    };
}

function normalizeRevertStrategySelection(strategy) {
    const value = String(strategy || '').toLowerCase();
    if (value === 'patch') return 'patch';
    if (value === 'overwrite') return 'overwrite';
    return 'auto';
}

function computeRevertChangeScore(diffSummary) {
    const summary = diffSummary && typeof diffSummary === 'object' ? diffSummary : {};
    return Number(summary.bookmarkAdded || 0)
        + Number(summary.bookmarkDeleted || 0)
        + Number(summary.folderAdded || 0)
        + Number(summary.folderDeleted || 0)
        + Number(summary.movedCount || 0)
        + Number(summary.modifiedCount || 0);
}

function selectRevertStrategyForLastBackup({ requestedStrategy, diffSummary, baselineNodeCount, thresholdRatio = REVERT_PATCH_RATIO_THRESHOLD, thresholdPercent = REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT }) {
    const normalizedRequested = normalizeRevertStrategySelection(requestedStrategy);
    const safeBaseline = Number.isFinite(Number(baselineNodeCount)) && Number(baselineNodeCount) > 0
        ? Number(baselineNodeCount)
        : 1;
    const safeThresholdRatio = Number.isFinite(Number(thresholdRatio))
        ? Math.min(0.99, Math.max(0.01, Number(thresholdRatio)))
        : REVERT_PATCH_RATIO_THRESHOLD;
    const safeThresholdPercent = normalizeRevertPatchThresholdPercent(thresholdPercent);

    const changeScore = computeRevertChangeScore(diffSummary);
    const changeRatio = changeScore / safeBaseline;

    if (normalizedRequested === 'patch' || normalizedRequested === 'overwrite') {
        return {
            strategy: normalizedRequested,
            changeScore,
            baselineNodeCount: safeBaseline,
            changeRatio,
            thresholdRatio: safeThresholdRatio,
            thresholdPercent: safeThresholdPercent
        };
    }

    return {
        strategy: changeRatio > safeThresholdRatio ? 'overwrite' : 'patch',
        changeScore,
        baselineNodeCount: safeBaseline,
        changeRatio,
        thresholdRatio: safeThresholdRatio,
        thresholdPercent: safeThresholdPercent
    };
}

function computeIdStrictRevertDiffSummary(currentTree, snapshotTree) {
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

    if (!isBookmarkTreeShapeValid(currentTree) || !isBookmarkTreeShapeValid(snapshotTree)) {
        return summary;
    }

    const targetMeta = buildPatchTreeMeta(snapshotTree);
    const currentMeta = buildPatchTreeMeta(currentTree);
    const idRemap = mapRevertRootIds(currentTree, snapshotTree);
    const resolveTargetId = (targetId) => resolveRevertTargetId(targetId, idRemap);

    const protectedIds = new Set();
    if (currentMeta.rootId) protectedIds.add(String(currentMeta.rootId));
    for (const rootChildId of currentMeta.rootChildIds) {
        protectedIds.add(String(rootChildId));
    }

    const targetResolvedIds = new Set();
    targetMeta.nodeById.forEach((_, targetId) => {
        const resolved = resolveTargetId(targetId);
        if (resolved) targetResolvedIds.add(String(resolved));
    });

    currentMeta.nodeById.forEach((node, currentId) => {
        const sid = String(currentId);
        if (protectedIds.has(sid)) return;
        if (targetResolvedIds.has(sid)) return;

        if (node && node.isFolder) summary.folderDeleted += 1;
        else summary.bookmarkDeleted += 1;
    });

    targetMeta.nodeById.forEach((targetNode, targetId) => {
        const actualId = resolveTargetId(targetId);
        if (!actualId) return;

        const actualIdStr = String(actualId);
        const currentNode = currentMeta.nodeById.get(actualIdStr);

        if (!currentNode) {
            if (targetNode && targetNode.isFolder) summary.folderAdded += 1;
            else summary.bookmarkAdded += 1;
            return;
        }

        if (protectedIds.has(actualIdStr)) return;

        const currentIsFolder = !!(currentNode && currentNode.isFolder);
        const targetIsFolder = !!(targetNode && targetNode.isFolder);
        const countAsFolder = currentIsFolder && targetIsFolder;

        const targetParentActualId = resolveTargetId(targetNode.parentId);
        const currentParentId = currentNode.parentId != null ? String(currentNode.parentId) : null;
        const targetParentId = targetParentActualId != null ? String(targetParentActualId) : null;

        const currentIndex = Number.isFinite(Number(currentNode && currentNode.rawNode && currentNode.rawNode.index))
            ? Number(currentNode.rawNode.index)
            : null;
        const targetIndex = Number.isFinite(Number(targetNode && targetNode.rawNode && targetNode.rawNode.index))
            ? Number(targetNode.rawNode.index)
            : null;

        const isMoved = currentParentId !== targetParentId ||
            (currentIndex !== null && targetIndex !== null && currentIndex !== targetIndex);

        if (isMoved) {
            if (countAsFolder) summary.movedFolderCount += 1;
            else summary.movedBookmarkCount += 1;
        }

        const targetTitle = String(targetNode && targetNode.title || '');
        const currentTitle = String(currentNode && currentNode.title || '');
        const targetUrl = targetIsFolder ? '' : String(targetNode && targetNode.url || '');
        const currentUrl = currentIsFolder ? '' : String(currentNode && currentNode.url || '');
        const isModified = targetTitle !== currentTitle || (!targetIsFolder && !currentIsFolder && targetUrl !== currentUrl);

        if (isModified) {
            if (countAsFolder) summary.modifiedFolderCount += 1;
            else summary.modifiedBookmarkCount += 1;
        }
    });

    summary.movedCount = summary.movedBookmarkCount + summary.movedFolderCount;
    summary.modifiedCount = summary.modifiedBookmarkCount + summary.modifiedFolderCount;
    summary.bookmarkMoved = summary.movedBookmarkCount > 0;
    summary.folderMoved = summary.movedFolderCount > 0;
    summary.bookmarkModified = summary.modifiedBookmarkCount > 0;
    summary.folderModified = summary.modifiedFolderCount > 0;

    return summary;
}

function buildPatchTreeMeta(tree) {
    const rootNode = Array.isArray(tree) ? tree[0] : tree;
    const nodeById = new Map();
    const depthById = new Map();
    const childrenByParent = new Map();

    const walk = (node, parentId = null, depth = 0) => {
        if (!node || node.id == null) return;

        const nodeId = String(node.id);
        const nodeParentId = parentId != null
            ? String(parentId)
            : (node.parentId != null ? String(node.parentId) : null);
        const childNodes = Array.isArray(node.children) ? node.children : [];

        nodeById.set(nodeId, {
            id: nodeId,
            parentId: nodeParentId,
            title: String(node.title || ''),
            url: typeof node.url === 'string' ? node.url : '',
            isFolder: !node.url,
            rawNode: node
        });
        depthById.set(nodeId, depth);

        const childIds = [];
        for (const child of childNodes) {
            if (!child || child.id == null) continue;
            childIds.push(String(child.id));
        }
        childrenByParent.set(nodeId, childIds);

        for (const child of childNodes) {
            walk(child, nodeId, depth + 1);
        }
    };

    if (rootNode) {
        walk(rootNode, null, 0);
    }

    const rootId = rootNode && rootNode.id != null ? String(rootNode.id) : null;
    const rootChildIds = rootNode && Array.isArray(rootNode.children)
        ? rootNode.children.filter(child => child && child.id != null).map(child => String(child.id))
        : [];

    return {
        rootNode,
        rootId,
        rootChildIds,
        nodeById,
        depthById,
        childrenByParent
    };
}

function mapRevertRootIds(currentTree, snapshotTree) {
    const map = new Map();

    const currentRoot = Array.isArray(currentTree) ? currentTree[0] : currentTree;
    const targetRoot = Array.isArray(snapshotTree) ? snapshotTree[0] : snapshotTree;
    if (!currentRoot || !targetRoot) return map;

    if (currentRoot.id != null && targetRoot.id != null) {
        map.set(String(targetRoot.id), String(currentRoot.id));
    }

    const currentChildren = Array.isArray(currentRoot.children) ? currentRoot.children : [];
    const targetChildren = Array.isArray(targetRoot.children) ? targetRoot.children : [];

    const currentByKey = new Map();
    for (const node of currentChildren) {
        if (!node || node.id == null) continue;
        const key = normalizeRootKey(String(node.id), node.title);
        if (!currentByKey.has(key)) {
            currentByKey.set(key, String(node.id));
        }
    }

    for (const node of targetChildren) {
        if (!node || node.id == null) continue;
        const key = normalizeRootKey(String(node.id), node.title);
        const mapped = currentByKey.get(key);
        if (mapped) {
            map.set(String(node.id), String(mapped));
        }
    }

    return map;
}

function resolveRevertTargetId(targetId, idRemap) {
    if (targetId == null) return null;
    const key = String(targetId);
    if (idRemap && idRemap.has(key)) {
        return String(idRemap.get(key));
    }
    return key;
}

async function executePatchBookmarkRevert(snapshotTree, options = {}) {
    const { baselineTimestamp, preferredLang = 'zh_CN' } = options;
    assertBookmarkTreeContent(snapshotTree, preferredLang, 'revert');

    const initialCurrentTree = await browserAPI.bookmarks.getTree();
    const targetMeta = buildPatchTreeMeta(snapshotTree);
    let currentMeta = buildPatchTreeMeta(initialCurrentTree);

    const idRemap = mapRevertRootIds(initialCurrentTree, snapshotTree);
    const resolveTargetId = (targetId) => resolveRevertTargetId(targetId, idRemap);

    const protectedIds = new Set();
    if (currentMeta.rootId) protectedIds.add(String(currentMeta.rootId));
    for (const rootChildId of currentMeta.rootChildIds) {
        protectedIds.add(String(rootChildId));
    }

    let removed = 0;
    let created = 0;
    let moved = 0;
    let updated = 0;

    const refreshCurrentMeta = async () => {
        const currentTree = await browserAPI.bookmarks.getTree();
        currentMeta = buildPatchTreeMeta(currentTree);
        return currentTree;
    };

    // Phase 1: 严格按 ID 对比删除（ID 不存在于目标快照 => 删除）
    const targetResolvedIds = new Set();
    targetMeta.nodeById.forEach((_, targetId) => {
        const resolved = resolveTargetId(targetId);
        if (resolved) targetResolvedIds.add(resolved);
    });

    const deleteSet = new Set();
    currentMeta.nodeById.forEach((node, currentId) => {
        if (protectedIds.has(currentId)) return;
        if (!targetResolvedIds.has(currentId)) {
            deleteSet.add(currentId);
        }
    });

    const deleteRoots = Array.from(deleteSet).filter((nodeId) => {
        const parentId = currentMeta.nodeById.get(nodeId)?.parentId;
        return !parentId || !deleteSet.has(String(parentId));
    }).sort((a, b) => {
        const depthA = Number(currentMeta.depthById.get(a) || 0);
        const depthB = Number(currentMeta.depthById.get(b) || 0);
        return depthB - depthA;
    });

    for (const nodeId of deleteRoots) {
        const node = currentMeta.nodeById.get(nodeId);
        if (!node) continue;
        try {
            if (node.isFolder) {
                await browserAPI.bookmarks.removeTree(nodeId);
            } else {
                await browserAPI.bookmarks.remove(nodeId);
            }
            removed += 1;
        } catch (e) {
            throw new Error(preferredLang === 'en'
                ? `Patch revert delete failed: ${e.message || e}`
                : `补丁撤销删除失败: ${e.message || e}`);
        }
    }

    await refreshCurrentMeta();

    // Phase 2: 严格按 ID 对比补建（目标快照有但当前没有 => 新增）
    const knownCurrentIds = new Set(currentMeta.nodeById.keys());

    const ensureTargetNodeExists = async (targetNode, actualParentId) => {
        if (!targetNode || targetNode.id == null || !actualParentId) return;

        const targetNodeId = String(targetNode.id);
        const targetChildren = Array.isArray(targetNode.children) ? targetNode.children : [];
        const targetIsFolder = !targetNode.url;

        let actualNodeId = resolveTargetId(targetNodeId);

        if (!knownCurrentIds.has(actualNodeId)) {
            try {
                const createdNode = targetIsFolder
                    ? await browserAPI.bookmarks.create({
                        parentId: String(actualParentId),
                        title: String(targetNode.title || '')
                    })
                    : await browserAPI.bookmarks.create({
                        parentId: String(actualParentId),
                        title: String(targetNode.title || ''),
                        url: String(targetNode.url || '')
                    });
                actualNodeId = String(createdNode.id);
                idRemap.set(targetNodeId, actualNodeId);
                knownCurrentIds.add(actualNodeId);
                created += 1;
            } catch (e) {
                throw new Error(preferredLang === 'en'
                    ? `Patch revert create failed: ${e.message || e}`
                    : `补丁撤销创建失败: ${e.message || e}`);
            }
        }

        if (targetIsFolder && targetChildren.length > 0) {
            for (const child of targetChildren) {
                await ensureTargetNodeExists(child, actualNodeId);
            }
        }
    };

    const targetRootChildren = targetMeta.rootNode && Array.isArray(targetMeta.rootNode.children)
        ? targetMeta.rootNode.children
        : [];

    for (const targetRootChild of targetRootChildren) {
        if (!targetRootChild || targetRootChild.id == null) continue;
        const actualRootId = resolveTargetId(targetRootChild.id);
        if (!actualRootId || !knownCurrentIds.has(actualRootId)) continue;

        const rootChildItems = Array.isArray(targetRootChild.children) ? targetRootChild.children : [];
        for (const child of rootChildItems) {
            await ensureTargetNodeExists(child, actualRootId);
        }
    }

    await refreshCurrentMeta();

    // Phase 3: 对齐可复用节点（修改标题/URL + 跨级移动）
    const moveQueue = [];
    const updateQueue = [];

    targetMeta.nodeById.forEach((targetNode, targetId) => {
        const actualId = resolveTargetId(targetId);
        if (!actualId || !currentMeta.nodeById.has(actualId)) return;
        if (protectedIds.has(actualId)) return;

        const currentNode = currentMeta.nodeById.get(actualId);
        const targetIsBookmark = !!targetNode.url;
        const currentIsBookmark = !!currentNode.url;

        if (targetIsBookmark !== currentIsBookmark) {
            throw new Error(preferredLang === 'en'
                ? 'Patch revert encountered node type mismatch. Please use overwrite revert.'
                : '补丁撤销遇到节点类型不一致，请改用覆盖撤销。');
        }

        const targetParentActualId = resolveTargetId(targetNode.parentId);
        if (targetParentActualId && currentNode.parentId !== targetParentActualId) {
            moveQueue.push({
                id: actualId,
                parentId: targetParentActualId
            });
        }

        const targetTitle = String(targetNode.title || '');
        const currentTitle = String(currentNode.title || '');
        const targetUrl = targetIsBookmark ? String(targetNode.url || '') : '';
        const currentUrl = targetIsBookmark ? String(currentNode.url || '') : '';

        if (targetTitle !== currentTitle || (targetIsBookmark && targetUrl !== currentUrl)) {
            updateQueue.push({
                id: actualId,
                title: targetTitle,
                url: targetIsBookmark ? targetUrl : null,
                isBookmark: targetIsBookmark
            });
        }
    });

    for (const moveOp of moveQueue) {
        if (!currentMeta.nodeById.has(moveOp.id)) continue;
        if (!currentMeta.nodeById.has(String(moveOp.parentId))) continue;
        try {
            await browserAPI.bookmarks.move(moveOp.id, {
                parentId: String(moveOp.parentId)
            });
            moved += 1;
        } catch (e) {
            throw new Error(preferredLang === 'en'
                ? `Patch revert move failed: ${e.message || e}`
                : `补丁撤销移动失败: ${e.message || e}`);
        }
    }

    for (const updateOp of updateQueue) {
        if (!currentMeta.nodeById.has(updateOp.id)) continue;
        const updatePayload = { title: updateOp.title };
        if (updateOp.isBookmark) {
            updatePayload.url = String(updateOp.url || '');
        }
        try {
            await browserAPI.bookmarks.update(updateOp.id, updatePayload);
            updated += 1;
        } catch (e) {
            throw new Error(preferredLang === 'en'
                ? `Patch revert update failed: ${e.message || e}`
                : `补丁撤销修改失败: ${e.message || e}`);
        }
    }

    await refreshCurrentMeta();

    // Phase 4: 对齐同级顺序
    for (const [targetParentId, targetChildIds] of targetMeta.childrenByParent.entries()) {
        if (!targetParentId || !Array.isArray(targetChildIds) || targetChildIds.length <= 1) continue;

        const actualParentId = resolveTargetId(targetParentId);
        if (!actualParentId || !currentMeta.nodeById.has(actualParentId)) continue;
        if (currentMeta.rootId && String(actualParentId) === String(currentMeta.rootId)) continue;

        const desiredOrder = [];
        for (const targetChildId of targetChildIds) {
            const resolvedChildId = resolveTargetId(targetChildId);
            if (!resolvedChildId) continue;
            const childNode = currentMeta.nodeById.get(resolvedChildId);
            if (childNode && String(childNode.parentId || '') === String(actualParentId)) {
                desiredOrder.push(resolvedChildId);
            }
        }

        if (desiredOrder.length <= 1) continue;

        const currentOrder = Array.isArray(currentMeta.childrenByParent.get(String(actualParentId)))
            ? [...currentMeta.childrenByParent.get(String(actualParentId))]
            : [];

        for (let idx = 0; idx < desiredOrder.length; idx++) {
            const childId = desiredOrder[idx];
            const currentIdx = currentOrder.indexOf(childId);
            if (currentIdx === -1) continue;
            if (currentIdx === idx) continue;

            try {
                await browserAPI.bookmarks.move(childId, {
                    parentId: String(actualParentId),
                    index: idx
                });
                currentOrder.splice(currentIdx, 1);
                currentOrder.splice(idx, 0, childId);
                moved += 1;
            } catch (e) {
                throw new Error(preferredLang === 'en'
                    ? `Patch revert reorder failed: ${e.message || e}`
                    : `补丁撤销排序失败: ${e.message || e}`);
            }
        }
    }

    // 与覆盖恢复一致：更新 lastBookmarkData、重置状态并刷新分析缓存
    try {
        const revertedTree = await browserAPI.bookmarks.getTree();
        const currentBookmarkCount = countAllBookmarks(revertedTree);
        const currentFolderCount = countAllFolders(revertedTree);
        const currentPrints = generateFingerprints(revertedTree);
        const timestamp = (baselineTimestamp && String(baselineTimestamp).trim() !== '')
            ? baselineTimestamp
            : new Date().toISOString();

        await browserAPI.storage.local.set({
            lastBookmarkData: {
                bookmarkCount: currentBookmarkCount,
                folderCount: currentFolderCount,
                bookmarkPrints: currentPrints.bookmarks,
                folderPrints: currentPrints.folders,
                bookmarkTree: revertedTree,
                timestamp
            }
        });

        try {
            await browserAPI.storage.local.remove(['current-changes-cache:v1']);
        } catch (_) { }
    } catch (_) { }

    resetOperationStatus();
    try {
        await browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck');
    } catch (_) { }
    await updateAndCacheAnalysis();
    await setBadge();

    return { created, removed, moved, updated };
}

// 通用恢复：将当前书签恢复到指定快照树
async function restoreSnapshotTree(snapshotTree, options = {}) {
    const { baselineTimestamp, preferredLang = 'zh_CN' } = options;
    assertBookmarkTreeContent(snapshotTree, preferredLang, 'overwrite');

    // 获取当前整棵书签
    const currentTree = await new Promise((resolve) => {
        browserAPI.bookmarks.getTree((bookmarks) => resolve(bookmarks));
    });

    // 计算需要清空的根下内容（保留根节点）
    const currentRoots = currentTree && currentTree[0] && currentTree[0].children ? currentTree[0].children : [];

    // 构建快照根映射（按平台根ID或标题归一化）
    const snapshotRootChildren = (snapshotTree[0] && snapshotTree[0].children) ? snapshotTree[0].children : [];
    const snapshotRootMap = new Map();
    for (const sRoot of snapshotRootChildren) {
        snapshotRootMap.set(normalizeRootKey(sRoot.id, sRoot.title), sRoot);
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
        const key = normalizeRootKey(root.id, root.title);
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
        const timestamp = (baselineTimestamp && String(baselineTimestamp).trim() !== '')
            ? baselineTimestamp
            : new Date().toISOString();
        await browserAPI.storage.local.set({
            lastBookmarkData: {
                bookmarkCount: currentBookmarkCount,
                folderCount: currentFolderCount,
                bookmarkPrints: currentPrints.bookmarks,
                folderPrints: currentPrints.folders,
                bookmarkTree: restoredTree,
                timestamp: timestamp
            }
        });

        // 基准更新后，清理“当前变化”持久缓存（避免复用旧的变化列表）
        try {
            await browserAPI.storage.local.remove(['current-changes-cache:v1']);
        } catch (_) { }
    } catch (e) {
        // 不影响主流程
    }

    // 清理状态并更新角标与缓存
    resetOperationStatus();
    try { await browserAPI.storage.local.remove('hasBookmarkActivitySinceLastCheck'); } catch (_) { }
    await updateAndCacheAnalysis();
    await setBadge();
}

// 导入合并：将快照树导入到新文件夹，不覆盖当前书签
async function mergeSnapshotTree(snapshotTree, options = {}) {
    const { preferredLang = 'zh_CN' } = options;
    assertBookmarkTreeContent(snapshotTree, preferredLang, 'merge');

    const currentTree = await new Promise((resolve) => {
        browserAPI.bookmarks.getTree((bookmarks) => resolve(bookmarks));
    });
    const currentRoots = currentTree && currentTree[0] && currentTree[0].children ? currentTree[0].children : [];
    if (!currentRoots.length) {
        throw new Error(preferredLang === 'en' ? 'No bookmark roots found' : '未找到书签根目录');
    }

    const rootMap = new Map();
    currentRoots.forEach(root => {
        rootMap.set(normalizeRootKey(root.id, root.title), root);
    });
    const targetRoot = rootMap.get('menu') || rootMap.get('unfiled') || currentRoots[0];

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '_').slice(0, -4);
    const containerTitle = preferredLang === 'en'
        ? `Import Merge - ${timestamp}`
        : `导入合并-${timestamp}`;
    const containerFolder = await browserAPI.bookmarks.create({
        parentId: targetRoot.id,
        title: containerTitle
    });

    const snapshotRootChildren = (snapshotTree[0] && snapshotTree[0].children) ? snapshotTree[0].children : [];

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

    for (const root of snapshotRootChildren) {
        const rootTitle = root.title || (preferredLang === 'en' ? 'Root' : '根目录');
        const rootFolder = await browserAPI.bookmarks.create({
            parentId: containerFolder.id,
            title: rootTitle
        });
        if (root.children && root.children.length) {
            for (const child of root.children) {
                await createNodeRecursive(rootFolder.id, child);
            }
        }
    }

    // 合并恢复后更新缓存/角标，但不重置 lastBookmarkData
    try {
        await browserAPI.storage.local.remove(['current-changes-cache:v1']);
    } catch (_) { }
    try {
        await updateAndCacheAnalysis();
        await setBadge();
    } catch (_) { }
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
async function updateSyncStatus(direction, time, status = 'success', errorMessage = '', syncType = 'auto', autoBackupReason = null, snapshotFingerprint = '') {
    // <--- Log 11
    console.log('[updateSyncStatus] 参数:', { direction, time, status, errorMessage, syncType, autoBackupReason, snapshotFingerprint });

    try {
        const { syncHistory = [], lastBookmarkData = null, lastSyncOperations = {}, preferredLang = 'zh_CN', recentMovedIds = [], recentModifiedIds = [], recentAddedIds = [], overwriteMode = 'versioned' } = await browserAPI.storage.local.get([
            'syncHistory',
            'lastBookmarkData',
            'lastSyncOperations',
            'preferredLang',
            'recentMovedIds',
            'recentModifiedIds',
            'recentAddedIds',
            'overwriteMode'
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

            // 备份成功：基准已更新，清理“当前变化”持久缓存（备份后应显示无变化）
            try {
                await browserAPI.storage.local.remove(['current-changes-cache:v1']);
            } catch (_) { }

            resetOperationStatus();

            // 备份成功后，差异应该重置为 0（因为 lastBookmarkData 已经更新为当前值）
            bookmarkDiff = 0;
            folderDiff = 0;
        }

        // 只为成功的备份保存 bookmarkTree（用于生成历史详情）
        const shouldSaveTree = status === 'success';

        // 统一哈希规则：历史记录 fingerprint 与快照文件夹/文件名使用同一算法
        // 这样“恢复列表哈希值”与磁盘上的快照哈希始终一致（尤其是首次备份/清空后首次备份）
        const normalizedSnapshotFingerprint = normalizeSyncFingerprint(snapshotFingerprint);
        const fingerprint = normalizedSnapshotFingerprint || computeSyncFingerprintByTime(time);

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
            // bookmarkTree 不再存放在索引记录中
            hasData: shouldSaveTree,
            fingerprint: fingerprint
        };

        // 独立保存书签树数据
        if (shouldSaveTree && localBookmarks) {
            const treeKey = `backup_data_${time}`;
            await browserAPI.storage.local.set({ [treeKey]: localBookmarks });
        }

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

        // 备份成功后自动同步“当前变化”归档
        if (status === 'success') {
            try {
                // 异步执行，不阻塞主流程
                exportCurrentChangesArchiveToCloud({
                    syncTime: time,
                    fingerprint,
                    localBookmarks,
                    previousBookmarks: lastBookmarkData?.bookmarkTree || null,
                    explicitMovedIds: explicitMovedIdListForRecord,
                    overwriteMode: overwriteMode === 'overwrite' ? 'overwrite' : 'versioned'
                }).then(result => {
                    if (result.success && !result.skipped) {
                        console.log('[updateSyncStatus] 当前变化自动归档完成');
                    }
                }).catch(err => {
                    console.warn('[updateSyncStatus] 当前变化自动归档失败:', err);
                });
            } catch (e) {
                console.warn('[updateSyncStatus] 触发当前变化自动归档失败:', e);
            }
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

    // 活跃时间追踪已剔除
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

// =============================================================================
// Restore (Sync & Restore) - Backend
// =============================================================================

// [New] 获取远程文件列表 (WebDAV/GitHub)
// 说明：用于“恢复/同步”扫描；会返回 ZIP / HTML / 合并历史(JSON) 的候选文件。
async function listRemoteFiles(source) {
    try {
        const lang = await getCurrentLang();
        const settings = await browserAPI.storage.local.get([
            'serverAddress', 'username', 'password',
            'githubRepoToken', 'githubRepoOwner', 'githubRepoName', 'githubRepoBranch', 'githubRepoBasePath'
        ]);

        const files = [];

        const exportRootFolderCandidates = Array.from(new Set(getAllExportRootFolderCandidates().map(s => String(s || '').trim()).filter(Boolean)));
        const backupFolderCandidates = Array.from(new Set([
            getBackupFolderByLang('zh_CN'),
            getBackupFolderByLang('en'),
            // Compatibility candidates (user-renamed / legacy naming)
            'Bookmark_Backup',
            'bookmark_backup',
            'BookmarkBackup',
            'bookmarkbackup'
        ].map(s => String(s || '').trim()).filter(Boolean)));
        const historyRootFolderCandidates = Array.from(new Set([
            resolveExportSubFolderByKey('backup_history', 'zh_CN'),
            resolveExportSubFolderByKey('backup_history', 'en')
        ].map(s => String(s || '').trim()).filter(Boolean)));
        const historyAutoArchiveFolderCandidates = Array.from(new Set([
            getHistoryFolderByLang('zh_CN'),
            getHistoryFolderByLang('en')
        ].map(s => String(s || '').trim()).filter(Boolean)));
        const overwriteFolderCandidates = Array.from(new Set(getVersionFolderCandidates()));
        const snapshotFolderNameReg = /^\d{8}_\d{6}_[0-9a-f]{6,12}$/i;

        function isBackupHtmlName(name) {
            const n = String(name || '');
            const nLower = n.toLowerCase();

            if (/^\d{8}_\d{6}_[0-9a-f]{6,12}\.html$/i.test(nLower)) return true;
            if (/^(?:backup_)?\d{8}_\d{6}\.html$/.test(nLower)) return true;
            if (nLower === 'bookmark_backup.html') return true;

            // Compatibility: user-renamed but still clearly bookmark backup HTML
            if (nLower.endsWith('.html') && (nLower.includes('bookmark_backup') || nLower.includes('bookmark backup'))) {
                return true;
            }

            return false;
        }

        function splitPathSegments(pathText) {
            return String(pathText || '')
                .split('/')
                .map(part => String(part || '').trim())
                .filter(Boolean);
        }

        function isOverwriteFolderName(name) {
            const text = String(name || '').trim().toLowerCase();
            if (!text) return false;
            return overwriteFolderCandidates.some(candidate => String(candidate || '').trim().toLowerCase() === text);
        }

        function isInSnapshotOrOverwriteFolder(folderPath, snapshotFolder) {
            if (snapshotFolderNameReg.test(String(snapshotFolder || ''))) return true;
            if (isOverwriteFolderName(snapshotFolder)) return true;
            const parts = splitPathSegments(folderPath);
            return parts.some(part => snapshotFolderNameReg.test(part) || isOverwriteFolderName(part));
        }

        function shouldTreatAsCurrentChangesArtifact({ fileName, folderPath = '', snapshotFolder = '' }) {
            const name = String(fileName || '').trim();
            if (!name) return false;
            if (isBackupHtmlName(name)) return false;
            if (!/\.(json|html)$/i.test(name)) return false;

            // 主恢复检测：优先按目录（快照目录/覆盖目录）识别
            return isInSnapshotOrOverwriteFolder(folderPath, snapshotFolder);
        }

        async function webdavPropfind(folderUrl, authHeader, options = {}) {
            const response = await fetch(folderUrl, {
                method: 'PROPFIND',
                headers: {
                    'Authorization': authHeader,
                    'Depth': '1',
                    'Content-Type': 'application/xml'
                },
                body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><displayname/><getlastmodified/><getcontentlength/><resourcetype/></prop></propfind>'
            });

            if (response.status === 404) return [];
            if (!response.ok) {
                throw new Error(`WebDAV Error: ${response.status}`);
            }

            const onlyCollections = options?.onlyCollections === true;

            const text = await response.text();
            const entries = [];
            const responseReg = /<d:response>([\s\S]*?)<\/d:response>/g;
            let match;
            while ((match = responseReg.exec(text)) !== null) {
                const content = match[1];
                const isCollection = content.includes('<d:collection/>');
                if (onlyCollections && !isCollection) continue;
                if (!onlyCollections && isCollection) continue;
                const nameMatch = /<d:displayname>(.*?)<\/d:displayname>/.exec(content);
                const name = nameMatch ? nameMatch[1] : '';
                if (!name) continue;
                entries.push(name);
            }
            return entries;
        }

        // WebDAV
        if (source === 'webdav') {
            const serverAddress = (settings.serverAddress || '').replace(/\/+$/, '/');
            if (!serverAddress) return [];

            const authHeader = 'Basic ' + safeBase64(`${settings.username || ''}:${settings.password || ''}`);

            // 1) 合并历史：Backup_History/backup_history.json（兼容旧格式）
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const historyRootFolder of historyRootFolderCandidates) {
                    try {
                        const historyRootUrl = `${serverAddress}${exportRootFolder}/${historyRootFolder}/`;
                        const names = await webdavPropfind(historyRootUrl, authHeader);
                        for (const name of names) {
                            if (name === 'backup_history.json') {
                                files.push({ name, url: historyRootUrl + name, source: 'webdav', type: 'merged_history' });
                            } else if (name.endsWith('.zip')) {
                                // 兼容：部分版本把 ZIP 放在备份历史根目录
                                files.push({ name, url: historyRootUrl + name, source: 'webdav', type: 'zip' });
                            }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan history root failed:', e);
                    }
                }
            }

            // 2) ZIP：备份历史/自动备份归档
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const historyAutoArchiveFolder of historyAutoArchiveFolderCandidates) {
                    try {
                        const folderUrl = `${serverAddress}${exportRootFolder}/${historyAutoArchiveFolder}/`;
                        const names = await webdavPropfind(folderUrl, authHeader);
                        for (const name of names) {
                            if (name.endsWith('.zip')) {
                                files.push({ name, url: folderUrl + name, source: 'webdav', type: 'zip' });
                            }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan auto-archive failed:', e);
                    }
                }
            }

            // 3) 兼容旧结构：书签备份目录下直放 HTML
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const backupFolder of backupFolderCandidates) {
                    try {
                        const htmlFolderUrl = `${serverAddress}${exportRootFolder}/${backupFolder}/`;
                        const names = await webdavPropfind(htmlFolderUrl, authHeader);
                        for (const name of names) {
                            if (isBackupHtmlName(name)) {
                                files.push({ name, url: htmlFolderUrl + name, source: 'webdav', type: 'html_backup', folderPath: `${exportRootFolder}/${backupFolder}` });
                            }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan HTML folder failed:', e);
                    }
                }
            }

            // 3.1) 新结构：导出根目录下直放 HTML（无“书签备份”中间层）
            for (const exportRootFolder of exportRootFolderCandidates) {
                try {
                    const htmlFolderUrl = `${serverAddress}${exportRootFolder}/`;
                    const names = await webdavPropfind(htmlFolderUrl, authHeader);
                    for (const name of names) {
                        if (isBackupHtmlName(name)) {
                            files.push({ name, url: htmlFolderUrl + name, source: 'webdav', type: 'html_backup', folderPath: `${exportRootFolder}` });
                        }
                    }
                } catch (e) {
                    console.warn('[listRemoteFiles] Scan root HTML folder failed:', e);
                }
            }

            // 4) 新结构：书签备份/{时间+哈希}/
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const backupFolder of backupFolderCandidates) {
                    try {
                        const parentUrl = `${serverAddress}${exportRootFolder}/${backupFolder}/`;
                        const names = await webdavPropfind(parentUrl, authHeader, { onlyCollections: true });
                        for (const folderName of names) {
                            if (!snapshotFolderNameReg.test(folderName)) continue;
                            try {
                                const childUrl = `${parentUrl}${folderName}/`;
                                const childNames = await webdavPropfind(childUrl, authHeader);
                                for (const childName of childNames) {
                                    if (isBackupHtmlName(childName)) {
                                        files.push({
                                            name: childName,
                                            url: childUrl + childName,
                                            source: 'webdav',
                                            type: 'html_backup',
                                            snapshotFolder: folderName,
                                            folderPath: `${exportRootFolder}/${backupFolder}/${folderName}`
                                        });
                                    } else if (shouldTreatAsCurrentChangesArtifact({
                                        fileName: childName,
                                        folderPath: `${exportRootFolder}/${backupFolder}/${folderName}`,
                                        snapshotFolder: folderName
                                    })) {
                                        files.push({
                                            name: childName,
                                            url: childUrl + childName,
                                            source: 'webdav',
                                            type: 'changes_artifact',
                                            snapshotFolder: folderName,
                                            folderPath: `${exportRootFolder}/${backupFolder}/${folderName}`
                                        });
                                    }
                                }
                            } catch (_) { }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan snapshot folders failed:', e);
                    }
                }
            }

            // 5) 覆盖模式：书签备份/覆盖/
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const backupFolder of backupFolderCandidates) {
                    for (const overwriteFolder of overwriteFolderCandidates) {
                        try {
                            const folderUrl = `${serverAddress}${exportRootFolder}/${backupFolder}/${overwriteFolder}/`;
                            const names = await webdavPropfind(folderUrl, authHeader);
                            for (const name of names) {
                                if (isBackupHtmlName(name)) {
                                    files.push({
                                        name,
                                        url: folderUrl + name,
                                        source: 'webdav',
                                        type: 'html_backup',
                                        snapshotFolder: overwriteFolder,
                                        folderPath: `${exportRootFolder}/${backupFolder}/${overwriteFolder}`
                                    });
                                } else if (shouldTreatAsCurrentChangesArtifact({
                                    fileName: name,
                                    folderPath: `${exportRootFolder}/${backupFolder}/${overwriteFolder}`,
                                    snapshotFolder: overwriteFolder
                                })) {
                                    files.push({
                                        name,
                                        url: folderUrl + name,
                                        source: 'webdav',
                                        type: 'changes_artifact',
                                        snapshotFolder: overwriteFolder,
                                        folderPath: `${exportRootFolder}/${backupFolder}/${overwriteFolder}`
                                    });
                                }
                            }
                        } catch (_) { }
                    }
                }
            }

            // 5.1) 覆盖模式（新结构）：导出根目录/覆盖
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const overwriteFolder of overwriteFolderCandidates) {
                    try {
                        const folderUrl = `${serverAddress}${exportRootFolder}/${overwriteFolder}/`;
                        const names = await webdavPropfind(folderUrl, authHeader);
                        for (const name of names) {
                            if (isBackupHtmlName(name)) {
                                files.push({
                                    name,
                                    url: folderUrl + name,
                                    source: 'webdav',
                                    type: 'html_backup',
                                    snapshotFolder: overwriteFolder,
                                    folderPath: `${exportRootFolder}/${overwriteFolder}`
                                });
                            } else if (shouldTreatAsCurrentChangesArtifact({
                                fileName: name,
                                folderPath: `${exportRootFolder}/${overwriteFolder}`,
                                snapshotFolder: overwriteFolder
                            })) {
                                files.push({
                                    name,
                                    url: folderUrl + name,
                                    source: 'webdav',
                                    type: 'changes_artifact',
                                    snapshotFolder: overwriteFolder,
                                    folderPath: `${exportRootFolder}/${overwriteFolder}`
                                });
                            }
                        }
                    } catch (_) { }
                }
            }

            // 4.1) 新结构：导出根目录/{时间+哈希}/
            for (const exportRootFolder of exportRootFolderCandidates) {
                try {
                    const parentUrl = `${serverAddress}${exportRootFolder}/`;
                    const names = await webdavPropfind(parentUrl, authHeader, { onlyCollections: true });
                    for (const folderName of names) {
                        if (!snapshotFolderNameReg.test(folderName)) continue;
                        try {
                            const childUrl = `${parentUrl}${folderName}/`;
                            const childNames = await webdavPropfind(childUrl, authHeader);
                            for (const childName of childNames) {
                                if (isBackupHtmlName(childName)) {
                                    files.push({
                                        name: childName,
                                        url: childUrl + childName,
                                        source: 'webdav',
                                        type: 'html_backup',
                                        snapshotFolder: folderName,
                                        folderPath: `${exportRootFolder}/${folderName}`
                                    });
                                } else if (shouldTreatAsCurrentChangesArtifact({
                                    fileName: childName,
                                    folderPath: `${exportRootFolder}/${folderName}`,
                                    snapshotFolder: folderName
                                })) {
                                    files.push({
                                        name: childName,
                                        url: childUrl + childName,
                                        source: 'webdav',
                                        type: 'changes_artifact',
                                        snapshotFolder: folderName,
                                        folderPath: `${exportRootFolder}/${folderName}`
                                    });
                                }
                            }
                        } catch (_) { }
                    }
                } catch (e) {
                    console.warn('[listRemoteFiles] Scan root snapshot folders failed:', e);
                }
            }
            // 去重（同一个文件可能在不同语言路径被重复扫描到）
            return Array.from(new Map(files.map(f => [`${f.source}|${f.type}|${f.url}`, f])).values());
        }

        // GitHub
        if (source === 'github') {
            const token = settings.githubRepoToken;
            const owner = settings.githubRepoOwner;
            const repo = settings.githubRepoName;
            const branch = settings.githubRepoBranch;
            const basePath = (settings.githubRepoBasePath || '').replace(/^\/+/, '').replace(/\/+$/, '');
            const prefix = basePath ? `${basePath}/` : '';

            if (!token || !owner || !repo || !branch) return [];

            function encodeGitHubPath(path) {
                return String(path || '')
                    .split('/')
                    .filter(Boolean)
                    .map((segment) => encodeURIComponent(segment))
                    .join('/');
            }

            async function listGitHubDir(dirPath) {
                const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGitHubPath(dirPath)}?ref=${encodeURIComponent(branch)}`;
                const response = await fetch(apiUrl, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (response.status === 404) return [];
                if (!response.ok) throw new Error(`GitHub Error: ${response.status}`);
                const data = await response.json();
                return Array.isArray(data) ? data : [];
            }

            // 1) 合并历史：Backup_History/backup_history.json（兼容旧格式）
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const historyRootFolder of historyRootFolderCandidates) {
                    try {
                        const historyRootPath = `${prefix}${exportRootFolder}/${historyRootFolder}`;
                        const items = await listGitHubDir(historyRootPath);
                        for (const item of items) {
                            if (item.type !== 'file') continue;
                            if (item.name === 'backup_history.json') {
                                files.push({ name: item.name, url: item.download_url || item.url, source: 'github', type: 'merged_history' });
                            } else if (item.name.endsWith('.zip')) {
                                files.push({ name: item.name, url: item.download_url || item.url, source: 'github', type: 'zip' });
                            }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan history root GitHub failed:', e);
                    }
                }
            }

            // 2) ZIP：备份历史/自动备份归档
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const historyAutoArchiveFolder of historyAutoArchiveFolderCandidates) {
                    try {
                        const autoArchivePath = `${prefix}${exportRootFolder}/${historyAutoArchiveFolder}`;
                        const items = await listGitHubDir(autoArchivePath);
                        for (const item of items) {
                            if (item.type === 'file' && item.name.endsWith('.zip')) {
                                files.push({ name: item.name, url: item.download_url || item.url, source: 'github', type: 'zip' });
                            }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan auto-archive GitHub failed:', e);
                    }
                }
            }

            // 3) 兼容旧结构：书签备份目录下直放 HTML
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const backupFolder of backupFolderCandidates) {
                    try {
                        const backupPath = `${prefix}${exportRootFolder}/${backupFolder}`;
                        const items = await listGitHubDir(backupPath);
                        for (const item of items) {
                            if (item.type === 'file' && isBackupHtmlName(item.name)) {
                                files.push({ name: item.name, url: item.download_url || item.url, source: 'github', type: 'html_backup', folderPath: `${exportRootFolder}/${backupFolder}` });
                            }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan HTML GitHub failed:', e);
                    }
                }
            }

            // 3.1) 新结构：导出根目录下直放 HTML（无“书签备份”中间层）
            for (const exportRootFolder of exportRootFolderCandidates) {
                try {
                    const backupPath = `${prefix}${exportRootFolder}`;
                    const items = await listGitHubDir(backupPath);
                    for (const item of items) {
                        if (item.type === 'file' && isBackupHtmlName(item.name)) {
                            files.push({ name: item.name, url: item.download_url || item.url, source: 'github', type: 'html_backup', folderPath: `${exportRootFolder}` });
                        }
                    }
                } catch (e) {
                    console.warn('[listRemoteFiles] Scan root HTML GitHub failed:', e);
                }
            }

            // 4) 新结构：书签备份/{时间+哈希}/
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const backupFolder of backupFolderCandidates) {
                    try {
                        const parentPath = `${prefix}${exportRootFolder}/${backupFolder}`;
                        const parentItems = await listGitHubDir(parentPath);
                        for (const folder of parentItems) {
                            if (folder.type !== 'dir') continue;
                            if (!snapshotFolderNameReg.test(folder.name || '')) continue;
                            try {
                                const folderPath = `${parentPath}/${folder.name}`;
                                const leafItems = await listGitHubDir(folderPath);
                                for (const leaf of leafItems) {
                                    if (leaf.type !== 'file') continue;
                                    if (isBackupHtmlName(leaf.name)) {
                                        files.push({
                                            name: leaf.name,
                                            url: leaf.download_url || leaf.url,
                                            source: 'github',
                                            type: 'html_backup',
                                            snapshotFolder: folder.name,
                                            folderPath
                                        });
                                    } else if (shouldTreatAsCurrentChangesArtifact({
                                        fileName: leaf.name,
                                        folderPath,
                                        snapshotFolder: folder.name
                                    })) {
                                        files.push({
                                            name: leaf.name,
                                            url: leaf.download_url || leaf.url,
                                            source: 'github',
                                            type: 'changes_artifact',
                                            snapshotFolder: folder.name,
                                            folderPath
                                        });
                                    }
                                }
                            } catch (_) { }
                        }
                    } catch (e) {
                        console.warn('[listRemoteFiles] Scan snapshot folders GitHub failed:', e);
                    }
                }
            }

            // 5) 覆盖模式：书签备份/覆盖/
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const backupFolder of backupFolderCandidates) {
                    for (const overwriteFolder of overwriteFolderCandidates) {
                        try {
                            const folderPath = `${prefix}${exportRootFolder}/${backupFolder}/${overwriteFolder}`;
                            const items = await listGitHubDir(folderPath);
                            for (const item of items) {
                                if (item.type !== 'file') continue;
                                if (isBackupHtmlName(item.name)) {
                                    files.push({
                                        name: item.name,
                                        url: item.download_url || item.url,
                                        source: 'github',
                                        type: 'html_backup',
                                        snapshotFolder: overwriteFolder,
                                        folderPath
                                    });
                                } else if (shouldTreatAsCurrentChangesArtifact({
                                    fileName: item.name,
                                    folderPath,
                                    snapshotFolder: overwriteFolder
                                })) {
                                    files.push({
                                        name: item.name,
                                        url: item.download_url || item.url,
                                        source: 'github',
                                        type: 'changes_artifact',
                                        snapshotFolder: overwriteFolder,
                                        folderPath
                                    });
                                }
                            }
                        } catch (_) { }
                    }
                }
            }

            // 5.1) 覆盖模式（新结构）：导出根目录/覆盖
            for (const exportRootFolder of exportRootFolderCandidates) {
                for (const overwriteFolder of overwriteFolderCandidates) {
                    try {
                        const folderPath = `${prefix}${exportRootFolder}/${overwriteFolder}`;
                        const items = await listGitHubDir(folderPath);
                        for (const item of items) {
                            if (item.type !== 'file') continue;
                            if (isBackupHtmlName(item.name)) {
                                files.push({
                                    name: item.name,
                                    url: item.download_url || item.url,
                                    source: 'github',
                                    type: 'html_backup',
                                    snapshotFolder: overwriteFolder,
                                    folderPath
                                });
                            } else if (shouldTreatAsCurrentChangesArtifact({
                                fileName: item.name,
                                folderPath,
                                snapshotFolder: overwriteFolder
                            })) {
                                files.push({
                                    name: item.name,
                                    url: item.download_url || item.url,
                                    source: 'github',
                                    type: 'changes_artifact',
                                    snapshotFolder: overwriteFolder,
                                    folderPath
                                });
                            }
                        }
                    } catch (_) { }
                }
            }

            // 4.1) 新结构：导出根目录/{时间+哈希}/
            for (const exportRootFolder of exportRootFolderCandidates) {
                try {
                    const parentPath = `${prefix}${exportRootFolder}`;
                    const parentItems = await listGitHubDir(parentPath);
                    for (const folder of parentItems) {
                        if (folder.type !== 'dir') continue;
                        if (!snapshotFolderNameReg.test(folder.name || '')) continue;
                        try {
                            const folderPath = `${parentPath}/${folder.name}`;
                            const leafItems = await listGitHubDir(folderPath);
                            for (const leaf of leafItems) {
                                if (leaf.type !== 'file') continue;
                                if (isBackupHtmlName(leaf.name)) {
                                    files.push({
                                        name: leaf.name,
                                        url: leaf.download_url || leaf.url,
                                        source: 'github',
                                        type: 'html_backup',
                                        snapshotFolder: folder.name,
                                        folderPath
                                    });
                                } else if (shouldTreatAsCurrentChangesArtifact({
                                    fileName: leaf.name,
                                    folderPath,
                                    snapshotFolder: folder.name
                                })) {
                                    files.push({
                                        name: leaf.name,
                                        url: leaf.download_url || leaf.url,
                                        source: 'github',
                                        type: 'changes_artifact',
                                        snapshotFolder: folder.name,
                                        folderPath
                                    });
                                }
                            }
                        } catch (_) { }
                    }
                } catch (e) {
                    console.warn('[listRemoteFiles] Scan root snapshot folders GitHub failed:', e);
                }
            }

            return Array.from(new Map(files.map(f => [`${f.source}|${f.type}|${f.url}`, f])).values());
        }

        return [];
    } catch (e) {
        console.error('[listRemoteFiles] Failed:', e);
        return [];
    }
}

// [New] 下载远程文件
async function downloadRemoteFile({ url, source }) {
    if (source === 'local') {
        const res = await fetch(url);
        return await res.blob();
    }
    try {
        const headers = {};
        if (source === 'webdav') {
            const settings = await browserAPI.storage.local.get(['username', 'password']);
            headers['Authorization'] = 'Basic ' + safeBase64(`${settings.username}:${settings.password}`);
        } else if (source === 'github') {
            const settings = await browserAPI.storage.local.get(['githubRepoToken']);
            headers['Authorization'] = `token ${settings.githubRepoToken}`;
            headers['Accept'] = 'application/vnd.github.v3.raw';
        }

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`Download Failed: ${response.status}`);
        return await response.blob();
    } catch (e) {
        console.error('[downloadRemoteFile] Failed:', e);
        throw e;
    }
}

// ============= ZIP 归档辅助函数 (Store 模式) =============
const __crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function __crc32(bytes) {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ __crc32Table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

function __toUint8(text) {
    return new TextEncoder().encode(String(text || ''));
}

function __zipStore(files) {
    const parts = [];
    const central = [];
    let offset = 0;

    const writeU16 = (v) => {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setUint16(0, v, true);
        return b;
    };
    const writeU32 = (v) => {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, v >>> 0, true);
        return b;
    };

    const dosTime = 0;
    const dosDate = 0;
    const gpFlag = 0x0800; // UTF-8
    const method = 0; // store

    files.forEach((f) => {
        const name = String(f.name || '').replace(/^\/+/, '');
        const nameBytes = __toUint8(name);
        const data = f.data instanceof Uint8Array ? f.data : new Uint8Array();
        const crc = __crc32(data);

        const localHeader = [
            writeU32(0x04034b50),
            writeU16(20),
            writeU16(gpFlag),
            writeU16(method),
            writeU16(dosTime),
            writeU16(dosDate),
            writeU32(crc),
            writeU32(data.length),
            writeU32(data.length),
            writeU16(nameBytes.length),
            writeU16(0)
        ];
        parts.push(...localHeader, nameBytes, data);

        const centralHeader = [
            writeU32(0x02014b50),
            writeU16(0x031E),
            writeU16(20),
            writeU16(gpFlag),
            writeU16(method),
            writeU16(dosTime),
            writeU16(dosDate),
            writeU32(crc),
            writeU32(data.length),
            writeU32(data.length),
            writeU16(nameBytes.length),
            writeU16(0),
            writeU16(0),
            writeU16(0),
            writeU16(0),
            writeU32(0),
            writeU32(offset)
        ];
        central.push(...centralHeader, nameBytes);

        const localSize = localHeader.reduce((sum, b) => sum + b.length, 0) + nameBytes.length + data.length;
        offset += localSize;
    });

    const centralSize = central.reduce((sum, b) => sum + b.length, 0);
    const end = [
        writeU32(0x06054b50),
        writeU16(0),
        writeU16(0),
        writeU16(files.length),
        writeU16(files.length),
        writeU32(centralSize),
        writeU32(offset),
        writeU16(0)
    ];

    return new Blob([...parts, ...central, ...end], { type: 'application/zip' });
}

async function unzipStore(zipBlob) {
    const buffer = await zipBlob.arrayBuffer();
    const data = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);
    let offset = 0;
    const files = [];
    const textDecoder = new TextDecoder('utf-8');

    while (offset < buffer.byteLength) {
        if (data.getUint32(offset, true) !== 0x04034b50) {
            break;
        }

        const compressionMethod = data.getUint16(offset + 8, true);
        if (compressionMethod !== 0) {
            console.warn('[unzipStore] 发现非 Store 模式压缩的文件，跳过 (仅支持 Store 模式)');
            break;
        }

        const compressedSize = data.getUint32(offset + 18, true);
        const fileNameLength = data.getUint16(offset + 26, true);
        const extraFieldLength = data.getUint16(offset + 28, true);

        const fileNameStart = offset + 30;
        const fileNameBytes = uint8.subarray(fileNameStart, fileNameStart + fileNameLength);
        const fileName = textDecoder.decode(fileNameBytes);

        const dataStart = fileNameStart + fileNameLength + extraFieldLength;
        const fileDataBytes = uint8.subarray(dataStart, dataStart + compressedSize);
        const fileContent = textDecoder.decode(fileDataBytes);

        files.push({
            name: fileName,
            content: fileContent
        });

        offset = dataStart + compressedSize;
    }

    return files;
}
// ============= ZIP 归档辅助函数结束 =============

function safeNumber(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTimeToMs(input) {
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'string') return null;
    const ms = Date.parse(input);
    return Number.isFinite(ms) ? ms : null;
}

function formatDateTime(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildRestoreStats(bookmarkStats) {
    const stats = bookmarkStats || {};
    return {
        bookmarkAdded: safeNumber(stats.bookmarkAdded),
        bookmarkDeleted: safeNumber(stats.bookmarkDeleted),
        folderAdded: safeNumber(stats.folderAdded),
        folderDeleted: safeNumber(stats.folderDeleted),
        movedCount: safeNumber(stats.movedCount),
        modifiedCount: safeNumber(stats.modifiedCount),
        bookmarkCount: (typeof stats.bookmarkCount === 'number' ? stats.bookmarkCount : (typeof stats.bookmarks === 'number' ? stats.bookmarks : null)),
        folderCount: (typeof stats.folderCount === 'number' ? stats.folderCount : (typeof stats.folders === 'number' ? stats.folders : null))
    };
}

function parseSnapshotKeyFromText(input) {
    const text = String(input || '');
    const match = /(\d{8}_\d{6}_[0-9a-f]{6,12})/i.exec(text);
    return match ? String(match[1]).toLowerCase() : '';
}

function parseSnapshotTimeMsFromKey(snapshotKey) {
    const key = String(snapshotKey || '').trim();
    if (!key) return null;
    const match = /^(\d{8})_(\d{6})_[0-9a-f]{6,12}$/i.exec(key);
    if (!match) return null;

    const ds = match[1];
    const ts = match[2];
    const iso = `${ds.substring(0, 4)}-${ds.substring(4, 6)}-${ds.substring(6, 8)}T${ts.substring(0, 2)}:${ts.substring(2, 4)}:${ts.substring(4, 6)}`;
    return parseTimeToMs(iso);
}

function isCurrentChangesArtifactFileName(name) {
    const text = String(name || '');
    const lower = text.toLowerCase();
    if (!/\.(json|html)$/i.test(lower)) return false;
    if (lower.includes('current_changes') || lower.includes('current-changes')) return true;
    if (lower.includes('bookmark-changes') || lower.includes('bookmark_changes')) return true;
    if (lower.startsWith('bookmark-changes-')) return true;
    return text.includes('当前变化') || text.includes('书签变化');
}

function parseCurrentChangesArtifactModeFromName(name) {
    const text = String(name || '');
    const lower = text.toLowerCase();
    if (text.includes('集合') || lower.includes('collection')) return 'collection';
    if (text.includes('详细') || lower.includes('detailed')) return 'detailed';
    if (text.includes('简略') || lower.includes('simple')) return 'simple';
    return '';
}

function parseCurrentChangesArtifactJsonFromHtml(htmlText) {
    const text = String(htmlText || '');
    if (!text) return null;

    try {
        const scriptMatch = /<script[^>]*id=["']bookmarkCurrentChangesData["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
        if (scriptMatch && scriptMatch[1]) {
            return safeParseJson(scriptMatch[1]);
        }
    } catch (_) { }

    try {
        const preMatch = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(text);
        if (preMatch && preMatch[1]) {
            const decoded = String(preMatch[1])
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&');
            return safeParseJson(decoded);
        }
    } catch (_) { }

    return null;
}

function parseCurrentChangesStatsFromCountsLine(lineText) {
    const text = String(lineText || '').trim();
    if (!text) return null;

    const segments = text.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);

    const findSegment = (zhLabel, enLabel) => {
        const enPrefix = String(enLabel || '').toLowerCase() + ':';
        for (const seg of segments) {
            const s = String(seg || '');
            const lower = s.toLowerCase();
            if (s.startsWith(`${zhLabel}:`) || lower.startsWith(enPrefix)) {
                const idx = s.indexOf(':');
                return idx >= 0 ? s.slice(idx + 1).trim() : '';
            }
        }
        return '';
    };

    const parsePair = (segment) => {
        const s = String(segment || '');
        const b = /(\d+)\s*(?:书签|bkm)\b/i.exec(s);
        const f = /(\d+)\s*(?:文件夹|fld)\b/i.exec(s);
        return {
            bookmarks: b ? Number(b[1]) : 0,
            folders: f ? Number(f[1]) : 0
        };
    };

    const parseSingle = (zhLabel, enLabel) => {
        const seg = findSegment(zhLabel, enLabel);
        if (!seg) return 0;
        const m = /(\d+)/.exec(seg);
        return m ? Number(m[1]) : 0;
    };

    const added = parsePair(findSegment('新增', 'Added'));
    const deleted = parsePair(findSegment('删除', 'Deleted'));
    const movedCount = parseSingle('移动', 'Moved');
    const modifiedCount = parseSingle('修改', 'Modified');

    return buildRestoreStats({
        bookmarkAdded: added.bookmarks,
        folderAdded: added.folders,
        bookmarkDeleted: deleted.bookmarks,
        folderDeleted: deleted.folders,
        movedCount,
        modifiedCount
    });
}

function extractCurrentChangesStatsFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;

    const queue = Array.isArray(payload?.children) ? [...payload.children] : [];
    while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;

        const title = String(node.title || '');
        const countsMatch = /(Operation\s+Counts|操作统计)\s*:\s*([^\n<]+)/i.exec(title);
        if (countsMatch && countsMatch[2]) {
            const parsed = parseCurrentChangesStatsFromCountsLine(countsMatch[2]);
            if (parsed) return parsed;
        }

        if (Array.isArray(node.children) && node.children.length) {
            queue.push(...node.children);
        }
    }

    return null;
}

function parseCurrentChangesArtifactStatsFromText(text, options = {}) {
    const isHtml = options?.isHtml === true;
    let payload = null;

    if (isHtml) {
        payload = parseCurrentChangesArtifactJsonFromHtml(text);
    } else {
        try {
            payload = safeParseJson(text);
        } catch (_) {
            payload = null;
        }
    }

    if (payload && typeof payload === 'object') {
        const fromPayload = extractCurrentChangesStatsFromPayload(payload);
        if (fromPayload) return fromPayload;
    }

    return null;
}

function getRestoreStatsMagnitude(stats) {
    if (!stats) return 0;
    return Number(stats.bookmarkAdded || 0)
        + Number(stats.bookmarkDeleted || 0)
        + Number(stats.folderAdded || 0)
        + Number(stats.folderDeleted || 0)
        + Number(stats.movedCount || 0)
        + Number(stats.modifiedCount || 0);
}

function buildCurrentChangesArtifactMatchKey(fileLike) {
    if (!fileLike) return '';

    const keyByFolder = parseSnapshotKeyFromText(fileLike.snapshotFolder || '');
    if (keyByFolder) return keyByFolder;

    const keyByFolderPath = parseSnapshotKeyFromText(fileLike.folderPath || '');
    if (keyByFolderPath) return keyByFolderPath;

    const keyByName = parseSnapshotKeyFromText(fileLike.name || '');
    if (keyByName) return keyByName;

    if (isOverwriteFolderPathLike(fileLike.snapshotFolder || '') || isOverwriteFolderPathLike(fileLike.folderPath || '')) {
        return '__overwrite__';
    }

    return '';
}

function normalizeRestoreVersionMeta(meta) {
    return {
        id: meta.id,
        time: meta.time,
        displayTime: meta.displayTime,
        seqNumber: meta.seqNumber,
        note: meta.note,
        fingerprint: meta.fingerprint,
        stats: meta.stats,
        source: meta.source,
        sourceType: meta.sourceType,
        originalFile: meta.originalFile,
        restoreRef: meta.restoreRef,
        canRestore: meta.canRestore !== false
    };
}

function buildRestoreVersionFromExportData(exportData, { source, originalFile, fileUrl, localFileKey, zipEntryName, recordIndex }) {
    const exportInfo = exportData?._exportInfo || exportData?.exportInfo || exportData?.export_info || {};
    const timeStr = exportInfo.backupTime || exportData?.time || null;
    const timeMs = parseTimeToMs(timeStr) ?? null;
    const seqNumber = exportInfo.seqNumber || exportData?.seqNumber || null;
    const note = exportInfo.note || exportData?.note || '';
    const fingerprint = exportInfo.fingerprint || exportData?.fingerprint || '';
    const stats = buildRestoreStats(exportInfo.stats || exportData?.bookmarkStats || exportData?.stats || null);

    const idBase = `${source}:${originalFile}:${zipEntryName || ''}:${timeMs || timeStr || recordIndex || ''}:${fingerprint || ''}`;

    const restoreRef = {
        source,
        sourceType: zipEntryName ? 'zip' : 'json',
        originalFile,
        fileUrl: fileUrl || null,
        localFileKey: localFileKey || null,
        zipEntryName: zipEntryName || null,
        recordIndex: typeof recordIndex === 'number' ? recordIndex : null,
        recordTime: timeStr || null,
        fingerprint: fingerprint || null
    };

    return normalizeRestoreVersionMeta({
        id: idBase,
        time: timeMs,
        displayTime: timeMs ? formatDateTime(timeMs) : (timeStr || ''),
        seqNumber,
        note,
        fingerprint,
        stats,
        source,
        sourceType: zipEntryName ? 'zip' : 'json',
        originalFile,
        restoreRef,
        canRestore: true
    });
}

function buildRestoreVersionFromHtmlFile({ source, originalFile, fileUrl, localFileKey, fileName, lastModifiedMs, snapshotFolder = '', folderPath = '' }) {
    const name = fileName || originalFile;

    const snapshotKeyFromName = parseSnapshotKeyFromText(name);
    const snapshotKeyFromFolder = parseSnapshotKeyFromText(snapshotFolder);
    const snapshotKeyFromFolderPath = parseSnapshotKeyFromText(folderPath);
    let snapshotKey = snapshotKeyFromName || snapshotKeyFromFolder || snapshotKeyFromFolderPath || '';
    if (!snapshotKey && (isOverwriteFolderPathLike(snapshotFolder) || isOverwriteFolderPathLike(folderPath))) {
        snapshotKey = '__overwrite__';
    }

    let timeMs = parseSnapshotTimeMsFromKey(snapshotKey);
    if (!timeMs) {
        const nameMatch = /(?:backup_)?(\d{8})_(\d{6})/i.exec(name || '');
        if (nameMatch) {
            const ds = nameMatch[1];
            const ts = nameMatch[2];
            const iso = `${ds.substring(0, 4)}-${ds.substring(4, 6)}-${ds.substring(6, 8)}T${ts.substring(0, 2)}:${ts.substring(2, 4)}:${ts.substring(4, 6)}`;
            timeMs = parseTimeToMs(iso);
        }
    }
    if (!timeMs && typeof lastModifiedMs === 'number') {
        timeMs = lastModifiedMs;
    }

    const fingerprint = snapshotKey
        ? snapshotKey.split('_').pop() || ''
        : '';

    const restoreRef = {
        source,
        sourceType: 'html',
        originalFile,
        fileUrl: fileUrl || null,
        localFileKey: localFileKey || null,
        recordIndex: null,
        recordTime: null,
        fingerprint: fingerprint || null,
        snapshotKey: snapshotKey || null,
        snapshotFolder: snapshotFolder || null,
        folderPath: folderPath || null
    };

    return normalizeRestoreVersionMeta({
        id: `${source}:${originalFile}:${snapshotKey || timeMs || ''}`,
        time: timeMs,
        displayTime: timeMs ? formatDateTime(timeMs) : name,
        seqNumber: null,
        note: 'HTML Snapshot',
        fingerprint,
        stats: {
            bookmarkAdded: 0,
            bookmarkDeleted: 0,
            folderAdded: 0,
            folderDeleted: 0,
            movedCount: 0,
            modifiedCount: 0,
            bookmarkCount: null,
            folderCount: null
        },
        source,
        sourceType: 'html',
        originalFile,
        restoreRef,
        canRestore: true
    });
}

function parseRestoreVersionsFromMergedHistoryJsonText(text, { source, originalFile, fileUrl, localFileKey }) {
    let parsed;
    try {
        parsed = safeParseJson(text);
    } catch (e) {
        console.warn('[parseRestoreVersionsFromMergedHistoryJsonText] JSON parse failed:', e);
        return [];
    }

    const records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.records) ? parsed.records : null);
    if (!Array.isArray(records)) return [];

    // Seed restore cache to avoid re-downloading/re-parsing during diff/preview.
    try {
        const cacheKey = getRestoreSourceCacheKey({
            source,
            sourceType: 'json',
            originalFile,
            fileUrl: fileUrl || null,
            localFileKey: localFileKey || null
        });
        restoreCacheSet(restoreSourceCache.mergedJson, cacheKey, { records });
    } catch (_) { }

    const versions = [];
    for (let i = 0; i < records.length; i++) {
        const item = records[i];
        if (!item) continue;
        const itemExportInfo = item._exportInfo || item.exportInfo || item.export_info || null;
        if (itemExportInfo && (item._rawBookmarkTree || item.bookmarkTree)) {
            versions.push(buildRestoreVersionFromExportData(item, { source, originalFile, fileUrl, localFileKey, zipEntryName: null, recordIndex: i }));
            continue;
        }

        // 兼容：直接存储的 history record（time/note/fingerprint/bookmarkTree/bookmarkStats）
        const pseudoExport = {
            time: item.time,
            note: item.note,
            fingerprint: item.fingerprint,
            seqNumber: item.seqNumber,
            bookmarkStats: item.bookmarkStats || item.stats || null,
            _rawBookmarkTree: item.bookmarkTree || item._rawBookmarkTree || null,
            _exportInfo: {
                backupTime: item.time,
                note: item.note,
                seqNumber: item.seqNumber,
                fingerprint: item.fingerprint,
                stats: item.bookmarkStats || item.stats || null
            }
        };

        if (pseudoExport._rawBookmarkTree) {
            versions.push(buildRestoreVersionFromExportData(pseudoExport, { source, originalFile, fileUrl, localFileKey, zipEntryName: null, recordIndex: i }));
        }
    }
    return versions;
}

async function parseRestoreVersionsFromZipBlob(zipBlob, { source, originalFile, fileUrl, localFileKey }) {
    const files = await unzipStore(zipBlob);

    // Seed restore cache to avoid re-downloading/re-unzipping during diff/preview.
    try {
        const cacheKey = getRestoreSourceCacheKey({
            source,
            sourceType: 'zip',
            originalFile,
            fileUrl: fileUrl || null,
            localFileKey: localFileKey || null
        });
        restoreCacheSet(restoreSourceCache.zipFiles, cacheKey, { files });
    } catch (_) { }
    const versions = [];

    for (const file of files) {
        if (!file?.name || !file.name.endsWith('.json')) continue;
        try {
            const data = JSON.parse(file.content);
            if (data && (data._exportInfo || data.time)) {
                versions.push(buildRestoreVersionFromExportData(data, {
                    source,
                    originalFile,
                    fileUrl,
                    localFileKey,
                    zipEntryName: file.name,
                    recordIndex: null
                }));
            }
        } catch (_) {
            // ignore
        }
    }

    return versions;
}

function dedupeAndSortRestoreVersions(versions) {
    const map = new Map();
    for (const v of versions || []) {
        if (!v || !v.id) continue;
        map.set(v.id, v);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => (b.time || 0) - (a.time || 0));
    return list;
}

// [New] 扫描并解析恢复数据源，统一返回"可恢复版本"列表
// 重构：不再使用"优先级短路"模式，而是扫描所有来源并合并
async function scanAndParseRestoreSource(source, localFiles = null) {
    try {
        let candidates = [];

        if (source === 'local') {
            candidates = Array.isArray(localFiles) ? localFiles : [];
        } else {
            candidates = await listRemoteFiles(source);
        }

        const allVersions = [];
        const htmlVersionBySnapshotKey = new Map();

        const mergedJsonCandidates = candidates.filter(f => f && f.type === 'merged_history');
        for (const file of mergedJsonCandidates) {
            try {
                let text = '';
                if (source === 'local') {
                    text = String(file.text || '');
                } else {
                    const blob = await downloadRemoteFile({ url: file.url, source });
                    text = await blob.text();
                }
                const versions = parseRestoreVersionsFromMergedHistoryJsonText(text, {
                    source,
                    originalFile: file.name,
                    fileUrl: file.url || null,
                    localFileKey: file.localFileKey || null
                });
                allVersions.push(...versions);
                console.log(`[scanAndParseRestoreSource] Parsed ${versions.length} versions from ${file.name}`);
            } catch (e) {
                console.warn('[scanAndParseRestoreSource] Failed to parse merged history:', file.name, e);
            }
        }

        const zipCandidates = candidates.filter(f => f && f.type === 'zip');
        for (const file of zipCandidates) {
            try {
                let blob;
                if (source === 'local') {
                    const ab = file.arrayBuffer;
                    if (!ab) continue;
                    blob = new Blob([ab], { type: 'application/zip' });
                } else {
                    blob = await downloadRemoteFile({ url: file.url, source });
                }
                const versions = await parseRestoreVersionsFromZipBlob(blob, {
                    source,
                    originalFile: file.name,
                    fileUrl: file.url || null,
                    localFileKey: file.localFileKey || null
                });
                allVersions.push(...versions);
                console.log(`[scanAndParseRestoreSource] Parsed ${versions.length} versions from ZIP ${file.name}`);
            } catch (e) {
                console.warn('[scanAndParseRestoreSource] Failed to parse ZIP:', file.name, e);
            }
        }

        const htmlCandidates = candidates.filter(f => f && f.type === 'html_backup');
        for (const f of htmlCandidates) {
            try {
                const version = buildRestoreVersionFromHtmlFile({
                    source,
                    originalFile: f.name,
                    fileUrl: f.url || null,
                    localFileKey: f.localFileKey || null,
                    fileName: f.name,
                    lastModifiedMs: typeof f.lastModified === 'number' ? f.lastModified : null,
                    snapshotFolder: f.snapshotFolder || '',
                    folderPath: f.folderPath || ''
                });
                allVersions.push(version);

                const snapshotKey = version?.restoreRef?.snapshotKey || parseSnapshotKeyFromText(f.snapshotFolder || f.folderPath || f.name || '');
                if (snapshotKey) {
                    const existing = htmlVersionBySnapshotKey.get(snapshotKey);
                    const existingTime = typeof existing?.time === 'number' ? existing.time : -1;
                    const nextTime = typeof version?.time === 'number' ? version.time : -1;
                    if (!existing || nextTime >= existingTime) {
                        htmlVersionBySnapshotKey.set(snapshotKey, version);
                    }
                }
            } catch (e) {
                console.warn('[scanAndParseRestoreSource] Failed to parse HTML:', f.name, e);
            }
        }

        const changesArtifactCandidates = candidates.filter(f => f && f.type === 'changes_artifact');
        const bestArtifactBySnapshotKey = new Map();

        for (const file of changesArtifactCandidates) {
            try {
                const snapshotKey = buildCurrentChangesArtifactMatchKey(file);
                if (!snapshotKey) continue;

                let text = '';
                if (source === 'local') {
                    text = String(file.text || '');
                    if (!text && file.localFileKey) {
                        continue;
                    }
                } else {
                    const blob = await downloadRemoteFile({ url: file.url, source });
                    text = await blob.text();
                }

                const lowerName = String(file.name || '').toLowerCase();
                const format = lowerName.endsWith('.html') ? 'html' : 'json';
                const mode = parseCurrentChangesArtifactModeFromName(file.name) || 'simple';
                const stats = parseCurrentChangesArtifactStatsFromText(text, { isHtml: format === 'html' }) || buildRestoreStats(null);

                const modePriority = mode === 'detailed'
                    ? 100
                    : (mode === 'collection' ? 60 : 10);
                const priority =
                    modePriority
                    + (format === 'json' ? 5 : 0)
                    + Math.min(getRestoreStatsMagnitude(stats), 9999) / 10000;

                const existing = bestArtifactBySnapshotKey.get(snapshotKey);
                if (!existing || priority >= existing.priority) {
                    bestArtifactBySnapshotKey.set(snapshotKey, {
                        snapshotKey,
                        mode,
                        format,
                        stats,
                        name: file.name,
                        priority
                    });
                }
            } catch (e) {
                console.warn('[scanAndParseRestoreSource] Failed to parse current changes artifact:', file?.name, e);
            }
        }

        for (const [snapshotKey, artifact] of bestArtifactBySnapshotKey.entries()) {
            const version = htmlVersionBySnapshotKey.get(snapshotKey);
            if (!version) continue;

            version.stats = artifact.stats || version.stats;
            version.restoreRef = {
                ...(version.restoreRef || {}),
                snapshotKey,
                changesArtifact: {
                    name: artifact.name,
                    mode: artifact.mode,
                    format: artifact.format
                }
            };

            const notePrefix = artifact.mode === 'detailed'
                ? (artifact.format === 'json' ? 'Current Changes (Detailed JSON)' : 'Current Changes (Detailed HTML)')
                : (artifact.mode === 'collection'
                    ? (artifact.format === 'json' ? 'Current Changes (Collection JSON)' : 'Current Changes (Collection HTML)')
                    : (artifact.format === 'json' ? 'Current Changes (Simple JSON)' : 'Current Changes (Simple HTML)'));
            version.note = String(version.note || '').trim() || notePrefix;
        }

        const normalized = dedupeAndSortRestoreVersions(allVersions);

        console.log(`[scanAndParseRestoreSource] Total versions found: ${normalized.length}`);

        let primarySourceType = 'mixed';
        if (mergedJsonCandidates.length > 0 && zipCandidates.length === 0 && htmlCandidates.length === 0) {
            primarySourceType = 'json';
        } else if (zipCandidates.length > 0 && mergedJsonCandidates.length === 0 && htmlCandidates.length === 0) {
            primarySourceType = 'zip';
        } else if (htmlCandidates.length > 0 && mergedJsonCandidates.length === 0 && zipCandidates.length === 0) {
            primarySourceType = 'html';
        }

        return {
            success: true,
            sourceType: primarySourceType,
            versions: normalized,
            artifacts: {
                currentChangesCount: changesArtifactCandidates.length
            }
        };
    } catch (e) {
        console.error('[scanAndParseRestoreSource] Failed:', e);
        return { success: false, error: e.message };
    }
}

async function findBookmarkContainers() {

    const [root] = await browserAPI.bookmarks.getTree();
    const children = root?.children || [];

    let bookmarkBar = children.find(c => c.id === '1');
    let otherBookmarks = children.find(c => c.id === '2');

    if (!bookmarkBar) {
        bookmarkBar = children.find(c =>
            c.title === '书签栏' ||
            c.title === 'Bookmarks Bar' ||
            c.title === 'Bookmarks bar' ||
            c.title === 'Favorites Bar' ||
            c.title === 'Favorites bar' ||
            c.title === '收藏夹栏' ||
            c.title === 'toolbar_____'
        );
    }

    if (!otherBookmarks) {
        otherBookmarks = children.find(c =>
            c.title === '其他书签' ||
            c.title === 'Other Bookmarks' ||
            c.title === 'Other bookmarks' ||
            c.title === 'Other Favorites' ||
            c.title === 'Other favorites' ||
            c.title === 'Other favourites' ||
            c.title === '其他收藏夹'
        );
    }

    return { root, bookmarkBar, otherBookmarks };
}

async function getBookmarkRootContainers() {
    const [root] = await browserAPI.bookmarks.getTree();
    const children = root?.children || [];
    return children.map((c) => ({
        id: String(c.id),
        title: String(c.title || '')
    }));
}

async function runBatchedTasks(items, worker, concurrency = 6) {
    const queue = Array.isArray(items) ? items : [];
    if (!queue.length) return [];

    const limit = Math.max(1, Number(concurrency) || 1);
    const results = new Array(queue.length).fill(0);
    const running = new Set();
    let cursor = 0;

    const launchTask = (taskIndex) => {
        const task = Promise.resolve()
            .then(() => worker(queue[taskIndex], taskIndex))
            .then((value) => {
                results[taskIndex] = value;
            })
            .catch((error) => {
                console.warn('[runBatchedTasks] Task failed:', error);
                results[taskIndex] = 0;
            })
            .finally(() => {
                running.delete(task);
            });

        running.add(task);
    };

    while (cursor < queue.length || running.size > 0) {
        while (cursor < queue.length && running.size < limit) {
            launchTask(cursor);
            cursor += 1;
        }

        if (running.size > 0) {
            await Promise.race(running);
        }
    }

    return results;
}

function sumCreatedCounts(values) {
    return (Array.isArray(values) ? values : []).reduce((total, value) => {
        return total + (Number.isFinite(value) ? value : 0);
    }, 0);
}

async function removeAllChildren(parentId) {
    const children = await browserAPI.bookmarks.getChildren(parentId);
    await runBatchedTasks(children || [], async (child) => {
        try {
            await browserAPI.bookmarks.removeTree(child.id);
        } catch (e) {
            console.warn('[removeAllChildren] Remove failed:', child?.id, e);
        }
        return 0;
    }, 8);
}

async function createNodeRecursive(node, parentId) {
    if (!node) return 0;
    const title = node.title || '';
    const isFolder = Array.isArray(node.children) && !node.url;

    if (isFolder) {
        const createdFolder = await browserAPI.bookmarks.create({ parentId, title });
        let created = 1;

        const childNodes = Array.isArray(node.children) ? node.children : [];
        const childCreatedCounts = await runBatchedTasks(childNodes, async (child) => {
            return await createNodeRecursive(child, createdFolder.id);
        }, 5);

        created += sumCreatedCounts(childCreatedCounts);
        return created;
    }

    if (node.url) {
        await browserAPI.bookmarks.create({ parentId, title, url: node.url });
        return 1;
    }

    return 0;
}

async function executeOverwriteBookmarkRestore(bookmarkTree) {
    const lang = await getCurrentLang();
    assertBookmarkTreeContent(bookmarkTree, lang, 'overwrite');

    const { bookmarkBar, otherBookmarks } = await findBookmarkContainers();
    if (!bookmarkBar || !otherBookmarks) {
        throw new Error('Cannot find bookmark containers');
    }

    await removeAllChildren(bookmarkBar.id);
    await removeAllChildren(otherBookmarks.id);

    let createdCount = 0;
    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];

    for (const node of nodes) {
        if (!node?.children) continue;
        for (const topFolder of node.children || []) {
            const isBookmarkBarFolder = topFolder.id === '1' ||
                topFolder.title === '书签栏' ||
                topFolder.title === 'Bookmarks Bar' ||
                topFolder.title === 'Bookmarks bar' ||
                topFolder.title === 'toolbar_____';

            const targetContainer = isBookmarkBarFolder ? bookmarkBar : otherBookmarks;
            if (topFolder?.url) {
                try {
                    createdCount += await createNodeRecursive(topFolder, targetContainer.id);
                } catch (e) {
                    console.warn('[executeOverwriteBookmarkRestore] Create failed:', e);
                }
                continue;
            }

            const childNodes = Array.isArray(topFolder?.children) ? topFolder.children : [];
            const childCreatedCounts = await runBatchedTasks(childNodes, async (child) => {
                return await createNodeRecursive(child, targetContainer.id);
            }, 5);

            createdCount += sumCreatedCounts(childCreatedCounts);
        }
    }

    return { created: createdCount };
}

async function executeMergeBookmarkRestore(bookmarkTree, options = {}) {
    const lang = await getCurrentLang();
    assertBookmarkTreeContent(bookmarkTree, lang, 'merge');

    // Merge = “导入式导入” (类似浏览器导入 HTML 的行为)：不覆盖现有树，而是在根容器下新增一个导入文件夹。
    const { root, bookmarkBar, otherBookmarks } = await findBookmarkContainers();
    const rootChildren = root?.children || [];
    let targetContainer = null;

    if (options && options.importParentId) {
        try {
            const nodes = await browserAPI.bookmarks.get(String(options.importParentId));
            const node = Array.isArray(nodes) ? nodes[0] : null;
            if (node && !node.url && String(node.id) !== '0') {
                targetContainer = node;
            }
        } catch (_) { }
    }

    if (!targetContainer) {
        targetContainer = otherBookmarks || bookmarkBar || rootChildren[0];
    }
    if (!targetContainer) throw new Error('Cannot find bookmark root container');

    const isEn = lang === 'en';

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const importKind = options && options.importKind === 'changes' ? 'changes' : 'snapshot';
    const viewMode = options && (options.viewMode === 'simple' || options.viewMode === 'detailed') ? options.viewMode : null;
    const meta = options && options.meta && typeof options.meta === 'object' ? options.meta : null;

    const viewLabel = viewMode === 'detailed'
        ? (isEn ? 'Detailed' : '详细')
        : (isEn ? 'Simple' : '简略');

    const seqText = meta && meta.seqNumber != null ? String(meta.seqNumber) : '-';
    const fingerprint = meta && meta.fingerprint ? ` [${String(meta.fingerprint).slice(0, 7)}]` : '';
    const modeSuffix = viewMode ? ` (${viewLabel})` : '';

    const importRootTitle = (() => {
        if (importKind === 'changes') {
            return isEn
                ? `Imported Changes${modeSuffix} - #${seqText}${fingerprint} - ${timestamp}`
                : `导入变化${modeSuffix} - #${seqText}${fingerprint} - ${timestamp}`;
        }
        return isEn ? `Imported - ${timestamp}` : `导入 - ${timestamp}`;
    })();

    const importRootFolder = await browserAPI.bookmarks.create({
        parentId: targetContainer.id,
        title: importRootTitle
    });

    let createdCount = 1; // importRootFolder
    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];

    for (const node of nodes) {
        if (!Array.isArray(node?.children)) continue;
        for (const topFolder of node.children || []) {
            if (topFolder?.url) {
                try {
                    createdCount += await createNodeRecursive(topFolder, importRootFolder.id);
                } catch (e) {
                    console.warn('[executeMergeBookmarkRestore] Create failed:', e);
                }
                continue;
            }

            const topTitle = String(topFolder?.title || '').trim() || (isEn ? 'Bookmarks' : '书签');
            const topContainer = await browserAPI.bookmarks.create({
                parentId: importRootFolder.id,
                title: topTitle
            });
            createdCount += 1; // topContainer

            const childNodes = Array.isArray(topFolder?.children) ? topFolder.children : [];
            const childCreatedCounts = await runBatchedTasks(childNodes, async (child) => {
                return await createNodeRecursive(child, topContainer.id);
            }, 5);

            createdCount += sumCreatedCounts(childCreatedCounts);
        }
    }

    return { created: createdCount, importedFolderId: importRootFolder.id, importedFolderTitle: importRootTitle };
}

function ensureRestoreTreeIds(targetTree) {
    let counter = 0;

    const walk = (node, parentId = null) => {
        if (!node || typeof node !== 'object') return;

        if (!node.id) {
            const title = String(node.title || '').trim().toLowerCase();
            if (parentId === null && title === 'root') {
                node.id = '0';
            } else {
                counter += 1;
                node.id = `__restore_tmp_${counter}`;
            }
        }

        if (parentId != null && (node.parentId == null || node.parentId === '')) {
            node.parentId = String(parentId);
        }

        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                walk(child, node.id);
            }
        }
    };

    const roots = Array.isArray(targetTree) ? targetTree : [targetTree];
    for (const r of roots) {
        walk(r, null);
    }
}

function normalizeTreeIds(targetTree, referenceTree, options = {}) {
    if (!targetTree || !referenceTree) return;

    const strictGlobalUrlMatch = options && options.strictGlobalUrlMatch === true;

    const referenceRootIds = (() => {
        if (!options || !('referenceRootIds' in options)) return null;
        const src = options.referenceRootIds;
        if (src instanceof Set) return new Set(Array.from(src).map(v => String(v)));
        if (Array.isArray(src)) return new Set(src.map(v => String(v)));
        return null;
    })();

    const normalizeTitle = (title) => String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // normalizeTreeIds 的输出报告：用于展示“歧义”信息
    const report = {
        ambiguous: [],
        matched: {
            id: 0,
            structure: 0,
            url: 0,
            title: 0,
            manual: 0
        }
    };

    const recordAmbiguous = (item) => {
        if (!item) return;
        report.ambiguous.push(item);
    };

    const pickUniqueClosestByIndex = (index, candidates) => {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;
        if (typeof index !== 'number' || !Number.isFinite(index)) return null;

        let best = null;
        let bestDistance = Infinity;
        for (const c of candidates) {
            const ci = typeof c.index === 'number' ? c.index : null;
            if (ci == null) continue;
            const d = Math.abs(ci - index);
            if (d < bestDistance) {
                bestDistance = d;
                best = c;
            } else if (d === bestDistance) {
                return null; // ambiguous
            }
        }
        return best;
    };

    const manualMatchMap = (() => {
        if (!options || !options.manualMatches) return null;
        const src = options.manualMatches;
        const m = new Map();

        if (src instanceof Map) {
            for (const [k, v] of src.entries()) {
                if (k == null || v == null) continue;
                m.set(String(k), String(v));
            }
            return m.size > 0 ? m : null;
        }

        if (Array.isArray(src)) {
            for (const pair of src) {
                if (!pair || pair.length < 2) continue;
                m.set(String(pair[0]), String(pair[1]));
            }
            return m.size > 0 ? m : null;
        }

        if (typeof src === 'object') {
            for (const [k, v] of Object.entries(src)) {
                if (k == null || v == null) continue;
                m.set(String(k), String(v));
            }
            return m.size > 0 ? m : null;
        }

        return null;
    })();

    // --- 0. 准备工作：建立参考树索引 ---
    const refPool = {
        ids: new Set(),
        claimedIds: new Set(),
        nodeMap: new Map(),
        urlMap: new Map(),
        titleMap: new Map(),
        parentById: new Map()
    };

    const indexRef = (nodes, underAllowed = false) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach(node => {
            if (!node) return;

            const id = (node.id != null) ? String(node.id) : null;
            const isRoot = id === '0';
            const isAllowedRoot = referenceRootIds ? (id != null && referenceRootIds.has(id)) : false;
            const shouldIndex = !referenceRootIds || isRoot || underAllowed || isAllowedRoot;
            const nextUnderAllowed = underAllowed || isAllowedRoot;

            if (shouldIndex && id != null) {
                refPool.ids.add(id);
                refPool.nodeMap.set(id, node);
                if (node.parentId != null && node.parentId !== '') {
                    refPool.parentById.set(id, String(node.parentId));
                }

                if (node.url) {
                    if (!refPool.urlMap.has(node.url)) {
                        refPool.urlMap.set(node.url, new Set());
                    }
                    refPool.urlMap.get(node.url).add(node);
                } else if (node.title) {
                    const t = normalizeTitle(node.title);
                    if (t) {
                        if (!refPool.titleMap.has(t)) {
                            refPool.titleMap.set(t, new Set());
                        }
                        refPool.titleMap.get(t).add(node);
                    }
                }
            }

            if (node.children) indexRef(node.children, nextUnderAllowed);
        });
    };
    indexRef(referenceTree, false);

    const updateNodeId = (node, newId) => {
        if (!node) return;
        node.id = newId;
        if (node.children) {
            node.children.forEach(child => {
                if (child) child.parentId = newId;
            });
        }
    };

    // --- Pass 1: ID 精确匹配 ---
    const pass1_IDMatch = (nodes) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach(node => {
            if (!node || node.id == null) return;
            const id = String(node.id);
            if (refPool.ids.has(id)) {
                if (!refPool.claimedIds.has(id)) {
                    const refNode = refPool.nodeMap.get(id);
                    const isSameType = (!!node.url === !!(refNode && refNode.url));
                    if (isSameType) {
                        refPool.claimedIds.add(id);
                        node._matchedRefNode = refNode;
                        report.matched.id += 1;
                    }
                }
            }
            if (node.children) pass1_IDMatch(node.children);
        });
    };
    pass1_IDMatch(targetTree);

    // --- Pass 1.5: 手动匹配 ---
    if (manualMatchMap && manualMatchMap.size > 0) {
        const pass1_5_ManualMatch = (nodes) => {
            if (!nodes) return;
            const list = Array.isArray(nodes) ? nodes : [nodes];
            list.forEach(node => {
                if (!node || node.id == null) return;

                if (!node._matchedRefNode) {
                    const targetId = String(node.id);
                    const pickedRefId = manualMatchMap.get(targetId);
                    if (pickedRefId) {
                        const refNode = refPool.nodeMap.get(String(pickedRefId));
                        const isSameType = refNode ? (!!node.url === !!refNode.url) : false;

                        if (!refNode) {
                            recordAmbiguous({
                                phase: 'manual',
                                type: node.url ? 'bookmark' : 'folder',
                                targetId,
                                title: node.title || '',
                                url: node.url || '',
                                picked: String(pickedRefId),
                                reason: 'ref-not-found'
                            });
                        } else if (!isSameType) {
                            recordAmbiguous({
                                phase: 'manual',
                                type: node.url ? 'bookmark' : 'folder',
                                targetId,
                                title: node.title || '',
                                url: node.url || '',
                                picked: String(pickedRefId),
                                reason: 'type-mismatch'
                            });
                        } else if (refPool.claimedIds.has(String(pickedRefId))) {
                            recordAmbiguous({
                                phase: 'manual',
                                type: node.url ? 'bookmark' : 'folder',
                                targetId,
                                title: node.title || '',
                                url: node.url || '',
                                picked: String(pickedRefId),
                                reason: 'ref-already-claimed'
                            });
                        } else {
                            const newId = String(pickedRefId);
                            updateNodeId(node, newId);
                            refPool.claimedIds.add(newId);
                            node._matchedRefNode = refNode;
                            report.matched.manual += 1;
                        }
                    }
                }

                if (node.children) pass1_5_ManualMatch(node.children);
            });
        };

        pass1_5_ManualMatch(targetTree);
    }

    // --- Pass 2: 结构位置匹配 ---
    const pass2_StructureMatch = (nodes, parentMatchedRefNode) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];

        list.forEach(node => {
            if (!node) return;

            if (!node._matchedRefNode) {
                if (parentMatchedRefNode && parentMatchedRefNode.children) {
                    const isBookmark = !!node.url;
                    const candidates = parentMatchedRefNode.children.filter(refChild => {
                        const refId = String(refChild.id);
                        if (refPool.claimedIds.has(refId)) return false;
                        const refIsBookmark = !!refChild.url;
                        if (isBookmark !== refIsBookmark) return false;
                        if (node.title !== refChild.title) return false;
                        if (isBookmark && node.url !== refChild.url) return false;
                        return true;
                    });

                    let candidate = null;
                    if (candidates.length === 1) {
                        candidate = candidates[0];
                    } else if (candidates.length > 1) {
                        candidate = pickUniqueClosestByIndex(node.index, candidates);
                        if (!candidate) {
                            recordAmbiguous({
                                phase: 'structure',
                                type: isBookmark ? 'bookmark' : 'folder',
                                targetId: String(node.id),
                                targetParentId: node.parentId != null ? String(node.parentId) : '',
                                targetIndex: (typeof node.index === 'number' && Number.isFinite(node.index)) ? node.index : null,
                                title: node.title || '',
                                url: node.url || '',
                                candidates: candidates.slice(0, 6).map(c => ({ id: String(c.id), title: c.title || '', url: c.url || '' }))
                            });
                        }
                    }

                    if (candidate) {
                        const newId = String(candidate.id);
                        updateNodeId(node, newId);
                        refPool.claimedIds.add(newId);
                        node._matchedRefNode = candidate;
                        report.matched.structure += 1;
                    }
                }
            }

            if (node.children) {
                pass2_StructureMatch(node.children, node._matchedRefNode);
            }
        });
    };

    const rootNodes = Array.isArray(targetTree) ? targetTree : [targetTree];
    rootNodes.forEach(root => {
        if (!root) return;
        pass2_StructureMatch(root.children, root._matchedRefNode);
    });

    // --- Pass 3: 全局 URL 匹配 ---
    const pass3_GlobalUrlMatch = (nodes, parentMatchedRefNode = null) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach(node => {
            if (!node) return;

            if (!node._matchedRefNode && node.url) {
                const candidatesSet = refPool.urlMap.get(node.url);
                if (candidatesSet) {
                    const candidates = [];
                    for (const cand of candidatesSet) {
                        if (!cand || cand.id == null) continue;
                        const candId = String(cand.id);
                        if (referenceRootIds && !refPool.ids.has(candId)) continue;
                        if (refPool.claimedIds.has(candId)) continue;
                        candidates.push(cand);
                    }

                    let bestMatch = null;

                    if (candidates.length === 1) {
                        bestMatch = candidates[0];
                    } else if (candidates.length > 1) {
                        const nodeTitleNorm = normalizeTitle(node.title);
                        const titleMatched = candidates.filter(c => normalizeTitle(c.title) === nodeTitleNorm);
                        if (titleMatched.length === 1) {
                            bestMatch = titleMatched[0];
                        } else if (parentMatchedRefNode && parentMatchedRefNode.id != null) {
                            const parentId = String(parentMatchedRefNode.id);
                            const parentMatched = candidates.filter(c => {
                                const cid = String(c.id);
                                const candParentId = refPool.parentById.get(cid);
                                return candParentId != null && String(candParentId) === parentId;
                            });
                            if (parentMatched.length === 1) {
                                bestMatch = parentMatched[0];
                            }
                        }

                        if (!bestMatch && !strictGlobalUrlMatch) {
                            bestMatch = candidates[0];
                        }
                    }

                    if (bestMatch) {
                        const newId = String(bestMatch.id);
                        updateNodeId(node, newId);
                        refPool.claimedIds.add(newId);
                        node._matchedRefNode = bestMatch;
                        report.matched.url += 1;
                    } else if (candidates.length > 1) {
                        recordAmbiguous({
                            phase: 'url',
                            type: 'bookmark',
                            targetId: String(node.id),
                            targetParentId: node.parentId != null ? String(node.parentId) : '',
                            targetIndex: (typeof node.index === 'number' && Number.isFinite(node.index)) ? node.index : null,
                            title: node.title || '',
                            url: node.url || '',
                            candidates: candidates.slice(0, 6).map(c => ({ id: String(c.id), title: c.title || '', url: c.url || '' }))
                        });
                    }
                }
            }

            if (node.children) {
                pass3_GlobalUrlMatch(node.children, node._matchedRefNode || null);
            }
        });
    };
    pass3_GlobalUrlMatch(targetTree, null);

    // --- Pass 4: 全局标题匹配（文件夹）
    const pass4_GlobalFolderTitleMatch = (nodes, parentMatchedRefNode = null) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach(node => {
            if (!node || node.url) {
                if (node && node.children) pass4_GlobalFolderTitleMatch(node.children, node._matchedRefNode || null);
                return;
            }

            if (!node._matchedRefNode && node.title) {
                const key = normalizeTitle(node.title);
                if (key) {
                    const candidatesSet = refPool.titleMap.get(key);
                    if (candidatesSet) {
                        const candidates = [];
                        for (const cand of candidatesSet) {
                            if (!cand || cand.id == null) continue;
                            const candId = String(cand.id);
                            if (referenceRootIds && !refPool.ids.has(candId)) continue;
                            if (refPool.claimedIds.has(candId)) continue;
                            candidates.push(cand);
                        }

                        let bestMatch = null;
                        if (candidates.length === 1) {
                            bestMatch = candidates[0];
                        } else if (candidates.length > 1) {
                            if (parentMatchedRefNode && parentMatchedRefNode.id != null) {
                                const parentId = String(parentMatchedRefNode.id);
                                const parentMatched = candidates.filter(c => {
                                    const cid = String(c.id);
                                    const candParentId = refPool.parentById.get(cid);
                                    return candParentId != null && String(candParentId) === parentId;
                                });
                                if (parentMatched.length === 1) {
                                    bestMatch = parentMatched[0];
                                }
                            }

                            if (!bestMatch) {
                                recordAmbiguous({
                                    phase: 'title',
                                    type: 'folder',
                                    targetId: String(node.id),
                                    targetParentId: node.parentId != null ? String(node.parentId) : '',
                                    targetIndex: (typeof node.index === 'number' && Number.isFinite(node.index)) ? node.index : null,
                                    title: node.title || '',
                                    url: '',
                                    candidates: candidates.slice(0, 6).map(c => ({ id: String(c.id), title: c.title || '', url: '' }))
                                });
                            }
                        }

                        if (bestMatch) {
                            const newId = String(bestMatch.id);
                            updateNodeId(node, newId);
                            refPool.claimedIds.add(newId);
                            node._matchedRefNode = bestMatch;
                            report.matched.title += 1;
                        }
                    }
                }
            }

            if (node.children) {
                pass4_GlobalFolderTitleMatch(node.children, node._matchedRefNode || null);
            }
        });
    };
    pass4_GlobalFolderTitleMatch(targetTree, null);

    const cleanup = (nodes) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach(node => {
            if (!node) return;
            delete node._matchedRefNode;
            if (node.children) cleanup(node.children);
        });
    };
    cleanup(targetTree);

    return report;
}

// 变化检测函数（从 history.js 复制）
function detectTreeChangesFastBg(oldTree, newTree, options = {}) {
    const changes = new Map();
    if (!oldTree || !newTree) return changes;

    let explicitMovedIdSet = null;
    if (options && typeof options === 'object' && 'explicitMovedIdSet' in options) {
        const src = options.explicitMovedIdSet;
        if (src instanceof Set) {
            explicitMovedIdSet = new Set(Array.from(src).map(v => String(v)));
        } else if (Array.isArray(src)) {
            explicitMovedIdSet = new Set(src.map(v => String(v)));
        } else if (src === null) {
            explicitMovedIdSet = null;
        }
    }
    const hasExplicitMovedInfo = explicitMovedIdSet instanceof Set && explicitMovedIdSet.size > 0;

    const oldNodes = new Map();
    const newNodes = new Map();
    const oldByParent = new Map();
    const newByParent = new Map();

    const traverse = (node, map, byParent, parentId = null) => {
        if (node && node.id != null) {
            const id = String(node.id);
            const record = {
                title: node.title,
                url: node.url,
                parentId: (node.parentId != null && node.parentId !== '') ? String(node.parentId) : (parentId != null ? String(parentId) : null),
                index: node.index
            };
            map.set(id, record);
            if (record.parentId) {
                if (!byParent.has(record.parentId)) byParent.set(record.parentId, []);
                byParent.get(record.parentId).push({ id, index: record.index });
            }
        }
        if (node && node.children) {
            node.children.forEach(child => traverse(child, map, byParent, node.id));
        }
    };

    const oldRoot = Array.isArray(oldTree) ? oldTree[0] : oldTree;
    const newRoot = Array.isArray(newTree) ? newTree[0] : newTree;
    if (oldRoot) traverse(oldRoot, oldNodes, oldByParent, null);
    if (newRoot) traverse(newRoot, newNodes, newByParent, null);

    const getNodePath = (tree, targetId) => {
        const tid = String(targetId);
        const path = [];
        const dfs = (node, cur) => {
            if (!node) return false;
            if (String(node.id) === tid) {
                path.push(...cur, node.title);
                return true;
            }
            if (node.children) {
                for (const c of node.children) {
                    if (dfs(c, [...cur, node.title])) return true;
                }
            }
            return false;
        };
        const root = Array.isArray(tree) ? tree[0] : tree;
        if (root) dfs(root, []);
        return path.join(' > ');
    };

    // 新增 / 修改 / 跨级移动
    newNodes.forEach((n, id) => {
        const o = oldNodes.get(id);
        if (!o) {
            changes.set(id, { type: 'added' });
            return;
        }
        const modified = (o.title !== n.title) || (o.url !== n.url);
        const crossMove = o.parentId !== n.parentId;
        if (modified || crossMove) {
            const types = [];
            const detail = {};
            if (modified) types.push('modified');
            if (crossMove) {
                types.push('moved');
                detail.moved = {
                    oldPath: getNodePath(oldTree, id),
                    newPath: getNodePath(newTree, id),
                    oldParentId: o.parentId,
                    oldIndex: o.index,
                    newParentId: n.parentId,
                    newIndex: n.index
                };
            }
            changes.set(id, { type: types.join('+'), ...detail });
        }
    });

    // 删除
    oldNodes.forEach((_, id) => {
        if (!newNodes.has(id)) changes.set(id, { type: 'deleted' });
    });

    // 子节点集合发生变化的父级集合（避免被动位移误标 moved）
    const parentsWithChildSetChange = new Set();
    changes.forEach((change, id) => {
        if (!change || !change.type) return;

        if (change.type.includes('added') || change.type.includes('deleted')) {
            const node = change.type.includes('added') ? newNodes.get(id) : oldNodes.get(id);
            if (node && node.parentId) parentsWithChildSetChange.add(node.parentId);
        }

        if (change.type.includes('moved') && change.moved && change.moved.oldParentId !== change.moved.newParentId) {
            if (change.moved.oldParentId) parentsWithChildSetChange.add(String(change.moved.oldParentId));
            if (change.moved.newParentId) parentsWithChildSetChange.add(String(change.moved.newParentId));
        }
    });

    const markMoved = (id) => {
        const existing = changes.get(id);
        const types = existing && existing.type ? new Set(String(existing.type).split('+')) : new Set();
        types.add('moved');
        const movedDetail = { oldPath: getNodePath(oldTree, id), newPath: getNodePath(newTree, id) };
        changes.set(id, { type: Array.from(types).join('+'), moved: movedDetail });
    };

    const commonPosCache = new Map();
    const getCommonPositions = (parentId) => {
        const pid = String(parentId);
        if (commonPosCache.has(pid)) return commonPosCache.get(pid);

        const oldList = oldByParent.get(pid) || [];
        const newList = newByParent.get(pid) || [];
        const newIdSet = new Set(newList.map(x => String(x.id)));

        const oldPosById = new Map();
        let oldPos = 0;
        for (const item of oldList) {
            const id = String(item.id);
            if (newIdSet.has(id)) {
                oldPosById.set(id, oldPos++);
            }
        }

        const newPosById = new Map();
        let newPos = 0;
        for (const item of newList) {
            const id = String(item.id);
            if (oldPosById.has(id)) {
                newPosById.set(id, newPos++);
            }
        }

        const entry = { oldPosById, newPosById };
        commonPosCache.set(pid, entry);
        return entry;
    };

    // 同级移动：显式 moved IDs 或 LIS 推导
    if (hasExplicitMovedInfo) {
        for (const idRaw of explicitMovedIdSet) {
            const id = String(idRaw);
            const o = oldNodes.get(id);
            const n = newNodes.get(id);
            if (!o || !n) continue;
            if (!o.parentId || !n.parentId) continue;
            if (o.parentId !== n.parentId) continue; // 跨级移动已标记

            const parentId = n.parentId;
            const { oldPosById, newPosById } = getCommonPositions(parentId);
            const oldPos = oldPosById.get(id);
            const newPos = newPosById.get(id);
            if (typeof oldPos === 'number' && typeof newPos === 'number' && oldPos !== newPos) {
                markMoved(id);
            }
        }
    } else {
        newByParent.forEach((newList, parentId) => {
            const pid = String(parentId);
            if (parentsWithChildSetChange.has(pid)) return;

            const oldList = oldByParent.get(pid) || [];
            if (oldList.length === 0 || newList.length === 0) return;
            if (oldList.length !== newList.length) return;

            let sameOrder = true;
            for (let i = 0; i < oldList.length; i++) {
                if (String(oldList[i].id) !== String(newList[i].id)) {
                    sameOrder = false;
                    break;
                }
            }
            if (sameOrder) return;

            const oldPosById = new Map();
            for (let i = 0; i < oldList.length; i++) {
                oldPosById.set(String(oldList[i].id), i);
            }

            const seq = [];
            for (let i = 0; i < newList.length; i++) {
                const id = String(newList[i].id);
                const oldPos = oldPosById.get(id);
                if (typeof oldPos !== 'number') return;
                seq.push({ id, oldPos });
            }

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
                    markMoved(item.id);
                }
            }
        });
    }

    return changes;
}

function flattenBookmarkTreeBg(tree, result = []) {
    if (!tree) return result;
    const nodes = Array.isArray(tree) ? tree : [tree];
    nodes.forEach(node => {
        if (node.id && (node.title || node.url)) {
            result.push({
                id: node.id,
                title: node.title || '',
                url: node.url || '',
                isFolder: !node.url && node.children
            });
        }
        if (node.children) {
            flattenBookmarkTreeBg(node.children, result);
        }
    });
    return result;
}

function rebuildTreeWithDeletedBg(oldTree, newTree, changeMap) {
    if (!oldTree || !oldTree[0] || !newTree || !newTree[0]) {
        return newTree;
    }

    const visitedIds = new Set();
    const MAX_DEPTH = 50;

    function rebuildNode(oldNode, newNodes, depth = 0) {
        if (!oldNode || typeof oldNode.id === 'undefined') return null;
        if (depth > MAX_DEPTH) return null;
        if (visitedIds.has(oldNode.id)) return null;
        visitedIds.add(oldNode.id);

        const newNode = newNodes ? newNodes.find(n => n && n.id === oldNode.id) : null;
        const change = changeMap ? changeMap.get(oldNode.id) : null;

        if (change && change.type === 'deleted') {
            const deletedNodeCopy = JSON.parse(JSON.stringify(oldNode));
            if (oldNode.children && oldNode.children.length > 0) {
                deletedNodeCopy.children = oldNode.children.map(child => rebuildNode(child, null, depth + 1)).filter(n => n !== null);
            }
            return deletedNodeCopy;
        } else if (newNode) {
            const nodeCopy = JSON.parse(JSON.stringify(newNode));
            if (oldNode.children || newNode.children) {
                const childrenMap = new Map();
                if (oldNode.children) {
                    oldNode.children.forEach((child, index) => {
                        childrenMap.set(child.id, { node: child, index, source: 'old' });
                    });
                }
                if (newNode.children) {
                    newNode.children.forEach((child, index) => {
                        childrenMap.set(child.id, { node: child, index, source: 'new' });
                    });
                }

                const rebuiltChildren = [];
                if (oldNode.children) {
                    oldNode.children.forEach(oldChild => {
                        if (!oldChild) return;
                        const childInfo = childrenMap.get(oldChild.id);
                        if (childInfo) {
                            const rebuiltChild = rebuildNode(oldChild, newNode.children, depth + 1);
                            if (rebuiltChild) rebuiltChildren.push(rebuiltChild);
                        }
                    });
                }
                if (newNode.children) {
                    newNode.children.forEach(newChild => {
                        if (!newChild) return;
                        const existed = oldNode.children && oldNode.children.find(c => c && c.id === newChild.id);
                        if (!existed) {
                            rebuiltChildren.push(newChild);
                        }
                    });
                }

                nodeCopy.children = rebuiltChildren;
            }
            return nodeCopy;
        }

        if (newNodes === null && change && change.type === 'deleted') {
            const deletedNodeCopy = JSON.parse(JSON.stringify(oldNode));
            if (oldNode.children && oldNode.children.length > 0) {
                deletedNodeCopy.children = oldNode.children.map(child => rebuildNode(child, null, depth + 1)).filter(n => n !== null);
            }
            return deletedNodeCopy;
        }

        return null;
    }

    const rebuiltRoot = rebuildNode(oldTree[0], [newTree[0]]);
    return rebuiltRoot ? [rebuiltRoot] : newTree;
}

function decodeHtmlEntities(text) {
    const s = String(text == null ? '' : text);
    return s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#(\d+);/g, (_, num) => {
            const code = Number(num);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        });
}

function stripHtmlTags(text) {
    return String(text == null ? '' : text).replace(/<[^>]*>/g, '');
}

function normalizeParsedBookmarkTreeForRestore(root) {
    if (!root || !Array.isArray(root.children)) return root;
    if (root.children.length !== 1) return root;

    const wrapper = root.children[0];
    if (!wrapper || !Array.isArray(wrapper.children)) return root;

    const wrapperTitle = String(wrapper.title || '').trim().toLowerCase();
    const wrapperLooksLikeRoot = wrapperTitle === '' ||
        wrapperTitle === 'bookmarks' ||
        wrapperTitle === 'favorites' ||
        wrapperTitle === '收藏夹' ||
        wrapperTitle === '书签';

    const hasContainerFolder = (wrapper.children || []).some(c => {
        const t = String(c?.title || '').toLowerCase();
        return t === '书签栏' ||
            t === '其他书签' ||
            t === 'bookmarks bar' ||
            t === 'bookmarks toolbar' ||
            t === 'other bookmarks' ||
            t === 'other bookmarks';
    });

    if (wrapperLooksLikeRoot && hasContainerFolder) {
        root.children = wrapper.children;
    }

    return root;
}

function parseNetscapeBookmarkHtmlToTree(htmlText) {
    const root = { title: 'root', children: [] };
    const stack = [root];
    let lastCreatedFolder = null;

    const lines = String(htmlText || '').split(/\r?\n/);
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        const lower = line.toLowerCase();
        if (lower.startsWith('<dl')) {
            if (lastCreatedFolder) {
                stack.push(lastCreatedFolder);
                lastCreatedFolder = null;
            }
            continue;
        }

        if (lower.startsWith('</dl')) {
            if (stack.length > 1) stack.pop();
            lastCreatedFolder = null;
            continue;
        }

        const h3Match = /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(line);
        if (h3Match) {
            const title = decodeHtmlEntities(stripHtmlTags(h3Match[1])).trim();
            const folder = { title, children: [] };
            stack[stack.length - 1].children.push(folder);
            lastCreatedFolder = folder;
            continue;
        }

        const aMatch = /<a[^>]*href\s*=\s*"(.*?)"[^>]*>([\s\S]*?)<\/a>/i.exec(line)
            || /<a[^>]*href\s*=\s*'(.*?)'[^>]*>([\s\S]*?)<\/a>/i.exec(line);
        if (aMatch) {
            const url = decodeHtmlEntities(aMatch[1]).trim();
            const title = decodeHtmlEntities(stripHtmlTags(aMatch[2])).trim();
            if (!url) continue;
            // 忽略用于说明的 about:blank 行（某些导出会包含）
            if (url === 'about:blank') continue;
            stack[stack.length - 1].children.push({ title, url });
            lastCreatedFolder = null;
            continue;
        }
    }

    return normalizeParsedBookmarkTreeForRestore(root);
}

// Restore source caches
const RESTORE_SOURCE_CACHE_TTL_MS = 15 * 60 * 1000;
const RESTORE_SOURCE_CACHE_MAX = 8;

const restoreSourceCache = {
    mergedJson: new Map(), // key -> { ts, value:{ records } }
    zipFiles: new Map(),   // key -> { ts, value:{ files } }
    htmlText: new Map()    // key -> { ts, value:{ text } }
};

// Prevent duplicate download/parse/unzip under concurrency
const restoreSourcePending = {
    mergedJson: new Map(), // key -> Promise<{ records:Array }>
    zipFiles: new Map(),   // key -> Promise<{ files:Array }>
    htmlText: new Map()    // key -> Promise<{ text:string }>
};

function getRestoreSourceCacheKey(restoreRef) {
    const ref = restoreRef || {};
    const sourceType = String(ref.sourceType || '');
    const source = String(ref.source || '');

    const locator = (source === 'local')
        ? String(ref.localFileKey || ref.originalFile || '')
        : String(ref.fileUrl || ref.originalFile || '');

    return `${sourceType}|${source}|${locator}`;
}

function restoreCacheGet(map, key) {
    try {
        const entry = map.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > RESTORE_SOURCE_CACHE_TTL_MS) {
            map.delete(key);
            return null;
        }
        // refresh LRU
        map.delete(key);
        map.set(key, entry);
        return entry.value;
    } catch (_) {
        return null;
    }
}

function restoreCacheSet(map, key, value) {
    try {
        map.set(key, { ts: Date.now(), value });
        while (map.size > RESTORE_SOURCE_CACHE_MAX) {
            const firstKey = map.keys().next().value;
            if (!firstKey) break;
            map.delete(firstKey);
        }
    } catch (_) { }
}

function sanitizeJsonText(text) {
    let t = String(text || '');
    // strip UTF-8 BOM
    if (t.charCodeAt(0) === 0xFEFF) {
        t = t.slice(1);
    }
    t = t.trim();
    return t;
}

function safeParseJson(text) {
    const t = sanitizeJsonText(text);
    if (!t) {
        throw new Error('Empty JSON content');
    }
    try {
        return JSON.parse(t);
    } catch (_) {
        // Recovery: try to locate JSON payload within wrapper text
        const firstObj = t.indexOf('{');
        const firstArr = t.indexOf('[');
        const start = (firstObj >= 0 && firstArr >= 0) ? Math.min(firstObj, firstArr)
            : (firstObj >= 0 ? firstObj : firstArr);
        const lastObj = t.lastIndexOf('}');
        const lastArr = t.lastIndexOf(']');
        const end = (lastObj >= 0 && lastArr >= 0) ? Math.max(lastObj, lastArr)
            : (lastObj >= 0 ? lastObj : lastArr);
        if (start >= 0 && end > start) {
            const sliced = t.slice(start, end + 1);
            return JSON.parse(sliced);
        }
        throw _;
    }
}

async function getMergedHistoryRecordsCached(restoreRef, localPayload) {
    const cacheKey = getRestoreSourceCacheKey(restoreRef);
    const cached = restoreCacheGet(restoreSourceCache.mergedJson, cacheKey);
    if (cached && Array.isArray(cached.records)) return cached.records;

    if (restoreSourcePending.mergedJson.has(cacheKey)) {
        const pending = restoreSourcePending.mergedJson.get(cacheKey);
        const res = await pending;
        return res && Array.isArray(res.records) ? res.records : null;
    }

    const task = (async () => {
        let text = '';
        if (restoreRef.source === 'local') {
            text = String(localPayload?.text || '');
            if (!text) throw new Error('Missing local JSON data');
        } else {
            if (!restoreRef.fileUrl) throw new Error('Missing fileUrl');
            const blob = await downloadRemoteFile({ url: restoreRef.fileUrl, source: restoreRef.source });
            text = await blob.text();
        }

        // Quick detection: HTML error page
        const trimmed = String(text || '').trim();
        if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html') || trimmed.startsWith('<')) {
            throw new Error('Downloaded content is not JSON (maybe auth/permission issue)');
        }

        const parsed = safeParseJson(text);
        const records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.records) ? parsed.records : null);
        if (!Array.isArray(records)) {
            throw new Error('Merged history format not supported');
        }
        restoreCacheSet(restoreSourceCache.mergedJson, cacheKey, { records });
        return { records };
    })();

    restoreSourcePending.mergedJson.set(cacheKey, task);
    try {
        const res = await task;
        return res && Array.isArray(res.records) ? res.records : null;
    } finally {
        restoreSourcePending.mergedJson.delete(cacheKey);
    }
}

async function getZipFilesCached(restoreRef, localPayload) {
    const cacheKey = getRestoreSourceCacheKey(restoreRef);
    const cached = restoreCacheGet(restoreSourceCache.zipFiles, cacheKey);
    if (cached && Array.isArray(cached.files)) return cached.files;

    if (restoreSourcePending.zipFiles.has(cacheKey)) {
        const pending = restoreSourcePending.zipFiles.get(cacheKey);
        const res = await pending;
        return res && Array.isArray(res.files) ? res.files : null;
    }

    const task = (async () => {
        let zipBlob;
        if (restoreRef.source === 'local') {
            const ab = localPayload?.arrayBuffer;
            if (!ab) throw new Error('Missing local ZIP data');
            zipBlob = new Blob([ab], { type: 'application/zip' });
        } else {
            if (!restoreRef.fileUrl) throw new Error('Missing fileUrl');
            zipBlob = await downloadRemoteFile({ url: restoreRef.fileUrl, source: restoreRef.source });
        }
        const files = await unzipStore(zipBlob);
        restoreCacheSet(restoreSourceCache.zipFiles, cacheKey, { files });
        return { files };
    })();

    restoreSourcePending.zipFiles.set(cacheKey, task);
    try {
        const res = await task;
        return res && Array.isArray(res.files) ? res.files : null;
    } finally {
        restoreSourcePending.zipFiles.delete(cacheKey);
    }
}

async function getHtmlTextCached(restoreRef, localPayload) {
    const cacheKey = getRestoreSourceCacheKey(restoreRef);
    const cached = restoreCacheGet(restoreSourceCache.htmlText, cacheKey);
    if (cached && typeof cached.text === 'string' && cached.text) return cached.text;

    if (restoreSourcePending.htmlText.has(cacheKey)) {
        const pending = restoreSourcePending.htmlText.get(cacheKey);
        const res = await pending;
        return res && typeof res.text === 'string' ? res.text : '';
    }

    const task = (async () => {
        let text = '';
        if (restoreRef.source === 'local') {
            text = String(localPayload?.text || '');
            if (!text) throw new Error('Missing local HTML data');
        } else {
            if (!restoreRef.fileUrl) throw new Error('Missing fileUrl');
            const blob = await downloadRemoteFile({ url: restoreRef.fileUrl, source: restoreRef.source });
            text = await blob.text();
        }
        restoreCacheSet(restoreSourceCache.htmlText, cacheKey, { text });
        return { text };
    })();

    restoreSourcePending.htmlText.set(cacheKey, task);
    try {
        const res = await task;
        return res && typeof res.text === 'string' ? res.text : '';
    } finally {
        restoreSourcePending.htmlText.delete(cacheKey);
    }
}

async function extractBookmarkTreeForRestore(restoreRef, localPayload) {
    if (!restoreRef || !restoreRef.sourceType) {
        throw new Error('Missing restoreRef');
    }

    if (restoreRef.sourceType === 'html') {
        const text = await getHtmlTextCached(restoreRef, localPayload);

        if (!text) throw new Error('Empty HTML content');
        const tree = parseNetscapeBookmarkHtmlToTree(text);
        if (!tree || !Array.isArray(tree.children) || tree.children.length === 0) {
            throw new Error('Failed to parse HTML bookmark file');
        }
        return tree;
    }

    if (restoreRef.sourceType === 'zip') {
        const files = await getZipFilesCached(restoreRef, localPayload);
        if (!Array.isArray(files)) throw new Error('Failed to read ZIP content');

        const targetName = restoreRef.zipEntryName;
        let matched = null;

        if (targetName) {
            matched = files.find(f => f?.name === targetName) || null;
        }

        // 兜底：按时间匹配
        if (!matched && restoreRef.recordTime) {
            for (const f of files) {
                if (!f?.name || !f.name.endsWith('.json')) continue;
                try {
                    const data = JSON.parse(f.content);
                    const backupTime = data?._exportInfo?.backupTime || data?.time || null;
                    if (backupTime && String(backupTime) === String(restoreRef.recordTime)) {
                        matched = f;
                        break;
                    }
                } catch (_) { }
            }
        }

        if (!matched) throw new Error('Target version not found in ZIP');

        const data = JSON.parse(matched.content);
        return data?._rawBookmarkTree || data?.bookmarkTree || null;
    }

    if (restoreRef.sourceType === 'json') {
        const records = await getMergedHistoryRecordsCached(restoreRef, localPayload);
        if (!Array.isArray(records)) {
            throw new Error('Merged history format not supported');
        }

        const idx = typeof restoreRef.recordIndex === 'number' ? restoreRef.recordIndex : null;
        let record = null;
        if (idx !== null && records[idx]) {
            record = records[idx];
        }

        if (!record && restoreRef.recordTime) {
            record = records.find(r => {
                const t = r?._exportInfo?.backupTime || r?.exportInfo?.backupTime || r?.export_info?.backupTime || r?.time || null;
                return t && String(t) === String(restoreRef.recordTime);
            }) || null;
        }

        if (!record) throw new Error('Target version not found in merged history');

        return record?._rawBookmarkTree || record?.bookmarkTree || record?.bookmarkTree || null;
    }

    throw new Error(`Unsupported sourceType: ${restoreRef.sourceType}`);
}

function getExportInfoFromHistoryRecord(record) {
    return record?._exportInfo || record?.exportInfo || record?.export_info || null;
}

function getHistoryRecordTimeString(record) {
    const info = getExportInfoFromHistoryRecord(record);
    return info?.backupTime || record?.time || null;
}

function getHistoryRecordSeqNumber(record) {
    const info = getExportInfoFromHistoryRecord(record);
    return info?.seqNumber || record?.seqNumber || null;
}

function getHistoryRecordNote(record) {
    const info = getExportInfoFromHistoryRecord(record);
    return info?.note || record?.note || '';
}

function getHistoryRecordFingerprint(record) {
    const info = getExportInfoFromHistoryRecord(record);
    return info?.fingerprint || record?.fingerprint || '';
}

function getHistoryRecordStats(record) {
    const info = getExportInfoFromHistoryRecord(record);
    return info?.stats || record?.bookmarkStats || record?.stats || null;
}

function getHistoryRecordTree(record) {
    return record?._rawBookmarkTree || record?.bookmarkTree || null;
}

function isHistoryRecordSuccess(record) {
    const info = getExportInfoFromHistoryRecord(record);
    const status = record?.status || info?.status || null;
    if (!status) return true;
    return status === 'success';
}

function findHistoryRecordIndexByRestoreRef(records, restoreRef) {
    if (!Array.isArray(records)) return -1;

    const idx = typeof restoreRef?.recordIndex === 'number' ? restoreRef.recordIndex : null;
    if (idx != null && idx >= 0 && idx < records.length) return idx;

    const recordTime = restoreRef?.recordTime ? String(restoreRef.recordTime) : null;
    if (!recordTime) return -1;

    return records.findIndex(r => {
        const t = getHistoryRecordTimeString(r);
        return t && String(t) === recordTime;
    });
}

function buildChronologicalHistoryRecordList(records) {
    const list = [];
    for (const r of records || []) {
        if (!r) continue;
        const timeStr = getHistoryRecordTimeString(r);
        const tree = getHistoryRecordTree(r);
        if (!timeStr || !tree) continue;

        const timeKey = String(timeStr);
        const timeMs = parseTimeToMs(timeKey) || 0;
        const seqNumber = getHistoryRecordSeqNumber(r);
        const seq = (typeof seqNumber === 'number' && Number.isFinite(seqNumber)) ? seqNumber : null;

        list.push({ record: r, timeStr: timeKey, timeMs, seq });
    }

    list.sort((a, b) => {
        if (a.seq != null && b.seq != null) return a.seq - b.seq;
        return a.timeMs - b.timeMs;
    });

    return list;
}

function findPreviousHistoryRecordChronologically(records, currentTimeStr) {
    const list = buildChronologicalHistoryRecordList(records);
    const key = currentTimeStr != null ? String(currentTimeStr) : '';
    const idx = list.findIndex(item => item.timeStr === key);
    if (idx <= 0) return null;

    for (let i = idx - 1; i >= 0; i--) {
        const record = list[i]?.record;
        if (!record) continue;
        if (isHistoryRecordSuccess(record)) return record;
    }

    return null;
}

async function resolveHistoryViewModeAndExpansion(recordTime, requestedMode) {
    let mode = requestedMode;
    let expandedIds = null;

    try {
        const res = await browserAPI.storage.local.get(['historyViewSettings']);
        const settings = res?.historyViewSettings || null;
        const timeKey = recordTime != null ? String(recordTime) : null;

        if (mode !== 'simple' && mode !== 'detailed') {
            const storedMode = timeKey && settings?.recordModes ? settings.recordModes[timeKey] : null;
            const defaultMode = settings?.defaultMode || null;
            mode = storedMode || defaultMode || 'simple';
        }

        if (mode !== 'simple' && mode !== 'detailed') mode = 'simple';

        if (mode === 'detailed' && timeKey) {
            const ids = settings?.recordExpandedStates ? settings.recordExpandedStates[timeKey] : null;
            if (Array.isArray(ids) && ids.length > 0) {
                expandedIds = new Set(ids.map(id => String(id)));
            }
        }
    } catch (_) {
        if (mode !== 'simple' && mode !== 'detailed') mode = 'simple';
    }

    return { mode, expandedIds };
}

function buildHistoryChangesViewTree(bookmarkTree, changeMap, options = {}) {
    const mode = options?.mode === 'detailed' ? 'detailed' : 'simple';
    const expandedIds = options?.expandedIds instanceof Set ? options.expandedIds : null;
    const useWysiwygExpansion = mode === 'detailed' && expandedIds && expandedIds.size > 0;

    const safeTitle = (t) => {
        const title = String(t || '').trim();
        return title ? title : '(Untitled)';
    };

    const hasChangesRecursive = (node) => {
        if (!node) return false;
        if (node.id && changeMap && changeMap.has(node.id)) return true;
        if (Array.isArray(node.children)) {
            return node.children.some(child => hasChangesRecursive(child));
        }
        return false;
    };

    const getPrefixForChange = (change) => {
        if (!change || !change.type) return '';
        const types = String(change.type).split('+');
        if (types.includes('added')) return '[+] ';
        if (types.includes('deleted')) return '[-] ';
        if (types.includes('modified') && types.includes('moved')) return '[~↔] ';
        if (types.includes('modified')) return '[~] ';
        if (types.includes('moved')) return '[↔] ';
        return '';
    };

    const extractTree = (node) => {
        if (!node) return null;

        const nodeHasChanges = hasChangesRecursive(node);
        if (mode !== 'detailed' && !nodeHasChanges) return null;

        const title = safeTitle(node.title);
        const url = node.url || '';
        const isFolder = !url && Array.isArray(node.children);

        const change = node.id ? changeMap.get(node.id) : null;
        const changeType = (change && change.type) ? String(change.type) : '';
        const prefix = getPrefixForChange(change);

        const item = {
            title: prefix + title,
            ...(changeType ? { changeType } : {})
        };

        if (url) {
            item.url = url;
            item.type = 'bookmark';
            return item;
        }

        if (isFolder) {
            item.type = 'folder';
            let shouldRecurse = false;
            if (mode === 'detailed') {
                shouldRecurse = useWysiwygExpansion ? expandedIds.has(String(node.id)) : nodeHasChanges;
            } else {
                shouldRecurse = true;
            }

            if (shouldRecurse) {
                item.children = node.children
                    .map(child => extractTree(child))
                    .filter(Boolean);
            } else {
                item.children = [];
            }
        }

        return item;
    };

    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    const children = [];
    nodes.forEach(node => {
        if (!node || !Array.isArray(node.children)) return;
        node.children.forEach(child => {
            const extracted = extractTree(child);
            if (extracted) children.push(extracted);
        });
    });

    return { title: 'root', children };
}

async function extractHistoryChangesViewTreeForRestore(restoreRef, localPayload, options = {}) {
    const sourceType = restoreRef?.sourceType;
    if (sourceType !== 'json' && sourceType !== 'zip') {
        throw new Error(`Changes view is only supported for history sources (json/zip), got: ${sourceType}`);
    }

    let records = [];
    let currentRecord = null;

    if (sourceType === 'json') {
        let text = '';
        if (restoreRef.source === 'local') {
            text = String(localPayload?.text || '');
        } else {
            if (!restoreRef.fileUrl) throw new Error('Missing fileUrl');
            const blob = await downloadRemoteFile({ url: restoreRef.fileUrl, source: restoreRef.source });
            text = await blob.text();
        }

        const parsed = JSON.parse(text);
        const rawRecords = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.records) ? parsed.records : []);
        if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
            throw new Error('Merged history format not supported');
        }

        const idx = findHistoryRecordIndexByRestoreRef(rawRecords, restoreRef);
        if (idx < 0 || !rawRecords[idx]) throw new Error('Target history record not found in merged JSON');

        records = rawRecords;
        currentRecord = rawRecords[idx];
    } else {
        // zip
        let zipBlob;
        if (restoreRef.source === 'local') {
            const ab = localPayload?.arrayBuffer;
            if (!ab) throw new Error('Missing local ZIP data');
            zipBlob = new Blob([ab], { type: 'application/zip' });
        } else {
            if (!restoreRef.fileUrl) throw new Error('Missing fileUrl');
            zipBlob = await downloadRemoteFile({ url: restoreRef.fileUrl, source: restoreRef.source });
        }

        const files = await unzipStore(zipBlob);
        const parsedRecords = [];

        for (const f of files) {
            if (!f?.name || !f.name.endsWith('.json')) continue;
            try {
                const data = JSON.parse(f.content);
                const timeStr = getHistoryRecordTimeString(data);
                const tree = getHistoryRecordTree(data);
                if (!timeStr || !tree) continue;
                parsedRecords.push({ data, zipEntryName: f.name, timeStr: String(timeStr) });
            } catch (_) { }
        }

        if (parsedRecords.length === 0) throw new Error('No valid history records found in ZIP');

        // Find current record
        let idx = -1;
        if (restoreRef.zipEntryName) {
            idx = parsedRecords.findIndex(r => r.zipEntryName === restoreRef.zipEntryName);
        }
        if (idx < 0 && restoreRef.recordTime) {
            const key = String(restoreRef.recordTime);
            idx = parsedRecords.findIndex(r => r.timeStr === key);
        }
        if (idx < 0) throw new Error('Target history record not found in ZIP');

        records = parsedRecords.map(r => r.data);
        currentRecord = parsedRecords[idx].data;
    }

    const recordTime = getHistoryRecordTimeString(currentRecord) || restoreRef.recordTime || null;
    if (!recordTime) throw new Error('Selected record has no recordTime');

    const previousRecord = findPreviousHistoryRecordChronologically(records, recordTime);

    const currentTree = getHistoryRecordTree(currentRecord);
    if (!currentTree) throw new Error('Selected history record has no bookmark tree');

    const prevTree = previousRecord ? getHistoryRecordTree(previousRecord) : null;

    let treeToExport = currentTree;
    let changeMap = new Map();

    if (prevTree) {
        const stats = getHistoryRecordStats(currentRecord) || {};
        const explicitMovedIdSet = Array.isArray(stats.explicitMovedIds) ? stats.explicitMovedIds : null;

        changeMap = detectTreeChangesFastBg(prevTree, currentTree, {
            explicitMovedIdSet
        });

        let hasDeleted = false;
        for (const [, change] of changeMap) {
            if (change?.type && String(change.type).includes('deleted')) {
                hasDeleted = true;
                break;
            }
        }
        if (hasDeleted) {
            try {
                treeToExport = rebuildTreeWithDeletedBg(prevTree, currentTree, changeMap);
            } catch (_) {
                treeToExport = currentTree;
            }
        }
    } else {
        const allNodes = flattenBookmarkTreeBg(currentTree);
        allNodes.forEach(item => {
            if (item.id) changeMap.set(item.id, { type: 'added' });
        });
    }

    const { mode, expandedIds } = await resolveHistoryViewModeAndExpansion(recordTime, options.viewMode);
    const tree = buildHistoryChangesViewTree(treeToExport, changeMap, { mode, expandedIds });

    const meta = {
        recordTime: String(recordTime),
        seqNumber: getHistoryRecordSeqNumber(currentRecord),
        note: getHistoryRecordNote(currentRecord),
        fingerprint: getHistoryRecordFingerprint(currentRecord)
    };

    return { tree, viewMode: mode, meta };
}

async function restoreSelectedVersion({ restoreRef, strategy, localPayload, mergeViewMode, manualMatches, importParentId }) {
    try {
        isBookmarkRestoring = true;
        try {
            await browserAPI.storage.local.set({ bookmarkRestoringFlag: true });
        } catch (_) { }

        if (strategy === 'patch') {
            return { success: false, error: 'Patch merge is not available in this restore flow.' };
        }

        try {
            const preRestoreTree = await browserAPI.bookmarks.getTree();
            if (isBookmarkTreeShapeValid(preRestoreTree)) {
                await browserAPI.storage.local.set({
                    restoreBaselineSnapshot: {
                        bookmarkTree: preRestoreTree,
                        capturedAt: Date.now(),
                        capturedAtIso: new Date().toISOString(),
                        source: 'restoreSelectedVersion'
                    }
                });
            }
        } catch (baselineError) {
            console.warn('[restoreSelectedVersion] 捕获恢复前基线失败:', baselineError);
        }

        let tree = null;
        let mergeOptions = null;

        // Merge（导入合并）：对于备份历史（json/zip），默认导入“差异视图”；HTML 快照则导入快照。
        if (strategy === 'merge' && (restoreRef?.sourceType === 'json' || restoreRef?.sourceType === 'zip')) {
            const viewMode = (mergeViewMode === 'simple' || mergeViewMode === 'detailed') ? mergeViewMode : null;
            const extracted = await extractHistoryChangesViewTreeForRestore(restoreRef, localPayload, { viewMode });
            tree = extracted.tree;
            mergeOptions = {
                importKind: 'changes',
                viewMode: extracted.viewMode,
                meta: extracted.meta,
                importParentId: importParentId || null
            };
        } else {
            tree = await extractBookmarkTreeForRestore(restoreRef, localPayload);
            if (strategy === 'merge') {
                mergeOptions = { importKind: 'snapshot', importParentId: importParentId || null };
            }
        }

        if (!tree) {
            return { success: false, error: 'No bookmark tree data found for selected version' };
        }

        const lang = await getCurrentLang();

        if (!hasBookmarkTreeContent(tree)) {
            if (strategy === 'merge') {
                return { success: false, error: buildEmptySnapshotError(lang, 'merge') };
            }

            const currentCount = await getCurrentRestorableNodeCount();
            if (currentCount > 0) {
                return { success: false, error: buildEmptySnapshotError(lang, 'overwrite') };
            }

            return {
                success: true,
                strategy: 'overwrite',
                created: 0,
                skipped: true,
                message: buildEmptySnapshotNoopMessage(lang, 'overwrite')
            };
        }

        assertBookmarkTreeContent(tree, lang, strategy === 'merge' ? 'merge' : 'overwrite');

        if (strategy === 'overwrite') {
            const result = await executeOverwriteBookmarkRestore(tree);

            // Restore should be treated as “initialized” (equivalent to first backup)
            await browserAPI.storage.local.set({ initialized: true });

            return { success: true, strategy: 'overwrite', ...result };
        }

        const result = await executeMergeBookmarkRestore(tree, mergeOptions);

        // Restore should be treated as “initialized” (equivalent to first backup)
        await browserAPI.storage.local.set({ initialized: true });

        return { success: true, strategy: 'merge', ...result };
    } catch (e) {
        try {
            await browserAPI.storage.local.remove(['restoreBaselineSnapshot']);
        } catch (_) { }
        console.error('[restoreSelectedVersion] Failed:', e);
        return { success: false, error: e.message };
    } finally {
        isBookmarkRestoring = false;
        try {
            await browserAPI.storage.local.set({ bookmarkRestoringFlag: false });
        } catch (_) { }
    }
}

// [New] Overwrite preview data builder (Current Browser -> Selected Snapshot)
// Returns { diffSummary, currentTree, targetTree, changeEntries }
async function buildOverwriteRestorePreview({ restoreRef, localPayload }) {
    try {
        if (!restoreRef) {
            return { success: false, error: 'Missing restoreRef' };
        }

        const tree = await extractBookmarkTreeForRestore(restoreRef, localPayload);
        if (!tree) {
            return { success: false, error: 'No bookmark tree data found for selected version' };
        }

        const { bookmarkBar, otherBookmarks } = await findBookmarkContainers();
        const referenceRootIds = (bookmarkBar && otherBookmarks)
            ? [String(bookmarkBar.id), String(otherBookmarks.id)]
            : ['1', '2'];

        const currentTree = await browserAPI.bookmarks.getTree();

        let targetTree = tree;
        try {
            targetTree = JSON.parse(JSON.stringify(tree));
        } catch (_) { }

        ensureRestoreTreeIds(targetTree);

        // Normalize IDs for better diff readability.
        try {
            normalizeTreeIds(targetTree, currentTree, {
                referenceRootIds,
                strictGlobalUrlMatch: true
            });
        } catch (_) { }

        ensureRestoreTreeIds(targetTree);

        const diffSummary = computeBookmarkGitDiffSummary(currentTree, targetTree);
        const changeMap = detectTreeChangesFastBg(currentTree, targetTree, { explicitMovedIdSet: null });
        const changeEntries = Array.from(changeMap.entries()).map(([id, change]) => [String(id), change]);

        return {
            success: true,
            diffSummary,
            currentTree,
            targetTree,
            changeEntries
        };
    } catch (e) {
        console.error('[buildOverwriteRestorePreview] Failed:', e);
        return { success: false, error: e.message };
    }
}

// [New] Lightweight diff summary (Current Browser -> Selected Version)
// Returns { diffSummary } only (no trees) for restore list display.
async function computeRestoreDiffSummaryAgainstCurrent({ restoreRef, localPayload }) {
    try {
        if (!restoreRef) {
            return { success: false, error: 'Missing restoreRef' };
        }

        const tree = await extractBookmarkTreeForRestore(restoreRef, localPayload);
        if (!tree) {
            return { success: false, error: 'No bookmark tree data found for selected version' };
        }

        const { bookmarkBar, otherBookmarks } = await findBookmarkContainers();
        const referenceRootIds = (bookmarkBar && otherBookmarks)
            ? [String(bookmarkBar.id), String(otherBookmarks.id)]
            : ['1', '2'];

        const currentTree = await browserAPI.bookmarks.getTree();

        let targetTree = tree;
        try {
            targetTree = JSON.parse(JSON.stringify(tree));
        } catch (_) { }

        ensureRestoreTreeIds(targetTree);

        try {
            normalizeTreeIds(targetTree, currentTree, {
                referenceRootIds,
                strictGlobalUrlMatch: true
            });
        } catch (_) { }

        ensureRestoreTreeIds(targetTree);

        const diffSummary = computeBookmarkGitDiffSummary(currentTree, targetTree);
        return { success: true, diffSummary };
    } catch (e) {
        console.error('[computeRestoreDiffSummaryAgainstCurrent] Failed:', e);
        return { success: false, error: e.message };
    }
}

// [New] Import-merge preview data builder (Previous Backup -> This Backup "changes view")
// Returns { tree, viewMode, meta }
async function buildMergeRestorePreview({ restoreRef, localPayload, mergeViewMode }) {
    try {
        if (!restoreRef) {
            return { success: false, error: 'Missing restoreRef' };
        }

        const viewMode = (mergeViewMode === 'simple' || mergeViewMode === 'detailed') ? mergeViewMode : null;
        const extracted = await extractHistoryChangesViewTreeForRestore(restoreRef, localPayload, { viewMode });
        return {
            success: true,
            tree: extracted.tree,
            viewMode: extracted.viewMode,
            meta: extracted.meta
        };
    } catch (e) {
        console.error('[buildMergeRestorePreview] Failed:', e);
        return { success: false, error: e.message };
    }
}

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

    // 活跃时间追踪已剔除

    if (details.reason === 'install') {
        // browserAPI.tabs.create({ url: 'welcome.html' });
    } else if (details.reason === 'update') {
        const previousVersion = details.previousVersion;
    }
});

// =================================================================================
// IX. 顶层初始化：活跃时间追踪/点击记录已剔除
// =================================================================================
