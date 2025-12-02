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
            
            // 计算综合时间：活跃×1.0 + 前台静止×0.8 + 可见参考×0.5 + 后台×0.1
            const compositeMs = session.accumulatedActiveMs + 
                (session.pauseTotalMs * 0.8) + 
                (session.visibleTotalMs * 0.5) +
                (session.backgroundTotalMs * 0.1);
            
            const record = {
                url: session.url,
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
            
            request.onsuccess = () => {
                console.log('[ActiveTimeTracker] 会话已保存:', record.url, 
                    `综合时间: ${Math.round(record.compositeMs / 1000)}秒`);
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
    bookmarkUrlToTitle.clear();
    bookmarkTitleToOriginal.clear();
    
    try {
        const tree = await browserAPI.bookmarks.getTree();
        
        const traverse = (nodes) => {
            for (const node of nodes) {
                if (node.url) {
                    const normalizedUrl = normalizeUrl(node.url);
                    if (normalizedUrl) {
                        bookmarkUrlSet.add(normalizedUrl);
                        bookmarkUrlToId.set(normalizedUrl, node.id);
                        bookmarkUrlToTitle.set(normalizedUrl, node.title);  // URL -> 书签标题
                    }
                    const normalizedTitle = normalizeTitle(node.title);
                    if (normalizedTitle) {
                        bookmarkTitleSet.add(normalizedTitle);
                        bookmarkTitleToOriginal.set(normalizedTitle, node.title);  // 存储原始标题
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
    
    // 并集匹配：URL 或 标题 匹配任一即可
    const urlMatch = normalizedUrl && bookmarkUrlSet.has(normalizedUrl);
    const titleMatch = normalizedTitle && bookmarkTitleSet.has(normalizedTitle);
    
    // 获取书签的原始标题（URL匹配或标题匹配都要获取）
    let bookmarkTitle = null;
    if (urlMatch) {
        bookmarkTitle = bookmarkUrlToTitle.get(normalizedUrl);
    } else if (titleMatch) {
        bookmarkTitle = bookmarkTitleToOriginal.get(normalizedTitle);
    }
    
    return {
        isBookmark: urlMatch || titleMatch,
        matchType: urlMatch && titleMatch ? 'both' : (urlMatch ? 'url' : (titleMatch ? 'title' : null)),
        bookmarkId: normalizedUrl ? bookmarkUrlToId.get(normalizedUrl) : null,
        bookmarkTitle: bookmarkTitle  // 返回书签的原始标题
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
    }
    
    start() {
        if (this.state !== SessionState.INACTIVE) return;
        
        const match = isBookmarkUrl(this.url, this.title);
        if (!match.isBookmark) return;
        
        this.bookmarkId = match.bookmarkId;
        this.matchType = match.matchType;
        // 使用书签的原始标题（如果有的话）
        if (match.bookmarkTitle) {
            this.title = match.bookmarkTitle;
        }
        this.state = SessionState.ACTIVE;
        this.startTime = Date.now();
        this.activeStartTime = Date.now();
        this.isBackground = false;
        
        console.log('[ActiveTimeTracker] 会话开始:', this.title || this.url);
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
            let currentIdleFocusMs = session.pauseTotalMs;
            let currentVisibleMs = session.visibleTotalMs;
            let currentBackgroundMs = session.backgroundTotalMs;
            
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
            
            const totalMs = now - session.startTime;
            const activeRatio = totalMs > 0 ? currentActiveMs / totalMs : 0;
            
            // 区分显示状态：active=活跃, paused=前台静止, visible=可见参考, background=后台, sleeping=睡眠
            const displayState = session.state === SessionState.ACTIVE ? 'active' : 
                (session.isSleeping ? 'sleeping' :
                (session.isBackground ? 'background' : 
                (session.isVisible ? 'visible' : 'paused')));
            
            result.push({
                tabId: session.tabId,
                url: session.url,
                title: session.title,
                bookmarkId: session.bookmarkId,
                state: displayState,
                activeMs: currentActiveMs,
                idleFocusMs: currentIdleFocusMs,
                visibleMs: currentVisibleMs,
                backgroundMs: currentBackgroundMs,
                compositeMs: compositeMs,
                totalMs: totalMs,
                wakeCount: session.wakeCount,
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
        
        // 书签删除时：删除对应的时间记录，然后重建缓存
        if (browserAPI.bookmarks.onRemoved) {
            browserAPI.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
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
                rebuildCache();
            });
        }
        
        if (browserAPI.bookmarks.onChanged) {
            browserAPI.bookmarks.onChanged.addListener(rebuildCache);
        }
    }
    
    // Service Worker 暂停时保存所有活跃会话
    if (browserAPI.runtime && browserAPI.runtime.onSuspend) {
        browserAPI.runtime.onSuspend.addListener(() => {
            console.log('[ActiveTimeTracker] Service Worker 即将暂停，保存活跃会话...');
            saveAllActiveSessions();
        });
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
    clearAllSessions,
    deleteSessionsByUrl,
    deleteSessionsByTitle,
    saveAllActiveSessions
};
