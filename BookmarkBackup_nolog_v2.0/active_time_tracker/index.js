// =============================================================================
// 活跃时间追踪模块 (Active Time Tracker)
// =============================================================================
// 用于追踪用户在书签页面上的活跃浏览时间
// 采用状态机设计：INACTIVE → ACTIVE ⇄ PAUSED → ENDED

const browserAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome :
    (typeof browser !== 'undefined' ? browser : null);

// 配置参数
const CONFIG = {
    MIN_ACTIVE_MS: 3000,              // 最小计时阈值：< 3秒不记录
    MERGE_WINDOW_MS: 5 * 60 * 1000,   // 去重合并：同一URL 5分钟内多次访问合并
    BATCH_SIZE: 5,                     // 批量写入：累积5条后批量写DB
    IDLE_DETECTION_INTERVAL: 60,       // idle检测阈值：60秒无操作视为idle
    PERIODIC_SAVE_INTERVAL: 30000,    // 定期保存间隔：30秒（防止崩溃丢失数据）
    SLEEP_DETECTION_INTERVAL: 1000,   // 休眠检测间隔：1秒
    SLEEP_THRESHOLD_MS: 5000,         // 休眠判定阈值：时间跳跃>5秒视为休眠
    AUTO_BOOKMARK_ATTRIBUTION_TTL_MS: 6 * 60 * 60 * 1000, // 书签打开归因TTL：6小时
    AUTO_BOOKMARK_REDIRECT_WINDOW_MS: 15000, // 仅把“打开后短时间内的跳转/重定向”算作同一次书签打开
    DB_NAME: 'BookmarkActiveTimeDB',
    DB_VERSION: 1,
    STORE_NAME: 'active_sessions'
};

const normalizeDomain = (domain) => {
    if (!domain || typeof domain !== 'string') return '';
    return domain.trim().toLowerCase().replace(/^www\./, '');
};

let trackingBlockedCache = {
    bookmarks: new Set(),
    folders: new Set(),
    domains: new Set()
};
let trackingBlockedCacheReady = false;

// tabId -> { bookmarkUrl, bookmarkId, bookmarkTitle, updatedAt }
const autoBookmarkAttributionByTabId = new Map();

function getValidAutoBookmarkAttribution(tabId) {
    const data = autoBookmarkAttributionByTabId.get(tabId);
    if (!data) return null;
    if ((Date.now() - (data.updatedAt || 0)) > CONFIG.AUTO_BOOKMARK_ATTRIBUTION_TTL_MS) {
        autoBookmarkAttributionByTabId.delete(tabId);
        return null;
    }
    return data;
}

function updateTrackingBlockedCache(data) {
    trackingBlockedCache = {
        bookmarks: new Set(data?.bookmarks || []),
        folders: new Set(data?.folders || []),
        domains: new Set((data?.domains || []).map(normalizeDomain).filter(Boolean))
    };
    trackingBlockedCacheReady = true;
}

async function refreshTrackingBlockedCache() {
    try {
        const result = await browserAPI.storage.local.get(['timetracking_blocked']);
        updateTrackingBlockedCache(result.timetracking_blocked || {});
    } catch (error) {
        trackingBlockedCacheReady = false;
        console.warn('[ActiveTimeTracker] 读取时间追踪屏蔽失败:', error);
    }
}

function applyTrackingBlockedToActiveSessions() {
    if (!trackingBlockedCacheReady || activeSessions.size === 0) return;
    for (const [tabId, session] of activeSessions) {
        if (isTrackingBlockedByCache({ url: session.url, bookmarkId: session.bookmarkId })) {
            session.end();
            activeSessions.delete(tabId);
            console.log('[ActiveTimeTracker] 已停止屏蔽会话:', session.title || session.url);
        }
    }
}

// 状态枚举
const SessionState = {
    INACTIVE: 'inactive',
    ACTIVE: 'active',
    PAUSED: 'paused',
    ENDED: 'ended'
};

// =============================================================================
// IndexedDB 操作
// =============================================================================

let db = null;

async function openDatabase() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

        request.onerror = () => {
            console.error('[ActiveTimeTracker] 打开数据库失败:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('[ActiveTimeTracker] 数据库打开成功');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(CONFIG.STORE_NAME)) {
                const store = database.createObjectStore(CONFIG.STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                });

                store.createIndex('url', 'url', { unique: false });
                store.createIndex('bookmarkId', 'bookmarkId', { unique: false });
                store.createIndex('startTime', 'startTime', { unique: false });
                store.createIndex('endTime', 'endTime', { unique: false });

                console.log('[ActiveTimeTracker] 创建 active_sessions 表');
            }
        };
    });
}

async function saveSession(session) {
    try {
        if (isTrackingBlockedByCache({ url: session.url, bookmarkId: session.bookmarkId })) {
            console.log('[ActiveTimeTracker] 会话被屏蔽，跳过保存:', session.title || session.url);
            return false;
        }
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.STORE_NAME);

            // 计算综合时间：活跃×1.0 + 前台静止×0.8 + 可见参考×0.5 + 后台×0.1
            const compositeMs = session.accumulatedActiveMs +
                (session.pauseTotalMs * 0.8) +
                (session.visibleTotalMs * 0.5) +
                (session.backgroundTotalMs * 0.1);

            const recordUrl = typeof session.getRecordUrl === 'function'
                ? session.getRecordUrl()
                : session.url;

            const record = {
                url: recordUrl,
                bookmarkId: session.bookmarkId || null,
                title: session.title || '',
                startTime: session.startTime,
                endTime: session.endTime || Date.now(),
                totalMs: (session.endTime || Date.now()) - session.startTime,
                activeMs: session.accumulatedActiveMs,
                idleFocusMs: session.pauseTotalMs,       // 前台静止时间 ×0.8
                visibleMs: session.visibleTotalMs,       // 可见参考时间 ×0.5
                backgroundMs: session.backgroundTotalMs, // 后台时间 ×0.1
                compositeMs: compositeMs,                 // 综合时间
                wakeCount: session.wakeCount,             // 唤醒次数
                pauseTotalMs: session.pauseTotalMs,
                source: 'tabs',
                matchType: session.matchType || 'url',
                tabId: session.tabId,
                windowId: session.windowId,
                createdAt: Date.now()
            };

            const request = store.add(record);

            request.onsuccess = async () => {
                console.log('[ActiveTimeTracker] 会话已保存:', record.url,
                    `综合时间: ${Math.round(record.compositeMs / 1000)}秒`);

                // 同时更新永久存储中的累积统计
                await updateTrackingStats(record);

                // 通知其他页面T值数据已更新
                try {
                    chrome.runtime.sendMessage({
                        action: 'trackingDataUpdated',
                        url: record.url,
                        title: record.title,
                        compositeMs: record.compositeMs
                    });
                } catch (e) {
                    // 忽略发送失败（可能没有监听者）
                }

                resolve(request.result);
            };

            request.onerror = () => {
                console.error('[ActiveTimeTracker] 保存会话失败:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] saveSession 错误:', error);
    }
}

// 更新永久存储中的累积统计（供「综合排行」使用）
async function updateTrackingStats(record) {
    try {
        const result = await browserAPI.storage.local.get(['trackingStats']);
        const stats = result.trackingStats || {};

        const key = record.title || record.url;
        const now = Date.now();

        if (!stats[key]) {
            stats[key] = {
                url: record.url,
                title: record.title,
                bookmarkId: record.bookmarkId || null,
                totalCompositeMs: 0,
                totalWakeCount: 0,
                sessionCount: 0,
                lastUpdate: now
            };
        }

        // 累加统计
        stats[key].totalCompositeMs += record.compositeMs || 0;
        stats[key].totalWakeCount += record.wakeCount || 0;
        stats[key].sessionCount++;
        stats[key].lastUpdate = now;
        // 保留最新的 URL（标题可能对应多个 URL）
        if (record.url) {
            stats[key].url = record.url;
        }
        if (record.bookmarkId) {
            stats[key].bookmarkId = record.bookmarkId;
        }

        await browserAPI.storage.local.set({ trackingStats: stats });
        console.log('[ActiveTimeTracker] 累积统计已更新:', key);
    } catch (error) {
        console.warn('[ActiveTimeTracker] 更新累积统计失败:', error);
    }
}

async function getSessionsByUrl(url, startTime, endTime) {
    try {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readonly');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            const index = store.index('url');
            const request = index.getAll(url);

            request.onsuccess = () => {
                let results = request.result || [];
                if (startTime) {
                    results = results.filter(r => r.startTime >= startTime);
                }
                if (endTime) {
                    results = results.filter(r => r.endTime <= endTime);
                }
                resolve(results);
            };

            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] getSessionsByUrl 错误:', error);
        return [];
    }
}

async function getSessionsByTimeRange(startTime, endTime) {
    try {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readonly');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                let results = request.result || [];
                if (startTime) {
                    results = results.filter(r => r.startTime >= startTime);
                }
                if (endTime) {
                    results = results.filter(r => r.endTime <= endTime);
                }
                resolve(results);
            };

            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] getSessionsByTimeRange 错误:', error);
        return [];
    }
}

async function clearAllSessions() {
    try {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('[ActiveTimeTracker] IndexedDB 会话记录已清除');
                resolve(true);
            };

            request.onerror = () => {
                console.error('[ActiveTimeTracker] 清除会话失败:', request.error);
                reject(request.error);
            };
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] clearAllSessions 错误:', error);
        return false;
    }
}

// 清除正在追踪的会话（不影响综合排行）
async function clearCurrentTrackingSessions() {
    try {
        await browserAPI.storage.local.remove([
            'activeTrackingSessions',
            'activeTrackingSessionsUpdatedAt'
        ]);
        activeSessions.clear();
        console.log('[ActiveTimeTracker] 正在追踪的会话已清除');
        return true;
    } catch (error) {
        console.error('[ActiveTimeTracker] clearCurrentTrackingSessions 错误:', error);
        return false;
    }
}

// 按时间范围清除综合排行数据
// range: 'week' | 'month' | 'year' | 'all'
async function clearTrackingStatsByRange(range) {
    try {
        const result = await browserAPI.storage.local.get(['trackingStats']);
        const stats = result.trackingStats || {};

        if (range === 'all') {
            await browserAPI.storage.local.remove(['trackingStats']);
            // 同时清除 IndexedDB
            await clearAllSessions();
            console.log('[ActiveTimeTracker] 已清除全部综合排行数据');
            return { cleared: Object.keys(stats).length, remaining: 0 };
        }

        const now = Date.now();
        const cutoffTime = {
            'week': now - 7 * 24 * 60 * 60 * 1000,
            'month': now - 30 * 24 * 60 * 60 * 1000,
            'year': now - 365 * 24 * 60 * 60 * 1000
        }[range];

        if (!cutoffTime) {
            console.warn('[ActiveTimeTracker] 无效的时间范围:', range);
            return { cleared: 0, remaining: Object.keys(stats).length };
        }

        const newStats = {};
        let clearedCount = 0;

        for (const [key, stat] of Object.entries(stats)) {
            if (stat.lastUpdate && stat.lastUpdate >= cutoffTime) {
                newStats[key] = stat;
            } else {
                clearedCount++;
            }
        }

        await browserAPI.storage.local.set({ trackingStats: newStats });

        // 同时清除 IndexedDB 中对应时间范围的数据
        await clearSessionsByTimeRange(0, cutoffTime);

        console.log('[ActiveTimeTracker] 已清除', clearedCount, '条综合排行数据（', range, '以前）');
        return { cleared: clearedCount, remaining: Object.keys(newStats).length };
    } catch (error) {
        console.error('[ActiveTimeTracker] clearTrackingStatsByRange 错误:', error);
        return { cleared: 0, remaining: 0, error: error.message };
    }
}

// 清除指定时间范围的 IndexedDB 会话记录
async function clearSessionsByTimeRange(startTime, endTime) {
    try {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            const request = store.openCursor();

            let deletedCount = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = cursor.value;
                    if (record.endTime >= startTime && record.endTime <= endTime) {
                        cursor.delete();
                        deletedCount++;
                    }
                    cursor.continue();
                } else {
                    console.log('[ActiveTimeTracker] 已清除', deletedCount, '条IndexedDB记录');
                    resolve(deletedCount);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] clearSessionsByTimeRange 错误:', error);
        return 0;
    }
}

// 数据一致性检查：同步 trackingStats 和 IndexedDB
async function syncTrackingData() {
    try {
        console.log('[ActiveTimeTracker] 开始数据一致性检查...');

        // 从 IndexedDB 重新计算统计
        const sessions = await getSessionsByTimeRange(0, Date.now());
        const recalculatedStats = {};

        for (const session of sessions) {
            const key = session.title || session.url;
            if (!recalculatedStats[key]) {
                recalculatedStats[key] = {
                    url: session.url,
                    title: session.title,
                    bookmarkId: session.bookmarkId || null,
                    totalCompositeMs: 0,
                    totalWakeCount: 0,
                    sessionCount: 0,
                    lastUpdate: 0
                };
            }
            const stat = recalculatedStats[key];
            const compositeMs = session.compositeMs ||
                ((session.activeMs || 0) +
                    (session.idleFocusMs || session.pauseTotalMs || 0) * 0.8 +
                    (session.visibleMs || 0) * 0.5 +
                    (session.backgroundMs || 0) * 0.1);
            stat.totalCompositeMs += compositeMs;
            stat.totalWakeCount += session.wakeCount || 0;
            stat.sessionCount++;
            stat.lastUpdate = Math.max(stat.lastUpdate, session.endTime || session.createdAt || 0);
            if (session.url) stat.url = session.url;
            if (session.bookmarkId) stat.bookmarkId = session.bookmarkId;
        }

        // 获取当前 trackingStats
        const result = await browserAPI.storage.local.get(['trackingStats']);
        const currentStats = result.trackingStats || {};

        // 比较差异
        const currentKeys = Object.keys(currentStats);
        const recalcKeys = Object.keys(recalculatedStats);
        const diff = {
            added: recalcKeys.filter(k => !currentStats[k]),
            removed: currentKeys.filter(k => !recalculatedStats[k]),
            updated: recalcKeys.filter(k => currentStats[k] &&
                Math.abs((currentStats[k].totalCompositeMs || 0) - (recalculatedStats[k].totalCompositeMs || 0)) > 1000)
        };

        if (diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0) {
            console.log('[ActiveTimeTracker] 发现数据不一致:', diff);
            await browserAPI.storage.local.set({ trackingStats: recalculatedStats });
            console.log('[ActiveTimeTracker] 已同步 trackingStats，共', recalcKeys.length, '条记录');
            return { synced: true, diff, totalRecords: recalcKeys.length };
        }

        console.log('[ActiveTimeTracker] 数据一致，无需同步');
        return { synced: false, totalRecords: currentKeys.length };
    } catch (error) {
        console.error('[ActiveTimeTracker] syncTrackingData 错误:', error);
        return { synced: false, error: error.message };
    }
}

// 兼容旧接口：清除全部显示数据
async function clearTrackingDisplayData() {
    await clearCurrentTrackingSessions();
    await clearTrackingStatsByRange('all');
    return true;
}

// 获取永久存储中的累积统计（供「综合排行」使用）
async function getTrackingStats() {
    try {
        const result = await browserAPI.storage.local.get(['trackingStats']);
        return result.trackingStats || {};
    } catch (error) {
        console.warn('[ActiveTimeTracker] 获取累积统计失败:', error);
        return {};
    }
}

// =============================================================================
// 会话状态持久化（写入永久存储，防止 Service Worker 休眠丢失）
// =============================================================================

// 将当前活跃会话状态保存到永久存储
async function persistActiveSessionsToStorage() {
    try {
        const sessionsData = [];
        const now = Date.now();

        for (const [tabId, session] of activeSessions) {
            if (session.state !== SessionState.INACTIVE && session.state !== SessionState.ENDED) {
                // 计算当前正在进行的时间
                let currentActiveMs = session.accumulatedActiveMs;
                let currentPauseMs = session.pauseTotalMs;
                let currentVisibleMs = session.visibleTotalMs;
                let currentBackgroundMs = session.backgroundTotalMs;

                if (session.state === SessionState.ACTIVE && session.activeStartTime) {
                    currentActiveMs += now - session.activeStartTime;
                }
                if (session.state === SessionState.PAUSED && session.lastPauseTime && !session.isSleeping) {
                    const pauseDuration = now - session.lastPauseTime;
                    if (session.isBackground) {
                        currentBackgroundMs += pauseDuration;
                    } else if (session.isVisible) {
                        currentVisibleMs += pauseDuration;
                    } else {
                        currentPauseMs += pauseDuration;
                    }
                }

                sessionsData.push({
                    tabId: session.tabId,
                    windowId: session.windowId,
                    url: session.url,
                    title: session.title,
                    trackedUrl: session.trackedUrl || null,
                    autoBookmarkAttributionSetAt: session.autoBookmarkAttributionSetAt || null,
                    bookmarkId: session.bookmarkId,
                    matchType: session.matchType,
                    state: session.state,
                    startTime: session.startTime,
                    // 保存累积时间（包含当前正在进行的 + 已保存的）
                    accumulatedActiveMs: currentActiveMs + session.savedActiveMs,
                    pauseTotalMs: currentPauseMs + session.savedPauseMs,
                    visibleTotalMs: currentVisibleMs + session.savedVisibleMs,
                    backgroundTotalMs: currentBackgroundMs + session.savedBackgroundMs,
                    wakeCount: session.wakeCount + session.savedWakeCount,
                    isBackground: session.isBackground,
                    isVisible: session.isVisible,
                    isSleeping: session.isSleeping,
                    // 记录保存时间，用于恢复时计算时间差
                    persistedAt: now,
                    // 保存原始开始时间
                    originalStartTime: session.originalStartTime || session.startTime
                });
            }
        }

        await browserAPI.storage.local.set({
            activeTrackingSessions: sessionsData,
            activeTrackingSessionsUpdatedAt: now
        });

        if (sessionsData.length > 0) {
            console.log('[ActiveTimeTracker] 已持久化', sessionsData.length, '个活跃会话到永久存储');
        }
    } catch (error) {
        console.error('[ActiveTimeTracker] 持久化会话状态失败:', error);
    }
}

// 从永久存储恢复活跃会话状态
async function restoreActiveSessionsFromStorage() {
    try {
        const result = await browserAPI.storage.local.get(['activeTrackingSessions', 'activeTrackingSessionsUpdatedAt']);
        const sessionsData = result.activeTrackingSessions || [];
        const updatedAt = result.activeTrackingSessionsUpdatedAt || 0;

        if (sessionsData.length === 0) {
            console.log('[ActiveTimeTracker] 无需恢复，永久存储中没有活跃会话');
            return 0;
        }

        const now = Date.now();
        const timeSinceUpdate = now - updatedAt;

        // 如果距离上次更新超过5分钟，可能会话已经过期，不恢复
        if (timeSinceUpdate > 5 * 60 * 1000) {
            console.log('[ActiveTimeTracker] 持久化数据过期（', Math.round(timeSinceUpdate / 1000), '秒前），不恢复');
            await browserAPI.storage.local.remove(['activeTrackingSessions', 'activeTrackingSessionsUpdatedAt']);
            return 0;
        }

        let restoredCount = 0;

        for (const data of sessionsData) {
            // 检查标签页是否仍然存在
            try {
                const tab = await browserAPI.tabs.get(data.tabId);
                if (!tab || !tab.url) {
                    continue;
                }

                const currentTabUrl = tab.url;
                const isAttributed = data.matchType === 'auto_bookmark' || !!data.trackedUrl;

                if (!isAttributed && currentTabUrl !== data.url) {
                    // 非归因会话：URL 已变化，跳过
                    continue;
                }

                if (isTrackingBlockedByCache({ url: currentTabUrl, bookmarkId: data.bookmarkId })) {
                    console.log('[ActiveTimeTracker] 恢复跳过屏蔽会话:', data.title || data.url);
                    continue;
                }

                // 检查是否已经有这个标签的会话
                if (activeSessions.has(data.tabId)) {
                    continue;
                }

                // 恢复会话
                const session = new SessionData(data.tabId, data.windowId, currentTabUrl, data.title);
                session.trackedUrl = data.trackedUrl || null;
                session.autoBookmarkAttributionSetAt = data.autoBookmarkAttributionSetAt || null;
                session.bookmarkId = data.bookmarkId;
                session.matchType = data.matchType;
                session.forceBookmarkTracking = data.matchType === 'auto_bookmark' || !!data.trackedUrl;
                session.state = data.state;
                session.startTime = data.startTime;
                session.accumulatedActiveMs = data.accumulatedActiveMs;
                session.pauseTotalMs = data.pauseTotalMs;
                session.visibleTotalMs = data.visibleTotalMs;
                session.backgroundTotalMs = data.backgroundTotalMs;
                session.wakeCount = data.wakeCount;
                session.isBackground = data.isBackground;
                session.isVisible = data.isVisible;
                session.isSleeping = data.isSleeping;

                // 设置计时起点为现在（恢复后继续计时）
                if (session.state === SessionState.ACTIVE) {
                    session.activeStartTime = now;
                }
                if (session.state === SessionState.PAUSED) {
                    session.lastPauseTime = now;
                }

                activeSessions.set(data.tabId, session);
                restoredCount++;

                console.log('[ActiveTimeTracker] 恢复会话:', data.title || data.url,
                    '累积时间:', Math.round(data.accumulatedActiveMs / 1000), '秒');
            } catch (e) {
                // 标签页不存在，跳过
            }
        }

        // 清除已恢复的持久化数据
        await browserAPI.storage.local.remove(['activeTrackingSessions', 'activeTrackingSessionsUpdatedAt']);

        console.log('[ActiveTimeTracker] 从永久存储恢复了', restoredCount, '个会话');
        return restoredCount;
    } catch (error) {
        console.error('[ActiveTimeTracker] 恢复会话状态失败:', error);
        return 0;
    }
}

// 保存所有活跃会话（浏览器关闭/Service Worker 暂停时调用）
async function saveAllActiveSessions() {
    let savedCount = 0;
    const sessionsToSave = [];

    for (const [tabId, session] of activeSessions) {
        if (session.state !== SessionState.INACTIVE && session.state !== SessionState.ENDED) {
            const ended = session.end();
            if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
                sessionsToSave.push(ended);
            }
        }
    }

    for (const session of sessionsToSave) {
        try {
            await saveSession(session);
            savedCount++;
        } catch (error) {
            console.error('[ActiveTimeTracker] 保存会话失败:', error);
        }
    }

    activeSessions.clear();
    console.log('[ActiveTimeTracker] 浏览器关闭/暂停，已保存', savedCount, '个活跃会话');
    return savedCount;
}

// 删除指定 URL 的所有时间记录（书签被删除时调用）
async function deleteSessionsByUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) return false;

    try {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            const index = store.index('url');
            const request = index.openCursor(IDBKeyRange.only(normalizedUrl));

            let deletedCount = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    console.log('[ActiveTimeTracker] 已删除', deletedCount, '条记录:', normalizedUrl);
                    resolve(deletedCount);
                }
            };

            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] deleteSessionsByUrl 错误:', error);
        return 0;
    }
}

// 删除指定标题的所有时间记录
async function deleteSessionsByTitle(title) {
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) return false;

    try {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            const request = store.openCursor();

            let deletedCount = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = cursor.value;
                    if (normalizeTitle(record.title) === normalizedTitle) {
                        cursor.delete();
                        deletedCount++;
                    }
                    cursor.continue();
                } else {
                    console.log('[ActiveTimeTracker] 按标题删除了', deletedCount, '条记录:', normalizedTitle);
                    resolve(deletedCount);
                }
            };

            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] deleteSessionsByTitle 错误:', error);
        return 0;
    }
}

async function getBookmarkActiveTimeStats(bookmarkId) {
    try {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readonly');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            const index = store.index('bookmarkId');
            const request = index.getAll(bookmarkId);

            request.onsuccess = () => {
                const sessions = request.result || [];
                const totalActiveMs = sessions.reduce((sum, s) => sum + (s.activeMs || 0), 0);
                const sessionCount = sessions.length;
                const avgActiveMs = sessionCount > 0 ? totalActiveMs / sessionCount : 0;

                resolve({
                    totalActiveMs,
                    sessionCount,
                    avgActiveMs,
                    sessions
                });
            };

            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[ActiveTimeTracker] getBookmarkActiveTimeStats 错误:', error);
        return { totalActiveMs: 0, sessionCount: 0, avgActiveMs: 0, sessions: [] };
    }
}

// =============================================================================
// 书签匹配逻辑
// =============================================================================

let bookmarkUrlSet = new Set();
let bookmarkTitleSet = new Set();
let bookmarkUrlToId = new Map();
let bookmarkUrlToTitle = new Map();       // 规范化URL -> 原始书签标题
let bookmarkTitleToOriginal = new Map();  // 规范化标题 -> 原始书签标题
let bookmarkTitleToId = new Map();        // 规范化标题 -> 书签ID
let bookmarkIdToParentIds = new Map();    // 书签ID -> 父级文件夹链

function normalizeUrl(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;

        // 保留完整 URL（包括查询参数），只移除锚点和末尾斜杠
        // 这样 google.com/search?q=hello 和 google.com/search?q=world 会被视为不同的 URL
        let normalized = parsed.origin + parsed.pathname;

        // 保留查询参数（对于搜索引擎等网站很重要）
        if (parsed.search) {
            normalized += parsed.search;
        }

        // 移除末尾斜杠
        normalized = normalized.replace(/\/+$/, '');

        return normalized.toLowerCase();
    } catch {
        return null;
    }
}

function normalizeTitle(title) {
    if (!title) return null;
    const trimmed = title.trim();
    return trimmed.length > 0 ? trimmed : null;
}

let bookmarkRestoringFlag = false;
let bookmarkBulkChangeFlag = false;
let bookmarkImportingFlag = false;
let bookmarkCacheRebuildTimer = null;

function shouldSuspendBookmarkCacheWork() {
    return bookmarkRestoringFlag || bookmarkBulkChangeFlag || bookmarkImportingFlag;
}

async function syncBookmarkRestoringFlag() {
    try {
        const result = await browserAPI.storage.local.get([
            'bookmarkRestoringFlag',
            'bookmarkBulkChangeFlag',
            'bookmarkImportingFlag'
        ]);
        bookmarkRestoringFlag = result.bookmarkRestoringFlag === true;
        bookmarkBulkChangeFlag = result.bookmarkBulkChangeFlag === true;
        bookmarkImportingFlag = result.bookmarkImportingFlag === true;
    } catch (_) {
        bookmarkRestoringFlag = false;
        bookmarkBulkChangeFlag = false;
        bookmarkImportingFlag = false;
    }
}

async function rebuildBookmarkCache() {
    bookmarkUrlSet.clear();
    bookmarkTitleSet.clear();
    bookmarkUrlToId.clear();
    bookmarkUrlToTitle.clear();
    bookmarkTitleToOriginal.clear();
    bookmarkTitleToId.clear();
    bookmarkIdToParentIds.clear();

    try {
        const tree = await browserAPI.bookmarks.getTree();

        const traverse = (nodes, ancestors = []) => {
            for (const node of nodes) {
                if (node.url) {
                    const normalizedUrl = normalizeUrl(node.url);
                    if (normalizedUrl) {
                        bookmarkUrlSet.add(normalizedUrl);
                        bookmarkUrlToId.set(normalizedUrl, node.id);
                        bookmarkUrlToTitle.set(normalizedUrl, node.title);  // URL -> 书签标题
                        bookmarkIdToParentIds.set(node.id, ancestors);
                    }
                    const normalizedTitle = normalizeTitle(node.title);
                    if (normalizedTitle) {
                        bookmarkTitleSet.add(normalizedTitle);
                        bookmarkTitleToOriginal.set(normalizedTitle, node.title);  // 存储原始标题
                        if (!bookmarkTitleToId.has(normalizedTitle)) {
                            bookmarkTitleToId.set(normalizedTitle, node.id);
                        }
                    }
                }
                if (node.children) {
                    const nextAncestors = node.url ? ancestors : [...ancestors, node.id];
                    traverse(node.children, nextAncestors);
                }
            }
        };

        traverse(tree, []);
        console.log('[ActiveTimeTracker] 书签缓存已重建:',
            bookmarkUrlSet.size, 'URLs,', bookmarkTitleSet.size, 'Titles');
    } catch (error) {
        console.error('[ActiveTimeTracker] 重建书签缓存失败:', error);
    }
}

function isBookmarkUrl(url, title) {
    const normalizedUrl = normalizeUrl(url);
    const normalizedTitle = normalizeTitle(title);

    // URL 匹配
    const urlMatch = normalizedUrl && bookmarkUrlSet.has(normalizedUrl);

    // 标题匹配：只有当 URL 是有效的 http/https 时才允许
    // 这样可以防止 chrome://newtab 等内置页面通过标题匹配
    let titleMatch = false;
    if (!urlMatch && normalizedTitle) {
        try {
            const parsed = new URL(url);
            if (['http:', 'https:'].includes(parsed.protocol)) {
                titleMatch = bookmarkTitleSet.has(normalizedTitle);
            }
        } catch {
            // URL 解析失败，不进行标题匹配
        }
    }

    // 获取书签的原始标题
    let bookmarkTitle = null;
    if (urlMatch) {
        bookmarkTitle = bookmarkUrlToTitle.get(normalizedUrl);
    } else if (titleMatch) {
        bookmarkTitle = bookmarkTitleToOriginal.get(normalizedTitle);
    }

    return {
        isBookmark: urlMatch || titleMatch,
        matchType: urlMatch ? 'url' : (titleMatch ? 'title' : null),
        bookmarkId: urlMatch ? bookmarkUrlToId.get(normalizedUrl) : (titleMatch ? bookmarkTitleToId.get(normalizedTitle) : null),
        bookmarkTitle: bookmarkTitle
    };
}

function isTrackingBlockedByCache({ url, bookmarkId }) {
    if (!trackingBlockedCacheReady) return false;

    if (bookmarkId && trackingBlockedCache.bookmarks.has(bookmarkId)) {
        return true;
    }

    if (bookmarkId && trackingBlockedCache.folders.size > 0) {
        const parentIds = bookmarkIdToParentIds.get(bookmarkId) || [];
        for (const parentId of parentIds) {
            if (trackingBlockedCache.folders.has(parentId)) {
                return true;
            }
        }
    }

    if (url && trackingBlockedCache.domains.size > 0) {
        try {
            const domain = normalizeDomain(new URL(url).hostname);
            if (domain && trackingBlockedCache.domains.has(domain)) {
                return true;
            }
        } catch { }
    }

    return false;
}

// =============================================================================
// 会话管理器
// =============================================================================

const activeSessions = new Map(); // tabId -> SessionData
let currentWindowFocused = true;
let currentFocusedWindowId = null; // 当前获得焦点的窗口ID
let currentIdleState = 'active';
let trackingEnabled = true;

function getAttributionTransition(source) {
    if (source === 'browser_auto_bookmark') return 'auto_bookmark';
    if (source === 'extension') return 'extension_bookmark';
    return 'attributed';
}

async function reportAttributedBookmarkOpenOnce(session, attribution) {
    if (!session || session.didReportAttributedOpen) return;
    session.didReportAttributedOpen = true;

    try {
        const maybePromise = browserAPI.runtime.sendMessage({
            action: 'attributedBookmarkOpen',
            url: attribution?.bookmarkUrl || session.getRecordUrl(),
            title: attribution?.bookmarkTitle || session.title || '',
            transition: getAttributionTransition(attribution?.source)
        });
        if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => { });
        }
    } catch (_) { }
}

async function startSessionWithAttributionFallback(tabId, session) {
    const started = session.start();
    if (started) return true;

    const attribution = getValidAutoBookmarkAttribution(tabId);
    if (!attribution) return false;

    session.applyBookmarkAttribution(attribution);
    const startedAfter = session.start();
    if (startedAfter) {
        await reportAttributedBookmarkOpenOnce(session, attribution);
    }
    return startedAfter;
}

class SessionData {
    constructor(tabId, windowId, url, title) {
        this.tabId = tabId;
        this.windowId = windowId;
        this.url = url;
        this.title = title;
        this.trackedUrl = null; // 归因到书签的 URL（用于保存/排行/匹配）
        this.autoBookmarkAttributionSetAt = null; // auto_bookmark 归因建立时间
        this.didReportAttributedOpen = false;
        this.state = SessionState.INACTIVE;
        this.startTime = null;
        this.activeStartTime = null;
        this.accumulatedActiveMs = 0;
        this.wakeCount = 0;          // 唤醒次数（从非活跃状态恢复到活跃状态的次数）
        this.pauseTotalMs = 0;       // 前台静止时间（用户空闲但仍在当前标签）×0.8
        this.visibleTotalMs = 0;     // 可见参考时间（窗口无焦点但用户活跃）×0.5
        this.backgroundTotalMs = 0;  // 后台时间（切换到其他标签）×0.1
        this.lastPauseTime = null;
        this.isBackground = false;   // 是否在后台（切换到其他标签）
        this.isVisible = false;      // 是否可见参考（窗口无焦点）
        this.isSleeping = false;     // 是否在睡眠（用户空闲）
        this.bookmarkId = null;
        this.matchType = null;
        this.forceBookmarkTracking = false;
        // 已保存到数据库的累积值（用于显示时加回来）
        this.savedActiveMs = 0;
        this.savedPauseMs = 0;
        this.savedVisibleMs = 0;
        this.savedBackgroundMs = 0;
        this.savedWakeCount = 0;
        this.originalStartTime = null;  // 会话最初开始时间
    }

    getRecordUrl() {
        return this.trackedUrl || this.url;
    }

    applyBookmarkAttribution({ bookmarkUrl, bookmarkId, bookmarkTitle, updatedAt } = {}) {
        if (bookmarkUrl) {
            this.trackedUrl = bookmarkUrl;
        }
        if (bookmarkId) {
            this.bookmarkId = bookmarkId;
        }
        if (bookmarkTitle) {
            this.title = bookmarkTitle;
        }
        this.matchType = 'auto_bookmark';
        this.forceBookmarkTracking = true;
        this.autoBookmarkAttributionSetAt = typeof updatedAt === 'number' ? updatedAt : Date.now();
    }

    start() {
        if (this.state !== SessionState.INACTIVE) return;

        // 通过「书签打开」归因：即使 URL/标题 已变化，也继续追踪到该书签
        if (this.forceBookmarkTracking && this.trackedUrl) {
            if (!normalizeUrl(this.trackedUrl)) {
                console.log('[ActiveTimeTracker] 归因URL不可追踪，跳过:', this.trackedUrl);
                return false;
            }

            // 兜底补全 bookmarkId / title（避免 background 未能 resolve）
            if (!this.bookmarkId) {
                const attributedMatch = isBookmarkUrl(this.trackedUrl, this.title);
                if (attributedMatch.bookmarkId) {
                    this.bookmarkId = attributedMatch.bookmarkId;
                }
                if (attributedMatch.bookmarkTitle) {
                    this.title = attributedMatch.bookmarkTitle;
                }
            }

            if (isTrackingBlockedByCache({ url: this.url, bookmarkId: this.bookmarkId })) {
                console.log('[ActiveTimeTracker] 命中时间追踪屏蔽，跳过追踪:', this.title || this.trackedUrl);
                return false;
            }

            this.matchType = this.matchType || 'auto_bookmark';
            this.state = SessionState.ACTIVE;
            this.startTime = Date.now();
            this.originalStartTime = Date.now();  // 记录最初开始时间
            this.activeStartTime = Date.now();
            this.isBackground = false;

            console.log('[ActiveTimeTracker] 会话开始:', this.title || this.trackedUrl,
                '匹配类型:', this.matchType);
            return true;
        }

        const match = isBookmarkUrl(this.url, this.title);
        if (!match.isBookmark) {
            console.log('[ActiveTimeTracker] 非书签页面，不追踪:', this.url);
            return false;
        }

        this.bookmarkId = match.bookmarkId;
        this.matchType = match.matchType;

        // 优先使用书签的原始标题
        if (match.bookmarkTitle) {
            console.log('[ActiveTimeTracker] 使用书签标题:', match.bookmarkTitle, '(原始标题:', this.title, ')');
            this.title = match.bookmarkTitle;
            if (match.matchType === 'url') {
                this.trackedUrl = this.url;
            }
        } else {
            console.log('[ActiveTimeTracker] 书签无标题，使用页面标题:', this.title);
        }

        if (isTrackingBlockedByCache({ url: this.url, bookmarkId: this.bookmarkId })) {
            console.log('[ActiveTimeTracker] 命中时间追踪屏蔽，跳过追踪:', this.title || this.url);
            return false;
        }

        this.state = SessionState.ACTIVE;
        this.startTime = Date.now();
        this.originalStartTime = Date.now();  // 记录最初开始时间
        this.activeStartTime = Date.now();
        this.isBackground = false;

        console.log('[ActiveTimeTracker] 会话开始:', this.title || this.url,
            '匹配类型:', this.matchType);
        return true;
    }

    // 用户空闲暂停（仍在当前标签，计入前台静止时间）
    pauseForIdle() {
        if (this.state !== SessionState.ACTIVE) return;

        const now = Date.now();
        this.accumulatedActiveMs += now - this.activeStartTime;
        this.activeStartTime = null;
        this.lastPauseTime = now;
        this.isBackground = false;
        this.state = SessionState.PAUSED;

        console.log('[ActiveTimeTracker] 用户空闲暂停:', this.title || this.url);
    }

    // 窗口失去焦点但仍是当前标签（可见参考，×0.5倍率）
    pauseForVisible() {
        if (this.state !== SessionState.ACTIVE) return;

        const now = Date.now();
        this.accumulatedActiveMs += now - this.activeStartTime;
        this.activeStartTime = null;
        this.lastPauseTime = now;
        this.isBackground = false;
        this.isVisible = true;
        this.isSleeping = false;
        this.state = SessionState.PAUSED;

        console.log('[ActiveTimeTracker] 进入可见参考:', this.title || this.url);
    }

    // 切换标签（进入后台，×0.1倍率）
    pauseForBackground() {
        if (this.state !== SessionState.ACTIVE) return;

        const now = Date.now();
        this.accumulatedActiveMs += now - this.activeStartTime;
        this.activeStartTime = null;
        this.lastPauseTime = now;
        this.isBackground = true;
        this.isVisible = false;
        this.isSleeping = false;
        this.state = SessionState.PAUSED;

        console.log('[ActiveTimeTracker] 进入后台:', this.title || this.url);
    }

    // 用户睡眠时，后台会话也停止计时
    pauseForSleep() {
        if (this.state !== SessionState.PAUSED || !this.isBackground) return;

        // 结算当前后台时间
        if (this.lastPauseTime) {
            this.backgroundTotalMs += Date.now() - this.lastPauseTime;
            this.lastPauseTime = null;
        }
        this.isSleeping = true;

        console.log('[ActiveTimeTracker] 后台进入睡眠:', this.title || this.url);
    }

    // 用户恢复活跃，后台会话重新开始计时
    resumeFromSleep() {
        if (this.state !== SessionState.PAUSED || !this.isBackground || !this.isSleeping) return;

        this.lastPauseTime = Date.now();
        this.isSleeping = false;

        console.log('[ActiveTimeTracker] 后台恢复计时:', this.title || this.url);
    }

    resume() {
        if (this.state !== SessionState.PAUSED) return;

        if (isTrackingBlockedByCache({ url: this.url, bookmarkId: this.bookmarkId })) {
            console.log('[ActiveTimeTracker] 会话被屏蔽，停止追踪:', this.title || this.url);
            return false;
        }

        const now = Date.now();
        if (this.lastPauseTime) {
            const pauseDuration = now - this.lastPauseTime;
            if (this.isBackground) {
                // 后台时间 ×0.1
                this.backgroundTotalMs += pauseDuration;
            } else if (this.isVisible) {
                // 可见参考时间 ×0.5
                this.visibleTotalMs += pauseDuration;
            } else {
                // 前台静止时间 ×0.8
                this.pauseTotalMs += pauseDuration;
            }
        }
        this.activeStartTime = now;
        this.isBackground = false;
        this.isVisible = false;
        this.isSleeping = false;
        this.wakeCount++;  // 唤醒次数 +1
        this.state = SessionState.ACTIVE;

        console.log('[ActiveTimeTracker] 会话恢复（唤醒）:', this.title || this.url);
        return true;
    }

    end() {
        if (this.state === SessionState.INACTIVE || this.state === SessionState.ENDED) return null;

        const now = Date.now();

        if (this.state === SessionState.ACTIVE && this.activeStartTime) {
            this.accumulatedActiveMs += now - this.activeStartTime;
        }

        // 处理暂停期间的时间
        if (this.state === SessionState.PAUSED && this.lastPauseTime && !this.isSleeping) {
            const pauseDuration = now - this.lastPauseTime;
            if (this.isBackground) {
                this.backgroundTotalMs += pauseDuration;
            } else if (this.isVisible) {
                this.visibleTotalMs += pauseDuration;
            } else {
                this.pauseTotalMs += pauseDuration;
            }
        }

        this.state = SessionState.ENDED;
        this.endTime = now;

        console.log('[ActiveTimeTracker] 会话结束:', this.title || this.url,
            `活跃时间: ${Math.round(this.accumulatedActiveMs / 1000)}秒`,
            `静止时间: ${Math.round(this.pauseTotalMs / 1000)}秒`);

        return this;
    }

    // 创建当前会话的快照（用于定期保存，不结束会话）
    createSnapshot() {
        if (this.state === SessionState.INACTIVE || this.state === SessionState.ENDED) return null;

        const now = Date.now();
        let snapshotActiveMs = this.accumulatedActiveMs;
        let snapshotPauseMs = this.pauseTotalMs;
        let snapshotVisibleMs = this.visibleTotalMs;
        let snapshotBackgroundMs = this.backgroundTotalMs;

        // 计算当前正在进行的时间
        if (this.state === SessionState.ACTIVE && this.activeStartTime) {
            snapshotActiveMs += now - this.activeStartTime;
        }

        if (this.state === SessionState.PAUSED && this.lastPauseTime && !this.isSleeping) {
            const pauseDuration = now - this.lastPauseTime;
            if (this.isBackground) {
                snapshotBackgroundMs += pauseDuration;
            } else if (this.isVisible) {
                snapshotVisibleMs += pauseDuration;
            } else {
                snapshotPauseMs += pauseDuration;
            }
        }

        return {
            url: this.getRecordUrl(),
            title: this.title,
            bookmarkId: this.bookmarkId,
            matchType: this.matchType,
            tabId: this.tabId,
            windowId: this.windowId,
            startTime: this.startTime,
            endTime: now,
            accumulatedActiveMs: snapshotActiveMs,
            pauseTotalMs: snapshotPauseMs,
            visibleTotalMs: snapshotVisibleMs,
            backgroundTotalMs: snapshotBackgroundMs,
            wakeCount: this.wakeCount
        };
    }

    // 重置累积时间（定期保存后调用，避免重复计算）
    resetAccumulated() {
        const now = Date.now();

        // 先保存当前累积值（用于显示时加回来）
        this.savedActiveMs += this.accumulatedActiveMs;
        this.savedPauseMs += this.pauseTotalMs;
        this.savedVisibleMs += this.visibleTotalMs;
        this.savedBackgroundMs += this.backgroundTotalMs;
        this.savedWakeCount += this.wakeCount;

        // 重置累积时间
        this.accumulatedActiveMs = 0;
        this.pauseTotalMs = 0;
        this.visibleTotalMs = 0;
        this.backgroundTotalMs = 0;
        this.wakeCount = 0;

        // 重置计时起点
        if (this.state === SessionState.ACTIVE) {
            this.activeStartTime = now;
        }
        if (this.state === SessionState.PAUSED) {
            this.lastPauseTime = now;
        }

        // 更新 startTime 为当前时间（新的时间段）
        this.startTime = now;
        // 注意：不重置 originalStartTime，保留最初开始时间
    }

    // 获取总累积时间（包括已保存的）
    getTotalActiveMs() {
        return this.savedActiveMs + this.accumulatedActiveMs;
    }

    getTotalPauseMs() {
        return this.savedPauseMs + this.pauseTotalMs;
    }

    getTotalVisibleMs() {
        return this.savedVisibleMs + this.visibleTotalMs;
    }

    getTotalBackgroundMs() {
        return this.savedBackgroundMs + this.backgroundTotalMs;
    }

    getTotalWakeCount() {
        return this.savedWakeCount + this.wakeCount;
    }
}

// =============================================================================
// 事件处理器
// =============================================================================

async function handleTabActivated(activeInfo) {
    if (!trackingEnabled) return;

    const { tabId, windowId } = activeInfo;

    // 暂停其他标签页的会话（进入后台，不计时）
    for (const [tid, session] of activeSessions) {
        if (tid !== tabId && session.state === SessionState.ACTIVE) {
            session.pauseForBackground();
        }
    }

    // 获取当前标签信息
    try {
        const tab = await browserAPI.tabs.get(tabId);
        if (!tab || !tab.url) return;

        let session = activeSessions.get(tabId);

        if (!session || session.url !== tab.url) {
            // 结束旧会话
            if (session) {
                const ended = session.end();
                if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
                    await saveSession(ended);
                }
            }

            // 创建新会话
            session = new SessionData(tabId, windowId, tab.url, tab.title);
            activeSessions.set(tabId, session);
        }

        // 如果窗口有焦点且用户活跃，启动或恢复会话
        if (currentWindowFocused && currentIdleState === 'active') {
            if (session.state === SessionState.INACTIVE) {
                const started = await startSessionWithAttributionFallback(tabId, session);
                if (!started) {
                    activeSessions.delete(tabId);
                }
            } else if (session.state === SessionState.PAUSED) {
                const resumed = session.resume();
                if (!resumed) {
                    activeSessions.delete(tabId);
                }
            }
        }
    } catch (error) {
        // 标签页可能已关闭
    }
}

async function handleTabUpdated(tabId, changeInfo, tab) {
    if (!trackingEnabled) return;
    if (!changeInfo.url && !changeInfo.status && !changeInfo.title) return;

    const session = activeSessions.get(tabId);

    if (changeInfo.url) {
        const newUrl = changeInfo.url;

        // 防抖：检查是否是相同 URL 的刷新
        if (session && session.url === newUrl) {
            // URL 没变化，是页面刷新，继续使用现有会话
            console.log('[ActiveTimeTracker] 页面刷新（URL 不变），继续追踪:', newUrl);
            return;
        }

        // 如果这是“书签打开”的短时间内跳转/重定向，且新页面已失去书签标识，则把会话锁定到“原始书签URL”
        if (session && !session.forceBookmarkTracking) {
            const attribution = getValidAutoBookmarkAttribution(tabId);
            if (attribution && (Date.now() - (attribution.updatedAt || 0)) <= CONFIG.AUTO_BOOKMARK_REDIRECT_WINDOW_MS) {
                const match = isBookmarkUrl(newUrl, tab?.title || '');
                if (!match.isBookmark) {
                    session.applyBookmarkAttribution(attribution);
                    session.url = newUrl;
                    await reportAttributedBookmarkOpenOnce(session, attribution);
                    return;
                }
            }
        }

        // 书签打开归因：只允许“打开后短时间内”的跳转（重定向/站点自变更）
        // 超出窗口后，视为内容已变（例如论坛换帖/站内继续浏览），结束书签归因会话，按新页面重新判定。
        if (session && session.forceBookmarkTracking) {
            const attributionSetAt = session.autoBookmarkAttributionSetAt || session.startTime || Date.now();
            const withinRedirectWindow = (Date.now() - attributionSetAt) <= CONFIG.AUTO_BOOKMARK_REDIRECT_WINDOW_MS;

            if (!normalizeUrl(newUrl)) {
                const ended = session.end();
                if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
                    await saveSession(ended);
                }
                activeSessions.delete(tabId);
                autoBookmarkAttributionByTabId.delete(tabId);
                return;
            }

            if (withinRedirectWindow) {
                session.url = newUrl;
                return;
            }

            // 超出归因窗口：结束旧会话，并清理归因标记，让后续按普通规则运行
            const ended = session.end();
            if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
                await saveSession(ended);
            }
            activeSessions.delete(tabId);
            autoBookmarkAttributionByTabId.delete(tabId);
            // 继续往下走：会按 newUrl 创建新会话并重新匹配
        }

        // 防抖：检查是否是同一个书签的页面（比如 URL 只是参数变化）
        if (session) {
            const isSameOrigin = (() => {
                try {
                    const oldOrigin = new URL(session.url).origin;
                    const newOrigin = new URL(newUrl).origin;
                    return oldOrigin === newOrigin;
                } catch {
                    return false;
                }
            })();

            // 同域名 + 2秒内 = 可能是刷新或页面内导航，继续追踪
            const timeSinceStart = Date.now() - session.startTime;
            if (isSameOrigin && timeSinceStart < 2000) {
                console.log('[ActiveTimeTracker] 快速刷新防抖（同域名，2秒内），更新 URL:', newUrl);
                session.url = newUrl;  // 更新 URL 但不重新创建会话
                return;
            }
        }

        // URL 真的变化了，结束旧会话
        if (session) {
            const ended = session.end();
            if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
                await saveSession(ended);
            }
            activeSessions.delete(tabId);
        }

        // 检查是否是当前活跃标签
        try {
            const activeTab = await browserAPI.tabs.query({ active: true, currentWindow: true });
            if (activeTab[0] && activeTab[0].id === tabId) {
                const newSession = new SessionData(tabId, tab.windowId, newUrl, tab.title);
                activeSessions.set(tabId, newSession);

                if (currentWindowFocused && currentIdleState === 'active') {
                    const started = await startSessionWithAttributionFallback(tabId, newSession);
                    if (!started) {
                        activeSessions.delete(tabId);
                    }
                }
            }
        } catch (error) {
            // 忽略
        }
    }

    // 更新标题（只有在没有书签标题时才用页面标题）
    if (changeInfo.title && session) {
        // 如果是通过 URL 匹配的书签，已经有书签标题了，不覆盖
        if (session.matchType === 'url' || session.matchType === 'both' || session.matchType === 'auto_bookmark') {
            // URL 匹配的会话，保持书签标题不变
            console.log('[ActiveTimeTracker] 保持书签标题:', session.title);
        } else if (session.matchType === 'title') {
            // 标题匹配的会话，可能需要更新（但要检查新标题是否还匹配书签）
            const match = isBookmarkUrl(session.url, changeInfo.title);
            if (match.isBookmark && match.bookmarkTitle) {
                session.title = match.bookmarkTitle;
            }
        } else {
            // 还没有匹配信息，更新标题并重新检查匹配
            session.title = changeInfo.title;
        }
    }
}

async function handleTabRemoved(tabId, removeInfo) {
    autoBookmarkAttributionByTabId.delete(tabId);
    const session = activeSessions.get(tabId);
    if (session) {
        const ended = session.end();
        if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
            await saveSession(ended);
        }
        activeSessions.delete(tabId);
    }
}

async function handleWindowRemoved(windowId) {
    const sessionsToEnd = [];
    for (const [tabId, session] of activeSessions) {
        if (session.windowId === windowId) {
            sessionsToEnd.push([tabId, session]);
        }
    }

    for (const [tabId, session] of sessionsToEnd) {
        const ended = session.end();
        if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
            await saveSession(ended);
        }
        activeSessions.delete(tabId);
    }
}

function handleWindowFocusChanged(windowId) {
    if (!trackingEnabled) return;

    const previousWindowId = currentFocusedWindowId;
    const wasFocused = currentWindowFocused;

    currentWindowFocused = windowId !== browserAPI.windows.WINDOW_ID_NONE;
    currentFocusedWindowId = currentWindowFocused ? windowId : null;

    console.log('[ActiveTimeTracker] 窗口焦点变化:', {
        previousWindowId,
        newWindowId: windowId,
        wasFocused,
        nowFocused: currentWindowFocused
    });

    if (!currentWindowFocused) {
        // 焦点完全离开浏览器，当前标签进入可见参考（×0.5）
        for (const session of activeSessions.values()) {
            if (session.state === SessionState.ACTIVE) {
                session.pauseForVisible();
            }
        }
    } else if (previousWindowId !== null && previousWindowId !== windowId) {
        // 从一个窗口切换到另一个窗口
        // 旧窗口的当前标签进入可见参考（×0.5）
        for (const session of activeSessions.values()) {
            if (session.windowId === previousWindowId && session.state === SessionState.ACTIVE) {
                session.pauseForVisible();
            }
        }
        // 恢复新窗口的当前标签会话
        resumeActiveTabInWindow(windowId);
    } else if (!wasFocused && currentWindowFocused) {
        // 从无焦点状态恢复焦点
        resumeActiveTabInWindow(windowId);
    }
}

function handleIdleStateChanged(newState) {
    if (!trackingEnabled) return;

    const wasActive = currentIdleState === 'active';
    currentIdleState = newState;

    if (wasActive && newState !== 'active') {
        // 用户空闲
        for (const session of activeSessions.values()) {
            if (session.state === SessionState.ACTIVE) {
                // 前台会话 → 前台静止（×0.8）
                session.pauseForIdle();
            } else if (session.state === SessionState.PAUSED && session.isBackground) {
                // 后台会话 → 睡眠（停止计时）
                session.pauseForSleep();
            }
        }
    } else if (!wasActive && newState === 'active') {
        // 用户恢复活跃
        for (const session of activeSessions.values()) {
            if (session.state === SessionState.PAUSED && session.isBackground && session.isSleeping) {
                // 后台会话从睡眠恢复（重新开始计后台时间）
                session.resumeFromSleep();
            }
        }
        // 恢复前台当前会话
        if (currentWindowFocused) {
            resumeActiveTabSession();
        }
    }
}

async function resumeActiveTabSession() {
    try {
        const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            const session = activeSessions.get(tabs[0].id);
            if (session && session.state === SessionState.PAUSED) {
                const resumed = session.resume();
                if (!resumed) {
                    activeSessions.delete(tabs[0].id);
                }
            }
        }
    } catch (error) {
        // 忽略
    }
}

// 在指定窗口中恢复活跃标签的会话
async function resumeActiveTabInWindow(windowId) {
    try {
        const tabs = await browserAPI.tabs.query({ active: true, windowId: windowId });
        if (tabs[0]) {
            let session = activeSessions.get(tabs[0].id);

            // 如果没有现有会话，创建一个新的
            if (!session && tabs[0].url) {
                session = new SessionData(tabs[0].id, windowId, tabs[0].url, tabs[0].title);
                activeSessions.set(tabs[0].id, session);
            }

            if (session) {
                if (session.state === SessionState.PAUSED) {
                    const resumed = session.resume();
                    if (!resumed) {
                        activeSessions.delete(tabs[0].id);
                    }
                } else if (session.state === SessionState.INACTIVE && currentIdleState === 'active') {
                    const started = await startSessionWithAttributionFallback(tabs[0].id, session);
                    if (!started) {
                        activeSessions.delete(tabs[0].id);
                    }
                }
            }
        }
    } catch (error) {
        console.warn('[ActiveTimeTracker] resumeActiveTabInWindow 错误:', error);
    }
}

// =============================================================================
// 追踪开关
// =============================================================================

async function setTrackingEnabled(enabled) {
    trackingEnabled = enabled;

    if (!enabled) {
        // 关闭追踪时，结束并保存所有会话
        for (const [tabId, session] of activeSessions) {
            const ended = session.end();
            if (ended && ended.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
                await saveSession(ended);
            }
        }
        activeSessions.clear();
    } else {
        // 开启追踪时，重建书签缓存并启动当前标签的会话
        await rebuildBookmarkCache();
        await refreshTrackingBlockedCache();

        try {
            const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]) {
                await handleTabActivated({ tabId: tabs[0].id, windowId: tabs[0].windowId });
            }
        } catch (error) {
            // 忽略
        }
    }

    // 保存状态
    await browserAPI.storage.local.set({ trackingEnabled: enabled });
    console.log('[ActiveTimeTracker] 追踪状态:', enabled ? '开启' : '关闭');
}

async function isTrackingEnabled() {
    try {
        const result = await browserAPI.storage.local.get(['trackingEnabled']);
        return result.trackingEnabled !== false;
    } catch {
        return true;
    }
}

// =============================================================================
// 获取当前活跃会话（供前端查询）
// =============================================================================

async function getCurrentActiveSessions() {
    const result = [];
    const now = Date.now();

    if (!trackingBlockedCacheReady) {
        await refreshTrackingBlockedCache();
    }

    // 如果内存中没有活跃会话，尝试从永久存储读取
    if (activeSessions.size === 0) {
        try {
            const stored = await browserAPI.storage.local.get(['activeTrackingSessions', 'activeTrackingSessionsUpdatedAt']);
            const sessionsData = stored.activeTrackingSessions || [];
            const updatedAt = stored.activeTrackingSessionsUpdatedAt || 0;

            // 只有在数据较新时（15分钟内）才使用
            if (sessionsData.length > 0 && (now - updatedAt) < 15 * 60 * 1000) {
                console.log('[ActiveTimeTracker] 从永久存储读取活跃会话:', sessionsData.length, '个');

                for (const data of sessionsData) {
                    let tabUrlForThis = null;
                    let isAttributed = false;
                    try {
                        const tab = await browserAPI.tabs.get(data.tabId);
                        if (!tab || !tab.url) continue;
                        tabUrlForThis = tab.url;
                        isAttributed = data.matchType === 'auto_bookmark' || !!data.trackedUrl;
                        if (!isAttributed && tabUrlForThis !== data.url) continue;
                    } catch {
                        continue;
                    }

                    const urlForBlockCheck = isAttributed ? (tabUrlForThis || data.url) : data.url;
                    if (isTrackingBlockedByCache({ url: urlForBlockCheck, bookmarkId: data.bookmarkId })) {
                        continue;
                    }
                    // 计算时间差（从存储时间到现在的时间）
                    const timeSinceUpdate = now - updatedAt;

                    let currentActiveMs = data.accumulatedActiveMs || 0;
                    let currentIdleFocusMs = data.pauseTotalMs || 0;
                    let currentVisibleMs = data.visibleTotalMs || 0;
                    let currentBackgroundMs = data.backgroundTotalMs || 0;

                    // 根据存储时的状态，累加从存储到现在的时间
                    if (data.state === SessionState.ACTIVE) {
                        currentActiveMs += timeSinceUpdate;
                    } else if (data.state === SessionState.PAUSED) {
                        if (data.isBackground && !data.isSleeping) {
                            currentBackgroundMs += timeSinceUpdate;
                        } else if (data.isVisible) {
                            currentVisibleMs += timeSinceUpdate;
                        } else if (!data.isSleeping) {
                            currentIdleFocusMs += timeSinceUpdate;
                        }
                    }

                    // 计算综合时间
                    const compositeMs = currentActiveMs +
                        (currentIdleFocusMs * 0.8) +
                        (currentVisibleMs * 0.5) +
                        (currentBackgroundMs * 0.1);

                    // 使用原始开始时间计算总时长
                    const totalMs = now - (data.originalStartTime || data.startTime || now);
                    const activeRatio = totalMs > 0 ? currentActiveMs / totalMs : 0;

                    // 区分显示状态
                    const displayState = data.state === SessionState.ACTIVE ? 'active' :
                        (data.isSleeping ? 'sleeping' :
                            (data.isBackground ? 'background' :
                                (data.isVisible ? 'visible' : 'paused')));

                    result.push({
                        tabId: data.tabId,
                        url: data.trackedUrl || data.url,
                        title: data.title,
                        bookmarkId: data.bookmarkId,
                        state: displayState,
                        activeMs: currentActiveMs,
                        idleFocusMs: currentIdleFocusMs,
                        visibleMs: currentVisibleMs,
                        backgroundMs: currentBackgroundMs,
                        compositeMs: compositeMs,
                        totalMs: totalMs,
                        wakeCount: data.wakeCount || 0,
                        activeRatio: activeRatio,
                        isIdle: totalMs > 30 * 60 * 1000 && activeRatio < 0.15,
                        fromStorage: true  // 标记数据来源
                    });
                }

                return result;
            }
        } catch (error) {
            console.warn('[ActiveTimeTracker] 从永久存储读取失败:', error);
        }
    }

    // 从内存中读取（正常情况）
    for (const [tabId, session] of activeSessions) {
        if (session.state !== SessionState.INACTIVE && session.state !== SessionState.ENDED) {
            if (isTrackingBlockedByCache({ url: session.url, bookmarkId: session.bookmarkId })) {
                continue;
            }
            // 使用总累积时间（包括已保存的）
            let currentActiveMs = session.getTotalActiveMs();
            let currentIdleFocusMs = session.getTotalPauseMs();
            let currentVisibleMs = session.getTotalVisibleMs();
            let currentBackgroundMs = session.getTotalBackgroundMs();

            if (session.state === SessionState.ACTIVE && session.activeStartTime) {
                currentActiveMs += now - session.activeStartTime;
            }

            // 计算当前暂停期间的时间（睡眠状态不累积）
            if (session.state === SessionState.PAUSED && session.lastPauseTime && !session.isSleeping) {
                const pauseDuration = now - session.lastPauseTime;
                if (session.isBackground) {
                    currentBackgroundMs += pauseDuration;
                } else if (session.isVisible) {
                    currentVisibleMs += pauseDuration;
                } else {
                    currentIdleFocusMs += pauseDuration;
                }
            }

            // 计算综合时间：活跃×1.0 + 前台静止×0.8 + 可见参考×0.5 + 后台×0.1
            const compositeMs = currentActiveMs +
                (currentIdleFocusMs * 0.8) +
                (currentVisibleMs * 0.5) +
                (currentBackgroundMs * 0.1);

            // 计算尚未保存的时间（用于综合排行合并，避免与 trackingStats 重复）
            const unsavedActiveMs = session.accumulatedActiveMs + (session.state === SessionState.ACTIVE && session.activeStartTime ? now - session.activeStartTime : 0);
            const unsavedPauseMs = session.pauseTotalMs + (session.state === SessionState.PAUSED && session.lastPauseTime && !session.isSleeping && !session.isBackground && !session.isVisible ? now - session.lastPauseTime : 0);
            const unsavedVisibleMs = session.visibleTotalMs + (session.state === SessionState.PAUSED && session.lastPauseTime && session.isVisible ? now - session.lastPauseTime : 0);
            const unsavedBackgroundMs = session.backgroundTotalMs + (session.state === SessionState.PAUSED && session.lastPauseTime && session.isBackground ? now - session.lastPauseTime : 0);
            const unsavedCompositeMs = unsavedActiveMs + (unsavedPauseMs * 0.8) + (unsavedVisibleMs * 0.5) + (unsavedBackgroundMs * 0.1);
            const unsavedWakeCount = session.wakeCount;

            // 使用原始开始时间计算总时长
            const totalMs = now - (session.originalStartTime || session.startTime);
            const activeRatio = totalMs > 0 ? currentActiveMs / totalMs : 0;

            // 区分显示状态：active=活跃, paused=前台静止, visible=可见参考, background=后台, sleeping=睡眠
            const displayState = session.state === SessionState.ACTIVE ? 'active' :
                (session.isSleeping ? 'sleeping' :
                    (session.isBackground ? 'background' :
                        (session.isVisible ? 'visible' : 'paused')));

            result.push({
                tabId: session.tabId,
                url: session.getRecordUrl(),
                title: session.title,
                bookmarkId: session.bookmarkId,
                state: displayState,
                activeMs: currentActiveMs,
                idleFocusMs: currentIdleFocusMs,
                visibleMs: currentVisibleMs,
                backgroundMs: currentBackgroundMs,
                compositeMs: compositeMs,
                unsavedCompositeMs: unsavedCompositeMs,  // 尚未保存的时间
                unsavedWakeCount: unsavedWakeCount,      // 尚未保存的唤醒次数
                totalMs: totalMs,
                wakeCount: session.getTotalWakeCount(),
                activeRatio: activeRatio,
                isIdle: totalMs > 30 * 60 * 1000 && activeRatio < 0.15
            });
        }
    }

    return result;
}

// =============================================================================
// 初始化和导出
// =============================================================================

async function initialize() {
    console.log('[ActiveTimeTracker] 初始化...');

    // 读取恢复标志（恢复期间暂停重建缓存/删除清理）
    await syncBookmarkRestoringFlag();

    try {
        // 打开数据库
        await openDatabase();

        // 加载追踪状态
        trackingEnabled = await isTrackingEnabled();

        if (trackingEnabled) {
            // 重建书签缓存
            await rebuildBookmarkCache();
            await refreshTrackingBlockedCache();

            // 设置 idle 检测
            if (browserAPI.idle && browserAPI.idle.setDetectionInterval) {
                browserAPI.idle.setDetectionInterval(CONFIG.IDLE_DETECTION_INTERVAL);
            }

            // 先尝试从永久存储恢复会话状态（Service Worker 唤醒后恢复）
            const restoredCount = await restoreActiveSessionsFromStorage();

            // 初始化当前焦点窗口状态
            try {
                const focusedWindow = await browserAPI.windows.getLastFocused();
                if (focusedWindow && focusedWindow.focused) {
                    currentFocusedWindowId = focusedWindow.id;
                    currentWindowFocused = true;
                    console.log('[ActiveTimeTracker] 当前焦点窗口:', currentFocusedWindowId);

                    // 如果没有从存储恢复会话，则创建新会话
                    if (restoredCount === 0) {
                        const tabs = await browserAPI.tabs.query({ active: true, windowId: focusedWindow.id });
                        if (tabs[0] && tabs[0].url && !activeSessions.has(tabs[0].id)) {
                            const session = new SessionData(tabs[0].id, focusedWindow.id, tabs[0].url, tabs[0].title);
                            activeSessions.set(tabs[0].id, session);
                            const started = await startSessionWithAttributionFallback(tabs[0].id, session);
                            if (!started) {
                                activeSessions.delete(tabs[0].id);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[ActiveTimeTracker] 初始化焦点窗口失败:', e);
            }
        }

        // 启动定期保存定时器（防止浏览器崩溃丢失数据）
        startPeriodicSave();

        // 启动休眠检测（防止唤醒后计时不准）
        startSleepDetection();

        console.log('[ActiveTimeTracker] 初始化完成, 追踪状态:', trackingEnabled);
    } catch (error) {
        console.error('[ActiveTimeTracker] 初始化失败:', error);
    }
}

// 定期保存定时器
let periodicSaveTimer = null;

function startPeriodicSave() {
    if (periodicSaveTimer) {
        clearInterval(periodicSaveTimer);
    }

    periodicSaveTimer = setInterval(async () => {
        if (!trackingEnabled) return;

        // 保存所有活跃会话的快照（不结束会话）
        for (const [tabId, session] of activeSessions) {
            if (session.state === SessionState.ACTIVE || session.state === SessionState.PAUSED) {
                // 创建会话快照保存
                const snapshot = session.createSnapshot();
                if (snapshot && snapshot.accumulatedActiveMs >= CONFIG.MIN_ACTIVE_MS) {
                    await saveSession(snapshot);
                    // 重置会话累积时间（避免重复计算）
                    session.resetAccumulated();
                    console.log('[ActiveTimeTracker] 定期保存会话:', session.url);
                }
            }
        }

        // 同时持久化会话状态到永久存储（防止 Service Worker 休眠丢失）
        await persistActiveSessionsToStorage();
    }, CONFIG.PERIODIC_SAVE_INTERVAL);

    console.log('[ActiveTimeTracker] 定期保存已启动，间隔:', CONFIG.PERIODIC_SAVE_INTERVAL / 1000, '秒');
}

function stopPeriodicSave() {
    if (periodicSaveTimer) {
        clearInterval(periodicSaveTimer);
        periodicSaveTimer = null;
        console.log('[ActiveTimeTracker] 定期保存已停止');
    }
}

// 休眠检测定时器
let sleepDetectionTimer = null;
let lastHeartbeat = Date.now();

function startSleepDetection() {
    if (sleepDetectionTimer) {
        clearInterval(sleepDetectionTimer);
    }

    lastHeartbeat = Date.now();

    sleepDetectionTimer = setInterval(() => {
        const now = Date.now();
        const elapsed = now - lastHeartbeat;

        if (elapsed > CONFIG.SLEEP_THRESHOLD_MS) {
            console.log('[ActiveTimeTracker] 检测到休眠/唤醒，时间跳跃:', Math.round(elapsed / 1000), '秒');
            handleWakeFromSleep(elapsed);
        }

        lastHeartbeat = now;
    }, CONFIG.SLEEP_DETECTION_INTERVAL);

    console.log('[ActiveTimeTracker] 休眠检测已启动');
}

function stopSleepDetection() {
    if (sleepDetectionTimer) {
        clearInterval(sleepDetectionTimer);
        sleepDetectionTimer = null;
        console.log('[ActiveTimeTracker] 休眠检测已停止');
    }
}

function handleWakeFromSleep(sleepDuration) {
    // 唤醒后重置所有活跃会话的计时起点，避免多算休眠时间
    const now = Date.now();
    const wakeTime = now - sleepDuration;  // 休眠开始时间

    for (const [tabId, session] of activeSessions) {
        if (session.state === SessionState.ACTIVE && session.activeStartTime) {
            // 只累积休眠前的活跃时间
            const activeBeforeSleep = Math.max(0, wakeTime - session.activeStartTime);
            session.accumulatedActiveMs += activeBeforeSleep;
            // 重置起点为唤醒时间
            session.activeStartTime = now;
            console.log('[ActiveTimeTracker] 重置会话计时起点:', session.title || session.url,
                '累积活跃时间:', Math.round(session.accumulatedActiveMs / 1000), '秒');
        }

        if (session.state === SessionState.PAUSED && session.lastPauseTime) {
            // 暂停状态也需要重置，避免多算暂停时间
            const pauseBeforeSleep = Math.max(0, wakeTime - session.lastPauseTime);
            if (session.isBackground) {
                session.backgroundTotalMs += pauseBeforeSleep;
            } else if (session.isVisible) {
                session.visibleTotalMs += pauseBeforeSleep;
            } else {
                session.pauseTotalMs += pauseBeforeSleep;
            }
            session.lastPauseTime = now;
        }
    }
}

let eventListenersSetup = false;

function setupEventListeners() {
    if (!browserAPI) {
        console.error('[ActiveTimeTracker] browserAPI 不可用');
        return;
    }

    // 监听“批量变更/恢复/导入”标志变化（与 background.js 同步）
    try {
        if (browserAPI.storage && browserAPI.storage.onChanged) {
            browserAPI.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') return;
                if (changes.bookmarkRestoringFlag) {
                    bookmarkRestoringFlag = changes.bookmarkRestoringFlag.newValue === true;
                }
                if (changes.bookmarkBulkChangeFlag) {
                    bookmarkBulkChangeFlag = changes.bookmarkBulkChangeFlag.newValue === true;
                }
                if (changes.bookmarkImportingFlag) {
                    bookmarkImportingFlag = changes.bookmarkImportingFlag.newValue === true;
                }
            });
        }
    } catch (_) { }

    // 初次同步一次
    syncBookmarkRestoringFlag().catch(() => { });

    // 防止重复注册监听器
    if (eventListenersSetup) {
        console.log('[ActiveTimeTracker] 事件监听器已设置，跳过重复注册');
        return;
    }
    eventListenersSetup = true;

    // 标签页切换
    if (browserAPI.tabs && browserAPI.tabs.onActivated) {
        browserAPI.tabs.onActivated.addListener(handleTabActivated);
    }

    // URL/标题变化
    if (browserAPI.tabs && browserAPI.tabs.onUpdated) {
        browserAPI.tabs.onUpdated.addListener(handleTabUpdated);
    }

    // 时间追踪屏蔽变化
    if (browserAPI.storage && browserAPI.storage.onChanged) {
        browserAPI.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes.timetracking_blocked) return;
            updateTrackingBlockedCache(changes.timetracking_blocked.newValue || {});
            applyTrackingBlockedToActiveSessions();
        });
    }

    // 关闭标签页
    if (browserAPI.tabs && browserAPI.tabs.onRemoved) {
        browserAPI.tabs.onRemoved.addListener(handleTabRemoved);
    }

    // 窗口焦点变化
    if (browserAPI.windows && browserAPI.windows.onFocusChanged) {
        browserAPI.windows.onFocusChanged.addListener(handleWindowFocusChanged);
    }

    // 窗口关闭
    if (browserAPI.windows && browserAPI.windows.onRemoved) {
        browserAPI.windows.onRemoved.addListener(handleWindowRemoved);
    }

    // 电脑休眠/锁屏
    if (browserAPI.idle && browserAPI.idle.onStateChanged) {
        browserAPI.idle.onStateChanged.addListener(handleIdleStateChanged);
    }

    // 书签变化时重建缓存
    if (browserAPI.bookmarks) {
        const scheduleRebuildCache = () => {
            if (!trackingEnabled) return;
            if (shouldSuspendBookmarkCacheWork()) return;

            if (bookmarkCacheRebuildTimer) {
                clearTimeout(bookmarkCacheRebuildTimer);
            }

            // 防抖：把大量事件合并为一次重建（恢复/批量操作时尤其重要）
            bookmarkCacheRebuildTimer = setTimeout(() => {
                bookmarkCacheRebuildTimer = null;
                if (!trackingEnabled) return;
                if (shouldSuspendBookmarkCacheWork()) return;
                rebuildBookmarkCache();
            }, 1200);
        };

        if (browserAPI.bookmarks.onCreated) {
            browserAPI.bookmarks.onCreated.addListener(scheduleRebuildCache);
        }

        // 书签删除时：删除对应的时间记录，然后重建缓存
        if (browserAPI.bookmarks.onRemoved) {
            browserAPI.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
                if (shouldSuspendBookmarkCacheWork()) {
                    // 恢复/批量导入期间：跳过逐条清理，避免严重卡顿
                    return;
                }

                const node = removeInfo.node;
                if (node && node.url) {
                    // 删除该 URL 的时间记录
                    await deleteSessionsByUrl(node.url);
                    // 同时按标题删除（因为可能是通过标题匹配的）
                    if (node.title) {
                        await deleteSessionsByTitle(node.title);
                    }
                    // 结束该 URL 的活跃会话
                    for (const [tabId, session] of activeSessions) {
                        if (session.url === node.url || session.title === node.title) {
                            session.end();
                            activeSessions.delete(tabId);
                        }
                    }
                    console.log('[ActiveTimeTracker] 书签已删除，清理对应记录:', node.title || node.url);
                }
                scheduleRebuildCache();
            });
        }

        if (browserAPI.bookmarks.onChanged) {
            browserAPI.bookmarks.onChanged.addListener(scheduleRebuildCache);
        }
    }

    // Service Worker 暂停时保存所有活跃会话
    if (browserAPI.runtime && browserAPI.runtime.onSuspend) {
        browserAPI.runtime.onSuspend.addListener(async () => {
            console.log('[ActiveTimeTracker] Service Worker 即将暂停，保存活跃会话...');
            // 先持久化到永久存储（快速，确保不丢失）
            await persistActiveSessionsToStorage();
            // 再保存到数据库
            await saveAllActiveSessions();
        });
    }

    console.log('[ActiveTimeTracker] 事件监听器已设置');
}

// 由 background 侧驱动：把“书签打开(浏览器/扩展UI)”归因信息绑定到 tabId 上（不立刻强制追踪，按需兜底）
function noteAutoBookmarkNavigation({ tabId, bookmarkUrl, bookmarkId, bookmarkTitle, timeStamp, source } = {}) {
    if (typeof tabId !== 'number') return;
    if (!bookmarkUrl || typeof bookmarkUrl !== 'string') return;

    const payload = {
        bookmarkUrl,
        bookmarkId: bookmarkId || null,
        bookmarkTitle: bookmarkTitle || '',
        updatedAt: typeof timeStamp === 'number' ? timeStamp : Date.now(),
        source: typeof source === 'string' ? source : 'unknown'
    };
    autoBookmarkAttributionByTabId.set(tabId, payload);
}

// 导出
export {
    initialize,
    setupEventListeners,
    setTrackingEnabled,
    isTrackingEnabled,
    noteAutoBookmarkNavigation,
    getCurrentActiveSessions,
    getSessionsByUrl,
    getSessionsByTimeRange,
    getBookmarkActiveTimeStats,
    getTrackingStats,  // 获取累积统计（综合排行）
    rebuildBookmarkCache,
    clearAllSessions,  // 清除 IndexedDB（书签推荐用的数据）
    clearTrackingDisplayData,  // 清除显示数据（正在追踪 + 综合排行）- 兼容旧接口
    clearCurrentTrackingSessions,  // 仅清除正在追踪
    clearTrackingStatsByRange,  // 按时间范围清除综合排行
    syncTrackingData,  // 数据一致性检查
    deleteSessionsByUrl,
    deleteSessionsByTitle,
    saveAllActiveSessions,
    persistActiveSessionsToStorage,
    restoreActiveSessionsFromStorage
};
