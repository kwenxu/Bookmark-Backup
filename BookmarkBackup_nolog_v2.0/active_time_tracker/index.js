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
    DB_NAME: 'BookmarkActiveTimeDB',
    DB_VERSION: 1,
    STORE_NAME: 'active_sessions'
};

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
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.STORE_NAME);
            
            const record = {
                url: session.url,
                bookmarkId: session.bookmarkId || null,
                title: session.title || '',
                startTime: session.startTime,
                endTime: session.endTime || Date.now(),
                totalMs: (session.endTime || Date.now()) - session.startTime,
                activeMs: session.accumulatedActiveMs,
                pauseCount: session.pauseCount,
                pauseTotalMs: session.pauseTotalMs,
                source: 'tabs',
                matchType: session.matchType || 'url',
                tabId: session.tabId,
                windowId: session.windowId,
                createdAt: Date.now()
            };
            
            const request = store.add(record);
            
            request.onsuccess = () => {
                console.log('[ActiveTimeTracker] 会话已保存:', record.url, 
                    `活跃时间: ${Math.round(record.activeMs / 1000)}秒`);
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
                console.log('[ActiveTimeTracker] 所有会话记录已清除');
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

function normalizeUrl(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        let normalized = parsed.origin + parsed.pathname;
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

async function rebuildBookmarkCache() {
    bookmarkUrlSet.clear();
    bookmarkTitleSet.clear();
    bookmarkUrlToId.clear();
    
    try {
        const tree = await browserAPI.bookmarks.getTree();
        
        const traverse = (nodes) => {
            for (const node of nodes) {
                if (node.url) {
                    const normalizedUrl = normalizeUrl(node.url);
                    if (normalizedUrl) {
                        bookmarkUrlSet.add(normalizedUrl);
                        bookmarkUrlToId.set(normalizedUrl, node.id);
                    }
                    const normalizedTitle = normalizeTitle(node.title);
                    if (normalizedTitle) {
                        bookmarkTitleSet.add(normalizedTitle);
                    }
                }
                if (node.children) {
                    traverse(node.children);
                }
            }
        };
        
        traverse(tree);
        console.log('[ActiveTimeTracker] 书签缓存已重建:', 
            bookmarkUrlSet.size, 'URLs,', bookmarkTitleSet.size, 'Titles');
    } catch (error) {
        console.error('[ActiveTimeTracker] 重建书签缓存失败:', error);
    }
}

function isBookmarkUrl(url, title) {
    const normalizedUrl = normalizeUrl(url);
    const normalizedTitle = normalizeTitle(title);
    
    const urlMatch = normalizedUrl && bookmarkUrlSet.has(normalizedUrl);
    const titleMatch = normalizedTitle && bookmarkTitleSet.has(normalizedTitle);
    
    return {
        isBookmark: urlMatch || titleMatch,
        matchType: urlMatch && titleMatch ? 'both' : (urlMatch ? 'url' : (titleMatch ? 'title' : null)),
        bookmarkId: normalizedUrl ? bookmarkUrlToId.get(normalizedUrl) : null
    };
}

// =============================================================================
// 会话管理器
// =============================================================================

const activeSessions = new Map(); // tabId -> SessionData
let currentWindowFocused = true;
let currentFocusedWindowId = null; // 当前获得焦点的窗口ID
let currentIdleState = 'active';
let trackingEnabled = true;

class SessionData {
    constructor(tabId, windowId, url, title) {
        this.tabId = tabId;
        this.windowId = windowId;
        this.url = url;
        this.title = title;
        this.state = SessionState.INACTIVE;
        this.startTime = null;
        this.activeStartTime = null;
        this.accumulatedActiveMs = 0;
        this.pauseCount = 0;
        this.pauseTotalMs = 0;
        this.lastPauseTime = null;
        this.bookmarkId = null;
        this.matchType = null;
    }
    
    start() {
        if (this.state !== SessionState.INACTIVE) return;
        
        const match = isBookmarkUrl(this.url, this.title);
        if (!match.isBookmark) return;
        
        this.bookmarkId = match.bookmarkId;
        this.matchType = match.matchType;
        this.state = SessionState.ACTIVE;
        this.startTime = Date.now();
        this.activeStartTime = Date.now();
        
        console.log('[ActiveTimeTracker] 会话开始:', this.title || this.url);
    }
    
    pause() {
        if (this.state !== SessionState.ACTIVE) return;
        
        const now = Date.now();
        this.accumulatedActiveMs += now - this.activeStartTime;
        this.activeStartTime = null;
        this.lastPauseTime = now;
        this.pauseCount++;
        this.state = SessionState.PAUSED;
        
        console.log('[ActiveTimeTracker] 会话暂停:', this.title || this.url);
    }
    
    resume() {
        if (this.state !== SessionState.PAUSED) return;
        
        const now = Date.now();
        if (this.lastPauseTime) {
            this.pauseTotalMs += now - this.lastPauseTime;
        }
        this.activeStartTime = now;
        this.state = SessionState.ACTIVE;
        
        console.log('[ActiveTimeTracker] 会话恢复:', this.title || this.url);
    }
    
    end() {
        if (this.state === SessionState.INACTIVE || this.state === SessionState.ENDED) return null;
        
        const now = Date.now();
        
        if (this.state === SessionState.ACTIVE && this.activeStartTime) {
            this.accumulatedActiveMs += now - this.activeStartTime;
        }
        
        if (this.state === SessionState.PAUSED && this.lastPauseTime) {
            this.pauseTotalMs += now - this.lastPauseTime;
        }
        
        this.state = SessionState.ENDED;
        this.endTime = now;
        
        console.log('[ActiveTimeTracker] 会话结束:', this.title || this.url,
            `活跃时间: ${Math.round(this.accumulatedActiveMs / 1000)}秒`);
        
        return this;
    }
}

// =============================================================================
// 事件处理器
// =============================================================================

async function handleTabActivated(activeInfo) {
    if (!trackingEnabled) return;
    
    const { tabId, windowId } = activeInfo;
    
    // 暂停其他标签页的会话
    for (const [tid, session] of activeSessions) {
        if (tid !== tabId && session.state === SessionState.ACTIVE) {
            session.pause();
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
                session.start();
            } else if (session.state === SessionState.PAUSED) {
                session.resume();
            }
        }
    } catch (error) {
        // 标签页可能已关闭
    }
}

async function handleTabUpdated(tabId, changeInfo, tab) {
    if (!trackingEnabled) return;
    if (!changeInfo.url && !changeInfo.status) return;
    
    const session = activeSessions.get(tabId);
    
    if (changeInfo.url) {
        // URL 变化，结束旧会话
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
                const newSession = new SessionData(tabId, tab.windowId, changeInfo.url, tab.title);
                activeSessions.set(tabId, newSession);
                
                if (currentWindowFocused && currentIdleState === 'active') {
                    newSession.start();
                }
            }
        } catch (error) {
            // 忽略
        }
    }
    
    // 更新标题
    if (changeInfo.title && session) {
        session.title = changeInfo.title;
    }
}

async function handleTabRemoved(tabId, removeInfo) {
    const session = activeSessions.get(tabId);
    if (session) {
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
        // 焦点完全离开浏览器，暂停所有活跃会话
        for (const session of activeSessions.values()) {
            if (session.state === SessionState.ACTIVE) {
                session.pause();
            }
        }
    } else if (previousWindowId !== null && previousWindowId !== windowId) {
        // 从一个窗口切换到另一个窗口
        // 暂停旧窗口的活跃会话
        for (const session of activeSessions.values()) {
            if (session.windowId === previousWindowId && session.state === SessionState.ACTIVE) {
                session.pause();
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
        // 用户休眠，暂停所有会话
        for (const session of activeSessions.values()) {
            if (session.state === SessionState.ACTIVE) {
                session.pause();
            }
        }
    } else if (!wasActive && newState === 'active') {
        // 用户活跃，恢复当前会话
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
                session.resume();
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
                    session.resume();
                } else if (session.state === SessionState.INACTIVE && currentIdleState === 'active') {
                    session.start();
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

function getCurrentActiveSessions() {
    const result = [];
    
    for (const [tabId, session] of activeSessions) {
        if (session.state !== SessionState.INACTIVE && session.state !== SessionState.ENDED) {
            const now = Date.now();
            let currentActiveMs = session.accumulatedActiveMs;
            
            if (session.state === SessionState.ACTIVE && session.activeStartTime) {
                currentActiveMs += now - session.activeStartTime;
            }
            
            const totalMs = now - session.startTime;
            const activeRatio = totalMs > 0 ? currentActiveMs / totalMs : 0;
            
            result.push({
                tabId: session.tabId,
                url: session.url,
                title: session.title,
                bookmarkId: session.bookmarkId,
                state: session.state,
                activeMs: currentActiveMs,
                totalMs: totalMs,
                pauseCount: session.pauseCount,
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
    
    try {
        // 打开数据库
        await openDatabase();
        
        // 加载追踪状态
        trackingEnabled = await isTrackingEnabled();
        
        if (trackingEnabled) {
            // 重建书签缓存
            await rebuildBookmarkCache();
            
            // 设置 idle 检测
            if (browserAPI.idle && browserAPI.idle.setDetectionInterval) {
                browserAPI.idle.setDetectionInterval(CONFIG.IDLE_DETECTION_INTERVAL);
            }
            
            // 初始化当前焦点窗口状态
            try {
                const focusedWindow = await browserAPI.windows.getLastFocused();
                if (focusedWindow && focusedWindow.focused) {
                    currentFocusedWindowId = focusedWindow.id;
                    currentWindowFocused = true;
                    console.log('[ActiveTimeTracker] 当前焦点窗口:', currentFocusedWindowId);
                    
                    // 开始追踪当前活跃标签
                    const tabs = await browserAPI.tabs.query({ active: true, windowId: focusedWindow.id });
                    if (tabs[0] && tabs[0].url) {
                        const session = new SessionData(tabs[0].id, focusedWindow.id, tabs[0].url, tabs[0].title);
                        activeSessions.set(tabs[0].id, session);
                        session.start();
                    }
                }
            } catch (e) {
                console.warn('[ActiveTimeTracker] 初始化焦点窗口失败:', e);
            }
        }
        
        console.log('[ActiveTimeTracker] 初始化完成, 追踪状态:', trackingEnabled);
    } catch (error) {
        console.error('[ActiveTimeTracker] 初始化失败:', error);
    }
}

let eventListenersSetup = false;

function setupEventListeners() {
    if (!browserAPI) {
        console.error('[ActiveTimeTracker] browserAPI 不可用');
        return;
    }
    
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
    
    // 关闭标签页
    if (browserAPI.tabs && browserAPI.tabs.onRemoved) {
        browserAPI.tabs.onRemoved.addListener(handleTabRemoved);
    }
    
    // 窗口焦点变化
    if (browserAPI.windows && browserAPI.windows.onFocusChanged) {
        browserAPI.windows.onFocusChanged.addListener(handleWindowFocusChanged);
    }
    
    // 电脑休眠/锁屏
    if (browserAPI.idle && browserAPI.idle.onStateChanged) {
        browserAPI.idle.onStateChanged.addListener(handleIdleStateChanged);
    }
    
    // 书签变化时重建缓存
    if (browserAPI.bookmarks) {
        const rebuildCache = () => {
            if (trackingEnabled) {
                rebuildBookmarkCache();
            }
        };
        
        if (browserAPI.bookmarks.onCreated) {
            browserAPI.bookmarks.onCreated.addListener(rebuildCache);
        }
        if (browserAPI.bookmarks.onRemoved) {
            browserAPI.bookmarks.onRemoved.addListener(rebuildCache);
        }
        if (browserAPI.bookmarks.onChanged) {
            browserAPI.bookmarks.onChanged.addListener(rebuildCache);
        }
    }
    
    console.log('[ActiveTimeTracker] 事件监听器已设置');
}

// 导出
export {
    initialize,
    setupEventListeners,
    setTrackingEnabled,
    isTrackingEnabled,
    getCurrentActiveSessions,
    getSessionsByUrl,
    getSessionsByTimeRange,
    getBookmarkActiveTimeStats,
    rebuildBookmarkCache,
    clearAllSessions
};
