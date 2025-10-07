// 在文件顶部添加全局错误处理，捕获并忽略特定的连接错误
self.addEventListener('unhandledrejection', function(event) {
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

// 浏览器兼容性处理
const browserAPI = (function() {
    if (typeof chrome !== 'undefined') {
        if (typeof browser !== 'undefined') {
            // Firefox
            return browser;
        }
        // Chrome, Edge
        return chrome;
    }
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
        }
    });
}

// 初始化操作状态跟踪
function initializeOperationTracking() {
    // 监听书签移动事件
    browserAPI.bookmarks.onMoved.addListener((id, moveInfo) => {
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
            }
        });
    });

    // 监听书签修改事件
    browserAPI.bookmarks.onChanged.addListener((id, changeInfo) => {
// 确定被修改的是书签还是文件夹
        browserAPI.bookmarks.get(id, (nodes) => {
            if (nodes && nodes.length > 0) {
                const node = nodes[0];
                if (node.url) {
                    // 是书签
                    bookmarkModified = true;
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
// 查询由本扩展创建的书签相关下载（最近500项）
        const bookmarkDownloads = await new Promise(resolve => {
            browserAPI.downloads.search({
                limit: 500,
                orderBy: ['-startTime']
            }, items => {
                resolve(items.filter(item => {
                    // 使用更准确的条件识别书签备份下载
                    if (!item.filename) return false;
                    
                    // 检查是否为书签备份文件 - 简化识别逻辑
                    return (
                        // 1. 路径中包含Bookmarks目录
                        item.filename.includes('/Bookmarks/') ||
                        // 2. 路径中包含Bookmarks_History目录
                        item.filename.includes('/Bookmarks_History/') ||
                        // 3. 数据URL方式的HTML内容
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

        // 使用更准确的条件识别书签备份下载 - 简化识别逻辑
        const isBookmarkDownload = downloadItem.filename && (
            // 1. 路径中包含Bookmarks目录
            downloadItem.filename.includes('/Bookmarks/') ||
            // 2. 路径中包含Bookmarks_History目录
            downloadItem.filename.includes('/Bookmarks_History/') ||
            // 3. 数据URL方式的HTML内容
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

// 监听来自popup的消息
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
// 基础校验
    if (!message || typeof message !== 'object' || !message.action) {
        sendResponse({ success: false, error: '无效的消息格式' });
        return;
    }

    try {
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

                    // 如果从自动模式切换到手动模式，需要重置操作状态并更新角标
                    if (!newAutoSyncState) {
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
                        
                        // 获取当前语言设置
                        const { preferredLang = 'zh_CN' } = await browserAPI.storage.local.get(['preferredLang']);
                        
                        // 手动模式下，停止自动备份定时器并强制设置角标为蓝色
                        if (autoBackupTimerRunning) {
                            try {
                                await stopAutoBackupTimerSystem();
                                autoBackupTimerRunning = false;
                            } catch (error) {
                                console.error('[自动备份定时器] 切换到手动模式时停止定时器失败:', error);
                            }
                        }
                        const badgeText = badgeTextMap.manual[preferredLang] || badgeTextMap.manual.en;
                        await browserAPI.action.setBadgeText({ text: badgeText });
                        await browserAPI.action.setBadgeBackgroundColor({ color: '#0000FF' }); // 蓝色
                        await browserAPI.storage.local.set({ isYellowHandActive: false });
} else {
                        // 切换到自动模式：由 setBadge 根据是否有变化决定是否启动定时器
                        // 使用正常的setBadge（会自动检查变化并启动/停止定时器）
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

                    // 构建WebDAV路径
                    const serverAddress = config.serverAddress.replace(/\/+$/, '/');
                    const folderPath = 'Bookmarks_History/'; // 使用专门的文件夹存放历史记录
                    const fullUrl = `${serverAddress}${folderPath}${fileName}`;
                    const folderUrl = `${serverAddress}${folderPath}`;

                    // 认证头
                    const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

                    // 检查文件夹是否存在
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

                    // 执行下载
const downloadId = await new Promise((resolve, reject) => {
                        browserAPI.downloads.download({
                            url: dataUrl,
                            filename: 'Bookmarks_History/' + fileName,
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

        } else if (message.action === "initSync") {
if (message.direction === "upload") {
                // 上传本地书签到云端/本地
                browserAPI.bookmarks.getTree()
                    .then(async (bookmarks) => {
                        try {
let webDAVSuccess = false;
                            let localSuccess = false;
                            let errors = [];

                            // 添加结果对象用于存储过程信息
                            const result = {
                                localFileName: null
                            };

                            // 添加errorMessages数组用于收集错误信息
                            const errorMessages = [];

                            // 检查WebDAV配置
                            const webDAVconfig = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']);
                            const webDAVConfigured = webDAVconfig.serverAddress && webDAVconfig.username && webDAVconfig.password;
                            const webDAVEnabled = webDAVconfig.webDAVEnabled !== false;

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
                            if (webDAVSuccess && localSuccess) {
                                syncDirection = 'both';
                            } else if (webDAVSuccess) {
                                syncDirection = 'webdav';
                            } else if (localSuccess) {
                                syncDirection = 'local';
                            }

                            // 添加首次上传记录
                            const syncTime = new Date().toISOString();
                            const syncStatus = (webDAVSuccess || localSuccess) ? 'success' : 'error';
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
                                success: (webDAVSuccess || localSuccess),
                                webDAVSuccess,
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
sendResponse({success: true, message: "主UI窗口已打开，将自动打开手动备份动态提醒设置"});
                });
            } catch (error) {
sendResponse({success: false, error: error.message || "处理请求失败"});
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
            try {
                // 创建一个临时的input元素用于选择文件夹
                const input = document.createElement('input');
                input.type = 'file';
                input.webkitdirectory = true; // 支持选择文件夹
                input.directory = true; // Firefox支持

                // 添加change事件监听器
                input.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        try {
                            // 尝试获取选择的文件夹路径
                            const file = e.target.files[0];
                            let dirPath = '';

                            // 尝试不同的方法获取路径
                            if (file.path) {
                                // Chrome支持的path属性
                                dirPath = file.path.substring(0, file.path.lastIndexOf('/') + 1);
                            } else if (file.webkitRelativePath) {
                                // WebKit浏览器支持的相对路径
                                const parts = file.webkitRelativePath.split('/');
                                dirPath = parts[0]; // 只取文件夹名称
                            } else {
                                // 仅使用名称作为路径（不理想但是可以作为后备）
                                const parent = file.name.substring(0, file.name.lastIndexOf('/'));
                                dirPath = parent || file.name;
                            }

                            // 返回成功结果
                            sendResponse({
                                success: true,
                                path: dirPath
                            });
                        } catch (error) {
sendResponse({
                                success: false,
                                error: '获取文件夹路径时出错: ' + error.message
                            });
                        }
                    } else {
                        // 未选择任何文件
                        sendResponse({
                            success: false,
                            error: '未选择文件夹'
                        });
                    }
                });

                // 处理可能的取消操作
                window.setTimeout(() => {
                    if (!input.files || input.files.length === 0) {
                        sendResponse({
                            success: false,
                            error: '未选择文件夹或操作已取消'
                        });
                    }
                }, 10000); // 10秒超时

                // 触发点击事件，打开文件选择对话框
                input.click();

            } catch (error) {
sendResponse({
                    success: false,
                    error: '打开文件夹选择对话框时出错: ' + error.message
                });
            }

            // 返回true表示将异步发送响应
            return true;
        } else if (message.action === "getDownloadPath") {
            // 直接返回估计的下载路径，不尝试在chrome://页面执行脚本
            fallbackToEstimatedPath();
            return true;

            // 如果无法从页面获取，返回估计的路径
            function fallbackToEstimatedPath() {
                // 估计默认下载路径
                let defaultPath = '';
                const isWindows = navigator.platform.indexOf('Win') > -1;
                const isMac = navigator.platform.indexOf('Mac') > -1;
                const isLinux = navigator.platform.indexOf('Linux') > -1;

                if (isWindows) {
                    defaultPath = 'C:\\Users\\<username>\\Downloads\\Bookmarks\\';
                } else if (isMac) {
                    defaultPath = '/Users/<username>/Downloads/Bookmarks/';
                } else if (isLinux) {
                    defaultPath = '/home/<username>/Downloads/Bookmarks/';
                } else {
                    defaultPath = '您浏览器的默认下载文件夹/Bookmarks/';
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
                // 方法1：直接尝试打开chrome URL
                browserAPI.tabs.create({ url: 'chrome://settings/downloads' }, function(tab) {
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
            browserAPI.storage.local.get(['syncHistory'], (data) => {
                // 不再保留最后一条记录，直接设置为空数组
                const newHistory = [];

                browserAPI.storage.local.set({ syncHistory: newHistory }, () => {
                    sendResponse({ success: true });
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

// 处理书签变化的函数
async function handleBookmarkChange() {
    if (bookmarkChangeTimeout) {
        clearTimeout(bookmarkChangeTimeout);
    }

    bookmarkChangeTimeout = setTimeout(async () => {
        try {
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

            // 更新角标（无论模式如何）
            await setBadge(); // 使用新的不带参数的setBadge
// 异步更新缓存，不阻塞当前流程
            updateAndCacheAnalysis();

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

            // 仅在自动备份模式且备份模式为“实时”时才立即触发自动备份
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
            } else {
// 手动模式或常规/特定时间模式下书签变化，直接更新角标状态（如变为黄色）
                await setBadge();
            }
        } catch (error) {
}
    }, 500); // 延迟500毫秒，合并短时间内的多次变化
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
    const folderPath = 'Bookmarks/';
    // 获取当前日期和时间作为文件名，精确到秒
    const currentDate = new Date();
    const fileName = `${currentDate.getFullYear()}${(currentDate.getMonth() + 1).toString().padStart(2, '0')}${currentDate.getDate().toString().padStart(2, '0')}_${currentDate.getHours().toString().padStart(2, '0')}${currentDate.getMinutes().toString().padStart(2, '0')}${currentDate.getSeconds().toString().padStart(2, '0')}.html`;
    const fullUrl = `${serverAddress}${folderPath}${fileName}`;
    const folderUrl = `${serverAddress}${folderPath}`;

    const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

    try {
        // 检查文件夹是否存在
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

        // 构建完整的 WebDAV URL
        const folderPath = '/bookmarks/';
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
                // 使用downloads API直接保存到默认下载位置
                const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);

                const downloadId = await new Promise((resolve, reject) => {
                    browserAPI.downloads.download({
                        url: dataUrl,
                        filename: 'Bookmarks/' + fileName,
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

        // 兼容旧版本
        if (oldConfigEnabled) {
            const folderPath = config.localBackupPath.endsWith('/') ? config.localBackupPath : config.localBackupPath + '/';
            const fullPath = folderPath + 'Bookmarks/' + fileName;

            // 创建文件夹（如果不存在）
            await ensureDirectoryExists(folderPath + 'Bookmarks/');

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

// 写入文件
function writeFile(filePath, content) {
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
                        func: (content, fileName) => {
                            // 这段代码会在content script环境中执行
                            const blob = new Blob([content], {type: 'text/html'});
                            const url = URL.createObjectURL(blob);

                            // 创建下载链接并模拟点击
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = fileName;
                            document.body.appendChild(a);
                            a.click();

                            // 清理
                            setTimeout(() => {
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                            }, 100);

                            return true;
                        },
                        args: [content, 'Bookmarks/' + fileName]
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

            // 使用data:URL方法的辅助函数
            function useDataUrlMethod() {
                try {
                    // 创建data:URL
                    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(content);

                    // 使用下载API下载文件
                    browserAPI.downloads.download({
                        url: dataUrl,
                        filename: 'Bookmarks/' + fileName,
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
                bookmarkCount: "Bookmarks",
                folderCount: "Folders",
                bookmarkChange: "Bookmark Change",
                folderChange: "Folder Change",
                structureChange: "Structural Changes",
                location: "Location",
                type: "Type",
                status: "Status/Error"
            },
            structureChangeValues: { yes: "Yes", no: "No" },
            locationValues: { local: "Local", cloud: "Cloud", webdav: "Cloud", both: "Cloud & Local", none: "None", upload: "Cloud", download: "Local" },
            typeValues: { auto: "Auto", manual: "Manual", auto_switch: "Switch", migration:"Migration", check:"Check" },
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
                bookmarkCount: "书签数",
                folderCount: "文件夹数",
                bookmarkChange: "书签变化",
                folderChange: "文件夹变化",
                structureChange: "结构变动",
                location: "位置",
                type: "类型",
                status: "状态/错误"
            },
            structureChangeValues: { yes: "是", no: "否" },
            locationValues: { local: "本地", cloud: "云端", webdav: "云端", both: "云端与本地", none: "无", upload: "云端", download: "本地" },
            typeValues: { auto: "自动", manual: "手动", auto_switch: "切换", migration:"迁移", check:"检查" },
            statusValues: { success: "成功", error: "错误", locked: "文件锁定", no_backup_needed: "无需备份", check_completed: "检查完成" },
            filenameBase: "书签备份历史记录",
            na: "无"
        }
    };

    const t = i18n[lang] || i18n.zh_CN;

    let txtContent = t.exportTitle + "\n\n";
    txtContent += t.exportNote + "\n\n";

    txtContent += `| ${t.tableHeaders.timestamp} | ${t.tableHeaders.bookmarkCount} | ${t.tableHeaders.folderCount} | ${t.tableHeaders.bookmarkChange} | ${t.tableHeaders.folderChange} | ${t.tableHeaders.structureChange} | ${t.tableHeaders.location} | ${t.tableHeaders.type} | ${t.tableHeaders.status} |\n`;
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

    const formatDiff = (diff) => {
        if (diff === undefined || diff === null || Number.isNaN(Number(diff))) return '0';
        const val = Number(diff);
        return val > 0 ? `+${val}` : `${val}`;
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
            
            // 添加简洁的分界线，并入表格中
            txtContent += `| ${formattedPreviousDate} |  |  |  |  |  |  |  |  |\n`;
        }
        
        // 更新前一个日期
        previousDateStr = currentDateStr;
        
        const currentBookmarks = record.bookmarkStats?.currentBookmarkCount ?? record.bookmarkStats?.currentBookmarks ?? t.na;
        const currentFolders = record.bookmarkStats?.currentFolderCount ?? record.bookmarkStats?.currentFolders ?? t.na;
        const bookmarkDiff = record.bookmarkStats?.bookmarkDiff;
        const folderDiff = record.bookmarkStats?.folderDiff;
        const bookmarkDiffFormatted = formatDiff(bookmarkDiff);
        const folderDiffFormatted = formatDiff(folderDiff);
        const structuralChanges = (record.bookmarkStats?.bookmarkMoved || record.bookmarkStats?.folderMoved || record.bookmarkStats?.bookmarkModified || record.bookmarkStats?.folderModified) ? t.structureChangeValues.yes : t.structureChangeValues.no;
        const recordDirection = record.direction?.toLowerCase() || 'none';
        const locationText = t.locationValues[recordDirection] || t.locationValues.none;
        const recordTypeKey = record.type?.toLowerCase();
        const typeText = t.typeValues[recordTypeKey] || recordTypeKey;
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
        txtContent += `| ${time} | ${currentBookmarks} | ${currentFolders} | ${bookmarkDiffFormatted} | ${folderDiffFormatted} | ${structuralChanges} | ${locationText} | ${typeText} | ${statusText} |\n`;
    }

    // 添加最后一个日期的分界线
    if (previousDateStr) {
        const formattedPreviousDate = lang === 'en' ? 
                    `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
                    `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;
        
        // 添加简洁的分界线，并入表格中
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

    // WebDAV导出
    if (webDAVConfigured && webDAVEnabled) {
        try {
const serverAddress = config.serverAddress.replace(/\/+$/, '/');
            const folderPath = 'Bookmarks_History/'; // 使用专门的文件夹存放历史记录
            const fullUrl = `${serverAddress}${folderPath}${fileName}`;
            const folderUrl = `${serverAddress}${folderPath}`;

            const authHeader = 'Basic ' + safeBase64(`${config.username}:${config.password}`);

            // 检查文件夹是否存在
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

            // 确保文件夹存在（注意：使用斜杠而非下划线来指示文件夹）
const downloadId = await new Promise((resolve, reject) => {
                browserAPI.downloads.download({
                    url: dataUrl,
                    filename: 'Bookmarks_History/' + fileName,
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

        // 检查WebDAV配置
        const webDAVconfig = await browserAPI.storage.local.get(['serverAddress', 'username', 'password', 'webDAVEnabled']);
        const webDAVConfigured = webDAVconfig.serverAddress && webDAVconfig.username && webDAVconfig.password;
        const webDAVEnabled = webDAVconfig.webDAVEnabled !== false;

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
        const hasAtLeastOneConfigured = (webDAVConfigured && webDAVEnabled) || localBackupConfigured;

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
        } else if ((direction === 'upload' || direction === 'download') && !localBackupConfigured) { // This was the original logic
            errorMessages.push('WebDAV未配置或未启用');
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

        if (webDAVSuccess || localSuccess) { // 只要有一个成功就算成功
            syncStatus = 'success';
            syncSuccess = true;
            // 更精确的方向判断 (original logic for this part)
            if (webDAVSuccess && localSuccess) syncDirection = 'both';
            else if (webDAVSuccess) syncDirection = 'webdav';
            else syncDirection = 'local'; // This was the original simplified assignment
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
            } catch (updateError) {
                console.error('[syncBookmarks] 更新角标和缓存失败:', updateError);
            }
        }

        return {
            success: syncSuccess,
            webDAVSuccess,
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
async function resetAllData() {
    try {
// 记录要删除的初始备份记录信息（用于日志调试）
        const initialBackupRecord = await browserAPI.storage.local.get(['initialBackupRecord']);
        if (initialBackupRecord && initialBackupRecord.initialBackupRecord) {
}

        // 1. 完全清除所有存储的数据，不保留任何信息
        await browserAPI.storage.local.clear();
// 2. 清除所有定时器
        await browserAPI.alarms.clearAll();
// 3. 重置角标到初始状态（不显示）
        await browserAPI.action.setBadgeText({ text: '' });
// 4. 恢复到初始状态
// 5. 重新执行初始化流程，模拟首次安装
await initializeLanguagePreference();
        await initializeAutoSync();
        await initializeBadge();
return true;
    } catch (error) {
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
        const { syncHistory = [], lastBookmarkData = null, lastSyncOperations = {}, preferredLang = 'zh_CN' } = await browserAPI.storage.local.get([
            'syncHistory',
            'lastBookmarkData',
            'lastSyncOperations',
            'preferredLang'
        ]);

        // 计算书签操作统计
        let bookmarkStats = null;
        let bookmarkDiff = 0; // 初始化 diff 变量
        let folderDiff = 0;

        if (status === 'success' && (direction === 'upload' || direction === 'download' || direction === 'webdav' || direction === 'local' || direction === 'both')) {
            const localBookmarks = await new Promise((resolve) => {
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

            bookmarkStats = {
                currentBookmarkCount: currentBookmarkCount,
                currentFolderCount: currentFolderCount,
                prevBookmarkCount: prevBookmarkCount,
                prevFolderCount: prevFolderCount,
                bookmarkDiff: bookmarkDiff,
                folderDiff: folderDiff,
                bookmarkMoved: lastSyncOperations.bookmarkMoved || bookmarkMoved,
                folderMoved: lastSyncOperations.folderMoved || folderMoved,
                bookmarkModified: lastSyncOperations.bookmarkModified || bookmarkModified,
                folderModified: lastSyncOperations.folderModified || folderModified
            };

            // 生成当前书签指纹（使用已经声明的 localBookmarks 变量）
            const currentPrints = generateFingerprints(localBookmarks);
            
            await browserAPI.storage.local.set({
                lastBookmarkData: {
                    bookmarkCount: currentBookmarkCount,
                    folderCount: currentFolderCount,
                    bookmarkPrints: currentPrints.bookmarks,
                    folderPrints: currentPrints.folders,
                    timestamp: time
                }
            });

            resetOperationStatus();
            
            // 备份成功后，差异应该重置为 0（因为 lastBookmarkData 已经更新为当前值）
            bookmarkDiff = 0;
            folderDiff = 0;
        }

        const newSyncRecord = {
            time: time,
            direction: direction,
            type: syncType, // 存储键值: 'auto', 'manual', 'auto_switch'
            status: status,
            errorMessage: errorMessage,
            bookmarkStats: bookmarkStats,
            isFirstBackup: !syncHistory || syncHistory.length === 0,
            note: autoBackupReason || '' // 添加备注字段
        };

        let currentSyncHistory = [...syncHistory, newSyncRecord];
        let historyToStore = currentSyncHistory;

        if (currentSyncHistory.length >= 100) {
            const recordsToExport = currentSyncHistory.slice(0, 100);
            historyToStore = currentSyncHistory.slice(100); // 保留最早100条记录之后的部分

            // 异步导出，不阻塞主流程
            exportHistoryToTxt(recordsToExport, preferredLang)
                .then(() => console.log("历史记录 TXT 导出已启动。"))
                .catch(err => console.error("历史记录 TXT 导出启动失败:", err));
        }

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
            (direction === 'upload' || direction === 'webdav' || direction === 'local' || direction === 'both')) {
            updateData.lastBookmarkUpdate = time;
        }

        await browserAPI.storage.local.set(updateData);

        const isInitSync = (!syncHistory || syncHistory.length === 0) && newSyncRecord.isFirstBackup; // More precise check for initial sync completion effect
        if (isInitSync && status === 'success' && (direction === 'upload' || direction === 'webdav' || direction === 'local' || direction === 'both')) {
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
                    if (stats.stats.bookmarkDiff !== 0 || 
                        stats.stats.folderDiff !== 0 || 
                        stats.stats.bookmarkMoved || 
                        stats.stats.bookmarkModified || 
                        stats.stats.folderMoved || 
                        stats.stats.folderModified) {
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
                if (stats.stats.bookmarkDiff !== 0 || stats.stats.folderDiff !== 0 || stats.stats.bookmarkMoved || stats.stats.bookmarkModified || stats.stats.folderMoved || stats.stats.folderModified) {
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
            const hasChanges = (stats.stats.bookmarkDiff !== 0) ||
                               (stats.stats.folderDiff !== 0) ||
                               stats.stats.bookmarkMoved ||
                               stats.stats.folderMoved ||
                               stats.stats.bookmarkModified ||
                               stats.stats.folderModified;

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
 * 分析当前书签状态与上次备份的差异，返回详细的变更对象。
 * 这是变化检测的核心函数。
 * @returns {Promise<object>}
 */
async function analyzeBookmarkChanges() {
    const { lastBookmarkData, lastSyncOperations } = await browserAPI.storage.local.get(['lastBookmarkData', 'lastSyncOperations']);

    console.log('[analyzeBookmarkChanges] lastBookmarkData:', lastBookmarkData);
    console.log('[analyzeBookmarkChanges] lastSyncOperations:', lastSyncOperations);

    // 获取当前书签和文件夹总数
    const currentCounts = await getCurrentBookmarkCountsInternal();
    console.log('[analyzeBookmarkChanges] currentCounts:', currentCounts);
    
    // 获取上次备份时的书签和文件夹总数
    const prevBookmarkCount = lastBookmarkData?.bookmarkCount ?? 0;
    const prevFolderCount = lastBookmarkData?.folderCount ?? 0;
    console.log('[analyzeBookmarkChanges] prevBookmarkCount:', prevBookmarkCount, 'prevFolderCount:', prevFolderCount);

    let bookmarkDiff = currentCounts.bookmarks - prevBookmarkCount;
    let folderDiff = currentCounts.folders - prevFolderCount;
    console.log('[analyzeBookmarkChanges] 计算差异 bookmarkDiff:', bookmarkDiff, 'folderDiff:', folderDiff);

    let bookmarkStructureChanged = lastSyncOperations?.bookmarkMoved || lastSyncOperations?.bookmarkModified || false;
    let folderStructureChanged = lastSyncOperations?.folderMoved || lastSyncOperations?.folderModified || false;

    // 只有在上次备份数据和指纹都存在时，才进行深度比较
    if (lastBookmarkData && lastBookmarkData.bookmarkPrints) {
        const localBookmarks = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
        const currentPrints = generateFingerprints(localBookmarks);
        
        const oldBPs = new Set(lastBookmarkData.bookmarkPrints);
        const newBPs = new Set(currentPrints.bookmarks);
        if (!areSetsEqual(oldBPs, newBPs)) {
            bookmarkStructureChanged = true;
        }

        const oldFPs = new Set(lastBookmarkData.folderPrints);
        const newFPs = new Set(currentPrints.folders);
        if (!areSetsEqual(oldFPs, newFPs)) {
            folderStructureChanged = true;
        }
    }
    
    // 如果没有上次备份数据，说明是首次运行或还未进行过备份
    // 此时不应该显示为"有变化"，而应该等待用户进行第一次备份
    if (!lastBookmarkData) {
        bookmarkDiff = 0;
        folderDiff = 0;
        bookmarkStructureChanged = false;
        folderStructureChanged = false;
    }

    // 只有真正的修改操作才算"修改"，增加/删除只体现在数量变化中
    // 不应该把所有结构变化都归类为"修改"
    const finalBookmarkModified = lastSyncOperations?.bookmarkModified || false;
    const finalFolderModified = lastSyncOperations?.folderModified || false;

    return {
        bookmarkCount: currentCounts.bookmarks,
        folderCount: currentCounts.folders,
        prevBookmarkCount: prevBookmarkCount,
        prevFolderCount: prevFolderCount,
        bookmarkDiff: bookmarkDiff,
        folderDiff: folderDiff,
        bookmarkMoved: lastSyncOperations?.bookmarkMoved || false,
        folderMoved: lastSyncOperations?.folderMoved || false,
        bookmarkModified: finalBookmarkModified,
        folderModified: finalFolderModified
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
        
        // 检查是否有任何变化
        const hasChanges = (
            stats.stats.bookmarkDiff !== 0 ||
            stats.stats.folderDiff !== 0 ||
            stats.stats.bookmarkMoved ||
            stats.stats.bookmarkModified ||
            stats.stats.folderMoved ||
            stats.stats.folderModified
        );
        
        // 构建变化描述
        let changeDescription = '';
        if (hasChanges) {
            const changes = [];
            if (stats.stats.bookmarkDiff !== 0) {
                changes.push(`${stats.stats.bookmarkDiff > 0 ? '+' : ''}${stats.stats.bookmarkDiff} ${preferredLang === 'zh_CN' ? '书签' : 'bookmarks'}`);
            }
            if (stats.stats.folderDiff !== 0) {
                changes.push(`${stats.stats.folderDiff > 0 ? '+' : ''}${stats.stats.folderDiff} ${preferredLang === 'zh_CN' ? '文件夹' : 'folders'}`);
            }
            if (stats.stats.bookmarkMoved || stats.stats.folderMoved) {
                changes.push(preferredLang === 'zh_CN' ? '移动' : 'moved');
            }
            if (stats.stats.bookmarkModified || stats.stats.folderModified) {
                changes.push(preferredLang === 'zh_CN' ? '修改' : 'modified');
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
        
        // 分析完成后，向popup发送消息，如果popup是打开的，可以直接更新UI
        browserAPI.runtime.sendMessage({ action: "analysisUpdated", ...analysis }).catch(() => {
            // 忽略错误，因为popup可能未打开
        });
        
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
});

browserAPI.runtime.onInstalled.addListener(async (details) => {
await initializeLanguagePreference(); // 新增：初始化语言偏好
    await initializeBadge();
    await initializeAutoSync();
    initializeOperationTracking();

    if (details.reason === 'install') {
// browserAPI.tabs.create({ url: 'welcome.html' });
    } else if (details.reason === 'update') {
        const previousVersion = details.previousVersion;
}
});
