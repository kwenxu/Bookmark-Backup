// =============================================================================
// 全局变量和常量
// =============================================================================

let currentLang = 'zh_CN';
let currentTheme = 'light';
// 从 localStorage 立即恢复视图，避免页面闪烁
let currentView = (() => {
    try {
        const saved = localStorage.getItem('lastActiveView');
        console.log('[全局初始化] localStorage中的视图:', saved);
        return saved || 'current-changes';
    } catch (e) {
        console.error('[全局初始化] 读取localStorage失败:', e);
        return 'current-changes';
    }
})();

// 用于避免重复在一次备份后多次重置（基于最近一条备份记录的指纹或时间）
window.__lastResetFingerprint = window.__lastResetFingerprint || null;

// 在 Canvas 永久栏目中，清理所有颜色标识与动作徽标，不改变布局/滚动/展开状态
function resetPermanentSectionChangeMarkers() {
    try {
        const permanentSection = document.getElementById('permanentSection');
        if (!permanentSection) return;

        // 仅作用于永久栏目的树
        const tree = permanentSection.querySelector('#bookmarkTree');
        if (!tree) return;

        // 记录并恢复栏目内滚动位置，避免影响当前位置视图
        const body = permanentSection.querySelector('.permanent-section-body');
        const prevScrollTop = body ? body.scrollTop : null;

        // 1) 红色（deleted）项目：直接移除对应的 .tree-node
        tree.querySelectorAll('.tree-item.tree-change-deleted').forEach(item => {
            const node = item.closest('.tree-node');
            if (node && node.parentNode) node.parentNode.removeChild(node);
        });

        // 2) 清理其余颜色标识类和内联样式、徽标
        const changeClasses = ['tree-change-added', 'tree-change-modified', 'tree-change-moved', 'tree-change-mixed', 'tree-change-deleted'];
        const selector = changeClasses.map(c => `.tree-item.${c}`).join(',');
        tree.querySelectorAll(selector).forEach(item => {
            changeClasses.forEach(c => item.classList.remove(c));
            const link = item.querySelector('.tree-bookmark-link');
            const label = item.querySelector('.tree-label');
            if (link) { link.style.color = ''; link.style.fontWeight = ''; link.style.textDecoration = ''; link.style.opacity = ''; }
            if (label) { label.style.color = ''; label.style.fontWeight = ''; label.style.textDecoration = ''; label.style.opacity = ''; }
            const badges = item.querySelector('.change-badges');
            if (badges) badges.innerHTML = '';
        });

        if (body != null && prevScrollTop != null) body.scrollTop = prevScrollTop;
        console.log('[Canvas] 永久栏目颜色标识已清理完毕');
    } catch (e) {
        console.warn('[Canvas] 清理永久栏目标识时出错:', e);
    }
}
console.log('[全局初始化] currentView初始值:', currentView);
let currentFilter = 'all';
let currentTimeFilter = 'all'; // 'all', 'year', 'month', 'day'
let allBookmarks = [];
let syncHistory = [];
let lastBackupTime = null;
let currentBookmarkData = null;
let browsingClickRankingStats = null; // 点击排行缓存（基于浏览器历史记录）

const bookmarkUrlSet = new Set();
const bookmarkTitleSet = new Set(); // 书签标题集合（用于标题匹配的实时刷新）
let pendingHistoryRefreshTimer = null;
let pendingHistoryRefreshForceFull = false;

const DATA_CACHE_KEYS = {
    additions: 'bb_cache_additions_v1'
};

let additionsCacheRestored = false;
let saveAdditionsCacheTimer = null;
let browsingHistoryRefreshPromise = null;

// 预加载缓存
let cachedBookmarkTree = null;
let cachedCurrentChanges = null;
let isPreloading = false;

// 图标预加载缓存
const preloadedIcons = new Map();
const iconPreloadQueue = [];

// Favicon 缓存管理（持久化 + 失败缓存）
const FaviconCache = {
    db: null,
    dbName: 'BookmarkFaviconCache',
    dbVersion: 1,
    storeName: 'favicons',
    failureStoreName: 'failures',
    memoryCache: new Map(), // {url: faviconDataUrl}
    failureCache: new Set(), // 失败的域名集合
    pendingRequests: new Map(), // 正在请求的URL，避免重复请求

    // 初始化 IndexedDB
    async init() {
        if (this.db) return;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建成功缓存的存储
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'domain' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // 创建失败缓存的存储
                if (!db.objectStoreNames.contains(this.failureStoreName)) {
                    const failureStore = db.createObjectStore(this.failureStoreName, { keyPath: 'domain' });
                    failureStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    },

    // 检查URL是否为本地/内网/明显无效
    isInvalidUrl(url) {
        if (!url || typeof url !== 'string') return true;

        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            // 本地地址
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                return true;
            }

            // 内网地址
            if (hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/)) {
                return true;
            }

            // .local 域名
            if (hostname.endsWith('.local')) {
                return true;
            }

            // 文件协议等
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return true;
            }

            return false;
        } catch (e) {
            return true;
        }
    },

    // 从缓存获取favicon
    async get(url) {
        if (this.isInvalidUrl(url)) {
            return null;
        }

        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // 检查失败缓存
            if (this.failureCache.has(domain)) {
                return 'failed';
            }

            // 检查内存缓存
            if (this.memoryCache.has(domain)) {
                return this.memoryCache.get(domain);
            }

            // 从 IndexedDB 读取
            if (!this.db) await this.init();

            return new Promise((resolve) => {
                const transaction = this.db.transaction([this.storeName, this.failureStoreName], 'readonly');

                // 先检查失败缓存
                const failureStore = transaction.objectStore(this.failureStoreName);
                const failureRequest = failureStore.get(domain);

                failureRequest.onsuccess = () => {
                    if (failureRequest.result) {
                        // 检查失败缓存是否过期（7天）
                        const age = Date.now() - failureRequest.result.timestamp;
                        if (age < 7 * 24 * 60 * 60 * 1000) {
                            this.failureCache.add(domain);
                            resolve('failed');
                            return;
                        }
                    }

                    // 检查成功缓存
                    const store = transaction.objectStore(this.storeName);
                    const request = store.get(domain);

                    request.onsuccess = () => {
                        if (request.result) {
                            // 永久缓存，不检查过期（只有删除书签时才删除缓存）
                            this.memoryCache.set(domain, request.result.dataUrl);
                            resolve(request.result.dataUrl);
                        } else {
                            resolve(null);
                        }
                    };

                    request.onerror = () => resolve(null);
                };

                failureRequest.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    },

    // 保存favicon到缓存
    async save(url, dataUrl) {
        if (this.isInvalidUrl(url)) return;

        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // 更新内存缓存
            this.memoryCache.set(domain, dataUrl);

            // 保存到 IndexedDB
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            store.put({
                domain: domain,
                dataUrl: dataUrl,
                timestamp: Date.now()
            });

            // 从失败缓存中移除（如果存在）
            this.failureCache.delete(domain);
            this.removeFailure(domain);

        } catch (e) {
            // 静默处理
        }
    },

    // 记录失败
    async saveFailure(url) {
        if (this.isInvalidUrl(url)) return;

        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // 更新内存缓存
            this.failureCache.add(domain);

            // 保存到 IndexedDB
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.failureStoreName], 'readwrite');
            const store = transaction.objectStore(this.failureStoreName);

            store.put({
                domain: domain,
                timestamp: Date.now()
            });

        } catch (e) {
            // 静默处理
        }
    },

    // 移除失败记录（当URL被修改时）
    async removeFailure(domain) {
        try {
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.failureStoreName], 'readwrite');
            const store = transaction.objectStore(this.failureStoreName);
            store.delete(domain);
        } catch (e) {
            // 静默失败
        }
    },

    // 清除特定URL的缓存（用于书签URL修改时）
    async clear(url) {
        if (this.isInvalidUrl(url)) return;

        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // 清除内存缓存
            this.memoryCache.delete(domain);
            this.failureCache.delete(domain);

            // 清除 IndexedDB
            if (!this.db) await this.init();

            const transaction = this.db.transaction([this.storeName, this.failureStoreName], 'readwrite');
            transaction.objectStore(this.storeName).delete(domain);
            transaction.objectStore(this.failureStoreName).delete(domain);

        } catch (e) {
            // 静默处理
        }
    },

    // 获取favicon（带缓存和请求合并）
    async fetch(url) {
        if (this.isInvalidUrl(url)) {
            return fallbackIcon;
        }

        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            // 1. 检查缓存
            const cached = await this.get(url);
            if (cached === 'failed') {
                return fallbackIcon;
            }
            if (cached) {
                return cached;
            }

            // 2. 检查是否已有相同请求在进行中（避免重复请求）
            if (this.pendingRequests.has(domain)) {
                return this.pendingRequests.get(domain);
            }

            // 3. 发起新请求
            const requestPromise = this._fetchFavicon(url);
            this.pendingRequests.set(domain, requestPromise);

            try {
                const result = await requestPromise;
                return result;
            } finally {
                this.pendingRequests.delete(domain);
            }

        } catch (e) {
            return fallbackIcon;
        }
    },

    // 实际请求favicon - 多源降级策略
    // 注意：不再直接请求网站的 /favicon.ico，因为某些网站（如需要认证的网站）
    // 可能返回 HTML 页面而非图标，导致浏览器解析其中的 preload 标签并产生警告
    async _fetchFavicon(url) {
        return new Promise(async (resolve) => {
            try {
                const urlObj = new URL(url);
                const domain = urlObj.hostname;

                // 定义多个 favicon 源，按优先级尝试
                // 只使用第三方服务，避免直接请求可能返回 HTML 的网站
                const faviconSources = [
                    // 1. DuckDuckGo（全球可用，国内可访问，推荐首选）
                    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
                    // 2. Google S2（功能强大，但中国大陆被墙）
                    `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
                ];

                // 尝试每个源
                for (let i = 0; i < faviconSources.length; i++) {
                    const faviconUrl = faviconSources[i];
                    const sourceName = ['DuckDuckGo', 'Google S2'][i];

                    const result = await this._tryLoadFavicon(faviconUrl, url, sourceName);
                    if (result && result !== fallbackIcon) {
                        resolve(result);
                        return;
                    }
                }

                // 所有源都失败，记录失败并返回 fallback（静默）
                this.saveFailure(url);
                resolve(fallbackIcon);

            } catch (e) {
                // 静默处理错误
                this.saveFailure(url);
                resolve(fallbackIcon);
            }
        });
    },

    // 尝试从单个源加载 favicon
    async _tryLoadFavicon(faviconUrl, originalUrl, sourceName) {
        return new Promise((resolve) => {
            const img = new Image();
            // 不设置 crossOrigin，避免 CORS 预检请求导致的错误
            // img.crossOrigin = 'anonymous';

            const timeout = setTimeout(() => {
                img.src = '';
                resolve(null); // 超时，尝试下一个源
            }, 3000); // 每个源最多等待3秒

            img.onload = () => {
                clearTimeout(timeout);

                // 检查是否是有效的图片（某些服务器返回1x1的占位图）
                if (img.width < 8 || img.height < 8) {
                    resolve(null);
                    return;
                }

                // 尝试转换为 Base64（可能因 CORS 失败，但不显示错误）
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL('image/png');

                    // 保存到缓存
                    this.save(originalUrl, dataUrl);
                    resolve(dataUrl);
                } catch (e) {
                    // CORS 限制，直接使用原 URL（静默处理，不输出日志）
                    this.save(originalUrl, faviconUrl);
                    resolve(faviconUrl);
                }
            };

            img.onerror = () => {
                clearTimeout(timeout);
                resolve(null); // 失败，尝试下一个源
            };

            img.src = faviconUrl;
        });
    }
};

// 浏览器 API 兼容性
const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;

function getCacheStorageArea() {
    try {
        if (browserAPI && browserAPI.storage && browserAPI.storage.local) {
            return browserAPI.storage.local;
        }
    } catch (_) {
        // ignore
    }
    return null;
}

function readCachedValue(key) {
    return new Promise((resolve) => {
        const storageArea = getCacheStorageArea();
        if (storageArea) {
            storageArea.get([key], (result) => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    console.warn('[Cache] 读取失败:', browserAPI.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                resolve(result ? result[key] : null);
            });
            return;
        }

        try {
            const raw = localStorage.getItem(key);
            resolve(raw ? JSON.parse(raw) : null);
        } catch (error) {
            console.warn('[Cache] 读取 localStorage 失败:', error);
            resolve(null);
        }
    });
}

function writeCachedValue(key, value) {
    return new Promise((resolve) => {
        const storageArea = getCacheStorageArea();
        if (storageArea) {
            storageArea.set({ [key]: value }, () => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    console.warn('[Cache] 写入失败:', browserAPI.runtime.lastError.message);
                }
                resolve();
            });
            return;
        }

        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('[Cache] 写入 localStorage 失败:', error);
        }
        resolve();
    });
}

function normalizeBookmarkCacheEntry(entry) {
    if (!entry || !entry.url) return null;
    const timestamp = typeof entry.dateAdded === 'number'
        ? entry.dateAdded
        : (entry.dateAdded instanceof Date ? entry.dateAdded.getTime() : Date.now());
    return {
        id: entry.id,
        title: entry.title || entry.url || '',
        url: entry.url || '',
        dateAdded: timestamp,
        parentId: entry.parentId || '',
        path: entry.path || ''
    };
}

async function ensureAdditionsCacheLoaded(skipRender) {
    if (additionsCacheRestored || allBookmarks.length > 0) {
        return;
    }
    try {
        const cached = await readCachedValue(DATA_CACHE_KEYS.additions);
        if (cached && Array.isArray(cached.bookmarks)) {
            allBookmarks = cached.bookmarks
                .map(normalizeBookmarkCacheEntry)
                .filter(Boolean);
            additionsCacheRestored = true;
            rebuildBookmarkUrlSet();
            console.log('[AdditionsCache] 已从缓存恢复记录:', allBookmarks.length);
            if (!skipRender) {
                renderAdditionsView();
            }
        }
    } catch (error) {
        console.warn('[AdditionsCache] 恢复失败:', error);
    }
}

async function persistAdditionsCache() {
    try {
        const payload = {
            timestamp: Date.now(),
            bookmarks: allBookmarks.map(normalizeBookmarkCacheEntry).filter(Boolean)
        };
        await writeCachedValue(DATA_CACHE_KEYS.additions, payload);
        console.log('[AdditionsCache] 已保存:', payload.bookmarks.length);
    } catch (error) {
        console.warn('[AdditionsCache] 保存失败:', error);
    }
}

function scheduleAdditionsCacheSave() {
    if (saveAdditionsCacheTimer) {
        clearTimeout(saveAdditionsCacheTimer);
    }
    saveAdditionsCacheTimer = setTimeout(() => {
        saveAdditionsCacheTimer = null;
        persistAdditionsCache();
    }, 600);
}

function handleAdditionsDataMutation(forceRender = true) {
    additionsCacheRestored = true;
    scheduleAdditionsCacheSave();
    if (forceRender && currentView === 'additions') {
        renderAdditionsView();
    }
}

function addBookmarkToAdditionsCache(bookmark) {
    const normalized = normalizeBookmarkCacheEntry(bookmark);
    if (!normalized) return;
    allBookmarks.push(normalized);
    addUrlToBookmarkSet(normalized.url);
    const normalizedTitle = normalizeBookmarkTitle(normalized.title);
    if (normalizedTitle) {
        bookmarkTitleSet.add(normalizedTitle);
    }
    handleAdditionsDataMutation(true);
}

function removeBookmarkFromAdditionsCache(bookmarkId) {
    if (!bookmarkId) return;
    const index = allBookmarks.findIndex(item => item.id === bookmarkId);
    if (index === -1) return;
    removeUrlFromBookmarkSet(allBookmarks[index].url);
    allBookmarks.splice(index, 1);
    handleAdditionsDataMutation(true);
}

function updateBookmarkInAdditionsCache(bookmarkId, changeInfo = {}) {
    if (!bookmarkId) return;
    const target = allBookmarks.find(item => item.id === bookmarkId);
    if (!target) return;
    const prevUrl = target.url;
    if (typeof changeInfo.title !== 'undefined') {
        target.title = changeInfo.title;
        const normalizedTitle = normalizeBookmarkTitle(changeInfo.title);
        if (normalizedTitle) {
            bookmarkTitleSet.add(normalizedTitle);
        }
    }
    if (typeof changeInfo.url !== 'undefined') {
        target.url = changeInfo.url;
        removeUrlFromBookmarkSet(prevUrl);
        addUrlToBookmarkSet(changeInfo.url);
    }
    handleAdditionsDataMutation(true);
}

function moveBookmarkInAdditionsCache(bookmarkId, moveInfo = {}) {
    if (!bookmarkId) return;
    const target = allBookmarks.find(item => item.id === bookmarkId);
    if (!target) return;
    if (typeof moveInfo.parentId !== 'undefined') {
        target.parentId = moveInfo.parentId;
    }
    handleAdditionsDataMutation(false);
}

function normalizeBookmarkTitle(title) {
    if (!title || typeof title !== 'string') return null;
    const trimmed = title.trim();
    return trimmed || null;
}

function normalizeBookmarkUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return null;
    }
    return url.trim();
}

function rebuildBookmarkUrlSet() {
    bookmarkUrlSet.clear();
    bookmarkTitleSet.clear();
    allBookmarks.forEach(item => {
        const normalized = normalizeBookmarkUrl(item.url);
        if (normalized) {
            bookmarkUrlSet.add(normalized);
        }
        const normalizedTitle = normalizeBookmarkTitle(item.title);
        if (normalizedTitle) {
            bookmarkTitleSet.add(normalizedTitle);
        }
    });
}

function addUrlToBookmarkSet(url) {
    const normalized = normalizeBookmarkUrl(url);
    if (normalized) {
        bookmarkUrlSet.add(normalized);
    }
}

function removeUrlFromBookmarkSet(url) {
    const normalized = normalizeBookmarkUrl(url);
    if (normalized) {
        bookmarkUrlSet.delete(normalized);
    }
}

function scheduleHistoryRefresh({ forceFull = false } = {}) {
    console.log('[History] 安排刷新，forceFull:', forceFull);
    pendingHistoryRefreshForceFull = pendingHistoryRefreshForceFull || forceFull;
    if (pendingHistoryRefreshTimer) {
        clearTimeout(pendingHistoryRefreshTimer);
    }
    pendingHistoryRefreshTimer = setTimeout(() => {
        console.log('[History] 执行刷新，forceFull:', pendingHistoryRefreshForceFull);
        pendingHistoryRefreshTimer = null;
        const shouldForce = pendingHistoryRefreshForceFull;
        pendingHistoryRefreshForceFull = false;
        refreshBrowsingHistoryData({ forceFull: shouldForce, silent: true });
    }, 500);
}

function handleHistoryVisited(result) {
    if (!result || !result.url) return;
    console.log('[History] onVisited:', result.url, 'title:', result.title);
    // 不在这里做 URL/标题过滤，统一交给 BrowsingHistoryCalendar.loadBookmarkData()
    // 中的 URL + 标题并集规则处理（增量只扫描 lastSyncTime 之后的历史）。
    scheduleHistoryRefresh({ forceFull: false });
}

function handleHistoryVisitRemoved(details) {
    if (!details) return;
    console.log('[History] onVisitRemoved:', details);

    // 无论是清除所有历史，还是删除特定URL，都可能影响：
    // - 通过 URL 匹配到的点击记录
    // - 仅通过标题匹配到的点击记录
    // 因此这里一律触发一次全量重建（仅限最近一年的点击记录）。
    scheduleHistoryRefresh({ forceFull: true });
}

let historyRealtimeBound = false;
function setupBrowsingHistoryRealtimeListeners() {
    if (historyRealtimeBound) {
        console.log('[History] 实时监听器已绑定，跳过');
        return;
    }
    if (!browserAPI.history) {
        console.warn('[History] 浏览器历史API不可用');
        return;
    }
    if (browserAPI.history.onVisited && typeof browserAPI.history.onVisited.addListener === 'function') {
        console.log('[History] 绑定 onVisited 监听器');
        browserAPI.history.onVisited.addListener(handleHistoryVisited);
        historyRealtimeBound = true;
    }
    if (browserAPI.history.onVisitRemoved && typeof browserAPI.history.onVisitRemoved.addListener === 'function') {
        console.log('[History] 绑定 onVisitRemoved 监听器');
        browserAPI.history.onVisitRemoved.addListener(handleHistoryVisitRemoved);
    }
}

async function refreshBrowsingHistoryData(options = {}) {
    const { forceFull = false, silent = false } = options;
    const inst = window.browsingHistoryCalendarInstance;
    if (!inst || typeof inst.loadBookmarkData !== 'function') {
        return;
    }

    if (browsingHistoryRefreshPromise) {
        try {
            await browsingHistoryRefreshPromise;
        } catch (_) {
            // ignore
        }
    }

    // 如果已经有 lastSyncTime，则可以安全地做增量更新
    const incremental = !forceFull && !!(inst.historyCacheMeta && inst.historyCacheMeta.lastSyncTime);
    browsingHistoryRefreshPromise = (async () => {
        try {
            await inst.loadBookmarkData({ incremental });
            
            // 重建 bookmarkUrlSet（用于实时更新判断）
            if (typeof rebuildBookmarkUrlSet === 'function' && allBookmarks.length > 0) {
                rebuildBookmarkUrlSet();
            }
            
            if (typeof inst.render === 'function') {
                inst.render();
            }
            if (typeof inst.updateSelectModeButton === 'function') {
                inst.updateSelectModeButton();
            }
            
            // 清除缓存，让下次加载时重新获取
            browsingClickRankingStats = null;
            
            // 注意：不在这里直接调用 refresh 函数，而是依赖事件系统
            // 日历的 announceHistoryDataUpdated() 会派发 browsingHistoryCacheUpdated 事件
            // 事件监听器会调用 refreshActiveBrowsingRankingIfVisible() 和 refreshBrowsingRelatedHistory()
        } catch (error) {
            if (!silent) {
                console.warn('[BrowsingHistory] 刷新失败:', error);
            }
            throw error;
        } finally {
            browsingHistoryRefreshPromise = null;
        }
    })();

    try {
        await browsingHistoryRefreshPromise;
    } catch (_) {
        // already logged
    }
}

// 实时更新状态控制
let viewerInitialized = false;
let deferredAnalysisMessage = null;
let messageListenerRegistered = false;
let realtimeUpdateInProgress = false;
let pendingAnalysisMessage = null;
let lastAnalysisSignature = null;
// 显式移动集合（基于 onMoved 事件），用于同级移动标识，设置短期有效期
let explicitMovedIds = new Map(); // id -> expiryTimestamp

// 详情面板相关全局变量
let currentDetailRecordTime = null; // 当前打开的详情面板对应的记录时间

// =============================================================================
// 辅助函数 - URL 处理
// =============================================================================

// 安全地获取网站图标 URL（同步版本，用于兼容旧代码）
// 注意：这个函数会触发后台异步加载，初次调用返回fallbackIcon
function getFaviconUrl(url) {
    if (!url) return fallbackIcon;

    // 验证是否是有效的 HTTP/HTTPS URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return fallbackIcon;
    }

    // 检查是否是无效URL
    if (FaviconCache.isInvalidUrl(url)) {
        return fallbackIcon;
    }

    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        // 【关键修复】先检查内存缓存（在 renderTreeView 时已预热）
        if (FaviconCache.memoryCache.has(domain)) {
            return FaviconCache.memoryCache.get(domain);
        }

        // 检查失败缓存
        if (FaviconCache.failureCache.has(domain)) {
            return fallbackIcon;
        }

        // 触发后台异步加载（不等待结果）
        // 注意：由于在 renderTreeView 时已经预热了缓存，
        // 这里只是作为兜底机制，处理动态添加的书签
        FaviconCache.fetch(url).then(dataUrl => {
            // 加载完成后，查找并更新所有使用这个URL的img标签
            if (dataUrl && dataUrl !== fallbackIcon) {
                updateFaviconImages(url, dataUrl);
            }
        });

        // 立即返回 fallback 图标作为占位符
        return fallbackIcon;
    } catch (error) {
        return fallbackIcon;
    }
}

// 更新页面上所有指定URL的favicon图片
function updateFaviconImages(url, dataUrl) {
    let updatedCount = 0;
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        // 查找所有相关的img标签（通过data-favicon-domain或父元素的data-node-url）
        const allImages = document.querySelectorAll('img.tree-icon, img.addition-icon, img.change-tree-item-icon, img.canvas-bookmark-icon, img.tracking-favicon, img.ranking-favicon');

        allImages.forEach(img => {
            // 检查是否是fallback图标（SVG data URL）且对应的书签URL匹配
            const isFallback = img.src.startsWith('data:image/svg+xml') || img.src === fallbackIcon;
            const item = img.closest('[data-node-url], [data-bookmark-url]');

            if (item) {
                const itemUrl = item.dataset.nodeUrl || item.dataset.bookmarkUrl;
                if (itemUrl) {
                    try {
                        const itemDomain = new URL(itemUrl).hostname;
                        if (itemDomain === domain) {
                            // 更新图标（不管是否是fallback，都更新为最新的）
                            img.src = dataUrl;
                            updatedCount++;
                        }
                    } catch (e) {
                        // 忽略无效URL
                    }
                }
            }
        });
    } catch (e) {
        // 静默处理
    }
    return updatedCount;
}

// 全局图片错误处理（使用事件委托，避免CSP内联事件处理器）
function setupGlobalImageErrorHandler() {
    document.addEventListener('error', (e) => {
        if (e.target.tagName === 'IMG' &&
            (e.target.classList.contains('tree-icon') ||
                e.target.classList.contains('addition-icon') ||
                e.target.classList.contains('change-tree-item-icon') ||
                e.target.classList.contains('canvas-bookmark-icon') ||
                e.target.classList.contains('tracking-favicon') ||
                e.target.classList.contains('ranking-favicon'))) {
            // 只在src不是fallbackIcon时才替换，避免无限循环
            // fallbackIcon 是 data URL，不会加载失败
            if (e.target.src !== fallbackIcon && !e.target.src.startsWith('data:image/svg+xml')) {
                e.target.src = fallbackIcon;
            }
        }
    }, true); // 使用捕获阶段
}

// 异步获取favicon（推荐使用，支持完整缓存）
async function getFaviconUrlAsync(url) {
    if (!url) return fallbackIcon;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return fallbackIcon;
    }

    return await FaviconCache.fetch(url);
}

// Fallback 图标 - 星标书签图标
const fallbackIcon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath fill=%22%23999%22 d=%22M8 0l2.8 5.5 6.2 0.5-4.5 4 1.5 6-5.5-3.5-5.5 3.5 1.5-6-4.5-4 6.2-0.5z%22/%3E%3C/svg%3E';

// =============================================================================
// 国际化文本
// =============================================================================

const i18n = {
    pageTitle: {
        'zh_CN': '备份历史查看器',
        'en': 'Backup History Viewer'
    },
    pageSubtitle: {
        'zh_CN': '类似 Git 的书签变化追踪',
        'en': 'Git-like Bookmark Change Tracking'
    },
    searchPlaceholder: {
        'zh_CN': '搜索书签、文件夹...',
        'en': 'Search bookmarks, folders...'
    },
    helpTooltip: {
        'zh_CN': '开源信息与快捷键',
        'en': 'Open Source Info & Shortcuts'
    },
    navCurrentChanges: {
        'zh_CN': '当前 数量/结构 变化',
        'en': 'Current Changes'
    },
    navHistory: {
        'zh_CN': '备份历史',
        'en': 'Backup History'
    },
    navAdditions: {
        'zh_CN': '书签记录',
        'en': 'Bookmark Records'
    },
    navCanvas: {
        'zh_CN': '书签画布',
        'en': 'Bookmark Canvas'
    },
    navRecommend: {
        'zh_CN': '书签推荐',
        'en': 'Bookmark Recommend'
    },
    additionsTabReview: {
        'zh_CN': '书签添加记录',
        'en': 'Bookmark additions'
    },
    additionsTabBrowsing: {
        'zh_CN': '书签浏览记录',
        'en': 'Browsing History'
    },
    additionsTabTracking: {
        'zh_CN': '时间捕捉',
        'en': 'Time Tracking'
    },
    trackingPanelDesc: {
        'zh_CN': '追踪书签页面的活跃浏览时间',
        'en': 'Track active browsing time on bookmark pages'
    },
    clearTrackingText: {
        'zh_CN': '清除',
        'en': 'Clear'
    },
    browsingTabHistory: {
        'zh_CN': '点击记录',
        'en': 'Click History'
    },
    browsingTabRanking: {
        'zh_CN': '点击排行',
        'en': 'Click Ranking'
    },
    browsingTabRelated: {
        'zh_CN': '关联记录',
        'en': 'Related History'
    },
    browsingRankingTitle: {
        'zh_CN': '点击排行',
        'en': 'Click Ranking'
    },
    browsingRankingDescription: {
        'zh_CN': '基于浏览器历史记录，按点击次数统计当前书签的热门程度。',
        'en': 'Based on browser history, rank your bookmarks by click counts.'
    },
    browsingRelatedTitle: {
        'zh_CN': '关联记录',
        'en': 'Related History'
    },
    browsingRelatedDescription: {
        'zh_CN': '显示浏览器历史记录，并用绿色边框凸显书签相关的记录。',
        'en': 'Shows browser history, highlighting bookmark-related entries with green borders.'
    },
    browsingRelatedBadgeText: {
        'zh_CN': '书签',
        'en': 'Bookmark'
    },
    browsingRelatedLoadingText: {
        'zh_CN': '正在读取历史记录...',
        'en': 'Loading history...'
    },
    browsingRelatedFilterDay: {
        'zh_CN': '当天',
        'en': 'Today'
    },
    browsingRelatedFilterWeek: {
        'zh_CN': '当周',
        'en': 'This Week'
    },
    browsingRelatedFilterMonth: {
        'zh_CN': '当月',
        'en': 'This Month'
    },
    browsingRelatedFilterYear: {
        'zh_CN': '当年',
        'en': 'This Year'
    },
    browsingRelatedFilterAll: {
        'zh_CN': '全部',
        'en': 'All'
    },
    browsingRankingFilterToday: {
        'zh_CN': '当天',
        'en': 'Today'
    },
    browsingRankingFilterWeek: {
        'zh_CN': '当周',
        'en': 'This week'
    },
    browsingRankingFilterMonth: {
        'zh_CN': '当月',
        'en': 'This month'
    },
    browsingRankingFilterYear: {
        'zh_CN': '当年',
        'en': 'This year'
    },
    browsingRankingFilterAll: {
        'zh_CN': '全部',
        'en': 'All'
    },
    browsingRankingEmptyTitle: {
        'zh_CN': '暂无点击记录',
        'en': 'No click records found'
    },
    browsingRankingEmptyDescription: {
        'zh_CN': '当前时间范围内尚未找到这些书签的访问记录。',
        'en': 'No visit records for your bookmarks were found in the selected time range.'
    },
    browsingRankingNotSupportedTitle: {
        'zh_CN': '当前环境不支持历史记录统计',
        'en': 'History statistics are not available in this environment'
    },
    browsingRankingNotSupportedDesc: {
        'zh_CN': '请确认扩展已获得浏览器的历史记录权限。',
        'en': 'Please ensure the extension has permission to access browser history.'
    },
    browsingRankingNoBookmarksTitle: {
        'zh_CN': '暂无书签可统计',
        'en': 'No bookmarks to analyze'
    },
    browsingCalendarLoading: {
        'zh_CN': '正在加载日历...',
        'en': 'Loading calendar...'
    },
    timeTrackingWidgetTitle: {
        'zh_CN': '时间捕捉',
        'en': 'Time Tracking'
    },
    timeTrackingWidgetEmpty: {
        'zh_CN': '暂无追踪中的书签',
        'en': 'No bookmarks being tracked'
    },
    timeTrackingWidgetMore: {
        'zh_CN': '还有 {count} 个...',
        'en': '{count} more...'
    },
    timeTrackingWidgetRankingTitle: {
        'zh_CN': '点击排行',
        'en': 'Click Ranking'
    },
    currentChangesViewTitle: {
        'zh_CN': '当前 数量/结构 变化',
        'en': 'Current Changes'
    },
    historyViewTitle: {
        'zh_CN': '备份历史记录',
        'en': 'Backup History'
    },
    additionsViewTitle: {
        'zh_CN': '书签记录',
        'en': 'Bookmark Records'
    },
    canvasViewTitle: {
        'zh_CN': '书签画布',
        'en': 'Bookmark Canvas'
    },
    importCanvasText: {
        'zh_CN': '导入',
        'en': 'Import'
    },
    exportCanvasText: {
        'zh_CN': '导出',
        'en': 'Export'
    },
    clearTempNodesText: {
        'zh_CN': '清空临时节点',
        'en': 'Clear Temp Nodes'
    },
    canvasFullscreenEnter: {
        'zh_CN': '全屏',
        'en': 'Fullscreen'
    },
    canvasFullscreenExit: {
        'zh_CN': '退出',
        'en': 'Exit'
    },
    canvasZoomLabel: {
        'zh_CN': '缩放',
        'en': 'Zoom'
    },
    canvasZoomHint: {
        'zh_CN': '<kbd style="font-size: 9px; padding: 2px 4px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 3px;">Ctrl</kbd> + 滚轮 | <kbd style="font-size: 9px; padding: 2px 4px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 3px;">空格</kbd> 拖动',
        'en': '<kbd style="font-size: 9px; padding: 2px 4px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 3px;">Ctrl</kbd> + Wheel | <kbd style="font-size: 9px; padding: 2px 4px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 3px;">Space</kbd> Drag'
    },
    zoomInTitle: {
        'zh_CN': '放大 (10%)',
        'en': 'Zoom In (10%)'
    },
    zoomOutTitle: {
        'zh_CN': '缩小 (10%)',
        'en': 'Zoom Out (10%)'
    },
    zoomLocateTitle: {
        'zh_CN': '定位到永久栏目',
        'en': 'Locate to Permanent Section'
    },
    zoomLocateText: {
        'zh_CN': '定位',
        'en': 'Locate'
    },
    permanentSectionTitle: {
        'zh_CN': '书签树 (永久栏目)',
        'en': 'Bookmark Tree (Permanent)'
    },
    permanentSectionTip: {
        'zh_CN': '拖动书签/文件夹至空白处，创建书签型临时节点；临时节点的修改不计入核心数据，可用来对比查看/整理；栏目间可互相拖动/粘贴',
        'en': 'Drag bookmarks/folders to blank area to create bookmark-type temp nodes; temp node changes are not saved to core data, can be used for comparison/organization; sections can drag/paste between each other'
    },
    filterAll: {
        'zh_CN': '全部',
        'en': 'All'
    },
    filterBackedUp: {
        'zh_CN': '已备份',
        'en': 'Backed Up'
    },
    filterNotBackedUp: {
        'zh_CN': '未备份',
        'en': 'Not Backed Up'
    },
    modalTitle: {
        'zh_CN': '变化详情',
        'en': 'Change Details'
    },
    shortcutsModalTitle: {
        'zh_CN': '开源信息与快捷键',
        'en': 'Open Source Info & Shortcuts'
    },
    openSourceGithubLabel: {
        'zh_CN': 'GitHub 仓库:',
        'en': 'GitHub Repository:'
    },
    openSourceIssueLabel: {
        'zh_CN': '问题反馈:',
        'en': 'Feedback / Issues:'
    },
    openSourceIssueText: {
        'zh_CN': '提交问题',
        'en': 'Submit Issue'
    },
    shortcutsTitle: {
        'zh_CN': '当前可用快捷键',
        'en': 'Available Shortcuts'
    },
    shortcutsTableHeaderKey: {
        'zh_CN': '按键',
        'en': 'Key'
    },
    shortcutsTableHeaderAction: {
        'zh_CN': '功能',
        'en': 'Action'
    },
    shortcutsSettingsTooltip: {
        'zh_CN': '在浏览器中管理快捷键',
        'en': 'Manage shortcuts in browser'
    },
    shortcutCurrentChanges: {
        'zh_CN': '打开「当前 数量/结构 变化」视图',
        'en': 'Open "Current Changes" view'
    },
    shortcutHistory: {
        'zh_CN': '打开「备份历史」视图',
        'en': 'Open "Backup History" view'
    },
    shortcutCanvas: {
        'zh_CN': '打开「书签画布」视图',
        'en': 'Open "Bookmark Canvas" view'
    },
    shortcutAdditions: {
        'zh_CN': '打开「书签记录」视图',
        'en': 'Open "Bookmark Records" view'
    },
    shortcutRecommend: {
        'zh_CN': '打开「书签推荐」视图',
        'en': 'Open "Bookmark Recommend" view'
    },
    closeShortcutsText: {
        'zh_CN': '关闭',
        'en': 'Close'
    },
    autoBackup: {
        'zh_CN': '自动',
        'en': 'Auto'
    },
    manualBackup: {
        'zh_CN': '手动',
        'en': 'Manual'
    },
    success: {
        'zh_CN': '成功',
        'en': 'Success'
    },
    error: {
        'zh_CN': '失败',
        'en': 'Error'
    },
    added: {
        'zh_CN': '新增',
        'en': 'Added'
    },
    deleted: {
        'zh_CN': '删除',
        'en': 'Deleted'
    },
    modified: {
        'zh_CN': '修改',
        'en': 'Modified'
    },
    moved: {
        'zh_CN': '移动',
        'en': 'Moved'
    },
    bookmarks: {
        'zh_CN': '书签',
        'en': 'bookmarks'
    },
    folders: {
        'zh_CN': '文件夹',
        'en': 'folders'
    },
    backedUp: {
        'zh_CN': '已备份',
        'en': 'Backed Up'
    },
    notBackedUp: {
        'zh_CN': '未备份',
        'en': 'Not Backed Up'
    },
    noChanges: {
        'zh_CN': '无变化',
        'en': 'No changes'
    },
    noChangesDesc: {
        'zh_CN': '当前没有未备份的书签变化',
        'en': 'No unbacked bookmark changes'
    },
    emptyHistory: {
        'zh_CN': '暂无备份记录',
        'en': 'No backup records'
    },
    copyAllHistory: {
        'zh_CN': '复制所有记录',
        'en': 'Copy All Records'
    },
    revertAll: {
        'zh_CN': '全部撤销',
        'en': 'Revert All'
    },
    revertConfirmTitle: {
        'zh_CN': '确认撤销全部变化？',
        'en': 'Revert all changes?'
    },
    revertConfirmDesc: {
        'zh_CN': '这将撤销所有未提交的变化（新增/删除/修改/移动），并恢复到上次备份状态。此操作不可撤销。',
        'en': 'This will revert all uncommitted changes (add/delete/modify/move) and restore to the last backup. This cannot be undone.'
    },
    revertConfirmSecondary: {
        'zh_CN': '再次确认：是否撤销全部变化？',
        'en': 'Confirm again: revert all changes?'
    },
    revertSuccess: {
        'zh_CN': '已撤销全部变化，已恢复到上次备份',
        'en': 'All changes reverted. Restored to last backup.'
    },
    revertFailed: {
        'zh_CN': '撤销失败：',
        'en': 'Revert failed: '
    },
    emptyAdditions: {
        'zh_CN': '暂无书签记录',
        'en': 'No bookmark records'
    },
    emptyTree: {
        'zh_CN': '无法加载书签树',
        'en': 'Unable to load bookmark tree'
    },
    loading: {
        'zh_CN': '加载中...',
        'en': 'Loading...'
    },
    // 日历视图翻译
    calendarWeekLabel: {
        'zh_CN': '周',
        'en': 'Week'
    },
    calendarWeek: {
        'zh_CN': '第{0}周',
        'en': 'Week {0}'
    },
    calendarMonth: {
        'zh_CN': '{0}月',
        'en': 'Month {0}'
    },
    calendarMonthDay: {
        'zh_CN': '{0}月{1}日',
        'en': '{0}/{1}'
    },
    calendarYear: {
        'zh_CN': '{0}年',
        'en': 'Year {0}'
    },
    calendarYearMonthDay: {
        'zh_CN': '{0}年{1}月{2}日',
        'en': '{0}/{1}/{2}'
    },
    calendarWeekdays: {
        'zh_CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
        'en': ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    },
    calendarWeekdaysFull: {
        'zh_CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
        'en': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    },
    calendarMonthNames: {
        'zh_CN': ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
        'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    },
    calendarYearMonth: {
        'zh_CN': '{0}年{1}',
        'en': '{1} {0}'
    },
    calendarBookmarkCount: {
        'zh_CN': '{0}个',
        'en': '{0}'
    },
    calendarBookmarksCount: {
        'zh_CN': '{0}个书签',
        'en': '{0} bookmarks'
    },
    calendarTotalThisMonth: {
        'zh_CN': '本月共 {0} 个书签',
        'en': 'Total {0} bookmarks this month'
    },
    calendarTotalThisWeek: {
        'zh_CN': '本周共 {0} 个书签',
        'en': 'Total {0} bookmarks this week'
    },
    calendarTotalThisDay: {
        'zh_CN': '共 {0} 个书签',
        'en': 'Total {0} bookmarks'
    },
    calendarExpandMore: {
        'zh_CN': '展开更多 (还有{0}个)',
        'en': 'Show more ({0} more)'
    },
    calendarCollapse: {
        'zh_CN': '收起',
        'en': 'Collapse'
    },
    calendarSelectMode: {
        'zh_CN': '勾选',
        'en': 'Select'
    },
    calendarLocateToday: {
        'zh_CN': '定位至今天',
        'en': 'Locate Today'
    },
    calendarNoBookmarksThisMonth: {
        'zh_CN': '本月没有书签',
        'en': 'No bookmarks this month'
    },
    calendarNoBookmarksThisDay: {
        'zh_CN': '这天没有书签',
        'en': 'No bookmarks on this day'
    },
    calendarLoading: {
        'zh_CN': '正在加载日历...',
        'en': 'Loading calendar...'
    },
    calendarSortAscending: {
        'zh_CN': '正序排列',
        'en': 'Ascending'
    },
    calendarSortDescending: {
        'zh_CN': '倒序排列',
        'en': 'Descending'
    },
    currentAscending: {
        'zh_CN': '当前：正序',
        'en': 'Current: Ascending'
    },
    currentDescending: {
        'zh_CN': '当前：倒序',
        'en': 'Current: Descending'
    },
    refreshTooltip: {
        'zh_CN': '刷新',
        'en': 'Refresh'
    },
    themeTooltip: {
        'zh_CN': '切换主题',
        'en': 'Toggle Theme'
    },
    langTooltip: {
        'zh_CN': '切换语言',
        'en': 'Switch Language'
    },
    noChanges: {
        'zh_CN': '无变化',
        'en': 'No changes'
    },
    firstBackup: {
        'zh_CN': '首次备份',
        'en': 'First Backup'
    },
    addedBookmarks: {
        'zh_CN': '新增书签',
        'en': 'Added Bookmarks'
    },
    deletedBookmarks: {
        'zh_CN': '删除书签',
        'en': 'Deleted Bookmarks'
    },
    modifiedBookmarks: {
        'zh_CN': '修改书签',
        'en': 'Modified Bookmarks'
    },
    movedBookmarks: {
        'zh_CN': '移动书签',
        'en': 'Moved Bookmarks'
    },
    addedFolders: {
        'zh_CN': '新增文件夹',
        'en': 'Added Folders'
    },
    deletedFolders: {
        'zh_CN': '删除文件夹',
        'en': 'Deleted Folders'
    },
    filterStatus: {
        'zh_CN': '状态',
        'en': 'Status'
    },
    filterTime: {
        'zh_CN': '时间',
        'en': 'Time'
    },
    timeFilterAll: {
        'zh_CN': '全部',
        'en': 'All'
    },
    timeFilterYear: {
        'zh_CN': '按年',
        'en': 'By Year'
    },
    timeFilterMonth: {
        'zh_CN': '按月',
        'en': 'By Month'
    },
    timeFilterDay: {
        'zh_CN': '按日',
        'en': 'By Day'
    },
    treeViewMode: {
        'zh_CN': '树形视图',
        'en': 'Tree View'
    },
    jsonViewMode: {
        'zh_CN': 'JSON',
        'en': 'JSON'
    },
    bookmarkGitTitle: {
        'zh_CN': '书签Git',
        'en': 'Bookmark Git'
    },
    bookmarkToolboxTitle: {
        'zh_CN': '书签工具箱',
        'en': 'Bookmark Toolbox'
    },
    horizontalScrollHint: {
        'zh_CN': 'Shift + 滚轮',
        'en': 'Shift + Wheel'
    },
    nativeHistoryButtonText: {
        'zh_CN': '历史记录 (chrome://history/)',
        'en': 'History (chrome://history/)'
    },
    groupedHistoryButtonText: {
        'zh_CN': '分组历史 (chrome://history/grouped)',
        'en': 'Grouped History (chrome://history/grouped)'
    },
    bookmarkRankingDescription: {
        'zh_CN': '结合浏览器历史记录，对当前书签的点击次数进行「书签点击排行」。点击某一行可展开查看不同时间范围的统计。',
        'en': 'Based on browser history, rank your bookmarks by click counts. Click a row to see statistics for different time ranges.'
    },
    additionsAnkiTitle: {
        'zh_CN': '书签Anki（规划中）',
        'en': 'Bookmark Anki (planned)'
    },
    additionsAnkiDescription: {
        'zh_CN': '未来会在这里加入基于 Anki 的复习节奏，帮助你按记忆曲线重新回顾书签。',
        'en': 'An Anki-based review flow will be added here to help you revisit bookmarks along a memory curve.'
    },
    // 导出功能翻译
    exportTooltip: {
        'zh_CN': '导出记录',
        'en': 'Export Records'
    },
    exportModalTitle: {
        'zh_CN': '导出书签记录',
        'en': 'Export Bookmarks'
    },
    exportScopeLabel: {
        'zh_CN': '导出范围',
        'en': 'Export Scope'
    },
    exportScopeCurrent: {
        'zh_CN': '当前视图: ',
        'en': 'Current View: '
    },
    exportScopeSelected: {
        'zh_CN': '当前勾选 ({0} 个日期)',
        'en': 'Selected ({0} dates)'
    },
    exportModeLabel: {
        'zh_CN': '导出模式',
        'en': 'Export Mode'
    },
    exportModeRecords: {
        'zh_CN': '仅导出添加记录',
        'en': 'Records Only'
    },
    exportModeRecordsDesc: {
        'zh_CN': '(仅现有记录)',
        'en': '(Current records only)'
    },
    exportModeContext: {
        'zh_CN': '现记录关联导出',
        'en': 'Context Export'
    },
    exportModeContextDesc: {
        'zh_CN': '(包含同文件夹下的其他书签)',
        'en': '(Includes siblings in folder)'
    },
    exportModeCollection: {
        'zh_CN': '集合导出到日期文件夹',
        'en': 'Collection Export'
    },
    exportModeCollectionDesc: {
        'zh_CN': '(按日期归档，不保留原目录名)',
        'en': '(Group by date, flat structure)'
    },
    exportFormatLabel: {
        'zh_CN': '导出格式',
        'en': 'Export Format'
    },
    exportFormatHtml: {
        'zh_CN': 'HTML (浏览器可导入)',
        'en': 'HTML (Importable)'
    },
    exportFormatJson: {
        'zh_CN': 'JSON',
        'en': 'JSON'
    },
    exportFormatCopy: {
        'zh_CN': '复制到剪贴板',
        'en': 'Copy to Clipboard'
    },
    exportBtnStart: {
        'zh_CN': '开始导出',
        'en': 'Start Export'
    },
    exportBtnProcessing: {
        'zh_CN': '正在处理...',
        'en': 'Processing...'
    },
    exportSuccessCopy: {
        'zh_CN': '已复制到剪贴板',
        'en': 'Copied to clipboard'
    },
    exportErrorNoFormat: {
        'zh_CN': '请至少选择一种导出格式',
        'en': 'Please select at least one format'
    },
    exportErrorNoData: {
        'zh_CN': '当前范围内没有可导出的书签',
        'en': 'No bookmarks to export in current scope'
    },
    exportFolderName: {
        'zh_CN': '书签添加记录',
        'en': 'Bookmark Records'
    },
    exportRootTitle: {
        'zh_CN': '书签导出',
        'en': 'Bookmark Export'
    },
    // 点击记录导出翻译
    browsingExportTooltip: {
        'zh_CN': '导出记录',
        'en': 'Export Records'
    },
    browsingExportModalTitle: {
        'zh_CN': '导出点击记录',
        'en': 'Export Click History'
    },
    browsingExportModeRecords: {
        'zh_CN': '仅导出点击记录',
        'en': 'Click Records Only'
    },
    browsingExportFolderName: {
        'zh_CN': '点击记录',
        'en': 'Click History'
    },
    // 时间捕捉翻译
    trackingTitle: {
        'zh_CN': '时间捕捉',
        'en': 'Time Tracking'
    },
    trackingToggleOn: {
        'zh_CN': '开启',
        'en': 'On'
    },
    trackingToggleOff: {
        'zh_CN': '关闭',
        'en': 'Off'
    },
    trackingClearBtn: {
        'zh_CN': '清除记录',
        'en': 'Clear Records'
    },
    trackingCurrentTitle: {
        'zh_CN': '正在追踪的书签',
        'en': 'Currently Tracking'
    },
    trackingNoActive: {
        'zh_CN': '暂无正在追踪的书签',
        'en': 'No active tracking sessions'
    },
    trackingHeaderState: {
        'zh_CN': '状态',
        'en': 'Status'
    },
    trackingHeaderTitle: {
        'zh_CN': '书签',
        'en': 'Bookmark'
    },
    trackingHeaderTime: {
        'zh_CN': '综合时间',
        'en': 'Composite Time'
    },
    trackingHeaderWakes: {
        'zh_CN': '唤醒',
        'en': 'Wakes'
    },
    trackingHeaderRatio: {
        'zh_CN': '活跃',
        'en': 'Active'
    },
    trackingRankingTitle: {
        'zh_CN': '综合时间排行',
        'en': 'Composite Time Ranking'
    },
    trackingRangeToday: {
        'zh_CN': '今天',
        'en': 'Today'
    },
    trackingRangeWeek: {
        'zh_CN': '本周',
        'en': 'This Week'
    },
    trackingRangeMonth: {
        'zh_CN': '本月',
        'en': 'This Month'
    },
    trackingRangeYear: {
        'zh_CN': '当年',
        'en': 'This Year'
    },
    trackingRangeAll: {
        'zh_CN': '全部',
        'en': 'All Time'
    },
    trackingNoData: {
        'zh_CN': '暂无活跃时间数据',
        'en': 'No active time data'
    },
    trackingClearConfirm: {
        'zh_CN': '确定要清除所有时间追踪记录吗？此操作不可撤销。',
        'en': 'Are you sure you want to clear all tracking records? This action cannot be undone.'
    },
    trackingCleared: {
        'zh_CN': '追踪记录已清除',
        'en': 'Tracking records cleared'
    },
    trackingIdle: {
        'zh_CN': '挂机',
        'en': 'Idle'
    },
    trackingLoadFailed: {
        'zh_CN': '排行加载失败',
        'en': 'Failed to load ranking'
    },
    // 书签推荐翻译
    recommendViewTitle: {
        'zh_CN': '书签推荐',
        'en': 'Bookmark Recommendations'
    },
    recommendHelpTooltip: {
        'zh_CN': '帮助',
        'en': 'Help'
    },
    legendFreshness: {
        'zh_CN': '新鲜度',
        'en': 'Freshness'
    },
    legendColdness: {
        'zh_CN': '冷门度',
        'en': 'Coldness'
    },
    legendTimeDegree: {
        'zh_CN': '时间度',
        'en': 'Time Degree'
    },
    legendForgetting: {
        'zh_CN': '遗忘度',
        'en': 'Forgetting'
    },
    legendLaterReview: {
        'zh_CN': '待复习',
        'en': 'Later Review'
    },
    laterReviewDesc: {
        'zh_CN': '（手动添加后=1）',
        'en': '(=1 when manually added)'
    },
    thresholdFreshnessSuffix: {
        'zh_CN': '天',
        'en': ' days'
    },
    thresholdColdnessSuffix: {
        'zh_CN': '次',
        'en': ' clicks'
    },
    thresholdTimeDegreeSuffix: {
        'zh_CN': '分钟',
        'en': ' min'
    },
    thresholdForgettingSuffix: {
        'zh_CN': '天',
        'en': ' days'
    },
    presetDefault: {
        'zh_CN': '默认模式',
        'en': 'Default'
    },
    presetDefaultTip: {
        'zh_CN': '均衡推荐',
        'en': 'Balanced recommendation'
    },
    presetArchaeology: {
        'zh_CN': '考古模式',
        'en': 'Archaeology'
    },
    presetArchaeologyTip: {
        'zh_CN': '挖掘尘封已久的书签',
        'en': 'Dig up long-forgotten bookmarks'
    },
    presetConsolidate: {
        'zh_CN': '巩固模式',
        'en': 'Consolidate'
    },
    presetConsolidateTip: {
        'zh_CN': '经常访问但还没深入阅读的',
        'en': 'Frequently visited but not deeply read'
    },
    presetPriority: {
        'zh_CN': '优先巩固',
        'en': 'Priority'
    },
    presetPriorityTip: {
        'zh_CN': '优先复习手动添加的书签',
        'en': 'Prioritize manually added bookmarks'
    },
    presetWander: {
        'zh_CN': '漫游模式',
        'en': 'Wander'
    },
    presetWanderTip: {
        'zh_CN': '随机探索发现',
        'en': 'Random exploration'
    },
    resetFormulaText: {
        'zh_CN': '恢复默认',
        'en': 'Reset'
    },
    cardRefreshText: {
        'zh_CN': '刷新推荐',
        'en': 'Refresh'
    },
    refreshSettingsTitle: {
        'zh_CN': '自动刷新设置',
        'en': 'Auto Refresh Settings'
    },
    refreshEveryNOpensLabel: {
        'zh_CN': '每打开',
        'en': 'Every'
    },
    refreshEveryNOpensUnit: {
        'zh_CN': '次刷新',
        'en': 'opens, refresh'
    },
    refreshAfterHoursLabel: {
        'zh_CN': '距上次刷新超过',
        'en': 'After'
    },
    refreshAfterHoursUnit: {
        'zh_CN': '小时',
        'en': 'hours'
    },
    refreshAfterDaysLabel: {
        'zh_CN': '距上次刷新超过',
        'en': 'After'
    },
    refreshAfterDaysUnit: {
        'zh_CN': '天',
        'en': 'days'
    },
    refreshSettingsSave: {
        'zh_CN': '保存',
        'en': 'Save'
    },
    // 热力图
    heatmapTitle: {
        'zh_CN': '复习热力图',
        'en': 'Review Heatmap'
    },
    heatmapLoading: {
        'zh_CN': '热力图数据加载中...',
        'en': 'Loading heatmap data...'
    },
    // 待复习主区域
    postponedTitle: {
        'zh_CN': '待复习',
        'en': 'To Review'
    },
    priorityModeBadge: {
        'zh_CN': '⚡优先',
        'en': '⚡Priority'
    },
    postponedEmptyText: {
        'zh_CN': '暂无待复习的书签',
        'en': 'No bookmarks to review'
    },
    // 「Add to Review」弹窗
    addPostponedModalTitle: {
        'zh_CN': '添加到待复习',
        'en': 'Add to Review'
    },
    postponedAddBtnTitle: {
        'zh_CN': '添加书签到待复习',
        'en': 'Add bookmarks to review'
    },
    cardLaterTitle: {
        'zh_CN': '待复习',
        'en': 'To Review'
    },
    addTabFolder: {
        'zh_CN': '从文件夹',
        'en': 'From folder'
    },
    addTabSearch: {
        'zh_CN': '搜索书签',
        'en': 'Search bookmarks'
    },
    addTabDomain: {
        'zh_CN': '按域名',
        'en': 'By domain'
    },
    addFolderLabel: {
        'zh_CN': '选择文件夹：',
        'en': 'Choose folder:'
    },
    addCountLabel: {
        'zh_CN': '抽取数量：',
        'en': 'Count:'
    },
    addSelectAllLabel: {
        'zh_CN': '全部',
        'en': 'All'
    },
    addModeLabel: {
        'zh_CN': '抽取方式：',
        'en': 'Mode:'
    },
    addModeRandom: {
        'zh_CN': '随机',
        'en': 'Random'
    },
    addModeSequential: {
        'zh_CN': '顺序',
        'en': 'Sequential'
    },
    addIncludeSubfolders: {
        'zh_CN': '包含子文件夹',
        'en': 'Include subfolders'
    },
    addSearchPlaceholder: {
        'zh_CN': '搜索书签标题或URL...',
        'en': 'Search title or URL...'
    },
    addSearchEmpty: {
        'zh_CN': '输入关键词搜索书签',
        'en': 'Enter keyword to search bookmarks'
    },
    addSearchSelectedText: {
        'zh_CN': '已选择',
        'en': 'Selected'
    },
    addDomainSearchPlaceholder: {
        'zh_CN': '搜索域名...',
        'en': 'Search domain...'
    },
    addDomainLoading: {
        'zh_CN': '加载域名列表中...',
        'en': 'Loading domain list...'
    },
    addDomainSelectedText: {
        'zh_CN': '已选择',
        'en': 'Selected'
    },
    addDomainSelectedLabel: {
        'zh_CN': '个域名',
        'en': 'domains'
    },
    addPostponedCancelText: {
        'zh_CN': '取消',
        'en': 'Cancel'
    },
    addPostponedConfirmText: {
        'zh_CN': '添加',
        'en': 'Add'
    },
    // 屏蔽管理
    blockManageTitle: {
        'zh_CN': '屏蔽管理',
        'en': 'Block Management'
    },
    blockedBookmarksTitle: {
        'zh_CN': '已屏蔽书签',
        'en': 'Blocked Bookmarks'
    },
    blockedBookmarksEmptyText: {
        'zh_CN': '暂无已屏蔽书签',
        'en': 'No blocked bookmarks'
    },
    blockedFoldersTitle: {
        'zh_CN': '已屏蔽文件夹',
        'en': 'Blocked Folders'
    },
    blockedDomainsTitle: {
        'zh_CN': '已屏蔽域名',
        'en': 'Blocked Domains'
    },
    blockedFoldersEmptyText: {
        'zh_CN': '暂无已屏蔽文件夹',
        'en': 'No blocked folders'
    },
    blockedDomainsEmptyText: {
        'zh_CN': '暂无已屏蔽域名',
        'en': 'No blocked domains'
    },
    addDomainModalTitle: {
        'zh_CN': '添加屏蔽域名',
        'en': 'Add Blocked Domain'
    },
    addDomainModalDesc: {
        'zh_CN': '输入要屏蔽的域名（如 example.com）：',
        'en': 'Enter domain to block (e.g. example.com):'
    },
    addDomainCancelBtn: {
        'zh_CN': '取消',
        'en': 'Cancel'
    },
    addDomainConfirmBtn: {
        'zh_CN': '添加',
        'en': 'Add'
    },
    selectFolderModalTitle: {
        'zh_CN': '选择要屏蔽的文件夹',
        'en': 'Select Folder to Block'
    },
    folderBookmarkCount: {
        'zh_CN': '个书签',
        'en': 'bookmarks'
    },
    unnamedFolderLabel: {
        'zh_CN': '未命名文件夹',
        'en': 'Untitled folder'
    },
    // 稍后复习弹窗
    laterRecommendLabel: {
        'zh_CN': '根据浏览习惯推荐',
        'en': 'Recommended based on browsing'
    },
    laterOrText: {
        'zh_CN': '或自定义',
        'en': 'or custom'
    }
};

// =============================================================================
// 初始化
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('历史查看器初始化...');

    // ========================================================================
    // 【关键步骤 0】初始化 Favicon 缓存系统
    // ========================================================================
    try {
        await FaviconCache.init();
    } catch (error) {
        // 静默处理
    }

    // 设置全局图片错误处理（避免CSP内联事件处理器）
    setupGlobalImageErrorHandler();

    // ========================================================================
    // 【关键步骤 1】最优先：立即恢复并应用视图状态
    // ========================================================================
    const urlParams = new URLSearchParams(window.location.search);
    const viewParam = urlParams.get('view');

    // 优先级：URL参数 > localStorage > 默认值
    if (viewParam && ['current-changes', 'history', 'additions', 'tree', 'canvas', 'recommend'].includes(viewParam)) {
        currentView = viewParam === 'tree' ? 'canvas' : viewParam;
        console.log('[初始化] 从URL参数设置视图:', currentView);

        // 【关键】应用 URL 参数后，立即从 URL 中移除 view 参数
        // 这样刷新页面时就会使用 localStorage，实现持久化
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('view');
        window.history.replaceState({}, '', newUrl.toString());
        console.log('[初始化] 已从URL中移除view参数，刷新时将使用localStorage');
    } else {
        const lastView = localStorage.getItem('lastActiveView');
        if (lastView && ['current-changes', 'history', 'additions', 'tree', 'canvas', 'recommend'].includes(lastView)) {
            currentView = lastView === 'tree' ? 'canvas' : lastView;
            console.log('[初始化] 从localStorage恢复视图:', currentView);
        } else {
            console.log('[初始化] 使用默认视图:', currentView);
        }
    }

    // 立即应用视图状态到DOM
    console.log('[初始化] >>>立即应用视图状态<<<:', currentView);
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (tab.dataset.view === currentView) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    document.querySelectorAll('.view').forEach(view => {
        if (view.id === `${currentView}View`) {
            view.classList.add('active');
        } else {
            view.classList.remove('active');
        }
    });
    localStorage.setItem('lastActiveView', currentView);
    console.log('[初始化] 视图状态已应用完成');

    // ========================================================================
    // 其他初始化
    // ========================================================================
    const recordTime = urlParams.get('record');
    console.log('[URL参数] 完整URL:', window.location.href);
    console.log('[URL参数] recordTime:', recordTime, 'viewParam:', viewParam);

    // 加载用户设置
    await loadUserSettings();

    // 初始化 UI（此时currentView已经是正确的值）
    initializeUI();

    // 初始化侧边栏收起功能
    initSidebarToggle();

    // 初始化时间捕捉小组件
    initTimeTrackingWidget();

    // 初始化右键菜单和拖拽功能
    if (typeof initContextMenu === 'function') {
        initContextMenu();
    }
    if (typeof initDragDrop === 'function') {
        initDragDrop();
    }

    // 初始化批量操作相关功能
    if (typeof initBatchToolbar === 'function') {
        initBatchToolbar();
        console.log('[主程序] 批量工具栏已初始化');
    }
    if (typeof initKeyboardShortcuts === 'function') {
        initKeyboardShortcuts();
        console.log('[主程序] 快捷键已初始化');
    }
    if (typeof initClickSelect === 'function') {
        initClickSelect();
        console.log('[主程序] 点击选择已初始化');
    }

    // 注册消息监听
    setupRealtimeMessageListener();

    // 设置事件委托处理所有按钮的data-action属性
    setupEventDelegation();

    // 先加载基础数据
    console.log('[初始化] 加载基础数据...');
    await loadAllData();

    // 如果有 recordTime 参数，立即打开详情弹窗（在UI渲染之前）
    if (recordTime) {
        console.log('[初始化] 快速打开详情面板，recordTime:', recordTime);
        const record = syncHistory.find(r => r.time == recordTime);
        if (record) {
            console.log('[初始化] 找到记录，立即打开详情面板');
            // 立即打开详情面板，不等待UI渲染
            setTimeout(() => showDetailModal(record), 0);
        }
    }

    // 使用智能等待：尝试渲染，如果数据不完整则等待后重试
    // 初始化时强制刷新缓存，确保显示最新数据
    console.log('[初始化] 开始渲染当前视图:', currentView);

    // 根据当前视图渲染
    if (currentView === 'current-changes') {
        await renderCurrentChangesViewWithRetry(3, true);
    } else {
        await renderCurrentView();

        // 如果通过 window_marker.html 传入了定位参数，则在 Canvas 视图渲染后执行一次定位
        try {
            const lt = urlParams.get('lt'); // 'permanent' | 'temporary'
            const sid = urlParams.get('sid');
            const nid = urlParams.get('nid');
            const titleParam = urlParams.get('t');
            const typeParam = urlParams.get('type'); // 'hyperlink' 或 undefined

            if (titleParam && typeof titleParam === 'string' && titleParam.trim()) {
                // 根据type参数设置不同的标题格式
                if (typeParam === 'hyperlink') {
                    // 超链接系统：使用 "Hyperlink N" 格式
                    document.title = `Hyperlink ${titleParam.trim()}`;
                } else {
                    // 书签系统：直接使用数字
                    document.title = titleParam.trim();
                }
            }

            const waitFor = (predicate, timeout = 5000, interval = 50) => new Promise((resolve, reject) => {
                const start = Date.now();
                const tick = () => {
                    try {
                        if (predicate()) return resolve(true);
                        if (Date.now() - start >= timeout) return resolve(false);
                    } catch (_) { }
                    setTimeout(tick, interval);
                };
                tick();
            });

            if (currentView === 'canvas' && (lt === 'permanent' || lt === 'temporary')) {
                // 等待 Canvas 初始化完成
                await waitFor(() => window.CanvasModule && document.getElementById('canvasWorkspace'));
                if (lt === 'permanent') {
                    if (window.CanvasModule && typeof window.CanvasModule.locatePermanent === 'function') {
                        window.CanvasModule.locatePermanent();
                    }
                    if (nid) {
                        // 等待树节点渲染完成后滚动到对应书签
                        await waitFor(() => document.querySelector('#permanentSection .permanent-section-body .tree-item'));
                        const body = document.querySelector('#permanentSection .permanent-section-body');
                        const target = body ? body.querySelector(`.tree-item[data-node-id="${CSS.escape(nid)}"]`) : null;
                        if (target && target.scrollIntoView) {
                            try { target.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { target.scrollIntoView(); }
                        }
                    }
                } else if (lt === 'temporary' && sid) {
                    if (window.CanvasModule && typeof window.CanvasModule.locateSection === 'function') {
                        try { window.CanvasModule.locateSection(sid); } catch (_) { }
                    }
                }
            }
        } catch (e) {
            console.warn('[初始化] Canvas 定位参数处理失败:', e);
        }
    }

    // 并行预加载其他视图和图标（不阻塞）
    Promise.all([
        preloadAllViews(),
        preloadCommonIcons()
    ]).then(() => {
        console.log('[初始化] 所有资源预加载完成');
    }).catch(error => {
        console.error('[初始化] 预加载失败:', error);
    });

    // 监听存储变化（实时更新）
    browserAPI.storage.onChanged.addListener(handleStorageChange);

    // 监听书签API变化（实时更新书签树视图）
    setupBookmarkListener();
    setupBrowsingHistoryRealtimeListeners();

    viewerInitialized = true;
    if (deferredAnalysisMessage) {
        const pendingMessage = deferredAnalysisMessage;
        deferredAnalysisMessage = null;
        handleAnalysisUpdatedMessage(pendingMessage);
    }

    console.log('历史查看器初始化完成');
});

// =============================================================================
// 用户设置
// =============================================================================

// 检查是否有覆盖设置
function hasThemeOverride() {
    try {
        return localStorage.getItem('historyViewerHasCustomTheme') === 'true';
    } catch (e) {
        return false;
    }
}

function hasLangOverride() {
    try {
        return localStorage.getItem('historyViewerHasCustomLang') === 'true';
    } catch (e) {
        return false;
    }
}

// 获取覆盖设置
function getThemeOverride() {
    try {
        return localStorage.getItem('historyViewerCustomTheme');
    } catch (e) {
        return null;
    }
}

function getLangOverride() {
    try {
        return localStorage.getItem('historyViewerCustomLang');
    } catch (e) {
        return null;
    }
}

async function loadUserSettings() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['preferredLang', 'currentTheme'], (result) => {
            const mainUILang = result.preferredLang || 'zh_CN';
            const prefersDark = typeof window !== 'undefined'
                && window.matchMedia
                && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const mainUITheme = result.currentTheme || (prefersDark ? 'dark' : 'light');

            // 优先使用覆盖设置，否则使用主UI设置
            if (hasThemeOverride()) {
                currentTheme = getThemeOverride() || mainUITheme;
                console.log('[加载用户设置] 使用History Viewer的主题覆盖:', currentTheme);
            } else {
                currentTheme = mainUITheme;
                console.log('[加载用户设置] 跟随主UI主题:', currentTheme);
            }

            if (hasLangOverride()) {
                currentLang = getLangOverride() || mainUILang;
                console.log('[加载用户设置] 使用History Viewer的语言覆盖:', currentLang);
            } else {
                currentLang = mainUILang;
                console.log('[加载用户设置] 跟随主UI语言:', currentLang);
            }

            // 应用主题
            document.documentElement.setAttribute('data-theme', currentTheme);

            // 更新主题切换按钮图标
            const themeIcon = document.querySelector('#themeToggle i');
            if (themeIcon) {
                themeIcon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }

            // 应用语言
            applyLanguage();

            // 更新语言切换按钮文本
            const langText = document.querySelector('#langToggle .lang-text');
            if (langText) {
                langText.textContent = currentLang === 'zh_CN' ? 'EN' : '中';
            }

            resolve();
        });
    });
}

function applyLanguage() {
    // 更新所有文本
    document.getElementById('pageTitle').textContent = i18n.pageTitle[currentLang];
    document.getElementById('pageSubtitle').textContent = i18n.pageSubtitle[currentLang];
    document.getElementById('searchInput').placeholder = i18n.searchPlaceholder[currentLang];
    document.getElementById('navCurrentChangesText').textContent = i18n.navCurrentChanges[currentLang];
    document.getElementById('navHistoryText').textContent = i18n.navHistory[currentLang];
    document.getElementById('navAdditionsText').textContent = i18n.navAdditions[currentLang];
    document.getElementById('navCanvasText').textContent = i18n.navCanvas[currentLang];
    const navRecommendText = document.getElementById('navRecommendText');
    if (navRecommendText) navRecommendText.textContent = i18n.navRecommend[currentLang];
    document.getElementById('bookmarkGitTitle').textContent = i18n.bookmarkGitTitle[currentLang];
    document.getElementById('bookmarkToolboxTitle').textContent = i18n.bookmarkToolboxTitle[currentLang];
    
    const timeTrackingWidgetTitle = document.getElementById('timeTrackingWidgetTitle');
    if (timeTrackingWidgetTitle) timeTrackingWidgetTitle.textContent = i18n.timeTrackingWidgetTitle[currentLang];
    const timeTrackingWidgetEmptyText = document.getElementById('timeTrackingWidgetEmptyText');
    if (timeTrackingWidgetEmptyText) timeTrackingWidgetEmptyText.textContent = i18n.timeTrackingWidgetEmpty[currentLang];
    
    document.getElementById('currentChangesViewTitle').textContent = i18n.currentChangesViewTitle[currentLang];
    document.getElementById('historyViewTitle').textContent = i18n.historyViewTitle[currentLang];
    document.getElementById('additionsViewTitle').textContent = i18n.additionsViewTitle[currentLang];
    // Canvas 视图标题
    const canvasViewTitle = document.getElementById('canvasViewTitle');
    if (canvasViewTitle) canvasViewTitle.textContent = i18n.canvasViewTitle[currentLang];
    const importCanvasText = document.getElementById('importCanvasText');
    if (importCanvasText) importCanvasText.textContent = i18n.importCanvasText[currentLang];
    const exportCanvasText = document.getElementById('exportCanvasText');
    if (exportCanvasText) exportCanvasText.textContent = i18n.exportCanvasText[currentLang];
    const clearTempNodesText = document.getElementById('clearTempNodesText');
    if (clearTempNodesText) clearTempNodesText.textContent = i18n.clearTempNodesText[currentLang];

    // Canvas 缩放控制器
    const canvasZoomLabel = document.getElementById('canvasZoomLabel');
    if (canvasZoomLabel) canvasZoomLabel.textContent = i18n.canvasZoomLabel[currentLang];
    const canvasZoomHint = document.getElementById('canvasZoomHint');
    if (canvasZoomHint) canvasZoomHint.innerHTML = i18n.canvasZoomHint[currentLang];

    // 日历加载文本
    const calendarLoadingText = document.getElementById('calendarLoadingText');
    if (calendarLoadingText) calendarLoadingText.textContent = i18n.calendarLoading[currentLang];

    // 日历按钮文本
    const calendarSelectModeText = document.getElementById('calendarSelectModeText');
    if (calendarSelectModeText) calendarSelectModeText.textContent = i18n.calendarSelectMode[currentLang];
    const calendarLocateTodayText = document.getElementById('calendarLocateTodayText');
    if (calendarLocateTodayText) calendarLocateTodayText.textContent = i18n.calendarLocateToday[currentLang];

    // 更新日历视图翻译
    if (typeof updateBookmarkCalendarLanguage === 'function') {
        updateBookmarkCalendarLanguage();
    }
    if (typeof updateBrowsingHistoryCalendarLanguage === 'function') {
        updateBrowsingHistoryCalendarLanguage();
    }
    const zoomInBtn = document.getElementById('zoomInBtn');
    if (zoomInBtn) zoomInBtn.title = i18n.zoomInTitle[currentLang];
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    if (zoomOutBtn) zoomOutBtn.title = i18n.zoomOutTitle[currentLang];
    const zoomLocateBtn = document.getElementById('zoomLocateBtn');
    if (zoomLocateBtn) zoomLocateBtn.title = i18n.zoomLocateTitle[currentLang];
    const zoomLocateText = document.getElementById('zoomLocateText');
    if (zoomLocateText) zoomLocateText.textContent = i18n.zoomLocateText[currentLang];
    const fullscreenBtn = document.getElementById('canvasFullscreenBtn');
    if (fullscreenBtn) {
        // Always update fullscreen button to ensure language changes are applied
        if (window.CanvasModule && typeof window.CanvasModule.updateFullscreenButton === 'function') {
            window.CanvasModule.updateFullscreenButton();
        }
        // Also apply text directly to ensure it's set in current language
        const container = document.querySelector('.canvas-main-container');
        const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        const isFullscreen = container && fullscreenElement === container;
        const key = isFullscreen ? 'canvasFullscreenExit' : 'canvasFullscreenEnter';
        const text = i18n[key] && i18n[key][currentLang] ? i18n[key][currentLang] : (key === 'canvasFullscreenExit' ? (currentLang === 'en' ? 'Exit' : '退出') : (currentLang === 'en' ? 'Fullscreen' : '全屏'));
        fullscreenBtn.textContent = text;
        fullscreenBtn.setAttribute('aria-label', text);
        fullscreenBtn.classList.toggle('fullscreen-active', Boolean(isFullscreen));
        fullscreenBtn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
    }

    // Canvas永久栏目文本
    const permanentSectionTitle = document.getElementById('permanentSectionTitle');
    if (permanentSectionTitle) permanentSectionTitle.textContent = i18n.permanentSectionTitle[currentLang];
    const permanentSectionTip = document.getElementById('permanentSectionTip');
    if (permanentSectionTip) {
        // 若用户已自定义说明，则保留用户内容；仅在无自定义时应用默认文案
        let savedTip = '';
        try { savedTip = localStorage.getItem('canvas-permanent-tip-text') || ''; } catch { }
        if (!savedTip.trim()) {
            permanentSectionTip.textContent = i18n.permanentSectionTip[currentLang];
        }
    }

    // 更新按钮文本
    const copyAllHistoryText = document.getElementById('copyAllHistoryText');
    if (copyAllHistoryText) {
        copyAllHistoryText.textContent = i18n.copyAllHistory[currentLang];
    }
    const revertAllCurrentText = document.getElementById('revertAllCurrentText');
    if (revertAllCurrentText) revertAllCurrentText.textContent = i18n.revertAll[currentLang];

    // 以下元素在「书签点击排行」UI中，已被删除，需要安全检查
    const filterAll = document.getElementById('filterAll');
    if (filterAll) filterAll.textContent = i18n.filterAll[currentLang];
    const filterBackedUp = document.getElementById('filterBackedUp');
    if (filterBackedUp) filterBackedUp.textContent = i18n.filterBackedUp[currentLang];
    const filterNotBackedUp = document.getElementById('filterNotBackedUp');
    if (filterNotBackedUp) filterNotBackedUp.textContent = i18n.filterNotBackedUp[currentLang];
    const filterStatusLabel = document.getElementById('filterStatusLabel');
    if (filterStatusLabel) filterStatusLabel.textContent = i18n.filterStatus[currentLang];
    const filterTimeLabel = document.getElementById('filterTimeLabel');
    if (filterTimeLabel) filterTimeLabel.textContent = i18n.filterTime[currentLang];
    const timeFilterAll = document.getElementById('timeFilterAll');
    if (timeFilterAll) timeFilterAll.textContent = i18n.timeFilterAll[currentLang];
    const timeFilterYear = document.getElementById('timeFilterYear');
    if (timeFilterYear) timeFilterYear.textContent = i18n.timeFilterYear[currentLang];
    const timeFilterMonth = document.getElementById('timeFilterMonth');
    if (timeFilterMonth) timeFilterMonth.textContent = i18n.timeFilterMonth[currentLang];
    const timeFilterDay = document.getElementById('timeFilterDay');
    if (timeFilterDay) timeFilterDay.textContent = i18n.timeFilterDay[currentLang];
    // 已删除JSON视图，不再需要更新这些元素
    // document.getElementById('treeViewModeText').textContent = i18n.treeViewMode[currentLang];
    // document.getElementById('jsonViewModeText').textContent = i18n.jsonViewMode[currentLang];
    document.getElementById('modalTitle').textContent = i18n.modalTitle[currentLang];

    // 更新工具按钮气泡
    document.getElementById('refreshTooltip').textContent = i18n.refreshTooltip[currentLang];
    document.getElementById('themeTooltip').textContent = i18n.themeTooltip[currentLang];
    document.getElementById('langTooltip').textContent = i18n.langTooltip[currentLang];
    const helpTooltip = document.getElementById('helpTooltip');
    if (helpTooltip) {
        helpTooltip.textContent = i18n.helpTooltip[currentLang];
    }

    // 更新快捷键弹窗文本
    const shortcutsModalTitle = document.getElementById('shortcutsModalTitle');
    if (shortcutsModalTitle) {
        shortcutsModalTitle.textContent = i18n.shortcutsModalTitle[currentLang];
    }
    const openSourceGithubLabel = document.getElementById('openSourceGithubLabel');
    if (openSourceGithubLabel) {
        openSourceGithubLabel.textContent = i18n.openSourceGithubLabel[currentLang];
    }
    const openSourceIssueLabel = document.getElementById('openSourceIssueLabel');
    if (openSourceIssueLabel) {
        openSourceIssueLabel.textContent = i18n.openSourceIssueLabel[currentLang];
    }
    const openSourceIssueText = document.getElementById('openSourceIssueText');
    if (openSourceIssueText) {
        openSourceIssueText.textContent = i18n.openSourceIssueText[currentLang];
    }
    const shortcutsContent = document.getElementById('shortcutsContent');
    if (shortcutsContent) {
        updateShortcutsDisplay();
    }
    const closeShortcutsText = document.getElementById('closeShortcutsText');
    if (closeShortcutsText) {
        closeShortcutsText.textContent = i18n.closeShortcutsText[currentLang];
    }

    // 更新横向滚动条提示文字
    const scrollbarHint = document.querySelector('.canvas-scrollbar.horizontal .scrollbar-hint');
    if (scrollbarHint) scrollbarHint.textContent = i18n.horizontalScrollHint[currentLang];

    // 书签温故子标签与文案
    const additionsTabReview = document.getElementById('additionsTabReview');
    if (additionsTabReview) additionsTabReview.textContent = i18n.additionsTabReview[currentLang];
    const additionsTabBrowsing = document.getElementById('additionsTabBrowsing');
    if (additionsTabBrowsing) additionsTabBrowsing.textContent = i18n.additionsTabBrowsing[currentLang];
    
    const additionsTabTracking = document.getElementById('additionsTabTracking');
    if (additionsTabTracking) additionsTabTracking.textContent = i18n.additionsTabTracking[currentLang];
    
    const trackingPanelDesc = document.getElementById('trackingPanelDesc');
    if (trackingPanelDesc) trackingPanelDesc.textContent = i18n.trackingPanelDesc[currentLang];
    
    const clearTrackingText = document.getElementById('clearTrackingText');
    if (clearTrackingText) clearTrackingText.textContent = i18n.clearTrackingText[currentLang];

    // 浏览记录子标签
    const browsingTabHistory = document.getElementById('browsingTabHistory');
    if (browsingTabHistory) browsingTabHistory.textContent = i18n.browsingTabHistory[currentLang];
    const browsingTabRanking = document.getElementById('browsingTabRanking');
    const browsingTabRelated = document.getElementById('browsingTabRelated');
    if (browsingTabRelated) browsingTabRelated.textContent = i18n.browsingTabRelated[currentLang];
    if (browsingTabRanking) browsingTabRanking.textContent = i18n.browsingTabRanking[currentLang];

    // 浏览记录相关文本
    const browsingRankingTitle = document.getElementById('browsingRankingTitle');
    if (browsingRankingTitle) browsingRankingTitle.textContent = i18n.browsingRankingTitle[currentLang];
    const browsingRankingDescription = document.getElementById('browsingRankingDescription');
    if (browsingRankingDescription) browsingRankingDescription.textContent = i18n.browsingRankingDescription[currentLang];
    const browsingRankingFilterDay = document.getElementById('browsingRankingFilterDay');
    if (browsingRankingFilterDay) browsingRankingFilterDay.textContent = i18n.browsingRankingFilterToday[currentLang];
    const browsingRankingFilterWeek = document.getElementById('browsingRankingFilterWeek');
    if (browsingRankingFilterWeek) browsingRankingFilterWeek.textContent = i18n.browsingRankingFilterWeek[currentLang];
    const browsingRankingFilterMonth = document.getElementById('browsingRankingFilterMonth');
    if (browsingRankingFilterMonth) browsingRankingFilterMonth.textContent = i18n.browsingRankingFilterMonth[currentLang];
    const browsingRankingFilterYear = document.getElementById('browsingRankingFilterYear');
    if (browsingRankingFilterYear) browsingRankingFilterYear.textContent = i18n.browsingRankingFilterYear[currentLang];
    const browsingRankingFilterAll = document.getElementById('browsingRankingFilterAll');
    if (browsingRankingFilterAll) browsingRankingFilterAll.textContent = i18n.browsingRankingFilterAll[currentLang];

    // 书签关联记录相关文本
    const browsingRelatedTitle = document.getElementById('browsingRelatedTitle');
    if (browsingRelatedTitle) browsingRelatedTitle.textContent = i18n.browsingRelatedTitle[currentLang];
    const browsingRelatedDescription = document.getElementById('browsingRelatedDescription');
    if (browsingRelatedDescription) browsingRelatedDescription.textContent = i18n.browsingRelatedDescription[currentLang];
    const browsingRelatedLoadingText = document.getElementById('browsingRelatedLoadingText');
    if (browsingRelatedLoadingText) browsingRelatedLoadingText.textContent = i18n.browsingRelatedLoadingText[currentLang];
    const browsingRelatedFilterDay = document.getElementById('browsingRelatedFilterDay');
    if (browsingRelatedFilterDay) browsingRelatedFilterDay.textContent = i18n.browsingRelatedFilterDay[currentLang];
    const browsingRelatedFilterWeek = document.getElementById('browsingRelatedFilterWeek');
    if (browsingRelatedFilterWeek) browsingRelatedFilterWeek.textContent = i18n.browsingRelatedFilterWeek[currentLang];
    const browsingRelatedFilterMonth = document.getElementById('browsingRelatedFilterMonth');
    if (browsingRelatedFilterMonth) browsingRelatedFilterMonth.textContent = i18n.browsingRelatedFilterMonth[currentLang];
    const browsingRelatedFilterYear = document.getElementById('browsingRelatedFilterYear');
    if (browsingRelatedFilterYear) browsingRelatedFilterYear.textContent = i18n.browsingRelatedFilterYear[currentLang];
    const browsingRelatedFilterAll = document.getElementById('browsingRelatedFilterAll');
    if (browsingRelatedFilterAll) browsingRelatedFilterAll.textContent = i18n.browsingRelatedFilterAll[currentLang];
    const browsingCalendarLoadingText = document.getElementById('browsingCalendarLoadingText');
    if (browsingCalendarLoadingText) browsingCalendarLoadingText.textContent = i18n.browsingCalendarLoading[currentLang];

    const nativeHistoryText = document.getElementById('nativeHistoryButtonText');
    if (nativeHistoryText) nativeHistoryText.textContent = i18n.nativeHistoryButtonText[currentLang];
    const groupedHistoryText = document.getElementById('groupedHistoryButtonText');
    if (groupedHistoryText) groupedHistoryText.textContent = i18n.groupedHistoryButtonText[currentLang];

    const additionsAnkiTitle = document.getElementById('additionsAnkiTitle');
    if (additionsAnkiTitle) additionsAnkiTitle.textContent = i18n.additionsAnkiTitle[currentLang];
    const additionsAnkiDescription = document.getElementById('additionsAnkiDescription');
    if (additionsAnkiDescription) additionsAnkiDescription.textContent = i18n.additionsAnkiDescription[currentLang];

    // 导出相关翻译
    const exportTooltip = document.getElementById('calendarExportTooltip');
    if (exportTooltip) exportTooltip.textContent = i18n.exportTooltip[currentLang];

    const exportModalTitle = document.getElementById('exportModalTitle');
    if (exportModalTitle) exportModalTitle.textContent = i18n.exportModalTitle[currentLang];

    const doExportBtn = document.getElementById('doExportBtn');
    if (doExportBtn) {
        // 保留图标
        const icon = doExportBtn.querySelector('i');
        doExportBtn.childNodes[doExportBtn.childNodes.length - 1].textContent = ' ' + i18n.exportBtnStart[currentLang];
    }

    // 更新导出弹窗内的标签（需要遍历查找，因为没有ID，或者我们给它们加ID）
    // 这里为了简单，我们在HTML中添加data-i18n属性会更好，但现在直接操作DOM
    // 重新打开弹窗时也会触发文本更新（见 BookmarkCalendar.openExportModal）
    // 但我们需要在 applyLanguage 中也处理一下静态文本

    document.querySelectorAll('#exportModal h4').forEach((h4, index) => {
        if (index === 0) h4.textContent = i18n.exportScopeLabel[currentLang];
        if (index === 1) h4.textContent = i18n.exportModeLabel[currentLang];
        if (index === 2) h4.textContent = i18n.exportFormatLabel[currentLang];
    });

    // 导出选项文本更新
    const updateRadioLabel = (val, titleKey, descKey) => {
        const input = document.querySelector(`input[name="exportMode"][value="${val}"]`);
        if (input && input.nextElementSibling) {
            const span = input.nextElementSibling;
            span.innerHTML = `${i18n[titleKey][currentLang]} <small style="color: var(--text-tertiary);">${i18n[descKey][currentLang]}</small>`;
        }
    };

    updateRadioLabel('records', 'exportModeRecords', 'exportModeRecordsDesc');
    updateRadioLabel('context', 'exportModeContext', 'exportModeContextDesc');
    updateRadioLabel('collection', 'exportModeCollection', 'exportModeCollectionDesc');

    const updateCheckboxLabel = (val, titleKey) => {
        const input = document.querySelector(`input[name="exportFormat"][value="${val}"]`);
        if (input && input.nextElementSibling) {
            input.nextElementSibling.textContent = i18n[titleKey][currentLang];
        }
    };

    updateCheckboxLabel('html', 'exportFormatHtml');
    updateCheckboxLabel('json', 'exportFormatJson');
    updateCheckboxLabel('copy', 'exportFormatCopy');

    // 导出相关翻译 (点击记录)
    const browsingExportTooltip = document.getElementById('browsingCalendarExportTooltip');
    if (browsingExportTooltip) browsingExportTooltip.textContent = i18n.browsingExportTooltip[currentLang];

    const browsingSelectModeText = document.getElementById('browsingCalendarSelectModeText');
    if (browsingSelectModeText) browsingSelectModeText.textContent = i18n.calendarSelectMode[currentLang];

    const browsingLocateTodayText = document.getElementById('browsingCalendarLocateTodayText');
    if (browsingLocateTodayText) browsingLocateTodayText.textContent = i18n.calendarLocateToday[currentLang];

    const browsingExportModalTitle = document.getElementById('browsingExportModalTitle');
    if (browsingExportModalTitle) browsingExportModalTitle.textContent = i18n.browsingExportModalTitle[currentLang];

    const doBrowsingExportBtn = document.getElementById('doBrowsingExportBtn');
    if (doBrowsingExportBtn) {
        // 保留图标
        const icon = doBrowsingExportBtn.querySelector('i');
        doBrowsingExportBtn.childNodes[doBrowsingExportBtn.childNodes.length - 1].textContent = ' ' + i18n.exportBtnStart[currentLang];
    }

    // 更新点击记录导出弹窗内的标签
    document.querySelectorAll('#browsingExportModal h4').forEach((h4, index) => {
        if (index === 0) h4.textContent = i18n.exportScopeLabel[currentLang];
        if (index === 1) h4.textContent = i18n.exportModeLabel[currentLang];
        if (index === 2) h4.textContent = i18n.exportFormatLabel[currentLang];
    });

    // 导出选项文本更新 (点击记录)
    const updateBrowsingRadioLabel = (val, titleKey, descKey) => {
        const input = document.querySelector(`input[name="browsingExportMode"][value="${val}"]`);
        if (input && input.nextElementSibling) {
            const span = input.nextElementSibling;
            span.innerHTML = `${i18n[titleKey][currentLang]} <small style="color: var(--text-tertiary);">${i18n[descKey][currentLang]}</small>`;
        }
    };

    updateBrowsingRadioLabel('records', 'browsingExportModeRecords', 'exportModeRecordsDesc');
    updateBrowsingRadioLabel('context', 'exportModeContext', 'exportModeContextDesc');
    updateBrowsingRadioLabel('collection', 'exportModeCollection', 'exportModeCollectionDesc');

    const updateBrowsingCheckboxLabel = (val, titleKey) => {
        const input = document.querySelector(`input[name="browsingExportFormat"][value="${val}"]`);
        if (input && input.nextElementSibling) {
            input.nextElementSibling.textContent = i18n[titleKey][currentLang];
        }
    };

    updateBrowsingCheckboxLabel('html', 'exportFormatHtml');
    updateBrowsingCheckboxLabel('json', 'exportFormatJson');
    updateBrowsingCheckboxLabel('copy', 'exportFormatCopy');

    // 时间捕捉翻译
    const trackingTitle = document.getElementById('trackingTitle');
    if (trackingTitle) trackingTitle.textContent = i18n.trackingTitle[currentLang];
    
    const trackingToggleText = document.getElementById('trackingToggleText');
    if (trackingToggleText) {
        const toggleBtn = document.getElementById('trackingToggleBtn');
        const isActive = toggleBtn && toggleBtn.classList.contains('active');
        trackingToggleText.textContent = isActive ? 
            i18n.trackingToggleOn[currentLang] : i18n.trackingToggleOff[currentLang];
    }
    
    const clearTrackingBtn = document.getElementById('clearTrackingBtn');
    if (clearTrackingBtn) clearTrackingBtn.title = i18n.trackingClearBtn[currentLang];
    
    const trackingCurrentTitle = document.getElementById('trackingCurrentTitle');
    if (trackingCurrentTitle) trackingCurrentTitle.textContent = i18n.trackingCurrentTitle[currentLang];
    
    const trackingNoActiveText = document.getElementById('trackingNoActiveText');
    if (trackingNoActiveText) trackingNoActiveText.textContent = i18n.trackingNoActive[currentLang];
    
    const trackingHeaderState = document.getElementById('trackingHeaderState');
    if (trackingHeaderState) {
        // 更新文本 span，保留帮助图标
        const textSpan = trackingHeaderState.querySelector('.tracking-header-text');
        if (textSpan) {
            textSpan.textContent = i18n.trackingHeaderState[currentLang];
        }
        // 更新图标的 title
        const helpIcon = trackingHeaderState.querySelector('.tracking-state-help');
        if (helpIcon) {
            helpIcon.title = currentLang === 'en' ? 'State Guide' : '状态说明';
        }
    }
    const trackingHeaderTitle = document.getElementById('trackingHeaderTitle');
    if (trackingHeaderTitle) trackingHeaderTitle.textContent = i18n.trackingHeaderTitle[currentLang];
    const trackingHeaderTime = document.getElementById('trackingHeaderTime');
    if (trackingHeaderTime) trackingHeaderTime.textContent = i18n.trackingHeaderTime[currentLang];
    const trackingHeaderWakes = document.getElementById('trackingHeaderWakes');
    if (trackingHeaderWakes) trackingHeaderWakes.textContent = i18n.trackingHeaderWakes[currentLang];
    const trackingHeaderRatio = document.getElementById('trackingHeaderRatio');
    if (trackingHeaderRatio) trackingHeaderRatio.textContent = i18n.trackingHeaderRatio[currentLang];
    
    const trackingRankingTitle = document.getElementById('trackingRankingTitle');
    if (trackingRankingTitle) trackingRankingTitle.textContent = i18n.trackingRankingTitle[currentLang];
    
    const trackingRangeToday = document.getElementById('trackingRangeToday');
    if (trackingRangeToday) trackingRangeToday.textContent = i18n.trackingRangeToday[currentLang];
    
    const trackingRangeWeek = document.getElementById('trackingRangeWeek');
    if (trackingRangeWeek) trackingRangeWeek.textContent = i18n.trackingRangeWeek[currentLang];
    
    const trackingRangeMonth = document.getElementById('trackingRangeMonth');
    if (trackingRangeMonth) trackingRangeMonth.textContent = i18n.trackingRangeMonth[currentLang];
    
    const trackingRangeYear = document.getElementById('trackingRangeYear');
    if (trackingRangeYear) trackingRangeYear.textContent = i18n.trackingRangeYear[currentLang];
    
    const trackingRangeAll = document.getElementById('trackingRangeAll');
    if (trackingRangeAll) trackingRangeAll.textContent = i18n.trackingRangeAll[currentLang];
    
    const trackingNoDataText = document.getElementById('trackingNoDataText');
    if (trackingNoDataText) trackingNoDataText.textContent = i18n.trackingNoData[currentLang];

    // 书签推荐翻译
    const recommendViewTitle = document.getElementById('recommendViewTitle');
    if (recommendViewTitle) recommendViewTitle.textContent = i18n.recommendViewTitle[currentLang];
    
    const recommendHelpBtn = document.getElementById('recommendHelpBtn');
    if (recommendHelpBtn) recommendHelpBtn.title = i18n.recommendHelpTooltip[currentLang];
    
    const legendFreshness = document.getElementById('legendFreshness');
    if (legendFreshness) legendFreshness.textContent = i18n.legendFreshness[currentLang];
    
    const legendColdness = document.getElementById('legendColdness');
    if (legendColdness) legendColdness.textContent = i18n.legendColdness[currentLang];
    
    const legendTimeDegree = document.getElementById('legendTimeDegree');
    if (legendTimeDegree) legendTimeDegree.textContent = i18n.legendTimeDegree[currentLang];
    
    const legendForgetting = document.getElementById('legendForgetting');
    if (legendForgetting) legendForgetting.textContent = i18n.legendForgetting[currentLang];
    
    const legendLaterReview = document.getElementById('legendLaterReview');
    if (legendLaterReview) legendLaterReview.textContent = i18n.legendLaterReview[currentLang];
    
    const laterReviewDesc = document.getElementById('laterReviewDesc');
    if (laterReviewDesc) laterReviewDesc.textContent = i18n.laterReviewDesc[currentLang];
    
    // 公式阈值（需要特殊处理，保留输入框）- 使用幂函数衰减公式
    document.querySelectorAll('.threshold-item').forEach((item, index) => {
        const input = item.querySelector('input');
        if (input) {
            const formulas = [
                { zh: 'F = 1/(1+(添加天数/', en: 'F = 1/(1+(days/' },
                { zh: 'C = 1/(1+(点击数/', en: 'C = 1/(1+(clicks/' },
                { zh: 'T = 1/(1+(综合时间/', en: 'T = 1/(1+(time/' },
                { zh: 'D = 1-1/(1+(未访问/', en: 'D = 1-1/(1+(unvisited/' }
            ];
            const suffixes = [
                { zh: ')⁰·⁷)', en: ')⁰·⁷)' },
                { zh: ')⁰·⁷)', en: ')⁰·⁷)' },
                { zh: '分钟)⁰·⁷)', en: 'min)⁰·⁷)' },
                { zh: '天)⁰·⁷)', en: 'days)⁰·⁷)' }
            ];
            const prefix = currentLang === 'en' ? formulas[index].en : formulas[index].zh;
            const suffix = currentLang === 'en' ? suffixes[index].en : suffixes[index].zh;
            // 重建内容
            const inputValue = input.value;
            const inputId = input.id;
            const inputClass = input.className;
            item.innerHTML = `${prefix}<input type="text" class="${inputClass}" id="${inputId}" value="${inputValue}">${suffix}`;
        }
    });
    
    // 预设模式按钮
    document.querySelectorAll('.preset-btn').forEach(btn => {
        const mode = btn.dataset.mode;
        const span = btn.querySelector('span');
        if (mode === 'default' && span) {
            span.textContent = i18n.presetDefault[currentLang];
            btn.title = i18n.presetDefaultTip[currentLang];
        } else if (mode === 'archaeology' && span) {
            span.textContent = i18n.presetArchaeology[currentLang];
            btn.title = i18n.presetArchaeologyTip[currentLang];
        } else if (mode === 'consolidate' && span) {
            span.textContent = i18n.presetConsolidate[currentLang];
            btn.title = i18n.presetConsolidateTip[currentLang];
        } else if (mode === 'wander' && span) {
            span.textContent = i18n.presetWander[currentLang];
            btn.title = i18n.presetWanderTip[currentLang];
        } else if (mode === 'priority' && span) {
            span.textContent = i18n.presetPriority[currentLang];
            btn.title = i18n.presetPriorityTip[currentLang];
        }
    });
    
    const resetFormulaText = document.getElementById('resetFormulaText');
    if (resetFormulaText) resetFormulaText.textContent = i18n.resetFormulaText[currentLang];
    
    const cardRefreshText = document.getElementById('cardRefreshText');
    if (cardRefreshText) cardRefreshText.textContent = i18n.cardRefreshText[currentLang];
    
    const refreshSettingsTitle = document.getElementById('refreshSettingsTitle');
    if (refreshSettingsTitle) refreshSettingsTitle.textContent = i18n.refreshSettingsTitle[currentLang];
    
    const refreshEveryNOpensLabel = document.getElementById('refreshEveryNOpensLabel');
    if (refreshEveryNOpensLabel) refreshEveryNOpensLabel.textContent = i18n.refreshEveryNOpensLabel[currentLang];
    
    const refreshEveryNOpensUnit = document.getElementById('refreshEveryNOpensUnit');
    if (refreshEveryNOpensUnit) refreshEveryNOpensUnit.textContent = i18n.refreshEveryNOpensUnit[currentLang];
    
    const refreshAfterHoursLabel = document.getElementById('refreshAfterHoursLabel');
    if (refreshAfterHoursLabel) refreshAfterHoursLabel.textContent = i18n.refreshAfterHoursLabel[currentLang];
    
    const refreshAfterHoursUnit = document.getElementById('refreshAfterHoursUnit');
    if (refreshAfterHoursUnit) refreshAfterHoursUnit.textContent = i18n.refreshAfterHoursUnit[currentLang];
    
    const refreshAfterDaysLabel = document.getElementById('refreshAfterDaysLabel');
    if (refreshAfterDaysLabel) refreshAfterDaysLabel.textContent = i18n.refreshAfterDaysLabel[currentLang];
    
    const refreshAfterDaysUnit = document.getElementById('refreshAfterDaysUnit');
    if (refreshAfterDaysUnit) refreshAfterDaysUnit.textContent = i18n.refreshAfterDaysUnit[currentLang];
    
    const refreshSettingsSaveText = document.getElementById('refreshSettingsSaveText');
    if (refreshSettingsSaveText) refreshSettingsSaveText.textContent = i18n.refreshSettingsSave[currentLang];
    
    const heatmapTitle = document.getElementById('heatmapTitle');
    if (heatmapTitle) heatmapTitle.textContent = i18n.heatmapTitle[currentLang];
    
    const heatmapLoadingText = document.getElementById('heatmapLoadingText');
    if (heatmapLoadingText) heatmapLoadingText.textContent = i18n.heatmapLoading[currentLang];

    // 待复习区域翻译
    const postponedTitle = document.getElementById('postponedTitle');
    if (postponedTitle) postponedTitle.textContent = i18n.postponedTitle[currentLang];
    
    const priorityBadge = document.getElementById('postponedPriorityBadge');
    if (priorityBadge) priorityBadge.textContent = i18n.priorityModeBadge[currentLang];
    
    const postponedEmptyText = document.getElementById('postponedEmptyText');
    if (postponedEmptyText) postponedEmptyText.textContent = i18n.postponedEmptyText[currentLang];
    
    const addPostponedModalTitle = document.getElementById('addPostponedModalTitle');
    if (addPostponedModalTitle) addPostponedModalTitle.textContent = i18n.addPostponedModalTitle[currentLang];
    
    const postponedAddBtn = document.getElementById('postponedAddBtn');
    if (postponedAddBtn) postponedAddBtn.title = i18n.postponedAddBtnTitle[currentLang];

    // 「Add to Review」弹窗翻译
    const addTabFolder = document.getElementById('addTabFolder');
    if (addTabFolder) addTabFolder.textContent = i18n.addTabFolder[currentLang];
    
    const addTabSearch = document.getElementById('addTabSearch');
    if (addTabSearch) addTabSearch.textContent = i18n.addTabSearch[currentLang];
    
    const addTabDomain = document.getElementById('addTabDomain');
    if (addTabDomain) addTabDomain.textContent = i18n.addTabDomain[currentLang];

    const addFolderLabel = document.getElementById('addFolderLabel');
    if (addFolderLabel) addFolderLabel.textContent = i18n.addFolderLabel[currentLang];
    
    const addCountLabel = document.getElementById('addCountLabel');
    if (addCountLabel) addCountLabel.textContent = i18n.addCountLabel[currentLang];
    
    const addSelectAllLabel = document.getElementById('addSelectAllLabel');
    if (addSelectAllLabel) addSelectAllLabel.textContent = i18n.addSelectAllLabel[currentLang];
    
    const addModeLabel = document.getElementById('addModeLabel');
    if (addModeLabel) addModeLabel.textContent = i18n.addModeLabel[currentLang];
    
    const addModeRandom = document.getElementById('addModeRandom');
    if (addModeRandom) addModeRandom.textContent = i18n.addModeRandom[currentLang];
    
    const addModeSequential = document.getElementById('addModeSequential');
    if (addModeSequential) addModeSequential.textContent = i18n.addModeSequential[currentLang];
    
    const addIncludeSubfolders = document.getElementById('addIncludeSubfolders');
    if (addIncludeSubfolders) addIncludeSubfolders.textContent = i18n.addIncludeSubfolders[currentLang];

    const addSearchInput = document.getElementById('addSearchInput');
    if (addSearchInput) addSearchInput.placeholder = i18n.addSearchPlaceholder[currentLang];

    const addSearchEmpty = document.getElementById('addSearchEmpty');
    if (addSearchEmpty) addSearchEmpty.textContent = i18n.addSearchEmpty[currentLang];

    const addSearchSelectedText = document.getElementById('addSearchSelectedText');
    if (addSearchSelectedText) addSearchSelectedText.textContent = i18n.addSearchSelectedText[currentLang];

    const addDomainSearchInput = document.getElementById('addDomainSearchInput');
    if (addDomainSearchInput) addDomainSearchInput.placeholder = i18n.addDomainSearchPlaceholder[currentLang];

    const addDomainLoading = document.getElementById('addDomainLoading');
    if (addDomainLoading) addDomainLoading.textContent = i18n.addDomainLoading[currentLang];

    const addDomainSelectedText = document.getElementById('addDomainSelectedText');
    if (addDomainSelectedText) addDomainSelectedText.textContent = i18n.addDomainSelectedText[currentLang];

    const addDomainSelectedLabel = document.getElementById('addDomainSelectedLabel');
    if (addDomainSelectedLabel) addDomainSelectedLabel.textContent = i18n.addDomainSelectedLabel[currentLang];

    const addPostponedCancelBtn = document.getElementById('addPostponedCancelBtn');
    if (addPostponedCancelBtn) addPostponedCancelBtn.textContent = i18n.addPostponedCancelText[currentLang];
    
    const addPostponedConfirmBtn = document.getElementById('addPostponedConfirmBtn');
    if (addPostponedConfirmBtn) addPostponedConfirmBtn.textContent = i18n.addPostponedConfirmText[currentLang];
    
    // 卡片按钮title
    document.querySelectorAll('.card-btn-later').forEach(btn => {
        btn.title = i18n.cardLaterTitle[currentLang];
    });
    
    // 屏蔽管理翻译
    const blockManageTitle = document.getElementById('blockManageTitle');
    if (blockManageTitle) blockManageTitle.textContent = i18n.blockManageTitle[currentLang];

    const blockedBookmarksTitle = document.getElementById('blockedBookmarksTitle');
    if (blockedBookmarksTitle) blockedBookmarksTitle.textContent = i18n.blockedBookmarksTitle[currentLang];
    
    const blockedBookmarksEmptyText = document.getElementById('blockedBookmarksEmptyText');
    if (blockedBookmarksEmptyText) blockedBookmarksEmptyText.textContent = i18n.blockedBookmarksEmptyText[currentLang];

    const blockedFoldersTitle = document.getElementById('blockedFoldersTitle');
    if (blockedFoldersTitle) blockedFoldersTitle.textContent = i18n.blockedFoldersTitle[currentLang];
    
    const blockedDomainsTitle = document.getElementById('blockedDomainsTitle');
    if (blockedDomainsTitle) blockedDomainsTitle.textContent = i18n.blockedDomainsTitle[currentLang];
    
    const blockedFoldersEmptyText = document.getElementById('blockedFoldersEmptyText');
    if (blockedFoldersEmptyText) blockedFoldersEmptyText.textContent = i18n.blockedFoldersEmptyText[currentLang];
    
    const blockedDomainsEmptyText = document.getElementById('blockedDomainsEmptyText');
    if (blockedDomainsEmptyText) blockedDomainsEmptyText.textContent = i18n.blockedDomainsEmptyText[currentLang];
    
    const addDomainModalTitle = document.getElementById('addDomainModalTitle');
    if (addDomainModalTitle) addDomainModalTitle.textContent = i18n.addDomainModalTitle[currentLang];
    
    const addDomainModalDesc = document.getElementById('addDomainModalDesc');
    if (addDomainModalDesc) addDomainModalDesc.textContent = i18n.addDomainModalDesc[currentLang];
    
    const addDomainCancelBtn = document.getElementById('addDomainCancelBtn');
    if (addDomainCancelBtn) addDomainCancelBtn.textContent = i18n.addDomainCancelBtn[currentLang];
    
    const addDomainConfirmBtn = document.getElementById('addDomainConfirmBtn');
    if (addDomainConfirmBtn) addDomainConfirmBtn.textContent = i18n.addDomainConfirmBtn[currentLang];
    
    const selectFolderModalTitle = document.getElementById('selectFolderModalTitle');
    if (selectFolderModalTitle) selectFolderModalTitle.textContent = i18n.selectFolderModalTitle[currentLang];
    
    // 稍后复习弹窗翻译
    const laterRecommendLabel = document.getElementById('laterRecommendLabel');
    if (laterRecommendLabel) laterRecommendLabel.textContent = i18n.laterRecommendLabel[currentLang];
    
    const laterOrText = document.getElementById('laterOrText');
    if (laterOrText) laterOrText.textContent = i18n.laterOrText[currentLang];

    // 更新语言切换按钮
    document.querySelector('#langToggle .lang-text').textContent = currentLang === 'zh_CN' ? 'EN' : '中';

    // 更新主题切换按钮图标
    const themeIcon = document.querySelector('#themeToggle i');
    if (currentTheme === 'dark') {
        themeIcon.className = 'fas fa-sun';
    } else {
        themeIcon.className = 'fas fa-moon';
    }
}

// =============================================================================
// UI 初始化
// =============================================================================

function initializeUI() {
    // 导航标签切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // 状态过滤按钮（已删除，但保留代码以防恢复）
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdditionsView();
        });
    });

    // 时间过滤按钮（已删除，但保留代码以防恢复）
    document.querySelectorAll('.time-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentTimeFilter = btn.dataset.timeFilter;
            document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdditionsView();
        });
    });

    // 「书签温故」子视图标签
    initAdditionsSubTabs();

    // 工具按钮
    document.getElementById('refreshBtn').addEventListener('click', refreshData);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('langToggle').addEventListener('click', toggleLanguage);
    const helpToggle = document.getElementById('helpToggle');
    const shortcutsModal = document.getElementById('shortcutsModal');
    const closeShortcutsModal = document.getElementById('closeShortcutsModal');
    if (helpToggle && shortcutsModal) {
        helpToggle.addEventListener('click', () => {
            if (typeof updateShortcutsDisplay === 'function') {
                updateShortcutsDisplay();
            }
            shortcutsModal.classList.add('show');
        });
    }
    if (closeShortcutsModal && shortcutsModal) {
        closeShortcutsModal.addEventListener('click', () => {
            shortcutsModal.classList.remove('show');
        });
    }
    // 点击弹窗外部区域关闭（只在点击遮罩本身时触发）
    if (shortcutsModal) {
        shortcutsModal.addEventListener('click', (e) => {
            if (e.target === shortcutsModal) {
                shortcutsModal.classList.remove('show');
            }
        });
    }

    // 撤销全部按钮（当前变化和书签树）
    const revertAllCurrentBtn = document.getElementById('revertAllCurrentBtn');
    if (revertAllCurrentBtn) {
        revertAllCurrentBtn.addEventListener('click', () => handleRevertAll('current'));
    }
    // Canvas 相关事件监听在 Canvas 模块中处理

    // 搜索
    document.getElementById('searchInput').addEventListener('input', handleSearch);

    // 弹窗关闭
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('detailModal').addEventListener('click', (e) => {
        if (e.target.id === 'detailModal') closeModal();
    });

    // 注意：不再在这里调用 updateUIForCurrentView()，因为已经在 DOMContentLoaded 早期调用了 applyViewState()
    console.log('[initializeUI] UI事件监听器初始化完成，当前视图:', currentView);
}

// 用于防止Revert结果显示多次的标志
let revertInProgress = false;
let lastRevertMessageHandler = null;
let revertOverlayTimeout = null;

// 二次确认并触发撤销全部
async function handleRevertAll(source) {
    try {
        // 第一次确认
        const first = confirm(`${i18n.revertConfirmTitle[currentLang]}\n\n${i18n.revertConfirmDesc[currentLang]}`);
        if (!first) return;
        // 第二次确认
        const second = confirm(i18n.revertConfirmSecondary[currentLang]);
        if (!second) return;

        // 防止多次触发
        if (revertInProgress) {
            console.warn('[handleRevertAll] Revert已在进行中，忽略本次请求');
            return;
        }
        revertInProgress = true;

        // 显示全屏覆盖层（隐藏下面的所有刷新过程）
        showRevertOverlay();

        // 发送消息到后台
        browserAPI.runtime.sendMessage({
            action: 'revertAllToLastBackup',
            fromHistoryViewer: true
        }, (response) => {
            if (revertInProgress && response) {
                const isSuccess = response && response.success;
                const message = isSuccess
                    ? i18n.revertSuccess[currentLang]
                    : (i18n.revertFailed[currentLang] + (response && response.error ? response.error : 'Unknown error'));

                // 设置超时处理完成
                if (revertOverlayTimeout) clearTimeout(revertOverlayTimeout);
                revertOverlayTimeout = setTimeout(async () => {
                    // 隐藏覆盖层
                    hideRevertOverlay();
                    revertInProgress = false;
                    revertOverlayTimeout = null;

                    // 显示最终结果提示
                    showRevertToast(isSuccess, message);

                    // 如果成功，一次性刷新当前视图
                    if (isSuccess) {
                        console.log('[handleRevertAll] 撤销成功，进行一次性刷新');
                        try {
                            await loadAllData({ skipRender: true });

                            if (currentView === 'current-changes') {
                                await renderCurrentChangesViewWithRetry(1, true);
                            } else if (currentView === 'tree') {
                                await renderTreeView(true);
                            } else if (currentView === 'history') {
                                await renderHistoryView();
                            } else if (currentView === 'additions') {
                                await renderAdditionsView();
                            }
                        } catch (e) {
                            console.error('[handleRevertAll] 刷新异常:', e);
                        }
                    }
                }, 400); // 极速响应 400ms
            }
        });

        console.log('[handleRevertAll] 已发送revert请求');

    } catch (error) {
        revertInProgress = false;
        hideRevertOverlay();
        showRevertToast(false, error && error.message ? error.message : String(error));
    }
}

// 显示撤销覆盖层
function showRevertOverlay() {
    const overlay = document.getElementById('revertOverlay');
    const mainContainer = document.querySelector('.main-container');

    if (overlay) {
        overlay.style.display = 'flex';
        const text = document.getElementById('revertOverlayText');
        if (text) {
            text.textContent = currentLang === 'zh_CN' ? '正在处理中...' : 'Processing...';
        }
    }

    // 隐藏主内容区域，防止任何闪烁
    if (mainContainer) {
        mainContainer.style.opacity = '0';
        mainContainer.style.pointerEvents = 'none';
    }
}

// 隐藏撤销覆盖层
function hideRevertOverlay() {
    const overlay = document.getElementById('revertOverlay');
    const mainContainer = document.querySelector('.main-container');

    if (overlay) {
        overlay.style.display = 'none';
    }

    // 恢复主内容区域
    if (mainContainer) {
        mainContainer.style.opacity = '1';
        mainContainer.style.pointerEvents = 'auto';
    }
}

// 显示Revert的提示（单一提示，成功绿色，失败红色）
function showRevertToast(isSuccess, message) {
    // 移除之前的提示（只保留一个）
    const existingToast = document.querySelector('.revert-toast');
    if (existingToast) {
        existingToast.remove();
    }

    // 创建新的提示
    const toast = document.createElement('div');
    toast.className = 'revert-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10000;
        animation: slideUp 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        max-width: 300px;
        word-break: break-word;
        display: flex;
        align-items: center;
        gap: 8px;
    `;

    if (isSuccess) {
        toast.style.backgroundColor = '#d4edda';
        toast.style.color = '#155724';
        toast.style.border = '1px solid #c3e6cb';
        toast.innerHTML = `<i class="fas fa-check-circle" style="color: #28a745;"></i><span>${message}</span>`;
    } else {
        toast.style.backgroundColor = '#f8d7da';
        toast.style.color = '#721c24';
        toast.style.border = '1px solid #f5c6cb';
        toast.innerHTML = `<i class="fas fa-exclamation-circle" style="color: #dc3545;"></i><span>${message}</span>`;
    }

    document.body.appendChild(toast);

    // 3秒后自动移除
    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

// =============================================================================
// 数据加载
// =============================================================================

async function loadAllData(options = {}) {
    const { skipRender = false } = options;
    console.log('[loadAllData] 开始加载所有数据...');

    try {
        await ensureAdditionsCacheLoaded(skipRender);

        // 并行加载所有数据
        const [storageData, bookmarkTree] = await Promise.all([
            loadStorageData(),
            loadBookmarkTree()
        ]);

        syncHistory = storageData.syncHistory || [];

        // 清理bookmarkTree以减少内存占用和防止复制时卡顿
        // 只保留最近3条记录的bookmarkTree用于显示详情
        syncHistory = syncHistory.map((record, index) => {
            // 保留最新的3条记录的bookmarkTree
            if (index >= syncHistory.length - 3) {
                return record;
            }
            // 其他记录删除bookmarkTree
            const { bookmarkTree, ...recordWithoutTree } = record;
            return recordWithoutTree;
        });

        console.log('[loadAllData] 已清理历史记录中的大数据，保留最新3条的bookmarkTree');

        // 将 ISO 字符串格式转换为时间戳（毫秒）
        lastBackupTime = storageData.lastSyncTime ? new Date(storageData.lastSyncTime).getTime() : null;
        allBookmarks = flattenBookmarkTree(bookmarkTree);
        rebuildBookmarkUrlSet();
        additionsCacheRestored = true;
        await persistAdditionsCache();
        cachedBookmarkTree = bookmarkTree;

        console.log('[loadAllData] 数据加载完成:', {
            历史记录数: syncHistory.length,
            书签总数: allBookmarks.length
        });

        // 如果当前正在查看 current-changes，重新渲染
        if (currentView === 'current-changes' && !skipRender) {
            console.log('[loadAllData] 刷新当前变化视图');
            renderCurrentChangesView();
        }

    } catch (error) {
        console.error('[loadAllData] 加载数据失败:', error);
        showError('加载数据失败');
    }
}

// 预加载所有视图的数据
async function preloadAllViews() {
    if (isPreloading) return;
    isPreloading = true;

    console.log('[预加载] 开始预加载所有视图...');

    try {
        // 预加载书签树（后台准备）
        if (!cachedBookmarkTree) {
            cachedBookmarkTree = await loadBookmarkTree();
            console.log('[预加载] 书签树已缓存');
        }

        // 预加载当前变化数据（后台准备）
        if (!cachedCurrentChanges) {
            cachedCurrentChanges = await getDetailedChanges();
            console.log('[预加载] 当前变化数据已缓存');
        }

        console.log('[预加载] 所有视图数据预加载完成');
    } catch (error) {
        console.error('[预加载] 预加载失败:', error);
    } finally {
        isPreloading = false;
    }
}

// 预加载常见网站的图标
async function preloadCommonIcons() {
    console.log('[图标预加载] 开始预加载常见图标...');

    try {
        // 获取当前所有书签的 URL，过滤掉无效的
        const urls = allBookmarks
            .map(b => b.url)
            .filter(url => url && url.trim() && (url.startsWith('http://') || url.startsWith('https://')));

        if (urls.length === 0) {
            console.log('[图标预加载] 没有有效的 URL 需要预加载');
            return;
        }

        // 批量预加载（限制并发数）
        const batchSize = 10;
        const maxPreload = Math.min(urls.length, 50);

        for (let i = 0; i < maxPreload; i += batchSize) {
            const batch = urls.slice(i, i + batchSize);
            await Promise.all(batch.map(url => preloadIcon(url)));
        }

        console.log('[图标预加载] 完成，已预加载', maxPreload, '个图标');
    } catch (error) {
        console.error('[图标预加载] 失败:', error);
    }
}

// 预加载单个图标（使用新的缓存系统）
async function preloadIcon(url) {
    try {
        // 基本验证
        if (!url || FaviconCache.isInvalidUrl(url)) {
            return;
        }

        // 使用缓存系统获取favicon（会自动缓存）
        await FaviconCache.fetch(url);
    } catch (error) {
        console.warn('[图标预加载] URL 预加载失败:', url, error.message);
    }
}

// 【关键修复】预热 favicon 内存缓存（从 IndexedDB 批量加载）
// 用于解决切换视图时图标变成五角星的问题
async function warmupFaviconCache(bookmarkUrls) {
    if (!bookmarkUrls || bookmarkUrls.length === 0) return;

    try {
        console.log('[Favicon预热] 开始预热内存缓存，书签数量:', bookmarkUrls.length);

        // 初始化 IndexedDB（如果还没初始化）
        if (!FaviconCache.db) {
            await FaviconCache.init();
        }

        // 批量从 IndexedDB 读取所有域名的 favicon
        const domains = new Set();
        bookmarkUrls.forEach(url => {
            try {
                if (!FaviconCache.isInvalidUrl(url)) {
                    const domain = new URL(url).hostname;
                    domains.add(domain);
                }
            } catch (e) {
                // 忽略无效URL
            }
        });

        if (domains.size === 0) return;

        console.log('[Favicon预热] 需要预热的域名数:', domains.size);

        // 批量读取
        const transaction = FaviconCache.db.transaction([FaviconCache.storeName], 'readonly');
        const store = transaction.objectStore(FaviconCache.storeName);

        let loaded = 0;
        for (const domain of domains) {
            // 跳过已在内存缓存中的
            if (FaviconCache.memoryCache.has(domain)) continue;

            try {
                const request = store.get(domain);
                await new Promise((resolve) => {
                    request.onsuccess = () => {
                        if (request.result && request.result.dataUrl) {
                            FaviconCache.memoryCache.set(domain, request.result.dataUrl);
                            loaded++;
                        }
                        resolve();
                    };
                    request.onerror = () => resolve();
                });
            } catch (e) {
                // 忽略单个域名的错误
            }
        }

        console.log('[Favicon预热] 完成，从IndexedDB加载了', loaded, '个favicon到内存');
    } catch (error) {
        console.warn('[Favicon预热] 失败:', error);
    }
}

function loadStorageData() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['syncHistory', 'lastSyncTime'], (data) => {
            resolve(data);
        });
    });
}

function loadBookmarkTree() {
    return new Promise((resolve) => {
        browserAPI.bookmarks.getTree((tree) => {
            resolve(tree[0]);
        });
    });
}

function flattenBookmarkTree(node, parentPath = '') {
    const bookmarks = [];
    const currentPath = parentPath ? `${parentPath}/${node.title}` : node.title;

    if (node.url) {
        bookmarks.push({
            id: node.id,
            title: node.title,
            url: node.url,
            dateAdded: node.dateAdded,
            path: currentPath,
            parentId: node.parentId
        });
    }

    if (node.children) {
        node.children.forEach(child => {
            bookmarks.push(...flattenBookmarkTree(child, currentPath));
        });
    }

    return bookmarks;
}

// =============================================================================
// 差异计算辅助函数（与主 UI 一致）
// =============================================================================

function getFirstValidNumber(...values) {
    for (const value of values) {
        if (typeof value === 'number' && !Number.isNaN(value)) {
            return value;
        }
    }
    return 0;
}

function extractCountsFromStatsSource(statsSource) {
    if (!statsSource) {
        return { bookmarks: 0, folders: 0 };
    }
    return {
        bookmarks: getFirstValidNumber(
            statsSource.bookmarkCount,
            statsSource.currentBookmarkCount,
            statsSource.currentBookmarks
        ),
        folders: getFirstValidNumber(
            statsSource.folderCount,
            statsSource.currentFolderCount,
            statsSource.currentFolders
        )
    };
}

function extractCountsFromHistoryRecord(record) {
    if (!record || !record.bookmarkStats) return null;
    const counts = extractCountsFromStatsSource(record.bookmarkStats);
    if (counts && (counts.bookmarks || counts.folders || counts.bookmarks === 0 || counts.folders === 0)) {
        return counts;
    }
    return null;
}

function findLatestRecordCounts(syncHistory) {
    if (!Array.isArray(syncHistory) || syncHistory.length === 0) {
        return null;
    }
    for (let i = syncHistory.length - 1; i >= 0; i--) {
        const counts = extractCountsFromHistoryRecord(syncHistory[i]);
        if (counts) {
            return counts;
        }
    }
    return null;
}

function calculateBookmarkFolderDiffs(currentStats, syncHistory, cachedRecord) {
    const currentCounts = extractCountsFromStatsSource(currentStats);
    let previousCounts = findLatestRecordCounts(syncHistory);
    let diffSource = 'history';

    if (!previousCounts && cachedRecord) {
        previousCounts = extractCountsFromHistoryRecord(cachedRecord);
        diffSource = 'cachedRecord';
    }

    let bookmarkDiff = 0;
    let folderDiff = 0;
    let canCalculateDiff = false;

    if (previousCounts) {
        bookmarkDiff = currentCounts.bookmarks - previousCounts.bookmarks;
        folderDiff = currentCounts.folders - previousCounts.folders;
        canCalculateDiff = true;
    }

    if (!canCalculateDiff) {
        const fallbackBookmarkDiff = currentStats && typeof currentStats.bookmarkDiff === 'number' ? currentStats.bookmarkDiff : 0;
        const fallbackFolderDiff = currentStats && typeof currentStats.folderDiff === 'number' ? currentStats.folderDiff : 0;
        bookmarkDiff = fallbackBookmarkDiff;
        folderDiff = fallbackFolderDiff;
        diffSource = 'statsFallback';
        canCalculateDiff = typeof fallbackBookmarkDiff === 'number' || typeof fallbackFolderDiff === 'number';
    }

    const hasNumericalChange = canCalculateDiff && (bookmarkDiff !== 0 || folderDiff !== 0);

    return {
        bookmarkDiff,
        folderDiff,
        canCalculateDiff,
        diffSource,
        currentBookmarkCount: currentCounts.bookmarks,
        currentFolderCount: currentCounts.folders,
        hasNumericalChange
    };
}

function buildChangeSummary(diffMeta, stats, lang) {
    const effectiveLang = lang === 'en' ? 'en' : 'zh_CN';
    const summary = {
        hasQuantityChange: false,
        quantityTotalLine: '',
        quantityDiffLine: '',
        hasStructuralChange: false,
        structuralLine: '',
        structuralItems: []
    };

    if (!diffMeta) {
        diffMeta = {
            bookmarkDiff: 0,
            folderDiff: 0,
            hasNumericalChange: false,
            currentBookmarkCount: 0,
            currentFolderCount: 0
        };
    }

    const bookmarkDiff = diffMeta.bookmarkDiff || 0;
    const folderDiff = diffMeta.folderDiff || 0;
    const hasNumericalChange = diffMeta.hasNumericalChange === true;
    const currentBookmarks = diffMeta.currentBookmarkCount ?? 0;
    const currentFolders = diffMeta.currentFolderCount ?? 0;

    const i18nBookmarksLabel = window.i18nLabels?.bookmarksLabel || (effectiveLang === 'en' ? 'bookmarks' : '个书签');
    const i18nFoldersLabel = window.i18nLabels?.foldersLabel || (effectiveLang === 'en' ? 'folders' : '个文件夹');
    const totalBookmarkTerm = effectiveLang === 'en' ? 'BKM' : i18nBookmarksLabel;
    const totalFolderTerm = effectiveLang === 'en' ? 'FLD' : i18nFoldersLabel;

    summary.quantityTotalLine = effectiveLang === 'en'
        ? `${currentBookmarks} ${totalBookmarkTerm}, ${currentFolders} ${totalFolderTerm}`
        : `${currentBookmarks}${totalBookmarkTerm}，${currentFolders}${totalFolderTerm}`;

    if (hasNumericalChange) {
        summary.hasQuantityChange = true;
        const parts = [];

        if (bookmarkDiff !== 0) {
            const sign = bookmarkDiff > 0 ? '+' : '';
            const color = bookmarkDiff > 0 ? 'var(--positive-color, #4CAF50)' : 'var(--negative-color, #F44336)';
            const label = effectiveLang === 'en' ? 'BKM' : '书签';
            parts.push(`<span style="color:${color};font-weight:bold;">${sign}${bookmarkDiff}</span>${effectiveLang === 'en' ? ` ${label}` : label}`);
        }

        if (folderDiff !== 0) {
            const sign = folderDiff > 0 ? '+' : '';
            const color = folderDiff > 0 ? 'var(--positive-color, #4CAF50)' : 'var(--negative-color, #F44336)';
            const label = effectiveLang === 'en' ? 'FLD' : '文件夹';
            parts.push(`<span style="color:${color};font-weight:bold;">${sign}${folderDiff}</span>${effectiveLang === 'en' ? ` ${label}` : label}`);
        }

        summary.quantityDiffLine = parts.join(effectiveLang === 'en' ? ` <span style="color:var(--text-tertiary);">|</span> ` : '、');
    }

    const bookmarkMoved = Boolean(stats?.bookmarkMoved);
    const folderMoved = Boolean(stats?.folderMoved);
    const bookmarkModified = Boolean(stats?.bookmarkModified);
    const folderModified = Boolean(stats?.folderModified);

    const hasBookmarkStructural = bookmarkMoved || bookmarkModified;
    const hasFolderStructural = folderMoved || folderModified;

    if (hasBookmarkStructural || hasFolderStructural) {
        summary.hasStructuralChange = true;

        // 构建具体的结构变化列表
        const structuralParts = [];
        const movedCount = (typeof stats?.bookmarkMoved === 'number' ? stats.bookmarkMoved : 0) + (typeof stats?.folderMoved === 'number' ? stats.folderMoved : 0);
        const modifiedCount = (typeof stats?.bookmarkModified === 'number' ? stats.bookmarkModified : 0) + (typeof stats?.folderModified === 'number' ? stats.folderModified : 0);

        if (bookmarkMoved || folderMoved) {
            structuralParts.push(`${effectiveLang === 'en' ? 'Moved' : '移动'}${movedCount > 0 ? ` (${movedCount})` : ''}`);
            summary.structuralItems.push(`${effectiveLang === 'en' ? 'Moved' : '移动'}${movedCount > 0 ? ` (${movedCount})` : ''}`);
        }
        if (bookmarkModified || folderModified) {
            structuralParts.push(`${effectiveLang === 'en' ? 'Modified' : '修改'}${modifiedCount > 0 ? ` (${modifiedCount})` : ''}`);
            summary.structuralItems.push(`${effectiveLang === 'en' ? 'Modified' : '修改'}${modifiedCount > 0 ? ` (${modifiedCount})` : ''}`);
        }


        // 用具体的变化类型替代通用的"变动"标签
        const separator = effectiveLang === 'en' ? ' <span style="color:var(--text-tertiary);">|</span> ' : '、';
        const structuralText = structuralParts.join(separator);
        summary.structuralLine = `<span style="color:var(--accent-secondary, #FF9800);font-weight:bold;">${structuralText}</span>`;
    }

    return summary;
}

// =============================================================================
// 时间捕捉小组件更新
// =============================================================================

let timeTrackingWidgetInterval = null;

async function updateTimeTrackingWidget() {
    const widgetList = document.getElementById('timeTrackingWidgetList');
    const widgetTitle = document.getElementById('timeTrackingWidgetTitle');
    
    if (!widgetList) return;
    
    const emptyText = i18n.timeTrackingWidgetEmpty[currentLang];
    
    // 检查追踪是否开启
    let isTrackingEnabled = true;
    try {
        const enabledResponse = await browserAPI.runtime.sendMessage({ action: 'isTrackingEnabled' });
        if (enabledResponse && enabledResponse.success) {
            isTrackingEnabled = enabledResponse.enabled;
        }
    } catch (e) {
        console.warn('[时间捕捉小组件] 检查追踪状态失败:', e);
    }
    
    if (isTrackingEnabled) {
        // 追踪开启：显示当前追踪的书签
        if (widgetTitle) widgetTitle.textContent = i18n.timeTrackingWidgetTitle[currentLang];
        
        try {
            const response = await browserAPI.runtime.sendMessage({ 
                action: 'getCurrentActiveSessions' 
            });
            
            if (response && response.success && response.sessions && response.sessions.length > 0) {
                const sessions = response.sessions;
                const maxShow = 5;
                const showSessions = sessions.slice(0, maxShow);
                const remaining = sessions.length - maxShow;
                
                widgetList.innerHTML = '';
                
                showSessions.forEach(session => {
                    const item = document.createElement('div');
                    item.className = 'time-tracking-widget-item';
                    
                    const stateIcon = document.createElement('span');
                    stateIcon.className = 'item-state';
                    // 🟢活跃 🟡前台静止 🔵可见参考 ⚪后台 💤睡眠
                    stateIcon.textContent = session.state === 'active' ? '🟢' : 
                        (session.state === 'sleeping' ? '💤' : 
                        (session.state === 'background' ? '⚪' : 
                        (session.state === 'visible' ? '🔵' : '🟡')));
                    
                    const title = document.createElement('span');
                    title.className = 'item-title';
                    title.textContent = session.title || new URL(session.url).hostname;
                    title.title = session.title || session.url;
                    
                    const time = document.createElement('span');
                    time.className = 'item-time';
                    time.textContent = formatActiveTime(session.compositeMs || session.activeMs);
                    
                    item.appendChild(stateIcon);
                    item.appendChild(title);
                    item.appendChild(time);
                    widgetList.appendChild(item);
                });
                
                if (remaining > 0) {
                    const moreEl = document.createElement('div');
                    moreEl.className = 'time-tracking-widget-more';
                    moreEl.textContent = i18n.timeTrackingWidgetMore[currentLang].replace('{count}', remaining);
                    widgetList.appendChild(moreEl);
                }
            } else {
                showEmptyState();
            }
        } catch (error) {
            console.warn('[时间捕捉小组件] 获取数据失败:', error);
            showEmptyState();
        }
    } else {
        // 追踪关闭：显示点击排行前5名（优先今天，没有则本周）
        if (widgetTitle) widgetTitle.textContent = i18n.timeTrackingWidgetRankingTitle ? i18n.timeTrackingWidgetRankingTitle[currentLang] : (currentLang === 'zh_CN' ? '点击排行' : 'Click Ranking');
        
        try {
            // 使用书签浏览记录的点击排行数据
            const stats = await ensureBrowsingClickRankingStats();
            
            if (!stats || stats.error || !stats.items || stats.items.length === 0) {
                showEmptyState();
                return;
            }
            
            // 先尝试获取今天的数据
            let items = getBrowsingRankingItemsForRange('day');
            let isToday = true;
            let countKey = 'dayCount';
            
            // 如果今天没有数据，获取本周的
            if (!items || items.length === 0) {
                items = getBrowsingRankingItemsForRange('week');
                isToday = false;
                countKey = 'weekCount';
            }
            
            if (items && items.length > 0) {
                // 取前5
                const top5 = items.slice(0, 5);
                
                widgetList.innerHTML = '';
                
                top5.forEach((item, index) => {
                    const el = document.createElement('div');
                    el.className = 'time-tracking-widget-item ranking-item';
                    el.dataset.url = item.url;
                    
                    const rankNum = document.createElement('span');
                    rankNum.className = 'item-rank';
                    rankNum.textContent = `${index + 1}`;
                    
                    const title = document.createElement('span');
                    title.className = 'item-title';
                    try {
                        title.textContent = item.title || new URL(item.url).hostname;
                    } catch {
                        title.textContent = item.title || item.url;
                    }
                    title.title = item.title || item.url;
                    
                    const count = document.createElement('span');
                    count.className = 'item-time';
                    count.textContent = `${item[countKey]}${currentLang === 'zh_CN' ? '次' : 'x'}`;
                    
                    el.appendChild(rankNum);
                    el.appendChild(title);
                    el.appendChild(count);
                    
                    // 点击打开链接
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        browserAPI.tabs.create({ url: item.url });
                    });
                    
                    widgetList.appendChild(el);
                });
                
                // 显示时间范围提示
                const rangeHint = document.createElement('div');
                rangeHint.className = 'time-tracking-widget-hint';
                rangeHint.textContent = isToday ? 
                    (currentLang === 'zh_CN' ? '今日' : 'Today') : 
                    (currentLang === 'zh_CN' ? '本周' : 'This Week');
                widgetList.appendChild(rangeHint);
            } else {
                showEmptyState();
            }
        } catch (error) {
            console.warn('[时间捕捉小组件] 获取点击排行数据失败:', error);
            showEmptyState();
        }
    }
    
    function showEmptyState() {
        widgetList.innerHTML = `<div class="time-tracking-widget-empty"><span>${emptyText}</span></div>`;
    }
}

function formatActiveTime(ms) {
    if (!ms || ms < 1000) return '0s';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

function startTimeTrackingWidgetRefresh() {
    if (timeTrackingWidgetInterval) {
        clearInterval(timeTrackingWidgetInterval);
    }
    updateTimeTrackingWidget();
    timeTrackingWidgetInterval = setInterval(updateTimeTrackingWidget, 1000);  // 1秒刷新，更实时
}

function initTimeTrackingWidget() {
    const widget = document.getElementById('timeTrackingWidget');
    if (!widget) return;
    
    widget.addEventListener('click', () => {
        switchView('additions');
        setTimeout(() => {
            const trackingTab = document.getElementById('additionsTabTracking');
            if (trackingTab) {
                trackingTab.click();
            }
        }, 100);
    });
    
    startTimeTrackingWidgetRefresh();
}

// =============================================================================
// 侧边栏收起功能
// =============================================================================

function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');

    if (!sidebar || !toggleBtn) {
        console.warn('[侧边栏] 找不到侧边栏或切换按钮');
        return;
    }

    // 根据当前实际 DOM 宽度更新侧边栏宽度 CSS 变量
    function syncSidebarWidth() {
        // 直接读取 sidebar 实际渲染宽度，兼容：
        // - 手动折叠/展开（.collapsed）
        // - 响应式 CSS 自动收缩
        const rect = sidebar.getBoundingClientRect();
        const widthPx = rect && rect.width ? `${rect.width}px` : '260px';
        document.documentElement.style.setProperty('--sidebar-width', widthPx);
    }
    
    // 从 localStorage 恢复侧边栏状态
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState === 'true') {
        sidebar.classList.add('collapsed');
        console.log('[侧边栏] 恢复收起状态');
    }
    // 恢复完状态后，同步一次真实宽度
    syncSidebarWidth();

    // 点击切换按钮
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('collapsed');

        // 保存状态到 localStorage
        const isCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebarCollapsed', isCollapsed.toString());

        // 更新 CSS 变量（用于弹窗定位）
        syncSidebarWidth();

        console.log('[侧边栏]', isCollapsed ? '已收起' : '已展开');
    });

    // 窗口尺寸变化时，侧边栏可能被 CSS 自动收缩/展开，这里也同步一次宽度
    window.addEventListener('resize', () => {
        syncSidebarWidth();
    });
}

// =============================================================================
// 视图切换
// =============================================================================

function switchView(view) {
    console.log('[switchView] 切换视图到:', view);

    const previousView = currentView;

    // 处理旧的 'tree' 命名
    if (view === 'tree') {
        view = 'canvas';
    }

    // 当从 Canvas 视图切换到其他视图时，尝试更新一次缩略图
    if (previousView === 'canvas' && view !== 'canvas') {
        try {
            if (typeof requestCanvasThumbnailUpdate === 'function') {
                requestCanvasThumbnailUpdate('switch-view');
            } else {
                captureCanvasThumbnail();
            }
        } catch (e) {
            console.warn('[Canvas Thumbnail] switchView 捕获失败:', e);
        }
    }

    // 更新全局变量
    currentView = view;

    // 更新导航标签
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (tab.dataset.view === view) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // 更新视图容器
    document.querySelectorAll('.view').forEach(v => {
        if (v.id === `${view}View`) {
            v.classList.add('active');
        } else {
            v.classList.remove('active');
        }
    });

    // 保存到 localStorage
    localStorage.setItem('lastActiveView', view);
    console.log('[switchView] 已保存视图到localStorage:', view);

    // 渲染当前视图
    renderCurrentView();
}

// 捕获当前窗口中 Bookmark Canvas 页面的可见区域，并保存为主界面缩略图
// 注意：为了实现「只截画布容器」，这里采用两级方案：
// 1）优先在页面内按 .canvas-main-container 的 rect 进行裁剪；
// 2）若裁剪失败，则退回整页截图（保持兼容性）。
function captureCanvasThumbnail() {
    try {
        // 仅在 Canvas 视图下尝试截屏
        if (currentView !== 'canvas') return;
        if (!browserAPI || !browserAPI.tabs || !browserAPI.tabs.captureVisibleTab) return;

        // 使用 tabs.captureVisibleTab 先拿整页截图，再在内容页内裁剪
        browserAPI.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
            try {
                const captureError = browserAPI.runtime && browserAPI.runtime.lastError;
                if (captureError) {
                    console.warn('[Canvas Thumbnail] 截图失败:', captureError.message || captureError);
                    return;
                }

                if (!dataUrl) return;

                // 在当前页面内按书签画布主容器（不含标题栏）的 rect 进行裁剪
                try {
                    const container = document.querySelector('.canvas-main-container');
                    if (!container) {
                        // 找不到容器，直接保存整页截图作为兜底
                        browserAPI.storage.local.set({ bookmarkCanvasThumbnail: dataUrl }, () => {
                            const err = browserAPI.runtime && browserAPI.runtime.lastError;
                            if (err) {
                                console.warn('[Canvas Thumbnail] 保存缩略图失败:', err.message || err);
                            } else {
                                console.log('[Canvas Thumbnail] 已保存整页缩略图（未找到容器）');
                            }
                        });
                        return;
                    }

                    const rect = container.getBoundingClientRect();
                    const pageWidth = window.innerWidth || document.documentElement.clientWidth;
                    const scale = 1; // 目前默认缩放为1，后续如有需要可读写 storage 中的缩放倍率

                    const img = new Image();
                    img.onload = () => {
                        try {
                            const canvas = document.createElement('canvas');
                            // 按容器宽高裁剪
                            canvas.width = rect.width * scale;
                            canvas.height = rect.height * scale;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) {
                                console.warn('[Canvas Thumbnail] 无法获取 2D 上下文，退回整页截图');
                                browserAPI.storage.local.set({ bookmarkCanvasThumbnail: dataUrl }, () => { });
                                return;
                            }

                            // 计算截图和页面之间的缩放比（captureVisibleTab 生成的图片宽度 / 当前页面宽度）
                            const ratio = img.width / pageWidth;
                            const sx = rect.left * ratio;
                            const sy = rect.top * ratio;
                            const sw = rect.width * ratio;
                            const sh = rect.height * ratio;

                            ctx.drawImage(
                                img,
                                sx, sy, sw, sh,
                                0, 0, canvas.width, canvas.height
                            );

                            const croppedDataUrl = canvas.toDataURL('image/png');
                            browserAPI.storage.local.set({ bookmarkCanvasThumbnail: croppedDataUrl }, () => {
                                const err = browserAPI.runtime && browserAPI.runtime.lastError;
                                if (err) {
                                    console.warn('[Canvas Thumbnail] 保存裁剪缩略图失败:', err.message || err);
                                } else {
                                    console.log('[Canvas Thumbnail] 已保存画布容器裁剪后的缩略图');
                                }
                            });
                        } catch (e) {
                            console.warn('[Canvas Thumbnail] 裁剪缩略图时出错，退回整页截图:', e);
                            browserAPI.storage.local.set({ bookmarkCanvasThumbnail: dataUrl }, () => { });
                        }
                    };
                    img.onerror = () => {
                        console.warn('[Canvas Thumbnail] 缩略图图片加载失败，退回整页截图');
                        browserAPI.storage.local.set({ bookmarkCanvasThumbnail: dataUrl }, () => { });
                    };
                    img.src = dataUrl;
                } catch (cropError) {
                    console.warn('[Canvas Thumbnail] 裁剪逻辑异常，退回整页截图:', cropError);
                    browserAPI.storage.local.set({ bookmarkCanvasThumbnail: dataUrl }, () => { });
                }
            } catch (e) {
                console.warn('[Canvas Thumbnail] 保存缩略图时出错:', e);
            }
        });
    } catch (error) {
        console.warn('[Canvas Thumbnail] 截图失败:', error);
    }
}

// 供 Canvas 模块调用的去抖更新入口
let canvasThumbnailUpdateTimer = null;
function requestCanvasThumbnailUpdate(reason) {
    try {
        if (canvasThumbnailUpdateTimer) {
            clearTimeout(canvasThumbnailUpdateTimer);
        }
        canvasThumbnailUpdateTimer = setTimeout(() => {
            canvasThumbnailUpdateTimer = null;
            try {
                captureCanvasThumbnail();
            } catch (e) {
                console.warn('[Canvas Thumbnail] requestCanvasThumbnailUpdate 调用失败:', e, 'reason:', reason);
            }
        }, 1500); // 1.5 秒内合并多次修改
    } catch (e) {
        // 忽略去抖调度错误
    }
}

// Canvas 滚动视图相关截图节流
let canvasScrollThumbnailBound = false;
let canvasScrollThumbnailTimer = null;

function renderCurrentView() {
    // 如果离开书签记录视图，停止时间捕捉实时刷新定时器
    if (currentView !== 'additions' && trackingRefreshInterval) {
        stopTrackingRefresh();
    }
    
    // 控制缩放控制器的显示/隐藏
    const zoomIndicator = document.getElementById('canvasZoomIndicator');
    if (zoomIndicator) {
        if (currentView === 'canvas') {
            zoomIndicator.style.display = 'block';
        } else {
            zoomIndicator.style.display = 'none';
        }
    }

    switch (currentView) {
        case 'current-changes':
            renderCurrentChangesView();
            break;
        case 'history':
            renderHistoryView();
            break;
        case 'additions':
            renderAdditionsView();
            break;
        case 'canvas':
            // Canvas视图：包含原Bookmark Tree所有功能 + Canvas画布功能
            // 1. 先从template创建永久栏目并添加到canvas-content（如果还不存在）
            const canvasContent = document.getElementById('canvasContent');
            let permanentSectionExists = document.getElementById('permanentSection');

            if (!permanentSectionExists && canvasContent) {
                const template = document.getElementById('permanentSectionTemplate');
                if (template) {
                    const permanentSection = template.content.cloneNode(true);
                    canvasContent.appendChild(permanentSection);
                    console.log('[Canvas] 永久栏目已从template创建到canvas-content');

                    // 立即应用语言设置（使用主UI的applyLanguage函数）
                    setTimeout(() => {
                        applyLanguage();
                        console.log('[Canvas] 永久栏目语言已应用:', currentLang);
                    }, 0);
                } else {
                    console.error('[Canvas] 找不到permanentSectionTemplate');
                }
            } else if (!canvasContent) {
                console.error('[Canvas] 找不到canvasContent');
            } else {
                console.log('[Canvas] 永久栏目已存在，跳过创建');
            }

            // 2. 渲染原有的书签树功能（到永久栏目中的bookmarkTree容器）
            renderTreeView();
            // 3. 初始化Canvas功能（缩放、平移、拖拽等）
            if (window.CanvasModule) {
                window.CanvasModule.init();
            }

            // 4. 首次进入或刷新 Canvas 视图后，延迟截一次图，作为当前会话的基准缩略图
            setTimeout(() => {
                try {
                    if (currentView === 'canvas') {
                        captureCanvasThumbnail();
                    }
                } catch (_) { }
            }, 800);

            // 5. 绑定 Canvas 滚动截图逻辑：只在 Canvas 视图内滚动时触发 B 方案
            const workspace = document.getElementById('canvasWorkspace');
            if (workspace && !canvasScrollThumbnailBound) {
                canvasScrollThumbnailBound = true;
                workspace.addEventListener('wheel', () => {
                    try {
                        if (currentView !== 'canvas') return;
                        if (!requestCanvasThumbnailUpdate) return;
                        if (canvasScrollThumbnailTimer) {
                            clearTimeout(canvasScrollThumbnailTimer);
                        }
                        // 滚动结束约 800ms 后，按 B 方案调度截图
                        canvasScrollThumbnailTimer = setTimeout(() => {
                            canvasScrollThumbnailTimer = null;
                            requestCanvasThumbnailUpdate('scroll');
                        }, 800);
                    } catch (_) { }
                }, { passive: true });
            }
            break;
        case 'recommend':
            renderRecommendView();
            break;
    }
}

// =============================================================================
// 书签推荐视图
// =============================================================================

let recommendViewInitialized = false;

function renderRecommendView() {
    console.log('[书签推荐] 渲染推荐视图');
    
    // 只初始化一次事件监听器
    if (!recommendViewInitialized) {
        // 初始化可折叠区域
        initCollapsibleSections();
        
        // 初始化公式输入框事件
        initFormulaInputs();
        
        // 初始化卡片交互
        initCardInteractions();
        
        // 初始化追踪开关
        initTrackingToggle();
        
        // 初始化稍后复习弹窗
        initLaterModal();
        
        // 初始化添加域名和文件夹弹窗
        initAddDomainModal();
        initSelectFolderModal();
        initBlockManageButtons();
        
        // 初始化添加到稍后复习弹窗
        initAddToPostponedModal();
        
        recommendViewInitialized = true;
    }
    
    // 每次进入视图时加载数据（loadRecommendData内部已包含loadHeatmapData等）
    // 注意：checkAutoRefresh 在 loadRecommendData 内部调用，避免重复刷新
    loadRecommendData();
}

function initCollapsibleSections() {
    document.querySelectorAll('.collapsible .section-header').forEach(header => {
        header.addEventListener('click', (e) => {
            // 避免点击追踪开关时触发折叠
            if (e.target.closest('.tracking-toggle')) return;
            // 避免点击输入框时触发折叠
            if (e.target.closest('input')) return;
            const section = header.closest('.collapsible');
            section.classList.toggle('collapsed');
        });
    });
    
    // 初始化拖拽排序
    initSectionDragSort();
    
    // 恢复保存的顺序
    restoreSectionOrder();
}

// 初始化折叠区域拖拽排序
function initSectionDragSort() {
    const container = document.getElementById('recommendSectionsContainer');
    if (!container) return;
    
    let draggedElement = null;
    let isDragging = false;
    let startY = 0;
    
    container.querySelectorAll('.draggable-section').forEach(section => {
        const header = section.querySelector('.section-header');
        if (!header) return;
        
        header.addEventListener('mousedown', (e) => {
            // 点击按钮或输入框时不触发拖拽
            if (e.target.closest('button') || e.target.closest('input')) return;
            
            startY = e.clientY;
            draggedElement = section;
            
            const onMouseMove = (e) => {
                if (!draggedElement) return;
                
                // 移动超过5px才开始拖拽
                if (!isDragging && Math.abs(e.clientY - startY) > 5) {
                    isDragging = true;
                    section.classList.add('dragging');
                }
                
                if (!isDragging) return;
                
                const sections = [...container.querySelectorAll('.draggable-section')];
                const afterElement = getDragAfterElement(container, e.clientY);
                
                sections.forEach(s => s.classList.remove('drag-over'));
                
                if (afterElement) {
                    afterElement.classList.add('drag-over');
                }
            };
            
            const onMouseUp = () => {
                if (isDragging && draggedElement) {
                    const sections = [...container.querySelectorAll('.draggable-section')];
                    const afterElement = sections.find(s => s.classList.contains('drag-over'));
                    
                    sections.forEach(s => s.classList.remove('drag-over'));
                    draggedElement.classList.remove('dragging');
                    
                    if (afterElement && afterElement !== draggedElement) {
                        container.insertBefore(draggedElement, afterElement);
                        saveSectionOrder();
                    }
                }
                
                draggedElement = null;
                isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function getDragAfterElement(container, y) {
    const sections = [...container.querySelectorAll('.draggable-section:not(.dragging)')];
    
    return sections.reduce((closest, section) => {
        const box = section.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: section };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function saveSectionOrder() {
    const container = document.getElementById('recommendSectionsContainer');
    if (!container) return;
    
    const order = [...container.querySelectorAll('.draggable-section')]
        .map(s => s.dataset.sectionId);
    
    browserAPI.storage.local.set({ recommendSectionOrder: order });
    console.log('[书签推荐] 保存栏目顺序:', order);
}

function restoreSectionOrder() {
    browserAPI.storage.local.get(['recommendSectionOrder'], (result) => {
        if (!result.recommendSectionOrder) return;
        
        const container = document.getElementById('recommendSectionsContainer');
        if (!container) return;
        
        const order = result.recommendSectionOrder;
        const sections = [...container.querySelectorAll('.draggable-section')];
        
        order.forEach(id => {
            const section = sections.find(s => s.dataset.sectionId === id);
            if (section) {
                container.appendChild(section);
            }
        });
        
        console.log('[书签推荐] 恢复栏目顺序:', order);
    });
}

// 根据待复习数量决定是否折叠
function updatePostponedCollapse(count) {
    const section = document.querySelector('.recommend-postponed-section');
    if (!section) return;
    
    if (count === 0) {
        section.classList.add('collapsed');
    }
}

function initFormulaInputs() {
    // 权重输入框
    const weightInputs = document.querySelectorAll('.formula-weight');
    weightInputs.forEach(input => {
        input.addEventListener('click', () => {
            input.removeAttribute('readonly');
            input.select();
        });
        input.addEventListener('blur', () => {
            input.setAttribute('readonly', 'readonly');
            normalizeWeights();
        });
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
    });
    
    // 阈值输入框
    const thresholdInputs = document.querySelectorAll('.threshold-value');
    thresholdInputs.forEach(input => {
        input.addEventListener('blur', () => {
            saveFormulaConfig();
        });
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            }
        });
    });
    
    // 恢复默认按钮
    const resetBtn = document.getElementById('resetFormulaBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFormulaToDefault);
    }
    
    // 加载保存的配置
    loadFormulaConfig();
}

function normalizeWeights() {
    const w1 = parseFloat(document.getElementById('weightFreshness').value) || 0;
    const w2 = parseFloat(document.getElementById('weightColdness').value) || 0;
    const w3 = parseFloat(document.getElementById('weightTimeDegree').value) || 0;
    const w4 = parseFloat(document.getElementById('weightForgetting').value) || 0;
    const w5 = parseFloat(document.getElementById('weightLaterReview').value) || 0;
    
    const total = w1 + w2 + w3 + w4 + w5;
    if (total > 0 && Math.abs(total - 1) > 0.01) {
        document.getElementById('weightFreshness').value = (w1 / total).toFixed(2);
        document.getElementById('weightColdness').value = (w2 / total).toFixed(2);
        document.getElementById('weightTimeDegree').value = (w3 / total).toFixed(2);
        document.getElementById('weightForgetting').value = (w4 / total).toFixed(2);
        document.getElementById('weightLaterReview').value = (w5 / total).toFixed(2);
    }
    saveFormulaConfig();
}

function resetFormulaToDefault() {
    document.getElementById('weightFreshness').value = '0.15';
    document.getElementById('weightColdness').value = '0.20';
    document.getElementById('weightTimeDegree').value = '0.25';
    document.getElementById('weightForgetting').value = '0.20';
    document.getElementById('weightLaterReview').value = '0.20';
    
    document.getElementById('thresholdFreshness').value = '30';
    document.getElementById('thresholdColdness').value = '10';
    document.getElementById('thresholdTimeDegree').value = '5';
    document.getElementById('thresholdForgetting').value = '14';
    
    saveFormulaConfig();
}

function saveFormulaConfig() {
    const config = {
        weights: {
            freshness: parseFloat(document.getElementById('weightFreshness').value) || 0.15,
            coldness: parseFloat(document.getElementById('weightColdness').value) || 0.20,
            shallowRead: parseFloat(document.getElementById('weightTimeDegree').value) || 0.25,
            forgetting: parseFloat(document.getElementById('weightForgetting').value) || 0.20,
            laterReview: parseFloat(document.getElementById('weightLaterReview').value) || 0.20
        },
        thresholds: {
            freshness: parseInt(document.getElementById('thresholdFreshness').value) || 30,
            coldness: parseInt(document.getElementById('thresholdColdness').value) || 10,
            shallowRead: parseInt(document.getElementById('thresholdTimeDegree').value) || 5,
            forgetting: parseInt(document.getElementById('thresholdForgetting').value) || 14
        }
    };
    browserAPI.storage.local.set({ recommendFormulaConfig: config });
    console.log('[书签推荐] 保存公式配置:', config);
}

function loadFormulaConfig() {
    browserAPI.storage.local.get(['recommendFormulaConfig'], (result) => {
        if (result.recommendFormulaConfig) {
            const config = result.recommendFormulaConfig;
            document.getElementById('weightFreshness').value = config.weights.freshness;
            document.getElementById('weightColdness').value = config.weights.coldness;
            document.getElementById('weightTimeDegree').value = config.weights.shallowRead;
            document.getElementById('weightForgetting').value = config.weights.forgetting;
            document.getElementById('weightLaterReview').value = config.weights.laterReview ?? 0.20;
            
            document.getElementById('thresholdFreshness').value = config.thresholds.freshness;
            document.getElementById('thresholdColdness').value = config.thresholds.coldness;
            document.getElementById('thresholdTimeDegree').value = config.thresholds.shallowRead;
            document.getElementById('thresholdForgetting').value = config.thresholds.forgetting;
            console.log('[书签推荐] 加载公式配置:', config);
        }
    });
}

// 当前推荐模式
let currentRecommendMode = 'default'; // 默认模式

// 预设模式配置（时间度权重增大，使用综合时间）
const presetModes = {
    // 默认模式：均衡推荐
    default: {
        weights: {
            freshness: 0.15,      // 新鲜度
            coldness: 0.15,       // 冷门度
            timeDegree: 0.30,     // 时间度（综合时间短=需要深入阅读）
            forgetting: 0.20,     // 遗忘因子
            laterReview: 0.20     // 待复习权重
        },
        thresholds: {
            freshness: 30,        // 30天内算新
            coldness: 10,         // 10次以下算冷门
            timeDegree: 5,        // 5分钟以下算浅读
            forgetting: 14        // 14天未访问算遗忘
        }
    },
    // 考古模式：挖掘尘封已久的书签
    archaeology: {
        weights: {
            freshness: 0.05,      // 新鲜度权重低
            coldness: 0.25,       // 冷门度高权重
            timeDegree: 0.20,     // 时间度
            forgetting: 0.35,     // 遗忘因子最高
            laterReview: 0.15     // 待复习权重
        },
        thresholds: {
            freshness: 90,        // 90天内算新
            coldness: 3,          // 3次以下算冷门
            timeDegree: 3,        // 3分钟以下算浅读
            forgetting: 30        // 30天未访问算遗忘
        }
    },
    // 巩固模式：经常访问但还没深入阅读的书签
    consolidate: {
        weights: {
            freshness: 0.15,      // 新鲜度
            coldness: 0.05,       // 冷门度低（推荐常用的）
            timeDegree: 0.40,     // 时间度高（推荐还没深入阅读的）
            forgetting: 0.20,     // 遗忘度稍高
            laterReview: 0.20     // 待复习权重
        },
        thresholds: {
            freshness: 14,        // 14天内算新
            coldness: 30,         // 30次以下算冷门（提高阈值，让常用书签也能被选中）
            timeDegree: 10,       // 10分钟以下算浅读
            forgetting: 7         // 7天未访问算遗忘
        }
    },
    // 漫游模式：随机探索
    wander: {
        weights: {
            freshness: 0.20,
            coldness: 0.15,
            timeDegree: 0.25,
            forgetting: 0.20,
            laterReview: 0.20
        },
        thresholds: {
            freshness: 21,
            coldness: 10,
            timeDegree: 5,
            forgetting: 14
        }
    },
    // 优先巩固模式：手动添加待复习时自动激活
    priority: {
        weights: {
            freshness: 0.05,
            coldness: 0.05,
            timeDegree: 0.10,
            forgetting: 0.10,
            laterReview: 0.70
        },
        thresholds: {
            freshness: 30,
            coldness: 10,
            timeDegree: 5,
            forgetting: 14
        }
    }
};

// =============================================================================
// 推荐卡片专用：弹窗管理
// =============================================================================

// 预加载 favicon（使用现有的 FaviconCache 系统）
function preloadHighResFavicons(urls) {
    urls.forEach(url => {
        if (url) FaviconCache.fetch(url);
    });
}

// 设置 favicon（使用现有的 FaviconCache 系统）
function setHighResFavicon(imgElement, url) {
    if (!url) {
        imgElement.src = fallbackIcon;
        return;
    }
    
    // 使用现有的 getFaviconUrl（会触发异步加载）
    imgElement.src = getFaviconUrl(url);
    
    // 异步获取更高质量版本
    getFaviconUrlAsync(url).then(dataUrl => {
        if (dataUrl && dataUrl !== fallbackIcon) {
            imgElement.src = dataUrl;
        }
    });
}

// 推荐卡片专用窗口 - 使用storage共享窗口ID（与popup同步）
async function getSharedRecommendWindowId() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['recommendWindowId'], (result) => {
            resolve(result.recommendWindowId || null);
        });
    });
}

async function saveSharedRecommendWindowId(windowId) {
    await browserAPI.storage.local.set({ recommendWindowId: windowId });
}

// 监听storage变化，实现history和popup页面的实时同步
let historyLastCardRefreshTime = 0;
browserAPI.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.popupCurrentCards) {
        // 仅在推荐视图时刷新
        if (currentView !== 'recommend') return;
        
        // 防止短时间内重复刷新
        const now = Date.now();
        if (now - historyLastCardRefreshTime < 300) return;
        historyLastCardRefreshTime = now;
        
        // 检查是否全部勾选，如果是则强制刷新获取新卡片
        const newValue = changes.popupCurrentCards.newValue;
        if (newValue && newValue.cardIds && newValue.flippedIds) {
            const allFlipped = newValue.cardIds.every(id => newValue.flippedIds.includes(id));
            if (allFlipped && newValue.cardIds.length > 0) {
                // 全部勾选，延迟强制刷新
                setTimeout(() => {
                    refreshRecommendCards(true);
                }, 100);
            } else {
                // 部分勾选，普通刷新显示当前状态
                refreshRecommendCards();
            }
        } else {
            refreshRecommendCards();
        }
    }
});

// 在推荐窗口中打开链接
async function openInRecommendWindow(url) {
    if (!url) return;
    
    try {
        // 从storage获取共享的窗口ID
        let windowId = await getSharedRecommendWindowId();
        
        // 检查窗口是否存在
        if (windowId) {
            try {
                await browserAPI.windows.get(windowId);
                // 窗口存在，在其中打开新标签页
                await browserAPI.tabs.create({
                    windowId: windowId,
                    url: url,
                    active: true
                });
                await browserAPI.windows.update(windowId, { focused: true });
                return;
            } catch (e) {
                // 窗口已关闭，清除保存的ID
                await saveSharedRecommendWindowId(null);
            }
        }
        
        // 创建新窗口
        const width = Math.min(1200, Math.round(screen.availWidth * 0.75));
        const height = Math.min(800, Math.round(screen.availHeight * 0.8));
        const left = Math.round((screen.availWidth - width) / 2);
        const top = Math.round((screen.availHeight - height) / 2);
        
        const win = await browserAPI.windows.create({
            url: url,
            type: 'normal',
            width, height, left, top,
            focused: true
        });
        // 保存窗口ID到storage，供popup和history共享
        await saveSharedRecommendWindowId(win.id);
        
    } catch (error) {
        console.error('[推荐卡片] 打开窗口失败:', error);
        browserAPI.tabs.create({ url });
    }
}

function initCardInteractions() {
    // 刷新按钮
    document.getElementById('cardRefreshBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        refreshRecommendCards(true);  // force=true 更新刷新时间
    });
    
    // 刷新设置按钮
    document.getElementById('refreshSettingsBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showRefreshSettingsModal();
    });
    
    // 初始化刷新设置弹窗
    initRefreshSettingsModal();
    
    // 预设模式按钮
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = btn.dataset.mode;
            applyPresetMode(mode);
        });
    });
}

// 应用预设模式
function applyPresetMode(mode) {
    if (!presetModes[mode]) return;
    
    currentRecommendMode = mode;
    const preset = presetModes[mode];
    
    // 更新按钮状态
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    // 更新权重输入框
    const weightInputs = {
        freshness: document.getElementById('weightFreshness'),
        coldness: document.getElementById('weightColdness'),
        timeDegree: document.getElementById('weightTimeDegree'),
        forgetting: document.getElementById('weightForgetting'),
        laterReview: document.getElementById('weightLaterReview')
    };
    
    // 设置权重值
    weightInputs.freshness.value = preset.weights.freshness;
    weightInputs.coldness.value = preset.weights.coldness;
    weightInputs.timeDegree.value = preset.weights.timeDegree;
    weightInputs.forgetting.value = preset.weights.forgetting;
    weightInputs.laterReview.value = preset.weights.laterReview;
    
    // 处理优先模式和用户覆盖
    const priorityModeBtn = document.getElementById('priorityModeBtn');
    
    if (mode === 'priority') {
        // 优先模式：橙色显示
        for (const input of Object.values(weightInputs)) {
            input.style.color = '#ff6b35';
            input.style.fontWeight = 'bold';
        }
        // 清除用户覆盖标记
        if (priorityModeBtn) {
            delete priorityModeBtn.dataset.userOverride;
        }
    } else {
        // 其他模式：正常显示
        for (const input of Object.values(weightInputs)) {
            input.style.color = '';
            input.style.fontWeight = '';
        }
        // 设置用户覆盖标记（防止自动切换回优先模式）
        if (priorityModeBtn && priorityModeBtn.style.display !== 'none') {
            priorityModeBtn.dataset.userOverride = 'true';
        }
    }
    
    // 更新阈值输入框
    document.getElementById('thresholdFreshness').value = preset.thresholds.freshness;
    document.getElementById('thresholdColdness').value = preset.thresholds.coldness;
    document.getElementById('thresholdTimeDegree').value = preset.thresholds.timeDegree;
    document.getElementById('thresholdForgetting').value = preset.thresholds.forgetting;
    
    // 保存配置
    saveFormulaConfig();
    
    // 刷新推荐卡片
    refreshRecommendCards();
    
    const modeNames = { default: '默认', archaeology: '考古', consolidate: '巩固', wander: '漫游', priority: '优先巩固' };
    console.log(`[书签推荐] 切换到${modeNames[mode] || mode}模式`);
}

function initTrackingToggle() {
    const toggleBtn = document.getElementById('trackingToggleBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            toggleBtn.classList.toggle('active');
            const isActive = toggleBtn.classList.contains('active');
            document.getElementById('trackingToggleText').textContent = isActive ? 
                i18n.trackingToggleOn[currentLang] : 
                i18n.trackingToggleOff[currentLang];
            
            // 更新公式中的T项（时间度）
            const termT = document.getElementById('termTimeDegree');
            if (termT) {
                if (isActive) {
                    termT.classList.remove('disabled');
                } else {
                    termT.classList.add('disabled');
                }
            }
            
            // 通知 background.js 更新追踪状态
            try {
                await browserAPI.runtime.sendMessage({ 
                    action: 'setTrackingEnabled', 
                    enabled: isActive 
                });
                // 立即刷新左下角小组件
                updateTimeTrackingWidget();
            } catch (error) {
                console.warn('[书签推荐] 设置追踪状态失败:', error);
            }
        });
        
        // 加载保存的状态
        browserAPI.runtime.sendMessage({ action: 'isTrackingEnabled' }, (response) => {
            if (response && response.success) {
                const isActive = response.enabled;
                if (isActive) {
                    toggleBtn.classList.add('active');
                    document.getElementById('trackingToggleText').textContent = 
                        i18n.trackingToggleOn[currentLang];
                } else {
                    toggleBtn.classList.remove('active');
                    document.getElementById('trackingToggleText').textContent = 
                        i18n.trackingToggleOff[currentLang];
                    document.getElementById('termTimeDegree')?.classList.add('disabled');
                }
            }
        });
    }
    
    // 时间范围选择器
    const rangeSelect = document.getElementById('trackingRankingRange');
    if (rangeSelect) {
        rangeSelect.addEventListener('change', () => {
            loadActiveTimeRanking();
        });
    }
    
    // 清除记录按钮
    const clearBtn = document.getElementById('clearTrackingBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            if (!confirm(i18n.trackingClearConfirm[currentLang])) return;
            
            try {
                const response = await browserAPI.runtime.sendMessage({ 
                    action: 'clearAllTrackingSessions' 
                });
                
                if (response && response.success) {
                    // 刷新显示
                    await loadCurrentTrackingSessions();
                    await loadActiveTimeRanking();
                    console.log('[时间捕捉]', i18n.trackingCleared[currentLang]);
                }
            } catch (error) {
                console.error('[时间捕捉] 清除记录失败:', error);
            }
        });
    }
    
    // 状态说明弹窗（使用事件委托，支持动态创建的图标）
    const stateModal = document.getElementById('trackingStateModal');
    const closeStateModalBtn = document.getElementById('closeTrackingStateModal');
    const trackingHeaderState = document.getElementById('trackingHeaderState');
    
    if (trackingHeaderState && stateModal) {
        trackingHeaderState.addEventListener('click', (e) => {
            if (e.target.classList.contains('tracking-state-help')) {
                e.stopPropagation();
                stateModal.classList.add('show');
                updateTrackingStateModalI18n();
            }
        });
        
        if (closeStateModalBtn) {
            closeStateModalBtn.addEventListener('click', () => {
                stateModal.classList.remove('show');
            });
        }
        
        // 点击背景关闭
        stateModal.addEventListener('click', (e) => {
            if (e.target === stateModal) {
                stateModal.classList.remove('show');
            }
        });
    }
    
    // 公式说明弹窗
    const formulaHelpBtn = document.getElementById('formulaHelpBtn');
    const formulaHelpModal = document.getElementById('formulaHelpModal');
    const closeFormulaHelpBtn = document.getElementById('closeFormulaHelpModal');
    
    if (formulaHelpBtn && formulaHelpModal) {
        formulaHelpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            formulaHelpModal.classList.add('show');
            updateFormulaHelpModalI18n();
        });
        
        if (closeFormulaHelpBtn) {
            closeFormulaHelpBtn.addEventListener('click', () => {
                formulaHelpModal.classList.remove('show');
            });
        }
        
        formulaHelpModal.addEventListener('click', (e) => {
            if (e.target === formulaHelpModal) {
                formulaHelpModal.classList.remove('show');
            }
        });
    }
}

// 更新状态说明弹窗的国际化文本
function updateTrackingStateModalI18n() {
    const isEn = currentLang === 'en';
    
    // 标题
    const title = document.getElementById('trackingStateModalTitle');
    if (title) title.textContent = isEn ? 'Time Tracking State Guide' : '时间捕捉状态说明';
    
    // 表头（图标在第一列）
    document.getElementById('stateTableHeaderIcon').textContent = isEn ? 'Icon' : '图标';
    document.getElementById('stateTableHeaderState').textContent = isEn ? 'State' : '状态';
    document.getElementById('stateTableHeaderCondition').textContent = isEn ? 'Condition' : '条件';
    document.getElementById('stateTableHeaderRate').textContent = isEn ? 'Rate' : '计时倍率';
    document.getElementById('stateTableHeaderExample').textContent = isEn ? 'Example' : '例子';
    
    // 表格内容
    document.getElementById('stateActiveLabel').textContent = isEn ? 'Active' : '活跃';
    document.getElementById('stateActiveCondition').textContent = isEn ? 'Current tab + Window focus + User active' : '当前标签 + 窗口焦点 + 用户活跃';
    document.getElementById('stateActiveExample').textContent = isEn ? 'Reading, scrolling, typing' : '正在阅读、滚动页面、打字';
    
    document.getElementById('stateIdleLabel').textContent = isEn ? 'Idle Focus' : '前台静止';
    document.getElementById('stateIdleCondition').textContent = isEn ? 'Current tab + Window focus + User idle' : '当前标签 + 窗口焦点 + 用户空闲';
    document.getElementById('stateIdleExample').textContent = isEn ? 'Watching video, thinking' : '静止观看视频、思考内容';
    
    document.getElementById('stateVisibleLabel').textContent = isEn ? 'Visible Ref' : '可见参考';
    document.getElementById('stateVisibleCondition').textContent = isEn ? 'Current tab + No window focus + User active' : '当前标签 + 窗口无焦点 + 用户活跃';
    document.getElementById('stateVisibleExample').textContent = isEn ? 'Split-screen reference, comparing code' : '分屏参考文档、对照代码';
    
    document.getElementById('stateBackgroundLabel').textContent = isEn ? 'Background' : '后台';
    document.getElementById('stateBackgroundCondition').textContent = isEn ? 'Not current tab + User active' : '非当前标签 + 用户活跃';
    document.getElementById('stateBackgroundExample').textContent = isEn ? 'Idle tab, background music' : '挂机、后台播放音乐';
    
    document.getElementById('stateSleepLabel').textContent = isEn ? 'Sleep' : '睡眠';
    document.getElementById('stateSleepCondition').textContent = isEn ? 'User idle (any tab)' : '用户空闲（任何标签）';
    document.getElementById('stateSleepExample').textContent = isEn ? 'Away from computer, screen locked' : '离开电脑、锁屏';
}

// 更新公式说明弹窗的国际化文本
function updateFormulaHelpModalI18n() {
    const isEn = currentLang === 'en';
    
    // 标题
    const title = document.getElementById('formulaHelpModalTitle');
    if (title) title.textContent = isEn ? 'Formula Explanation' : '权重公式说明';
    
    // 通用公式
    const generalTitle = document.getElementById('formulaHelpGeneralTitle');
    if (generalTitle) generalTitle.textContent = isEn ? 'General Formula' : '通用公式';
    
    const codeEl = document.querySelector('.formula-help-code code');
    if (codeEl) codeEl.textContent = isEn 
        ? 'Factor = 1 / (1 + (value / threshold)^0.7)' 
        : '因子值 = 1 / (1 + (实际值 / 阈值)^0.7)';
    
    // 公式特点
    const featuresTitle = document.getElementById('formulaHelpFeaturesTitle');
    if (featuresTitle) featuresTitle.textContent = isEn ? 'Features' : '公式特点';
    
    document.getElementById('formulaHelpFeature1').innerHTML = isEn 
        ? '<strong>At threshold = 0.5</strong>: When value equals threshold, factor is exactly 0.5'
        : '<strong>阈值处 = 0.5</strong>：当实际值等于阈值时，因子值正好是0.5';
    document.getElementById('formulaHelpFeature2').innerHTML = isEn
        ? '<strong>Smooth decay</strong>: Power function (^0.7) makes decay more gradual, avoiding hard cutoff'
        : '<strong>平滑衰减</strong>：使用幂函数(^0.7)使衰减更平缓，避免硬截断';
    document.getElementById('formulaHelpFeature3').innerHTML = isEn
        ? '<strong>Never zero</strong>: Even very large values retain small differentiation'
        : '<strong>永不归零</strong>：即使数值很大，仍保留微小区分度';
    document.getElementById('formulaHelpFeature4').innerHTML = isEn
        ? '<strong>Large value friendly</strong>: 1000 clicks still has 0.02 differentiation'
        : '<strong>大数值友好</strong>：1000次点击仍有0.02的区分度';
    
    // 效果示例
    const exampleTitle = document.getElementById('formulaHelpExampleTitle');
    if (exampleTitle) exampleTitle.textContent = isEn ? 'Examples' : '效果示例';
    
    document.getElementById('formulaHelpTableValue').textContent = isEn ? 'Value/Threshold' : '实际值/阈值';
    document.getElementById('formulaHelpTableResult').textContent = isEn ? 'Factor' : '因子值';
    document.getElementById('formulaHelpTableMeaning').textContent = isEn ? 'Meaning' : '含义';
    
    document.getElementById('formulaHelpThreshold').textContent = isEn ? '1×(threshold)' : '1×(阈值)';
    document.getElementById('formulaHelpMeaning1').textContent = isEn ? 'Highest priority' : '最高优先';
    document.getElementById('formulaHelpMeaning2').textContent = isEn ? 'Higher' : '较高';
    document.getElementById('formulaHelpMeaning3').textContent = isEn ? 'Medium' : '中等';
    document.getElementById('formulaHelpMeaning4').textContent = isEn ? 'Lower' : '较低';
    document.getElementById('formulaHelpMeaning5').textContent = isEn ? 'Very low' : '很低';
    document.getElementById('formulaHelpMeaning6').textContent = isEn ? 'Minimal but distinct' : '极低但仍有区分';
    
    // 注意事项
    const notesTitle = document.getElementById('formulaHelpNotesTitle');
    if (notesTitle) notesTitle.textContent = isEn ? 'Notes' : '注意事项';
    
    document.getElementById('formulaHelpNote1').innerHTML = isEn
        ? '<strong>F, C, T</strong> use inverse mode: larger value = smaller factor (e.g., more clicks = lower coldness)'
        : '<strong>F、C、T</strong> 使用 inverse 模式：值越大，因子越小（如点击越多，冷门度越低）';
    document.getElementById('formulaHelpNote2').innerHTML = isEn
        ? '<strong>D</strong> uses direct mode: more unvisited days = higher forgetting'
        : '<strong>D</strong> 使用正向模式：未访问天数越多，遗忘度越高';
    document.getElementById('formulaHelpNote3').innerHTML = isEn
        ? '<strong>L</strong> is boolean: manually added = 1, otherwise = 0'
        : '<strong>L</strong> 是布尔值：手动添加=1，否则=0';
}

// 推荐卡片数据
let recommendCards = [];
let trackingRefreshInterval = null;
const TRACKING_REFRESH_INTERVAL = 1000; // 1秒刷新一次，更实时

// 跳过和屏蔽数据
let skippedBookmarks = new Set(); // 本次会话跳过的书签（内存，刷新页面后清空）

// 获取当前显示的卡片状态（与popup共享）
async function getHistoryCurrentCards() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['popupCurrentCards'], (result) => {
            resolve(result.popupCurrentCards || null);
        });
    });
}

// 保存当前显示的卡片状态（与popup共享）
async function saveHistoryCurrentCards(cardIds, flippedIds, cardData = null) {
    const dataToSave = {
        popupCurrentCards: {
            cardIds: cardIds,
            flippedIds: flippedIds,
            timestamp: Date.now()
        }
    };
    // 如果提供了卡片数据（包含url和favicon），也保存它们
    if (cardData && cardData.length > 0) {
        dataToSave.popupCurrentCards.cardData = cardData;
    }
    await browserAPI.storage.local.set(dataToSave);
}

// 异步获取并保存当前卡片的favicon URLs（供popup使用）
async function saveCardFaviconsToStorage(bookmarks) {
    if (!bookmarks || bookmarks.length === 0) return;
    
    try {
        // 获取当前保存的卡片状态
        const currentCards = await getHistoryCurrentCards();
        if (!currentCards || !currentCards.cardIds) return;
        
        // 为每个卡片获取favicon data URL
        const cardData = await Promise.all(bookmarks.map(async (bookmark) => {
            if (!bookmark || !bookmark.url) {
                return { id: bookmark?.id, url: null, faviconUrl: null };
            }
            try {
                const faviconUrl = await FaviconCache.fetch(bookmark.url);
                return {
                    id: bookmark.id,
                    url: bookmark.url,
                    faviconUrl: faviconUrl !== fallbackIcon ? faviconUrl : null
                };
            } catch (e) {
                return { id: bookmark.id, url: bookmark.url, faviconUrl: null };
            }
        }));
        
        // 更新storage中的卡片数据
        currentCards.cardData = cardData;
        await browserAPI.storage.local.set({ popupCurrentCards: currentCards });
    } catch (error) {
        // 静默处理错误
    }
}

// 标记卡片为已勾选，并检查是否全部勾选
async function markHistoryCardFlipped(bookmarkId) {
    const currentCards = await getHistoryCurrentCards();
    if (!currentCards) return false;
    
    // 添加到已勾选列表
    if (!currentCards.flippedIds.includes(bookmarkId)) {
        currentCards.flippedIds.push(bookmarkId);
        await saveHistoryCurrentCards(currentCards.cardIds, currentCards.flippedIds);
    }
    
    // 检查是否全部勾选
    const allFlipped = currentCards.cardIds.every(id => currentCards.flippedIds.includes(id));
    return allFlipped;
}

// 更新单个卡片显示
function updateCardDisplay(card, bookmark, isFlipped = false) {
    card.classList.remove('empty');
    if (isFlipped) {
        card.classList.add('flipped');
    } else {
        card.classList.remove('flipped');
    }
    card.querySelector('.card-title').textContent = bookmark.title || bookmark.url;
    card.querySelector('.card-priority').textContent = `P = ${bookmark.priority.toFixed(2)}`;
    card.dataset.url = bookmark.url;
    card.dataset.bookmarkId = bookmark.id;
    
    // 设置 favicon
    const favicon = card.querySelector('.card-favicon');
    if (favicon && bookmark.url) {
        setHighResFavicon(favicon, bookmark.url);
    }
    
    // 点击卡片主体：打开链接 + 标记为已翻过 + 记录复习
    card.onclick = async (e) => {
        if (e.target.closest('.card-actions')) return;
        
        if (bookmark.url) {
            await markBookmarkFlipped(bookmark.id);
            await recordReview(bookmark.id);
            await openInRecommendWindow(bookmark.url);
            card.classList.add('flipped');
            
            // 更新本地卡片勾选状态（storage监听器会自动处理刷新）
            await markHistoryCardFlipped(bookmark.id);
        }
    };
    
    // 按钮事件：稍后复习
    const btnLater = card.querySelector('.card-btn-later');
    if (btnLater) {
        btnLater.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            showLaterModal(bookmark);
        };
    }
    
    // 按钮事件：跳过本次
    const btnSkip = card.querySelector('.card-btn-skip');
    if (btnSkip) {
        btnSkip.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();
            skippedBookmarks.add(bookmark.id);
            await refreshRecommendCards(true);
        };
    }
    
    // 按钮事件：永久屏蔽
    const btnBlock = card.querySelector('.card-btn-block');
    if (btnBlock) {
        btnBlock.onclick = async (e) => {
            e.stopPropagation();
            e.preventDefault();
            await blockBookmark(bookmark.id);
            await loadBlockedLists();
            await refreshRecommendCards(true);
        };
    }
}

// 设置卡片为空状态
function setCardEmpty(card) {
    card.classList.add('empty');
    card.querySelector('.card-title').textContent = '--';
    card.querySelector('.card-priority').textContent = 'P = --';
    const favicon = card.querySelector('.card-favicon');
    if (favicon) {
        favicon.src = fallbackIcon;
    }
    card.onclick = null;
    
    const actions = card.querySelector('.card-actions');
    if (actions) {
        actions.querySelectorAll('.card-btn').forEach(btn => {
            btn.onclick = null;
        });
    }
}

// 获取已屏蔽书签
async function getBlockedBookmarks() {
    try {
        const result = await browserAPI.storage.local.get('recommend_blocked');
        return result.recommend_blocked || { bookmarks: [], folders: [], domains: [] };
    } catch (e) {
        console.error('[屏蔽] 获取屏蔽数据失败:', e);
        return { bookmarks: [], folders: [], domains: [] };
    }
}

// 屏蔽书签（按标题匹配，同名书签一起屏蔽）
async function blockBookmark(bookmarkId) {
    try {
        // 获取当前书签信息
        const bookmarks = await new Promise(resolve => {
            browserAPI.bookmarks.get(bookmarkId, resolve);
        });
        if (!bookmarks || bookmarks.length === 0) return false;
        const targetBookmark = bookmarks[0];
        const targetTitle = targetBookmark.title;
        
        // 获取所有书签
        const allBookmarks = await new Promise(resolve => {
            browserAPI.bookmarks.getTree(tree => {
                const result = [];
                function traverse(nodes) {
                    for (const node of nodes) {
                        if (node.url) result.push(node);
                        if (node.children) traverse(node.children);
                    }
                }
                traverse(tree);
                resolve(result);
            });
        });
        
        // 找到所有同标题的书签
        const sameTitle = allBookmarks.filter(b => b.title === targetTitle);
        
        const blocked = await getBlockedBookmarks();
        let blockedCount = 0;
        
        for (const b of sameTitle) {
            if (!blocked.bookmarks.includes(b.id)) {
                blocked.bookmarks.push(b.id);
                blockedCount++;
            }
        }
        
        await browserAPI.storage.local.set({ recommend_blocked: blocked });
        console.log('[屏蔽] 已屏蔽书签:', targetTitle, '共', blockedCount, '个');
        return true;
    } catch (e) {
        console.error('[屏蔽] 屏蔽书签失败:', e);
        return false;
    }
}

// 恢复屏蔽的书签
async function unblockBookmark(bookmarkId) {
    try {
        const blocked = await getBlockedBookmarks();
        blocked.bookmarks = blocked.bookmarks.filter(id => id !== bookmarkId);
        await browserAPI.storage.local.set({ recommend_blocked: blocked });
        console.log('[屏蔽] 已恢复书签:', bookmarkId);
        return true;
    } catch (e) {
        console.error('[屏蔽] 恢复书签失败:', e);
        return false;
    }
}

// 获取稍后复习数据
async function getPostponedBookmarks() {
    try {
        const result = await browserAPI.storage.local.get('recommend_postponed');
        return result.recommend_postponed || [];
    } catch (e) {
        console.error('[稍后] 获取稍后复习数据失败:', e);
        return [];
    }
}

// 添加稍后复习
async function postponeBookmark(bookmarkId, delayMs) {
    try {
        const postponed = await getPostponedBookmarks();
        const existing = postponed.find(p => p.bookmarkId === bookmarkId);
        const now = Date.now();
        
        if (existing) {
            existing.postponeUntil = now + delayMs;
            existing.postponeCount = (existing.postponeCount || 0) + 1;
            existing.updatedAt = now;
        } else {
            postponed.push({
                bookmarkId,
                postponeUntil: now + delayMs,
                postponeCount: 1,
                createdAt: now,
                updatedAt: now
            });
        }
        
        await browserAPI.storage.local.set({ recommend_postponed: postponed });
        console.log('[稍后] 已推迟书签:', bookmarkId, '延迟:', delayMs / 3600000, '小时');
        return true;
    } catch (e) {
        console.error('[稍后] 推迟书签失败:', e);
        return false;
    }
}

// 取消稍后复习
async function cancelPostpone(bookmarkId) {
    try {
        let postponed = await getPostponedBookmarks();
        postponed = postponed.filter(p => p.bookmarkId !== bookmarkId);
        await browserAPI.storage.local.set({ recommend_postponed: postponed });
        console.log('[稍后] 已取消推迟:', bookmarkId);
        return true;
    } catch (e) {
        console.error('[稍后] 取消推迟失败:', e);
        return false;
    }
}

// 清理过期的稍后复习记录
async function cleanExpiredPostponed() {
    try {
        let postponed = await getPostponedBookmarks();
        const now = Date.now();
        const before = postponed.length;
        postponed = postponed.filter(p => p.postponeUntil > now);
        if (postponed.length !== before) {
            await browserAPI.storage.local.set({ recommend_postponed: postponed });
            console.log('[稍后] 清理过期记录:', before - postponed.length, '条');
        }
    } catch (e) {
        console.error('[稍后] 清理过期记录失败:', e);
    }
}

// 稍后复习弹窗相关
let currentLaterBookmark = null;
let currentLaterRecommendedDays = 3; // P值推荐的天数

// 根据P值计算推荐间隔天数
function calculateRecommendedDays(priority, factors) {
    // P值高 → 更需要复习 → 间隔短
    // P值低 → 不太需要 → 间隔长
    const maxDays = 14;
    const minDays = 1;
    
    // 使用二次函数使分布更平滑
    let intervalDays = minDays + (maxDays - minDays) * Math.pow(1 - priority, 1.5);
    
    // 根据单个因子微调
    if (factors) {
        // D(遗忘度)特别高：很久没看了，缩短间隔
        if (factors.D > 0.8) intervalDays *= 0.7;
        // S(浅阅读)特别高：几乎没读过，缩短间隔
        if (factors.S > 0.9) intervalDays *= 0.8;
        // C(冷门度)特别高：很少点击，缩短间隔
        if (factors.C > 0.9) intervalDays *= 0.85;
    }
    
    return Math.max(minDays, Math.round(intervalDays));
}

// 格式化推荐天数显示
function formatRecommendDays(days) {
    const isZh = currentLang !== 'en';
    if (days === 1) {
        return isZh ? '明天' : 'Tomorrow';
    } else if (days <= 7) {
        return isZh ? `${days} 天后` : `${days} days`;
    } else if (days <= 14) {
        const weeks = Math.round(days / 7);
        return isZh ? `${weeks} 周后` : `${weeks} week${weeks > 1 ? 's' : ''}`;
    } else {
        return isZh ? `${days} 天后` : `${days} days`;
    }
}

function showLaterModal(bookmark) {
    currentLaterBookmark = bookmark;
    const modal = document.getElementById('laterModal');
    if (!modal) return;
    
    // 计算P值推荐的间隔
    if (bookmark.priority !== undefined && bookmark.factors) {
        currentLaterRecommendedDays = calculateRecommendedDays(bookmark.priority, bookmark.factors);
    } else {
        currentLaterRecommendedDays = 3; // 默认3天
    }
    
    // 更新推荐按钮显示
    const recommendDaysEl = document.getElementById('laterRecommendDays');
    if (recommendDaysEl) {
        recommendDaysEl.textContent = formatRecommendDays(currentLaterRecommendedDays);
    }
    
    modal.classList.add('show');
    console.log('[稍后] 显示弹窗:', bookmark.id, bookmark.title, '推荐间隔:', currentLaterRecommendedDays, '天');
}

function hideLaterModal() {
    const modal = document.getElementById('laterModal');
    if (modal) {
        modal.classList.remove('show');
    }
    currentLaterBookmark = null;
}

function initLaterModal() {
    const modal = document.getElementById('laterModal');
    if (!modal) return;
    
    // 关闭按钮
    const closeBtn = document.getElementById('laterModalClose');
    if (closeBtn) {
        closeBtn.onclick = hideLaterModal;
    }
    
    // 点击背景关闭
    modal.onclick = (e) => {
        if (e.target === modal) {
            hideLaterModal();
        }
    };
    
    // P值推荐按钮
    const recommendBtn = document.getElementById('laterRecommendBtn');
    if (recommendBtn) {
        recommendBtn.onclick = async () => {
            if (!currentLaterBookmark) return;
            
            const delayMs = currentLaterRecommendedDays * 24 * 60 * 60 * 1000;
            await postponeBookmark(currentLaterBookmark.id, delayMs);
            hideLaterModal();
            await loadPostponedList();
            await refreshRecommendCards();
        };
    }
    
    // 自定义选项按钮
    const options = modal.querySelectorAll('.later-option');
    options.forEach(option => {
        option.onclick = async () => {
            if (!currentLaterBookmark) return;
            
            const delayMs = parseInt(option.dataset.delay);
            await postponeBookmark(currentLaterBookmark.id, delayMs);
            hideLaterModal();
            await loadPostponedList();
            await refreshRecommendCards();
        };
    });
}

// =============================================================================
// 自动刷新设置
// =============================================================================

const DEFAULT_REFRESH_SETTINGS = {
    refreshEveryNOpens: 3,      // 默认每3次打开刷新
    refreshAfterHours: 0,       // 0=禁用
    refreshAfterDays: 0,        // 0=禁用
    lastRefreshTime: 0,
    openCountSinceRefresh: 0
};

async function getRefreshSettings() {
    try {
        const result = await browserAPI.storage.local.get('recommendRefreshSettings');
        return { ...DEFAULT_REFRESH_SETTINGS, ...result.recommendRefreshSettings };
    } catch (e) {
        console.error('[刷新设置] 读取失败:', e);
        return { ...DEFAULT_REFRESH_SETTINGS };
    }
}

async function saveRefreshSettings(settings) {
    try {
        await browserAPI.storage.local.set({ recommendRefreshSettings: settings });
        console.log('[刷新设置] 已保存:', settings);
    } catch (e) {
        console.error('[刷新设置] 保存失败:', e);
    }
}

async function checkAutoRefresh() {
    const settings = await getRefreshSettings();
    const now = Date.now();
    let shouldForceRefresh = false;
    let reason = '';
    
    // 更新打开次数
    settings.openCountSinceRefresh = (settings.openCountSinceRefresh || 0) + 1;
    
    // 每N次打开刷新
    if (settings.refreshEveryNOpens > 0) {
        if (settings.openCountSinceRefresh >= settings.refreshEveryNOpens) {
            shouldForceRefresh = true;
            reason = `达到 ${settings.refreshEveryNOpens} 次打开`;
        }
    }
    
    // 超过X小时
    if (!shouldForceRefresh && settings.refreshAfterHours > 0) {
        const hoursElapsed = (now - (settings.lastRefreshTime || 0)) / (1000 * 60 * 60);
        if (hoursElapsed >= settings.refreshAfterHours) {
            shouldForceRefresh = true;
            reason = `超过 ${settings.refreshAfterHours} 小时`;
        }
    }
    
    // 超过X天
    if (!shouldForceRefresh && settings.refreshAfterDays > 0) {
        const daysElapsed = (now - (settings.lastRefreshTime || 0)) / (1000 * 60 * 60 * 24);
        if (daysElapsed >= settings.refreshAfterDays) {
            shouldForceRefresh = true;
            reason = `超过 ${settings.refreshAfterDays} 天`;
        }
    }
    
    // 执行刷新
    if (shouldForceRefresh) {
        console.log('[自动刷新] 触发强制刷新，原因:', reason);
        settings.lastRefreshTime = now;
        settings.openCountSinceRefresh = 0;
        await saveRefreshSettings(settings);
        await refreshRecommendCards(true);
    } else {
        // 保存打开次数，普通刷新
        await saveRefreshSettings(settings);
        await refreshRecommendCards(false);
    }
}

function showRefreshSettingsModal() {
    const modal = document.getElementById('refreshSettingsModal');
    if (!modal) return;
    
    loadRefreshSettingsToUI();
    modal.classList.add('show');
}

function hideRefreshSettingsModal() {
    const modal = document.getElementById('refreshSettingsModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

async function loadRefreshSettingsToUI() {
    const settings = await getRefreshSettings();
    
    // 每N次打开
    const everyNEnabled = document.getElementById('refreshEveryNOpensEnabled');
    const everyNValue = document.getElementById('refreshEveryNOpensValue');
    if (everyNEnabled) everyNEnabled.checked = settings.refreshEveryNOpens > 0;
    if (everyNValue) everyNValue.value = settings.refreshEveryNOpens || 3;
    
    // 超过X小时
    const hoursEnabled = document.getElementById('refreshAfterHoursEnabled');
    const hoursValue = document.getElementById('refreshAfterHoursValue');
    if (hoursEnabled) hoursEnabled.checked = settings.refreshAfterHours > 0;
    if (hoursValue) hoursValue.value = settings.refreshAfterHours || 1;
    
    // 超过X天
    const daysEnabled = document.getElementById('refreshAfterDaysEnabled');
    const daysValue = document.getElementById('refreshAfterDaysValue');
    if (daysEnabled) daysEnabled.checked = settings.refreshAfterDays > 0;
    if (daysValue) daysValue.value = settings.refreshAfterDays || 1;
    
    // 更新状态显示
    updateRefreshSettingsStatus(settings);
}

async function saveRefreshSettingsFromUI() {
    const settings = await getRefreshSettings();
    
    // 每N次打开
    const everyNEnabled = document.getElementById('refreshEveryNOpensEnabled');
    const everyNValue = document.getElementById('refreshEveryNOpensValue');
    settings.refreshEveryNOpens = everyNEnabled?.checked ? parseInt(everyNValue?.value) || 3 : 0;
    
    // 超过X小时
    const hoursEnabled = document.getElementById('refreshAfterHoursEnabled');
    const hoursValue = document.getElementById('refreshAfterHoursValue');
    settings.refreshAfterHours = hoursEnabled?.checked ? parseInt(hoursValue?.value) || 1 : 0;
    
    // 超过X天
    const daysEnabled = document.getElementById('refreshAfterDaysEnabled');
    const daysValue = document.getElementById('refreshAfterDaysValue');
    settings.refreshAfterDays = daysEnabled?.checked ? parseInt(daysValue?.value) || 1 : 0;
    
    await saveRefreshSettings(settings);
    hideRefreshSettingsModal();
}

function updateRefreshSettingsStatus(settings) {
    const statusEl = document.getElementById('refreshSettingsStatus');
    if (!statusEl) return;
    
    const isZh = currentLang !== 'en';
    const parts = [];
    
    // 上次刷新时间
    if (settings.lastRefreshTime > 0) {
        const elapsed = Date.now() - settings.lastRefreshTime;
        const minutes = Math.floor(elapsed / 60000);
        const hours = Math.floor(elapsed / 3600000);
        const days = Math.floor(elapsed / 86400000);
        
        let timeStr;
        if (days > 0) {
            timeStr = isZh ? `${days} 天前` : `${days} day${days > 1 ? 's' : ''} ago`;
        } else if (hours > 0) {
            timeStr = isZh ? `${hours} 小时前` : `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else {
            timeStr = isZh ? `${minutes} 分钟前` : `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        }
        parts.push(isZh ? `上次刷新: ${timeStr}` : `Last refresh: ${timeStr}`);
    } else {
        parts.push(isZh ? '尚未刷新' : 'Not refreshed yet');
    }
    
    // 打开次数
    if (settings.refreshEveryNOpens > 0) {
        const count = settings.openCountSinceRefresh || 0;
        parts.push(isZh 
            ? `已打开 ${count} / ${settings.refreshEveryNOpens} 次` 
            : `Opened ${count} / ${settings.refreshEveryNOpens} times`);
    }
    
    statusEl.textContent = parts.join(' | ');
}

function initRefreshSettingsModal() {
    const modal = document.getElementById('refreshSettingsModal');
    if (!modal) return;
    
    // 关闭按钮
    const closeBtn = document.getElementById('refreshSettingsClose');
    if (closeBtn) {
        closeBtn.onclick = hideRefreshSettingsModal;
    }
    
    // 点击背景关闭
    modal.onclick = (e) => {
        if (e.target === modal) {
            hideRefreshSettingsModal();
        }
    };
    
    // 保存按钮
    const saveBtn = document.getElementById('refreshSettingsSaveBtn');
    if (saveBtn) {
        saveBtn.onclick = saveRefreshSettingsFromUI;
    }
}

// 初始化添加域名弹窗
function initAddDomainModal() {
    const modal = document.getElementById('addDomainModal');
    if (!modal) return;
    
    const closeBtn = document.getElementById('addDomainModalClose');
    const cancelBtn = document.getElementById('addDomainCancelBtn');
    const confirmBtn = document.getElementById('addDomainConfirmBtn');
    const input = document.getElementById('addDomainInput');
    
    const hideModal = () => {
        modal.classList.remove('show');
        if (input) input.value = '';
    };
    
    if (closeBtn) closeBtn.onclick = hideModal;
    if (cancelBtn) cancelBtn.onclick = hideModal;
    
    modal.onclick = (e) => {
        if (e.target === modal) hideModal();
    };
    
    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            const domain = input.value.trim();
            if (domain) {
                await blockDomain(domain);
                hideModal();
                await loadBlockedLists();
                await refreshRecommendCards();
            }
        };
    }
    
    if (input) {
        input.onkeypress = (e) => {
            if (e.key === 'Enter') confirmBtn.click();
        };
    }
}

// 初始化选择文件夹弹窗
function initSelectFolderModal() {
    const modal = document.getElementById('selectFolderModal');
    if (!modal) return;
    
    const closeBtn = document.getElementById('selectFolderModalClose');
    
    const hideModal = () => {
        modal.classList.remove('show');
    };
    
    if (closeBtn) closeBtn.onclick = hideModal;
    
    modal.onclick = (e) => {
        if (e.target === modal) hideModal();
    };
}

// 显示添加域名弹窗
function showAddDomainModal() {
    const modal = document.getElementById('addDomainModal');
    if (modal) {
        modal.classList.add('show');
        const input = document.getElementById('addDomainInput');
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

// 显示选择文件夹弹窗
async function showSelectFolderModal() {
    const modal = document.getElementById('selectFolderModal');
    const container = document.getElementById('folderTreeContainer');
    if (!modal || !container) return;
    
    // 获取已屏蔽的文件夹
    const blocked = await getBlockedBookmarks();
    const blockedFolderSet = new Set(blocked.folders);
    
    // 获取所有文件夹
    const tree = await new Promise(resolve => {
        browserAPI.bookmarks.getTree(resolve);
    });
    
    // 生成文件夹树HTML
    container.innerHTML = '';
    
    function countBookmarks(node) {
        let count = 0;
        if (node.url) count = 1;
        if (node.children) {
            for (const child of node.children) {
                count += countBookmarks(child);
            }
        }
        return count;
    }
    
    function renderFolders(nodes, parentEl, depth = 0) {
        const isZh = currentLang === 'zh_CN';
        const unnamedFolder = i18n.unnamedFolderLabel ? i18n.unnamedFolderLabel[currentLang] : '未命名文件夹';
        for (const node of nodes) {
            if (!node.url && node.children) { // 是文件夹
                if (blockedFolderSet.has(node.id)) continue; // 已屏蔽的不显示
                
                const bookmarkCount = countBookmarks(node);
                
                // 创建节点包装
                const nodeWrapper = document.createElement('div');
                nodeWrapper.className = 'folder-tree-node';
                
                const item = document.createElement('div');
                item.className = 'folder-tree-item';
                item.innerHTML = `
                    <i class="fas fa-folder"></i>
                    <span>${escapeHtml(node.title || unnamedFolder)}</span>
                    <span class="folder-count">${bookmarkCount}</span>
                `;
                item.onclick = async () => {
                    await blockFolder(node.id);
                    modal.classList.remove('show');
                    await loadBlockedLists();
                    await refreshRecommendCards();
                };
                nodeWrapper.appendChild(item);
                
                // 检查是否有子文件夹
                const childFolders = node.children.filter(c => !c.url && c.children && !blockedFolderSet.has(c.id));
                if (childFolders.length > 0) {
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'folder-tree-children';
                    renderFolders(node.children, childrenContainer, depth + 1);
                    nodeWrapper.appendChild(childrenContainer);
                }
                
                parentEl.appendChild(nodeWrapper);
            }
        }
    }
    
    renderFolders(tree, container);
    modal.classList.add('show');
}

// 初始化屏蔽管理添加按钮
function initBlockManageButtons() {
    const addFolderBtn = document.getElementById('addBlockFolderBtn');
    const addDomainBtn = document.getElementById('addBlockDomainBtn');
    
    if (addFolderBtn) {
        addFolderBtn.onclick = () => showSelectFolderModal();
    }
    
    if (addDomainBtn) {
        addDomainBtn.onclick = () => showAddDomainModal();
    }
}

// =============================================================================
// 添加到稍后复习弹窗
// =============================================================================

let addPostponedSelectedFolder = null;
let addPostponedSearchSelected = new Set();
let addPostponedDomainSelected = new Set();
let addPostponedDomainData = []; // 保存完整的域名数据用于过滤

function initAddToPostponedModal() {
    const modal = document.getElementById('addToPostponedModal');
    const addBtn = document.getElementById('postponedAddBtn');
    const closeBtn = document.getElementById('addPostponedModalClose');
    const cancelBtn = document.getElementById('addPostponedCancelBtn');
    const confirmBtn = document.getElementById('addPostponedConfirmBtn');
    const tabs = modal?.querySelectorAll('.add-postponed-tab');
    const panels = modal?.querySelectorAll('.add-postponed-panel');
    
    if (!modal || !addBtn) return;
    
    // 打开弹窗
    addBtn.onclick = (e) => {
        e.stopPropagation();
        resetAddPostponedModal();
        modal.classList.add('show');
    };
    
    // 关闭弹窗
    const hideModal = () => modal.classList.remove('show');
    closeBtn?.addEventListener('click', hideModal);
    cancelBtn?.addEventListener('click', hideModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) hideModal();
    });
    
    // 标签切换
    tabs?.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            panels?.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            modal.querySelector(`.add-postponed-panel[data-panel="${tabName}"]`)?.classList.add('active');
        });
    });
    
    // 文件夹选择按钮
    const folderSelectBtn = document.getElementById('addFolderSelectBtn');
    folderSelectBtn?.addEventListener('click', () => {
        showAddFolderPicker();
    });
    
    // "全部"复选框逻辑
    const selectAllCheckbox = document.getElementById('addFolderSelectAll');
    const countInput = document.getElementById('addFolderCount');
    const modeRow = document.getElementById('addModeRow');
    selectAllCheckbox?.addEventListener('change', () => {
        if (selectAllCheckbox.checked) {
            countInput.disabled = true;
            modeRow.style.display = 'none';
            // 自动设置为顺序模式
            const sequentialRadio = document.querySelector('input[name="addFolderMode"][value="sequential"]');
            if (sequentialRadio) sequentialRadio.checked = true;
        } else {
            countInput.disabled = false;
            modeRow.style.display = 'flex';
        }
    });
    
    // 搜索书签输入框
    const searchInput = document.getElementById('addSearchInput');
    let searchTimer = null;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchBookmarksForAdd(searchInput.value);
        }, 300);
    });
    
    // 标签切换时加载域名列表
    tabs?.forEach(tab => {
        tab.addEventListener('click', async () => {
            if (tab.dataset.tab === 'domain') {
                await loadDomainList();
            }
        });
    });
    
    // 域名搜索输入框
    const domainSearchInput = document.getElementById('addDomainSearchInput');
    let domainSearchTimer = null;
    domainSearchInput?.addEventListener('input', () => {
        clearTimeout(domainSearchTimer);
        domainSearchTimer = setTimeout(() => {
            filterDomainList(domainSearchInput.value);
        }, 200);
    });
    
    // 确认添加
    confirmBtn?.addEventListener('click', async () => {
        await confirmAddToPostponed();
        hideModal();
    });
}

function resetAddPostponedModal() {
    addPostponedSelectedFolder = null;
    addPostponedSearchSelected.clear();
    addPostponedDomainSelected.clear();
    
    const isZh = currentLang === 'zh_CN';
    
    // 重置文件夹选择
    const folderName = document.getElementById('addFolderSelectedName');
    if (folderName) folderName.textContent = isZh ? '点击选择文件夹' : 'Click to select folder';
    
    // 重置"全部"复选框
    const selectAllCheckbox = document.getElementById('addFolderSelectAll');
    const countInput = document.getElementById('addFolderCount');
    const modeRow = document.getElementById('addModeRow');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    if (countInput) countInput.disabled = false;
    if (modeRow) modeRow.style.display = 'flex';
    
    // 重置搜索
    const searchInput = document.getElementById('addSearchInput');
    const searchResults = document.getElementById('addSearchResults');
    const searchCount = document.getElementById('addSearchSelectedCount');
    if (searchInput) searchInput.value = '';
    if (searchResults) searchResults.innerHTML = `<div class="add-results-empty">${isZh ? '输入关键词搜索书签' : 'Enter keyword to search bookmarks'}</div>`;
    if (searchCount) searchCount.textContent = '0';
    
    // 重置域名
    const domainSearchInput = document.getElementById('addDomainSearchInput');
    const domainList = document.getElementById('addDomainList');
    const domainCount = document.getElementById('addDomainSelectedCount');
    if (domainSearchInput) domainSearchInput.value = '';
    if (domainList) domainList.innerHTML = `<div class="add-results-empty">${isZh ? '切换到此标签加载域名' : 'Switch to this tab to load domains'}</div>`;
    if (domainCount) domainCount.textContent = '0';
    addPostponedDomainData = [];
    
    // 重置到第一个标签
    const modal = document.getElementById('addToPostponedModal');
    const tabs = modal?.querySelectorAll('.add-postponed-tab');
    const panels = modal?.querySelectorAll('.add-postponed-panel');
    tabs?.forEach((t, i) => t.classList.toggle('active', i === 0));
    panels?.forEach((p, i) => p.classList.toggle('active', i === 0));
}

// 显示文件夹选择器
function showAddFolderPicker() {
    const panel = document.querySelector('.add-postponed-panel[data-panel="folder"]');
    if (!panel) return;
    
    // 检查是否已存在选择器
    let treeContainer = panel.querySelector('.add-folder-tree');
    if (treeContainer) {
        treeContainer.remove();
        return;
    }
    
    // 创建树形选择器
    treeContainer = document.createElement('div');
    treeContainer.className = 'add-folder-tree';
    
    // 获取书签树
    browserAPI.bookmarks.getTree().then(tree => {
        const rootNodes = tree[0]?.children || [];
        treeContainer.innerHTML = renderFolderTree(rootNodes);
        
        // 绑定点击事件
        treeContainer.querySelectorAll('.add-folder-tree-item').forEach(item => {
            item.addEventListener('click', () => {
                treeContainer.querySelectorAll('.add-folder-tree-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                addPostponedSelectedFolder = {
                    id: item.dataset.id,
                    title: item.dataset.title
                };
                const folderName = document.getElementById('addFolderSelectedName');
                if (folderName) folderName.textContent = item.dataset.title;
            });
        });
    });
    
    // 插入到第一行后面
    const firstRow = panel.querySelector('.add-panel-row');
    firstRow?.insertAdjacentElement('afterend', treeContainer);
}

function renderFolderTree(nodes, level = 0) {
    const isZh = currentLang === 'zh_CN';
    
    function countBookmarks(node) {
        let count = 0;
        if (node.url) count = 1;
        if (node.children) {
            for (const child of node.children) {
                count += countBookmarks(child);
            }
        }
        return count;
    }
    
    let html = '';
    for (const node of nodes) {
        if (!node.url) { // 只显示文件夹
            const hasChildren = node.children?.some(c => !c.url);
            const bookmarkCount = countBookmarks(node);
            html += `<div class="folder-tree-node">`;
            html += `<div class="add-folder-tree-item" data-id="${node.id}" data-title="${escapeHtml(node.title || '未命名')}">
                <i class="fas fa-folder"></i>
                <span>${escapeHtml(node.title || (isZh ? '未命名' : 'Untitled'))}</span>
                <span class="folder-count">${bookmarkCount}</span>
            </div>`;
            if (hasChildren) {
                html += `<div class="folder-tree-children">${renderFolderTree(node.children, level + 1)}</div>`;
            }
            html += `</div>`;
        }
    }
    return html;
}

// 搜索书签
async function searchBookmarksForAdd(keyword) {
    const resultsEl = document.getElementById('addSearchResults');
    const countEl = document.getElementById('addSearchSelectedCount');
    if (!resultsEl) return;
    
    if (!keyword.trim()) {
        resultsEl.innerHTML = `<div class="add-results-empty">${currentLang === 'zh_CN' ? '输入关键词搜索书签' : 'Enter keyword to search bookmarks'}</div>`;
        return;
    }
    
    try {
        const results = await browserAPI.bookmarks.search(keyword);
        const bookmarks = results.filter(b => b.url).slice(0, 50);
        
        if (bookmarks.length === 0) {
            resultsEl.innerHTML = `<div class="add-results-empty">${currentLang === 'zh_CN' ? '未找到匹配的书签' : 'No bookmarks found'}</div>`;
            return;
        }
        
        resultsEl.innerHTML = bookmarks.map(b => `
            <div class="add-result-item ${addPostponedSearchSelected.has(b.id) ? 'selected' : ''}" data-id="${b.id}">
                <input type="checkbox" class="add-result-checkbox" ${addPostponedSearchSelected.has(b.id) ? 'checked' : ''}>
                <img class="add-result-favicon" src="${getFaviconUrl(b.url)}" onerror="this.src='icons/default-favicon.png'">
                <div class="add-result-info">
                    <div class="add-result-title">${escapeHtml(b.title || b.url)}</div>
                    <div class="add-result-url">${escapeHtml(b.url)}</div>
                </div>
            </div>
        `).join('');
        
        // 绑定点击事件
        resultsEl.querySelectorAll('.add-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                const checkbox = item.querySelector('.add-result-checkbox');
                if (addPostponedSearchSelected.has(id)) {
                    addPostponedSearchSelected.delete(id);
                    item.classList.remove('selected');
                    checkbox.checked = false;
                } else {
                    addPostponedSearchSelected.add(id);
                    item.classList.add('selected');
                    checkbox.checked = true;
                }
                countEl.textContent = addPostponedSearchSelected.size;
            });
        });
    } catch (e) {
        console.error('[添加到稍后] 搜索失败:', e);
    }
}

// 加载域名列表
async function loadDomainList() {
    const listEl = document.getElementById('addDomainList');
    const countEl = document.getElementById('addDomainSelectedCount');
    const searchInput = document.getElementById('addDomainSearchInput');
    if (!listEl) return;
    
    const isZh = currentLang === 'zh_CN';
    listEl.innerHTML = `<div class="add-results-empty">${isZh ? '加载中...' : 'Loading...'}</div>`;
    if (searchInput) searchInput.value = '';
    
    try {
        const allBookmarks = await getAllBookmarksFlat();
        
        // 统计每个域名的书签数量
        const domainMap = new Map(); // domain -> { count, bookmarkIds }
        for (const b of allBookmarks) {
            if (!b.url) continue;
            try {
                const url = new URL(b.url);
                const domain = url.hostname;
                if (!domainMap.has(domain)) {
                    domainMap.set(domain, { count: 0, bookmarkIds: [] });
                }
                domainMap.get(domain).count++;
                domainMap.get(domain).bookmarkIds.push(b.id);
            } catch {
                // 忽略无效URL
            }
        }
        
        // 按数量排序并保存
        addPostponedDomainData = Array.from(domainMap.entries())
            .sort((a, b) => b[1].count - a[1].count);
        
        renderDomainList(addPostponedDomainData);
    } catch (e) {
        console.error('[添加到待复习] 加载域名列表失败:', e);
        const isZh = currentLang === 'zh_CN';
        listEl.innerHTML = `<div class="add-results-empty">${isZh ? '加载失败' : 'Failed to load'}</div>`;
    }
}

// 过滤域名列表
function filterDomainList(keyword) {
    if (!keyword.trim()) {
        renderDomainList(addPostponedDomainData);
        return;
    }
    
    const keywordLower = keyword.toLowerCase();
    const filtered = addPostponedDomainData.filter(([domain]) => 
        domain.toLowerCase().includes(keywordLower)
    );
    renderDomainList(filtered);
}

// 渲染域名列表
function renderDomainList(domains) {
    const listEl = document.getElementById('addDomainList');
    const countEl = document.getElementById('addDomainSelectedCount');
    if (!listEl) return;
    
    const isZh = currentLang === 'zh_CN';
    
    if (domains.length === 0) {
        listEl.innerHTML = `<div class="add-results-empty">${isZh ? '没有找到匹配的域名' : 'No matching domains'}</div>`;
        return;
    }
    
    // 最多显示100个
    const displayDomains = domains.slice(0, 100);
    
    listEl.innerHTML = displayDomains.map(([domain, data]) => `
        <div class="add-domain-item ${addPostponedDomainSelected.has(domain) ? 'selected' : ''}" data-domain="${escapeHtml(domain)}">
            <input type="checkbox" ${addPostponedDomainSelected.has(domain) ? 'checked' : ''}>
            <div class="add-domain-info">
                <div class="add-domain-name">${escapeHtml(domain)}</div>
                <div class="add-domain-count">${data.count} ${isZh ? '个书签' : 'bookmarks'}</div>
            </div>
        </div>
    `).join('');
    
    // 绑定点击事件
    listEl.querySelectorAll('.add-domain-item').forEach(item => {
        item.addEventListener('click', () => {
            const domain = item.dataset.domain;
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (addPostponedDomainSelected.has(domain)) {
                addPostponedDomainSelected.delete(domain);
                item.classList.remove('selected');
                checkbox.checked = false;
            } else {
                addPostponedDomainSelected.add(domain);
                item.classList.add('selected');
                checkbox.checked = true;
            }
            countEl.textContent = addPostponedDomainSelected.size;
        });
    });
}

// 获取所有书签（扁平化）
async function getAllBookmarksFlat() {
    const tree = await browserAPI.bookmarks.getTree();
    const bookmarks = [];
    
    function traverse(nodes) {
        for (const node of nodes) {
            if (node.url) {
                bookmarks.push(node);
            }
            if (node.children) {
                traverse(node.children);
            }
        }
    }
    
    traverse(tree);
    return bookmarks;
}

// 确认添加到待复习
async function confirmAddToPostponed() {
    const activePanel = document.querySelector('.add-postponed-panel.active');
    if (!activePanel) return;
    
    const panelType = activePanel.dataset.panel;
    let bookmarkIds = [];
    const isZh = currentLang === 'zh_CN';
    
    if (panelType === 'folder') {
        // 从文件夹抽取
        if (!addPostponedSelectedFolder) {
            alert(isZh ? '请先选择一个文件夹' : 'Please select a folder first');
            return;
        }
        
        const selectAll = document.getElementById('addFolderSelectAll')?.checked;
        const count = selectAll ? Infinity : (parseInt(document.getElementById('addFolderCount')?.value) || 5);
        const mode = selectAll ? 'sequential' : (document.querySelector('input[name="addFolderMode"]:checked')?.value || 'random');
        const includeSubfolders = document.getElementById('addFolderIncludeSubfolders')?.checked ?? true;
        
        // 获取文件夹内的书签
        const folderBookmarks = await getBookmarksFromFolder(addPostponedSelectedFolder.id, includeSubfolders);
        
        if (folderBookmarks.length === 0) {
            alert(isZh ? '该文件夹中没有书签' : 'No bookmarks in this folder');
            return;
        }
        
        // 根据模式抽取
        if (mode === 'random') {
            // 随机打乱
            const shuffled = [...folderBookmarks].sort(() => Math.random() - 0.5);
            bookmarkIds = shuffled.slice(0, count).map(b => b.id);
        } else {
            // 顺序抽取（全部或指定数量）
            bookmarkIds = folderBookmarks.slice(0, count).map(b => b.id);
        }
        
    } else if (panelType === 'search') {
        bookmarkIds = Array.from(addPostponedSearchSelected);
        if (bookmarkIds.length === 0) {
            alert(isZh ? '请先搜索并选择书签' : 'Please search and select bookmarks first');
            return;
        }
    } else if (panelType === 'domain') {
        const selectedDomains = Array.from(addPostponedDomainSelected);
        if (selectedDomains.length === 0) {
            alert(isZh ? '请先选择域名' : 'Please select domains first');
            return;
        }
        // 获取所有选中域名的书签
        const allBookmarks = await getAllBookmarksFlat();
        for (const b of allBookmarks) {
            if (!b.url) continue;
            try {
                const url = new URL(b.url);
                if (selectedDomains.includes(url.hostname)) {
                    bookmarkIds.push(b.id);
                }
            } catch {
                // 忽略
            }
        }
        if (bookmarkIds.length === 0) {
            alert(isZh ? '所选域名没有书签' : 'No bookmarks for selected domains');
            return;
        }
    }
    
    if (bookmarkIds.length === 0) {
        return;
    }
    
    // 添加到待复习队列（手动添加的书签会获得优先级提升）
    const postponed = await getPostponedBookmarks();
    const now = Date.now();
    let addedCount = 0;
    
    // 处理"全部"选项
    const selectAllCheckbox = document.getElementById('addFolderSelectAll');
    const isSelectAll = selectAllCheckbox?.checked;
    
    // 生成分组信息
    let groupInfo = null;
    if (panelType === 'folder' && addPostponedSelectedFolder) {
        groupInfo = {
            type: 'folder',
            id: `folder_${addPostponedSelectedFolder.id}_${now}`,
            name: addPostponedSelectedFolder.title,
            folderId: addPostponedSelectedFolder.id
        };
    } else if (panelType === 'domain') {
        const selectedDomains = Array.from(addPostponedDomainSelected);
        const domainName = selectedDomains.length === 1 ? selectedDomains[0] : `${selectedDomains.length} ${isZh ? '个域名' : 'domains'}`;
        groupInfo = {
            type: 'domain',
            id: `domain_${now}`,
            name: domainName
        };
    }
    
    for (const id of bookmarkIds) {
        // 检查是否已存在
        const existing = postponed.find(p => p.bookmarkId === id);
        if (!existing) {
            postponed.push({
                bookmarkId: id,
                addedAt: now,
                postponeUntil: now, // 立即可用，不设置延迟
                manuallyAdded: true, // 标记为手动添加，用于优先级提升
                groupId: groupInfo?.id || null,
                groupType: groupInfo?.type || 'single',
                groupName: groupInfo?.name || null
            });
            addedCount++;
        } else if (!existing.manuallyAdded) {
            // 如果已存在但不是手动添加的，更新为手动添加
            existing.manuallyAdded = true;
            existing.postponeUntil = now;
            existing.groupId = groupInfo?.id || null;
            existing.groupType = groupInfo?.type || 'single';
            existing.groupName = groupInfo?.name || null;
        }
    }
    
    await browserAPI.storage.local.set({ recommend_postponed: postponed });
    console.log(`[添加到待复习] 已添加 ${addedCount} 个书签（手动添加，优先级提升）`);
    
    // 刷新列表和推荐卡片
    await loadPostponedList();
    await refreshRecommendCards(true); // 强制刷新推荐卡片
    
    // 显示成功提示
    const msg = isZh 
        ? `已添加 ${bookmarkIds.length} 个书签到待复习` 
        : `Added ${bookmarkIds.length} bookmark(s) to review`;
    
    // 使用临时提示而不是 alert
    showToast(msg);
}

// 显示临时提示
function showToast(message, duration = 2000) {
    // 移除已存在的toast
    const existing = document.querySelector('.toast-message');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 99999;
        animation: fadeInUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOutDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// 从文件夹获取书签
async function getBookmarksFromFolder(folderId, includeSubfolders = true) {
    const bookmarks = [];
    
    async function traverse(nodeId) {
        const children = await browserAPI.bookmarks.getChildren(nodeId);
        for (const child of children) {
            if (child.url) {
                bookmarks.push(child);
            } else if (includeSubfolders && child.children !== undefined) {
                await traverse(child.id);
            }
        }
    }
    
    await traverse(folderId);
    return bookmarks;
}

async function loadRecommendData() {
    console.log('[书签推荐] 加载推荐数据');
    
    // 检查是否需要自动刷新，如果不需要则普通刷新
    await checkAutoRefresh();
    
    // 加载稍后复习队列
    await loadPostponedList();
    
    // 加载热力图
    await loadHeatmapData();
    
    // 加载屏蔽列表
    await loadBlockedLists();
}

// 加载待复习队列
async function loadPostponedList() {
    const listEl = document.getElementById('postponedList');
    const countEl = document.getElementById('postponedCount');
    const emptyEl = document.getElementById('postponedEmpty');
    if (!listEl) return;
    
    try {
        const postponed = await getPostponedBookmarks();
        const now = Date.now();
        
        // 过滤：手动添加的 或 未到期的
        const activePostponed = postponed.filter(p => p.manuallyAdded || p.postponeUntil > now);
        
        // 更新计数
        if (countEl) countEl.textContent = activePostponed.length;
        
        // 更新优先模式按钮和权重显示
        const priorityBadge = document.getElementById('postponedPriorityBadge');
        const priorityModeBtn = document.getElementById('priorityModeBtn');
        const hasManualPostponed = activePostponed.some(p => p.manuallyAdded);
        
        if (priorityBadge) {
            priorityBadge.style.display = hasManualPostponed ? 'inline-flex' : 'none';
        }
        
        // 优先模式按钮显示/隐藏
        if (priorityModeBtn) {
            if (hasManualPostponed) {
                priorityModeBtn.style.display = 'inline-flex';
                // 如果当前不是用户主动选择的其他模式，自动切换到优先模式
                if (!priorityModeBtn.dataset.userOverride) {
                    applyPresetMode('priority');
                }
            } else {
                priorityModeBtn.style.display = 'none';
                // 待复习清空后，如果当前是优先模式，切换回默认
                if (currentRecommendMode === 'priority') {
                    applyPresetMode('default');
                }
                delete priorityModeBtn.dataset.userOverride;
            }
        }
        
        // 根据数量决定是否折叠
        updatePostponedCollapse(activePostponed.length);
        
        // 清空列表（保留空状态元素）
        const items = listEl.querySelectorAll('.postponed-item, .postponed-group');
        items.forEach(item => item.remove());
        
        if (activePostponed.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        
        if (emptyEl) emptyEl.style.display = 'none';
        
        // 按分组整理书签
        const groups = new Map(); // groupId -> items[]
        const singles = []; // 没有分组的单个书签
        const delayedItems = []; // 通过卡片⏰按钮添加的延迟书签
        
        for (const p of activePostponed) {
            if (p.groupId && p.manuallyAdded) {
                if (!groups.has(p.groupId)) {
                    groups.set(p.groupId, {
                        type: p.groupType,
                        name: p.groupName,
                        items: []
                    });
                }
                groups.get(p.groupId).items.push(p);
            } else if (p.manuallyAdded && !p.groupId) {
                singles.push(p);
            } else {
                delayedItems.push(p);
            }
        }
        
        // 渲染分组
        for (const [groupId, group] of groups) {
            await renderPostponedGroup(listEl, groupId, group);
        }
        
        // 渲染单个书签
        for (const p of singles) {
            await renderPostponedItem(listEl, p);
        }
        
        // 渲染延迟书签
        for (const p of delayedItems) {
            await renderPostponedItem(listEl, p);
        }
        
    } catch (e) {
        console.error('[待复习] 加载待复习列表失败:', e);
    }
}

// 渲染分组
async function renderPostponedGroup(container, groupId, group) {
    const isZh = currentLang === 'zh_CN';
    const icon = group.type === 'folder' ? 'fa-folder' : 'fa-globe';
    const typeLabel = group.type === 'folder' 
        ? (isZh ? '文件夹' : 'Folder')
        : (isZh ? '域名' : 'Domain');
    
    const groupEl = document.createElement('div');
    groupEl.className = 'postponed-group';
    groupEl.dataset.groupId = groupId;
    
    groupEl.innerHTML = `
        <div class="postponed-group-header">
            <div class="postponed-group-info">
                <i class="fas ${icon} postponed-group-icon"></i>
                <span class="postponed-group-name">${escapeHtml(group.name)}</span>
                <span class="postponed-group-count">${group.items.length}</span>
                <span class="postponed-group-type">${typeLabel}</span>
            </div>
            <div class="postponed-group-actions">
                <button class="postponed-group-btn expand" title="${isZh ? '展开' : 'Expand'}">
                    <i class="fas fa-chevron-down"></i>
                </button>
                <button class="postponed-group-btn cancel" title="${isZh ? '取消全部' : 'Cancel All'}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
        <div class="postponed-group-items" style="display: none;"></div>
    `;
    
    const header = groupEl.querySelector('.postponed-group-header');
    const itemsContainer = groupEl.querySelector('.postponed-group-items');
    const expandBtn = groupEl.querySelector('.postponed-group-btn.expand');
    const cancelBtn = groupEl.querySelector('.postponed-group-btn.cancel');
    
    // 展开/折叠
    header.onclick = async (e) => {
        if (e.target.closest('.postponed-group-btn')) return;
        toggleGroupExpand();
    };
    
    expandBtn.onclick = (e) => {
        e.stopPropagation();
        toggleGroupExpand();
    };
    
    async function toggleGroupExpand() {
        const isExpanded = itemsContainer.style.display !== 'none';
        if (isExpanded) {
            itemsContainer.style.display = 'none';
            expandBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            expandBtn.title = isZh ? '展开' : 'Expand';
        } else {
            // 首次展开时渲染子项
            if (itemsContainer.children.length === 0) {
                for (const p of group.items) {
                    await renderPostponedItem(itemsContainer, p, true);
                }
            }
            itemsContainer.style.display = 'block';
            expandBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
            expandBtn.title = isZh ? '收起' : 'Collapse';
        }
    }
    
    // 取消全部
    cancelBtn.onclick = async (e) => {
        e.stopPropagation();
        for (const p of group.items) {
            await cancelPostpone(p.bookmarkId);
        }
        await loadPostponedList();
        await refreshRecommendCards();
    };
    
    container.appendChild(groupEl);
}

// 渲染单个待复习项
async function renderPostponedItem(container, p, isGroupChild = false) {
    try {
        const bookmarks = await new Promise(resolve => {
            browserAPI.bookmarks.get(p.bookmarkId, resolve);
        });
        if (!bookmarks || bookmarks.length === 0) return;
        const bookmark = bookmarks[0];
        
        const item = document.createElement('div');
        item.className = 'postponed-item' + (isGroupChild ? ' group-child' : '');
        item.style.cursor = 'pointer';
        
        const isZh = currentLang === 'zh_CN';
        const isManuallyAdded = p.manuallyAdded;
        const manualBadge = (isManuallyAdded && !isGroupChild)
            ? `<span class="postponed-item-badge manual">${isZh ? '优先' : 'Priority'}</span>` 
            : '';
        const timeOrManual = isManuallyAdded 
            ? (isZh ? '手动添加，优先推荐' : 'Manually added, priority boost')
            : formatPostponeTime(p.postponeUntil);
        
        item.innerHTML = `
            <img class="postponed-item-icon" src="${getFaviconUrl(bookmark.url)}" alt="">
            <div class="postponed-item-info">
                <div class="postponed-item-title">${manualBadge}${escapeHtml(bookmark.title || bookmark.url)}</div>
                <div class="postponed-item-meta">
                    <span class="postponed-item-time">${timeOrManual}</span>
                    ${!isManuallyAdded && p.postponeCount > 1 ? `<span class="postponed-item-count">(${isZh ? '已推迟' + p.postponeCount + '次' : 'postponed ' + p.postponeCount + ' times'})</span>` : ''}
                </div>
            </div>
            <button class="postponed-item-btn" data-id="${p.bookmarkId}">${isZh ? '取消' : 'Cancel'}</button>
        `;
        
        // 点击整个item = 提前复习
        item.onclick = async (e) => {
            if (e.target.closest('.postponed-item-btn')) return;
            console.log('[提前复习]', bookmark.id, bookmark.title);
            await cancelPostpone(p.bookmarkId);
            await recordReview(p.bookmarkId);
            await openInRecommendWindow(bookmark.url);
            await loadPostponedList();
        };
        
        // 取消按钮事件
        const btn = item.querySelector('.postponed-item-btn');
        btn.onclick = async (e) => {
            e.stopPropagation();
            await cancelPostpone(p.bookmarkId);
            await loadPostponedList();
            await refreshRecommendCards();
        };
        
        container.appendChild(item);
    } catch (e) {
        console.error('[待复习] 获取书签信息失败:', e);
    }
}

// 格式化推迟时间
function formatPostponeTime(timestamp) {
    const now = Date.now();
    const diff = timestamp - now;
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return currentLang === 'en' ? `${days} day${days > 1 ? 's' : ''} later` : `${days}天后`;
    } else if (hours > 0) {
        return currentLang === 'en' ? `${hours} hour${hours > 1 ? 's' : ''} later` : `${hours}小时后`;
    } else {
        const mins = Math.max(1, Math.floor(diff / 60000));
        return currentLang === 'en' ? `${mins} minute${mins > 1 ? 's' : ''} later` : `${mins}分钟后`;
    }
}

// 加载屏蔽列表
async function loadBlockedLists() {
    const blocked = await getBlockedBookmarks();
    
    // 加载已屏蔽书签
    await loadBlockedBookmarksList(blocked.bookmarks);
    
    // 加载已屏蔽文件夹
    await loadBlockedFoldersList(blocked.folders);
    
    // 加载已屏蔽域名
    await loadBlockedDomainsList(blocked.domains);
}

// 加载已屏蔽书签列表（相同标题合并显示）
async function loadBlockedBookmarksList(bookmarkIds) {
    const listEl = document.getElementById('blockedBookmarksList');
    const countEl = document.getElementById('blockedBookmarksCount');
    const emptyEl = document.getElementById('blockedBookmarksEmpty');
    if (!listEl) return;
    
    // 更新计数
    if (countEl) countEl.textContent = bookmarkIds.length;
    
    // 清空列表
    const items = listEl.querySelectorAll('.block-item, .block-group');
    items.forEach(item => item.remove());
    
    if (bookmarkIds.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    // 获取所有书签信息并按标题分组
    const titleGroups = new Map(); // title -> [{id, bookmark}]
    
    for (const id of bookmarkIds) {
        try {
            const bookmarks = await new Promise(resolve => {
                browserAPI.bookmarks.get(id, resolve);
            });
            if (!bookmarks || bookmarks.length === 0) continue;
            const bookmark = bookmarks[0];
            const title = bookmark.title || bookmark.url;
            
            if (!titleGroups.has(title)) {
                titleGroups.set(title, []);
            }
            titleGroups.get(title).push({ id, bookmark });
        } catch (e) {
            // 书签可能已被删除
        }
    }
    
    const isZh = currentLang === 'zh_CN';
    
    // 渲染分组
    for (const [title, group] of titleGroups) {
        const firstBookmark = group[0].bookmark;
        const count = group.length;
        const allIds = group.map(g => g.id);
        
        const item = document.createElement('div');
        item.className = 'block-item';
        
        const countBadge = count > 1 
            ? `<span class="block-item-count">${count}</span>` 
            : '';
        
        item.innerHTML = `
            <img class="block-item-icon" src="${getFaviconUrl(firstBookmark.url)}" alt="">
            <div class="block-item-info">
                <div class="block-item-title">${escapeHtml(title)}</div>
            </div>
            ${countBadge}
            <button class="block-item-btn">${isZh ? '恢复' : 'Restore'}</button>
        `;
        
        const btn = item.querySelector('.block-item-btn');
        btn.onclick = async () => {
            // 恢复所有同标题的书签
            for (const id of allIds) {
                await unblockBookmark(id);
            }
            await loadBlockedLists();
            await refreshRecommendCards();
        };
        
        listEl.appendChild(item);
    }
}

// 加载已屏蔽文件夹列表
async function loadBlockedFoldersList(folderIds) {
    const listEl = document.getElementById('blockedFoldersList');
    const countEl = document.getElementById('blockedFoldersCount');
    const emptyEl = document.getElementById('blockedFoldersEmpty');
    if (!listEl) return;
    
    if (countEl) countEl.textContent = folderIds.length;
    
    const items = listEl.querySelectorAll('.block-item');
    items.forEach(item => item.remove());
    
    if (folderIds.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    for (const id of folderIds) {
        try {
            const folders = await new Promise(resolve => {
                browserAPI.bookmarks.get(id, resolve);
            });
            if (!folders || folders.length === 0) continue;
            const folder = folders[0];
            
            const item = document.createElement('div');
            item.className = 'block-item';
            item.innerHTML = `
                <i class="fas fa-folder block-item-icon" style="font-size: 18px; color: var(--warning);"></i>
                <div class="block-item-info">
                    <div class="block-item-title">${escapeHtml(folder.title)}</div>
                </div>
                <button class="block-item-btn" data-id="${id}">${currentLang === 'en' ? 'Restore' : '恢复'}</button>
            `;
            
            const btn = item.querySelector('.block-item-btn');
            btn.onclick = async () => {
                await unblockFolder(id);
                await loadBlockedLists();
                await refreshRecommendCards();
            };
            
            listEl.appendChild(item);
        } catch (e) {}
    }
}

// 加载已屏蔽域名列表
async function loadBlockedDomainsList(domains) {
    const listEl = document.getElementById('blockedDomainsList');
    const countEl = document.getElementById('blockedDomainsCount');
    const emptyEl = document.getElementById('blockedDomainsEmpty');
    if (!listEl) return;
    
    if (countEl) countEl.textContent = domains.length;
    
    const items = listEl.querySelectorAll('.block-item');
    items.forEach(item => item.remove());
    
    if (domains.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    for (const domain of domains) {
        const item = document.createElement('div');
        item.className = 'block-item';
        item.innerHTML = `
            <i class="fas fa-globe block-item-icon" style="font-size: 18px; color: var(--accent-primary);"></i>
            <div class="block-item-info">
                <div class="block-item-title">${escapeHtml(domain)}</div>
            </div>
            <button class="block-item-btn" data-domain="${domain}">${currentLang === 'en' ? 'Restore' : '恢复'}</button>
        `;
        
        const btn = item.querySelector('.block-item-btn');
        btn.onclick = async () => {
            await unblockDomain(domain);
            await loadBlockedLists();
            await refreshRecommendCards();
        };
        
        listEl.appendChild(item);
    }
}

// 屏蔽/恢复文件夹
async function blockFolder(folderId) {
    try {
        const blocked = await getBlockedBookmarks();
        if (!blocked.folders.includes(folderId)) {
            blocked.folders.push(folderId);
            await browserAPI.storage.local.set({ recommend_blocked: blocked });
        }
        return true;
    } catch (e) {
        return false;
    }
}

async function unblockFolder(folderId) {
    try {
        const blocked = await getBlockedBookmarks();
        blocked.folders = blocked.folders.filter(id => id !== folderId);
        await browserAPI.storage.local.set({ recommend_blocked: blocked });
        return true;
    } catch (e) {
        return false;
    }
}

// 屏蔽/恢复域名
async function blockDomain(domain) {
    try {
        const blocked = await getBlockedBookmarks();
        if (!blocked.domains.includes(domain)) {
            blocked.domains.push(domain);
            await browserAPI.storage.local.set({ recommend_blocked: blocked });
        }
        return true;
    } catch (e) {
        return false;
    }
}

async function unblockDomain(domain) {
    try {
        const blocked = await getBlockedBookmarks();
        blocked.domains = blocked.domains.filter(d => d !== domain);
        await browserAPI.storage.local.set({ recommend_blocked: blocked });
        return true;
    } catch (e) {
        return false;
    }
}

// =============================================================================
// Phase 4: 权重公式计算 P = w1×F + w2×C + w3×S + w4×D + w5×L
// =============================================================================

// ===== P1: 缓存机制 =====
let trackingDataCache = null;
let trackingCacheTime = 0;
let historyDataCache = null;
let historyCacheTime = 0;
const STATS_CACHE_TTL = 60000; // 1分钟缓存

// ===== P0: 从 IndexedDB 获取 tracking 数据（通过 sendMessage）=====
async function getTrackingDataFromDB() {
    const now = Date.now();
    // 检查缓存
    if (trackingDataCache && (now - trackingCacheTime) < STATS_CACHE_TTL) {
        return trackingDataCache;
    }
    
    try {
        const response = await browserAPI.runtime.sendMessage({
            action: 'getActiveSessions',
            startTime: 0,
            endTime: now
        });
        
        if (response && response.success && response.sessions) {
            const trackingData = {};
            for (const session of response.sessions) {
                if (session.url) {
                    if (!trackingData[session.url]) {
                        trackingData[session.url] = { activeMs: 0, compositeMs: 0 };
                    }
                    // 累加活跃时间
                    trackingData[session.url].activeMs += session.activeMs || 0;
                    // 累加综合时间：活跃×1.0 + 前台静止×0.8 + 可见参考×0.5 + 后台×0.1
                    const sessionComposite = session.compositeMs || 
                        ((session.activeMs || 0) + 
                         (session.idleFocusMs || session.pauseTotalMs || 0) * 0.8 +
                         (session.visibleMs || 0) * 0.5 +
                         (session.backgroundMs || 0) * 0.1);
                    trackingData[session.url].compositeMs += sessionComposite;
                }
            }
            // 更新缓存
            trackingDataCache = trackingData;
            trackingCacheTime = now;
            console.log('[权重计算] tracking 数据已加载:', Object.keys(trackingData).length, '个URL（含综合时间）');
            return trackingData;
        }
    } catch (e) {
        console.warn('[权重计算] 获取 tracking 数据失败:', e);
    }
    return {};
}

// ===== P2: 批量获取历史记录（优化性能）=====
async function getBatchHistoryData() {
    const now = Date.now();
    // 检查缓存
    if (historyDataCache && (now - historyCacheTime) < STATS_CACHE_TTL) {
        return historyDataCache;
    }
    
    try {
        if (!browserAPI?.history?.search) {
            return new Map();
        }
        
        const historyItems = await new Promise((resolve) => {
            browserAPI.history.search({
                text: '',
                startTime: 0,
                maxResults: 50000
            }, (results) => {
                if (browserAPI.runtime?.lastError) {
                    resolve([]);
                } else {
                    resolve(results || []);
                }
            });
        });
        
        const historyMap = new Map();
        for (const item of historyItems) {
            if (item.url) {
                historyMap.set(item.url, {
                    visitCount: item.visitCount || 0,
                    lastVisitTime: item.lastVisitTime || 0
                });
            }
        }
        
        // 更新缓存
        historyDataCache = historyMap;
        historyCacheTime = now;
        console.log('[权重计算] 历史数据已批量加载:', historyMap.size, '条');
        return historyMap;
    } catch (e) {
        console.warn('[权重计算] 批量获取历史数据失败:', e);
        return new Map();
    }
}

// 获取书签的访问统计数据（保留用于单个查询场景）
async function getBookmarkVisitStats(url) {
    try {
        if (!browserAPI?.history?.getVisits) {
            return { visitCount: 0, lastVisitTime: 0 };
        }
        
        const visits = await new Promise((resolve) => {
            browserAPI.history.getVisits({ url }, (results) => {
                if (browserAPI.runtime?.lastError) {
                    resolve([]);
                } else {
                    resolve(results || []);
                }
            });
        });
        
        return {
            visitCount: visits.length,
            lastVisitTime: visits.length > 0 ? Math.max(...visits.map(v => v.visitTime)) : 0
        };
    } catch (e) {
        return { visitCount: 0, lastVisitTime: 0 };
    }
}

// 获取书签的活跃浏览时间（从 IndexedDB，通过 sendMessage）
async function getBookmarkActiveTime(url) {
    try {
        const trackingData = await getTrackingDataFromDB();
        return trackingData[url] || 0;
    } catch (e) {
        return 0;
    }
}

// 批量获取书签统计数据（P0+P1+P2 优化版本）
async function batchGetBookmarkStats(bookmarks) {
    const stats = new Map();
    
    // P0+P1: 从 IndexedDB 获取 tracking 数据（带缓存）
    const trackingData = await getTrackingDataFromDB();
    
    // P2: 批量获取历史数据（带缓存）
    const historyData = await getBatchHistoryData();
    
    // 直接从缓存构建统计数据，无需逐个查询
    for (const bookmark of bookmarks) {
        const historyStats = historyData.get(bookmark.url) || { visitCount: 0, lastVisitTime: 0 };
        const trackingInfo = trackingData[bookmark.url] || { activeMs: 0, compositeMs: 0 };
        
        stats.set(bookmark.id, {
            visitCount: historyStats.visitCount,
            lastVisitTime: historyStats.lastVisitTime,
            activeTimeMs: trackingInfo.activeMs,
            compositeTimeMs: trackingInfo.compositeMs,  // 综合时间
            dateAdded: bookmark.dateAdded || Date.now()
        });
    }
    
    return stats;
}

// 清除统计缓存（在需要强制刷新时调用）
function clearStatsCache() {
    trackingDataCache = null;
    trackingCacheTime = 0;
    historyDataCache = null;
    historyCacheTime = 0;
    console.log('[权重计算] 统计缓存已清除');
}

// 计算单个因子的归一化值 (0-1)
// 使用幂函数衰减：1 / (1 + (x/阈值)^0.7)
// 特点：阈值处正好是0.5，大数值仍有区分度，衰减平缓
function calculateFactorValue(value, threshold, inverse = false) {
    if (value <= 0) return inverse ? 1 : 0;
    // 幂函数衰减，指数0.7使衰减更平缓
    const decayed = 1 / (1 + Math.pow(value / threshold, 0.7));
    return inverse ? decayed : (1 - decayed);
}

// 使用权重公式计算书签优先级
// P = w1×F + w2×C + w3×S + w4×D + w5×L
function calculateWeightedPriority(bookmark, stats, postponeData) {
    const now = Date.now();
    const bookmarkStats = stats.get(bookmark.id) || {
        visitCount: 0,
        lastVisitTime: 0,
        activeTimeMs: 0,
        dateAdded: now
    };
    
    // 检查追踪是否开启（通过UI状态判断）
    const termTimeDegree = document.getElementById('termTimeDegree');
    const isTrackingDisabled = termTimeDegree?.classList.contains('disabled');
    
    // 获取权重配置（从输入框读取，已由模式设置）
    let w1 = parseFloat(document.getElementById('weightFreshness')?.value) || 0.15;
    let w2 = parseFloat(document.getElementById('weightColdness')?.value) || 0.20;
    let w3 = parseFloat(document.getElementById('weightTimeDegree')?.value) || 0.25;
    let w4 = parseFloat(document.getElementById('weightForgetting')?.value) || 0.20;
    let w5 = parseFloat(document.getElementById('weightLaterReview')?.value) || 0.20;
    
    // 追踪关闭时，T权重变0，其他权重重新归一化
    if (isTrackingDisabled) {
        const remaining = w1 + w2 + w4 + w5;
        if (remaining > 0) {
            w1 = w1 / remaining;
            w2 = w2 / remaining;
            w4 = w4 / remaining;
            w5 = w5 / remaining;
        }
        w3 = 0;
    }
    
    // 获取阈值配置
    const tFreshness = parseFloat(document.getElementById('thresholdFreshness')?.value) || 30; // 天
    const tColdness = parseFloat(document.getElementById('thresholdColdness')?.value) || 10; // 次
    const tShallowRead = parseFloat(document.getElementById('thresholdTimeDegree')?.value) || 5; // 分钟
    const tForgetting = parseFloat(document.getElementById('thresholdForgetting')?.value) || 14; // 天
    
    // 计算 F (新鲜度): 添加时间越近，F值越高
    // F 高 = 新书签，F 低 = 老书签
    // 考古模式 freshness 权重低，巩固模式权重高
    const daysSinceAdded = (now - bookmarkStats.dateAdded) / (1000 * 60 * 60 * 24);
    const F = calculateFactorValue(daysSinceAdded, tFreshness, true); // inverse=true: 天数少=F高=新书签
    
    // 计算 C (冷门度): 点击次数越少，值越高
    const C = calculateFactorValue(bookmarkStats.visitCount, tColdness, true);
    
    // 计算 T (时间度): 综合时间越短，值越高（表示还没深入阅读）
    // 综合时间 = 活跃时间 + 前台静止时间 × 0.8
    const compositeMs = bookmarkStats.compositeTimeMs || bookmarkStats.activeTimeMs || 0;
    const compositeMinutes = compositeMs / (1000 * 60);
    const T = calculateFactorValue(compositeMinutes, tShallowRead, true);
    
    // 计算 D (遗忘度): 未访问天数越多，值越高
    let daysSinceLastVisit = tForgetting; // 默认等于阈值
    if (bookmarkStats.lastVisitTime > 0) {
        daysSinceLastVisit = (now - bookmarkStats.lastVisitTime) / (1000 * 60 * 60 * 24);
    }
    const D = calculateFactorValue(daysSinceLastVisit, tForgetting, false);
    
    // 计算 L (待复习): 手动添加的书签 L=1，否则 L=0
    let L = 0;
    if (postponeData) {
        const postponeInfo = postponeData.find(p => p.bookmarkId === bookmark.id);
        if (postponeInfo && postponeInfo.manuallyAdded) {
            L = 1;
        }
    }
    
    // 计算加权优先级
    const priority = w1 * F + w2 * C + w3 * T + w4 * D + w5 * L;
    
    // 添加小量随机扰动避免完全相同的优先级
    const randomFactor = (Math.random() - 0.5) * 0.05;
    const finalPriority = Math.max(0, Math.min(1, priority + randomFactor));
    
    // 调试日志（只对前几个书签输出）
    if (Math.random() < 0.05) { // 5%采样率
        console.log('[权重计算]', bookmark.title?.substring(0, 20), 
            'P=', finalPriority.toFixed(3),
            'F=', F.toFixed(2), 'C=', C.toFixed(2), 'T=', T.toFixed(2), 'D=', D.toFixed(2), 'L=', L);
    }
    
    return {
        priority: finalPriority,
        factors: { F, C, T, D, L },
        weights: { w1, w2, w3, w4, w5 }
    };
}

// =============================================================================
// Phase 4.1: 复习曲线（简化版SM-2）
// =============================================================================

// 获取复习数据
async function getReviewData() {
    try {
        const result = await browserAPI.storage.local.get('recommend_reviews');
        return result.recommend_reviews || {};
    } catch (e) {
        console.error('[复习] 获取复习数据失败:', e);
        return {};
    }
}

// 记录一次复习
async function recordReview(bookmarkId) {
    try {
        const reviews = await getReviewData();
        const existing = reviews[bookmarkId];
        const now = Date.now();
        
        // 如果是手动添加的书签，复习后清除标记
        const postponed = await getPostponedBookmarks();
        const postponeInfo = postponed.find(p => p.bookmarkId === bookmarkId);
        if (postponeInfo && postponeInfo.manuallyAdded) {
            postponeInfo.manuallyAdded = false;
            await browserAPI.storage.local.set({ recommend_postponed: postponed });
            console.log('[复习] 已清除手动添加标记:', bookmarkId);
        }
        
        if (existing) {
            // 简化版SM-2：每次复习间隔翻倍，最大30天
            const newInterval = Math.min(existing.interval * 2, 30);
            reviews[bookmarkId] = {
                lastReview: now,
                interval: newInterval,
                reviewCount: existing.reviewCount + 1,
                nextReview: now + newInterval * 24 * 60 * 60 * 1000
            };
        } else {
            // 首次复习，间隔1天
            reviews[bookmarkId] = {
                lastReview: now,
                interval: 1,
                reviewCount: 1,
                nextReview: now + 1 * 24 * 60 * 60 * 1000
            };
        }
        
        await browserAPI.storage.local.set({ recommend_reviews: reviews });
        console.log('[复习] 已记录复习:', bookmarkId, '下次间隔:', reviews[bookmarkId].interval, '天');
        return reviews[bookmarkId];
    } catch (e) {
        console.error('[复习] 记录复习失败:', e);
        return null;
    }
}

// 获取书签的复习状态
function getReviewStatus(bookmarkId, reviewData) {
    const review = reviewData[bookmarkId];
    if (!review) return { status: 'new', label: '新书签' };
    
    const now = Date.now();
    const daysSinceReview = (now - review.lastReview) / (1000 * 60 * 60 * 24);
    
    if (now >= review.nextReview) {
        return { status: 'due', label: '待复习', priority: 1.2 };
    } else if (daysSinceReview >= review.interval * 0.7) {
        return { status: 'soon', label: '即将到期', priority: 1.1 };
    } else {
        return { status: 'reviewed', label: '已复习', priority: 0.8 };
    }
}

// 计算带复习状态的优先级（用于保存的卡片恢复）
function calculatePriorityWithReview(basePriority, bookmarkId, reviewData, postponeData) {
    let priority = basePriority;
    
    // 复习状态加成
    const reviewStatus = getReviewStatus(bookmarkId, reviewData);
    priority *= reviewStatus.priority || 1.0;
    
    // 惩罚因子：被多次推迟的书签降低优先级（不影响手动添加的）
    if (postponeData) {
        const postponeInfo = postponeData.find(p => p.bookmarkId === bookmarkId);
        if (postponeInfo && !postponeInfo.manuallyAdded && postponeInfo.postponeCount > 0) {
            const penaltyFactor = Math.pow(0.9, postponeInfo.postponeCount);
            priority *= penaltyFactor;
        }
    }
    
    return Math.min(priority, 1.5); // 最高1.5
}

// 排行榜刷新计数器（每10次刷新排行榜一次，即每10秒）
let rankingRefreshCounter = 0;

// 启动时间捕捉实时刷新
function startTrackingRefresh() {
    // 清除已有定时器
    if (trackingRefreshInterval) {
        clearInterval(trackingRefreshInterval);
    }
    
    rankingRefreshCounter = 0;
    
    // 只在书签记录视图的时间捕捉标签中刷新
    trackingRefreshInterval = setInterval(() => {
        if (currentView === 'additions') {
            const trackingPanel = document.getElementById('additionsTrackingPanel');
            if (trackingPanel && trackingPanel.classList.contains('active')) {
                loadCurrentTrackingSessions();
                // 排行榜每10秒刷新一次（数据来自 IndexedDB，变化较慢）
                rankingRefreshCounter++;
                if (rankingRefreshCounter >= 10) {
                    rankingRefreshCounter = 0;
                    loadActiveTimeRanking();
                }
            }
        }
    }, TRACKING_REFRESH_INTERVAL);
}

// 停止实时刷新
function stopTrackingRefresh() {
    if (trackingRefreshInterval) {
        clearInterval(trackingRefreshInterval);
        trackingRefreshInterval = null;
    }
}

// 刷新推荐卡片（三卡并排）
// 获取已翻过的书签ID列表
async function getFlippedBookmarks() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['flippedBookmarks'], (result) => {
            resolve(result.flippedBookmarks || []);
        });
    });
}

// 标记书签为已翻过，并记录翻牌时间
async function markBookmarkFlipped(bookmarkId) {
    console.log('[翻牌] 标记书签:', bookmarkId);
    
    const flipped = await getFlippedBookmarks();
    if (!flipped.includes(bookmarkId)) {
        flipped.push(bookmarkId);
        await browserAPI.storage.local.set({ flippedBookmarks: flipped });
        console.log('[翻牌] flippedBookmarks 已更新:', flipped.length, '个');
    }
    
    // 记录翻牌时间（用于热力图）
    const result = await new Promise(resolve => {
        browserAPI.storage.local.get(['flipHistory'], resolve);
    });
    const flipHistory = result.flipHistory || [];
    flipHistory.push({
        bookmarkId,
        timestamp: Date.now()
    });
    await browserAPI.storage.local.set({ flipHistory });
    console.log('[翻牌] flipHistory 已更新:', flipHistory.length, '条记录');
    
    // 立即刷新热力图
    if (currentView === 'recommend') {
        await loadHeatmapData();
    }
}

async function refreshRecommendCards(force = false) {
    const cardsRow = document.getElementById('cardsRow');
    if (!cardsRow) return;
    
    const cards = cardsRow.querySelectorAll('.recommend-card');
    
    // 清除所有卡片的 flipped 状态
    cards.forEach(card => card.classList.remove('flipped'));
    
    try {
        // 获取所有书签（用于后续查找）
        const bookmarks = await new Promise((resolve) => {
            browserAPI.bookmarks.getTree((tree) => {
                const allBookmarks = [];
                function traverse(nodes) {
                    for (const node of nodes) {
                        if (node.url) {
                            allBookmarks.push(node);
                        }
                        if (node.children) {
                            traverse(node.children);
                        }
                    }
                }
                traverse(tree);
                resolve(allBookmarks);
            });
        });
        const bookmarkMap = new Map(bookmarks.map(b => [b.id, b]));
        
        // 检查是否有已保存的卡片状态（与popup共享）
        const currentCards = await getHistoryCurrentCards();
        const postponed = await getPostponedBookmarks();
        const reviewData = await getReviewData();
        
        // 如果有保存的卡片且不是全部勾选且不是强制刷新，则显示保存的卡片
        if (currentCards && currentCards.cardIds && currentCards.cardIds.length > 0 && !force) {
            const allFlipped = currentCards.cardIds.every(id => currentCards.flippedIds.includes(id));
            
            if (!allFlipped) {
                // 获取保存卡片的统计数据，重新计算优先级
                const savedBookmarks = currentCards.cardIds.map(id => bookmarkMap.get(id)).filter(Boolean);
                const savedStats = await batchGetBookmarkStats(savedBookmarks);
                
                // 显示保存的卡片（重新计算优先级）
                recommendCards = savedBookmarks.map(bookmark => {
                    const { priority, factors } = calculateWeightedPriority(bookmark, savedStats, postponed);
                    const reviewStatus = getReviewStatus(bookmark.id, reviewData);
                    let finalPriority = priority;
                    if (reviewStatus.priority) {
                        finalPriority *= reviewStatus.priority;
                    }
                    return { ...bookmark, priority: finalPriority, factors, reviewStatus };
                });
                
                // 更新卡片显示（复用下面的逻辑）
                cards.forEach((card, index) => {
                    if (index < recommendCards.length) {
                        const bookmark = recommendCards[index];
                        updateCardDisplay(card, bookmark, currentCards.flippedIds.includes(bookmark.id));
                    } else {
                        setCardEmpty(card);
                    }
                });
                return;
            }
        }
        
        // 获取已翻过的书签
        const flippedBookmarks = await getFlippedBookmarks();
        const flippedSet = new Set(flippedBookmarks);
        
        // 获取已屏蔽的书签、文件夹、域名
        const blocked = await getBlockedBookmarks();
        const blockedBookmarkSet = new Set(blocked.bookmarks);
        const blockedFolderSet = new Set(blocked.folders);
        const blockedDomainSet = new Set(blocked.domains);
        
        // 获取稍后复习的书签（未到期的，但手动添加的不排除）
        const now = Date.now();
        const postponedSet = new Set(
            postponed.filter(p => p.postponeUntil > now && !p.manuallyAdded).map(p => p.bookmarkId)
        );
        
        // 获取手动添加的书签ID集合（用于优先推荐）
        const manuallyAddedSet = new Set(
            postponed.filter(p => p.manuallyAdded).map(p => p.bookmarkId)
        );
        
        // 检查书签是否在屏蔽的文件夹中
        const isInBlockedFolder = (bookmark) => {
            if (blockedFolderSet.size === 0) return false;
            let parentId = bookmark.parentId;
            while (parentId) {
                if (blockedFolderSet.has(parentId)) return true;
                // 获取父文件夹的parentId（这里简化处理，只检查直接父级）
                break;
            }
            return false;
        };
        
        // 检查书签是否在屏蔽的域名中
        const isBlockedDomain = (bookmark) => {
            if (blockedDomainSet.size === 0 || !bookmark.url) return false;
            try {
                const url = new URL(bookmark.url);
                return blockedDomainSet.has(url.hostname);
            } catch {
                return false;
            }
        };
        
        // 过滤掉已翻过、已跳过、已屏蔽（书签/文件夹/域名）、稀后复习（未到期且非手动添加）的书签
        const availableBookmarks = bookmarks.filter(b => 
            !flippedSet.has(b.id) && 
            !skippedBookmarks.has(b.id) && 
            !blockedBookmarkSet.has(b.id) &&
            !isInBlockedFolder(b) &&
            !isBlockedDomain(b) &&
            !postponedSet.has(b.id)
        );
        
        if (availableBookmarks.length === 0) {
            // 清除保存的卡片状态
            await saveHistoryCurrentCards([], []);
            cards.forEach((card) => {
                card.classList.add('empty');
                card.querySelector('.card-title').textContent = 
                    currentLang === 'en' ? 'All bookmarks reviewed!' : '所有书签都已翻阅！';
                card.querySelector('.card-priority').textContent = '';
                card.onclick = null;
            });
            return;
        }
        
        // 批量获取书签统计数据（用于权重计算）
        // 只获取前100个候选书签的统计数据以优化性能
        const candidateBookmarks = availableBookmarks.slice(0, 100);
        const bookmarkStats = await batchGetBookmarkStats(candidateBookmarks);
        
        // 使用权重公式计算每个书签的优先级
        // P = w1×F + w2×C + w3×S + w4×D + w5×L
        const bookmarksWithPriority = candidateBookmarks.map(b => {
            const { priority, factors } = calculateWeightedPriority(b, bookmarkStats, postponed);
            const reviewStatus = getReviewStatus(b.id, reviewData);
            
            // 复习状态加成（待复习的书签额外提升）
            let finalPriority = priority;
            if (reviewStatus.priority) {
                finalPriority *= reviewStatus.priority;
            }
            
            return { ...b, priority: finalPriority, factors, reviewStatus };
        });
        
        // 按优先级排序（高优先级在前），然后取前3个
        bookmarksWithPriority.sort((a, b) => b.priority - a.priority);
        recommendCards = bookmarksWithPriority.slice(0, 3);
        
        // 保存新的卡片状态
        const newCardIds = recommendCards.map(b => b.id);
        await saveHistoryCurrentCards(newCardIds, []);
        
        // 预加载当前3个 + 下一批6个的 favicon（并行）
        const urlsToPreload = bookmarksWithPriority.slice(0, 9).map(b => b.url).filter(Boolean);
        preloadHighResFavicons(urlsToPreload);
        
        // 异步保存favicon URLs到storage（供popup使用，不阻塞UI）
        saveCardFaviconsToStorage(recommendCards);
        
        // 更新卡片显示
        cards.forEach((card, index) => {
            if (index < recommendCards.length) {
                const bookmark = recommendCards[index];
                updateCardDisplay(card, bookmark, false);
            } else {
                setCardEmpty(card);
            }
        });
        
        // 更新刷新时间（手动刷新时）
        if (force) {
            const settings = await getRefreshSettings();
            settings.lastRefreshTime = Date.now();
            settings.openCountSinceRefresh = 0;
            await saveRefreshSettings(settings);
            console.log('[刷新] 已更新刷新时间');
        }
        
    } catch (error) {
        console.error('[书签推荐] 刷新卡片失败:', error);
        cards.forEach(card => {
            card.classList.add('empty');
            card.querySelector('.card-title').textContent = 
                currentLang === 'en' ? 'Load failed' : '加载失败';
        });
    }
}

// 缓存当前追踪列表的会话 ID，用于判断是否需要完整刷新
let lastTrackingSessionIds = [];

async function loadCurrentTrackingSessions() {
    const trackingCurrentList = document.getElementById('trackingCurrentList');
    const trackingCurrentCount = document.getElementById('trackingCurrentCount');
    if (!trackingCurrentList) return;
    
    try {
        const response = await browserAPI.runtime.sendMessage({ 
            action: 'getCurrentActiveSessions' 
        });
        
        if (response && response.success && response.sessions) {
            const sessions = response.sessions;
            
            // 更新计数
            if (trackingCurrentCount) {
                trackingCurrentCount.textContent = sessions.length;
            }
            
            if (sessions.length === 0) {
                lastTrackingSessionIds = [];
                trackingCurrentList.innerHTML = `
                    <tr class="tracking-empty-row">
                        <td colspan="5">${i18n.trackingNoActive[currentLang]}</td>
                    </tr>
                `;
                return;
            }
            
            // 检查会话列表是否有变化（新增/删除会话）
            const currentIds = sessions.map(s => s.tabId).sort().join(',');
            const lastIds = lastTrackingSessionIds.sort().join(',');
            const needsFullRender = currentIds !== lastIds;
            
            // 截断标题函数
            const truncateTitle = (title, maxLen = 45) => {
                if (!title) return '';
                return title.length > maxLen ? title.substring(0, maxLen) + '...' : title;
            };
            
            if (needsFullRender) {
                // 会话列表有变化，需要完整渲染
                lastTrackingSessionIds = sessions.map(s => s.tabId);
                
                trackingCurrentList.innerHTML = sessions.map(session => {
                    const compositeTime = formatActiveTime(session.compositeMs || session.activeMs);
                    const activeRatio = Math.round(session.activeRatio * 100);
                    const stateIcon = session.state === 'active' ? '🟢' : 
                        (session.state === 'sleeping' ? '💤' : 
                        (session.state === 'background' ? '⚪' : 
                        (session.state === 'visible' ? '🔵' : '🟡')));
                    const idleTag = session.isIdle ? 
                        `<span class="idle-tag">⚠${i18n.trackingIdle[currentLang]}</span>` : '';
                    const displayTitle = truncateTitle(session.title || session.url);
                    const faviconUrl = getFaviconUrl(session.url);
                    
                    return `
                        <tr data-tab-id="${session.tabId}" data-bookmark-url="${escapeHtml(session.url)}">
                            <td><span class="tracking-state">${stateIcon}</span></td>
                            <td>
                                <div class="tracking-title-cell">
                                    <img class="tracking-favicon" src="${faviconUrl}" alt="">
                                    <span class="tracking-title" title="${escapeHtml(session.title || session.url)}">${escapeHtml(displayTitle)}</span>
                                </div>
                            </td>
                            <td><span class="tracking-time">${compositeTime}</span></td>
                            <td><span class="tracking-wakes">${session.wakeCount || 0}${currentLang === 'en' ? 'x' : '次'}</span></td>
                            <td>
                                <div class="tracking-ratio-cell">
                                    <span class="tracking-ratio">${activeRatio}%</span>
                                    ${idleTag}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
                
                // 点击切换到对应标签页
                trackingCurrentList.querySelectorAll('tr[data-tab-id]').forEach(item => {
                    item.addEventListener('click', () => {
                        const tabId = parseInt(item.dataset.tabId);
                        if (tabId) {
                            browserAPI.tabs.update(tabId, { active: true });
                        }
                    });
                });
            } else {
                // 会话列表没变，只更新时间、状态等动态数据（不重新渲染 favicon）
                sessions.forEach(session => {
                    const row = trackingCurrentList.querySelector(`tr[data-tab-id="${session.tabId}"]`);
                    if (row) {
                        const compositeTime = formatActiveTime(session.compositeMs || session.activeMs);
                        const activeRatio = Math.round(session.activeRatio * 100);
                        const stateIcon = session.state === 'active' ? '🟢' : 
                            (session.state === 'sleeping' ? '💤' : 
                            (session.state === 'background' ? '⚪' : 
                            (session.state === 'visible' ? '🔵' : '🟡')));
                        
                        // 更新状态图标
                        const stateEl = row.querySelector('.tracking-state');
                        if (stateEl) stateEl.textContent = stateIcon;
                        
                        // 更新时间
                        const timeEl = row.querySelector('.tracking-time');
                        if (timeEl) timeEl.textContent = compositeTime;
                        
                        // 更新唤醒次数
                        const wakesEl = row.querySelector('.tracking-wakes');
                        if (wakesEl) wakesEl.textContent = `${session.wakeCount || 0}${currentLang === 'en' ? 'x' : '次'}`;
                        
                        // 更新活跃率
                        const ratioEl = row.querySelector('.tracking-ratio');
                        if (ratioEl) ratioEl.textContent = `${activeRatio}%`;
                    }
                });
            }
        }
    } catch (error) {
        console.warn('[书签推荐] 加载追踪会话失败:', error);
    }
}

// HTML 转义函数
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

// =============================================================================
// 复习热力图 (GitHub 风格，当前月份在左)
// =============================================================================

async function loadHeatmapData() {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;
    
    try {
        // 从 storage 获取翻牌历史记录
        const result = await new Promise(resolve => {
            browserAPI.storage.local.get(['flipHistory'], resolve);
        });
        const flipHistory = result.flipHistory || [];
        
        // 按日期统计翻牌次数
        const dailyCounts = new Map();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 辅助函数：获取本地日期字符串 (YYYY-MM-DD)
        const getLocalDateKey = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        // 初始化最近 52 周 + 本周的天数
        const daysToShow = 52 * 7 + today.getDay();
        for (let i = daysToShow - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const key = getLocalDateKey(date);
            dailyCounts.set(key, 0);
        }
        
        // 统计每天的翻牌次数
        for (const flip of flipHistory) {
            if (!flip.timestamp) continue;
            const date = new Date(flip.timestamp);
            const key = getLocalDateKey(date);
            if (dailyCounts.has(key)) {
                dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
            }
        }
        
        // 渲染热力图（反转顺序，当前月份在左）
        renderHeatmap(container, dailyCounts);
        
    } catch (error) {
        console.error('[热力图] 加载失败:', error);
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">${
            currentLang === 'en' ? 'Failed to load heatmap' : '热力图加载失败'
        }</div></div>`;
    }
}

function renderHeatmap(container, dailyCounts) {
    const isEn = currentLang === 'en';
    const dayNames = isEn ? ['', 'Mon', '', 'Wed', '', 'Fri', ''] :
                           ['', '一', '', '三', '', '五', ''];
    const monthNames = isEn ? 
        ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] :
        ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    
    // 找出最大值用于计算颜色深度
    const counts = Array.from(dailyCounts.values());
    const maxCount = Math.max(...counts, 1);
    const totalReviews = counts.reduce((a, b) => a + b, 0);
    
    // 计算今天的复习次数
    const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    const todayReviews = dailyCounts.get(todayKey) || 0;
    
    // 按月分组数据
    const monthsData = new Map(); // year-month -> { year, month, days: [], totalCount }
    const entries = Array.from(dailyCounts.entries()).sort();
    
    for (const [dateStr, count] of entries) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        const monthKey = `${year}-${month}`;
        
        if (!monthsData.has(monthKey)) {
            monthsData.set(monthKey, { year, month, days: [], totalCount: 0 });
        }
        
        monthsData.get(monthKey).days.push({ date: dateStr, count, dayOfWeek, day });
        monthsData.get(monthKey).totalCount += count;
    }
    
    // 构建显示顺序：当前月 + 今年12个月(1-12正序)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    const monthsArray = [];
    
    // 第一个：当前月份
    const currentMonthKey = `${currentYear}-${currentMonth}`;
    const currentMonthData = monthsData.get(currentMonthKey) || { year: currentYear, month: currentMonth, days: [], totalCount: 0 };
    monthsArray.push(currentMonthData);
    
    // 后面12个：今年1月、2月、3月...12月（正序）
    for (let m = 1; m <= 12; m++) {
        const key = `${currentYear}-${m}`;
        const data = monthsData.get(key) || { year: currentYear, month: m, days: [], totalCount: 0 };
        monthsArray.push(data);
    }
    
    console.log('[热力图] 月份顺序:', monthsArray.map(m => m.month).join(', '));
    
    // 生成 HTML
    let html = `<div class="heatmap-year-view">`;
    html += `<div class="heatmap-scroll-container">`;
    html += `<div class="heatmap-months-row">`;
    
    for (let idx = 0; idx < monthsArray.length; idx++) {
        const monthData = monthsArray[idx];
        const { year, month, days, totalCount } = monthData;
        const monthLabel = monthNames[month - 1];
        
        // idx=1 时在当前月份后添加分隔线，后面每3个月添加分隔线
        if (idx === 1) {
            // 当前月份与12个月之间的分隔线
            html += `<div class="heatmap-quarter-divider current-divider"></div>`;
        } else if (idx > 1 && (idx - 1) % 3 === 0) {
            // 12个月内部的季度分隔线（4月、7月、10月前）
            html += `<div class="heatmap-quarter-divider"></div>`;
        }
        
        // 获取一周开始日(中文:周一=1, 英文:周日=0)，与书签添加记录日历保持一致
        const weekStartDay = (typeof currentLang !== 'undefined' && currentLang === 'zh_CN') ? 1 : 0;
        
        // 获取这个月第一天是星期几
        const firstDay = new Date(year, month - 1, 1);
        const firstDayOfWeek = firstDay.getDay();
        
        // 获取这个月的天数
        const daysInMonth = new Date(year, month, 0).getDate();
        const dayCountMap = new Map(days.map(d => [d.day, d]));
        
        // 构建日历网格（横向7列）
        const calendarDays = [];
        
        // 填充第一行前面的空白（根据周开始日调整）
        const blankCells = (firstDayOfWeek - weekStartDay + 7) % 7;
        for (let i = 0; i < blankCells; i++) {
            calendarDays.push({ empty: true });
        }
        
        // 填充每一天
        for (let d = 1; d <= daysInMonth; d++) {
            const dayData = dayCountMap.get(d);
            if (dayData) {
                calendarDays.push(dayData);
            } else {
                calendarDays.push({ date: `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, count: 0, day: d });
            }
        }
        
        // 填充最后一行的空白
        while (calendarDays.length % 7 !== 0) {
            calendarDays.push({ empty: true });
        }
        
        // 判断是否是当前月份
        const isCurrentMonth = year === currentYear && month === currentMonth;
        const currentClass = isCurrentMonth ? ' current-month' : '';
        
        html += `<div class="heatmap-month-block${currentClass}" data-year="${year}" data-month="${month}">`;
        html += `<div class="heatmap-month-header">${monthLabel}</div>`;
        html += `<div class="heatmap-calendar">`;
        
        // 当天日期字符串，用于判断是否高亮
        const todayStr = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        
        // 按行输出（每行7个）
        for (let i = 0; i < calendarDays.length; i += 7) {
            html += '<div class="heatmap-row">';
            for (let j = 0; j < 7; j++) {
                const day = calendarDays[i + j];
                if (!day || day.empty) {
                    html += '<div class="heatmap-cell empty"></div>';
                } else {
                    // 固定阈值：0 / 1-15 / 16-50 / 51-150 / 151+
                    const level = day.count === 0 ? 0 : 
                                  day.count <= 15 ? 1 :
                                  day.count <= 50 ? 2 :
                                  day.count <= 150 ? 3 : 4;
                    // 判断是否是当天
                    const isToday = day.date === todayStr;
                    const todayClass = isToday ? ' today' : '';
                    if (day.count > 0) {
                        const [y, m, dd] = day.date.split('-').map(Number);
                        const tooltip = isEn ? 
                            `${day.count} review${day.count !== 1 ? 's' : ''}, ${m}-${dd}` :
                            `${day.count}次, ${m}-${dd}`;
                        html += `<div class="heatmap-cell level-${level}${todayClass}" data-date="${day.date}" data-tooltip="${tooltip}"></div>`;
                    } else {
                        html += `<div class="heatmap-cell level-0${todayClass}" data-date="${day.date}"></div>`;
                    }
                }
            }
            html += '</div>';
        }
        
        html += `</div>`;
        html += `<div class="heatmap-month-count">${totalCount}</div>`;
        html += `</div>`;
    }
    
    html += `</div></div>`;
    
    // 底部统计和图例
    html += `
        <div class="heatmap-footer">
            <span class="heatmap-stats">${isEn ? 'Today' : '今天'} ${todayReviews} ${isEn ? 'reviews' : '次'}</span>
            <div class="heatmap-footer-right">
                <div class="heatmap-legend">
                    <span>${isEn ? 'Less' : '少'}</span>
                    <div class="heatmap-cell level-0"></div>
                    <div class="heatmap-cell level-1"></div>
                    <div class="heatmap-cell level-2"></div>
                    <div class="heatmap-cell level-3"></div>
                    <div class="heatmap-cell level-4"></div>
                    <span>${isEn ? 'More' : '多'}</span>
                </div>
                <button class="heatmap-help-btn" id="heatmapHelpBtn" title="${isEn ? 'Level description' : '等级说明'}">
                    <i class="fas fa-question-circle"></i>
                </button>
            </div>
        </div>
    </div>`;
    
    container.innerHTML = html;
    
    // 确保滚动条在最左边，显示当前月份
    const scrollContainer = container.querySelector('.heatmap-scroll-container');
    if (scrollContainer) {
        scrollContainer.scrollLeft = 0;
    }
    
    // 创建或获取全局tooltip元素
    let globalTooltip = document.getElementById('heatmapGlobalTooltip');
    if (!globalTooltip) {
        globalTooltip = document.createElement('div');
        globalTooltip.id = 'heatmapGlobalTooltip';
        globalTooltip.className = 'heatmap-global-tooltip';
        document.body.appendChild(globalTooltip);
    }
    
    // 绑定日期格子点击事件和tooltip事件
    container.querySelectorAll('.heatmap-cell[data-date]').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', (e) => {
            e.stopPropagation();
            // 点击时隐藏tooltip
            globalTooltip.classList.remove('visible');
            const date = cell.dataset.date;
            showHeatmapDateDetail(date);
        });
        
        // 鼠标进入时显示tooltip
        cell.addEventListener('mouseenter', (e) => {
            const tooltipText = cell.dataset.tooltip;
            if (!tooltipText) return;
            
            // 先设置内容并临时显示以获取正确尺寸
            globalTooltip.textContent = tooltipText;
            globalTooltip.style.visibility = 'hidden';
            globalTooltip.style.display = 'block';
            
            // 计算位置：在cell正上方居中
            const rect = cell.getBoundingClientRect();
            const tooltipRect = globalTooltip.getBoundingClientRect();
            let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
            let top = rect.top - tooltipRect.height - 8;
            
            // 防止超出左右边界
            if (left < 5) left = 5;
            if (left + tooltipRect.width > window.innerWidth - 5) {
                left = window.innerWidth - tooltipRect.width - 5;
            }
            
            // 如果上方空间不够，显示在下方
            if (top < 5) {
                top = rect.bottom + 8;
            }
            
            globalTooltip.style.left = left + 'px';
            globalTooltip.style.top = top + 'px';
            globalTooltip.style.visibility = '';
            globalTooltip.style.display = '';
            globalTooltip.classList.add('visible');
        });
        
        // 鼠标离开时隐藏tooltip
        cell.addEventListener('mouseleave', () => {
            globalTooltip.classList.remove('visible');
        });
    });
    
    // 绑定月份点击事件（进入月视图）
    container.querySelectorAll('.heatmap-month-block').forEach(block => {
        block.style.cursor = 'pointer';
        block.addEventListener('click', (e) => {
            // 如果点击的是日期格子，不触发月份点击
            if (e.target.closest('.heatmap-cell[data-date]')) return;
            const year = parseInt(block.dataset.year);
            const month = parseInt(block.dataset.month);
            showHeatmapMonthDetail(year, month);
        });
    });
    
    // 绑定帮助按钮点击事件
    const helpBtn = document.getElementById('heatmapHelpBtn');
    if (helpBtn) {
        helpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showHeatmapLevelHelp(helpBtn);
        });
    }
}

// 显示热力图等级说明
function showHeatmapLevelHelp(anchorBtn) {
    const isEn = currentLang === 'en';
    
    // 如果已存在，先移除
    const existing = document.getElementById('heatmapLevelPopup');
    if (existing) {
        existing.remove();
        return;
    }
    
    const popup = document.createElement('div');
    popup.id = 'heatmapLevelPopup';
    popup.className = 'heatmap-level-popup';
    popup.innerHTML = `
        <div class="heatmap-level-title">${isEn ? 'Review Level' : '复习等级说明'}</div>
        <div class="heatmap-level-list">
            <div class="heatmap-level-row">
                <div class="heatmap-cell level-0"></div>
                <span>0 ${isEn ? 'reviews' : '次'}</span>
            </div>
            <div class="heatmap-level-row">
                <div class="heatmap-cell level-1"></div>
                <span>1-15 ${isEn ? 'reviews' : '次'}</span>
            </div>
            <div class="heatmap-level-row">
                <div class="heatmap-cell level-2"></div>
                <span>16-50 ${isEn ? 'reviews' : '次'}</span>
            </div>
            <div class="heatmap-level-row">
                <div class="heatmap-cell level-3"></div>
                <span>51-150 ${isEn ? 'reviews' : '次'}</span>
            </div>
            <div class="heatmap-level-row">
                <div class="heatmap-cell level-4"></div>
                <span>151+ ${isEn ? 'reviews' : '次'}</span>
            </div>
        </div>
    `;
    
    document.body.appendChild(popup);
    
    // 定位到按钮上方
    const rect = anchorBtn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    popup.style.right = (window.innerWidth - rect.right) + 'px';
    
    // 点击其他地方关闭
    const closeHandler = (e) => {
        if (!popup.contains(e.target) && e.target !== anchorBtn) {
            popup.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// 显示热力图日期详情（二级UI）
async function showHeatmapDateDetail(dateStr) {
    const isEn = currentLang === 'en';
    const container = document.getElementById('heatmapContainer');
    if (!container) return;
    
    // 获取翻牌历史
    const result = await new Promise(resolve => {
        browserAPI.storage.local.get(['flipHistory'], resolve);
    });
    const flipHistory = result.flipHistory || [];
    
    // 筛选当天的记录
    const dayRecords = flipHistory.filter(flip => {
        if (!flip.timestamp) return false;
        const date = new Date(flip.timestamp);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}` === dateStr;
    });
    
    // 获取书签信息
    const bookmarkMap = new Map();
    try {
        const tree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
        const flatten = (nodes) => {
            for (const node of nodes) {
                if (node.url) bookmarkMap.set(node.id, node);
                if (node.children) flatten(node.children);
            }
        };
        flatten(tree);
    } catch (e) {
        console.warn('[热力图] 获取书签失败:', e);
    }
    
    // 格式化日期
    const [year, month, day] = dateStr.split('-').map(Number);
    const dateLabel = isEn ? `${month}/${day}/${year}` : `${year}年${month}月${day}日`;
    
    // 生成详情HTML
    let html = `
        <div class="heatmap-detail-view">
            <div class="heatmap-detail-header">
                <button class="heatmap-back-btn" id="heatmapBackBtn">
                    <i class="fas fa-arrow-left"></i>
                    <span>${isEn ? 'Back' : '返回'}</span>
                </button>
                <span class="heatmap-detail-title">${dateLabel}</span>
                <span class="heatmap-detail-count">${dayRecords.length} ${isEn ? 'reviews' : '次复习'}</span>
            </div>
            <div class="heatmap-detail-list">
    `;
    
    if (dayRecords.length === 0) {
        html += `<div class="heatmap-detail-empty">${isEn ? 'No reviews on this day' : '当天没有复习记录'}</div>`;
    } else {
        // 按时间倒序排列
        dayRecords.sort((a, b) => b.timestamp - a.timestamp);
        
        for (const record of dayRecords) {
            const bookmark = bookmarkMap.get(record.bookmarkId);
            const time = new Date(record.timestamp);
            const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
            
            if (bookmark) {
                html += `
                    <div class="heatmap-detail-item" data-url="${escapeHtml(bookmark.url)}">
                        <img class="heatmap-detail-favicon" src="${getFaviconUrl(bookmark.url)}" onerror="this.src='icons/default-favicon.png'">
                        <div class="heatmap-detail-info">
                            <div class="heatmap-detail-item-title">${escapeHtml(bookmark.title || bookmark.url)}</div>
                            <div class="heatmap-detail-item-url">${escapeHtml(bookmark.url)}</div>
                        </div>
                        <span class="heatmap-detail-time">${timeStr}</span>
                    </div>
                `;
            } else {
                html += `
                    <div class="heatmap-detail-item deleted">
                        <i class="fas fa-bookmark heatmap-detail-favicon-icon"></i>
                        <div class="heatmap-detail-info">
                            <div class="heatmap-detail-item-title">${isEn ? 'Bookmark deleted' : '书签已删除'}</div>
                            <div class="heatmap-detail-item-url">ID: ${record.bookmarkId}</div>
                        </div>
                        <span class="heatmap-detail-time">${timeStr}</span>
                    </div>
                `;
            }
        }
    }
    
    html += `</div></div>`;
    
    container.innerHTML = html;
    
    // 绑定返回按钮
    document.getElementById('heatmapBackBtn').addEventListener('click', () => {
        loadHeatmapData();
    });
    
    // 绑定书签点击事件
    container.querySelectorAll('.heatmap-detail-item[data-url]').forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            const url = item.dataset.url;
            if (url) window.open(url, '_blank');
        });
    });
}

// 显示热力图月份详情（书签复习排行）
async function showHeatmapMonthDetail(year, month) {
    const isEn = currentLang === 'en';
    const container = document.getElementById('heatmapContainer');
    if (!container) return;
    
    // 获取翻牌历史
    const result = await new Promise(resolve => {
        browserAPI.storage.local.get(['flipHistory'], resolve);
    });
    const flipHistory = result.flipHistory || [];
    
    // 筛选当月的记录，按书签ID统计次数
    const bookmarkCountMap = new Map(); // bookmarkId -> { count, lastTime }
    for (const flip of flipHistory) {
        if (!flip.timestamp || !flip.bookmarkId) continue;
        const date = new Date(flip.timestamp);
        if (date.getFullYear() === year && date.getMonth() + 1 === month) {
            if (!bookmarkCountMap.has(flip.bookmarkId)) {
                bookmarkCountMap.set(flip.bookmarkId, { count: 0, lastTime: 0 });
            }
            const stat = bookmarkCountMap.get(flip.bookmarkId);
            stat.count++;
            if (flip.timestamp > stat.lastTime) stat.lastTime = flip.timestamp;
        }
    }
    
    // 获取书签信息
    const bookmarkMap = new Map();
    try {
        const tree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
        const flatten = (nodes) => {
            for (const node of nodes) {
                if (node.url) bookmarkMap.set(node.id, node);
                if (node.children) flatten(node.children);
            }
        };
        flatten(tree);
    } catch (e) {
        console.warn('[热力图] 获取书签失败:', e);
    }
    
    const monthNames = isEn ? 
        ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] :
        ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    const monthLabel = isEn ? `${monthNames[month - 1]} ${year}` : `${year}年${monthNames[month - 1]}`;
    
    const totalCount = Array.from(bookmarkCountMap.values()).reduce((sum, s) => sum + s.count, 0);
    
    // 按复习次数排序
    const sortedBookmarks = Array.from(bookmarkCountMap.entries())
        .sort((a, b) => b[1].count - a[1].count);
    
    // 生成详情HTML
    let html = `
        <div class="heatmap-detail-view">
            <div class="heatmap-detail-header">
                <button class="heatmap-back-btn" id="heatmapBackBtn">
                    <i class="fas fa-arrow-left"></i>
                    <span>${isEn ? 'Back' : '返回'}</span>
                </button>
                <span class="heatmap-detail-title">${monthLabel} ${isEn ? 'Ranking' : '复习排行'}</span>
                <span class="heatmap-detail-count">${totalCount} ${isEn ? 'reviews' : '次复习'}</span>
            </div>
            <div class="heatmap-detail-list">
    `;
    
    if (sortedBookmarks.length === 0) {
        html += `<div class="heatmap-detail-empty">${isEn ? 'No reviews this month' : '当月没有复习记录'}</div>`;
    } else {
        let rank = 0;
        for (const [bookmarkId, stat] of sortedBookmarks) {
            rank++;
            const bookmark = bookmarkMap.get(bookmarkId);
            
            if (bookmark) {
                html += `
                    <div class="heatmap-detail-item heatmap-ranking-item" data-url="${escapeHtml(bookmark.url)}">
                        <span class="heatmap-rank ${rank <= 3 ? 'top-' + rank : ''}">${rank}</span>
                        <img class="heatmap-detail-favicon" src="${getFaviconUrl(bookmark.url)}" onerror="this.src='icons/default-favicon.png'">
                        <div class="heatmap-detail-info">
                            <div class="heatmap-detail-item-title">${escapeHtml(bookmark.title || bookmark.url)}</div>
                            <div class="heatmap-detail-item-url">${escapeHtml(bookmark.url)}</div>
                        </div>
                        <span class="heatmap-review-count">${stat.count} ${isEn ? 'times' : '次'}</span>
                    </div>
                `;
            } else {
                html += `
                    <div class="heatmap-detail-item heatmap-ranking-item deleted">
                        <span class="heatmap-rank">${rank}</span>
                        <i class="fas fa-bookmark heatmap-detail-favicon-icon"></i>
                        <div class="heatmap-detail-info">
                            <div class="heatmap-detail-item-title">${isEn ? 'Bookmark deleted' : '书签已删除'}</div>
                            <div class="heatmap-detail-item-url">ID: ${bookmarkId}</div>
                        </div>
                        <span class="heatmap-review-count">${stat.count} ${isEn ? 'times' : '次'}</span>
                    </div>
                `;
            }
        }
    }
    
    html += `</div></div>`;
    
    container.innerHTML = html;
    
    // 绑定返回按钮
    document.getElementById('heatmapBackBtn').addEventListener('click', () => {
        loadHeatmapData();
    });
    
    // 绑定书签点击事件
    container.querySelectorAll('.heatmap-detail-item[data-url]').forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            const url = item.dataset.url;
            if (url) window.open(url, '_blank');
        });
    });
}

// =============================================================================
// 综合时间排行
// =============================================================================

async function loadActiveTimeRanking() {
    const container = document.getElementById('trackingRankingList');
    if (!container) return;
    
    console.log('[时间排行] 开始加载...');
    
    try {
        // 获取时间范围
        const rangeSelect = document.getElementById('trackingRankingRange');
        const range = rangeSelect ? rangeSelect.value : 'week';
        console.log('[时间排行] 时间范围:', range);
        
        const now = Date.now();
        const today = new Date();
        let startTime;
        switch (range) {
            case 'today':
                // 当天：今天 0:00
                startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
                break;
            case 'week':
                // 本周：本周一 0:00
                const dayOfWeek = today.getDay();
                const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;  // 周日是0，需要回退6天
                const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysToMonday);
                startTime = monday.getTime();
                break;
            case 'month':
                // 本月：本月1号 0:00
                startTime = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
                break;
            case 'year':
                // 当年：今年1月1日 0:00
                startTime = new Date(today.getFullYear(), 0, 1).getTime();
                break;
            default:
                // 全部
                startTime = 0;
        }
        
        // 从 background.js 获取活跃会话数据
        console.log('[时间排行] 发送请求 getActiveSessions...');
        const response = await browserAPI.runtime.sendMessage({
            action: 'getActiveSessions',
            startTime,
            endTime: now
        });
        console.log('[时间排行] 响应:', response);
        
        if (!response || !response.success || !response.sessions) {
            console.log('[时间排行] 无数据或请求失败');
            container.innerHTML = `<div class="tracking-empty">${i18n.trackingNoData[currentLang]}</div>`;
            return;
        }
        
        console.log('[时间排行] 获取到', response.sessions.length, '条会话记录');
        
        // 按标题聚合综合时间（统一用标题作为 key）
        const titleStats = new Map();
        for (const session of response.sessions) {
            const key = session.title || session.url;  // 优先用标题
            if (!titleStats.has(key)) {
                titleStats.set(key, {
                    url: session.url,
                    title: session.title || session.url,
                    bookmarkId: session.bookmarkId,
                    totalCompositeMs: 0,
                    wakeCount: 0,
                    sessionCount: 0
                });
            }
            const stat = titleStats.get(key);
            // 使用综合时间：活跃×1.0 + 前台静止×0.8 + 可见参考×0.5 + 后台×0.1
            const sessionComposite = session.compositeMs || 
                ((session.activeMs || 0) + 
                 (session.idleFocusMs || session.pauseTotalMs || 0) * 0.8 +
                 (session.visibleMs || 0) * 0.5 +
                 (session.backgroundMs || 0) * 0.1);
            stat.totalCompositeMs += sessionComposite;
            stat.wakeCount += session.wakeCount || 0;
            stat.sessionCount++;
        }
        
        // 排序（按综合时间）
        const sorted = Array.from(titleStats.values())
            .sort((a, b) => b.totalCompositeMs - a.totalCompositeMs)
            .slice(0, 10);
        
        if (sorted.length === 0) {
            container.innerHTML = `<div class="tracking-empty">${i18n.trackingNoData[currentLang]}</div>`;
            return;
        }
        
        // 计算最大值用于进度条
        const maxMs = sorted[0].totalCompositeMs;
        
        // 截断标题函数
        const truncateTitle = (title, maxLen = 45) => {
            if (!title) return '';
            return title.length > maxLen ? title.substring(0, maxLen) + '...' : title;
        };
        
        // 渲染列表
        container.innerHTML = sorted.map((item, index) => {
            const compositeTime = formatActiveTime(item.totalCompositeMs);
            const barWidth = maxMs > 0 ? (item.totalCompositeMs / maxMs * 100) : 0;
            const displayTitle = truncateTitle(item.title || item.url);
            const faviconUrl = getFaviconUrl(item.url);
            
            return `
                <div class="tracking-ranking-item" data-url="${escapeHtml(item.url)}" data-bookmark-url="${escapeHtml(item.url)}">
                    <span class="ranking-number">${index + 1}</span>
                    <img class="ranking-favicon" src="${faviconUrl}" alt="">
                    <div class="ranking-info">
                        <div class="ranking-title" title="${escapeHtml(item.title || item.url)}">${escapeHtml(displayTitle)}</div>
                        <div class="ranking-bar">
                            <div class="ranking-bar-fill" style="width: ${barWidth}%"></div>
                        </div>
                    </div>
                    <span class="ranking-time">${compositeTime}</span>
                    <span class="ranking-wakes">${item.wakeCount}${currentLang === 'en' ? 'x' : '次'}</span>
                </div>
            `;
        }).join('');
        
        // 点击打开对应URL
        container.querySelectorAll('.tracking-ranking-item').forEach(item => {
            item.addEventListener('click', () => {
                const url = item.dataset.url;
                if (url) {
                    browserAPI.tabs.create({ url });
                }
            });
        });
        
    } catch (error) {
        console.error('[综合时间排行] 加载失败:', error);
        container.innerHTML = `<div class="tracking-empty">${i18n.trackingLoadFailed[currentLang]}</div>`;
    }
}

function formatActiveTime(ms) {
    if (!ms || ms < 0) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}



// =============================================================================
// 当前变化视图
// =============================================================================

// 带重试机制的渲染函数
async function renderCurrentChangesViewWithRetry(maxRetries = 3, forceRefresh = false) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`[渲染重试] 第 ${attempt}/${maxRetries} 次尝试`);

        // 第一次尝试使用forceRefresh参数，后续尝试也使用
        const shouldForceRefresh = forceRefresh || attempt === 1;

        // 尝试渲染
        await renderCurrentChangesView(shouldForceRefresh);

        // 检查是否需要重试
        const changeData = await getDetailedChanges(shouldForceRefresh);

        // 如果有数量变化，但没有详细列表，且不是最后一次尝试，则重试
        const hasQuantityChange = Boolean(changeData.diffMeta?.hasNumericalChange);
        const hasDetailedList = (changeData.added && changeData.added.length > 0) ||
            (changeData.deleted && changeData.deleted.length > 0) ||
            (changeData.moved && changeData.moved.length > 0);

        console.log(`[渲染重试] 检查结果:`, {
            attempt,
            hasQuantityChange,
            hasDetailedList,
            bookmarkDiff: changeData.diffMeta?.bookmarkDiff,
            deletedCount: changeData.deleted?.length || 0
        });

        // 如果有变化且有详细列表，或者没有变化，或者是最后一次尝试，则停止
        if (!hasQuantityChange || hasDetailedList || attempt === maxRetries) {
            console.log(`[渲染重试] 完成，不再重试`);
            break;
        }

        // 等待 300ms 后重试
        console.log(`[渲染重试] 等待 300ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
}

async function renderCurrentChangesView(forceRefresh = false) {
    const container = document.getElementById('currentChangesList');

    // 显示加载状态
    container.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;

    console.log('[当前变化视图] 开始加载...', forceRefresh ? '(强制刷新)' : '');

    try {
        // 从 background 获取详细变化数据
        const changeData = await getDetailedChanges(forceRefresh);

        console.log('[当前变化视图] 获取到的数据:', changeData);

        if (!changeData || !changeData.hasChanges) {
            // 没有变化
            console.log('[当前变化视图] 无变化');
            container.innerHTML = `
                <div class="no-changes-message">
                    <div class="no-changes-icon"><i class="fas fa-check-circle"></i></div>
                    <div class="no-changes-title">${i18n.noChanges[currentLang]}</div>
                    <div class="no-changes-desc">${i18n.noChangesDesc[currentLang]}</div>
                </div>
            `;
            return;
        }

        let html = '';

        const stats = changeData.stats || {};
        const diffMeta = changeData.diffMeta || {
            bookmarkDiff: stats.bookmarkDiff || 0,
            folderDiff: stats.folderDiff || 0,
            hasNumericalChange: stats.hasNumericalChange === true || (stats.bookmarkDiff !== 0 || stats.folderDiff !== 0),
            currentBookmarkCount: stats.currentBookmarkCount ?? stats.bookmarkCount ?? 0,
            currentFolderCount: stats.currentFolderCount ?? stats.folderCount ?? 0
        };

        const summary = buildChangeSummary(diffMeta, stats, currentLang);
        const hasQuantityChange = summary.hasQuantityChange;
        const hasStructureChange = summary.hasStructuralChange;

        if (hasQuantityChange || hasStructureChange) {
            // Git diff 风格的容器
            html += '<div class="git-diff-container">';

            // diff 头部
            html += '<div class="diff-header">';
            html += '<span class="diff-icon">📊</span>';
            html += `<span class="diff-title">${currentLang === 'zh_CN' ? '书签变化统计' : 'Bookmark Changes'}</span>`;
            html += `<span class="diff-stats">${summary.quantityTotalLine}</span>`;
            html += '</div>';

            // diff 主体
            html += '<div class="diff-body">';

            // 数量变化部分
            if (hasQuantityChange) {
                const bookmarkDiff = diffMeta.bookmarkDiff || 0;
                const folderDiff = diffMeta.folderDiff || 0;

                if (bookmarkDiff > 0) {
                    html += '<div class="diff-line added">';
                    html += '<span class="diff-prefix">+</span>';
                    html += `<span class="diff-content">${bookmarkDiff} ${currentLang === 'zh_CN' ? '个书签' : 'bookmarks'}</span>`;
                    html += '</div>';
                } else if (bookmarkDiff < 0) {
                    html += '<div class="diff-line deleted">';
                    html += '<span class="diff-prefix">-</span>';
                    html += `<span class="diff-content">${Math.abs(bookmarkDiff)} ${currentLang === 'zh_CN' ? '个书签' : 'bookmarks'}</span>`;
                    html += '</div>';
                }

                if (folderDiff > 0) {
                    html += '<div class="diff-line added">';
                    html += '<span class="diff-prefix">+</span>';
                    html += `<span class="diff-content">${folderDiff} ${currentLang === 'zh_CN' ? '个文件夹' : 'folders'}</span>`;
                    html += '</div>';
                } else if (folderDiff < 0) {
                    html += '<div class="diff-line deleted">';
                    html += '<span class="diff-prefix">-</span>';
                    html += `<span class="diff-content">${Math.abs(folderDiff)} ${currentLang === 'zh_CN' ? '个文件夹' : 'folders'}</span>`;
                    html += '</div>';
                }
            }

            // 结构变化部分
            if (hasStructureChange && summary.structuralItems && summary.structuralItems.length > 0) {
                summary.structuralItems.forEach(item => {
                    let diffClass = 'modified';
                    let prefix = '~';

                    if (item.includes('moved') || item.includes('移动')) {
                        diffClass = 'moved';
                        prefix = '↔';
                    } else if (item.includes('modified') || item.includes('修改')) {
                        diffClass = 'modified';
                        prefix = '~';
                    }

                    html += `<div class="diff-line ${diffClass}">`;
                    html += `<span class="diff-prefix">${prefix}</span>`;
                    html += `<span class="diff-content">${item}</span>`;
                    html += '</div>';
                });
            }

            // 如果没有任何变化
            if (!hasQuantityChange && !hasStructureChange) {
                html += '<div class="diff-line unchanged">';
                html += '<span class="diff-prefix">=</span>';
                html += `<span class="diff-content">${currentLang === 'zh_CN' ? '无变化' : 'No changes'}</span>`;
                html += '</div>';
            }

            html += '</div>'; // 结束 diff-body
            html += '</div>'; // 结束 git-diff-container
        }

        // 2. 智能分析书签变化 + 生成 Git diff
        browserAPI.storage.local.get(['lastBookmarkData'], async (lastData) => {
            // 获取当前书签树（working directory）
            browserAPI.bookmarks.getTree(async (currentTree) => {
                // 获取上次备份的书签树（HEAD / last commit）
                let oldTree = null;
                if (lastData.lastBookmarkData && lastData.lastBookmarkData.bookmarkTree) {
                    oldTree = lastData.lastBookmarkData.bookmarkTree;
                }

                // 按路径分别生成 diff（确保移动的书签在两个路径都显示）
                const oldLines = oldTree ? bookmarkTreeToLines(oldTree) : [];
                const newLines = bookmarkTreeToLines(currentTree);
                const groupedHunks = generateDiffByPath(oldLines, newLines);
                let diffHtml = '';

                if (groupedHunks.length === 0) {
                    diffHtml += `
                        <div class="no-changes-message" style="margin-top: 20px;">
                            <div class="no-changes-icon"><i class="fas fa-check-circle"></i></div>
                            <div class="no-changes-title">${currentLang === 'zh_CN' ? '无变化' : 'No Changes'}</div>
                        </div>
                    `;
                } else if (groupedHunks.length > 0) {
                    // 渲染 Git diff（带折叠）
                    diffHtml += '<div class="git-diff-viewer">';
                    diffHtml += '<div class="diff-file-header">';
                    diffHtml += '<span class="diff-file-path">diff --git a/bookmarks.html b/bookmarks.html</span>';
                    diffHtml += `<button class="copy-diff-btn" data-action="copyCurrentDiff" title="${currentLang === 'zh_CN' ? '复制Diff(Git格式)' : 'Copy Diff (Git format)'}">`;
                    diffHtml += '<i class="fas fa-copy"></i>';
                    diffHtml += `<span>${currentLang === 'zh_CN' ? '复制Diff' : 'Copy Diff'}</span>`;
                    diffHtml += '</button>';
                    diffHtml += '</div>';

                    let hunkIndex = 0;
                    groupedHunks.forEach((group, groupIdx) => {
                        diffHtml += '<div class="diff-folder-group">';

                        // 文件夹头部（面包屑导航样式）
                        diffHtml += `<div class="diff-folder-header-static">`;
                        diffHtml += renderBreadcrumb(group.path, currentLang);
                        diffHtml += '</div>';

                        group.hunks.forEach(hunk => {
                            const hunkId = `hunk-${hunkIndex++}`;
                            const hunkLines = hunk.contextBefore.length + hunk.changes.length + hunk.contextAfter.length;
                            const shouldCollapse = hunkLines > 15; // 超过15行的片段默认折叠

                            // 计算 +/- 统计
                            const addCount = hunk.changes.filter(c => c.type === 'add').length;
                            const deleteCount = hunk.changes.filter(c => c.type === 'delete').length;

                            diffHtml += '<div class="diff-hunk">';

                            // Hunk 头部（可点击折叠）
                            const iconClass = shouldCollapse ? 'fa-chevron-right' : 'fa-chevron-down';
                            diffHtml += `<div class="diff-hunk-header collapsible" data-hunk-id="${hunkId}">`;
                            diffHtml += `<i class="fas ${iconClass} collapse-icon" id="${hunkId}-icon"></i>`;
                            diffHtml += `<span class="hunk-location">@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@</span>`;
                            diffHtml += `<span class="hunk-stats">`;
                            if (addCount > 0) diffHtml += `<span class="stat-add">+${addCount}</span>`;
                            if (deleteCount > 0) diffHtml += `<span class="stat-delete">-${deleteCount}</span>`;
                            diffHtml += `</span>`;
                            diffHtml += '</div>';

                            // Hunk 内容（可折叠）
                            diffHtml += `<div class="diff-hunk-content ${shouldCollapse ? 'collapsed' : ''}" id="${hunkId}">`;

                            // 前置上下文
                            hunk.contextBefore.forEach(ctx => {
                                diffHtml += `<div class="diff-line-wrapper context">`;
                                diffHtml += `<span class="diff-line-num old">${ctx.oldIdx + 1}</span>`;
                                diffHtml += `<span class="diff-line-num new">${ctx.oldIdx + 1}</span>`;
                                diffHtml += `<span class="diff-line-prefix"> </span>`;
                                diffHtml += `<span class="diff-line-content">${escapeHtml(ctx.line.line)}</span>`;
                                diffHtml += `</div>`;
                            });

                            // 变化
                            hunk.changes.forEach(change => {
                                if (change.type === 'delete') {
                                    diffHtml += `<div class="diff-line-wrapper deleted">`;
                                    diffHtml += `<span class="diff-line-num old">${change.oldIdx + 1}</span>`;
                                    diffHtml += `<span class="diff-line-num new"></span>`;
                                    diffHtml += `<span class="diff-line-prefix">-</span>`;
                                    diffHtml += `<span class="diff-line-content">${escapeHtml(change.line.line)}</span>`;
                                    diffHtml += `</div>`;
                                } else if (change.type === 'add') {
                                    diffHtml += `<div class="diff-line-wrapper added">`;
                                    diffHtml += `<span class="diff-line-num old"></span>`;
                                    diffHtml += `<span class="diff-line-num new">${change.newIdx + 1}</span>`;
                                    diffHtml += `<span class="diff-line-prefix">+</span>`;
                                    diffHtml += `<span class="diff-line-content">${escapeHtml(change.line.line)}</span>`;
                                    diffHtml += `</div>`;
                                } else if (change.type === 'context') {
                                    diffHtml += `<div class="diff-line-wrapper context">`;
                                    diffHtml += `<span class="diff-line-num old">${change.oldIdx + 1}</span>`;
                                    diffHtml += `<span class="diff-line-num new">${change.newIdx + 1}</span>`;
                                    diffHtml += `<span class="diff-line-prefix"> </span>`;
                                    diffHtml += `<span class="diff-line-content">${escapeHtml(change.line.line)}</span>`;
                                    diffHtml += `</div>`;
                                }
                            });

                            // 后置上下文
                            hunk.contextAfter.forEach(ctx => {
                                diffHtml += `<div class="diff-line-wrapper context">`;
                                diffHtml += `<span class="diff-line-num old">${ctx.oldIdx + 1}</span>`;
                                diffHtml += `<span class="diff-line-num new">${ctx.oldIdx + 1}</span>`;
                                diffHtml += `<span class="diff-line-prefix"> </span>`;
                                diffHtml += `<span class="diff-line-content">${escapeHtml(ctx.line.line)}</span>`;
                                diffHtml += `</div>`;
                            });

                            diffHtml += '</div>'; // 结束 diff-hunk-content
                            diffHtml += '</div>'; // 结束 diff-hunk
                        });

                        diffHtml += '</div>'; // 结束 diff-folder-group
                    });

                    diffHtml += '</div>'; // 结束 git-diff-viewer
                }

                container.innerHTML = html + diffHtml;

                // 添加 hunk 折叠按钮事件监听器
                setTimeout(() => {
                    document.querySelectorAll('.diff-hunk-header.collapsible').forEach(header => {
                        const hunkId = header.getAttribute('data-hunk-id');
                        if (hunkId) {
                            header.addEventListener('click', function () {
                                toggleHunk(hunkId);
                            });
                        }
                    });
                }, 0);
            });
        });
    } catch (error) {
        console.error('加载变化数据失败:', error);
        container.innerHTML = `
            <div class="no-changes-message">
                <div class="no-changes-icon"><i class="fas fa-exclamation-circle"></i></div>
                <div class="no-changes-title">${currentLang === 'zh_CN' ? '加载失败' : 'Failed to Load'}</div>
                <div class="no-changes-desc">${error.message}</div>
            </div>
        `;
    }
}

// 获取详细变化数据 - 使用与状态卡片完全相同的逻辑
async function getDetailedChanges(forceRefresh = false) {
    return new Promise((resolve) => {
        console.log('[getDetailedChanges] 开始获取数据...', forceRefresh ? '(强制刷新)' : '(使用缓存)');

        // 使用和 popup.js 完全相同的逻辑：并行获取三个数据源
        Promise.all([
            // 1. 获取当前统计（支持强制刷新）
            new Promise((res, rej) => {
                browserAPI.runtime.sendMessage({
                    action: "getBackupStats",
                    forceRefresh: forceRefresh
                }, response => {
                    if (response && response.success) res(response);
                    else rej(new Error(response?.error || '获取备份统计失败'));
                });
            }),
            // 2. 获取备份历史
            new Promise((res, rej) => {
                browserAPI.runtime.sendMessage({ action: "getSyncHistory" }, response => {
                    if (response && response.success) res(response.syncHistory || []);
                    else rej(new Error(response?.error || '获取备份历史失败'));
                });
            }),
            // 3. 获取清空后的缓存记录
            new Promise((res) => {
                browserAPI.storage.local.get('cachedRecordAfterClear', result => {
                    res(result.cachedRecordAfterClear);
                });
            })
        ]).then(([backupResponse, syncHistory, cachedRecordFromStorage]) => {
            console.log('[getDetailedChanges] 获取到的完整数据:', {
                backupResponse,
                'stats对象': backupResponse.stats,
                syncHistoryLength: syncHistory.length,
                hasCachedRecord: !!cachedRecordFromStorage
            });

            const diffResult = calculateBookmarkFolderDiffs(
                backupResponse.stats,
                syncHistory,
                cachedRecordFromStorage
            );

            const bookmarkDiff = diffResult.bookmarkDiff || 0;
            const folderDiff = diffResult.folderDiff || 0;
            const hasNumericalChange = diffResult.hasNumericalChange === true;

            const hasStructuralChanges = backupResponse.stats.bookmarkMoved ||
                backupResponse.stats.folderMoved ||
                backupResponse.stats.bookmarkModified ||
                backupResponse.stats.folderModified;

            console.log('[getDetailedChanges] ✅ 直接使用 background 返回的差异（不再自己计算）:', {
                bookmarkDiff,
                folderDiff,
                hasStructuralChanges,
                '原始stats': {
                    bookmarkDiff: backupResponse.stats.bookmarkDiff,
                    folderDiff: backupResponse.stats.folderDiff
                }
            });

            // 检查是否有变化
            const hasChanges = hasNumericalChange || hasStructuralChanges;

            console.log('[getDetailedChanges] 是否有变化:', hasChanges);

            if (!hasChanges) {
                console.log('[getDetailedChanges] 无变化，返回');
                resolve({ hasChanges: false, stats: { ...backupResponse.stats, bookmarkDiff, folderDiff }, diffMeta: diffResult });
                return;
            }

            // 构造 stats 对象
            const stats = {
                ...backupResponse.stats,
                bookmarkDiff,
                folderDiff,
                diffSource: diffResult.diffSource,
                currentBookmarkCount: diffResult.currentBookmarkCount,
                currentFolderCount: diffResult.currentFolderCount,
                hasNumericalChange
            };

            // 获取指纹数据进行详细分析
            browserAPI.storage.local.get(['lastBookmarkData'], async (data) => {
                const lastData = data.lastBookmarkData;

                console.log('[getDetailedChanges] lastBookmarkData:', {
                    exists: !!lastData,
                    hasPrints: !!(lastData && lastData.bookmarkPrints),
                    printsCount: lastData?.bookmarkPrints?.length || 0,
                    timestamp: lastData?.timestamp || 'unknown'
                });

                if (!lastData || !lastData.bookmarkPrints) {
                    // 只有数量变化，无法获取详细列表
                    console.warn('[getDetailedChanges] 没有 lastBookmarkData，无法获取详细列表');
                    resolve({
                        hasChanges: true,
                        stats: stats,
                        diffMeta: diffResult,
                        added: [],
                        deleted: [],
                        moved: [],
                        modified: []
                    });
                    return;
                }

                // 获取当前书签树并生成指纹
                browserAPI.bookmarks.getTree(async (tree) => {
                    try {
                        const currentPrints = generateFingerprintsFromTree(tree);
                        const oldBookmarkPrints = new Set(lastData.bookmarkPrints || []);
                        const newBookmarkPrints = new Set(currentPrints.bookmarks);

                        const added = [];
                        const deleted = [];
                        const moved = [];
                        const modified = [];

                        // 解析新增和可能的移动
                        for (const print of newBookmarkPrints) {
                            if (!oldBookmarkPrints.has(print)) {
                                const bookmark = parseBookmarkFingerprint(print);
                                if (bookmark) {
                                    // 检查是否是移动
                                    let isMoved = false;
                                    for (const oldPrint of oldBookmarkPrints) {
                                        const oldBookmark = parseBookmarkFingerprint(oldPrint);
                                        if (oldBookmark && oldBookmark.url === bookmark.url) {
                                            if (oldBookmark.path !== bookmark.path || oldBookmark.title !== bookmark.title) {
                                                isMoved = true;
                                                moved.push({
                                                    ...bookmark,
                                                    oldPath: oldBookmark.path,
                                                    oldTitle: oldBookmark.title
                                                });
                                            }
                                            break;
                                        }
                                    }
                                    if (!isMoved) {
                                        added.push(bookmark);
                                    }
                                }
                            }
                        }

                        // 解析删除
                        for (const print of oldBookmarkPrints) {
                            if (!newBookmarkPrints.has(print)) {
                                const bookmark = parseBookmarkFingerprint(print);
                                if (bookmark) {
                                    const isInMoved = moved.some(m => m.url === bookmark.url);
                                    if (!isInMoved) {
                                        deleted.push(bookmark);
                                    }
                                }
                            }
                        }

                        console.log('变化分析结果:', {
                            added: added.length,
                            deleted: deleted.length,
                            moved: moved.length,
                            stats
                        });

                        resolve({
                            hasChanges: true,
                            stats,
                            diffMeta: diffResult,
                            added,
                            deleted,
                            moved,
                            modified
                        });
                    } catch (error) {
                        console.error('分析书签变化失败:', error);
                        resolve({
                            hasChanges: true,
                            stats: stats,
                            diffMeta: diffResult,
                            added: [],
                            deleted: [],
                            moved: [],
                            modified: []
                        });
                    }
                });
            });
        }).catch(error => {
            console.error('[getDetailedChanges] 获取数据失败:', error);
            resolve({ hasChanges: false, diffMeta: null, stats: null });
        });
    });
}

// 从书签树生成指纹
function generateFingerprintsFromTree(bookmarkNodes) {
    const bookmarkPrints = [];
    const folderPrints = [];

    function traverse(nodes, path) {
        if (!nodes) return;
        for (const node of nodes) {
            if (node.url) {
                const bookmarkFingerprint = `B:${path}|${node.title}|${node.url}`;
                bookmarkPrints.push(bookmarkFingerprint);
            } else if (node.children) {
                const currentPath = path ? `${path}/${node.title}` : node.title;
                let directBookmarkCount = 0;
                let directFolderCount = 0;
                for (const child of node.children) {
                    if (child.url) directBookmarkCount++;
                    else if (child.children) directFolderCount++;
                }
                const contentSignature = `c:${directBookmarkCount},${directFolderCount}`;
                const folderFingerprint = `F:${currentPath}|${contentSignature}`;
                folderPrints.push(folderFingerprint);
                traverse(node.children, currentPath);
            }
        }
    }

    if (bookmarkNodes && bookmarkNodes.length > 0 && bookmarkNodes[0].children) {
        traverse(bookmarkNodes[0].children, '');
    }

    return { bookmarks: bookmarkPrints, folders: folderPrints };
}

// 解析书签指纹
function parseBookmarkFingerprint(fingerprint) {
    // 格式: B:path|title|url
    if (!fingerprint || !fingerprint.startsWith('B:')) return null;

    const parts = fingerprint.substring(2).split('|');
    if (parts.length < 3) return null;

    return {
        path: parts[0],
        title: parts[1],
        url: parts[2]
    };
}

function groupBookmarksByFolder(bookmarks, lastBackupTime) {
    const result = {
        added: [],
        deleted: [],
        modified: [],
        moved: []
    };

    if (!lastBackupTime) {
        // 如果没有备份记录，所有书签都算新增
        result.added = bookmarks;
        return result;
    }

    // 找出新增的书签（添加时间晚于最后备份时间）
    bookmarks.forEach(bookmark => {
        if (bookmark.dateAdded > lastBackupTime) {
            result.added.push(bookmark);
        }
    });

    return result;
}

// 按路径分别生成 diff（确保移动的书签在两个路径都显示）
function generateDiffByPath(oldLines, newLines) {
    // 收集所有路径
    const allPaths = new Set();
    oldLines.forEach(line => {
        if (line.path) allPaths.add(line.path);
    });
    newLines.forEach(line => {
        if (line.path) allPaths.add(line.path);
    });

    const result = [];

    // 为每个路径单独生成 diff
    allPaths.forEach(path => {
        // 提取该路径下的行，保留全局索引
        const pathOldLines = [];
        const pathNewLines = [];

        oldLines.forEach((line, globalIdx) => {
            if (line.path === path || (!line.path && !path)) {
                // 保留全局索引
                pathOldLines.push({ ...line, globalIdx });
            }
        });

        newLines.forEach((line, globalIdx) => {
            if (line.path === path || (!line.path && !path)) {
                // 保留全局索引
                pathNewLines.push({ ...line, globalIdx });
            }
        });

        // 如果这个路径下有内容，生成 diff
        if (pathOldLines.length > 0 || pathNewLines.length > 0) {
            const hunks = generateGitDiff(pathOldLines, pathNewLines, true);

            if (hunks.length > 0) {
                result.push({
                    path: path,
                    hunks: hunks
                });
            }
        }
    });

    return result;
}

// 智能分析书签结构变化（移动、重命名、修改）
function analyzeStructuralChanges(oldTree, newTree) {
    const changes = {
        renamed: [],   // 重命名：{type: 'bookmark'|'folder', oldTitle, newTitle, url}
        moved: [],     // 移动：{type: 'bookmark'|'folder', title, oldPath, newPath, url}
        modified: []   // URL修改：{title, oldUrl, newUrl}
    };

    if (!oldTree) {
        return changes;
    }

    // 提取所有书签和文件夹的信息（带路径）
    const extractItems = (nodes, path = []) => {
        const items = { bookmarks: [], folders: [] };

        const traverse = (node, currentPath) => {
            if (!node) return;

            if (node.url) {
                // 书签
                items.bookmarks.push({
                    id: node.id,
                    title: node.title,
                    url: node.url,
                    path: currentPath.join(' > ')
                });
            } else if (node.children) {
                // 文件夹
                if (node.title) {  // 排除根节点
                    items.folders.push({
                        id: node.id,
                        title: node.title,
                        path: currentPath.join(' > ')
                    });
                }

                const newPath = node.title ? [...currentPath, node.title] : currentPath;
                node.children.forEach(child => traverse(child, newPath));
            }
        };

        nodes.forEach(node => traverse(node, path));
        return items;
    };

    const oldItems = extractItems(oldTree);
    const newItems = extractItems(newTree);

    // 1. 检测书签的重命名、移动、修改
    oldItems.bookmarks.forEach(oldBm => {
        // 通过 URL 匹配（URL 是书签的唯一标识）
        const newBm = newItems.bookmarks.find(n => n.url === oldBm.url);

        if (newBm) {
            // 书签存在
            if (oldBm.title !== newBm.title) {
                // 重命名
                changes.renamed.push({
                    type: 'bookmark',
                    oldTitle: oldBm.title,
                    newTitle: newBm.title,
                    url: oldBm.url
                });
            }
            if (oldBm.path !== newBm.path) {
                // 移动
                changes.moved.push({
                    type: 'bookmark',
                    title: newBm.title,
                    oldPath: oldBm.path,
                    newPath: newBm.path,
                    url: oldBm.url
                });
            }
        }
    });

    // 检测 URL 修改（通过标题匹配，但 URL 不同）
    oldItems.bookmarks.forEach(oldBm => {
        const newBm = newItems.bookmarks.find(n =>
            n.title === oldBm.title &&
            n.path === oldBm.path &&
            n.url !== oldBm.url
        );

        if (newBm) {
            changes.modified.push({
                title: oldBm.title,
                oldUrl: oldBm.url,
                newUrl: newBm.url
            });
        }
    });

    // 2. 检测文件夹的重命名、移动（简化版）
    oldItems.folders.forEach(oldFolder => {
        const newFolder = newItems.folders.find(n => n.title === oldFolder.title);

        if (newFolder && oldFolder.path !== newFolder.path) {
            changes.moved.push({
                type: 'folder',
                title: oldFolder.title,
                oldPath: oldFolder.path,
                newPath: newFolder.path
            });
        }
    });

    return changes;
}

// 渲染结构变化摘要
function renderStructuralChangesSummary(changes, lang) {
    const isZh = lang === 'zh_CN';
    let html = '<div class="structural-changes-summary">';
    html += `<div class="summary-header"><i class="fas fa-info-circle"></i> ${isZh ? '结构变化摘要' : 'Structural Changes'}</div>`;
    html += '<div class="summary-body">';

    // 重命名
    if (changes.renamed.length > 0) {
        html += '<div class="change-group">';
        html += `<div class="change-type"><i class="fas fa-pen"></i> ${isZh ? '重命名' : 'Renamed'} (${changes.renamed.length})</div>`;
        changes.renamed.slice(0, 5).forEach(item => {
            const icon = item.type === 'bookmark' ? '🔖' : '📁';
            html += `<div class="change-item">${icon} "${escapeHtml(item.oldTitle)}" → "${escapeHtml(item.newTitle)}"</div>`;
        });
        if (changes.renamed.length > 5) {
            html += `<div class="change-item-more">... ${isZh ? '等' : 'and'} ${changes.renamed.length - 5} ${isZh ? '项' : 'more'}</div>`;
        }
        html += '</div>';
    }

    // 移动
    if (changes.moved.length > 0) {
        html += '<div class="change-group">';
        html += `<div class="change-type"><i class="fas fa-arrows-alt"></i> ${isZh ? '移动' : 'Moved'} (${changes.moved.length})</div>`;
        changes.moved.slice(0, 5).forEach(item => {
            const icon = item.type === 'bookmark' ? '🔖' : '📁';
            html += `<div class="change-item">${icon} "${escapeHtml(item.title)}"<br>`;
            html += `<span style="margin-left: 20px; font-size: 0.9em; color: var(--text-tertiary);">`;
            html += `${escapeHtml(item.oldPath || 'Root')} → ${escapeHtml(item.newPath || 'Root')}`;
            html += `</span></div>`;
        });
        if (changes.moved.length > 5) {
            html += `<div class="change-item-more">... ${isZh ? '等' : 'and'} ${changes.moved.length - 5} ${isZh ? '项' : 'more'}</div>`;
        }
        html += '</div>';
    }

    // URL 修改
    if (changes.modified.length > 0) {
        html += '<div class="change-group">';
        html += `<div class="change-type"><i class="fas fa-edit"></i> ${isZh ? 'URL修改' : 'URL Modified'} (${changes.modified.length})</div>`;
        changes.modified.slice(0, 5).forEach(item => {
            html += `<div class="change-item" style="color: #fd7e14; font-weight: 500;">🔖 "${escapeHtml(item.title)}" <span style="color: #fd7e14; font-weight: 600;">~</span><br>`;
            html += `<span style="margin-left: 20px; font-size: 0.85em; color: #fd7e14; word-break: break-all;">`;
            html += `<span style="color: #fd7e14;">Bookmark URL:</span><br>`;
            html += `<span style="color: #fd7e14; text-decoration: line-through; opacity: 0.7;">- ${escapeHtml(item.oldUrl)}</span><br>`;
            html += `<span style="color: #fd7e14; font-weight: 600;">+ ${escapeHtml(item.newUrl)}</span>`;
            html += `</span></div>`;
        });
        if (changes.modified.length > 5) {
            html += `<div class="change-item-more">... ${isZh ? '等' : 'and'} ${changes.modified.length - 5} ${isZh ? '项' : 'more'}</div>`;
        }
        html += '</div>';
    }

    html += '</div></div>';
    return html;
}

// 将书签树转换为类似HTML文件的行数组
function bookmarkTreeToLines(tree, parentPath = '') {
    const lines = [];

    function traverse(nodes, path) {
        if (!nodes) return;

        nodes.forEach(node => {
            // 使用 ' > ' 作为路径分隔符，避免和文件夹名称中的 '/' 冲突
            const currentPath = path ? `${path} > ${node.title}` : node.title;

            if (node.url) {
                // 书签节点 - 类似 HTML 的 <DT><A> 行
                lines.push({
                    type: 'bookmark',
                    path: path || (currentLang === 'zh_CN' ? '根目录' : 'Root'),
                    title: node.title,
                    url: node.url,
                    line: `<DT><A HREF="${node.url}" ADD_DATE="${node.dateAdded || ''}">${node.title}</A>`,
                    id: node.id
                });
            } else if (node.children) {
                // 文件夹节点
                lines.push({
                    type: 'folder',
                    path: path || (currentLang === 'zh_CN' ? '根目录' : 'Root'),
                    title: node.title,
                    line: `<DT><H3 ADD_DATE="${node.dateAdded || ''}">${node.title}</H3>`,
                    id: node.id
                });
                lines.push({ type: 'tag', line: '<DL><p>' });
                traverse(node.children, currentPath);
                lines.push({ type: 'tag', line: '</DL><p>' });
            }
        });
    }

    if (tree && tree[0] && tree[0].children) {
        traverse(tree[0].children, '');
    }

    return lines;
}

// 生成真正的 Git diff（像 GitHub Desktop）
function generateGitDiff(oldLines, newLines, useGlobalIndex = false) {
    const hunks = [];
    const contextLines = 3; // 上下文行数

    // 使用简单的逐行比对
    let i = 0;
    let j = 0;

    while (i < oldLines.length || j < newLines.length) {
        // 找到下一个差异点
        const matchStart = { old: i, new: j };

        // 跳过相同的行
        while (i < oldLines.length && j < newLines.length &&
            oldLines[i].line === newLines[j].line) {
            i++;
            j++;
        }

        // 如果没有差异了，结束
        if (i >= oldLines.length && j >= newLines.length) {
            break;
        }

        // 找到了差异，记录差异的起始位置（减去上下文）
        const hunkOldStart = Math.max(0, i - contextLines);
        const hunkNewStart = Math.max(0, j - contextLines);

        // 添加前置上下文
        const contextBefore = [];
        for (let k = hunkOldStart; k < i; k++) {
            if (k < oldLines.length) {
                const actualOldIdx = useGlobalIndex && oldLines[k].globalIdx !== undefined ? oldLines[k].globalIdx : k;
                const actualNewIdx = useGlobalIndex && newLines[j - (i - k)] && newLines[j - (i - k)].globalIdx !== undefined ? newLines[j - (i - k)].globalIdx : (j - (i - k));
                contextBefore.push({
                    type: 'context',
                    line: oldLines[k],
                    oldIdx: actualOldIdx,
                    newIdx: actualNewIdx
                });
            }
        }

        // 收集变化
        const changes = [];
        const changeStartOld = i;
        const changeStartNew = j;

        // 找变化的范围（继续往前直到再次匹配或结束）
        while (i < oldLines.length || j < newLines.length) {
            // 检查是否重新匹配（连续匹配几行）
            let matchCount = 0;
            let ti = i, tj = j;
            while (ti < oldLines.length && tj < newLines.length &&
                oldLines[ti].line === newLines[tj].line && matchCount < contextLines + 1) {
                matchCount++;
                ti++;
                tj++;
            }

            // 如果连续匹配了足够多行，说明差异段结束
            if (matchCount >= contextLines + 1) {
                break;
            }

            // 否则继续收集差异
            if (i < oldLines.length && (j >= newLines.length || oldLines[i].line !== newLines[j].line)) {
                // 检查这行是否在 newLines 的后面出现（可能是新增导致的偏移）
                let foundInNew = -1;
                for (let search = j; search < Math.min(j + 10, newLines.length); search++) {
                    if (oldLines[i].line === newLines[search].line) {
                        foundInNew = search;
                        break;
                    }
                }

                if (foundInNew > j) {
                    // 说明中间有新增的行
                    while (j < foundInNew) {
                        const actualOldIdx = useGlobalIndex && oldLines[i] && oldLines[i].globalIdx !== undefined ? oldLines[i].globalIdx : i;
                        const actualNewIdx = useGlobalIndex && newLines[j].globalIdx !== undefined ? newLines[j].globalIdx : j;
                        changes.push({ type: 'add', line: newLines[j], oldIdx: actualOldIdx, newIdx: actualNewIdx });
                        j++;
                    }
                } else {
                    // 这是删除的行
                    const actualOldIdx = useGlobalIndex && oldLines[i].globalIdx !== undefined ? oldLines[i].globalIdx : i;
                    const actualNewIdx = useGlobalIndex && newLines[j] && newLines[j].globalIdx !== undefined ? newLines[j].globalIdx : j;
                    changes.push({ type: 'delete', line: oldLines[i], oldIdx: actualOldIdx, newIdx: actualNewIdx });
                    i++;
                }
            } else if (j < newLines.length && (i >= oldLines.length || oldLines[i].line !== newLines[j].line)) {
                // 新增的行
                const actualOldIdx = useGlobalIndex && oldLines[i] && oldLines[i].globalIdx !== undefined ? oldLines[i].globalIdx : i;
                const actualNewIdx = useGlobalIndex && newLines[j].globalIdx !== undefined ? newLines[j].globalIdx : j;
                changes.push({ type: 'add', line: newLines[j], oldIdx: actualOldIdx, newIdx: actualNewIdx });
                j++;
            } else if (i < oldLines.length && j < newLines.length && oldLines[i].line === newLines[j].line) {
                // 相同的行（但在差异段内）
                const actualOldIdx = useGlobalIndex && oldLines[i].globalIdx !== undefined ? oldLines[i].globalIdx : i;
                const actualNewIdx = useGlobalIndex && newLines[j].globalIdx !== undefined ? newLines[j].globalIdx : j;
                changes.push({ type: 'context', line: oldLines[i], oldIdx: actualOldIdx, newIdx: actualNewIdx });
                i++;
                j++;
            } else {
                break;
            }
        }

        // 添加后置上下文
        const contextAfter = [];
        const afterStart = { old: i, new: j };
        for (let k = 0; k < contextLines && (i + k) < oldLines.length && (j + k) < newLines.length; k++) {
            if (oldLines[i + k].line === newLines[j + k].line) {
                const actualOldIdx = useGlobalIndex && oldLines[i + k].globalIdx !== undefined ? oldLines[i + k].globalIdx : (i + k);
                const actualNewIdx = useGlobalIndex && newLines[j + k].globalIdx !== undefined ? newLines[j + k].globalIdx : (j + k);
                contextAfter.push({
                    type: 'context',
                    line: oldLines[i + k],
                    oldIdx: actualOldIdx,
                    newIdx: actualNewIdx
                });
            }
        }

        // 跳过后置上下文的行数
        const skipCount = contextAfter.length;
        i += skipCount;
        j += skipCount;

        // 如果有变化，添加 hunk
        if (changes.length > 0) {
            const deleteCount = changes.filter(c => c.type === 'delete').length;
            const addCount = changes.filter(c => c.type === 'add').length;
            const contextInChanges = changes.filter(c => c.type === 'context').length;

            // 提取路径信息（从变化的行或上下文中）
            let hunkPath = null;
            for (const change of changes) {
                if (change.line && change.line.path) {
                    hunkPath = change.line.path;
                    break;
                }
            }
            if (!hunkPath && contextBefore.length > 0) {
                hunkPath = contextBefore[0].line.path;
            }

            hunks.push({
                oldStart: hunkOldStart + 1,
                oldCount: contextBefore.length + deleteCount + contextInChanges + contextAfter.length,
                newStart: hunkNewStart + 1,
                newCount: contextBefore.length + addCount + contextInChanges + contextAfter.length,
                path: hunkPath,  // 添加路径信息
                contextBefore,
                changes,
                contextAfter
            });
        }
    }

    return hunks;
}

// ==================== 将hunks转换为真正的Git Diff文本格式 ====================
function hunksToGitDiffText(hunks, oldFileName = 'bookmarks.json', newFileName = 'bookmarks.json', lang = 'zh_CN') {
    if (!hunks || hunks.length === 0) {
        return '';
    }

    let diffText = '';

    // 生成diff文件头
    diffText += `diff --git a/${oldFileName} b/${newFileName}\n`;
    diffText += `index 000000..111111 100644\n`;
    diffText += `--- a/${oldFileName}\n`;
    diffText += `+++ b/${newFileName}\n`;

    let fileIndex = 0;
    hunks.forEach((hunk, index) => {
        // 生成hunk头
        diffText += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;

        // 添加路径作为hunk标题（如果有的话）
        if (hunk.path) {
            diffText += ` ${hunk.path}`;
        }
        diffText += '\n';

        // 添加上下文
        if (hunk.contextBefore) {
            hunk.contextBefore.forEach(ctx => {
                diffText += ` ${ctx.line.line}\n`;
            });
        }

        // 添加变化
        if (hunk.changes) {
            hunk.changes.forEach(change => {
                if (change.type === 'add') {
                    diffText += `+${change.line.line}\n`;
                } else if (change.type === 'delete') {
                    diffText += `-${change.line.line}\n`;
                } else if (change.type === 'context') {
                    diffText += ` ${change.line.line}\n`;
                }
            });
        }

        // 添加后置上下文
        if (hunk.contextAfter) {
            hunk.contextAfter.forEach(ctx => {
                diffText += ` ${ctx.line.line}\n`;
            });
        }
    });

    return diffText;
}

// ==================== 生成JSON对比的Git Diff ====================
// 对比两个JSON对象并生成git diff格式
function generateJsonGitDiff(oldData, newData, fileName = 'bookmarks.json', lang = 'zh_CN') {
    if (!oldData || !newData) {
        return '';
    }

    // 将JSON对象格式化为行
    const oldJson = JSON.stringify(oldData, null, 2).split('\n');
    const newJson = JSON.stringify(newData, null, 2).split('\n');

    // 转换为generateGitDiff需要的格式
    const oldLines = oldJson.map(line => ({ line, type: 'text' }));
    const newLines = newJson.map(line => ({ line, type: 'text' }));

    // 生成hunks
    const hunks = generateGitDiff(oldLines, newLines);

    // 转换为文本格式
    return hunksToGitDiffText(hunks, fileName, fileName, lang);
}

// ==================== 深度对比两个书签树 ====================
// 对比两个书签树，生成详细的变化列表
function deepCompareBookmarkTrees(oldTree, newTree, lang = 'zh_CN') {
    if (!oldTree || !newTree) {
        return {
            added: [],
            deleted: [],
            modified: [],
            moved: [],
            hasChanges: false
        };
    }

    // 生成书签指纹映射
    function generateBookmarkMap(tree, parentPath = '') {
        const map = new Map(); // id -> { title, url, path, dateAdded }
        const pathMap = new Map(); // path+title+url -> id

        function traverse(nodes, path) {
            if (!nodes) return;
            nodes.forEach(node => {
                const currentPath = path ? `${path}/${node.title}` : node.title;
                if (node.url) {
                    const key = `${currentPath}|${node.url}`;
                    map.set(node.id, {
                        title: node.title,
                        url: node.url,
                        path: currentPath,
                        dateAdded: node.dateAdded,
                        id: node.id
                    });
                    pathMap.set(key, node.id);
                } else if (node.children) {
                    traverse(node.children, currentPath);
                }
            });
        }

        if (tree && tree[0] && tree[0].children) {
            traverse(tree[0].children, '');
        }

        return { map, pathMap };
    }

    const { map: oldMap, pathMap: oldPathMap } = generateBookmarkMap(oldTree);
    const { map: newMap, pathMap: newPathMap } = generateBookmarkMap(newTree);

    const added = [];
    const deleted = [];
    const modified = [];
    const moved = [];

    // 检查新增和修改
    newMap.forEach((newBkm, newId) => {
        const oldBkm = oldMap.get(newId);
        if (!oldBkm) {
            // 检查是否是移动（相同URL，不同位置）
            let foundMoved = false;
            oldMap.forEach((oldItem, oldId) => {
                if (oldItem.url === newBkm.url && oldItem.path !== newBkm.path) {
                    moved.push({
                        title: newBkm.title,
                        url: newBkm.url,
                        oldPath: oldItem.path,
                        newPath: newBkm.path
                    });
                    foundMoved = true;
                }
            });
            if (!foundMoved) {
                added.push({
                    title: newBkm.title,
                    url: newBkm.url,
                    path: newBkm.path
                });
            }
        } else {
            // 检查是否修改
            if (oldBkm.title !== newBkm.title || oldBkm.url !== newBkm.url || oldBkm.path !== newBkm.path) {
                modified.push({
                    title: newBkm.title,
                    url: newBkm.url,
                    oldTitle: oldBkm.title,
                    oldPath: oldBkm.path,
                    newPath: newBkm.path
                });
            }
        }
    });

    // 检查删除
    oldMap.forEach((oldBkm, oldId) => {
        const newBkm = newMap.get(oldId);
        if (!newBkm) {
            // 检查是否是移动
            let foundMoved = moved.some(m => m.url === oldBkm.url && m.oldPath === oldBkm.path);
            if (!foundMoved) {
                deleted.push({
                    title: oldBkm.title,
                    url: oldBkm.url,
                    path: oldBkm.path
                });
            }
        }
    });

    const hasChanges = added.length > 0 || deleted.length > 0 || modified.length > 0 || moved.length > 0;

    return {
        added,
        deleted,
        modified,
        moved,
        hasChanges,
        addedCount: added.length,
        deletedCount: deleted.length,
        modifiedCount: modified.length,
        movedCount: moved.length
    };
}

// 简化的 LCS 算法
function computeLCS(oldLines, newLines) {
    const m = oldLines.length;
    const n = newLines.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1].line === newLines[j - 1].line) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // 回溯
    const lcs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (oldLines[i - 1].line === newLines[j - 1].line) {
            lcs[i - 1] = newLines[j - 1].line;
            i--;
            j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return lcs;
}

// ==================== Git Diff 辅助函数 ====================

// 渲染文件夹路径为面包屑导航
function renderBreadcrumb(path, lang) {
    if (!path) {
        return `<div class="breadcrumb">
            <span class="breadcrumb-item root">
                <i class="fas fa-home"></i>
                <span>${lang === 'zh_CN' ? '根目录' : 'Root'}</span>
            </span>
        </div>`;
    }

    // 只按 ' > ' 拆分路径（避免误拆文件夹名称中的 '/'）
    const parts = path.split(' > ').filter(p => p.trim());

    let html = '<div class="breadcrumb">';

    parts.forEach((part, index) => {
        if (index > 0) {
            html += '<span class="breadcrumb-separator"><i class="fas fa-chevron-right"></i></span>';
        }

        html += `<span class="breadcrumb-item">`;
        html += `<i class="fas fa-folder"></i>`;
        html += `<span class="breadcrumb-text">${escapeHtml(part.trim())}</span>`;
        html += `</span>`;
    });

    html += '</div>';
    return html;
}

// 折叠/展开单个 hunk（片段）
function toggleHunk(hunkId) {
    const content = document.getElementById(hunkId);
    const icon = document.getElementById(hunkId + '-icon');

    if (!content || !icon) {
        console.error('[toggleHunk] 找不到元素:', hunkId);
        return;
    }

    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-down');
    } else {
        content.classList.add('collapsed');
        icon.classList.remove('fa-chevron-down');
        icon.classList.add('fa-chevron-right');
    }
}

function renderChangeCategory(type, bookmarks) {
    if (bookmarks.length === 0) return '';

    // 这个函数现在不再使用，因为我们要渲染完整的 diff
    return '';
}

function renderChangeTreeItem(bookmark, type) {
    // 使用 Google S2 服务获取favicon - 更可靠
    const favicon = getFaviconUrl(bookmark.url);

    let displayInfo = '';
    if (type === 'moved') {
        // 移动的书签显示原路径和新路径
        displayInfo = `
            <div class="change-tree-item-title">${escapeHtml(bookmark.title || bookmark.url)}</div>
            <div class="change-tree-item-url">${escapeHtml(bookmark.url)}</div>
            <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 4px;">
                ${currentLang === 'zh_CN' ? '从' : 'From'}: ${escapeHtml(bookmark.oldPath || '')}
                ${bookmark.oldTitle !== bookmark.title ? ` (${escapeHtml(bookmark.oldTitle)})` : ''}
            </div>
        `;
    } else {
        displayInfo = `
            <div class="change-tree-item-title">${escapeHtml(bookmark.title || bookmark.url)}</div>
            <div class="change-tree-item-url">${escapeHtml(bookmark.url)}</div>
        `;
    }

    return `
        <div class="change-tree-item" data-bookmark-url="${escapeHtml(bookmark.url || '')}">
            ${favicon ? `<img class="change-tree-item-icon" 
                 src="${favicon}" 
                 alt="">` : ''}
            <div class="change-tree-item-info">
                ${displayInfo}
            </div>
            <span class="change-tree-item-badge ${type}">
                ${type === 'added' ? i18n.added[currentLang] :
            type === 'deleted' ? i18n.deleted[currentLang] :
                type === 'modified' ? i18n.modified[currentLang] :
                    i18n.moved[currentLang]}
            </span>
        </div>
    `;
}

// =============================================================================
// 备份历史视图
// =============================================================================

function renderHistoryView() {
    const container = document.getElementById('historyList');

    if (syncHistory.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-history"></i></div>
                <div class="empty-state-title">${i18n.emptyHistory[currentLang]}</div>
            </div>
        `;
        return;
    }

    // 反转数组，最新的在前
    const reversedHistory = [...syncHistory].reverse();

    container.innerHTML = reversedHistory.map((record, index) => {
        const time = formatTime(record.time);
        // 使用 type 字段代替 isAutoBackup：'manual', 'auto', 'switch'
        const isAuto = record.type !== 'manual';
        const fingerprint = record.fingerprint || '';

        // 计算变化
        const changes = calculateChanges(record, index, reversedHistory);

        // 方向标识
        const directionIcon = record.direction === 'upload'
            ? '<i class="fas fa-cloud-upload-alt"></i>'
            : '<i class="fas fa-cloud-download-alt"></i>';
        const directionText = record.direction === 'upload'
            ? (currentLang === 'zh_CN' ? '上传' : 'Upload')
            : (currentLang === 'zh_CN' ? '本地' : 'Local');

        // 构建提交项
        // 切换标识徽章（可选显示）
        const typeBadge = (record.type === 'switch')
            ? `<span class="commit-badge switch" title="${currentLang === 'zh_CN' ? '切换备份' : 'Switch Backup'}">
                   <i class="fas fa-exchange-alt"></i> ${currentLang === 'zh_CN' ? '切换' : 'Switch'}
               </span>`
            : '';

        return `
            <div class="commit-item" data-record-time="${record.time}">
                <div class="commit-header">
                    <div class="commit-title-group">
        <div class="commit-title" title="${currentLang === 'zh_CN' ? '点击编辑备注' : 'Click to edit note'}">${record.note || time}</div>
                        <button class="commit-note-edit-btn" data-time="${record.time}" title="${currentLang === 'zh_CN' ? '编辑备注' : 'Edit Note'}">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    <div class="commit-actions">
                        <button class="action-btn copy-btn" data-time="${record.time}" title="${currentLang === 'zh_CN' ? '复制Diff (JSON格式)' : 'Copy Diff (JSON)'}">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="action-btn export-btn" data-time="${record.time}" title="${currentLang === 'zh_CN' ? '导出为HTML文件' : 'Export as HTML'}">
                            <i class="fas fa-file-export"></i>
                        </button>
                        <button class="action-btn detail-btn" data-time="${record.time}" title="${currentLang === 'zh_CN' ? '查看详情' : 'View Details'}">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </div>
                </div>
                <div class="commit-meta">
                    <div class="commit-time">
                        <i class="fas fa-clock"></i> ${time}
                    </div>
                    ${renderCommitStatsInline(changes)}
                    <span class="commit-badge ${isAuto ? 'auto' : 'manual'}">
                        <i class="fas ${isAuto ? 'fa-robot' : 'fa-hand-pointer'}"></i>
                        ${isAuto ? i18n.autoBackup[currentLang] : i18n.manualBackup[currentLang]}
                    </span>
                    ${typeBadge}
                    <span class="commit-badge direction">
                        ${directionIcon}
                        ${directionText}
                    </span>
                    <span class="commit-fingerprint" title="提交指纹号">#${fingerprint}</span>
                </div>
            </div>
        `;
    }).join('');

    // 添加按钮事件（使用事件委托）
    container.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const recordTime = btn.dataset.time;

            if (btn.classList.contains('copy-btn')) {
                window.copyHistoryDiff(recordTime);
            } else if (btn.classList.contains('export-btn')) {
                window.exportHistoryDiffToHTML(recordTime);
            } else if (btn.classList.contains('detail-btn')) {
                const record = syncHistory.find(r => r.time === recordTime);
                if (record) showDetailModal(record);
            }
        });
    });

    // 添加备注编辑按钮事件
    container.querySelectorAll('.commit-note-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const recordTime = btn.dataset.time;
            editCommitNote(recordTime);
        });
    });
}

// 编辑备注
async function editCommitNote(recordTime) {
    const record = syncHistory.find(r => r.time === recordTime);
    if (!record) return;

    const currentNote = record.note || '';
    const newNote = prompt(
        currentLang === 'zh_CN' ? '输入备注（留空则删除备注）：' : 'Enter note (leave empty to remove):',
        currentNote
    );

    // 如果用户取消，返回
    if (newNote === null) return;

    // 更新本地记录
    record.note = newNote || '';

    // 同步到存储
    try {
        await new Promise((resolve) => {
            browserAPI.storage.local.get(['syncHistory'], (data) => {
                const history = data.syncHistory || [];
                const index = history.findIndex(r => r.time === recordTime);
                if (index >= 0) {
                    history[index].note = record.note;
                    browserAPI.storage.local.set({ syncHistory: history }, resolve);
                } else {
                    resolve();
                }
            });
        });

        // 重新渲染历史视图
        renderHistoryView();

        // 显示成功提示
        showToast(currentLang === 'zh_CN' ? '备注已更新' : 'Note updated');
    } catch (error) {
        console.error('[editCommitNote] 保存备注失败:', error);
        showToast(currentLang === 'zh_CN' ? '保存备注失败' : 'Failed to save note');
    }
}

function calculateChanges(record, index, reversedHistory) {
    const bookmarkStats = record.bookmarkStats || {};

    // 如果是第一次备份
    if (record.isFirstBackup || index === reversedHistory.length - 1) {
        return {
            bookmarkDiff: bookmarkStats.currentBookmarkCount || 0,
            folderDiff: bookmarkStats.currentFolderCount || 0,
            isFirst: true,
            hasNoChange: false
        };
    }

    // 获取数量变化（来自 bookmarkStats）
    const bookmarkDiff = bookmarkStats.bookmarkDiff || 0;
    const folderDiff = bookmarkStats.folderDiff || 0;

    // 获取结构变化标记（来自 bookmarkStats）
    const bookmarkMoved = bookmarkStats.bookmarkMoved || false;
    const folderMoved = bookmarkStats.folderMoved || false;
    const bookmarkModified = bookmarkStats.bookmarkModified || false;
    const folderModified = bookmarkStats.folderModified || false;

    // 判断变化类型
    const hasNumericalChange = bookmarkDiff !== 0 || folderDiff !== 0;
    const hasStructuralChange = bookmarkMoved || folderMoved || bookmarkModified || folderModified;
    const hasNoChange = !hasNumericalChange && !hasStructuralChange;

    return {
        bookmarkDiff,
        folderDiff,
        isFirst: false,
        hasNoChange,
        hasNumericalChange,
        hasStructuralChange,
        bookmarkMoved,
        folderMoved,
        bookmarkModified,
        folderModified
    };
}

function renderCommitStats(changes) {
    if (changes.isFirst) {
        return `
            <div class="commit-stats">
                <span>${i18n.firstBackup[currentLang]}: ${changes.bookmarkDiff} ${i18n.bookmarks[currentLang]}, ${changes.folderDiff} ${i18n.folders[currentLang]}</span>
            </div>
        `;
    }

    // 使用bookmarkStats的数据来判断是否有变化
    if (changes.hasNoChange) {
        return `
            <div class="commit-stats no-change">
                <span style="color: var(--text-tertiary);">
                    <i class="fas fa-check-circle" style="color: var(--success); margin-right: 4px;"></i>
                    ${currentLang === 'zh_CN' ? '无变化' : 'No Changes'}
                </span>
            </div>
        `;
    }

    const parts = [];

    // 显示数量变化
    if (changes.hasNumericalChange) {
        const bookmarkPart = changes.bookmarkDiff !== 0
            ? `${changes.bookmarkDiff > 0 ? '+' : ''}${changes.bookmarkDiff} ${i18n.bookmarks[currentLang]}`
            : '';
        const folderPart = changes.folderDiff !== 0
            ? `${changes.folderDiff > 0 ? '+' : ''}${changes.folderDiff} ${i18n.folders[currentLang]}`
            : '';
        const quantityText = [bookmarkPart, folderPart].filter(Boolean).join(', ');

        parts.push(`
            <span class="stat-change added">
                <i class="fas fa-plus-circle"></i>
                ${quantityText}
            </span>
        `);
    }

    // 显示结构变化的具体类型
    if (changes.bookmarkMoved || changes.folderMoved) {
        parts.push(`
            <span class="stat-change modified">
                <i class="fas fa-arrows-alt"></i>
                ${currentLang === 'zh_CN' ? '移动' : 'Moved'}
            </span>
        `);
    }

    if (changes.bookmarkModified || changes.folderModified) {
        parts.push(`
            <span class="stat-change modified">
                <i class="fas fa-edit"></i>
                ${currentLang === 'zh_CN' ? '修改' : 'Modified'}
            </span>
        `);
    }

    if (parts.length === 0) {
        parts.push(`<span style="color: var(--text-tertiary);">${currentLang === 'zh_CN' ? '无变化' : 'No Changes'}</span>`);
    }

    return `<div class="commit-stats">${parts.join('')}</div>`;
}

// 用于在中间行显示的内联变化信息
function renderCommitStatsInline(changes) {
    if (changes.isFirst) {
        return `<span class="stat-badge">${currentLang === 'zh_CN' ? '首次备份' : 'First Backup'}</span>`;
    }

    // 使用bookmarkStats的数据来判断是否有变化
    if (changes.hasNoChange) {
        return `
            <span class="stat-badge no-change">
                <i class="fas fa-check-circle" style="color: var(--success);"></i>
                ${currentLang === 'zh_CN' ? '无变化' : 'No Changes'}
            </span>
        `;
    }

    const parts = [];

    // 显示数量变化
    if (changes.hasNumericalChange) {
        const bookmarkParts = [];
        const folderParts = [];

        if (changes.bookmarkDiff !== 0) {
            const bookmarkClass = changes.bookmarkDiff > 0 ? 'added' : 'deleted';
            const bookmarkLabel = currentLang === 'zh_CN' ? '书签' : 'BKM';
            bookmarkParts.push(`<span class="stat-label">${bookmarkLabel}</span> <span class="stat-color ${bookmarkClass}">${changes.bookmarkDiff > 0 ? '+' : ''}${changes.bookmarkDiff}</span>`);
        }

        if (changes.folderDiff !== 0) {
            const folderClass = changes.folderDiff > 0 ? 'added' : 'deleted';
            const folderLabel = currentLang === 'zh_CN' ? '文件夹' : 'FLD';
            folderParts.push(`<span class="stat-label">${folderLabel}</span> <span class="stat-color ${folderClass}">${changes.folderDiff > 0 ? '+' : ''}${changes.folderDiff}</span>`);
        }

        const quantityText = [...bookmarkParts, ...folderParts].join(' ');
        parts.push(`<span class="stat-badge quantity">${quantityText}</span>`);
    }

    // 显示结构变化的具体类型 - 使用不同的颜色
    if (changes.bookmarkMoved || changes.folderMoved) {
        parts.push(`<span class="stat-badge struct moved"><i class="fas fa-arrows-alt"></i> ${currentLang === 'zh_CN' ? '移动' : 'Moved'}</span>`);
    }

    if (changes.bookmarkModified || changes.folderModified) {
        parts.push(`<span class="stat-badge struct modified"><i class="fas fa-edit"></i> ${currentLang === 'zh_CN' ? '修改' : 'Modified'}</span>`);
    }

    if (parts.length === 0) {
        parts.push(`<span class="stat-badge no-change">${currentLang === 'zh_CN' ? '无变化' : 'No Changes'}</span>`);
    }

    return parts.join('');
}

// =============================================================================
// 书签温故视图
// =============================================================================

function renderAdditionsView() {
    const container = document.getElementById('additionsList');

    // 【修复】容器已被删除（在UI重构中），直接返回
    if (!container) {
        console.log('[renderAdditionsView] additionsList容器不存在，跳过渲染');
        return;
    }

    if (allBookmarks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-bookmark"></i></div>
                <div class="empty-state-title">${i18n.emptyAdditions[currentLang]}</div>
            </div>
        `;
        return;
    }

    // 按时间范围分组（年、月、日）
    const groupedByTime = groupBookmarksByTime(allBookmarks, currentTimeFilter);

    // 过滤
    const filtered = filterBookmarks(groupedByTime);

    container.innerHTML = renderBookmarkGroups(filtered, currentTimeFilter);

    // 绑定折叠/展开事件
    attachAdditionGroupEvents();
}

// 初始化「书签温故」子视图标签和行为
function initAdditionsSubTabs() {
    const tabs = document.querySelectorAll('.additions-tab');
    const reviewPanel = document.getElementById('additionsReviewPanel');
    const browsingPanel = document.getElementById('additionsBrowsingPanel');
    const trackingPanel = document.getElementById('additionsTrackingPanel');

    if (!tabs.length || !reviewPanel || !browsingPanel) {
        console.warn('[initAdditionsSubTabs] 主标签或面板缺失');
        return;
    }

    let browsingHistoryInitialized = false;
    let trackingInitialized = false;

    // 标签切换函数
    const switchToTab = (target, shouldSave = true) => {
        // 切换标签高亮
        tabs.forEach(t => t.classList.remove('active'));
        const targetTab = document.querySelector(`.additions-tab[data-tab="${target}"]`);
        if (targetTab) targetTab.classList.add('active');

        // 切换子视图
        reviewPanel.classList.remove('active');
        browsingPanel.classList.remove('active');
        if (trackingPanel) trackingPanel.classList.remove('active');

        if (target === 'review') {
            reviewPanel.classList.add('active');
            try {
                renderAdditionsView();
            } catch (error) {
                console.warn('[initAdditionsSubTabs] 渲染书签添加记录失败:', error);
            }
        } else if (target === 'browsing') {
            browsingPanel.classList.add('active');
            // 初始化浏览记录日历（首次点击时）
            if (!browsingHistoryInitialized) {
                browsingHistoryInitialized = true;
                try {
                    initBrowsingHistoryCalendar();
                } catch (e) {
                    console.error('[Additions] 初始化浏览记录日历失败:', e);
                }
            } else {
                refreshBrowsingHistoryData({ forceFull: false, silent: true });
            }
        } else if (target === 'tracking' && trackingPanel) {
            trackingPanel.classList.add('active');
            // 初始化时间捕捉（首次点击时）
            if (!trackingInitialized) {
                trackingInitialized = true;
                initTrackingToggle();
            }
            // 加载数据
            loadCurrentTrackingSessions();
            loadActiveTimeRanking();
            startTrackingRefresh();
        }

        // 保存当前状态
        if (shouldSave) {
            localStorage.setItem('additionsActiveTab', target);
        }
    };

    // 绑定点击事件
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchToTab(tab.dataset.tab, true);
        });
    });

    // 恢复上次选中的标签
    const savedTab = localStorage.getItem('additionsActiveTab');
    if (savedTab && ['review', 'browsing', 'tracking'].includes(savedTab)) {
        switchToTab(savedTab, false);
    }

    // 初始化浏览记录的子标签
    initBrowsingSubTabs();
}

// 初始化浏览记录子标签
function initBrowsingSubTabs() {
    const subTabs = document.querySelectorAll('.browsing-sub-tab');
    const historyPanel = document.getElementById('browsingHistoryPanel');
    const rankingPanel = document.getElementById('browsingRankingPanel');
    const relatedPanel = document.getElementById('browsingRelatedPanel');
    let browsingRankingInitialized = false;
    let browsingRelatedInitialized = false;

    if (!subTabs.length || !historyPanel || !rankingPanel || !relatedPanel) {
        console.warn('[initBrowsingSubTabs] 子标签或面板缺失');
        return;
    }

    // 子标签切换函数
    const switchToSubTab = (target, shouldSave = true) => {
        // 切换子标签高亮
        subTabs.forEach(t => t.classList.remove('active'));
        const targetTab = document.querySelector(`.browsing-sub-tab[data-sub-tab="${target}"]`);
        if (targetTab) targetTab.classList.add('active');

        // 切换子面板
        historyPanel.classList.remove('active');
        rankingPanel.classList.remove('active');
        relatedPanel.classList.remove('active');

        if (target === 'history') {
            historyPanel.classList.add('active');
            refreshBrowsingHistoryData({ forceFull: false, silent: true });
        } else if (target === 'ranking') {
            rankingPanel.classList.add('active');
            if (!browsingRankingInitialized) {
                browsingRankingInitialized = true;
                try {
                    initBrowsingClickRanking();
                } catch (e) {
                    console.error('[initBrowsingSubTabs] 初始化点击排行失败:', e);
                }
            } else {
                refreshBrowsingHistoryData({ forceFull: false, silent: true });
                browsingClickRankingStats = null;
                refreshActiveBrowsingRankingIfVisible();
            }
        } else if (target === 'related') {
            relatedPanel.classList.add('active');
            if (!browsingRelatedInitialized) {
                browsingRelatedInitialized = true;
                try {
                    initBrowsingRelatedHistory();
                } catch (e) {
                    console.error('[initBrowsingSubTabs] 初始化书签关联记录失败:', e);
                }
            } else {
                refreshBrowsingRelatedHistory();
            }
        }

        // 保存当前状态
        if (shouldSave) {
            localStorage.setItem('browsingActiveSubTab', target);
        }
    };

    // 绑定点击事件
    subTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchToSubTab(tab.dataset.subTab, true);
        });
    });

    // 恢复上次选中的子标签
    const savedSubTab = localStorage.getItem('browsingActiveSubTab');
    if (savedSubTab && ['history', 'ranking', 'related'].includes(savedSubTab)) {
        switchToSubTab(savedSubTab, false);
    }
}

/*
 * ============================================================================
 * 以下「书签点击排行」相关代码已注释，UI已删除，等待重构
 * ============================================================================
 */

/*
// 基于浏览器历史记录的“书签点击排行榜”（书签温故第二个子视图）
function loadBookmarkClickRankingForAdditions(container) {
    if (!container) return;

    container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="fas fa-clock"></i></div>
            <div class="empty-state-title">${currentLang === 'zh_CN' ? '正在读取历史记录...' : 'Loading history...'}</div>
        </div>
    `;

    if (!browserAPI || !browserAPI.history || typeof browserAPI.history.getVisits !== 'function') {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-ban"></i></div>
                <div class="empty-state-title">${currentLang === 'zh_CN' ? '当前环境不支持历史记录统计' : 'History statistics are not available in this environment'}</div>
                <div class="empty-state-description">${currentLang === 'zh_CN' ? '请确认扩展已获得浏览器的历史记录权限。' : 'Please ensure the extension has permission to access browser history.'}</div>
            </div>
        `;
        return;
    }

    if (!Array.isArray(allBookmarks) || allBookmarks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-bookmark"></i></div>
                <div class="empty-state-title">${currentLang === 'zh_CN' ? '暂无书签可统计' : 'No bookmarks to analyze'}</div>
            </div>
        `;
        return;
    }

    // 仅统计有效的 HTTP/HTTPS 书签，限制数量避免开销过大
    const candidates = allBookmarks
        .filter(b => b.url && (b.url.startsWith('http://') || b.url.startsWith('https://')))
        .slice(0, 150);

    if (!candidates.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-bookmark"></i></div>
                <div class="empty-state-title">${currentLang === 'zh_CN' ? '暂无可统计的书签' : 'No bookmarks available for statistics'}</div>
            </div>
        `;
        return;
    }

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const rankingMap = new Map(); // url -> stats
    let pending = candidates.length;

    const finishIfDone = () => {
        pending -= 1;
        if (pending > 0) return;

        const items = Array.from(rankingMap.values())
            // 只保留至少有一次访问的
            .filter(item =>
                item.last1d ||
                item.last3d ||
                item.last7d ||
                item.last30d ||
                item.last90d ||
                item.last180d ||
                item.last365d
            );

        if (!items.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-clock"></i></div>
                    <div class="empty-state-title">${currentLang === 'zh_CN' ? '暂无点击记录' : 'No click records found'}</div>
                    <div class="empty-state-description">${currentLang === 'zh_CN' ? '浏览器历史记录中尚未找到这些书签的访问记录。' : 'No visit records for these bookmarks were found in browser history.'}</div>
                </div>
            `;
            return;
        }

        // 排序：优先最近 7 天，再看 30 天
        items.sort((a, b) => {
            if (b.last7d !== a.last7d) return b.last7d - a.last7d;
            if (b.last30d !== a.last30d) return b.last30d - a.last30d;
            return (b.last365d || 0) - (a.last365d || 0);
        });

        renderBookmarkClickRankingList(container, items.slice(0, 50));
    };

    candidates.forEach(bookmark => {
        try {
            browserAPI.history.getVisits({ url: bookmark.url }, (visits) => {
                const runtime = browserAPI.runtime;
                if (runtime && runtime.lastError) {
                    finishIfDone();
                    return;
                }

                const key = bookmark.url;
                let info = rankingMap.get(key);
                if (!info) {
                    info = {
                        url: bookmark.url,
                        title: bookmark.title || bookmark.url,
                        lastVisitTime: 0,
                        last1d: 0,
                        last3d: 0,
                        last7d: 0,
                        last30d: 0,
                        last90d: 0,
                        last180d: 0,
                        last365d: 0
                    };
                    rankingMap.set(key, info);
                }

                if (Array.isArray(visits)) {
                    visits.forEach(v => {
                        const t = typeof v.visitTime === 'number' ? v.visitTime : 0;
                        if (!t) return;

                        if (t > info.lastVisitTime) {
                            info.lastVisitTime = t;
                        }

                        const diff = now - t;
                        if (diff <= oneDay) info.last1d += 1;
                        if (diff <= 3 * oneDay) info.last3d += 1;
                        if (diff <= 7 * oneDay) info.last7d += 1;
                        if (diff <= 30 * oneDay) info.last30d += 1;
                        if (diff <= 90 * oneDay) info.last90d += 1;
                        if (diff <= 180 * oneDay) info.last180d += 1;
                        if (diff <= 365 * oneDay) info.last365d += 1;
                    });
                }

                finishIfDone();
            });
        } catch (e) {
            finishIfDone();
        }
    });
}

function renderBookmarkClickRankingList(container, items) {
    container.innerHTML = '';

    items.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'addition-item ranking-item';

        const icon = document.createElement('img');
        icon.className = 'addition-icon';
        icon.src = getFaviconUrl(entry.url);
        icon.alt = '';

        const info = document.createElement('div');
        info.className = 'addition-info';

        const titleLink = document.createElement('a');
        titleLink.className = 'addition-title';
        titleLink.href = entry.url;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        titleLink.textContent = entry.title;

        const urlDiv = document.createElement('div');
        urlDiv.className = 'addition-url';
        urlDiv.textContent = entry.url;

        info.appendChild(titleLink);
        info.appendChild(urlDiv);

        const counts = document.createElement('div');
        counts.className = 'ranking-counts';
        counts.textContent = currentLang === 'zh_CN'
            ? `7天：${entry.last7d}，30天：${entry.last30d}`
            : `7 days: ${entry.last7d}, 30 days: ${entry.last30d}`;

        const header = document.createElement('div');
        header.className = 'ranking-item-header';
        header.appendChild(info);
        header.appendChild(counts);

        const detail = document.createElement('div');
        detail.className = 'ranking-detail';
        detail.style.display = 'none';

        const lastVisitText = entry.lastVisitTime
            ? new Date(entry.lastVisitTime).toLocaleString()
            : (currentLang === 'zh_CN' ? '无访问记录' : 'No visits');

        if (currentLang === 'zh_CN') {
            detail.textContent =
                `1天：${entry.last1d}，3天：${entry.last3d}，7天：${entry.last7d}，` +
                `30天：${entry.last30d}，90天：${entry.last90d}，180天：${entry.last180d}，365天：${entry.last365d}；` +
                `最近访问：${lastVisitText}`;
        } else {
            detail.textContent =
                `1 day: ${entry.last1d}, 3 days: ${entry.last3d}, 7 days: ${entry.last7d}, ` +
                `30 days: ${entry.last30d}, 90 days: ${entry.last90d}, 180 days: ${entry.last180d}, 365 days: ${entry.last365d}; ` +
                `Last visit: ${lastVisitText}`;
        }

        row.appendChild(icon);
        row.appendChild(header);
        row.appendChild(detail);

        // 整行可点击：展开/收起详细统计，同时打开书签
        row.addEventListener('click', (e) => {
            // 如果直接点击的是标题链接，让浏览器默认打开，不拦截
            if (e.target === titleLink) {
                return;
            }

            e.preventDefault();

            // 切换详情可见性
            const visible = detail.style.display === 'block';
            detail.style.display = visible ? 'none' : 'block';

            // 打开对应书签
            try {
                if (browserAPI && browserAPI.tabs && typeof browserAPI.tabs.create === 'function') {
                    browserAPI.tabs.create({ url: entry.url });
                } else {
                    window.open(entry.url, '_blank');
                }
            } catch (err) {
                console.warn('[Additions] 打开书签失败:', err);
            }
        });

        container.appendChild(row);
    });
}
*/

/*
 * ============================================================================
 * 以上「书签点击排行」相关代码已注释，UI已删除，等待重构
 * ============================================================================
 */

// 基于浏览器历史记录的「点击排行」（书签浏览记录子视图）

function getBrowsingClickRankingBoundaries() {
    const now = new Date();
    const nowMs = now.getTime();

    // 当天起始（本地时区）
    const dayStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayStart = dayStartDate.getTime();

    // 与「点击记录」日历保持一致：
    // - 中文使用周一作为一周开始
    // - 其他语言使用周日作为一周开始
    const weekStartDay = currentLang === 'zh_CN' ? 1 : 0; // 0=周日,1=周一,...
    const weekStartDate = new Date(dayStartDate);
    const currentDay = weekStartDate.getDay(); // 0-6 (周日-周六)
    let diff = currentDay - weekStartDay;
    if (diff < 0) diff += 7;
    weekStartDate.setDate(weekStartDate.getDate() - diff);
    const weekStart = weekStartDate.getTime();

    // 当月起始
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    // 当年起始
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();

    return { now: nowMs, dayStart, weekStart, monthStart, yearStart };
}

async function ensureBrowsingClickRankingStats() {
    if (browsingClickRankingStats) {
        return browsingClickRankingStats;
    }

    // 如果历史记录 API 完全不可用，直接标记为不支持
    if (!browserAPI || !browserAPI.history || typeof browserAPI.history.search !== 'function') {
        browsingClickRankingStats = { items: [], error: 'noHistoryApi' };
        return browsingClickRankingStats;
    }

    // 确保「点击记录」日历已初始化
    try {
        if (typeof initBrowsingHistoryCalendar === 'function' && !window.browsingHistoryCalendarInstance) {
            initBrowsingHistoryCalendar();
        }
    } catch (e) {
        console.warn('[BrowsingRanking] 初始化 BrowsingHistoryCalendar 失败:', e);
    }

    // 等待日历数据（基于 bookmarksByDate）
    const waitForCalendarData = async () => {
        const start = Date.now();
        const timeout = 5000;
        while (Date.now() - start < timeout) {
            const inst = window.browsingHistoryCalendarInstance;
            if (inst && inst.bookmarksByDate && inst.bookmarksByDate.size > 0) {
                return inst;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return window.browsingHistoryCalendarInstance || null;
    };

    const calendar = await waitForCalendarData();

    if (!calendar || !calendar.bookmarksByDate) {
        browsingClickRankingStats = { items: [], error: 'noBookmarks' };
        return browsingClickRankingStats;
    }

    // 如果完全没有任何点击记录，则视为无数据
    if (calendar.bookmarksByDate.size === 0) {
        browsingClickRankingStats = { items: [], error: 'noBookmarks' };
        return browsingClickRankingStats;
    }

    const boundaries = getBrowsingClickRankingBoundaries();

    // ✨ 通过书签 API 获取 URL 和标题集合，用于构建书签标识映射
    // 与「书签关联记录」和「点击记录」保持一致，使用 URL 或标题的并集匹配
    let bookmarkData;
    try {
        bookmarkData = await getBookmarkUrlsAndTitles();
    } catch (error) {
        console.warn('[BrowsingRanking] 获取书签URL和标题失败:', error);
        browsingClickRankingStats = { items: [], error: 'noBookmarks' };
        return browsingClickRankingStats;
    }

    const bookmarkInfoByUrl = bookmarkData && bookmarkData.info ? bookmarkData.info : null;
    if (!bookmarkInfoByUrl || bookmarkInfoByUrl.size === 0) {
        browsingClickRankingStats = { items: [], error: 'noBookmarks' };
        return browsingClickRankingStats;
    }

    // 构建 URL/标题 -> 书签主键的映射
    // 标题相同的书签合并为同一个统计项（共享 bookmarkKey）
    const bookmarkKeyMap = new Map(); // url or title (normalized) -> bookmarkKey
    const bookmarkInfoMap = new Map(); // bookmarkKey -> { url, title, urls: [] }

    let bookmarkKeyCounter = 0;
    for (const [url, info] of bookmarkInfoByUrl.entries()) {
        const normalizedUrl = url;
        const normalizedTitle = info && typeof info.title === 'string' ? info.title.trim() : '';

        // 检查是否已有相同标题的书签
        let bookmarkKey = null;
        if (normalizedTitle) {
            bookmarkKey = bookmarkKeyMap.get(`title:${normalizedTitle}`);
        }
        
        if (bookmarkKey) {
            // 标题相同，复用已有的 bookmarkKey，添加 URL 映射
            bookmarkKeyMap.set(`url:${normalizedUrl}`, bookmarkKey);
            // 记录额外的 URL
            const existingInfo = bookmarkInfoMap.get(bookmarkKey);
            if (existingInfo && existingInfo.urls) {
                existingInfo.urls.push(normalizedUrl);
            }
        } else {
            // 创建新的 bookmarkKey
            bookmarkKey = `bm_${bookmarkKeyCounter++}`;
            bookmarkKeyMap.set(`url:${normalizedUrl}`, bookmarkKey);
            if (normalizedTitle) {
                bookmarkKeyMap.set(`title:${normalizedTitle}`, bookmarkKey);
            }
            bookmarkInfoMap.set(bookmarkKey, {
                url: normalizedUrl,
                title: normalizedTitle || normalizedUrl,
                urls: [normalizedUrl]
            });
        }
    }

    const statsMap = new Map(); // bookmarkKey -> stats

    // 从「点击记录」的数据结构中汇总统计信息
    for (const bookmarks of calendar.bookmarksByDate.values()) {
        bookmarks.forEach(bm => {
            if (!bm || !bm.url) return;

            const url = bm.url;
            const title = typeof bm.title === 'string' && bm.title.trim()
                ? bm.title.trim()
                : (bm.url || '');
            const t = typeof bm.visitTime === 'number'
                ? bm.visitTime
                : (bm.dateAdded instanceof Date ? bm.dateAdded.getTime() : 0);
            if (!t) return;

            // ✨ 每条历史记录的 visitCount 应该是 1（单次访问），不应累积浏览器的总访问次数
            // 因为我们已经将每次访问都记录为单独的记录
            const increment = 1;

            // ✨ 找出这条记录匹配的书签（优先URL匹配，其次标题匹配）
            let bookmarkKey = bookmarkKeyMap.get(`url:${url}`);
            if (!bookmarkKey && title) {
                // URL 不匹配，尝试标题匹配
                bookmarkKey = bookmarkKeyMap.get(`title:${title}`);
            }
            
            if (!bookmarkKey) {
                // 没有匹配的书签，跳过（理论上不应该发生，因为这些记录来自存储库3）
                return;
            }

            let stats = statsMap.get(bookmarkKey);
            if (!stats) {
                const info = bookmarkInfoMap.get(bookmarkKey);
                stats = {
                    url: info.url,
                    title: info.title,
                    lastVisitTime: 0,
                    dayCount: 0,
                    weekCount: 0,
                    monthCount: 0,
                    yearCount: 0,
                    allCount: 0
                };
                statsMap.set(bookmarkKey, stats);
            }

            if (t > stats.lastVisitTime) {
                stats.lastVisitTime = t;
            }

            // ✨ 修复时间统计：只统计当前时间之前的访问
            const now = boundaries.now;
            if (t <= now) {
                stats.allCount += increment; // 全部时间范围
                if (t >= boundaries.dayStart && t <= now) stats.dayCount += increment;
                if (t >= boundaries.weekStart && t <= now) stats.weekCount += increment;
                if (t >= boundaries.monthStart && t <= now) stats.monthCount += increment;
                if (t >= boundaries.yearStart && t <= now) stats.yearCount += increment;
            }
        });
    }

    const items = Array.from(statsMap.values());

    // 保存映射供筛选函数使用
    browsingClickRankingStats = { items, boundaries, bookmarkKeyMap, bookmarkInfoMap };
    return browsingClickRankingStats;
}

function getBrowsingRankingItemsForRange(range) {
    if (!browsingClickRankingStats || !Array.isArray(browsingClickRankingStats.items)) {
        return [];
    }

    const key = range === 'day'
        ? 'dayCount'
        : range === 'week'
            ? 'weekCount'
        : range === 'year'
            ? 'yearCount'
        : range === 'all'
            ? 'allCount'
            : 'monthCount';

    const items = browsingClickRankingStats.items
        .filter(item => item[key] > 0)
        .sort((a, b) => {
            if (b[key] !== a[key]) return b[key] - a[key];
            return (b.lastVisitTime || 0) - (a.lastVisitTime || 0);
        });

    // 返回完整有序列表，渲染层做懒加载
    return items;
}

// 渲染文件夹模式的点击排行列表
async function renderBrowsingFolderRankingList(container, items, range, stats) {
    container.innerHTML = '';
    
    const isZh = currentLang === 'zh_CN';
    
    // 确保书签信息已加载（包含 folderPath）
    await getBookmarkUrlsAndTitles();
    
    if (!items.length) {
        const title = isZh ? '暂无点击记录' : 'No click records found';
        const desc = isZh ? '当前时间范围内尚未找到这些书签的访问记录。' : 'No visit records were found in the selected time range.';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-folder"></i></div>
                <div class="empty-state-title">${title}</div>
                <div class="empty-state-description">${desc}</div>
            </div>
        `;
        return;
    }

    // 按文件夹聚合统计
    const folderStats = new Map(); // folderPath -> { count, items: [] }
    const bookmarkInfo = stats.bookmarkInfoMap;
    
    items.forEach(item => {
        // 尝试从 getBookmarkUrlsAndTitles 获取 folderPath
        let folderPath = [];
        if (browsingRelatedBookmarkInfo && browsingRelatedBookmarkInfo.has(item.url)) {
            folderPath = browsingRelatedBookmarkInfo.get(item.url).folderPath || [];
        }
        
        // 使用完整的文件夹路径作为分组键（精确到最后一级文件夹）
        const folderKey = folderPath.length > 0 ? folderPath.join(' / ') : (isZh ? '未分类' : 'Uncategorized');
        const folderName = folderPath.length > 0 ? folderPath[folderPath.length - 1] : folderKey;
        
        if (!folderStats.has(folderKey)) {
            folderStats.set(folderKey, { 
                name: folderName,
                fullPath: folderKey,
                folderPath: folderPath,
                count: 0, 
                items: []
            });
        }
        
        const folderData = folderStats.get(folderKey);
        const itemCount = item.filteredCount !== undefined ? item.filteredCount : (
            range === 'day' ? item.dayCount :
            range === 'week' ? item.weekCount :
            range === 'year' ? item.yearCount :
            range === 'all' ? item.allCount : item.monthCount
        );
        folderData.count += itemCount;
        folderData.items.push({ ...item, count: itemCount, folderPath });
    });

    // 按点击次数排序文件夹
    const sortedFolders = Array.from(folderStats.values()).sort((a, b) => b.count - a.count);
    
    // 渲染文件夹列表
    const rangeLabel = (() => {
        if (range === 'day') return isZh ? '今天' : 'Today';
        if (range === 'week') return isZh ? '本周' : 'This week';
        if (range === 'year') return isZh ? '本年' : 'This year';
        if (range === 'all') return isZh ? '全部' : 'All';
        return isZh ? '本月' : 'This month';
    })();

    sortedFolders.forEach((folder, index) => {
        const folderRow = document.createElement('div');
        folderRow.className = 'ranking-item folder-ranking-item';
        folderRow.style.cursor = 'pointer';
        
        // 排名样式
        let rankClass = '';
        if (index === 0) rankClass = 'rank-gold';
        else if (index === 1) rankClass = 'rank-silver';
        else if (index === 2) rankClass = 'rank-bronze';

        const header = document.createElement('div');
        header.className = 'ranking-header';

        // 排名数字
        const rank = document.createElement('span');
        rank.className = 'ranking-rank';
        rank.textContent = index + 1;
        if (rankClass) rank.classList.add(rankClass);
        header.appendChild(rank);

        // 文件夹图标和名称
        const main = document.createElement('div');
        main.className = 'ranking-main';
        const pathDisplay = folder.fullPath !== folder.name ? folder.fullPath : '';
        main.innerHTML = `
            <div class="ranking-icon" style="color: var(--accent-primary);">
                <i class="fas fa-folder"></i>
            </div>
            <div class="ranking-info">
                <div class="ranking-title" title="${folder.fullPath}">${folder.name}</div>
                <div class="ranking-meta">${pathDisplay ? `${pathDisplay} · ` : ''}${isZh ? `${folder.items.length} 个书签` : `${folder.items.length} bookmarks`}</div>
            </div>
        `;
        header.appendChild(main);

        // 点击次数
        const counts = document.createElement('div');
        counts.className = 'ranking-counts';
        if (rankClass) counts.classList.add(rankClass);
        counts.textContent = folder.count.toLocaleString(isZh ? 'zh-CN' : 'en-US');
        counts.dataset.tooltip = isZh ? `${rangeLabel}：${folder.count} 次` : `${rangeLabel}: ${folder.count} clicks`;
        header.appendChild(counts);

        folderRow.appendChild(header);

        // 展开的书签列表
        const bookmarkList = document.createElement('div');
        bookmarkList.className = 'folder-bookmark-list';
        bookmarkList.style.display = 'none';
        bookmarkList.style.padding = '8px 0 8px 40px';
        bookmarkList.style.borderTop = '1px solid var(--border-color)';
        bookmarkList.style.marginTop = '8px';

        // 按点击次数排序书签
        folder.items.sort((a, b) => b.count - a.count);
        
        folder.items.forEach(item => {
            const bookmarkItem = document.createElement('div');
            bookmarkItem.style.display = 'flex';
            bookmarkItem.style.alignItems = 'center';
            bookmarkItem.style.gap = '8px';
            bookmarkItem.style.padding = '6px 8px';
            bookmarkItem.style.marginBottom = '4px';
            bookmarkItem.style.borderRadius = '4px';
            bookmarkItem.style.cursor = 'pointer';
            bookmarkItem.style.transition = 'background 0.2s';

            bookmarkItem.innerHTML = `
                <img src="${typeof getFaviconUrl === 'function' ? getFaviconUrl(item.url) : `chrome://favicon/${item.url}`}" 
                     style="width:16px;height:16px;flex-shrink:0;" onerror="this.style.display='none'">
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;" 
                      title="${item.title}">${item.title}</span>
                <span style="font-size:11px;color:var(--text-tertiary);flex-shrink:0;">${item.count}</span>
            `;

            bookmarkItem.addEventListener('mouseenter', () => {
                bookmarkItem.style.background = 'var(--bg-tertiary)';
            });
            bookmarkItem.addEventListener('mouseleave', () => {
                bookmarkItem.style.background = 'transparent';
            });
            bookmarkItem.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                    const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
                    if (browserAPI?.tabs?.create) {
                        browserAPI.tabs.create({ url: item.url });
                    } else {
                        window.open(item.url, '_blank');
                    }
                } catch (err) {
                    console.warn('[FolderRanking] 打开书签失败:', err);
                }
            });

            bookmarkList.appendChild(bookmarkItem);
        });

        folderRow.appendChild(bookmarkList);

        // 点击展开/收起
        header.addEventListener('click', () => {
            const isExpanded = bookmarkList.style.display === 'block';
            bookmarkList.style.display = isExpanded ? 'none' : 'block';
            const icon = main.querySelector('.fa-folder, .fa-folder-open');
            if (icon) {
                icon.classList.toggle('fa-folder', isExpanded);
                icon.classList.toggle('fa-folder-open', !isExpanded);
            }
        });

        container.appendChild(folderRow);
    });
}

function renderBrowsingClickRankingList(container, items, range) {
    container.innerHTML = '';

    if (!items.length) {
        const isZh = currentLang === 'zh_CN';
        const title = i18n.browsingRankingEmptyTitle
            ? i18n.browsingRankingEmptyTitle[currentLang]
            : (isZh ? '暂无点击记录' : 'No click records found');
        const desc = i18n.browsingRankingEmptyDescription
            ? i18n.browsingRankingEmptyDescription[currentLang]
            : (isZh ? '当前时间范围内尚未找到这些书签的访问记录。' : 'No visit records were found in the selected time range.');

        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-clock"></i></div>
                <div class="empty-state-title">${title}</div>
                <div class="empty-state-description">${desc}</div>
            </div>
        `;
        return;
    }

    const isZh = currentLang === 'zh_CN';
    const rangeLabel = (() => {
        if (range === 'day') return isZh ? '今天' : 'Today';
        if (range === 'week') return isZh ? '本周' : 'This week';
        if (range === 'year') return isZh ? '本年' : 'This year';
        if (range === 'all') return isZh ? '全部' : 'All';
        return isZh ? '本月' : 'This month';
    })();

    const PAGE_SIZE = 200; // 每次加载200条
    let offset = 0;

    const appendNextPage = () => {
        const end = Math.min(offset + PAGE_SIZE, items.length);
        for (let i = offset; i < end; i++) {
            const entry = items[i];

            const row = document.createElement('div');
            row.className = 'addition-item ranking-item';

            const header = document.createElement('div');
            header.className = 'ranking-item-header';

            const main = document.createElement('div');
            main.className = 'ranking-main';

            const rankSpan = document.createElement('span');
            rankSpan.className = 'ranking-index';
            rankSpan.textContent = i + 1;
            let rankClass = '';
            if (i === 0) {
                rankClass = 'gold';
            } else if (i === 1) {
                rankClass = 'silver';
            } else if (i === 2) {
                rankClass = 'bronze';
            }
            if (rankClass) {
                rankSpan.classList.add(rankClass);
            }

            const icon = document.createElement('img');
            icon.className = 'addition-icon';
            icon.src = getFaviconUrl(entry.url);
            icon.alt = '';

            const info = document.createElement('div');
            info.className = 'addition-info';

            const titleLink = document.createElement('a');
            titleLink.className = 'addition-title';
            titleLink.href = entry.url;
            titleLink.target = '_blank';
            titleLink.rel = 'noopener noreferrer';
            titleLink.textContent = entry.title;

            const urlDiv = document.createElement('div');
            urlDiv.className = 'addition-url';
            urlDiv.textContent = entry.url;

            info.appendChild(titleLink);
            info.appendChild(urlDiv);

            main.appendChild(rankSpan);
            main.appendChild(icon);
            main.appendChild(info);

            const counts = document.createElement('div');
            counts.className = 'ranking-counts';

            // 优先使用筛选后的次数（如果存在）
            const value = entry.filteredCount !== undefined
                ? entry.filteredCount
                : (range === 'day'
                    ? entry.dayCount
                    : range === 'week'
                        ? entry.weekCount
                        : range === 'year'
                            ? entry.yearCount
                            : range === 'all'
                                ? entry.allCount
                                : entry.monthCount);
            const locale = currentLang === 'zh_CN' ? 'zh-CN' : 'en-US';
            const formattedValue = typeof value === 'number'
                ? value.toLocaleString(locale)
                : String(value);
            counts.textContent = formattedValue;

            if (rankClass) {
                counts.classList.add(rankClass);
            }

            const unitLabel = isZh ? '次' : (value === 1 ? 'click' : 'clicks');
            const accessibleLabel = isZh
                ? `${rangeLabel}：${value} ${unitLabel}`
                : `${rangeLabel}: ${value} ${unitLabel}`;
            counts.dataset.tooltip = accessibleLabel;
            counts.setAttribute('aria-label', accessibleLabel);

            header.appendChild(main);

            // 跳转按钮容器（点击次数左边）
            const jumpBtnContainer = document.createElement('div');
            jumpBtnContainer.className = 'jump-to-related-btn-container';
            jumpBtnContainer.style.display = 'flex';
            jumpBtnContainer.style.alignItems = 'center';
            jumpBtnContainer.style.flexShrink = '0';

            const jumpBtn = document.createElement('button');
            jumpBtn.className = 'jump-to-related-btn';
            jumpBtn.dataset.tooltip = isZh ? '跳转至关联记录' : 'Jump to Related History';
            jumpBtn.innerHTML = '<i class="fas fa-external-link-alt"></i>';
            jumpBtn.dataset.url = entry.url;
            jumpBtn.dataset.title = entry.title;
            jumpBtn.dataset.range = range;
            
            jumpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (typeof jumpToRelatedHistoryFromRanking === 'function') {
                    jumpToRelatedHistoryFromRanking(entry.url, entry.title, range);
                }
            });
            
            // 容器也阻止事件冒泡
            jumpBtnContainer.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            jumpBtnContainer.appendChild(jumpBtn);
            header.appendChild(jumpBtnContainer);

            header.appendChild(counts);

            const detail = document.createElement('div');
            detail.className = 'ranking-detail';
            detail.style.display = 'none';

            const lastVisitText = entry.lastVisitTime
                ? new Date(entry.lastVisitTime).toLocaleString()
                : (isZh ? '无访问记录' : 'No visits');

            if (isZh) {
                detail.textContent =
                    `今天：${entry.dayCount} 次，本周：${entry.weekCount} 次，本月：${entry.monthCount} 次，本年：${entry.yearCount} 次；` +
                    `最近访问：${lastVisitText}`;
            } else {
                detail.textContent =
                    `Today: ${entry.dayCount} clicks, This week: ${entry.weekCount} clicks, ` +
                    `This month: ${entry.monthCount} clicks, This year: ${entry.yearCount} clicks; ` +
                    `Last visit: ${lastVisitText}`;
            }

            row.appendChild(header);
            row.appendChild(detail);

            // 整行可点击：展开/收起详细统计，同时打开书签
            row.addEventListener('click', (e) => {
                // 如果直接点击的是标题链接，让浏览器默认打开，不拦截
                if (e.target === titleLink) {
                    return;
                }
                
                // 如果点击的是跳转按钮或其容器，不执行打开书签操作
                if (e.target.closest('.jump-to-related-btn-container') || 
                    e.target.closest('.jump-to-related-btn')) {
                    return;
                }

                e.preventDefault();

                const visible = detail.style.display === 'block';
                detail.style.display = visible ? 'none' : 'block';

                try {
                    if (browserAPI && browserAPI.tabs && typeof browserAPI.tabs.create === 'function') {
                        browserAPI.tabs.create({ url: entry.url });
                    } else {
                        window.open(entry.url, '_blank');
                    }
                } catch (err) {
                    console.warn('[BrowsingRanking] 打开书签失败:', err);
                }
            });

            container.appendChild(row);
        }

        offset = end;
    };

    appendNextPage();

    // 找到真正的滚动容器（.content-area）
    const scrollContainer = container.closest('.content-area') || container;
    
    const onScroll = () => {
        if (offset >= items.length) return;
        const threshold = 300; // 距底部 300px 内加载下一页
        if (scrollContainer.scrollTop + scrollContainer.clientHeight + threshold >= scrollContainer.scrollHeight) {
            appendNextPage();
        }
    };

    // 清理旧的监听器
    if (scrollContainer.__browsingRankingScrollHandler) {
        scrollContainer.removeEventListener('scroll', scrollContainer.__browsingRankingScrollHandler);
    }
    scrollContainer.addEventListener('scroll', onScroll);
    scrollContainer.__browsingRankingScrollHandler = onScroll;
    
    // 暴露懒加载状态和函数，供跳转功能使用
    container.__lazyLoadState = {
        totalItems: items.length,
        getLoadedCount: () => offset,
        loadMore: appendNextPage,
        loadAll: () => {
            while (offset < items.length) {
                appendNextPage();
            }
        }
    };
}

async function loadBrowsingClickRanking(range) {
    const listContainer = document.getElementById('browsingRankingList');
    if (!listContainer) return;

    // 显示加载状态
    const isZh = currentLang === 'zh_CN';
    const loadingText = isZh ? '正在读取历史记录...' : 'Loading history...';
    listContainer.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="fas fa-clock"></i></div>
            <div class="empty-state-title">${loadingText}</div>
        </div>
    `;

    try {
        const stats = await ensureBrowsingClickRankingStats();

        if (stats.error === 'noHistoryApi') {
            const title = i18n.browsingRankingNotSupportedTitle
                ? i18n.browsingRankingNotSupportedTitle[currentLang]
                : (isZh ? '当前环境不支持历史记录统计' : 'History statistics are not available in this environment');
            const desc = i18n.browsingRankingNotSupportedDesc
                ? i18n.browsingRankingNotSupportedDesc[currentLang]
                : (isZh ? '请确认扩展已获得浏览器的历史记录权限。' : 'Please ensure the extension has permission to access browser history.');

            listContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-ban"></i></div>
                    <div class="empty-state-title">${title}</div>
                    <div class="empty-state-description">${desc}</div>
                </div>
            `;
            return;
        }

        if (stats.error === 'noBookmarks') {
            const title = i18n.browsingRankingNoBookmarksTitle
                ? i18n.browsingRankingNoBookmarksTitle[currentLang]
                : (isZh ? '暂无书签可统计' : 'No bookmarks to analyze');

            listContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-bookmark"></i></div>
                    <div class="empty-state-title">${title}</div>
                </div>
            `;
            return;
        }

        let items = getBrowsingRankingItemsForRange(range);
        
        // 应用二级菜单时间筛选
        if (browsingRankingTimeFilter && items.length > 0) {
            items = filterRankingItemsByTime(items, browsingRankingTimeFilter, stats.boundaries);
        }
        
        // 根据视图模式渲染
        initBrowsingRankingViewMode();
        if (browsingRankingViewMode === 'folder') {
            await renderBrowsingFolderRankingList(listContainer, items, range, stats);
        } else {
            renderBrowsingClickRankingList(listContainer, items, range);
        }
    } catch (error) {
        console.error('[BrowsingRanking] 加载点击排行失败:', error);
        const fallbackTitle = isZh ? '加载点击排行失败' : 'Failed to load click ranking';
        listContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-exclamation-circle"></i></div>
                <div class="empty-state-title">${fallbackTitle}</div>
            </div>
        `;
    }
}

function initBrowsingClickRanking() {
    const panel = document.getElementById('browsingRankingPanel');
    if (!panel) return;

    const buttons = panel.querySelectorAll('.ranking-time-filter-btn');
    if (!buttons.length) return;

    const allowedRanges = ['day', 'week', 'month', 'year', 'all'];

    const setActiveRange = (range, shouldPersist = true) => {
        if (!allowedRanges.includes(range)) {
            range = 'month';
        }

        buttons.forEach(btn => {
            if (btn.dataset.range === range) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // 显示时间菜单
        showBrowsingRankingTimeMenu(range);
        
        loadBrowsingClickRanking(range);

        if (shouldPersist) {
            try {
                localStorage.setItem('browsingRankingActiveRange', range);
            } catch (storageErr) {
                console.warn('[BrowsingRanking] 无法保存筛选范围:', storageErr);
            }
        }
    };

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const range = btn.dataset.range || 'month';
            setActiveRange(range);
        });
    });

    let initialRange = 'day';
    try {
        const saved = localStorage.getItem('browsingRankingActiveRange');
        if (saved && allowedRanges.includes(saved)) {
            initialRange = saved;
        }
    } catch (storageErr) {
        console.warn('[BrowsingRanking] 无法读取筛选范围:', storageErr);
    }

    setActiveRange(initialRange, false);
}

function getActiveBrowsingRankingRange() {
    const panel = document.getElementById('browsingRankingPanel');
    if (!panel) return null;
    const activeBtn = panel.querySelector('.ranking-time-filter-btn.active');
    return activeBtn ? (activeBtn.dataset.range || 'month') : null;
}

async function refreshActiveBrowsingRankingIfVisible() {
    const panel = document.getElementById('browsingRankingPanel');
    if (!panel || !panel.classList.contains('active')) return;
    
    // ✨ 等待日历数据同步完成（防止显示空白）
    const waitForCalendarData = async () => {
        const start = Date.now();
        const timeout = 2000; // 2秒超时
        while (Date.now() - start < timeout) {
            const inst = window.browsingHistoryCalendarInstance;
            if (inst && inst.bookmarksByDate && inst.bookmarksByDate.size > 0) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    };
    
    const dataReady = await waitForCalendarData();
    if (!dataReady) {
        console.warn('[BrowsingRanking] 等待日历数据超时');
    }
    
    const range = getActiveBrowsingRankingRange() || 'month';
    loadBrowsingClickRanking(range);
}

document.addEventListener('browsingHistoryCacheUpdated', () => {
    console.log('[Event] browsingHistoryCacheUpdated 触发，刷新所有浏览记录相关页面');
    browsingClickRankingStats = null;
    refreshActiveBrowsingRankingIfVisible();
    refreshBrowsingRelatedHistory(); // 同时刷新书签关联页面
});

function groupBookmarksByTime(bookmarks, timeFilter) {
    const groups = {};

    bookmarks.forEach(bookmark => {
        const date = new Date(bookmark.dateAdded);
        let groupKey;

        switch (timeFilter) {
            case 'year':
                groupKey = date.getFullYear().toString();
                break;
            case 'month':
                groupKey = currentLang === 'zh_CN'
                    ? `${date.getFullYear()}年${date.getMonth() + 1}月`
                    : `${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}`;
                break;
            case 'day':
            case 'all':
            default:
                groupKey = date.toLocaleDateString(currentLang === 'en' ? 'en-US' : 'zh-CN');
                break;
        }

        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(bookmark);
    });

    return groups;
}

// 保留旧函数用于兼容
function groupBookmarksByDate(bookmarks) {
    return groupBookmarksByTime(bookmarks, 'day');
}

function filterBookmarks(groups) {
    if (currentFilter === 'all') return groups;

    const filtered = {};

    Object.entries(groups).forEach(([date, bookmarks]) => {
        const filteredBookmarks = bookmarks.filter(b => {
            const isBackedUp = isBookmarkBackedUp(b);
            return currentFilter === 'backed-up' ? isBackedUp : !isBackedUp;
        });

        if (filteredBookmarks.length > 0) {
            filtered[date] = filteredBookmarks;
        }
    });

    return filtered;
}

function isBookmarkBackedUp(bookmark) {
    if (!lastBackupTime) return false;
    // 书签添加时间早于或等于最后备份时间，说明已备份
    return bookmark.dateAdded <= lastBackupTime;
}

function renderBookmarkGroups(groups, timeFilter) {
    const sortedDates = Object.keys(groups).sort((a, b) => {
        // 根据timeFilter决定排序方式
        if (timeFilter === 'year') {
            return parseInt(b) - parseInt(a);
        }
        return new Date(b) - new Date(a);
    });

    return sortedDates.map((date, index) => {
        const bookmarks = groups[date];
        const groupId = `group-${index}`;
        // 默认折叠
        const isExpanded = false;

        return `
            <div class="addition-group" data-group-id="${groupId}">
                <div class="addition-group-header" data-group-id="${groupId}">
                    <div class="addition-group-title">
                        <i class="fas fa-chevron-right addition-group-toggle ${isExpanded ? 'expanded' : ''}"></i>
                        <span class="addition-group-date">${date}</span>
                        <span class="addition-count">${bookmarks.length} ${i18n.bookmarks[currentLang]}</span>
                    </div>
                </div>
                <div class="addition-items ${isExpanded ? 'expanded' : ''}" data-group-id="${groupId}">
                    ${bookmarks.map(renderBookmarkItem).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// 绑定折叠/展开事件
function attachAdditionGroupEvents() {
    document.querySelectorAll('.addition-group-header').forEach(header => {
        header.addEventListener('click', (e) => {
            const groupId = header.getAttribute('data-group-id');
            const items = document.querySelector(`.addition-items[data-group-id="${groupId}"]`);
            const toggle = header.querySelector('.addition-group-toggle');

            if (items && toggle) {
                items.classList.toggle('expanded');
                toggle.classList.toggle('expanded');
            }
        });
    });
}

function renderBookmarkItem(bookmark) {
    const isBackedUp = isBookmarkBackedUp(bookmark);
    const favicon = getFaviconUrl(bookmark.url);

    return `
        <div class="addition-item" data-bookmark-url="${escapeHtml(bookmark.url)}">
            <img class="addition-icon" src="${favicon}" alt="">
            <div class="addition-info">
                <a href="${escapeHtml(bookmark.url)}" target="_blank" class="addition-title" rel="noopener noreferrer">${escapeHtml(bookmark.title)}</a>
                <div class="addition-url">${escapeHtml(bookmark.url)}</div>
            </div>
            <span class="addition-status ${isBackedUp ? 'backed-up' : 'not-backed-up'}">
                ${isBackedUp ? i18n.backedUp[currentLang] : i18n.notBackedUp[currentLang]}
            </span>
        </div>
    `;
}

// =============================================================================
// 书签树视图
// =============================================================================

let treeChangeMap = null; // 缓存变动映射
let cachedTreeData = null; // 缓存树数据
let cachedOldTree = null; // 缓存旧树数据
let cachedCurrentTree = null; // 缓存当前树数据（用于智能路径检测）
let lastTreeFingerprint = null; // 上次树的指纹

// 生成书签树指纹（快速哈希）
function getTreeFingerprint(tree) {
    if (!tree || !tree[0]) return '';

    // 只提取关键信息生成指纹
    const extractKey = (node) => {
        const key = {
            i: node.id,
            t: node.title,
            u: node.url,
            p: node.parentId,
            x: node.index
        };
        if (node.children) {
            key.c = node.children.map(extractKey);
        }
        return key;
    };

    return JSON.stringify(extractKey(tree[0]));
}

// 计算节点在指定树中的“索引地址路径”（示例：/1/2/3），从根的第一层开始使用 1 基索引
function getIndexAddressPathFromTree(tree, targetId) {
    try {
        if (!tree || !tree[0]) return '';
        // 构建 id -> node 快速索引
        const map = new Map();
        (function build(n) {
            if (!n) return;
            map.set(n.id, n);
            if (n.children) n.children.forEach(build);
        })(tree[0]);

        const target = map.get(targetId);
        if (!target) return '';
        const segments = [];
        let cur = target;
        // 将当前节点的 index+1 放入，逐层向上直到父为 '0' 或无父
        while (cur && typeof cur.index === 'number') {
            segments.push(cur.index + 1);
            const pid = cur.parentId;
            if (!pid || pid === '0') break;
            cur = map.get(pid);
        }
        // 如果父为 '0'，还需要把顶层容器自身的 index+1 也包含（cur 即顶层容器）
        if (cur && typeof cur.parentId !== 'undefined' && cur.parentId === '0' && typeof cur.index === 'number') {
            // 已经在循环中加入了 cur 的 index+1（作为上一轮child），此处不重复
        }
        return segments.length ? ('/' + segments.reverse().join('/')) : '';
    } catch (_) {
        return '';
    }
}

// 计算“旧位置”的索引地址路径：优先从 cachedOldTree 获取；失败返回空串
function getOldIndexAddressForNode(nodeId) {
    if (!nodeId) return '';
    try {
        if (cachedOldTree && cachedOldTree[0]) {
            return getIndexAddressPathFromTree(cachedOldTree, nodeId);
        }
    } catch (_) { }
    return '';
}

// ============ 名称路径（按文件夹名称，不含数字） ============
function getNamedPathFromTree(tree, targetId) {
    try {
        if (!tree || !tree[0]) return '';
        const path = [];
        const dfs = (node, cur) => {
            if (!node) return false;
            if (node.id === String(targetId)) { path.push(...cur, node.title); return true; }
            if (node.children) {
                for (const c of node.children) {
                    if (dfs(c, [...cur, node.title])) return true;
                }
            }
            return false;
        };
        dfs(tree[0], []);
        return path.join(' > ');
    } catch (_) { return ''; }
}

function breadcrumbToSlashFolders(bc) {
    if (!bc) return '';
    const parts = bc.split(' > ').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    // 只取文件夹路径：去掉最后一级（当前节点名）
    if (parts.length > 1) parts.pop(); else return '/';
    return '/' + parts.join('/');
}

function breadcrumbToSlashFull(bc) {
    if (!bc) return '/';
    const parts = bc.split(' > ').map(s => s.trim()).filter(Boolean);
    return parts.length ? ('/' + parts.join('/')) : '/';
}

// 将 "/A/B/C" 转为带矩形片段的 HTML（用于 move tooltip）
function slashPathToChipsHTML(slashPath) {
    try {
        if (!slashPath || typeof slashPath !== 'string') return '<span class="breadcrumb-item">/</span>';
        const parts = slashPath.split('/').filter(Boolean);
        if (parts.length === 0) return '<span class="breadcrumb-item">/</span>';
        const chips = parts.map((p, i) => {
            const safe = escapeHtml(p);
            return `<span class="breadcrumb-item">${safe}</span>`;
        });
        const sep = '<span class="breadcrumb-separator">/</span>';
        return chips.join(sep);
    } catch (_) {
        return '<span class="breadcrumb-item">/</span>';
    }
}

// 基于“旧父ID + 旧index”从当前树推导旧地址（避免必须完整旧树）
function getOldAddressFromParentAndIndex(oldParentId, oldIndex) {
    try {
        if (typeof oldParentId === 'undefined' || oldParentId === null) return '';
        const base = (cachedCurrentTree && cachedCurrentTree[0]) ? cachedCurrentTree : (cachedOldTree && cachedOldTree[0] ? cachedOldTree : null);
        if (!base) return '';
        const parentPath = getIndexAddressPathFromTree(base, String(oldParentId));
        if (!parentPath) return '';
        const childSeg = (typeof oldIndex === 'number') ? ('/' + (oldIndex + 1)) : '';
        return parentPath + childSeg;
    } catch (_) { return ''; }
}

async function renderTreeView(forceRefresh = false) {
    console.log('[renderTreeView] 开始渲染, forceRefresh:', forceRefresh);
    // 记录永久栏目滚动位置，渲染后恢复
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;

    const treeContainer = document.getElementById('bookmarkTree');

    if (!treeContainer) {
        console.error('[renderTreeView] 容器元素未找到');
        return;
    }

    console.log('[renderTreeView] 容器元素已找到');

    // 如果已有缓存且不强制刷新，直接使用（快速路径）
    if (!forceRefresh && cachedTreeData && cachedTreeData.treeFragment) {
        console.log('[renderTreeView] 使用现有缓存（快速显示）');
        treeContainer.innerHTML = '';
        treeContainer.appendChild(cachedTreeData.treeFragment.cloneNode(true));
        treeContainer.style.display = 'block';

        // 重新绑定事件
        attachTreeEvents(treeContainer);

        console.log('[renderTreeView] 缓存显示完成');
        // 恢复滚动位置
        if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;

        // 【关键修复】即使使用缓存，也要预热内存缓存
        // 因为内存缓存可能在页面刷新后被清空，导致图标显示为五角星
        // 预热完成后会自动更新页面上的图标
        (async () => {
            try {
                // 获取当前书签树
                const currentTree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
                if (currentTree && currentTree.length > 0) {
                    // 收集所有书签URL
                    const allBookmarkUrls = [];
                    const collectUrls = (nodes) => {
                        if (!nodes) return;
                        nodes.forEach(node => {
                            if (node.url) allBookmarkUrls.push(node.url);
                            if (node.children) collectUrls(node.children);
                        });
                    };
                    collectUrls(currentTree);

                    if (allBookmarkUrls.length > 0) {
                        await warmupFaviconCache(allBookmarkUrls);

                        // 预热完成后，更新页面上所有使用fallback图标的img标签
                        allBookmarkUrls.forEach(url => {
                            try {
                                const urlObj = new URL(url);
                                const domain = urlObj.hostname;
                                const cachedFavicon = FaviconCache.memoryCache.get(domain);
                                if (cachedFavicon && cachedFavicon !== fallbackIcon) {
                                    updateFaviconImages(url, cachedFavicon);
                                }
                            } catch (e) {
                                // 忽略无效URL
                            }
                        });

                        console.log('[renderTreeView] 快速路径预热完成，已更新图标');
                    }
                }
            } catch (e) {
                console.warn('[renderTreeView] 快速路径预热失败:', e);
            }
        })();

        return;
    }

    // 没有缓存，显示加载状态
    console.log('[renderTreeView] 无缓存，开始加载数据');
    treeContainer.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    treeContainer.style.display = 'block';

    // 获取数据并行处理
    Promise.all([
        new Promise(resolve => browserAPI.bookmarks.getTree(resolve)),
        new Promise(resolve => browserAPI.storage.local.get(['lastBookmarkData'], resolve))
    ]).then(async ([currentTree, storageData]) => {
        if (!currentTree || currentTree.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-sitemap"></i></div>
                    <div class="empty-state-title">${i18n.emptyTree[currentLang]}</div>
                </div>
            `;
            return;
        }

        // 生成当前树的指纹
        const currentFingerprint = getTreeFingerprint(currentTree);

        // 如果指纹相同，直接使用缓存（树没有变化）
        if (cachedTreeData && currentFingerprint === lastTreeFingerprint) {
            console.log('[renderTreeView] 使用缓存（书签未变化）');
            treeContainer.innerHTML = '';
            treeContainer.appendChild(cachedTreeData.treeFragment.cloneNode(true));
            treeContainer.style.display = 'block';

            // 重新绑定事件
            attachTreeEvents(treeContainer);
            // 恢复滚动位置
            if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
            return;
        }

        // 树有变化，重新渲染
        console.log('[renderTreeView] 检测到书签变化，重新渲染');

        const oldTree = storageData.lastBookmarkData && storageData.lastBookmarkData.bookmarkTree;
        cachedOldTree = oldTree;
        cachedCurrentTree = currentTree; // 缓存当前树，用于智能路径检测

        // 【关键修复】预热 favicon 缓存 - 从 IndexedDB 批量加载到内存
        // 收集所有书签URL
        const allBookmarkUrls = [];
        const collectUrls = (nodes) => {
            if (!nodes) return;
            nodes.forEach(node => {
                if (node.url) {
                    allBookmarkUrls.push(node.url);
                }
                if (node.children) {
                    collectUrls(node.children);
                }
            });
        };
        collectUrls(currentTree);

        // 批量预热缓存（等待完成，确保渲染时缓存已就绪）
        if (allBookmarkUrls.length > 0) {
            try {
                await warmupFaviconCache(allBookmarkUrls);
            } catch (e) {
                console.warn('[renderTreeView] favicon缓存预热失败，继续渲染:', e);
            }
        }

        // 快速检测变动（只在有备份数据时才检测）
        console.log('[renderTreeView] oldTree 存在:', !!oldTree);
        console.log('[renderTreeView] oldTree[0] 存在:', !!(oldTree && oldTree[0]));

        if (oldTree && oldTree[0]) {
            console.log('[renderTreeView] 开始检测变动...');
            treeChangeMap = await detectTreeChangesFast(oldTree, currentTree);
            console.log('[renderTreeView] 检测到的变动数量:', treeChangeMap.size);

            // 打印前5个变动
            let count = 0;
            for (const [id, change] of treeChangeMap) {
                if (count++ < 5) {
                    console.log('[renderTreeView] 变动:', id, change);
                }
            }
        } else {
            treeChangeMap = new Map(); // 无备份数据，不显示任何变化标记
            console.log('[renderTreeView] 无上次备份数据，不显示变化标记');
        }

        // 合并旧树和新树，显示删除的节点
        let treeToRender = currentTree;
        if (oldTree && oldTree[0] && treeChangeMap && treeChangeMap.size > 0) {
            console.log('[renderTreeView] 合并旧树和新树以显示删除的节点');
            try {
                treeToRender = rebuildTreeWithDeleted(oldTree, currentTree, treeChangeMap);
            } catch (error) {
                console.error('[renderTreeView] 重建树时出错:', error);
                treeToRender = currentTree; // 回退到原始树
            }
        }

        // 使用 DocumentFragment 优化渲染
        const fragment = document.createDocumentFragment();

        // 只在有变化时才显示图例
        if (treeChangeMap.size > 0) {
            const legend = document.createElement('div');
            legend.className = 'tree-legend';
            legend.innerHTML = `
                <span class="legend-item"><span class="legend-dot added"></span> ${currentLang === 'zh_CN' ? '新增' : 'Added'}</span>
                <span class="legend-item"><span class="legend-dot deleted"></span> ${currentLang === 'zh_CN' ? '删除' : 'Deleted'}</span>
                <span class="legend-item"><span class="legend-dot modified"></span> ${currentLang === 'zh_CN' ? '修改' : 'Modified'}</span>
                <span class="legend-item"><span class="legend-dot moved"></span> ${currentLang === 'zh_CN' ? '移动' : 'Moved'}</span>
            `;
            fragment.appendChild(legend);
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTreeNodeWithChanges(treeToRender[0], 0);
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }

        // 更新缓存
        cachedTreeData = {
            treeFragment: fragment.cloneNode(true),
            currentTree: currentTree
        };
        lastTreeFingerprint = currentFingerprint;

        treeContainer.innerHTML = '';
        treeContainer.appendChild(fragment);
        treeContainer.style.display = 'block';

        // 绑定事件
        attachTreeEvents(treeContainer);

        console.log('[renderTreeView] 渲染完成');
        // 恢复滚动位置
        if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
    }).catch(error => {
        console.error('[renderTreeView] 错误:', error);
        treeContainer.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
        treeContainer.style.display = 'block';
    });
}

// 树事件处理器映射（避免重复绑定）
const treeClickHandlers = new WeakMap();

// 绑定树的展开/折叠事件
function attachTreeEvents(treeContainer) {
    // 移除旧的事件监听器
    const existingHandler = treeClickHandlers.get(treeContainer);
    if (existingHandler) {
        treeContainer.removeEventListener('click', existingHandler);
    }

    // 创建新的事件处理器
    const clickHandler = (e) => {
        // 处理移动标记的点击
        const moveBadge = e.target.closest('.change-badge.moved');
        if (moveBadge) {
            e.stopPropagation();
            let fromPath = moveBadge.getAttribute('data-move-from') || moveBadge.getAttribute('title');
            if (!fromPath) {
                const tooltipEl = moveBadge.querySelector('.move-tooltip');
                fromPath = tooltipEl ? (tooltipEl.textContent || '').trim() : '';
            }
            if (!fromPath) {
                try {
                    const item = moveBadge.closest('.tree-item');
                    const nodeId = item ? item.getAttribute('data-node-id') : null;
                    if (nodeId && cachedOldTree) {
                        const bc = getNamedPathFromTree(cachedOldTree, nodeId);
                        fromPath = breadcrumbToSlashFolders(bc);
                    }
                } catch (_) { }
            }
            if (!fromPath) fromPath = '/';
            const message = currentLang === 'zh_CN'
                ? `原位置：\n${fromPath}`
                : `Original location:\n${fromPath}`;
            alert(message);
            return;
        }

        // 点击整个文件夹行都可以展开
        const treeItem = e.target.closest('.tree-item');
        if (treeItem) {
            // 找到包含这个tree-item的tree-node
            const node = treeItem.parentElement;
            if (!node || !node.classList.contains('tree-node')) {
                console.log('[树事件] 未找到tree-node');
                return;
            }

            const children = node.querySelector('.tree-children');
            const toggle = node.querySelector('.tree-toggle');

            console.log('[树事件] 点击节点:', {
                hasChildren: !!children,
                hasToggle: !!toggle,
                nodeHTML: node.outerHTML.substring(0, 200)
            });

            if (children && toggle) {
                e.stopPropagation();
                children.classList.toggle('expanded');
                toggle.classList.toggle('expanded');

                console.log('[树事件] 切换展开状态:', toggle.classList.contains('expanded'));

                // 保存展开状态
                saveTreeExpandState(treeContainer);
            }
        }
    };

    // 绑定新的事件监听器
    treeContainer.addEventListener('click', clickHandler);
    treeClickHandlers.set(treeContainer, clickHandler);

    // 左键点击书签标签，根据默认打开方式打开
    treeContainer.addEventListener('click', async (e) => {
        const link = e.target.closest('a.tree-bookmark-link');
        if (!link || !treeContainer.contains(link)) return;
        // 尊重系统快捷键：Ctrl/Cmd/Shift 走浏览器默认行为
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const url = link.getAttribute('href');
        const nodeElement = link.closest('.tree-item[data-node-id]');
        const contextInfo = nodeElement ? {
            treeType: nodeElement.dataset.treeType || 'permanent',
            sectionId: nodeElement.dataset.sectionId || null,
            nodeId: nodeElement.dataset.nodeId || null
        } : { treeType: 'permanent' };
        try {
            // 从全局函数中调用（由 context_menu 文件定义）
            if (window.defaultOpenMode === undefined && typeof window.getDefaultOpenMode === 'function') {
                // 兼容：如果提供 getter
                window.defaultOpenMode = window.getDefaultOpenMode();
            }
        } catch (_) { }
        const mode = (typeof window !== 'undefined' && window.defaultOpenMode) || (typeof defaultOpenMode !== 'undefined' ? defaultOpenMode : 'new-tab');

        // 防抖检查：使用与右键菜单相同的防抖机制
        const actionKey = `left-click-${mode}-${url}`;
        if (typeof shouldAllowBookmarkOpen === 'function' && !shouldAllowBookmarkOpen(actionKey)) {
            return; // 被防抖忽略
        }

        if (mode === 'new-window') {
            if (typeof openBookmarkNewWindow === 'function') openBookmarkNewWindow(url, false); else window.open(url, '_blank');
        } else if (mode === 'incognito') {
            if (typeof openBookmarkNewWindow === 'function') openBookmarkNewWindow(url, true); else window.open(url, '_blank');
        } else if (mode === 'specific-window') {
            if (typeof openInSpecificWindow === 'function') openInSpecificWindow(url); else window.open(url, '_blank');
        } else if (mode === 'specific-group') {
            if (typeof openInSpecificTabGroup === 'function') openInSpecificTabGroup(url); else window.open(url, '_blank');
        } else if (mode === 'scoped-window') {
            if (typeof openInScopedWindow === 'function') openInScopedWindow(url, { context: contextInfo }); else window.open(url, '_blank');
        } else if (mode === 'scoped-group') {
            if (typeof openInScopedTabGroup === 'function') openInScopedTabGroup(url, { context: contextInfo }); else window.open(url, '_blank');
        } else if (mode === 'same-window-specific-group') {
            if (typeof openInSameWindowSpecificGroup === 'function') openInSameWindowSpecificGroup(url, { context: contextInfo }); else window.open(url, '_blank');
        } else {
            if (typeof openBookmarkNewTab === 'function') openBookmarkNewTab(url); else window.open(url, '_blank');
        }
    });

    // 绑定右键菜单事件
    const treeItems = treeContainer.querySelectorAll('.tree-item[data-node-id]');
    treeItems.forEach(item => {
        item.addEventListener('contextmenu', (e) => {
            if (typeof showContextMenu === 'function') {
                showContextMenu(e, item);
            }
        });
    });

    // 绑定拖拽事件
    if (typeof attachDragEvents === 'function') {
        attachDragEvents(treeContainer);
    }

    // 绑定指针拖拽事件（支持滚轮滚动）
    if (typeof attachPointerDragEvents === 'function') {
        attachPointerDragEvents(treeContainer);
        console.log('[树事件] 指针拖拽事件已绑定');
    }

    // 如果在Canvas视图，重新绑定Canvas拖出功能
    if (currentView === 'canvas' && window.CanvasModule && window.CanvasModule.enhance) {
        console.log('[树事件] 当前在Canvas视图，重新绑定Canvas拖出功能');
        window.CanvasModule.enhance();
    }

    console.log('[树事件] 事件绑定完成');

    // 恢复展开状态
    restoreTreeExpandState(treeContainer);
}

// 保存JSON滚动位置
function saveJSONScrollPosition(jsonContainer) {
    try {
        const content = jsonContainer.querySelector('.json-diff-content');
        if (content) {
            const scrollTop = content.scrollTop;
            localStorage.setItem('jsonScrollPosition', scrollTop.toString());
            console.log('[JSON状态] 保存滚动位置:', scrollTop);
        }
    } catch (e) {
        console.error('[JSON状态] 保存滚动位置失败:', e);
    }
}

// 恢复JSON滚动位置
function restoreJSONScrollPosition(jsonContainer) {
    try {
        const savedPosition = localStorage.getItem('jsonScrollPosition');
        if (savedPosition) {
            const content = jsonContainer.querySelector('.json-diff-content');
            if (content) {
                content.scrollTop = parseInt(savedPosition, 10);
                console.log('[JSON状态] 恢复滚动位置:', savedPosition);
            }
        }
    } catch (e) {
        console.error('[JSON状态] 恢复滚动位置失败:', e);
    }
}

// 保存树的展开状态
function saveTreeExpandState(treeContainer) {
    try {
        const expandedPaths = [];
        treeContainer.querySelectorAll('.tree-children.expanded').forEach(children => {
            const node = children.closest('.tree-node');
            const label = node.querySelector('.tree-label');
            if (label) {
                expandedPaths.push(label.textContent.trim());
            }
        });
        localStorage.setItem('treeExpandedNodes', JSON.stringify(expandedPaths));
        console.log('[树状态] 保存展开节点:', expandedPaths.length);
    } catch (e) {
        console.error('[树状态] 保存失败:', e);
    }
}

// 恢复树的展开状态
function restoreTreeExpandState(treeContainer) {
    try {
        const savedState = localStorage.getItem('treeExpandedNodes');
        if (!savedState) return;

        const expandedPaths = JSON.parse(savedState);
        expandedPaths.forEach(path => {
            const labels = treeContainer.querySelectorAll('.tree-label');
            labels.forEach(label => {
                if (label.textContent.trim() === path) {
                    const node = label.closest('.tree-node');
                    const children = node.querySelector('.tree-children');
                    const toggle = node.querySelector('.tree-toggle');
                    if (children && toggle) {
                        children.classList.add('expanded');
                        toggle.classList.add('expanded');
                    }
                }
            });
        });
        console.log('[树状态] 恢复展开节点:', expandedPaths.length);
    } catch (e) {
        console.error('[树状态] 恢复失败:', e);
    }
}

// 快速检测书签树变动（性能优化版 + 智能移动检测）
async function detectTreeChangesFast(oldTree, newTree) {
    const changes = new Map();
    if (!oldTree || !newTree) return changes;

    const oldNodes = new Map();
    const newNodes = new Map();
    const oldByParent = new Map(); // parentId -> [{id,index}]
    const newByParent = new Map();

    const traverse = (node, map, byParent, parentId = null) => {
        if (node && node.id) {
            const record = {
                title: node.title,
                url: node.url,
                parentId: node.parentId || parentId,
                index: node.index
            };
            map.set(node.id, record);
            if (record.parentId) {
                if (!byParent.has(record.parentId)) byParent.set(record.parentId, []);
                byParent.get(record.parentId).push({ id: node.id, index: record.index });
            }
        }
        if (node && node.children) node.children.forEach(child => traverse(child, map, byParent, node.id));
    };

    if (oldTree[0]) traverse(oldTree[0], oldNodes, oldByParent, null);
    if (newTree[0]) traverse(newTree[0], newNodes, newByParent, null);

    const getNodePath = (tree, targetId) => {
        const path = [];
        const dfs = (node, cur) => {
            if (!node) return false;
            if (node.id === targetId) { path.push(...cur, node.title); return true; }
            if (node.children) {
                for (const c of node.children) { if (dfs(c, [...cur, node.title])) return true; }
            }
            return false;
        };
        if (tree[0]) dfs(tree[0], []);
        return path.join(' > ');
    };

    // 新增 / 修改 / 跨级移动
    newNodes.forEach((n, id) => {
        const o = oldNodes.get(id);
        if (!o) { changes.set(id, { type: 'added' }); return; }
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
    oldNodes.forEach((_, id) => { if (!newNodes.has(id)) changes.set(id, { type: 'deleted' }); });

    // 建立"有add/delete操作的父级"集合（关键优化：避免因为add/delete导致的被动位置改变被错误标记为moved）
    const parentsWithAddDelete = new Set();
    changes.forEach((change, id) => {
        if (change.type.includes('added') || change.type.includes('deleted')) {
            const node = change.type.includes('added') ? newNodes.get(id) : oldNodes.get(id);
            if (node && node.parentId) {
                parentsWithAddDelete.add(node.parentId);
            }
        }
    });

    // 同级移动（重要：仅标记真正被拖动的那个，其他由于位置改变的项不标记）
    // 原因：这里只是视觉标识，不是实际diff。只标记用户拖拽的对象
    // 优化：如果该父级有add/delete操作，则不标记任何同级节点为moved（因为这些位置改变是被动的）
    newByParent.forEach((newList, parentId) => {
        // 优化：如果该父级有add/delete操作，跳过同级移动判断（避免被动位置改变被标记为moved）
        if (parentsWithAddDelete.has(parentId)) {
            return;
        }

        const oldList = oldByParent.get(parentId) || [];
        if (oldList.length === 0 || newList.length === 0) return;

        // 构建旧索引映射
        const oldIndexMap = new Map(oldList.map(({ id, index }) => [id, index]));

        // 收集所有位置改变的候选项
        const candidates = [];
        for (const { id, index } of newList) {
            if (!oldIndexMap.has(id)) continue;
            const oldIdx = oldIndexMap.get(id);
            if (typeof oldIdx === 'number' && typeof index === 'number' && oldIdx !== index) {
                candidates.push({ id, delta: Math.abs(index - oldIdx), dir: index - oldIdx });
            }
        }
        if (candidates.length === 0) return;

        // 选择唯一的"被移动"节点：
        // 1. 优先从显式移动集合中选取（用户拖拽时设置）
        // 2. 否则选择位移量最大的（最有可能是被拖拽的）
        let picked = candidates.find(c =>
            explicitMovedIds && explicitMovedIds.has(c.id) && explicitMovedIds.get(c.id) > Date.now()
        );

        if (!picked) {
            candidates.sort((a, b) => b.delta - a.delta || b.dir - a.dir);
            picked = candidates[0];
        }

        // 只标记选中的节点为'moved'，其他位置改变的项完全忽略
        if (picked) {
            const existing = changes.get(picked.id);
            const types = existing && existing.type ? new Set(existing.type.split('+')) : new Set();
            types.add('moved');
            const movedDetail = { oldPath: getNodePath(oldTree, picked.id), newPath: getNodePath(newTree, picked.id) };
            changes.set(picked.id, { type: Array.from(types).join('+'), moved: movedDetail });
        }
    });

    return changes;
}

// 渲染JSON Diff（延迟加载优化）
let jsonDiffRendered = false;
function renderJSONDiff(container, oldTree, newTree) {
    // 只显示加载提示，真正渲染延迟到切换时
    if (!jsonDiffRendered) {
        container.innerHTML = `
            <div class="json-header">
                <button class="json-copy-btn" data-action="copyJSONDiff">
                    <i class="fas fa-copy"></i> ${currentLang === 'zh_CN' ? '复制Diff' : 'Copy Diff'}
                </button>
            </div>
            <div class="json-diff-content">
                <div class="loading" style="padding: 40px; text-align: center; color: var(--text-tertiary);">
                    ${currentLang === 'zh_CN' ? '切换到JSON视图时自动加载' : 'Loading when switched to JSON view'}
                </div>
            </div>
        `;
        return;
    }

    // 真正渲染Diff（使用 requestIdleCallback 分批渲染）
    const oldJSON = oldTree ? JSON.stringify(oldTree, null, 2) : '';
    const newJSON = newTree ? JSON.stringify(newTree, null, 2) : '';

    const oldLines = oldJSON.split('\n');
    const newLines = newJSON.split('\n');

    // 使用更快的diff算法
    const diff = fastLineDiff(oldLines, newLines);

    // 分批渲染
    const header = `
        <div class="json-header">
            <button class="json-copy-btn" data-action="copyJSONDiff">
                <i class="fas fa-copy"></i> ${currentLang === 'zh_CN' ? '复制Diff' : 'Copy Diff'}
            </button>
        </div>
        <div class="json-diff-content" id="jsonDiffContent">
    `;

    container.innerHTML = header + '</div>';
    const content = container.querySelector('#jsonDiffContent');

    // 分批渲染（每批100行）
    const batchSize = 100;
    let currentBatch = 0;

    const renderBatch = () => {
        const start = currentBatch * batchSize;
        const end = Math.min(start + batchSize, diff.length);
        const fragment = document.createDocumentFragment();

        for (let idx = start; idx < end; idx++) {
            const line = diff[idx];
            const lineClass = line.type === 'added' ? 'added' : line.type === 'deleted' ? 'deleted' : 'same';
            const prefix = line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' ';

            const div = document.createElement('div');
            div.className = `json-diff-line ${lineClass}`;
            div.innerHTML = `
                <span class="json-line-num old">${line.oldNum || ''}</span>
                <span class="json-line-num new">${line.newNum || ''}</span>
                <span class="json-prefix">${prefix}</span>
                <span class="json-line-text">${escapeHtml(line.line)}</span>
            `;
            fragment.appendChild(div);
        }

        content.appendChild(fragment);

        currentBatch++;
        if (end < diff.length) {
            requestIdleCallback ? requestIdleCallback(renderBatch) : setTimeout(renderBatch, 0);
        } else {
            // 渲染完成，尝试恢复滚动位置或定位到第一个diff
            requestAnimationFrame(() => {
                const savedPosition = localStorage.getItem('jsonScrollPosition');
                if (savedPosition) {
                    // 恢复上次的滚动位置
                    content.scrollTop = parseInt(savedPosition, 10);
                    console.log('[JSON渲染] 恢复滚动位置:', savedPosition);
                } else {
                    // 没有保存的位置，自动定位到第一个diff
                    const firstDiff = content.querySelector('.json-diff-line.added, .json-diff-line.deleted');
                    if (firstDiff) {
                        const offset = firstDiff.offsetTop - content.offsetTop - 100;
                        content.scrollTop = Math.max(0, offset);
                    }
                }
            });
        }
    };

    renderBatch();
}

// 快速行级diff算法
function fastLineDiff(oldLines, newLines) {
    const diff = [];
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let i = 0, j = 0;

    while (i < oldLines.length || j < newLines.length) {
        if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
            diff.push({ type: 'same', line: oldLines[i], oldNum: i + 1, newNum: j + 1 });
            i++;
            j++;
        } else if (i < oldLines.length && !newSet.has(oldLines[i])) {
            diff.push({ type: 'deleted', line: oldLines[i], oldNum: i + 1, newNum: null });
            i++;
        } else if (j < newLines.length && !oldSet.has(newLines[j])) {
            diff.push({ type: 'added', line: newLines[j], oldNum: null, newNum: j + 1 });
            j++;
        } else if (i < oldLines.length) {
            diff.push({ type: 'deleted', line: oldLines[i], oldNum: i + 1, newNum: null });
            i++;
        } else {
            diff.push({ type: 'added', line: newLines[j], oldNum: null, newNum: j + 1 });
            j++;
        }
    }

    return diff;
}

// 复制JSON Diff
window.copyJSONDiff = function () {
    const lines = document.querySelectorAll('.json-diff-line');
    let text = '';
    lines.forEach(line => {
        const prefix = line.querySelector('.json-prefix').textContent;
        const content = line.querySelector('.json-line-text').textContent;
        text += prefix + content + '\n';
    });

    navigator.clipboard.writeText(text).then(() => {
        alert(currentLang === 'zh_CN' ? 'Diff已复制到剪贴板' : 'Diff copied to clipboard');
    }).catch(err => {
        console.error('复制失败:', err);
    });
}

// 生成面包屑式的路径显示（用于移动tooltip）
// 支持显示单个路径或双路径（原始+当前）
function generateBreadcrumbForTooltip(pathInfo) {
    // 兼容旧的字符串参数
    if (typeof pathInfo === 'string') {
        return generateSinglePathBreadcrumb(pathInfo, currentLang === 'zh_CN' ? '从' : 'From');
    }

    // 新的对象参数：{ originalPath, currentPath, hasChanges }
    if (!pathInfo || !pathInfo.originalPath) return '';

    let html = '';

    if (pathInfo.hasChanges && pathInfo.currentPath) {
        // 显示两个路径：原始路径 + 当前路径
        const originalLabel = currentLang === 'zh_CN' ? '原位置' : 'Original';
        const currentLabel = currentLang === 'zh_CN' ? '现在位置' : 'Current';

        html += generateSinglePathBreadcrumb(pathInfo.originalPath, originalLabel);
        html += '<div class="path-separator"></div>'; // 分隔线
        html += generateSinglePathBreadcrumb(pathInfo.currentPath, currentLabel);
    } else {
        // 只显示一个路径
        const prefix = currentLang === 'zh_CN' ? '从' : 'From';
        html += generateSinglePathBreadcrumb(pathInfo.originalPath, prefix);
    }

    return html;
}

// 生成单个路径的面包屑
function generateSinglePathBreadcrumb(path, label) {
    if (!path) return '';

    const parts = path.split(' > ');

    let html = `<span class="move-tooltip-label">${label}:</span>`;

    parts.forEach((part, index) => {
        const isRoot = index === 0;
        const iconClass = isRoot ? 'fa-home' : 'fa-folder';
        const itemClass = isRoot ? 'root' : '';

        html += `<span class="breadcrumb-item ${itemClass}">
            <i class="fas ${iconClass}"></i>
            <span class="breadcrumb-text">${escapeHtml(part)}</span>
        </span>`;

        if (index < parts.length - 1) {
            html += '<span class="breadcrumb-separator"><i class="fas fa-chevron-right"></i></span>';
        }
    });

    return html;
}

// 合并旧树和新树，显示所有节点（包括删除的）
function mergeTreesForDisplay(oldTree, newTree) {
    const allNodes = new Map();

    // 遍历新树
    function traverseNew(nodes, parentPath = '') {
        if (!nodes) return;
        nodes.forEach(node => {
            const currentPath = parentPath ? `${parentPath}/${node.title}` : node.title;
            allNodes.set(node.id, { node, status: 'current', path: currentPath });
            if (node.children) {
                traverseNew(node.children, currentPath);
            }
        });
    }

    // 遍历旧树，找出已删除的节点
    function traverseOld(nodes, parentPath = '') {
        if (!nodes) return;
        nodes.forEach(node => {
            const currentPath = parentPath ? `${parentPath}/${node.title}` : node.title;
            if (!allNodes.has(node.id)) {
                allNodes.set(node.id, { node, status: 'deleted', path: currentPath });
            }
            if (node.children) {
                traverseOld(node.children, currentPath);
            }
        });
    }

    if (newTree && newTree[0]) traverseNew(newTree[0].children);
    if (oldTree && oldTree[0]) traverseOld(oldTree[0].children);

    return allNodes;
}

// 重建树结构，包含删除的节点（保持原始位置）
function rebuildTreeWithDeleted(oldTree, newTree, changeMap) {
    console.log('[树重建] 开始重建树结构');

    if (!oldTree || !oldTree[0] || !newTree || !newTree[0]) {
        console.log('[树重建] 缺少树数据，返回新树');
        return newTree;
    }

    // 防止循环引用的集合
    const visitedIds = new Set();
    const MAX_DEPTH = 50;

    // 基于旧树重建，添加新节点和保留删除节点
    function rebuildNode(oldNode, newNodes, depth = 0) {
        // 安全检查
        if (!oldNode || typeof oldNode.id === 'undefined') {
            console.log('[树重建] 跳过无效节点:', oldNode);
            return null;
        }

        // 深度限制
        if (depth > MAX_DEPTH) {
            console.warn('[树重建] 超过最大深度限制:', depth);
            return null;
        }

        // 循环引用检测
        if (visitedIds.has(oldNode.id)) {
            console.warn('[树重建] 检测到循环引用:', oldNode.id);
            return null;
        }
        visitedIds.add(oldNode.id);

        // 在新树中查找对应的节点
        const newNode = newNodes ? newNodes.find(n => n && n.id === oldNode.id) : null;
        const change = changeMap ? changeMap.get(oldNode.id) : null;

        if (change && change.type === 'deleted') {
            // 节点被删除，保留但标记
            console.log('[树重建] 保留删除节点:', oldNode.title);
            const deletedNodeCopy = JSON.parse(JSON.stringify(oldNode));

            // 递归处理子节点
            if (oldNode.children && oldNode.children.length > 0) {
                deletedNodeCopy.children = oldNode.children.map(child => rebuildNode(child, null, depth + 1)).filter(n => n !== null);
            }

            return deletedNodeCopy;
        } else if (newNode) {
            // 节点存在于新树中
            const nodeCopy = JSON.parse(JSON.stringify(newNode));

            // 处理子节点：合并新旧子节点
            if (oldNode.children || newNode.children) {
                const childrenMap = new Map();

                // 先添加旧的子节点
                if (oldNode.children) {
                    oldNode.children.forEach((child, index) => {
                        childrenMap.set(child.id, { node: child, index, source: 'old' });
                    });
                }

                // 更新或添加新的子节点
                if (newNode.children) {
                    newNode.children.forEach((child, index) => {
                        childrenMap.set(child.id, { node: child, index, source: 'new' });
                    });
                }

                // 重建子节点列表，保持原始顺序
                const rebuiltChildren = [];

                // 按照旧树的顺序遍历
                if (oldNode.children) {
                    oldNode.children.forEach(oldChild => {
                        if (!oldChild) return; // 跳过null/undefined子节点

                        const childInfo = childrenMap.get(oldChild.id);
                        if (childInfo) {
                            const rebuiltChild = rebuildNode(oldChild, newNode.children, depth + 1);
                            if (rebuiltChild) {
                                rebuiltChildren.push(rebuiltChild);
                            }
                        }
                    });
                }

                // 添加新增的子节点
                if (newNode.children) {
                    newNode.children.forEach(newChild => {
                        if (!newChild) return; // 跳过null/undefined子节点

                        if (!oldNode.children || !oldNode.children.find(c => c && c.id === newChild.id)) {
                            // 这是新增的节点
                            console.log('[树重建] 添加新节点:', newChild.title);
                            rebuiltChildren.push(newChild);
                        }
                    });
                }

                nodeCopy.children = rebuiltChildren;
            }

            return nodeCopy;
        } else if (newNodes === null && change && change.type === 'deleted') {
            // 父节点已删除，这个子节点也视为删除，保留但标记
            console.log('[树重建] 保留已删除节点的子节点:', oldNode.title);
            const deletedNodeCopy = JSON.parse(JSON.stringify(oldNode));

            // 递归处理子节点
            if (oldNode.children && oldNode.children.length > 0) {
                deletedNodeCopy.children = oldNode.children.map(child => rebuildNode(child, null, depth + 1)).filter(n => n !== null);
            }

            return deletedNodeCopy;
        } else {
            // 节点在新树中不存在，不是删除，跳过它
            console.log('[树重建] 节点在新树中不存在，跳过:', oldNode.title);
            return null;
        }
    }

    // 重建根节点
    const rebuiltRoot = rebuildNode(oldTree[0], [newTree[0]]);

    console.log('[树重建] 重建完成');
    return [rebuiltRoot];
}

// 从完整路径中提取父文件夹路径（去掉最后一级）
function getParentFolderPath(fullPath, lang = 'zh_CN') {
    if (!fullPath) return lang === 'zh_CN' ? '未知位置' : 'Unknown';

    // 分割路径（使用 ' > ' 作为分隔符）
    const parts = fullPath.split(' > ').filter(p => p.trim());

    // 如果只有一级（根目录），直接返回
    if (parts.length <= 1) {
        return lang === 'zh_CN' ? '根目录' : 'Root';
    }

    // 去掉最后一级（书签/文件夹自己的名称），保留父文件夹路径
    parts.pop();
    return parts.join(' > ');
}

// 智能检测父路径是否发生变化（重命名、移动、删除等）
// 返回 { originalPath, currentPath, hasChanges }
function detectParentPathChanges(fullOldPath, oldTree, newTree, lang = 'zh_CN') {
    const parentPath = getParentFolderPath(fullOldPath, lang);

    // 如果是根目录，不需要检测
    if (parentPath === '根目录' || parentPath === 'Root') {
        return {
            originalPath: parentPath,
            currentPath: null,
            hasChanges: false
        };
    }

    // 分解父路径中的文件夹名称
    const folderNames = parentPath.split(' > ').filter(p => p.trim());

    if (folderNames.length === 0) {
        return {
            originalPath: parentPath,
            currentPath: null,
            hasChanges: false
        };
    }

    // 在旧树中找到这些文件夹对应的ID
    const folderIds = findFolderIdsByPath(oldTree, folderNames);

    if (folderIds.length === 0) {
        return {
            originalPath: parentPath,
            currentPath: null,
            hasChanges: false
        };
    }

    // 检查这些文件夹在新树中的路径
    let hasChanges = false;
    const currentPaths = [];

    folderIds.forEach(folderId => {
        if (treeChangeMap && treeChangeMap.has(folderId)) {
            const change = treeChangeMap.get(folderId);
            // 如果文件夹被移动、重命名或删除
            if (change.type === 'moved' || change.type === 'modified' || change.type === 'deleted' ||
                change.type.includes('moved') || change.type.includes('modified')) {
                hasChanges = true;
            }
        }
    });

    // 如果有变化，构建当前路径
    let currentPath = null;
    if (hasChanges && newTree) {
        // 尝试在新树中找到最后一个文件夹（最深层的父文件夹）
        const lastFolderId = folderIds[folderIds.length - 1];
        currentPath = findNodePathInTree(newTree, lastFolderId);

        if (currentPath) {
            // 去掉最后一级（这是找到的文件夹自己）
            currentPath = getParentFolderPath(currentPath + ' > dummy', lang);
        }
    }

    return {
        originalPath: parentPath,
        currentPath: currentPath,
        hasChanges: hasChanges && currentPath && currentPath !== parentPath
    };
}

// 根据路径中的文件夹名称找到对应的ID
function findFolderIdsByPath(tree, folderNames) {
    const ids = [];

    if (!tree || !tree[0] || folderNames.length === 0) {
        return ids;
    }

    let currentNodes = [tree[0]];

    for (const folderName of folderNames) {
        let found = false;

        for (const node of currentNodes) {
            if (node.children) {
                const folder = node.children.find(child =>
                    child.title === folderName && !child.url
                );

                if (folder) {
                    ids.push(folder.id);
                    currentNodes = [folder];
                    found = true;
                    break;
                }
            }
        }

        if (!found) break;
    }

    return ids;
}

// 在树中根据ID找到节点的完整路径
function findNodePathInTree(tree, nodeId) {
    if (!tree || !tree[0]) return null;

    const path = [];

    function traverse(node, currentPath) {
        if (node.id === nodeId) {
            path.push(...currentPath, node.title);
            return true;
        }

        if (node.children) {
            for (const child of node.children) {
                if (traverse(child, [...currentPath, node.title])) {
                    return true;
                }
            }
        }

        return false;
    }

    if (traverse(tree[0], [])) {
        return path.join(' > ');
    }

    return null;
}

// 渲染带变动标记的树节点
function renderTreeNodeWithChanges(node, level = 0, maxDepth = 50, visitedIds = new Set()) {
    // 防止无限递归的保护机制
    const MAX_DEPTH = maxDepth;
    const MAX_NODES = 10000;

    if (!node) return '';
    if (level > MAX_DEPTH) {
        console.warn('[renderTreeNodeWithChanges] 超过最大深度限制:', level);
        return '';
    }

    // 检测循环引用
    if (visitedIds.has(node.id)) {
        console.warn('[renderTreeNodeWithChanges] 检测到循环引用:', node.id);
        return '';
    }
    visitedIds.add(node.id);

    if (visitedIds.size > MAX_NODES) {
        console.warn('[renderTreeNodeWithChanges] 超过最大节点限制');
        return '';
    }

    const change = treeChangeMap ? treeChangeMap.get(node.id) : null;
    let statusIcon = '';
    let changeClass = '';

    if (node.url) {
        // 叶子（书签）
        if (node.url) {
            const isExplicitMovedOnly = explicitMovedIds.has(node.id) && explicitMovedIds.get(node.id) > Date.now();
            if (change) {
                if (change.type === 'added') {
                    changeClass = 'tree-change-added';
                    statusIcon = '<span class="change-badge added">+</span>';
                } else if (change.type === 'deleted') {
                    changeClass = 'tree-change-deleted';
                    statusIcon = '<span class="change-badge deleted">-</span>';
                } else {
                    const types = change.type.split('+');
                    const hasModified = types.includes('modified');
                    const isMoved = types.includes('moved');
                    const isExplicitMoved = isExplicitMovedOnly;

                    if (hasModified) {
                        changeClass = 'tree-change-modified';
                        statusIcon += '<span class="change-badge modified">~</span>';
                    }

                    if (isMoved || isExplicitMoved) {
                        // 如果既有modified又有moved，添加mixed类
                        if (hasModified) {
                            changeClass = 'tree-change-mixed';
                        } else {
                            changeClass = 'tree-change-moved';
                        }
                        {
                            let slash = '';
                            if (change.moved && change.moved.oldPath) {
                                slash = breadcrumbToSlashFolders(change.moved.oldPath);
                            }
                            if (!slash && cachedOldTree) {
                                const bc = getNamedPathFromTree(cachedOldTree, node.id);
                                slash = breadcrumbToSlashFolders(bc);
                            }
                            statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
                        }
                    }
                }
            } else if (isExplicitMovedOnly) {
                // 无 diff 记录但存在显式移动标识：也显示蓝色移动徽标
                changeClass = 'tree-change-moved';
                let slash = '';
                if (cachedOldTree) {
                    const bc = getNamedPathFromTree(cachedOldTree, node.id);
                    slash = breadcrumbToSlashFolders(bc);
                }
                statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
            }
            const favicon = getFaviconUrl(node.url);
            return `
                <div class="tree-node" style="padding-left: ${level * 12}px">
                    <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-url="${escapeHtml(node.url || '')}" data-node-type="bookmark" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
                        <span class="tree-toggle" style="opacity: 0"></span>
                        ${favicon ? `<img class="tree-icon" src="${favicon}" alt="">` : `<i class="tree-icon fas fa-bookmark"></i>`}
                        <a href="${escapeHtml(node.url)}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer">${escapeHtml(node.title)}</a>
                        <span class="change-badges">${statusIcon}</span>
                    </div>
                </div>
            `;
        }
    }

    // 文件夹
    const __isExplicitMovedOnlyFolder = explicitMovedIds.has(node.id) && explicitMovedIds.get(node.id) > Date.now();
    if (change) {
        if (change.type === 'added') {
            changeClass = 'tree-change-added';
            statusIcon = '<span class="change-badge added">+</span>';
        } else if (change.type === 'deleted') {
            changeClass = 'tree-change-deleted';
            statusIcon = '<span class="change-badge deleted">-</span>';
        } else {
            const types = change.type.split('+');
            const hasModified = types.includes('modified');
            const isMoved = types.includes('moved');
            const isExplicitMoved = explicitMovedIds.has(node.id) && explicitMovedIds.get(node.id) > Date.now();

            if (hasModified) {
                changeClass = 'tree-change-modified';
                statusIcon += '<span class="change-badge modified">~</span>';
            }

            if (isMoved || isExplicitMoved) {
                // 如果既有modified又有moved，添加mixed类
                if (hasModified) {
                    changeClass = 'tree-change-mixed';
                } else {
                    changeClass = 'tree-change-moved';
                }
                {
                    let slash = '';
                    if (change.moved && change.moved.oldPath) {
                        slash = breadcrumbToSlashFolders(change.moved.oldPath);
                    }
                    if (!slash && cachedOldTree) {
                        const bc = getNamedPathFromTree(cachedOldTree, node.id);
                        slash = breadcrumbToSlashFolders(bc);
                    }
                    statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
                }
            }
        }
    } else if (__isExplicitMovedOnlyFolder) {
        // 无 diff 记录但存在显式移动标识：也显示蓝色移动徽标
        changeClass = 'tree-change-moved';
        let slash = '';
        if (cachedOldTree) {
            const bc = getNamedPathFromTree(cachedOldTree, node.id);
            slash = breadcrumbToSlashFolders(bc);
        }
        statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
    }

    // 若文件夹本身无变化，但其子树存在变化，追加灰色“指引”标识
    if (!change) {
        try {
            const hasDescendant = (function hasDescendantChangesFast(n) {
                if (!n || !Array.isArray(n.children) || n.children.length === 0) return false;
                const now = Date.now();
                const stack = [...n.children];
                while (stack.length) {
                    const cur = stack.pop();
                    if (!cur) continue;
                    if ((treeChangeMap && treeChangeMap.has(cur.id)) || (explicitMovedIds && explicitMovedIds.has(cur.id) && explicitMovedIds.get(cur.id) > now)) {
                        return true;
                    }
                    if (Array.isArray(cur.children) && cur.children.length) stack.push(...cur.children);
                }
                return false;
            })(node);
            if (hasDescendant) {
                const title = currentLang === 'zh_CN' ? '此文件夹下有变化' : 'Contains changes';
                statusIcon += `<span class=\"change-badge has-changes\" title=\"${escapeHtml(title)}\">•</span>`;
            }
        } catch (_) { /* ignore */ }
    }

    // 对子节点排序：
    // - 优先显示当前存在的节点（非 deleted），严格按 Chrome 的 index 升序
    // - 被标记为 deleted 的旧节点排在最后，按其旧 index 升序
    // - 缺少 index 的节点保持原始 children 数组中的相对顺序（稳定）
    const children = Array.isArray(node.children) ? node.children : [];
    const originalPos = new Map();
    for (let i = 0; i < children.length; i++) originalPos.set(children[i]?.id, i);

    const isDeleted = (n) => {
        if (!treeChangeMap) return false;
        const ch = treeChangeMap.get(n?.id);
        return !!(ch && ch.type === 'deleted');
    };

    const cmpStable = (a, b) => {
        const ia = (typeof a?.index === 'number') ? a.index : Number.POSITIVE_INFINITY;
        const ib = (typeof b?.index === 'number') ? b.index : Number.POSITIVE_INFINITY;
        if (ia !== ib) return ia - ib;
        // 稳定性：当 index 相同或缺失，按原始出现顺序
        const pa = originalPos.get(a?.id) ?? 0;
        const pb = originalPos.get(b?.id) ?? 0;
        return pa - pb;
    };

    const present = children.filter(c => !isDeleted(c)).sort(cmpStable);
    const deleted = children.filter(c => isDeleted(c)).sort(cmpStable);
    const sortedChildren = present.concat(deleted);

    return `
        <div class="tree-node" style="padding-left: ${level * 12}px">
            <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-type="folder" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
                <span class="tree-toggle ${level === 0 ? 'expanded' : ''}"><i class="fas fa-chevron-right"></i></span>
                <i class="tree-icon fas fa-folder"></i>
                <span class="tree-label">${escapeHtml(node.title)}</span>
                <span class="change-badges">${statusIcon}</span>
            </div>
            <div class="tree-children ${level === 0 ? 'expanded' : ''}">
                ${sortedChildren.map(child => renderTreeNodeWithChanges(child, level + 1, maxDepth, visitedIds)).join('')}
            </div>
        </div>
    `;
}

// ===== 增量更新：创建 =====
async function applyIncrementalCreateToTree(id, bookmark) {
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    // 获取父节点 DOM
    const parentId = bookmark.parentId;
    const parentItem = container.querySelector(`.tree-item[data-node-id="${parentId}"]`);
    if (!parentItem) { await renderTreeView(true); return; }
    const parentNode = parentItem.nextElementSibling && parentItem.nextElementSibling.classList.contains('tree-children')
        ? parentItem.nextElementSibling : null;
    if (!parentNode) { await renderTreeView(true); return; }
    // 生成新节点 HTML（添加绿色变更标记）
    const favicon = getFaviconUrl(bookmark.url || '');
    const labelColor = 'color: #28a745;'; // 绿色
    const labelFontWeight = 'font-weight: 500;';
    const html = `
        <div class="tree-node" style="padding-left: ${(parseInt(parentItem.style.paddingLeft || '0', 10) + 12) || 12}px">
            <div class="tree-item tree-change-added" data-node-id="${id}" data-node-title="${escapeHtml(bookmark.title || '')}" data-node-url="${escapeHtml(bookmark.url || '')}" data-node-type="${bookmark.url ? 'bookmark' : 'folder'}">
                <span class="tree-toggle" style="opacity: 0"></span>
                ${bookmark.url ? (favicon ? `<img class="tree-icon" src="${favicon}" alt="">` : `<i class="tree-icon fas fa-bookmark"></i>`) : `<i class="tree-icon fas fa-folder"></i>`}
                ${bookmark.url ? `<a href="${escapeHtml(bookmark.url)}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer" style="${labelColor} ${labelFontWeight}">${escapeHtml(bookmark.title || '')}</a>` : `<span class="tree-label" style="${labelColor} ${labelFontWeight}">${escapeHtml(bookmark.title || '')}</span>`}
                <span class="change-badges"><span class="change-badge added">+</span></span>
            </div>
            ${bookmark.url ? '' : '<div class="tree-children"></div>'}
        </div>
    `;
    // 插入到正确的 index 位置（忽略已删除的占位项）
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    const newNodeEl = wrapper.firstElementChild; // .tree-node

    // 计算锚点：仅统计未被标记为删除的同级节点
    const siblingsAll = Array.from(parentNode.querySelectorAll(':scope > .tree-node'));
    const presentSiblings = siblingsAll.filter(n => {
        const item = n.querySelector(':scope > .tree-item');
        return !(item && item.classList.contains('tree-change-deleted'));
    });

    const targetIndex = (typeof bookmark.index === 'number' && bookmark.index >= 0)
        ? bookmark.index : presentSiblings.length;

    const anchor = presentSiblings[targetIndex] || null;
    if (anchor) {
        parentNode.insertBefore(newNodeEl, anchor);
    } else {
        // 末尾插入：尽量插在第一个已删除节点之前，避免落到删除分组之后
        const firstDeleted = siblingsAll.find(n => n.querySelector(':scope > .tree-item')?.classList.contains('tree-change-deleted'));
        if (firstDeleted) parentNode.insertBefore(newNodeEl, firstDeleted); else parentNode.appendChild(newNodeEl);
    }

    // 为新创建的节点绑定事件
    const newItem = newNodeEl?.querySelector('.tree-item');
    if (newItem) {
        // 绑定右键菜单
        newItem.addEventListener('contextmenu', (e) => {
            if (typeof showContextMenu === 'function') {
                showContextMenu(e, newItem);
            }
        });

        // 绑定拖拽事件
        if (typeof attachDragEvents === 'function') {
            attachDragEvents(container);
        }

        // 如果在Canvas视图，绑定Canvas拖出功能
        if (currentView === 'canvas' && window.CanvasModule && window.CanvasModule.enhance) {
            window.CanvasModule.enhance();
        }
    }
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}

// ===== 增量更新：删除 =====
function applyIncrementalRemoveFromTree(id) {
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    const item = container.querySelector(`.tree-item[data-node-id="${id}"]`);
    if (!item) return;

    // 先添加红色标识和删除类
    item.classList.add('tree-change-deleted');

    // 直接设置标签的红色样式
    const labelLink = item.querySelector('.tree-bookmark-link');
    const labelSpan = item.querySelector('.tree-label');
    if (labelLink) {
        labelLink.style.color = '#dc3545';
        labelLink.style.fontWeight = '500';
        labelLink.style.textDecoration = 'line-through';
        labelLink.style.opacity = '0.7';
    }
    if (labelSpan) {
        labelSpan.style.color = '#dc3545';
        labelSpan.style.fontWeight = '500';
        labelSpan.style.textDecoration = 'line-through';
        labelSpan.style.opacity = '0.7';
    }

    // 添加红色标识
    const badges = item.querySelector('.change-badges');
    if (badges) {
        badges.innerHTML = '<span class="change-badge deleted">-</span>';
    } else {
        item.insertAdjacentHTML('beforeend', '<span class="change-badges"><span class="change-badge deleted">-</span></span>');
    }

    // 然后移除节点
    const node = item.closest('.tree-node');
    if (node) {
        // 添加淡出效果后删除
        node.style.opacity = '0.5';
        setTimeout(() => {
            if (node.parentNode) {
                node.remove();
            }
        }, 300);
    }
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}

// ===== 增量更新：修改 =====
async function applyIncrementalChangeToTree(id, changeInfo) {
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    const item = container.querySelector(`.tree-item[data-node-id="${id}"]`);
    if (!item) { await renderTreeView(true); return; }

    console.log('[applyIncrementalChangeToTree] 修改书签:', id, changeInfo);

    // 添加修改类
    if (!item.classList.contains('tree-change-modified')) {
        item.classList.add('tree-change-modified');
    }

    // 总是确保橙色样式被应用（即使已经修改过）- 使用!important强制应用
    const labelLink = item.querySelector('.tree-bookmark-link');
    const labelSpan = item.querySelector('.tree-label');

    console.log('[applyIncrementalChangeToTree] labelLink:', !!labelLink, 'labelSpan:', !!labelSpan);

    if (labelLink) {
        labelLink.style.setProperty('color', '#fd7e14', 'important');
        labelLink.style.setProperty('font-weight', '500', 'important');
        console.log('[applyIncrementalChangeToTree] 已设置labelLink样式');
    }
    if (labelSpan) {
        labelSpan.style.setProperty('color', '#fd7e14', 'important');
        labelSpan.style.setProperty('font-weight', '500', 'important');
        console.log('[applyIncrementalChangeToTree] 已设置labelSpan样式');
    }

    // 修改内容
    if (changeInfo.title) {
        if (labelLink) labelLink.textContent = changeInfo.title;
        if (labelSpan) labelSpan.textContent = changeInfo.title;
        item.setAttribute('data-node-title', escapeHtml(changeInfo.title));
        console.log('[applyIncrementalChangeToTree] 已修改标题:', changeInfo.title);
    }
    if (changeInfo.url !== undefined) {
        const link = item.querySelector('.tree-bookmark-link');
        if (link) link.href = changeInfo.url || '';
        const icon = item.querySelector('img.tree-icon');
        if (icon) {
            const fav = getFaviconUrl(changeInfo.url || '');
            if (fav) icon.src = fav;
        }
        item.setAttribute('data-node-url', escapeHtml(changeInfo.url || ''));
    }

    // 给该节点增加"modified"标识
    const badges = item.querySelector('.change-badges');
    if (badges && !badges.querySelector('.modified')) {
        badges.insertAdjacentHTML('beforeend', '<span class="change-badge modified">~</span>');
    }
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}

// ===== 增量更新：移动 =====
async function applyIncrementalMoveToTree(id, moveInfo) {
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    const item = container.querySelector(`.tree-item[data-node-id="${id}"]`);
    if (!item) { await renderTreeView(true); return; }
    const node = item.closest('.tree-node');
    const oldParentItem = container.querySelector(`.tree-item[data-node-id="${moveInfo.oldParentId}"]`);
    const newParentItem = container.querySelector(`.tree-item[data-node-id="${moveInfo.parentId}"]`);
    const newParentChildren = newParentItem && newParentItem.nextElementSibling && newParentItem.nextElementSibling.classList.contains('tree-children')
        ? newParentItem.nextElementSibling : null;
    if (!newParentChildren) { await renderTreeView(true); return; }
    // 从旧位置移除并插入新父下
    if (node) node.remove();
    // 按目标 index 插入更准确（忽略已删除的同级节点）
    const targetIndex = (moveInfo && typeof moveInfo.index === 'number') ? moveInfo.index : null;
    if (targetIndex === null) {
        // 尽量插在第一个已删除节点之前
        const siblingsAll = Array.from(newParentChildren.querySelectorAll(':scope > .tree-node'));
        const firstDeleted = siblingsAll.find(n => n.querySelector(':scope > .tree-item')?.classList.contains('tree-change-deleted'));
        if (firstDeleted) newParentChildren.insertBefore(node, firstDeleted); else newParentChildren.appendChild(node);
    } else {
        const siblingsAll = Array.from(newParentChildren.querySelectorAll(':scope > .tree-node'));
        const presentSiblings = siblingsAll.filter(n => !n.querySelector(':scope > .tree-item')?.classList.contains('tree-change-deleted'));
        const anchor = presentSiblings[targetIndex] || null;
        if (anchor) newParentChildren.insertBefore(node, anchor);
        else {
            const firstDeleted = siblingsAll.find(n => n.querySelector(':scope > .tree-item')?.classList.contains('tree-change-deleted'));
            if (firstDeleted) newParentChildren.insertBefore(node, firstDeleted); else newParentChildren.appendChild(node);
        }
    }

    // —— 修正缩进：适配新层级 ——
    try {
        if (node && newParentItem) {
            const parentNodeEl = newParentItem.closest('.tree-node');
            const parentPad = parseInt(parentNodeEl?.style?.paddingLeft || '0', 10) || 0;
            const basePad = parentPad + 12;

            const applyIndent = (treeNodeEl, pad) => {
                if (!treeNodeEl) return;
                treeNodeEl.style.paddingLeft = pad + 'px';
                const childrenWrap = treeNodeEl.querySelector(':scope > .tree-children');
                if (childrenWrap) {
                    const childNodes = childrenWrap.querySelectorAll(':scope > .tree-node');
                    childNodes.forEach(child => applyIndent(child, pad + 12));
                }
            };
            applyIndent(node, basePad);
        }
    } catch (_) { /* 安静失败，必要时完整重渲染 */ }
    // 关键：仅对这个被拖拽的节点标记为蓝色"moved"
    // 其他由于这次移动而位置改变的兄弟节点不标记，因为我们只标识用户直接操作的对象
    const badges = item.querySelector('.change-badges');
    if (badges) {
        const existing = badges.querySelector('.change-badge.moved');
        if (existing) existing.remove();
        // 计算旧位置（名称路径）：优先用旧父ID从旧树取父路径；回退为旧树中该节点路径的父级
        let tip = '';
        if (cachedOldTree && moveInfo && typeof moveInfo.oldParentId !== 'undefined') {
            const bcParent = getNamedPathFromTree(cachedOldTree, String(moveInfo.oldParentId));
            if (bcParent) tip = breadcrumbToSlashFull(bcParent);
        }
        if (!tip && cachedOldTree) {
            const bcSelf = getNamedPathFromTree(cachedOldTree, id);
            if (bcSelf) tip = breadcrumbToSlashFolders(bcSelf);
        }
        if (!tip) tip = '/';
        badges.insertAdjacentHTML('beforeend', `<span class="change-badge moved" data-move-from="${escapeHtml(tip)}" title="${escapeHtml(tip)}"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${slashPathToChipsHTML(tip)}</span></span>`);
        item.classList.add('tree-change-moved');
    }
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}



// =============================================================================
// 详情弹窗
// =============================================================================

function showDetailModal(record) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('modalBody');

    // 保存当前打开的记录时间，用于关闭时滚动
    currentDetailRecordTime = record.time;

    // 显示加载状态
    body.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    modal.classList.add('show');

    // 异步生成详情内容
    generateDetailContent(record).then(html => {
        body.innerHTML = html;

        // 添加 hunk 折叠事件监听
        setTimeout(() => {
            body.querySelectorAll('.diff-hunk-header.collapsible').forEach(header => {
                const hunkId = header.getAttribute('data-hunk-id');
                if (hunkId) {
                    header.addEventListener('click', function () {
                        toggleHunk(hunkId);
                    });
                }
            });
        }, 0);
    }).catch(error => {
        console.error('[详情弹窗] 生成失败:', error);
        body.innerHTML = `<div class="detail-empty"><i class="fas fa-exclamation-circle"></i>加载失败: ${error.message}</div>`;
    });
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('show');

    // 关闭时，如果有打开的记录，滚动到该记录并使其居中，并闪烁突出显示
    if (currentDetailRecordTime) {
        // 延迟执行以确保DOM已更新
        setTimeout(() => {
            const recordElement = document.querySelector(`[data-record-time="${currentDetailRecordTime}"]`);
            if (recordElement) {
                // 滚动到该元素并使其在视口中央
                recordElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // 添加呼吸效果的蓝色闪烁（1次）
                const originalBackground = recordElement.style.backgroundColor;

                // 设置缓慢平滑的过渡
                recordElement.style.transition = 'background-color 0.8s ease-in-out, box-shadow 0.8s ease-in-out';

                // 显示蓝色框（呼吸效果 - 淡入）
                recordElement.style.backgroundColor = 'rgba(0, 122, 255, 0.25)';
                recordElement.style.boxShadow = '0 0 0 2px #007AFF inset';

                // 1秒后开始淡出
                setTimeout(() => {
                    recordElement.style.backgroundColor = originalBackground;
                    recordElement.style.boxShadow = 'none';

                    // 淡出完成后重置transition
                    setTimeout(() => {
                        recordElement.style.transition = '';
                    }, 800);
                }, 1200);
            }
            currentDetailRecordTime = null;
        }, 100);
    }
}

// 生成详情内容（异步）
async function generateDetailContent(record) {
    const stats = record.bookmarkStats || {};

    let html = '';

    if (record.note) {
        html += `
            <div class="detail-section">
                <div class="detail-section-title">
                    <i class="fas fa-sticky-note detail-section-icon"></i>
                    ${currentLang === 'zh_CN' ? '备注' : 'Note'}
                </div>
                <div class="detail-item">
                    ${escapeHtml(record.note)}
                </div>
            </div>
        `;
    }

    // 尝试获取详细变化
    try {
        const diffHtml = await generateDetailedChanges(record);
        if (diffHtml) {
            html += diffHtml;
        } else {
            html += `
                <div class="detail-section">
                    <div class="detail-empty">
                        <i class="fas fa-info-circle"></i>
                        ${currentLang === 'zh_CN'
                    ? '无详细变化记录（旧记录的详细数据已清理以优化性能）'
                    : 'No detailed changes available (old records cleaned for performance)'}
                        <div style="margin-top: 10px; font-size: 0.9em; color: var(--text-tertiary);">
                            ${currentLang === 'zh_CN'
                    ? '提示：只保留最新3条记录的详细变化数据'
                    : 'Note: Only the latest 3 records retain detailed change data'}
                        </div>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('[详情内容] 生成变化失败:', error);
        html += `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-exclamation-circle"></i>
                    ${currentLang === 'zh_CN' ? '加载变化详情失败' : 'Failed to load change details'}
                </div>
            </div>
        `;
    }

    return html;
}

// 生成详细变化的 HTML（Git diff 风格）
async function generateDetailedChanges(record) {
    console.log('[详细变化] ========== 开始生成详细变化 ==========');
    console.log('[详细变化] 记录时间:', record.time);
    console.log('[详细变化] 记录状态:', record.status);
    console.log('[详细变化] 记录有 bookmarkTree:', !!record.bookmarkTree);
    console.log('[详细变化] bookmarkTree 类型:', typeof record.bookmarkTree);

    if (record.bookmarkTree) {
        console.log('[详细变化] bookmarkTree 是数组:', Array.isArray(record.bookmarkTree));
        console.log('[详细变化] bookmarkTree 长度:', record.bookmarkTree.length);
        console.log('[详细变化] bookmarkTree[0] 存在:', !!record.bookmarkTree[0]);
        if (record.bookmarkTree[0]) {
            console.log('[详细变化] bookmarkTree[0] 的 children 数量:', record.bookmarkTree[0].children?.length || 0);
        }
    }

    // 检查当前记录是否有 bookmarkTree
    if (!record.bookmarkTree) {
        console.log('[详细变化] ❌ 当前记录没有 bookmarkTree（可能是旧记录或保存失败）');
        return null;
    }

    // 找到上一条记录
    const recordIndex = syncHistory.findIndex(r => r.time === record.time);
    console.log('[详细变化] 记录索引:', recordIndex);

    if (recordIndex <= 0) {
        // 第一条记录，显示所有书签为新增
        if (record.isFirstBackup) {
            console.log('[详细变化] 第一次备份，显示所有书签为新增');
            return generateFirstBackupDiff(record.bookmarkTree);
        }
        console.log('[详细变化] 第一条记录但不是首次备份');
        return null;
    }

    // 获取上一条记录
    let previousRecord = null;
    for (let i = recordIndex - 1; i >= 0; i--) {
        if (syncHistory[i].status === 'success' && syncHistory[i].bookmarkTree) {
            previousRecord = syncHistory[i];
            break;
        }
    }

    if (!previousRecord || !previousRecord.bookmarkTree) {
        console.log('[详细变化] 没有找到上一条有效的备份记录');
        return null;
    }

    console.log('[详细变化] 找到上一条记录:', previousRecord.time);

    // 生成 diff（对比这次备份和上次备份）
    const oldLines = bookmarkTreeToLines(previousRecord.bookmarkTree);
    const newLines = bookmarkTreeToLines(record.bookmarkTree);

    console.log('[详细变化] oldLines 数量:', oldLines.length);
    console.log('[详细变化] newLines 数量:', newLines.length);

    const groupedHunks = generateDiffByPath(oldLines, newLines);

    console.log('[详细变化] groupedHunks 数量:', groupedHunks.length);

    return renderDiffHtml(groupedHunks);
}

// 生成首次备份的 diff（所有书签都是新增）
function generateFirstBackupDiff(bookmarkTree) {
    const lines = bookmarkTreeToLines(bookmarkTree);

    if (lines.length === 0) {
        return `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-inbox"></i>
                    ${currentLang === 'zh_CN' ? '空书签' : 'Empty bookmarks'}
                </div>
            </div>
        `;
    }

    // 按路径分组
    const grouped = {};
    lines.forEach(line => {
        const path = line.path || (currentLang === 'zh_CN' ? '根目录' : 'Root');
        if (!grouped[path]) grouped[path] = [];
        grouped[path].push(line);
    });

    let html = '<div class="detail-section"><div class="git-diff-viewer">';
    html += '<div class="diff-file-header">';
    html += `<span class="diff-file-path">${currentLang === 'zh_CN' ? '首次备份 - 所有书签' : 'First Backup - All Bookmarks'}</span>`;
    html += '</div>';

    Object.entries(grouped).forEach(([path, pathLines]) => {
        html += '<div class="diff-folder-group">';
        html += `<div class="diff-folder-header-static">`;
        html += renderBreadcrumb(path, currentLang);
        html += '</div>';
        html += '<div class="diff-hunk">';
        html += `<div class="diff-hunk-header">`;
        html += `<span class="hunk-location">@@ +1,${pathLines.length} @@</span>`;
        html += `<span class="hunk-stats"><span class="stat-add">+${pathLines.length}</span></span>`;
        html += '</div>';
        html += '<div class="diff-hunk-content">';

        pathLines.forEach((line, idx) => {
            html += `<div class="diff-line-wrapper added">`;
            html += `<span class="diff-line-num old"></span>`;
            html += `<span class="diff-line-num new">${idx + 1}</span>`;
            html += `<span class="diff-line-prefix">+</span>`;
            html += `<span class="diff-line-content">${escapeHtml(line.line)}</span>`;
            html += `</div>`;
        });

        html += '</div></div></div>';
    });

    html += '</div></div>';
    return html;
}

// 渲染 diff HTML
function renderDiffHtml(groupedHunks) {
    if (!groupedHunks || groupedHunks.length === 0) {
        return `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-check-circle"></i>
                    ${currentLang === 'zh_CN' ? '无变化' : 'No changes'}
                </div>
            </div>
        `;
    }

    // 渲染 Git diff
    let diffHtml = '<div class="detail-section"><div class="git-diff-viewer">';
    diffHtml += '<div class="diff-file-header">';
    diffHtml += `<span class="diff-file-path">${currentLang === 'zh_CN' ? '书签变化详情' : 'Bookmark Changes'}</span>`;
    diffHtml += '</div>';

    let hunkIndex = 0;
    groupedHunks.forEach((group) => {
        diffHtml += '<div class="diff-folder-group">';
        diffHtml += `<div class="diff-folder-header-static">`;
        diffHtml += renderBreadcrumb(group.path, currentLang);
        diffHtml += '</div>';

        group.hunks.forEach(hunk => {
            const hunkId = `detail-hunk-${hunkIndex++}`;
            const hunkLines = hunk.contextBefore.length + hunk.changes.length + hunk.contextAfter.length;
            const shouldCollapse = hunkLines > 15;

            const addCount = hunk.changes.filter(c => c.type === 'add').length;
            const deleteCount = hunk.changes.filter(c => c.type === 'delete').length;

            diffHtml += '<div class="diff-hunk">';

            const iconClass = shouldCollapse ? 'fa-chevron-right' : 'fa-chevron-down';
            diffHtml += `<div class="diff-hunk-header collapsible" data-hunk-id="${hunkId}">`;
            diffHtml += `<i class="fas ${iconClass} collapse-icon" id="${hunkId}-icon"></i>`;
            diffHtml += `<span class="hunk-location">@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@</span>`;
            diffHtml += `<span class="hunk-stats">`;
            if (addCount > 0) diffHtml += `<span class="stat-add">+${addCount}</span>`;
            if (deleteCount > 0) diffHtml += `<span class="stat-delete">-${deleteCount}</span>`;
            diffHtml += `</span>`;
            diffHtml += '</div>';

            diffHtml += `<div class="diff-hunk-content ${shouldCollapse ? 'collapsed' : ''}" id="${hunkId}">`;

            // 前置上下文
            hunk.contextBefore.forEach(ctx => {
                diffHtml += `<div class="diff-line-wrapper context">`;
                diffHtml += `<span class="diff-line-num old">${ctx.oldIdx + 1}</span>`;
                diffHtml += `<span class="diff-line-num new">${ctx.oldIdx + 1}</span>`;
                diffHtml += `<span class="diff-line-prefix"> </span>`;
                diffHtml += `<span class="diff-line-content">${escapeHtml(ctx.line.line)}</span>`;
                diffHtml += `</div>`;
            });

            // 变化
            hunk.changes.forEach(change => {
                if (change.type === 'delete') {
                    diffHtml += `<div class="diff-line-wrapper deleted">`;
                    diffHtml += `<span class="diff-line-num old">${change.oldIdx + 1}</span>`;
                    diffHtml += `<span class="diff-line-num new"></span>`;
                    diffHtml += `<span class="diff-line-prefix">-</span>`;
                    diffHtml += `<span class="diff-line-content">${escapeHtml(change.line.line)}</span>`;
                    diffHtml += `</div>`;
                } else if (change.type === 'add') {
                    diffHtml += `<div class="diff-line-wrapper added">`;
                    diffHtml += `<span class="diff-line-num old"></span>`;
                    diffHtml += `<span class="diff-line-num new">${change.newIdx + 1}</span>`;
                    diffHtml += `<span class="diff-line-prefix">+</span>`;
                    diffHtml += `<span class="diff-line-content">${escapeHtml(change.line.line)}</span>`;
                    diffHtml += `</div>`;
                }
            });

            // 后置上下文
            hunk.contextAfter.forEach(ctx => {
                diffHtml += `<div class="diff-line-wrapper context">`;
                diffHtml += `<span class="diff-line-num old">${ctx.oldIdx + 1}</span>`;
                diffHtml += `<span class="diff-line-num new">${ctx.oldIdx + 1}</span>`;
                diffHtml += `<span class="diff-line-prefix"> </span>`;
                diffHtml += `<span class="diff-line-content">${escapeHtml(ctx.line.line)}</span>`;
                diffHtml += `</div>`;
            });

            diffHtml += '</div></div>';
        });

        diffHtml += '</div>';
    });

    diffHtml += '</div></div>';
    return diffHtml;
}

// =============================================================================
// 搜索功能
// =============================================================================

let searchTimeout = null;

function handleSearch(e) {
    const query = e.target.value.trim().toLowerCase();

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        performSearch(query);
    }, 300);
}

function performSearch(query) {
    if (!query) {
        renderCurrentView();
        return;
    }

    // 根据当前视图执行搜索
    switch (currentView) {
        case 'history':
            searchHistory(query);
            break;
        case 'additions':
            searchAdditions(query);
            break;
        case 'tree':
            searchTree(query);
            break;
    }
}

function searchHistory(query) {
    const container = document.getElementById('historyList');
    const filtered = syncHistory.filter(record => {
        const note = (record.note || '').toLowerCase();
        const time = formatTime(record.time).toLowerCase();
        return note.includes(query) || time.includes(query);
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">未找到匹配的记录</div></div>`;
        return;
    }

    // 重新渲染过滤后的历史
    syncHistory = filtered;
    renderHistoryView();
}

function searchAdditions(query) {
    const filtered = allBookmarks.filter(bookmark => {
        const title = (bookmark.title || '').toLowerCase();
        const url = (bookmark.url || '').toLowerCase();
        return title.includes(query) || url.includes(query);
    });

    const groupedByDate = groupBookmarksByDate(filtered);
    const container = document.getElementById('additionsList');
    container.innerHTML = renderBookmarkGroups(groupedByDate);
}

function searchTree(query) {
    // 树搜索暂时不实现，因为需要保持树结构
    renderTreeView();
}

// =============================================================================
// 主题和语言切换
// =============================================================================

// 主题和语言切换 - 独立设置，主UI优先
// 设置覆盖后会显示重置按钮

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);

    // 设置覆盖标志
    try {
        localStorage.setItem('historyViewerHasCustomTheme', 'true');
        localStorage.setItem('historyViewerCustomTheme', currentTheme);
        console.log('[History Viewer] 设置主题覆盖:', currentTheme);
    } catch (e) {
        console.error('[History Viewer] 无法保存主题覆盖:', e);
    }

    // 更新图标
    const icon = document.querySelector('#themeToggle i');
    if (icon) {
        icon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
}

function toggleLanguage() {
    currentLang = currentLang === 'zh_CN' ? 'en' : 'zh_CN';

    // 设置覆盖标志
    try {
        localStorage.setItem('historyViewerHasCustomLang', 'true');
        localStorage.setItem('historyViewerCustomLang', currentLang);
        console.log('[History Viewer] 设置语言覆盖:', currentLang);
    } catch (e) {
        console.error('[History Viewer] 无法保存语言覆盖:', e);
    }

    applyLanguage();

    // 只更新界面文字，不重新渲染内容（避免图标重新加载）
    // renderCurrentView();

    // 手动更新需要多语言的UI元素（不涉及书签树内容）
    updateLanguageDependentUI();

    // 复习热力图：重新加载一次以应用当前语言
    // 只影响热力图容器，不会重新加载书签图标
    try {
        loadHeatmapData();
    } catch (e) {
        console.warn('[Heatmap] 语言切换时重载失败:', e);
    }
    
    // 刷新书签关联记录列表（更新badge文字）
    refreshBrowsingRelatedHistory();
}

// 更新依赖语言的UI元素（不重新渲染内容，避免图标重新加载）
function updateLanguageDependentUI() {
    const isEn = currentLang === 'en';

    // 只更新图例文字（如果存在）
    const legends = document.querySelectorAll('.tree-legend');
    legends.forEach(legend => {
        legend.innerHTML = `
            <span class="legend-item"><span class="legend-dot added"></span> ${isEn ? 'Added' : '新增'}</span>
            <span class="legend-item"><span class="legend-dot deleted"></span> ${isEn ? 'Deleted' : '删除'}</span>
            <span class="legend-item"><span class="legend-dot modified"></span> ${isEn ? 'Modified' : '修改'}</span>
            <span class="legend-item"><span class="legend-dot moved"></span> ${isEn ? 'Moved' : '移动'}</span>
        `;
    });

    // 更新加载文本（如果存在）
    const loadingTexts = document.querySelectorAll('.loading');
    loadingTexts.forEach(el => {
        if (el.textContent.includes('Loading') || el.textContent.includes('加载中')) {
            el.textContent = i18n.loading[currentLang];
        }
    });

    // 更新空状态文本
    const emptyStates = document.querySelectorAll('.empty-state');
    emptyStates.forEach(el => {
        if (el.textContent.includes('No') || el.textContent.includes('没有')) {
            el.textContent = isEn ? 'No data' : '没有数据';
        }
    });

    // ===== 更新临时栏目相关的多语言元素 =====

    // 1. 更新临时栏目的按钮tooltip
    document.querySelectorAll('.temp-node-rename-btn').forEach(btn => {
        const label = isEn ? 'Rename section' : '重命名栏目';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });

    document.querySelectorAll('.temp-node-color-btn, .temp-node-color-input').forEach(btn => {
        const label = isEn ? 'Change color' : '调整栏目颜色';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });

    document.querySelectorAll('.temp-node-close').forEach(btn => {
        const label = isEn ? 'Remove section' : '删除临时栏目';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });

    // 2. 更新临时栏目说明的placeholder和文本
    document.querySelectorAll('.temp-node-description').forEach(descText => {
        const text = descText.textContent.trim();
        const hasPlaceholder = text === 'Click to add description...' || text === '点击添加说明...';
        const hasSpanChild = descText.querySelector('span[style*="opacity"]');

        // 如果是占位符文本（检查文本内容或者是否有占位符span）
        if (hasPlaceholder || (hasSpanChild && !text)) {
            const placeholder = isEn ? 'Click to add description...' : '点击添加说明...';
            descText.innerHTML = `<span style="color: inherit; opacity: 0.6;">${placeholder}</span>`;
            descText.title = isEn ? 'Click to add description' : '点击添加说明';
        } else if (text && text.length > 0) {
            // 有内容的，只更新title
            descText.title = isEn ? 'Double-click to edit' : '双击编辑说明';
        }
    });

    // 3. 更新说明编辑按钮的tooltip
    document.querySelectorAll('.temp-node-desc-edit-btn').forEach(btn => {
        btn.title = isEn ? 'Edit description' : '编辑说明';
    });

    document.querySelectorAll('.temp-node-desc-delete-btn').forEach(btn => {
        btn.title = isEn ? 'Delete description' : '删除说明';
    });

    // 4. 更新永久栏目的说明提示
    const permanentTipCollapsed = document.querySelector('.permanent-section-tip-collapsed span');
    if (permanentTipCollapsed) {
        const text = isEn ? 'Click to add description...' : '点击添加说明...';
        permanentTipCollapsed.textContent = text;
    }

    const permanentTipText = document.querySelector('.permanent-section-tip');
    if (permanentTipText) {
        const text = permanentTipText.textContent.trim();
        // 只更新占位符，不更新用户输入的内容
        if (text === 'Click to add description...' || text === '点击添加说明...') {
            const placeholder = isEn ? 'Click to add description...' : '点击添加说明...';
            permanentTipText.innerHTML = `<span style="opacity: 0.6;">${placeholder}</span>`;
            permanentTipText.title = isEn ? 'Click to add description' : '点击添加说明';
        } else if (text) {
            permanentTipText.title = isEn ? 'Double-click to edit' : '双击编辑说明';
        }
    }

    // 5. 更新书签关联记录排序按钮的tooltip
    const relatedSortBtn = document.getElementById('browsingRelatedSortBtn');
    if (relatedSortBtn) {
        const tooltip = relatedSortBtn.querySelector('.btn-tooltip');
        if (tooltip) {
            tooltip.textContent = browsingRelatedSortAsc 
                ? (i18n.currentAscending?.[currentLang] || (isEn ? 'Current: Ascending' : '当前：正序'))
                : (i18n.currentDescending?.[currentLang] || (isEn ? 'Current: Descending' : '当前：倒序'));
        }
    }

    console.log('[toggleLanguage] 已更新UI文字（包括临时栏目）');
}

// =============================================================================
// 实时更新
// =============================================================================

function handleStorageChange(changes, namespace) {
    if (namespace !== 'local') return;

    console.log('[存储监听] 检测到变化:', Object.keys(changes));

    // 成功备份后（自动/手动/切换），立即清理 Canvas 永久栏目内的颜色标识，并清空显式移动集合
    try {
        if (currentView === 'canvas' && changes.syncHistory) {
            const newHistory = changes.syncHistory.newValue || [];
            const oldHistory = changes.syncHistory.oldValue || [];
            if (Array.isArray(newHistory) && newHistory.length > 0) {
                const isAppended = !Array.isArray(oldHistory) || newHistory.length > oldHistory.length;
                const lastRec = newHistory[newHistory.length - 1];
                if (isAppended && lastRec && lastRec.status === 'success') {
                    const fp = lastRec.fingerprint || lastRec.time || String(Date.now());
                    if (fp !== window.__lastResetFingerprint) {
                        // 清空显式移动集合，避免蓝标残留
                        try { explicitMovedIds = new Map(); } catch (_) { }
                        resetPermanentSectionChangeMarkers();
                        window.__lastResetFingerprint = fp;
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[存储监听] 备份后清理永久栏目标识失败:', e);
    }

    // 如果正在撤销过程中，不执行自动刷新，让后台完全完成
    if (revertInProgress) {
        console.log('[存储监听] 正在撤销过程中，暂时跳过自动刷新');
        return;
    }

    // 检查相关数据是否变化 - 实时更新
    if (changes.syncHistory || changes.lastSyncTime || changes.lastBookmarkData || changes.lastSyncOperations) {
        console.log('[存储监听] 书签数据变化，立即重新加载...');

        // 清除缓存，强制重新加载
        cachedCurrentChanges = null;
        cachedBookmarkTree = null;
        cachedTreeData = null; // 清除树视图缓存
        cachedOldTree = null;
        lastTreeFingerprint = null;
        jsonDiffRendered = false; // 重置JSON渲染标志

        // 立即重新加载数据
        loadAllData({ skipRender: true }).then(async () => {
            console.log('[存储监听] 数据重新加载完成');

            // 如果当前在 current-changes 视图，使用重试机制刷新
            if (currentView === 'current-changes') {
                console.log('[存储监听] 刷新当前变化视图（带重试，强制刷新）');
                await renderCurrentChangesViewWithRetry(3, true);
            }

            // 如果当前在 tree 视图，刷新树视图（强制刷新）
            if (currentView === 'tree') {
                console.log('[存储监听] 刷新书签树与JSON视图');
                await renderTreeView(true);
            }

            // 如果当前在 canvas 视图，同步刷新永久栏目（强制刷新）
            if (currentView === 'canvas') {
                console.log('[存储监听] 刷新 Canvas 永久栏目');
                await renderTreeView(true);
                if (window.CanvasModule && window.CanvasModule.enhance) {
                    try { window.CanvasModule.enhance(); } catch (e) { console.warn('[Canvas] enhance失败:', e); }
                }
            }

            // 如果当前在 additions 视图，刷新添加记录视图
            if (currentView === 'additions') {
                console.log('[存储监听] 刷新书签温故视图');
                await renderAdditionsView();
            }

            // 如果当前在 history 视图，刷新历史记录视图
            if (currentView === 'history') {
                console.log('[存储监听] 刷新历史记录视图');
                await renderHistoryView();
            }
        });

        // 并行预加载其他视图
        setTimeout(() => {
            preloadAllViews();
        }, 500);
    }

    // 主题变化（只在没有覆盖设置时跟随主UI）
    if (changes.currentTheme && !hasThemeOverride()) {
        const newTheme = changes.currentTheme.newValue;
        console.log('[存储监听] 主题变化，跟随主UI:', newTheme);
        currentTheme = newTheme;
        document.documentElement.setAttribute('data-theme', currentTheme);

        // 更新主题切换按钮图标
        const icon = document.querySelector('#themeToggle i');
        if (icon) {
            icon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    // 语言变化（只在没有覆盖设置时跟随主UI）
    if (changes.preferredLang && !hasLangOverride()) {
        const newLang = changes.preferredLang.newValue;
        console.log('[存储监听] 语言变化，跟随主UI:', newLang);
        currentLang = newLang;

        // 更新语言切换按钮文本
        const langText = document.querySelector('#langToggle .lang-text');
        if (langText) {
            langText.textContent = currentLang === 'zh_CN' ? 'EN' : '中';
        }

        // 应用新语言到所有UI元素
        applyLanguage();

        // 重新渲染当前视图以应用语言
        renderCurrentView();
        
        // 刷新书签关联记录列表（更新badge文字）
        refreshBrowsingRelatedHistory();
    }
    
    // 翻牌历史变化（用于实时刷新热力图）
    if (changes.flipHistory && currentView === 'recommend') {
        loadHeatmapData();
    }
}

// =============================================================================
// 书签API监听（实时更新书签树）
// =============================================================================

function setupBookmarkListener() {
    if (!browserAPI.bookmarks) {
        console.warn('[书签监听] 书签API不可用');
        return;
    }

    console.log('[书签监听] 设置书签API监听器');

    // 书签创建
    browserAPI.bookmarks.onCreated.addListener(async (id, bookmark) => {
        console.log('[书签监听] 书签创建:', bookmark.title);
        try {
            addBookmarkToAdditionsCache(bookmark);
            // 支持 tree 和 canvas 视图（canvas视图包含永久栏目的书签树）
            if (currentView === 'tree' || currentView === 'canvas') {
                await applyIncrementalCreateToTree(id, bookmark);
            }
            // 立即刷新当前变化（轻量重绘容器，不刷新页面）
            if (currentView === 'current-changes') {
                await renderCurrentChangesViewWithRetry(1, true);
            }

            // 书签集合变化会影响「点击记录」「点击排行」「书签关联记录」
            // 这里使用全量重建（仅限最近一年的历史，内部有lookback与去重）
            scheduleHistoryRefresh({ forceFull: true });
        } catch (e) {
            refreshTreeViewIfVisible();
        }
    });

    // 书签删除
    browserAPI.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
        console.log('[书签监听] 书签删除:', id);
        try {
            removeBookmarkFromAdditionsCache(id);
            // 删除对应的 favicon 缓存
            // removeInfo.node 包含被删除书签的信息（包括 URL）
            if (removeInfo.node && removeInfo.node.url) {
                FaviconCache.clear(removeInfo.node.url);
            }

            // 支持 tree 和 canvas 视图（canvas视图包含永久栏目的书签树）
            if (currentView === 'tree' || currentView === 'canvas') {
                applyIncrementalRemoveFromTree(id);
            }
            if (currentView === 'current-changes') {
                await renderCurrentChangesViewWithRetry(1, true);
            }

            // 书签被删除后，对应的点击记录与排行需要重算
            scheduleHistoryRefresh({ forceFull: true });
        } catch (e) {
            refreshTreeViewIfVisible();
        }
    });

    // 书签修改
    browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
        console.log('[书签监听] 书签修改:', changeInfo);
        try {
            updateBookmarkInAdditionsCache(id, changeInfo);
            // 支持 tree 和 canvas 视图（canvas视图包含永久栏目的书签树）
            if (currentView === 'tree' || currentView === 'canvas') {
                await applyIncrementalChangeToTree(id, changeInfo);
            }
            if (currentView === 'current-changes') {
                await renderCurrentChangesViewWithRetry(1, true);
            }

            // 书签URL或标题变化会影响匹配结果，重建最近一年的点击记录
            scheduleHistoryRefresh({ forceFull: true });
        } catch (e) {
            refreshTreeViewIfVisible();
        }
    });

    // 书签移动
    browserAPI.bookmarks.onMoved.addListener(async (id, moveInfo) => {
        console.log('[书签监听] 书签移动:', id);
        try {
            moveBookmarkInAdditionsCache(id, moveInfo);
            // 将本次移动记为显式主动移动，确保稳定显示蓝色标识
            explicitMovedIds.set(id, Date.now() + Infinity);

            // 支持 tree 和 canvas 视图（canvas视图包含永久栏目的书签树）
            if (currentView === 'tree' || currentView === 'canvas') {
                await applyIncrementalMoveToTree(id, moveInfo);
            }
            if (currentView === 'current-changes') {
                await renderCurrentChangesViewWithRetry(1, true);
            }
        } catch (e) {
            refreshTreeViewIfVisible();
        }
    });
}

// 如果当前在树视图或Canvas视图，刷新书签树
async function refreshTreeViewIfVisible() {
    // 支持 tree 和 canvas 视图（canvas视图包含永久栏目的书签树）
    if (currentView === 'tree' || currentView === 'canvas') {
        console.log('[书签监听] 检测到书签变化，刷新树视图');

        // 清除缓存，强制刷新
        cachedBookmarkTree = null;
        cachedTreeData = null;
        lastTreeFingerprint = null;
        jsonDiffRendered = false;

        // 延迟一点刷新，避免频繁更新
        setTimeout(async () => {
            try {
                await renderTreeView(true);
                console.log('[书签监听] 树视图刷新完成');
            } catch (error) {
                console.error('[书签监听] 刷新树视图失败:', error);
            }
        }, 200);
    }
}

// =============================================================================
// 消息监听
// =============================================================================

function setupRealtimeMessageListener() {
    if (messageListenerRegistered) return;
    messageListenerRegistered = true;

    browserAPI.runtime.onMessage.addListener((message) => {
        if (!message || !message.action) return;

        if (message.action === 'analysisUpdated') {
            if (!viewerInitialized) {
                deferredAnalysisMessage = message;
                return;
            }
            handleAnalysisUpdatedMessage(message);
        } else if (message.action === 'clearFaviconCache') {
            // 书签URL被修改，清除favicon缓存（静默）
            if (message.url) {
                FaviconCache.clear(message.url);
            }
        } else if (message.action === 'updateFaviconFromTab') {
            // 从打开的 tab 更新 favicon（静默）
            if (message.url && message.favIconUrl) {
                FaviconCache.save(message.url, message.favIconUrl).then(() => {
                    // 更新页面上对应的 favicon 图标
                    updateFaviconImages(message.url, message.favIconUrl);
                }).catch(() => {
                    // 静默处理错误
                });
            }
        } else if (message.action === 'captureCanvasThumbnailNow') {
            // 主 UI 请求当前 Canvas 立即截图
            if (currentView === 'canvas') {
                try {
                    captureCanvasThumbnail();
                } catch (e) {
                    console.warn('[Canvas Thumbnail] 即时截图失败:', e);
                }
            }
        } else if (message.action === 'clearExplicitMoved') {
            try {
                explicitMovedIds = new Map();
                if (currentView === 'canvas') {
                    resetPermanentSectionChangeMarkers();
                }
            } catch (e) { /* 忽略 */ }
        } else if (message.action === 'recentMovedBroadcast' && message.id) {
            // 后台广播的最近被移动的ID，立即记入显式集合（仅标记这个节点）
            // 这确保用户拖拽的节点优先被标识为蓝色"moved"
            // 永久记录，不再有时间限制
            explicitMovedIds.set(message.id, Date.now() + Infinity);
            // 若在树视图，立即给这个被拖拽的节点补蓝标（不影响其他节点）
            if (currentView === 'tree' || currentView === 'canvas') {
                try {
                    const container = document.getElementById('bookmarkTree');
                    const item = container && container.querySelector(`.tree-item[data-node-id="${message.id}"]`);
                    if (item) {
                        const badges = item.querySelector('.change-badges');
                        if (badges) {
                            const existing = badges.querySelector('.change-badge.moved');
                            if (existing) existing.remove();
                            let tip = '';
                            try {
                                if (cachedOldTree) {
                                    const bcSelf = getNamedPathFromTree(cachedOldTree, String(message.id));
                                    if (bcSelf) tip = breadcrumbToSlashFolders(bcSelf);
                                }
                            } catch (_) { }
                            if (!tip) tip = '/';
                            badges.insertAdjacentHTML('beforeend', `<span class="change-badge moved" data-move-from="${escapeHtml(tip)}" title="${escapeHtml(tip)}"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${slashPathToChipsHTML(tip)}</span></span>`);
                            item.classList.add('tree-change-moved');
                        }
                    }
                } catch (_) { }
            }
        }
    });
}

// ==================== 事件委托设置 ====================
// 使用事件委托处理所有按钮的data-action属性，避免CSP错误
function setupEventDelegation() {
    // 使用事件委托处理按钮点击
    document.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        console.log('[事件委托] 处理按钮点击:', action);

        try {
            switch (action) {
                case 'copyCurrentDiff':
                    await window.copyCurrentDiff();
                    break;
                case 'copyHistoryDiff':
                    // 获取recordTime（可能在button上或父元素上）
                    const recordTime = button.dataset.recordTime || button.closest('[data-record-time]')?.dataset.recordTime;
                    if (recordTime) {
                        await window.copyHistoryDiff(recordTime);
                    }
                    break;
                case 'copyAllHistory':
                    await window.copyAllHistoryDiff();
                    break;
                case 'copyJSONDiff':
                    await copyJSONDiff();
                    break;
                default:
                    console.warn('[事件委托] 未知的action:', action);
            }
        } catch (error) {
            console.error('[事件委托] 处理按钮点击失败:', action, error);
        }
    });
}

async function handleAnalysisUpdatedMessage(message) {
    if (realtimeUpdateInProgress) {
        pendingAnalysisMessage = message;
        return;
    }

    realtimeUpdateInProgress = true;
    try {
        await processAnalysisUpdatedMessage(message);
    } catch (error) {
        console.error('[消息监听] 处理 analysisUpdated 失败:', error);
    } finally {
        realtimeUpdateInProgress = false;
        if (pendingAnalysisMessage) {
            const nextMessage = pendingAnalysisMessage;
            pendingAnalysisMessage = null;
            handleAnalysisUpdatedMessage(nextMessage);
        }
    }
}

async function processAnalysisUpdatedMessage(message) {
    console.log('[消息监听] 收到 analysisUpdated 消息:', {
        bookmarkDiff: message.bookmarkDiff,
        folderDiff: message.folderDiff,
        bookmarkCount: message.bookmarkCount,
        folderCount: message.folderCount
    });

    const analysisSignature = JSON.stringify({
        bookmarkDiff: message.bookmarkDiff,
        folderDiff: message.folderDiff,
        bookmarkMoved: message.bookmarkMoved,
        folderMoved: message.folderMoved,
        bookmarkModified: message.bookmarkModified,
        folderModified: message.folderModified,
        bookmarkCount: message.bookmarkCount,
        folderCount: message.folderCount
    });

    if (analysisSignature === lastAnalysisSignature) {
        console.log('[消息监听] 数据未变化，跳过刷新');
        return;
    }

    lastAnalysisSignature = analysisSignature;

    cachedCurrentChanges = null;
    cachedBookmarkTree = null;

    if (currentView === 'current-changes') {
        // 直接轻量刷新当前变化视图
        await renderCurrentChangesViewWithRetry(1, false);
    }

    setTimeout(() => {
        preloadAllViews();
    }, 500);
}

// =============================================================================
// 工具函数
// =============================================================================

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading() {
    document.querySelectorAll('.view.active .history-commits, .view.active .additions-container, .view.active .bookmark-tree').forEach(el => {
        el.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    });
}

function showError(message) {
    const container = document.querySelector('.view.active > div:last-child');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="empty-state-title">${message}</div>
            </div>
        `;
    }
}

function showToast(message) {
    // 简单的提示功能
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        background: var(--accent-primary);
        color: white;
        border-radius: 8px;
        box-shadow: var(--shadow-lg);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

async function refreshData() {
    const btn = document.getElementById('refreshBtn');
    const icon = btn.querySelector('i');

    icon.style.animation = 'spin 0.5s linear infinite';

    // 手动刷新时，强制刷新background缓存
    await loadAllData({ skipRender: true });

    if (currentView === 'additions') {
        try {
            renderAdditionsView();
        } catch (error) {
            console.warn('[refreshData] 渲染书签添加记录失败:', error);
        }
    }

    await refreshBrowsingHistoryData({ forceFull: true, silent: true });

    // 如果当前在变化视图，强制刷新渲染
    if (currentView === 'current-changes') {
        await renderCurrentChangesViewWithRetry(3, true);
    }

    // 如果当前在树视图，强制刷新树视图
    if (currentView === 'tree') {
        await renderTreeView(true);
    }

    icon.style.animation = '';

    showToast(currentLang === 'zh_CN' ? '数据已刷新' : 'Data Refreshed');
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// =============================================================================
// 复制Diff功能
// =============================================================================

// 复制当前Changes视图的diff（JSON格式，限制数量以防止卡顿）
window.copyCurrentDiff = async function () {
    try {
        const changeData = await getDetailedChanges(false);

        // 获取当前书签树用于生成git diff
        const currentTree = await new Promise(resolve => {
            browserAPI.bookmarks.getTree(resolve);
        });

        // 获取上一次备份的树
        let oldTree = null;
        const lastData = await new Promise(resolve => {
            browserAPI.storage.local.get(['lastBookmarkData'], (data) => {
                resolve(data.lastBookmarkData);
            });
        });

        if (lastData && lastData.bookmarkTree) {
            oldTree = lastData.bookmarkTree;
        }

        // 生成Git diff格式
        let diffText = '';

        if (oldTree && currentTree) {
            // 生成文件树的git diff
            const oldLines = bookmarkTreeToLines(oldTree);
            const newLines = bookmarkTreeToLines(currentTree);
            const hunks = generateGitDiff(oldLines, newLines);
            diffText = hunksToGitDiffText(hunks, 'bookmarks.html', 'bookmarks.html', currentLang);
        }

        // 添加变化统计头部
        let result = '';
        result += `# 书签变化统计\n`;
        result += `# 生成时间: ${new Date().toLocaleString()}\n`;
        result += `#\n`;

        if (changeData.stats) {
            result += `# 数量变化: `;
            if (changeData.stats.bookmarkDiff !== 0) {
                result += `书签 ${changeData.stats.bookmarkDiff > 0 ? '+' : ''}${changeData.stats.bookmarkDiff}`;
            }
            if (changeData.stats.folderDiff !== 0) {
                if (changeData.stats.bookmarkDiff !== 0) result += ', ';
                result += `文件夹 ${changeData.stats.folderDiff > 0 ? '+' : ''}${changeData.stats.folderDiff}`;
            }
            result += `\n`;
        }

        // 变化明细
        if (changeData.added && changeData.added.length > 0) {
            result += `# 新增: ${changeData.added.length}项\n`;
        }
        if (changeData.deleted && changeData.deleted.length > 0) {
            result += `# 删除: ${changeData.deleted.length}项\n`;
        }
        if (changeData.moved && changeData.moved.length > 0) {
            result += `# 移动: ${changeData.moved.length}项\n`;
        }
        if (changeData.modified && changeData.modified.length > 0) {
            result += `# 修改: ${changeData.modified.length}项\n`;
        }
        result += `#\n`;

        result += diffText;

        await navigator.clipboard.writeText(result);
        showToast(currentLang === 'zh_CN' ? 'Git Diff已复制到剪贴板' : 'Git Diff copied to clipboard');
    } catch (error) {
        console.error('[复制Diff] 失败:', error);
        showToast(currentLang === 'zh_CN' ? '复制失败' : 'Copy failed');
    }
};



// 复制历史记录的diff（JSON格式，排除bookmarkTree以防止卡顿）
window.copyHistoryDiff = async function (recordTime) {
    try {
        const recordIndex = syncHistory.findIndex(r => r.time === recordTime);
        if (recordIndex === -1) {
            showToast(currentLang === 'zh_CN' ? '未找到记录' : 'Record not found');
            return;
        }

        const record = syncHistory[recordIndex];
        let result = '';

        // 生成diff文件头
        result += `# 备份历史记录 - Git Diff\n`;
        result += `# 备份时间: ${record.time || new Date().toLocaleString()}\n`;
        result += `# 备份类型: ${record.type || 'unknown'}\n`;
        result += `# 备份方向: ${record.direction || 'unknown'}\n`;
        result += `# 备份状态: ${record.status || 'unknown'}\n`;
        if (record.note) {
            result += `# 备份备注: ${record.note}\n`;
        }
        result += `#\n`;

        // 添加统计信息
        if (record.bookmarkStats) {
            result += `# 当前统计:\n`;
            result += `# - 书签数: ${record.bookmarkStats.currentBookmarkCount || 0}\n`;
            result += `# - 文件夹数: ${record.bookmarkStats.currentFolderCount || 0}\n`;
            if (record.bookmarkStats.prevBookmarkCount !== undefined) {
                result += `# - 书签变化: ${record.bookmarkStats.bookmarkDiff > 0 ? '+' : ''}${record.bookmarkStats.bookmarkDiff || 0}\n`;
            }
            if (record.bookmarkStats.prevFolderCount !== undefined) {
                result += `# - 文件夹变化: ${record.bookmarkStats.folderDiff > 0 ? '+' : ''}${record.bookmarkStats.folderDiff || 0}\n`;
            }
            result += `#\n`;
        }

        // 如果是第一次备份
        if (record.isFirstBackup) {
            result += `# ===== 首次备份 - 初始内容 =====\n`;
            if (record.bookmarkTree) {
                const lines = bookmarkTreeToLines(record.bookmarkTree);
                result += `diff --git a/bookmarks.html b/bookmarks.html\n`;
                result += `new file mode 100644\n`;
                result += `index 0000000..1111111\n`;
                result += `--- /dev/null\n`;
                result += `+++ b/bookmarks.html\n`;

                // 生成所有行为新增
                lines.forEach((line, idx) => {
                    result += `+${line.line}\n`;
                });
            }
        } else if (recordIndex > 0) {
            // 获取前一个备份
            const prevRecord = syncHistory[recordIndex - 1];
            if (prevRecord && record.bookmarkTree && prevRecord.bookmarkTree) {
                // 对比两个备份
                const oldLines = bookmarkTreeToLines(prevRecord.bookmarkTree);
                const newLines = bookmarkTreeToLines(record.bookmarkTree);
                const hunks = generateGitDiff(oldLines, newLines);
                const diffText = hunksToGitDiffText(hunks, 'bookmarks.html', 'bookmarks.html', currentLang);
                result += diffText;
            } else {
                result += `# 无法生成完整的diff（缺少前一个备份的数据）\n`;
                if (record.bookmarkStats) {
                    result += `# 数量变化:\n`;
                    if (record.bookmarkStats.bookmarkDiff !== 0) {
                        result += `#   书签: ${record.bookmarkStats.bookmarkDiff > 0 ? '+' : ''}${record.bookmarkStats.bookmarkDiff}\n`;
                    }
                    if (record.bookmarkStats.folderDiff !== 0) {
                        result += `#   文件夹: ${record.bookmarkStats.folderDiff > 0 ? '+' : ''}${record.bookmarkStats.folderDiff}\n`;
                    }
                }
            }
        } else {
            result += `# 无法生成diff（这是第一个备份）\n`;
        }

        await navigator.clipboard.writeText(result);

        const message = record.isFirstBackup
            ? (currentLang === 'zh_CN' ? '已复制首次备份的Git Diff' : 'Copied first backup Git Diff')
            : (currentLang === 'zh_CN' ? 'Git Diff已复制到剪贴板' : 'Git Diff copied to clipboard');
        showToast(message);
    } catch (error) {
        console.error('[复制历史Diff] 失败:', error);
        showToast(currentLang === 'zh_CN' ? '复制失败' : 'Copy failed');
    }
};


// 从书签树提取书签列表（扁平化，包含路径信息）
function extractBookmarksFromTree(tree) {
    const bookmarks = [];

    function traverse(nodes, path = []) {
        if (!nodes) return;

        nodes.forEach(node => {
            if (node.url) {
                // 这是一个书签
                bookmarks.push({
                    title: node.title,
                    url: node.url,
                    folder: path.join(' > ') || (currentLang === 'zh_CN' ? '根目录' : 'Root'),
                    dateAdded: node.dateAdded ? new Date(node.dateAdded).toISOString() : null
                });
            } else if (node.children) {
                // 这是一个文件夹，递归处理
                traverse(node.children, [...path, node.title]);
            }
        });
    }

    if (tree && tree[0] && tree[0].children) {
        traverse(tree[0].children);
    }

    return bookmarks;
}

// 复制所有历史记录的diff（JSON格式，排除bookmarkTree以防止卡顿）
window.copyAllHistoryDiff = async function () {
    try {
        const allDiffs = syncHistory.map(record => ({
            timestamp: record.time,
            direction: record.direction,
            status: record.status,
            syncType: record.type,
            note: record.note || '',
            errorMessage: record.errorMessage || '',
            isFirstBackup: record.isFirstBackup || false,
            // 只保留统计数字，不包含完整树结构
            bookmarkStats: record.bookmarkStats ? {
                currentBookmarkCount: record.bookmarkStats.currentBookmarkCount,
                currentFolderCount: record.bookmarkStats.currentFolderCount,
                prevBookmarkCount: record.bookmarkStats.prevBookmarkCount,
                prevFolderCount: record.bookmarkStats.prevFolderCount,
                bookmarkDiff: record.bookmarkStats.bookmarkDiff,
                folderDiff: record.bookmarkStats.folderDiff,
                bookmarkMoved: record.bookmarkStats.bookmarkMoved,
                folderMoved: record.bookmarkStats.folderMoved,
                bookmarkModified: record.bookmarkStats.bookmarkModified,
                folderModified: record.bookmarkStats.folderModified
            } : null
        }));

        const jsonString = JSON.stringify(allDiffs, null, 2);
        await navigator.clipboard.writeText(jsonString);
        showToast(currentLang === 'zh_CN' ? `已复制${allDiffs.length}条历史记录` : `Copied ${allDiffs.length} records`);
    } catch (error) {
        console.error('[复制所有历史Diff] 失败:', error);
        showToast(currentLang === 'zh_CN' ? '复制失败' : 'Copy failed');
    }
};

// 导出历史记录的diff为HTML（可视化格式）
window.exportHistoryDiffToHTML = async function (recordTime) {
    try {
        const recordIndex = syncHistory.findIndex(r => r.time === recordTime);
        if (recordIndex === -1) {
            showToast(currentLang === 'zh_CN' ? '未找到记录' : 'Record not found');
            return;
        }

        const record = syncHistory[recordIndex];

        // 获取diff数据（与copyHistoryDiff相同的逻辑）
        let diffData;

        if (record.isFirstBackup && record.bookmarkTree) {
            // 第一次备份：完整的书签列表
            const bookmarksList = extractBookmarksFromTree(record.bookmarkTree);
            diffData = {
                timestamp: record.time,
                type: 'first-backup',
                direction: record.direction,
                status: record.status,
                syncType: record.type,
                note: record.note || '',
                isFirstBackup: true,
                totalBookmarks: bookmarksList.length,
                totalFolders: record.bookmarkStats?.currentFolderCount || 0,
                bookmarks: bookmarksList
            };
        } else if (record.bookmarkTree && recordIndex > 0) {
            // 有完整书签树，可以计算详细diff
            const prevRecord = syncHistory[recordIndex - 1];
            if (prevRecord && prevRecord.bookmarkTree) {
                // 计算diff
                const oldTree = prevRecord.bookmarkTree;
                const newTree = record.bookmarkTree;

                const oldPrints = generateFingerprintsFromTree(oldTree);
                const newPrints = generateFingerprintsFromTree(newTree);

                const oldBookmarkPrints = new Set(oldPrints.bookmarks);
                const newBookmarkPrints = new Set(newPrints.bookmarks);

                const added = [];
                const deleted = [];
                const moved = [];

                // 检测新增和移动
                for (const print of newBookmarkPrints) {
                    if (!oldBookmarkPrints.has(print)) {
                        const bookmark = parseBookmarkFingerprint(print);
                        if (bookmark) {
                            let isMoved = false;
                            for (const oldPrint of oldBookmarkPrints) {
                                const oldBookmark = parseBookmarkFingerprint(oldPrint);
                                if (oldBookmark && oldBookmark.url === bookmark.url) {
                                    if (oldBookmark.path !== bookmark.path || oldBookmark.title !== bookmark.title) {
                                        isMoved = true;
                                        moved.push({
                                            ...bookmark,
                                            oldPath: oldBookmark.path,
                                            oldTitle: oldBookmark.title
                                        });
                                    }
                                    break;
                                }
                            }
                            if (!isMoved) {
                                added.push(bookmark);
                            }
                        }
                    }
                }

                // 检测删除
                for (const print of oldBookmarkPrints) {
                    if (!newBookmarkPrints.has(print)) {
                        const bookmark = parseBookmarkFingerprint(print);
                        if (bookmark) {
                            const isInMoved = moved.some(m => m.url === bookmark.url);
                            if (!isInMoved) {
                                deleted.push(bookmark);
                            }
                        }
                    }
                }

                diffData = {
                    timestamp: record.time,
                    type: 'history-diff',
                    direction: record.direction,
                    status: record.status,
                    syncType: record.type,
                    note: record.note || '',
                    bookmarkStats: record.bookmarkStats,
                    added: added,
                    deleted: deleted,
                    moved: moved,
                    hasDetailedDiff: true
                };
            } else {
                // 没有前一条记录的树，只能显示统计信息
                diffData = {
                    timestamp: record.time,
                    type: 'history-record',
                    direction: record.direction,
                    status: record.status,
                    syncType: record.type,
                    note: record.note || '',
                    bookmarkStats: record.bookmarkStats,
                    hasDetailedDiff: false
                };
            }
        } else {
            // 没有书签树，只显示统计信息
            diffData = {
                timestamp: record.time,
                type: 'history-record',
                direction: record.direction,
                status: record.status,
                syncType: record.type,
                note: record.note || '',
                bookmarkStats: record.bookmarkStats,
                hasDetailedDiff: false
            };
        }

        // 将diff数据转换为HTML
        const htmlContent = convertDiffDataToHTML(diffData);

        // 创建下载
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bookmark-diff-${new Date(record.time).toISOString().replace(/[:.]/g, '-')}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(currentLang === 'zh_CN' ? 'Diff HTML已导出' : 'Diff HTML exported');
    } catch (error) {
        console.error('[导出Diff HTML] 失败:', error);
        showToast(currentLang === 'zh_CN' ? '导出失败' : 'Export failed');
    }
};

// 将diff数据转换为标准Netscape书签HTML格式（浏览器可导入）
function convertDiffDataToHTML(diffData) {
    const lang = currentLang || 'zh_CN';
    const isZh = lang === 'zh_CN';
    const timestamp = new Date(diffData.timestamp).toISOString();
    const dateAdded = Math.floor(new Date(diffData.timestamp).getTime() / 1000);

    // 标准Netscape书签HTML头部
    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<!-- Bookmark Backup Extension - Diff Export -->
<!-- Timestamp: ${timestamp} -->
<!-- Type: ${diffData.type} -->
<!-- Status: ${diffData.status} -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

    // 如果是首次备份，导出所有书签
    if (diffData.type === 'first-backup' && diffData.bookmarks) {
        // 按文件夹分组
        const folderMap = {};
        diffData.bookmarks.forEach(bookmark => {
            const folder = bookmark.folder || (isZh ? '根目录' : 'Root');
            if (!folderMap[folder]) {
                folderMap[folder] = [];
            }
            folderMap[folder].push(bookmark);
        });

        // 生成HTML
        Object.keys(folderMap).sort().forEach(folder => {
            const bookmarks = folderMap[folder];

            // 文件夹标题
            if (folder && folder !== (isZh ? '根目录' : 'Root')) {
                html += `    <DT><H3 ADD_DATE="${dateAdded}">${escapeHtml(folder)}</H3>\n`;
                html += `    <DL><p>\n`;

                bookmarks.forEach(bookmark => {
                    const bookmarkDate = bookmark.dateAdded ? Math.floor(new Date(bookmark.dateAdded).getTime() / 1000) : dateAdded;
                    html += `        <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${bookmarkDate}">${escapeHtml(bookmark.title)}</A>\n`;
                });

                html += `    </DL><p>\n`;
            } else {
                // 根目录的书签
                bookmarks.forEach(bookmark => {
                    const bookmarkDate = bookmark.dateAdded ? Math.floor(new Date(bookmark.dateAdded).getTime() / 1000) : dateAdded;
                    html += `    <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${bookmarkDate}">${escapeHtml(bookmark.title)}</A>\n`;
                });
            }
        });
    }
    // 如果有详细diff，按类别导出
    else if (diffData.hasDetailedDiff) {
        // 新增的书签
        if (diffData.added && diffData.added.length > 0) {
            html += `    <DT><H3 ADD_DATE="${dateAdded}">${isZh ? '新增书签' : 'Added Bookmarks'}</H3>\n`;
            html += `    <DL><p>\n`;

            // 按路径分组
            const folderMap = {};
            diffData.added.forEach(bookmark => {
                const folder = bookmark.path || (isZh ? '根目录' : 'Root');
                if (!folderMap[folder]) {
                    folderMap[folder] = [];
                }
                folderMap[folder].push(bookmark);
            });

            Object.keys(folderMap).sort().forEach(folder => {
                const bookmarks = folderMap[folder];

                if (folder && folder !== (isZh ? '根目录' : 'Root')) {
                    html += `        <DT><H3 ADD_DATE="${dateAdded}">${escapeHtml(folder)}</H3>\n`;
                    html += `        <DL><p>\n`;
                    bookmarks.forEach(bookmark => {
                        html += `            <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${dateAdded}">${escapeHtml(bookmark.title)}</A>\n`;
                    });
                    html += `        </DL><p>\n`;
                } else {
                    bookmarks.forEach(bookmark => {
                        html += `        <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${dateAdded}">${escapeHtml(bookmark.title)}</A>\n`;
                    });
                }
            });

            html += `    </DL><p>\n`;
        }

        // 删除的书签
        if (diffData.deleted && diffData.deleted.length > 0) {
            html += `    <DT><H3 ADD_DATE="${dateAdded}">${isZh ? '删除书签' : 'Deleted Bookmarks'}</H3>\n`;
            html += `    <DL><p>\n`;

            // 按路径分组
            const folderMap = {};
            diffData.deleted.forEach(bookmark => {
                const folder = bookmark.path || (isZh ? '根目录' : 'Root');
                if (!folderMap[folder]) {
                    folderMap[folder] = [];
                }
                folderMap[folder].push(bookmark);
            });

            Object.keys(folderMap).sort().forEach(folder => {
                const bookmarks = folderMap[folder];

                if (folder && folder !== (isZh ? '根目录' : 'Root')) {
                    html += `        <DT><H3 ADD_DATE="${dateAdded}">${escapeHtml(folder)}</H3>\n`;
                    html += `        <DL><p>\n`;
                    bookmarks.forEach(bookmark => {
                        html += `            <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${dateAdded}">${escapeHtml(bookmark.title)}</A>\n`;
                    });
                    html += `        </DL><p>\n`;
                } else {
                    bookmarks.forEach(bookmark => {
                        html += `        <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${dateAdded}">${escapeHtml(bookmark.title)}</A>\n`;
                    });
                }
            });

            html += `    </DL><p>\n`;
        }

        // 移动的书签
        if (diffData.moved && diffData.moved.length > 0) {
            html += `    <DT><H3 ADD_DATE="${dateAdded}">${isZh ? '移动书签' : 'Moved Bookmarks'}</H3>\n`;
            html += `    <DL><p>\n`;

            // 按新路径分组
            const folderMap = {};
            diffData.moved.forEach(bookmark => {
                const folder = bookmark.path || (isZh ? '根目录' : 'Root');
                if (!folderMap[folder]) {
                    folderMap[folder] = [];
                }
                folderMap[folder].push(bookmark);
            });

            Object.keys(folderMap).sort().forEach(folder => {
                const bookmarks = folderMap[folder];

                if (folder && folder !== (isZh ? '根目录' : 'Root')) {
                    html += `        <DT><H3 ADD_DATE="${dateAdded}">${escapeHtml(folder)}</H3>\n`;
                    html += `        <DL><p>\n`;
                    bookmarks.forEach(bookmark => {
                        const titleWithNote = bookmark.oldPath !== bookmark.path
                            ? `${escapeHtml(bookmark.title)} [${isZh ? '从' : 'from'}: ${escapeHtml(bookmark.oldPath)}]`
                            : escapeHtml(bookmark.title);
                        html += `            <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${dateAdded}">${titleWithNote}</A>\n`;
                    });
                    html += `        </DL><p>\n`;
                } else {
                    bookmarks.forEach(bookmark => {
                        const titleWithNote = bookmark.oldPath !== bookmark.path
                            ? `${escapeHtml(bookmark.title)} [${isZh ? '从' : 'from'}: ${escapeHtml(bookmark.oldPath)}]`
                            : escapeHtml(bookmark.title);
                        html += `        <DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${dateAdded}">${titleWithNote}</A>\n`;
                    });
                }
            });

            html += `    </DL><p>\n`;
        }
    }
    // 如果没有详细数据，添加一个说明
    else {
        html += `    <DT><H3 ADD_DATE="${dateAdded}">${isZh ? '无详细变化数据' : 'No Detailed Changes'}</H3>\n`;
        html += `    <DL><p>\n`;
        html += `        <DT>${isZh ? '此记录仅包含统计信息，无法导出具体书签' : 'This record only contains statistics, no bookmarks available'}\n`;
        html += `    </DL><p>\n`;
    }

    html += `</DL><p>\n`;

    return html;
}

// 将书签树转换为Netscape标准HTML格式（浏览器可导入）
function convertBookmarkTreeToNetscapeHTML(bookmarkTree, timestamp) {
    const dateAdded = Math.floor(new Date(timestamp).getTime() / 1000);

    let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

    // 递归处理书签树
    function processNode(node, indent = '    ') {
        if (!node) return '';

        let result = '';

        if (node.url) {
            // 这是一个书签
            const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : dateAdded;
            const title = escapeHtml(node.title || 'Untitled');
            const url = escapeHtml(node.url);
            result += `${indent}<DT><A HREF="${url}" ADD_DATE="${addDate}">${title}</A>\n`;
        } else if (node.children) {
            // 这是一个文件夹
            const folderDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : dateAdded;
            const folderTitle = escapeHtml(node.title || 'Untitled Folder');

            result += `${indent}<DT><H3 ADD_DATE="${folderDate}">${folderTitle}</H3>\n`;
            result += `${indent}<DL><p>\n`;

            // 处理子节点
            for (const child of node.children) {
                result += processNode(child, indent + '    ');
            }

            result += `${indent}</DL><p>\n`;
        }

        return result;
    }

    // 处理根节点的children
    if (bookmarkTree && bookmarkTree[0] && bookmarkTree[0].children) {
        for (const child of bookmarkTree[0].children) {
            html += processNode(child);
        }
    }

    html += `</DL><p>\n`;

    return html;
}
// ============================================================================
// 书签关联记录功能（浏览器历史记录 + 书签标识）
// 复用「点击记录」的 browsingHistoryCalendarInstance.bookmarksByDate 数据库
// ============================================================================

let browsingRelatedSortAsc = false; // 排序方式：false=倒序（新到旧），true=正序（旧到新）
let browsingRelatedCurrentRange = 'day'; // 当前选中的时间范围
let browsingRelatedBookmarkUrls = null; // 缓存的书签URL集合（用于标识）
let browsingRelatedBookmarkTitles = null; // 缓存的书签标题集合（用于标识）
let browsingRelatedBookmarkInfo = null; // 缓存的书签URL->标题映射（用于统计与展示）

// 初始化书签关联记录
function initBrowsingRelatedHistory() {
    const panel = document.getElementById('browsingRelatedPanel');
    if (!panel) return;

    const buttons = panel.querySelectorAll('.ranking-time-filter-btn');
    const sortBtn = document.getElementById('browsingRelatedSortBtn');
    if (!buttons.length) return;

    const allowedRanges = ['day', 'week', 'month', 'year', 'all'];

    const setActiveRange = (range, shouldPersist = true) => {
        if (!allowedRanges.includes(range)) {
            range = 'day';
        }

        browsingRelatedCurrentRange = range;

        buttons.forEach(btn => {
            if (btn.dataset.range === range) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // 显示对应的时间段菜单
        showBrowsingRelatedTimeMenu(range);
        
        loadBrowsingRelatedHistory(range);

        if (shouldPersist) {
            try {
                localStorage.setItem('browsingRelatedActiveRange', range);
            } catch (storageErr) {
                console.warn('[BrowsingRelated] 无法保存筛选范围:', storageErr);
            }
        }
    };

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const range = btn.dataset.range || 'day';
            setActiveRange(range);
        });
    });

    // 排序按钮事件
    if (sortBtn) {
        // 创建tooltip
        const tooltip = document.createElement('span');
        tooltip.className = 'btn-tooltip';
        const updateTooltip = () => {
            tooltip.textContent = browsingRelatedSortAsc 
                ? (i18n.currentAscending?.[currentLang] || (currentLang === 'zh_CN' ? '当前：正序' : 'Current: Ascending'))
                : (i18n.currentDescending?.[currentLang] || (currentLang === 'zh_CN' ? '当前：倒序' : 'Current: Descending'));
        };
        updateTooltip();
        sortBtn.appendChild(tooltip);
        
        sortBtn.addEventListener('click', () => {
            browsingRelatedSortAsc = !browsingRelatedSortAsc;
            if (browsingRelatedSortAsc) {
                sortBtn.classList.add('asc');
            } else {
                sortBtn.classList.remove('asc');
            }
            updateTooltip();
            loadBrowsingRelatedHistory(browsingRelatedCurrentRange);
        });
    }

    let initialRange = 'day';
    try {
        const saved = localStorage.getItem('browsingRelatedActiveRange');
        if (saved && allowedRanges.includes(saved)) {
            initialRange = saved;
        }
    } catch (storageErr) {
        console.warn('[BrowsingRelated] 无法读取筛选范围:', storageErr);
    }

    setActiveRange(initialRange, false);
}

// 刷新书签关联记录
async function refreshBrowsingRelatedHistory() {
    const panel = document.getElementById('browsingRelatedPanel');
    if (!panel || !panel.classList.contains('active')) return;
    
    const activeBtn = panel.querySelector('.ranking-time-filter-btn.active');
    const range = activeBtn ? (activeBtn.dataset.range || 'day') : 'day';
    
    // 清除书签URL/标题缓存（以便重新获取最新书签）
    browsingRelatedBookmarkUrls = null;
    browsingRelatedBookmarkTitles = null;
    browsingRelatedBookmarkInfo = null;
    
    // ✨ 等待日历数据同步完成（确保标题匹配的记录能正确显示）
    const waitForCalendarData = async () => {
        const start = Date.now();
        const timeout = 2000; // 2秒超时
        while (Date.now() - start < timeout) {
            const inst = window.browsingHistoryCalendarInstance;
            if (inst && inst.bookmarksByDate && inst.bookmarksByDate.size > 0) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    };
    
    const dataReady = await waitForCalendarData();
    if (!dataReady) {
        console.warn('[BrowsingRelated] 等待日历数据超时');
    }
    
    // 直接重新加载（数据来自 browsingHistoryCalendarInstance）
    loadBrowsingRelatedHistory(range);
}

// 获取书签URL和标题集合（使用URL或标题匹配）
async function getBookmarkUrlsAndTitles() {
    if (browsingRelatedBookmarkUrls && browsingRelatedBookmarkTitles && browsingRelatedBookmarkInfo) {
        return {
            urls: browsingRelatedBookmarkUrls,
            titles: browsingRelatedBookmarkTitles,
            info: browsingRelatedBookmarkInfo
        };
    }

    const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
    if (!browserAPI || !browserAPI.bookmarks || !browserAPI.bookmarks.getTree) {
        return { urls: new Set(), titles: new Set() };
    }

    const urls = new Set();
    const titles = new Set();
    const info = new Map(); // url -> { url, title, folderPath }
    
    const collectUrlsAndTitles = (nodes, parentPath = []) => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
            if (node.url) {
                const url = node.url;
                urls.add(url);

                // 同时收集标题（去除空白后存储）
                const trimmedTitle = typeof node.title === 'string' ? node.title.trim() : '';
                if (trimmedTitle) {
                    titles.add(trimmedTitle);
                }

                // 记录URL到标题和文件夹路径的映射
                if (!info.has(url)) {
                    info.set(url, {
                        url,
                        title: trimmedTitle || url,
                        folderPath: parentPath.slice() // 复制父文件夹路径
                    });
                }
            }
            if (node.children) {
                // 构建当前节点的路径（排除根节点）
                const currentPath = node.title ? [...parentPath, node.title] : parentPath;
                collectUrlsAndTitles(node.children, currentPath);
            }
        }
    };

    try {
        const tree = await new Promise((resolve, reject) => {
            browserAPI.bookmarks.getTree((result) => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    reject(browserAPI.runtime.lastError);
                } else {
                    resolve(result);
                }
            });
        });
        
        collectUrlsAndTitles(tree);
        browsingRelatedBookmarkUrls = urls;
        browsingRelatedBookmarkTitles = titles;
        browsingRelatedBookmarkInfo = info;
        return { urls, titles, info };
    } catch (error) {
        console.error('[BrowsingRelated] 获取书签URL和标题失败:', error);
        return { urls: new Set(), titles: new Set(), info: new Map() };
    }
}

// 获取时间范围的起始时间
function getTimeRangeStart(range) {
    const now = new Date();
    let startTime = new Date();

    switch (range) {
        case 'day':
            startTime.setHours(0, 0, 0, 0);
            break;
        case 'week':
            const dayOfWeek = now.getDay();
            const daysToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
            startTime.setDate(now.getDate() - daysToMonday);
            startTime.setHours(0, 0, 0, 0);
            break;
        case 'month':
            startTime.setDate(1);
            startTime.setHours(0, 0, 0, 0);
            break;
        case 'year':
            startTime.setMonth(0, 1);
            startTime.setHours(0, 0, 0, 0);
            break;
        case 'all':
            return 0; // 从最早时间开始
        default:
            startTime.setHours(0, 0, 0, 0);
    }

    return startTime.getTime();
}

// 获取书签关联历史数据（不渲染，仅返回数据）
async function getBrowsingRelatedHistoryData(range = 'day') {
    const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
    if (!browserAPI || !browserAPI.history || !browserAPI.history.search) {
        return [];
    }

    try {
        const startTime = getTimeRangeStart(range);
        const endTime = Date.now();

        const historyItems = await new Promise((resolve, reject) => {
            browserAPI.history.search({
                text: '',
                startTime: startTime,
                endTime: endTime,
                maxResults: 0
            }, (results) => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    reject(browserAPI.runtime.lastError);
                } else {
                    resolve(results || []);
                }
            });
        });

        return historyItems;
    } catch (error) {
        console.error('[BrowsingRelated] 获取历史数据失败:', error);
        return [];
    }
}

// 加载书签关联记录（显示所有浏览记录，标识出书签）
// 复用「点击记录」的书签集合进行标识，实现数据一致性
async function loadBrowsingRelatedHistory(range = 'day') {
    const listContainer = document.getElementById('browsingRelatedList');
    if (!listContainer) return;

    const isZh = currentLang === 'zh_CN';
    const loadingTitle = isZh ? '正在读取历史记录...' : 'Loading history...';

    listContainer.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="fas fa-spinner fa-spin"></i></div>
            <div class="empty-state-title">${loadingTitle}</div>
        </div>
    `;

    try {
        const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
        if (!browserAPI || !browserAPI.history || !browserAPI.history.search) {
            throw new Error('History API not available');
        }

        // 确保「点击记录」日历已初始化
        if (typeof initBrowsingHistoryCalendar === 'function' && !window.browsingHistoryCalendarInstance) {
            console.log('[BrowsingRelated] 初始化日历...');
            initBrowsingHistoryCalendar();
        }

        // 等待日历数据加载（最多10秒）
        const waitForCalendarData = async () => {
            const start = Date.now();
            const timeout = 10000;
            while (Date.now() - start < timeout) {
                const inst = window.browsingHistoryCalendarInstance;
                if (inst && inst.bookmarksByDate && inst.bookmarksByDate.size > 0) {
                    console.log('[BrowsingRelated] 日历数据已加载，记录数:', inst.bookmarksByDate.size);
                    return inst;
                }
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            console.warn('[BrowsingRelated] 等待日历数据超时');
            return window.browsingHistoryCalendarInstance || null;
        };

        const calendar = await waitForCalendarData();

        // 获取时间范围
        const startTime = getTimeRangeStart(range);
        const endTime = Date.now();

        // 搜索所有历史记录（不限制数量）
        const historyItems = await new Promise((resolve, reject) => {
            browserAPI.history.search({
                text: '',
                startTime: startTime,
                endTime: endTime,
                maxResults: 0  // 0表示不限制数量
            }, (results) => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    reject(browserAPI.runtime.lastError);
                } else {
                    resolve(results || []);
                }
            });
        });

        if (historyItems.length === 0) {
            const emptyTitle = isZh ? '该时间范围内没有历史记录' : 'No history in this time range';
            listContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-history"></i></div>
                    <div class="empty-state-title">${emptyTitle}</div>
                </div>
            `;
            return;
        }

        // ✨ 使用 getVisits 获取每个URL的详细访问记录，展开为每次访问一条
        const expandedItems = [];
        const getVisitsAsync = (url) => new Promise((resolve) => {
            if (!browserAPI.history.getVisits) {
                resolve([]);
                return;
            }
            browserAPI.history.getVisits({ url }, (visits) => {
                if (browserAPI.runtime && browserAPI.runtime.lastError) {
                    resolve([]);
                } else {
                    resolve(visits || []);
                }
            });
        });

        // 并发获取所有URL的访问详情
        const visitPromises = historyItems.map(async (item) => {
            const visits = await getVisitsAsync(item.url);
            // 过滤在时间范围内的访问
            const filteredVisits = visits.filter(v => 
                v.visitTime >= startTime && v.visitTime <= endTime
            );
            
            if (filteredVisits.length > 0) {
                // 每次访问创建一条记录
                return filteredVisits.map(visit => ({
                    ...item,
                    lastVisitTime: visit.visitTime,
                    transition: visit.transition || '',
                    _visitId: visit.visitId
                }));
            } else {
                // 如果没有详细访问记录，使用汇总记录
                return [item];
            }
        });

        const allVisitArrays = await Promise.all(visitPromises);
        allVisitArrays.forEach(arr => expandedItems.push(...arr));

        if (expandedItems.length === 0) {
            const emptyTitle = isZh ? '该时间范围内没有历史记录' : 'No history in this time range';
            listContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-history"></i></div>
                    <div class="empty-state-title">${emptyTitle}</div>
                </div>
            `;
            return;
        }

        // 用展开后的记录替换原来的
        const historyItemsExpanded = expandedItems;

        // ✨ 获取书签URL和标题集合（用于标识哪些是书签）
        // 优先从「点击记录」日历获取，保持数据一致性
        let bookmarkUrls, bookmarkTitles;
        
        // 优先使用 DatabaseManager 获取书签信息（最准确）
        if (calendar && calendar.dbManager) {
            console.log('[BrowsingRelated] 从DatabaseManager获取书签集合');
            const bookmarkDB = calendar.dbManager.getBookmarksDB();
            if (bookmarkDB) {
                bookmarkUrls = bookmarkDB.getAllUrls();
                bookmarkTitles = bookmarkDB.getAllTitles();
                console.log('[BrowsingRelated] DatabaseManager书签集合 - URL:', bookmarkUrls.size, 'Title:', bookmarkTitles.size);
            } else {
                // 回退到日历数据
                bookmarkUrls = new Set();
                bookmarkTitles = new Set();
            }
        } else if (calendar && calendar.bookmarksByDate && calendar.bookmarksByDate.size > 0) {
            console.log('[BrowsingRelated] 从日历提取书签集合');
            // 从日历实例中提取书签URL和标题集合
            bookmarkUrls = new Set();
            bookmarkTitles = new Set();
            for (const records of calendar.bookmarksByDate.values()) {
                if (!Array.isArray(records)) continue;
                records.forEach(record => {
                    if (record.url) bookmarkUrls.add(record.url);
                    if (record.title && record.title.trim()) bookmarkTitles.add(record.title.trim());
                });
            }
            console.log('[BrowsingRelated] 日历书签集合 - URL:', bookmarkUrls.size, 'Title:', bookmarkTitles.size);
        } else {
            console.log('[BrowsingRelated] 使用降级方案获取书签');
            // 降级方案：直接获取书签库
            const result = await getBookmarkUrlsAndTitles();
            bookmarkUrls = result.urls;
            bookmarkTitles = result.titles;
            console.log('[BrowsingRelated] 降级方案书签集合 - URL:', bookmarkUrls.size, 'Title:', bookmarkTitles.size);
        }

        // 按当前排序方式排序（使用展开后的记录）
        if (browsingRelatedSortAsc) {
            // 正序：旧到新
            historyItemsExpanded.sort((a, b) => (a.lastVisitTime || 0) - (b.lastVisitTime || 0));
        } else {
            // 倒序：新到旧
            historyItemsExpanded.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
        }

        // 渲染历史记录（根据数量和时间范围自动决定是否懒加载）
        renderBrowsingRelatedList(listContainer, historyItemsExpanded, bookmarkUrls, bookmarkTitles, range);

    } catch (error) {
        console.error('[BrowsingRelated] 加载失败:', error);
        const errorTitle = isZh ? '加载历史记录失败' : 'Failed to load history';
        const errorDesc = isZh ? '请检查浏览器权限设置' : 'Please check browser permissions';
        listContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-exclamation-circle"></i></div>
                <div class="empty-state-title">${errorTitle}</div>
                <div class="empty-state-description">${errorDesc}</div>
            </div>
        `;
    }
}

// 渲染书签关联记录列表（大列表场景支持懒加载）
async function renderBrowsingRelatedList(container, historyItems, bookmarkUrls, bookmarkTitles, range) {
    if (!container) return;

    container.innerHTML = '';

    const isZh = currentLang === 'zh_CN';
    const bookmarkLabel = i18n.browsingRelatedBadgeText[currentLang];

    // ✨ 应用时间筛选
    let filteredItems = historyItems;
    if (browsingRelatedTimeFilter) {
        filteredItems = filterHistoryByTime(historyItems, browsingRelatedTimeFilter, range);
        if (filteredItems.length === 0) {
            const emptyTitle = isZh ? '没有匹配的记录' : 'No matching records';
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-filter"></i></div>
                    <div class="empty-state-title">${emptyTitle}</div>
                </div>
            `;
            return;
        }
    }

    // ✨ 辅助函数：判断记录是否为书签
    const checkIsBookmark = (item) => {
        if (bookmarkUrls.has(item.url)) return true;
        if (item.title && item.title.trim() && bookmarkTitles.has(item.title.trim())) return true;
        return false;
    };

    // ✨ 辅助函数：从URL提取用于比较的键（去掉查询参数和hash）
    const getUrlKey = (url) => {
        try {
            const u = new URL(url);
            return u.origin + u.pathname; // 只保留协议+域名+路径
        } catch {
            return url;
        }
    };

    // ✨ 辅助函数：检测字符串是否是URL
    const isUrl = (str) => {
        if (!str) return false;
        return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('chrome-extension://') || str.startsWith('file://');
    };

    // ✨ 辅助函数：规范化标题用于比较
    const normalizeTitle = (title) => {
        if (!title) return '';
        const trimmed = title.trim();
        // 如果标题本身是URL，则去掉查询参数进行比较
        if (isUrl(trimmed)) {
            return getUrlKey(trimmed);
        }
        return trimmed
            .replace(/\s+/g, ' ')  // 多个空白字符合并为一个空格
            .replace(/[\u200B-\u200D\uFEFF]/g, ''); // 去除零宽字符
    };

    // ✨ 合并连续相同标题的非书签记录
    // 规则：连续相同名字的浏览记录合并，书签作为分界线不合并
    const mergeConsecutiveItems = (items) => {
        const groups = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const isBookmark = checkIsBookmark(item);
            // 优先使用标题，如果标题为空则使用URL的路径部分（去掉查询参数）
            const itemTitle = (item.title && item.title.trim()) ? normalizeTitle(item.title) : getUrlKey(item.url);
            
            if (isBookmark) {
                // 书签单独成组，不合并
                groups.push({
                    startIndex: i + 1,
                    endIndex: i + 1,
                    items: [item],
                    isBookmark: true,
                    representativeItem: item,
                    title: itemTitle
                });
            } else {
                // 非书签：检查是否可以和前一组合并
                const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
                if (lastGroup && !lastGroup.isBookmark && lastGroup.title === itemTitle) {
                    // 合并到前一组
                    lastGroup.endIndex = i + 1;
                    lastGroup.items.push(item);
                } else {
                    // 创建新组 - 调试：为什么没合并
                    if (lastGroup && !lastGroup.isBookmark) {
                        console.log('[合并调试] 未合并原因 - 标题不同:', {
                            index: i + 1,
                            当前标题: itemTitle,
                            前一组标题: lastGroup.title,
                            相同: lastGroup.title === itemTitle,
                            当前标题长度: itemTitle.length,
                            前一组标题长度: lastGroup.title.length,
                            当前标题编码: [...itemTitle].map(c => c.charCodeAt(0)),
                            前一组标题编码: [...lastGroup.title].map(c => c.charCodeAt(0))
                        });
                    }
                    groups.push({
                        startIndex: i + 1,
                        endIndex: i + 1,
                        items: [item],
                        isBookmark: false,
                        representativeItem: item,
                        title: itemTitle
                    });
                }
            }
        }
        return groups;
    };

    // 合并后的分组
    const mergedGroups = mergeConsecutiveItems(filteredItems);

    // 懒加载规则：
    // - 当分组数 > 500 时启用懒加载（所有范围都适用）
    // - 其他情况一次性渲染全部
    const enableLazy = mergedGroups.length > 500;

    // 渲染单个分组的函数
    const renderGroup = (group) => {
        const item = group.representativeItem;
        const isBookmark = group.isBookmark;
        
        const itemEl = document.createElement('div');
        itemEl.className = 'related-history-item' + (isBookmark ? ' is-bookmark' : '');
        
        // 添加 dataset 属性用于跳转匹配
        const visitTimestamp = item.lastVisitTime || null;
        itemEl.dataset.url = item.url;
        itemEl.dataset.visitTime = visitTimestamp || Date.now();
        if (visitTimestamp) {
            itemEl.dataset.visitMinute = Math.floor(visitTimestamp / 60000);
        }
        if (item.title && item.title.trim()) {
            itemEl.dataset.title = item.title.trim();
        }

        // 获取favicon
        const faviconUrl = getFaviconUrl(item.url);

        // 格式化时间
        const visitTime = item.lastVisitTime ? new Date(item.lastVisitTime) : new Date();
        const timeStr = formatTimeByRange(visitTime, range);

        const displayTitle = (item.title && item.title.trim()) ? item.title : item.url;
        
        // ✨ 序号显示：如果合并了多条，显示为 "起始~结束" 格式
        const numberStr = group.startIndex === group.endIndex 
            ? `${group.startIndex}` 
            : `${group.startIndex}~${group.endIndex}`;
        
        itemEl.innerHTML = `
            <div class="related-history-number">${numberStr}</div>
            <div class="related-history-header">
                <img src="${faviconUrl}" class="related-history-favicon" alt="">
                <div class="related-history-info">
                    <div class="related-history-title">${escapeHtml(displayTitle)}</div>
                </div>
            </div>
            <div class="related-history-meta">
                <div class="related-history-time">
                    <i class="fas fa-clock"></i>
                    ${timeStr}
                </div>
                ${isBookmark ? `<div class="related-history-badge">${bookmarkLabel}</div>` : ''}
            </div>
        `;

        // 点击打开链接
        itemEl.addEventListener('click', () => {
            const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
            if (browserAPI && browserAPI.tabs && browserAPI.tabs.create) {
                browserAPI.tabs.create({ url: item.url });
            } else {
                window.open(item.url, '_blank');
            }
        });

        return itemEl;
    };

    if (!enableLazy) {
        for (const group of mergedGroups) {
            container.appendChild(renderGroup(group));
        }
        return;
    }

    // 启用懒加载：每次追加 1000 个分组
    const PAGE_SIZE = 1000;
    let offset = 0;

    const appendNextPage = () => {
        const end = Math.min(offset + PAGE_SIZE, mergedGroups.length);

        for (let i = offset; i < end; i++) {
            container.appendChild(renderGroup(mergedGroups[i]));
        }

        offset = end;
    };

    appendNextPage();

    // 找到真正的滚动容器（.content-area）
    const scrollContainer = container.closest('.content-area') || container;
    
    const onScroll = () => {
        if (offset >= mergedGroups.length) return;
        const threshold = 300;
        if (scrollContainer.scrollTop + scrollContainer.clientHeight + threshold >= scrollContainer.scrollHeight) {
            appendNextPage();
        }
    };

    // 清理旧的监听器
    if (scrollContainer.__browsingRelatedScrollHandler) {
        scrollContainer.removeEventListener('scroll', scrollContainer.__browsingRelatedScrollHandler);
    }
    scrollContainer.addEventListener('scroll', onScroll);
    scrollContainer.__browsingRelatedScrollHandler = onScroll;
    
    // 暴露懒加载状态和函数，供跳转功能使用
    container.__lazyLoadState = {
        totalItems: filteredItems.length,
        getLoadedCount: () => offset,
        loadMore: appendNextPage,
        loadAll: () => {
            while (offset < mergedGroups.length) {
                appendNextPage();
            }
        }
    };
}

// 根据时间范围格式化时间
function formatTimeByRange(date, range) {
    const isZh = currentLang === 'zh_CN';
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const timeOnly = `${hour}:${minute}`;

    switch (range) {
        case 'day':
            // 当天：只显示时间
            return timeOnly;
        
        case 'week':
            // 当周：显示周几+时间
            const weekdays = isZh 
                ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
                : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const weekday = weekdays[date.getDay()];
            return `${weekday} ${timeOnly}`;
        
        case 'month':
        case 'year':
            // 当月/当年：显示月-日 时间
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${month}-${day} ${timeOnly}`;
        
        default:
            return timeOnly;
    }
}

// 格式化时间为日期时间格式（保留用于其他地方）
function formatRelativeTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

// ========== 点击排行 - 时间段菜单功能 ==========

// 全局变量：点击排行当前选中的时间筛选
let browsingRankingTimeFilter = null; // { type: 'hour'|'day'|'week'|'month', value: number|Date }
let browsingRankingCurrentRange = 'month'; // 当前选中的时间范围
let browsingRankingViewMode = 'bookmark'; // 'bookmark' 或 'folder'

// 初始化视图模式（从localStorage读取）
function initBrowsingRankingViewMode() {
    try {
        const saved = localStorage.getItem('browsingRankingViewMode');
        if (saved === 'folder' || saved === 'bookmark') {
            browsingRankingViewMode = saved;
        }
    } catch (e) {
        console.warn('[BrowsingRanking] 无法读取视图模式:', e);
    }
}

// 保存视图模式
function saveBrowsingRankingViewMode(mode) {
    browsingRankingViewMode = mode;
    try {
        localStorage.setItem('browsingRankingViewMode', mode);
    } catch (e) {
        console.warn('[BrowsingRanking] 无法保存视图模式:', e);
    }
}

// 显示点击排行的时间段菜单
async function showBrowsingRankingTimeMenu(range) {
    browsingRankingCurrentRange = range;
    const menuContainer = document.getElementById('browsingRankingTimeMenu');
    if (!menuContainer) return;

    menuContainer.innerHTML = '';
    menuContainer.style.display = 'none';
    browsingRankingTimeFilter = null; // 重置筛选

    // 初始化视图模式
    initBrowsingRankingViewMode();

    // 获取点击排行的数据
    const stats = await ensureBrowsingClickRankingStats();
    if (!stats || !stats.items || stats.items.length === 0) {
        return;
    }

    const now = new Date();
    const isZh = currentLang === 'zh_CN';

    // 创建菜单行容器（包含时间按钮和切换按钮）
    const menuRow = document.createElement('div');
    menuRow.style.display = 'flex';
    menuRow.style.alignItems = 'center';
    menuRow.style.justifyContent = 'space-between';
    menuRow.style.gap = '12px';

    // 创建时间菜单项容器
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'time-menu-items';
    itemsContainer.style.flex = '1';

    // 添加"全部"按钮（默认选中）
    const allBtn = document.createElement('button');
    allBtn.className = 'time-menu-btn active';
    allBtn.textContent = isZh ? '全部' : 'All';
    allBtn.dataset.filter = 'all';
    allBtn.addEventListener('click', () => {
        itemsContainer.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
        allBtn.classList.add('active');
        browsingRankingTimeFilter = null;
        loadBrowsingClickRanking(browsingRankingCurrentRange);
    });
    itemsContainer.appendChild(allBtn);

    // 根据范围显示不同的时间段按钮
    switch (range) {
        case 'day':
            renderRankingDayHoursMenu(itemsContainer, now, stats);
            break;
        case 'week':
            renderRankingWeekDaysMenu(itemsContainer, now, stats);
            break;
        case 'month':
            renderRankingMonthWeeksMenu(itemsContainer, now, stats);
            break;
        case 'year':
            renderRankingYearMonthsMenu(itemsContainer, now, stats);
            break;
        case 'all':
            // 全部：显示有数据的年份
            renderRankingAllYearsMenu(itemsContainer, stats);
            break;
    }

    menuRow.appendChild(itemsContainer);

    // 创建"文件夹/书签"滑块开关
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'ranking-view-toggle';
    toggleContainer.style.cssText = `
        position: relative;
        display: inline-flex;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        padding: 3px;
        flex-shrink: 0;
    `;

    // 滑块
    const slider = document.createElement('div');
    slider.className = 'toggle-slider';
    slider.style.cssText = `
        position: absolute;
        top: 3px;
        height: calc(100% - 6px);
        width: calc(50% - 3px);
        background: linear-gradient(135deg, var(--accent-primary) 0%, #0056b3 100%);
        border-radius: 16px;
        transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        z-index: 0;
    `;
    slider.style.left = browsingRankingViewMode === 'folder' ? '3px' : 'calc(50%)';
    toggleContainer.appendChild(slider);

    // 按钮通用样式
    const btnStyle = `
        position: relative;
        z-index: 1;
        padding: 5px 12px;
        font-size: 11px;
        font-weight: 500;
        border: none;
        background: transparent;
        cursor: pointer;
        transition: color 0.2s;
        white-space: nowrap;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        border-radius: 16px;
    `;

    // 文件夹按钮（左边）
    const folderBtn = document.createElement('button');
    folderBtn.style.cssText = btnStyle;
    folderBtn.style.color = browsingRankingViewMode === 'folder' ? '#fff' : 'var(--text-tertiary)';
    folderBtn.innerHTML = `<i class="fas fa-folder" style="font-size:11px;"></i><span>${isZh ? '文件夹' : 'Folder'}</span>`;

    // 书签按钮（右边）
    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.style.cssText = btnStyle;
    bookmarkBtn.style.color = browsingRankingViewMode === 'bookmark' ? '#fff' : 'var(--text-tertiary)';
    bookmarkBtn.innerHTML = `<i class="fas fa-bookmark" style="font-size:10px;"></i><span>${isZh ? '书签' : 'Bookmark'}</span>`;

    const updateToggle = (mode) => {
        slider.style.left = mode === 'folder' ? '3px' : 'calc(50%)';
        folderBtn.style.color = mode === 'folder' ? '#fff' : 'var(--text-tertiary)';
        bookmarkBtn.style.color = mode === 'bookmark' ? '#fff' : 'var(--text-tertiary)';
    };

    folderBtn.addEventListener('click', () => {
        if (browsingRankingViewMode !== 'folder') {
            saveBrowsingRankingViewMode('folder');
            updateToggle('folder');
            loadBrowsingClickRanking(browsingRankingCurrentRange);
        }
    });

    bookmarkBtn.addEventListener('click', () => {
        if (browsingRankingViewMode !== 'bookmark') {
            saveBrowsingRankingViewMode('bookmark');
            updateToggle('bookmark');
            loadBrowsingClickRanking(browsingRankingCurrentRange);
        }
    });

    // hover效果
    [folderBtn, bookmarkBtn].forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            if ((btn === folderBtn && browsingRankingViewMode !== 'folder') ||
                (btn === bookmarkBtn && browsingRankingViewMode !== 'bookmark')) {
                btn.style.color = 'var(--text-primary)';
            }
        });
        btn.addEventListener('mouseleave', () => {
            if ((btn === folderBtn && browsingRankingViewMode !== 'folder') ||
                (btn === bookmarkBtn && browsingRankingViewMode !== 'bookmark')) {
                btn.style.color = 'var(--text-tertiary)';
            }
        });
    });

    toggleContainer.appendChild(folderBtn);
    toggleContainer.appendChild(bookmarkBtn);
    menuRow.appendChild(toggleContainer);

    // 对于 'all' 范围，即使只有"全部"按钮，也要显示菜单（因为需要切换按钮）
    if (itemsContainer.children.length > 1 || range === 'all') {
        menuContainer.appendChild(menuRow);
        menuContainer.style.display = 'block';
    }
}

// 渲染点击排行当天的小时菜单
function renderRankingDayHoursMenu(container, date, stats) {
    const isZh = currentLang === 'zh_CN';
    const boundaries = stats.boundaries;
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate) return;

    // 分析有数据的小时
    const hoursSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.dayStart && t <= boundaries.now) {
                hoursSet.add(new Date(t).getHours());
            }
        });
    }

    Array.from(hoursSet).sort((a, b) => a - b).forEach(hour => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = `${String(hour).padStart(2, '0')}:00`;
        btn.dataset.hour = hour;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRankingTimeFilter = { type: 'hour', value: hour };
            loadBrowsingClickRanking(browsingRankingCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 渲染点击排行当周的天菜单
function renderRankingWeekDaysMenu(container, date, stats) {
    const isZh = currentLang === 'zh_CN';
    const boundaries = stats.boundaries;
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate) return;

    const weekdayNames = isZh 
        ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // 分析有数据的天
    const daysSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.weekStart && t <= boundaries.now) {
                daysSet.add(new Date(t).toDateString());
            }
        });
    }

    // 生成本周的日期
    const weekStart = new Date(boundaries.weekStart);
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + i);
        
        if (!daysSet.has(dayDate.toDateString())) continue;
        if (dayDate.getTime() > boundaries.now) continue;
        
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = weekdayNames[dayDate.getDay()];
        btn.dataset.date = dayDate.toISOString();
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRankingTimeFilter = { type: 'day', value: dayDate };
            loadBrowsingClickRanking(browsingRankingCurrentRange);
        });
        container.appendChild(btn);
    }
}

// 渲染点击排行当月的周菜单
function renderRankingMonthWeeksMenu(container, date, stats) {
    const isZh = currentLang === 'zh_CN';
    const boundaries = stats.boundaries;
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate) return;

    // 分析有数据的周
    const weeksSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.monthStart && t <= boundaries.now) {
                weeksSet.add(getWeekNumberForRelated(new Date(t)));
            }
        });
    }

    Array.from(weeksSet).sort((a, b) => a - b).forEach(weekNum => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = isZh ? `第${weekNum}周` : `W${weekNum}`;
        btn.dataset.week = weekNum;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRankingTimeFilter = { type: 'week', value: weekNum };
            loadBrowsingClickRanking(browsingRankingCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 渲染点击排行当年的月份菜单
function renderRankingYearMonthsMenu(container, date, stats) {
    const isZh = currentLang === 'zh_CN';
    const boundaries = stats.boundaries;
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate) return;

    const monthNames = isZh
        ? ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
        : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // 分析有数据的月份
    const monthsSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.yearStart && t <= boundaries.now) {
                monthsSet.add(new Date(t).getMonth());
            }
        });
    }

    Array.from(monthsSet).sort((a, b) => a - b).forEach(month => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = monthNames[month];
        btn.dataset.month = month;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRankingTimeFilter = { type: 'month', value: month };
            loadBrowsingClickRanking(browsingRankingCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 渲染点击排行全部时间的年份菜单
function renderRankingAllYearsMenu(container, stats) {
    const isZh = currentLang === 'zh_CN';
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate) return;

    // 分析有数据的年份
    const yearsSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t > 0) {
                yearsSet.add(new Date(t).getFullYear());
            }
        });
    }

    // 按年份倒序排列（最近的年份在前）
    Array.from(yearsSet).sort((a, b) => b - a).forEach(year => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = isZh ? `${year}年` : `${year}`;
        btn.dataset.year = year;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRankingTimeFilter = { type: 'year', value: year };
            loadBrowsingClickRanking(browsingRankingCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 按时间筛选点击排行项目（重新计算每个时间段的点击次数）
function filterRankingItemsByTime(items, filter, boundaries) {
    if (!filter || !items || items.length === 0) return items;
    
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate) return items;
    
    // 使用与原始统计相同的映射
    const stats = browsingClickRankingStats;
    if (!stats || !stats.bookmarkKeyMap || !stats.bookmarkInfoMap) return items;
    
    const bookmarkKeyMap = stats.bookmarkKeyMap;
    const bookmarkInfoMap = stats.bookmarkInfoMap;
    
    // 创建 bookmarkKey -> 访问次数的映射
    const keyVisitCounts = new Map();
    
    // 遍历所有访问记录，使用与原始统计完全相同的匹配逻辑
    for (const bookmarks of calendar.bookmarksByDate.values()) {
        for (const bm of bookmarks) {
            if (!bm || !bm.url) continue;
            
            const url = bm.url;
            const title = typeof bm.title === 'string' && bm.title.trim()
                ? bm.title.trim()
                : (bm.url || '');
            const t = typeof bm.visitTime === 'number'
                ? bm.visitTime
                : (bm.dateAdded instanceof Date ? bm.dateAdded.getTime() : 0);
            if (!t) continue;
            
            const visitDate = new Date(t);
            let matches = false;
            
            switch (filter.type) {
                case 'hour':
                    if (t >= boundaries.dayStart && t <= boundaries.now && 
                        visitDate.getHours() === filter.value) {
                        matches = true;
                    }
                    break;
                case 'day':
                    if (t >= boundaries.weekStart && t <= boundaries.now &&
                        visitDate.toDateString() === filter.value.toDateString()) {
                        matches = true;
                    }
                    break;
                case 'week':
                    if (t >= boundaries.monthStart && t <= boundaries.now &&
                        getWeekNumberForRelated(visitDate) === filter.value) {
                        matches = true;
                    }
                    break;
                case 'month':
                    if (t >= boundaries.yearStart && t <= boundaries.now &&
                        visitDate.getMonth() === filter.value) {
                        matches = true;
                    }
                    break;
                case 'year':
                    // 筛选特定年份（用于「全部」范围的年份二级菜单）
                    if (visitDate.getFullYear() === filter.value) {
                        matches = true;
                    }
                    break;
            }
            
            if (matches) {
                // 与原始统计完全相同的匹配逻辑
                let bookmarkKey = bookmarkKeyMap.get(`url:${url}`);
                if (!bookmarkKey && title) {
                    bookmarkKey = bookmarkKeyMap.get(`title:${title}`);
                }
                
                if (bookmarkKey) {
                    keyVisitCounts.set(bookmarkKey, (keyVisitCounts.get(bookmarkKey) || 0) + 1);
                }
            }
        }
    }
    
    // 将 bookmarkKey 的计数映射回 item.url
    const urlVisitCounts = new Map();
    for (const [key, count] of keyVisitCounts.entries()) {
        const info = bookmarkInfoMap.get(key);
        if (info && info.url) {
            urlVisitCounts.set(info.url, count);
        }
    }
    
    // 过滤并更新items的点击次数
    const result = items
        .filter(item => urlVisitCounts.has(item.url) && urlVisitCounts.get(item.url) > 0)
        .map(item => ({
            ...item,
            filteredCount: urlVisitCounts.get(item.url)
        }))
        .sort((a, b) => {
            if (b.filteredCount !== a.filteredCount) return b.filteredCount - a.filteredCount;
            return (b.lastVisitTime || 0) - (a.lastVisitTime || 0);
        });
    
    return result;
}

// ========== 书签关联页面 - 时间段菜单功能 ==========

// 全局变量：当前选中的时间筛选
let browsingRelatedTimeFilter = null; // { type: 'hour'|'day'|'week'|'month', value: number|Date }

// 显示时间段菜单（按需显示，只显示有数据的时间段）
// 使用与点击排行相同的数据源（calendar.bookmarksByDate），保持一致
async function showBrowsingRelatedTimeMenu(range) {
    const menuContainer = document.getElementById('browsingRelatedTimeMenu');
    if (!menuContainer) return;

    menuContainer.innerHTML = '';
    menuContainer.style.display = 'none';
    browsingRelatedTimeFilter = null; // 重置筛选

    // 使用与点击排行相同的数据源
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate || calendar.bookmarksByDate.size === 0) {
        return; // 没有数据，不显示菜单
    }
    
    // 获取时间边界（与点击排行保持一致）
    const stats = await ensureBrowsingClickRankingStats();
    if (!stats || !stats.boundaries) return;
    
    const boundaries = stats.boundaries;
    const now = new Date();
    const isZh = currentLang === 'zh_CN';

    // 创建菜单项容器
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'time-menu-items';

    // 添加"全部"按钮（默认选中）
    const allBtn = document.createElement('button');
    allBtn.className = 'time-menu-btn active';
    allBtn.textContent = isZh ? '全部' : 'All';
    allBtn.dataset.filter = 'all';
    allBtn.addEventListener('click', () => {
        itemsContainer.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
        allBtn.classList.add('active');
        browsingRelatedTimeFilter = null;
        loadBrowsingRelatedHistory(browsingRelatedCurrentRange);
    });
    itemsContainer.appendChild(allBtn);

    // 使用与点击排行相同的数据源和边界
    switch (range) {
        case 'day':
            // 当天：只显示有数据的小时段
            renderRelatedDayHoursMenu(itemsContainer, boundaries, calendar);
            break;
        case 'week':
            // 当周：只显示有数据的天
            renderRelatedWeekDaysMenu(itemsContainer, boundaries, calendar);
            break;
        case 'month':
            // 当月：只显示有数据的周
            renderRelatedMonthWeeksMenu(itemsContainer, boundaries, calendar);
            break;
        case 'year':
            // 当年：只显示有数据的月份
            renderRelatedYearMonthsMenu(itemsContainer, boundaries, calendar);
            break;
        case 'all':
            // 全部：显示有数据的年份
            renderRelatedAllYearsMenu(itemsContainer, calendar);
            break;
    }

    if (itemsContainer.children.length > 1) { // 至少有"全部"和一个其他选项
        menuContainer.appendChild(itemsContainer);
        menuContainer.style.display = 'block';
    }
}

// 辅助函数：复用日历的 ISO 8601 周数计算
function getWeekNumberForRelated(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + (4 - (d.getDay() || 7)));
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

// 书签关联记录 - 渲染当天的小时菜单（使用与点击排行相同的数据源）
function renderRelatedDayHoursMenu(container, boundaries, calendar) {
    const isZh = currentLang === 'zh_CN';
    if (!calendar || !calendar.bookmarksByDate) return;

    // 分析有数据的小时（与点击排行完全相同的逻辑）
    const hoursSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.dayStart && t <= boundaries.now) {
                hoursSet.add(new Date(t).getHours());
            }
        });
    }

    Array.from(hoursSet).sort((a, b) => a - b).forEach(hour => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = `${String(hour).padStart(2, '0')}:00`;
        btn.dataset.hour = hour;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRelatedTimeFilter = { type: 'hour', value: hour };
            loadBrowsingRelatedHistory(browsingRelatedCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 书签关联记录 - 渲染当周的天菜单（使用与点击排行相同的数据源）
function renderRelatedWeekDaysMenu(container, boundaries, calendar) {
    const isZh = currentLang === 'zh_CN';
    if (!calendar || !calendar.bookmarksByDate) return;

    const weekdayNames = isZh 
        ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // 分析有数据的天
    const daysSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.weekStart && t <= boundaries.now) {
                daysSet.add(new Date(t).toDateString());
            }
        });
    }

    // 生成本周的日期
    const weekStart = new Date(boundaries.weekStart);
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekStart);
        dayDate.setDate(weekStart.getDate() + i);
        
        if (!daysSet.has(dayDate.toDateString())) continue;
        if (dayDate.getTime() > boundaries.now) continue;
        
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = weekdayNames[dayDate.getDay()];
        btn.dataset.date = dayDate.toISOString();
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRelatedTimeFilter = { type: 'day', value: dayDate };
            loadBrowsingRelatedHistory(browsingRelatedCurrentRange);
        });
        container.appendChild(btn);
    }
}

// 书签关联记录 - 渲染当月的周菜单（使用与点击排行相同的数据源）
function renderRelatedMonthWeeksMenu(container, boundaries, calendar) {
    const isZh = currentLang === 'zh_CN';
    if (!calendar || !calendar.bookmarksByDate) return;

    // 分析有数据的周
    const weeksSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.monthStart && t <= boundaries.now) {
                weeksSet.add(getWeekNumberForRelated(new Date(t)));
            }
        });
    }

    Array.from(weeksSet).sort((a, b) => a - b).forEach(weekNum => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = isZh ? `第${weekNum}周` : `W${weekNum}`;
        btn.dataset.week = weekNum;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRelatedTimeFilter = { type: 'week', value: weekNum };
            loadBrowsingRelatedHistory(browsingRelatedCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 书签关联记录 - 渲染当年的月份菜单（使用与点击排行相同的数据源）
function renderRelatedYearMonthsMenu(container, boundaries, calendar) {
    const isZh = currentLang === 'zh_CN';
    if (!calendar || !calendar.bookmarksByDate) return;

    const monthNames = isZh
        ? ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
        : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // 分析有数据的月份
    const monthsSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t >= boundaries.yearStart && t <= boundaries.now) {
                monthsSet.add(new Date(t).getMonth());
            }
        });
    }

    Array.from(monthsSet).sort((a, b) => a - b).forEach(month => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = monthNames[month];
        btn.dataset.month = month;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRelatedTimeFilter = { type: 'month', value: month };
            loadBrowsingRelatedHistory(browsingRelatedCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 书签关联记录 - 渲染全部时间的年份菜单
function renderRelatedAllYearsMenu(container, calendar) {
    const isZh = currentLang === 'zh_CN';
    if (!calendar || !calendar.bookmarksByDate) return;

    // 分析有数据的年份
    const yearsSet = new Set();
    for (const records of calendar.bookmarksByDate.values()) {
        records.forEach(record => {
            const t = record.visitTime || (record.dateAdded instanceof Date ? record.dateAdded.getTime() : 0);
            if (t > 0) {
                yearsSet.add(new Date(t).getFullYear());
            }
        });
    }

    // 按年份倒序排列（最近的年份在前）
    Array.from(yearsSet).sort((a, b) => b - a).forEach(year => {
        const btn = document.createElement('button');
        btn.className = 'time-menu-btn';
        btn.textContent = isZh ? `${year}年` : `${year}`;
        btn.dataset.year = year;
        btn.addEventListener('click', () => {
            container.querySelectorAll('.time-menu-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browsingRelatedTimeFilter = { type: 'year', value: year };
            loadBrowsingRelatedHistory(browsingRelatedCurrentRange);
        });
        container.appendChild(btn);
    });
}

// 按时间筛选历史记录
function filterHistoryByTime(items, filter, range) {
    if (!filter || !items || items.length === 0) return items;

    return items.filter(item => {
        if (!item.lastVisitTime) return false;
        
        const itemDate = new Date(item.lastVisitTime);
        
        switch (filter.type) {
            case 'hour':
                // 筛选特定小时
                return itemDate.getHours() === filter.value;
            
            case 'day':
                // 筛选特定日期
                const filterDate = new Date(filter.value);
                return itemDate.toDateString() === filterDate.toDateString();
            
            case 'week':
                // 筛选特定周
                const weekNum = getWeekNumberForRelated(itemDate);
                return weekNum === filter.value;
            
            case 'month':
                // 筛选特定月份
                return itemDate.getMonth() === filter.value;
            
            case 'year':
                // 筛选特定年份
                return itemDate.getFullYear() === filter.value;
            
            default:
                return true;
        }
    });
}

// ============================================================================
// 跳转至书签关联记录功能（从点击记录跳转）
// ============================================================================

// 全局变量：存储待高亮的记录信息
let pendingHighlightInfo = null;

// 返回按钮相关
let jumpSourceInfo = null;  // 记录跳转来源信息

function getWeekStartForRelated(date) {
    const d = new Date(date);
    const day = d.getDay() || 7; // 周日返回0，转换为7
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - day + 1);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

function getPreferredRangeFromCalendar(instance) {
    if (!instance || !instance.viewLevel) return null;
    const level = String(instance.viewLevel).toLowerCase();
    switch (level) {
        case 'day':
        case 'week':
        case 'month':
        case 'year':
            return level;
        default:
            return null;
    }
}

function getPrimaryRangeForVisit(visitDate) {
    if (!visitDate) return 'day';
    const now = new Date();
    if (visitDate.toDateString() === now.toDateString()) {
        return 'day';
    }
    const diff = Math.abs(now - visitDate);
    const oneDay = 24 * 60 * 60 * 1000;
    if (diff <= 7 * oneDay) {
        return 'week';
    }
    if (diff <= 31 * oneDay) {
        return 'month';
    }
    if (visitDate.getFullYear() === now.getFullYear()) {
        return 'year';
    }
    return 'all';
}

function buildRangeFilter(range, visitDate) {
    if (!visitDate) return null;
    switch (range) {
        case 'day':
            return { type: 'hour', value: visitDate.getHours() };
        case 'week': {
            const dayDate = new Date(visitDate);
            dayDate.setHours(0, 0, 0, 0);
            return { type: 'day', value: dayDate };
        }
        case 'month':
            return { type: 'week', value: getWeekNumberForRelated(visitDate) };
        case 'year':
            return { type: 'month', value: visitDate.getMonth() };
        case 'all':
            return { type: 'year', value: visitDate.getFullYear() };
        default:
            return null;
    }
}

function buildRelatedRangeStrategies(visitTime, options = {}) {
    const strategies = [];
    const seen = new Set();
    const { preferredRange = null } = options || {};
    const hasVisitTime = typeof visitTime === 'number' && !Number.isNaN(visitTime);
    const visitDate = hasVisitTime ? new Date(visitTime) : null;

    const pushStrategy = (range, filter = null) => {
        if (!range) return;
        const filterKey = filter
            ? `${filter.type}-${filter.value instanceof Date ? filter.value.toISOString() : filter.value}`
            : 'none';
        const key = `${range}|${filterKey}`;
        if (seen.has(key)) return;
        seen.add(key);
        strategies.push({ range, filter });
    };

    if (!visitDate) {
        pushStrategy(preferredRange || 'day', null);
        pushStrategy('all', null);
        return strategies;
    }

    const primaryRange = getPrimaryRangeForVisit(visitDate);
    const orderedRanges = [];
    if (preferredRange) orderedRanges.push(preferredRange);
    orderedRanges.push(primaryRange);
    if (primaryRange !== 'year' && visitDate.getFullYear() === (new Date()).getFullYear()) {
        orderedRanges.push('year');
    }
    orderedRanges.push('all');

    const uniqueRanges = [];
    const rangeSeen = new Set();
    orderedRanges.forEach(range => {
        if (!range) return;
        if (rangeSeen.has(range)) return;
        rangeSeen.add(range);
        uniqueRanges.push(range);
    });

    uniqueRanges.forEach(range => {
        pushStrategy(range, buildRangeFilter(range, visitDate));
    });

    pushStrategy('all', null);
    return strategies;
}

function scheduleApplyRelatedFilter(filter, attempt = 0) {
    const MAX_ATTEMPTS = 10;
    const success = applyRelatedTimeFilter(filter);
    if (!success && attempt < MAX_ATTEMPTS) {
        setTimeout(() => scheduleApplyRelatedFilter(filter, attempt + 1), 120);
    }
}

function activateRelatedRangeStrategy(strategy) {
    if (!strategy) {
        // 确保在没有策略时也清理加载状态和超时
        clearTimeout(window.__relatedJumpTimeout);
        if (pendingHighlightInfo && pendingHighlightInfo.silentMenu) {
            setRelatedPanelSilent(false);
        }
        pendingHighlightInfo = null;
        return;
    }
    pendingHighlightInfo.activeStrategy = strategy;
    if (pendingHighlightInfo) {
        pendingHighlightInfo.pendingUIRange = strategy.range;
        pendingHighlightInfo.pendingUIFilter = strategy.filter || null;
    }

    const silentMode = pendingHighlightInfo && pendingHighlightInfo.silentMenu;
    if (silentMode) {
        setRelatedPanelSilent(true);
    }

    const loadAndHighlightSilently = () => {
        setTimeout(() => {
            highlightRelatedHistoryItem();
        }, 20);
    };

    if (silentMode) {
        browsingRelatedCurrentRange = strategy.range;
        browsingRelatedTimeFilter = strategy.filter || null;
        loadBrowsingRelatedHistory(strategy.range)
            .then(loadAndHighlightSilently)
            .catch(loadAndHighlightSilently);
        return;
    }

    const rangeName = strategy.range.charAt(0).toUpperCase() + strategy.range.slice(1);
    const filterBtn = document.getElementById(`browsingRelatedFilter${rangeName}`);

    const triggerHighlightFlow = () => {
        scheduleApplyRelatedFilter(strategy.filter || null);
        setTimeout(() => {
            highlightRelatedHistoryItem();
        }, 450);
    };

    if (filterBtn) {
        if (!filterBtn.classList.contains('active')) {
            filterBtn.click();
            setTimeout(triggerHighlightFlow, 350);
        } else {
            loadBrowsingRelatedHistory(strategy.range).then(() => {
                triggerHighlightFlow();
            }).catch(() => {
                triggerHighlightFlow();
            });
        }
    } else {
        loadBrowsingRelatedHistory(strategy.range).then(() => {
            triggerHighlightFlow();
        }).catch(() => {
            triggerHighlightFlow();
        });
    }
}

function syncRelatedUIWithStrategy(strategy) {
    if (!strategy) return;
    const range = strategy.range;
    const filter = strategy.filter || null;
    setActiveRelatedRangeButton(range);
    showBrowsingRelatedTimeMenu(range).then(() => {
        markRelatedTimeMenuSelection(filter);
    }).catch(() => {
        markRelatedTimeMenuSelection(filter);
    });
}

function setRelatedPanelSilent(enabled) {
    const panel = document.getElementById('browsingRelatedPanel');
    if (!panel) return;
    if (enabled) {
        const loadingText = currentLang === 'zh_CN' ? '正在定位记录…' : 'Locating record…';
        panel.setAttribute('data-loading-text', loadingText);
        panel.classList.add('related-silent-loading');
    } else {
        panel.classList.remove('related-silent-loading');
        panel.removeAttribute('data-loading-text');
    }
}

function setActiveRelatedRangeButton(range) {
    if (!range) return;
    const panel = document.getElementById('browsingRelatedPanel');
    if (!panel) return;
    const buttons = panel.querySelectorAll('.ranking-time-filter-btn');
    buttons.forEach(btn => {
        const isMatch = btn.dataset.range === range;
        btn.classList.toggle('active', isMatch);
    });
}

function markRelatedTimeMenuSelection(filter) {
    const menuContainer = document.getElementById('browsingRelatedTimeMenu');
    if (!menuContainer) return;
    const buttons = menuContainer.querySelectorAll('.time-menu-btn');
    buttons.forEach(btn => btn.classList.remove('active'));

    if (!filter) {
        const allBtn = menuContainer.querySelector('.time-menu-btn[data-filter="all"]');
        if (allBtn) allBtn.classList.add('active');
        return;
    }

    let targetBtn = null;
    buttons.forEach(btn => {
        if (filter.type === 'hour' && btn.dataset.hour == filter.value) {
            targetBtn = btn;
        } else if (filter.type === 'day' && btn.dataset.date) {
            const btnDate = new Date(btn.dataset.date);
            if (filter.value instanceof Date && btnDate.toDateString() === filter.value.toDateString()) {
                targetBtn = btn;
            }
        } else if (filter.type === 'week' && btn.dataset.week == filter.value) {
            targetBtn = btn;
        } else if (filter.type === 'month' && btn.dataset.month == filter.value) {
            targetBtn = btn;
        } else if (filter.type === 'year' && btn.dataset.year == filter.value) {
            targetBtn = btn;
        }
    });

    if (targetBtn) {
        targetBtn.classList.add('active');
    } else {
        const allBtn = menuContainer.querySelector('.time-menu-btn[data-filter="all"]');
        if (allBtn) allBtn.classList.add('active');
    }
}

// 跳转到书签关联记录并高亮对应条目
async function jumpToRelatedHistory(url, title, visitTime, sourceElement) {
    // 记录来源信息，用于返回
    jumpSourceInfo = {
        type: 'browsingHistory',  // 来自点击记录
        url: url,
        title: title,
        visitTime: visitTime,
        scrollTop: document.querySelector('.content-area')?.scrollTop || 0
    };
    
    // 添加超时保护机制，确保加载状态一定会被清理
    clearTimeout(window.__relatedJumpTimeout);
    window.__relatedJumpTimeout = setTimeout(() => {
        if (pendingHighlightInfo && pendingHighlightInfo.silentMenu) {
            console.warn('[BrowsingRelated] 跳转超时，强制清理加载状态');
            setRelatedPanelSilent(false);
            pendingHighlightInfo = null;
        }
    }, 10000); // 10秒超时保护
    
    // 1. 切换到「书签浏览记录」标签
    const browsingTab = document.getElementById('additionsTabBrowsing');
    if (browsingTab && !browsingTab.classList.contains('active')) {
        browsingTab.click();
    }
    
    // 2. 切换到「书签关联记录」子标签
    const relatedTab = document.getElementById('browsingTabRelated');
    if (relatedTab && !relatedTab.classList.contains('active')) {
        relatedTab.click();
    }
    
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const hasPreciseVisit = typeof visitTime === 'number' && !Number.isNaN(visitTime);
    const preferredRange = getPreferredRangeFromCalendar(window.browsingHistoryCalendarInstance);
    const strategyQueue = buildRelatedRangeStrategies(visitTime, { preferredRange });
    const effectiveStrategies = strategyQueue.length ? strategyQueue : [{ range: 'all', filter: null }];

    // 3. 存储待高亮信息和时间范围策略
    pendingHighlightInfo = {
        url: url,
        title: title,
        normalizedTitle,
        visitTime: visitTime,
        strategyQueue: effectiveStrategies,
        currentStrategyIndex: 0,
        showBackButton: true, // 标记需要显示返回按钮
        hasVisitTime: hasPreciseVisit,
        forceLoadAll: true,
        silentMenu: true,
        pendingUIRange: effectiveStrategies[0]?.range || null,
        pendingUIFilter: effectiveStrategies[0]?.filter || null
    };

    // 4. 启动首个时间范围策略
    activateRelatedRangeStrategy(effectiveStrategies[0]);
}

// 高亮书签关联记录中的目标条目
function highlightRelatedHistoryItem(retryCount = 0) {
    if (!pendingHighlightInfo) return;
    
    const {
        url,
        title,
        normalizedTitle,
        visitTime,
        strategyQueue = [],
        currentStrategyIndex = 0,
        fromAdditions,
        showBackButton: shouldShowBackButton,
        hasVisitTime: storedVisitFlag,
        forceLoadAll
    } = pendingHighlightInfo;
    const listContainer = document.getElementById('browsingRelatedList');
    if (!listContainer) {
        // 确保在容器不存在时也清理加载状态和超时
        clearTimeout(window.__relatedJumpTimeout);
        const silentMode = pendingHighlightInfo && pendingHighlightInfo.silentMenu;
        pendingHighlightInfo = null;
        if (silentMode) {
            setRelatedPanelSilent(false);
        }
        return;
    }
    
    const normalizedTitleValue = normalizedTitle || (title ? title.trim() : '');
    const computedHasVisitTime = typeof visitTime === 'number' && !Number.isNaN(visitTime);
    const hasVisitTime = typeof storedVisitFlag === 'boolean' ? storedVisitFlag : computedHasVisitTime;
    const targetMinute = hasVisitTime ? Math.floor(visitTime / (60 * 1000)) : null;

    const candidateSelector = hasVisitTime && targetMinute !== null
        ? `[data-visit-minute="${targetMinute}"]`
        : '.related-history-item';
    let nodes = listContainer.querySelectorAll(candidateSelector);
    if (!nodes || nodes.length === 0) {
        nodes = listContainer.querySelectorAll('.related-history-item');
    }

    let minuteUrlMatch = null;
    let minuteTitleMatch = null;
    let fallbackMatch = null;
    nodes.forEach(item => {
        if (minuteUrlMatch && minuteTitleMatch) {
            return;
        }

        const itemUrl = item.dataset.url;
        const itemTitle = (item.dataset.title || '').trim();
        const matchesUrl = itemUrl === url;
        const matchesTitle = normalizedTitleValue && itemTitle === normalizedTitleValue;

        if (hasVisitTime) {
            const itemMinuteAttr = item.dataset.visitMinute;
            if (itemMinuteAttr && Number(itemMinuteAttr) === targetMinute) {
                if (matchesUrl && !minuteUrlMatch) {
                    minuteUrlMatch = item;
                    return;
                }
                if (matchesTitle && !minuteTitleMatch) {
                    minuteTitleMatch = item;
                    return;
                }
            }
        } else if (!fallbackMatch && (matchesUrl || matchesTitle)) {
            fallbackMatch = item;
        }
    });

    let targetItem = minuteUrlMatch || minuteTitleMatch || null;
    if (!targetItem && !hasVisitTime) {
        targetItem = fallbackMatch;
    }

    if (targetItem) {
        const shouldSyncUI = pendingHighlightInfo && pendingHighlightInfo.silentMenu;
        const finalStrategy = pendingHighlightInfo ? pendingHighlightInfo.activeStrategy : null;
        listContainer.querySelectorAll('.related-history-item.highlight-target').forEach(el => {
            el.classList.remove('highlight-target');
        });
        targetItem.classList.add('highlight-target');
        targetItem.scrollIntoView({ behavior: 'instant', block: 'center' });
        if (shouldShowBackButton && typeof showBackButton === 'function' && jumpSourceInfo) {
            showBackButton();
        }
        if (shouldSyncUI && finalStrategy) {
            browsingRelatedTimeFilter = finalStrategy.filter || null;
            syncRelatedUIWithStrategy(finalStrategy);
        }
        showRelatedJumpSuccessToast(visitTime, title);
        // 清除超时保护
        clearTimeout(window.__relatedJumpTimeout);
        if (pendingHighlightInfo && pendingHighlightInfo.silentMenu) {
            setRelatedPanelSilent(false);
        }
        pendingHighlightInfo = null;
        return;
    }

    const lazyState = listContainer.__lazyLoadState;
    if (lazyState) {
        if (forceLoadAll && !lazyState.__forceLoaded) {
            lazyState.__forceLoaded = true;
            lazyState.loadAll();
            setTimeout(() => highlightRelatedHistoryItem(retryCount + 1), 120);
            return;
        }
        if (lazyState.getLoadedCount() < lazyState.totalItems) {
            lazyState.loadMore();
            if (retryCount < 20) {
                setTimeout(() => highlightRelatedHistoryItem(retryCount + 1), 120);
            } else {
                lazyState.loadAll();
                setTimeout(() => highlightRelatedHistoryItem(100), 150);
            }
            return;
        }
    }

    if (retryCount < 5) {
        setTimeout(() => highlightRelatedHistoryItem(retryCount + 1), 220);
        return;
    }

    if (strategyQueue.length && currentStrategyIndex < strategyQueue.length - 1) {
        const nextIndex = currentStrategyIndex + 1;
        pendingHighlightInfo.currentStrategyIndex = nextIndex;
        activateRelatedRangeStrategy(strategyQueue[nextIndex]);
        return;
    }

    const silentMode = pendingHighlightInfo && pendingHighlightInfo.silentMenu;
    // 清除超时保护
    clearTimeout(window.__relatedJumpTimeout);
    pendingHighlightInfo = null;
    if (silentMode) {
        setRelatedPanelSilent(false);
    }
    if (fromAdditions || hasVisitTime) {
        showNoRecordToast();
    }
}

// 显示暂无记录提示
function showNoRecordToast() {
    const msg = typeof currentLang !== 'undefined' && currentLang === 'zh_CN' 
        ? '暂无浏览记录（可能是导入的书签）' 
        : 'No browsing history found (may be imported bookmark)';
    
    // 创建提示元素
    let toast = document.getElementById('noRecordToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'noRecordToast';
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: #fff;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(toast);
    }
    
    toast.textContent = msg;
    toast.style.opacity = '1';
    
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 2500);
}

function showRelatedJumpSuccessToast(visitTime, title) {
    const isZh = currentLang === 'zh_CN';
    const dateText = visitTime
        ? new Date(visitTime).toLocaleString(isZh ? 'zh-CN' : 'en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
        : '';
    const safeTitle = (title && title.trim()) || (isZh ? '目标记录' : 'target entry');
    const msg = isZh
        ? `已定位：${safeTitle}${dateText ? `（${dateText}）` : ''}`
        : `Jumped to ${safeTitle}${dateText ? ` (${dateText})` : ''}`;

    let toast = document.getElementById('relatedJumpToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'relatedJumpToast';
        toast.style.cssText = `
            position: fixed;
            top: 28px;
            right: 28px;
            background: rgba(33, 150, 243, 0.92);
            color: #fff;
            padding: 14px 18px;
            border-radius: 10px;
            font-size: 13px;
            box-shadow: 0 8px 24px rgba(33, 150, 243, 0.35);
            z-index: 11000;
            opacity: 0;
            transition: opacity 0.25s ease;
        `;
        document.body.appendChild(toast);
    }

    toast.textContent = msg;
    toast.style.opacity = '1';

    clearTimeout(toast.__hideTimer);
    toast.__hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
    }, 2400);
}

// 从「书签添加记录」跳转到「书签关联记录」
async function jumpToRelatedHistoryFromAdditions(url, title, dateAdded) {
    const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;
    
    // 先查询该URL在书签添加时间附近是否有访问记录
    let hasMatchingVisit = false;
    let matchingVisitTime = null;
    
    try {
        if (browserAPI && browserAPI.history && browserAPI.history.getVisits) {
            const visits = await new Promise((resolve, reject) => {
                browserAPI.history.getVisits({ url: url }, (results) => {
                    if (browserAPI.runtime && browserAPI.runtime.lastError) {
                        reject(browserAPI.runtime.lastError);
                    } else {
                        resolve(results || []);
                    }
                });
            });
            
            // 查找时间精确匹配的访问记录（同一分钟内，即60秒）
            const oneMinute = 60 * 1000;
            let minDiff = Infinity;
            
            visits.forEach(visit => {
                const diff = Math.abs(visit.visitTime - dateAdded);
                if (diff < minDiff) {
                    minDiff = diff;
                    matchingVisitTime = visit.visitTime;
                }
            });
            
            // 时间差必须在1分钟内才算匹配
            hasMatchingVisit = minDiff <= oneMinute;
        }
    } catch (e) {
        console.warn('[jumpToRelatedHistoryFromAdditions] 查询访问记录失败:', e);
    }
    
    // 如果没有精确匹配的访问记录，直接显示提示，不跳转
    if (!hasMatchingVisit) {
        showNoRecordToast();
        return;
    }
    
    // 记录来源信息，用于返回
    jumpSourceInfo = {
        type: 'bookmarkAdditions',  // 来自书签添加记录
        url: url,
        title: title,
        dateAdded: dateAdded,
        scrollTop: document.querySelector('.content-area')?.scrollTop || 0
    };
    
    // 添加超时保护机制
    clearTimeout(window.__relatedJumpTimeout);
    window.__relatedJumpTimeout = setTimeout(() => {
        if (pendingHighlightInfo && pendingHighlightInfo.silentMenu) {
            console.warn('[BrowsingRelated] 跳转超时，强制清理加载状态');
            setRelatedPanelSilent(false);
            pendingHighlightInfo = null;
        }
    }, 10000);
    
    // 1. 切换到「书签浏览记录」标签
    const browsingTab = document.getElementById('additionsTabBrowsing');
    if (browsingTab && !browsingTab.classList.contains('active')) {
        browsingTab.click();
    }
    
    // 2. 切换到「书签关联记录」子标签
    const relatedTab = document.getElementById('browsingTabRelated');
    if (relatedTab && !relatedTab.classList.contains('active')) {
        relatedTab.click();
    }
    
    // 3. 根据访问时间构建时间范围策略
    const normalizedTitle = typeof title === 'string' ? title.trim() : '';
    const hasPreciseVisit = typeof matchingVisitTime === 'number' && !Number.isNaN(matchingVisitTime);
    const preferredRange = getPreferredRangeFromCalendar(window.bookmarkCalendarInstance);
    const strategyQueue = buildRelatedRangeStrategies(matchingVisitTime, { preferredRange });
    const effectiveStrategies = strategyQueue.length ? strategyQueue : [{ range: 'all', filter: null }];
    
    // 4. 存储待高亮信息
    pendingHighlightInfo = {
        url: url,
        title: title,
        normalizedTitle,
        visitTime: matchingVisitTime,
        strategyQueue: effectiveStrategies,
        currentStrategyIndex: 0,
        fromAdditions: true,
        showBackButton: true,  // 标记需要显示返回按钮
        hasVisitTime: hasPreciseVisit,
        forceLoadAll: true,
        silentMenu: true,
        pendingUIRange: effectiveStrategies[0]?.range || null,
        pendingUIFilter: effectiveStrategies[0]?.filter || null
    };

    // 5. 启动对应的范围策略
    activateRelatedRangeStrategy(effectiveStrategies[0]);
}

// 从「点击排行」跳转到「书签关联记录」并高亮所有匹配记录
async function jumpToRelatedHistoryFromRanking(url, title, currentRange) {
    // 保存当前的二级菜单筛选条件
    const currentTimeFilter = browsingRankingTimeFilter ? { ...browsingRankingTimeFilter } : null;
    
    // 记录来源信息，用于返回
    jumpSourceInfo = {
        type: 'clickRanking',  // 来自点击排行
        url: url,
        title: title,
        range: currentRange,
        timeFilter: currentTimeFilter,  // 保存二级菜单筛选条件
        scrollTop: document.querySelector('.content-area')?.scrollTop || 0
    };
    
    // 添加超时保护机制
    clearTimeout(window.__relatedJumpTimeout);
    window.__relatedJumpTimeout = setTimeout(() => {
        if (pendingHighlightInfo) {
            console.warn('[BrowsingRelated] 跳转超时，强制清理状态');
            setRelatedPanelSilent(false);
            pendingHighlightInfo = null;
        }
    }, 10000);
    
    // 1. 切换到「书签浏览记录」标签
    const browsingTab = document.getElementById('additionsTabBrowsing');
    if (browsingTab && !browsingTab.classList.contains('active')) {
        browsingTab.click();
    }
    
    // 2. 切换到「书签关联记录」子标签
    const relatedTab = document.getElementById('browsingTabRelated');
    if (relatedTab && !relatedTab.classList.contains('active')) {
        relatedTab.click();
    }
    
    // 3. 存储待高亮信息
    pendingHighlightInfo = {
        url: url,
        title: title,
        currentRange: currentRange,
        timeFilter: currentTimeFilter,  // 传递二级菜单筛选条件
        fromRanking: true,
        showBackButton: true,
        highlightAll: true
    };
    
    // 4. 切换到对应的时间范围（这会触发 showBrowsingRelatedTimeMenu）
    const rangeName = currentRange.charAt(0).toUpperCase() + currentRange.slice(1);
    const filterBtn = document.getElementById(`browsingRelatedFilter${rangeName}`);
    if (filterBtn && !filterBtn.classList.contains('active')) {
        filterBtn.click();
    } else {
        // 已经在当前范围，重新加载
        await loadBrowsingRelatedHistory(currentRange);
    }
    
    // 5. 延迟应用二级菜单筛选并高亮
    setTimeout(() => {
        if (currentTimeFilter) {
            scheduleApplyRelatedFilter(currentTimeFilter);
        }
        highlightAllRelatedHistoryItems();
    }, 500);
}

// 应用书签关联记录的二级菜单筛选（从点击排行跳转时使用）
function applyRelatedTimeFilter(filter) {
    const menuContainer = document.getElementById('browsingRelatedTimeMenu');
    if (!menuContainer) return false;
    const buttons = menuContainer.querySelectorAll('.time-menu-btn');
    if (!buttons.length) return false;

    let targetBtn = null;

    buttons.forEach(btn => {
        if (!filter) {
            if (btn.dataset.filter === 'all' && !targetBtn) {
                targetBtn = btn;
            }
            return;
        }

        if (btn.dataset.filter === 'all' && filter.type === 'all') {
            targetBtn = btn;
        } else if (filter.type === 'hour' && btn.dataset.hour == filter.value) {
            targetBtn = btn;
        } else if (filter.type === 'day' && btn.dataset.date) {
            const btnDate = new Date(btn.dataset.date);
            if (filter.value instanceof Date && btnDate.toDateString() === filter.value.toDateString()) {
                targetBtn = btn;
            }
        } else if (filter.type === 'week' && btn.dataset.week == filter.value) {
            targetBtn = btn;
        } else if (filter.type === 'month' && btn.dataset.month == filter.value) {
            targetBtn = btn;
        } else if (filter.type === 'year' && btn.dataset.year == filter.value) {
            targetBtn = btn;
        }
    });

    if (targetBtn) {
        targetBtn.click();
        return true;
    }

    return false;
}

// 高亮点击记录日历中所有匹配的记录（从点击排行跳转时使用）
function highlightAllClickHistoryItems(retryCount = 0) {
    if (!pendingHighlightInfo) return;
    
    const { url, title, currentRange, showBackButton: shouldShowBackButton } = pendingHighlightInfo;
    
    // 获取点击记录日历实例
    const calendar = window.browsingHistoryCalendarInstance;
    if (!calendar || !calendar.bookmarksByDate) {
        if (retryCount < 10) {
            setTimeout(() => highlightAllClickHistoryItems(retryCount + 1), 300);
        } else {
            pendingHighlightInfo = null;
            showNoRecordToast();
        }
        return;
    }
    
    // 查找日历容器中的所有书签项
    const calendarContainer = document.getElementById('browsingHistoryCalendar');
    if (!calendarContainer) {
        if (retryCount < 10) {
            setTimeout(() => highlightAllClickHistoryItems(retryCount + 1), 300);
        }
        return;
    }
    
    // 查找所有匹配URL的书签项（使用 data-bookmark-url 属性）
    const items = calendarContainer.querySelectorAll('[data-bookmark-url]');
    const matchedItems = [];
    
    items.forEach(item => {
        const itemUrl = item.dataset.bookmarkUrl;
        if (itemUrl === url) {
            matchedItems.push(item);
        }
    });
    
    if (matchedItems.length > 0) {
        // 移除之前的高亮
        calendarContainer.querySelectorAll('[data-bookmark-url].highlight-target').forEach(el => {
            el.classList.remove('highlight-target');
        });
        
        // 为所有匹配项添加高亮
        matchedItems.forEach(item => {
            item.classList.add('highlight-target');
        });
        
        // 滚动到第一个匹配项
        matchedItems[0].scrollIntoView({ behavior: 'instant', block: 'center' });
        
        // 显示返回按钮
        if (shouldShowBackButton && jumpSourceInfo) {
            showBackButton();
        }
        
        // 清除待高亮信息
        pendingHighlightInfo = null;
        return;
    }
    
    // 没找到匹配项，可能需要等待渲染
    if (retryCount < 10) {
        setTimeout(() => highlightAllClickHistoryItems(retryCount + 1), 300);
    } else {
        pendingHighlightInfo = null;
        showNoRecordToast();
    }
}

// 高亮所有匹配的书签关联记录（保留，可能其他地方使用）
function highlightAllRelatedHistoryItems(retryCount = 0) {
    if (!pendingHighlightInfo) return;
    
    const { url, title, highlightAll, showBackButton: shouldShowBackButton } = pendingHighlightInfo;
    const listContainer = document.getElementById('browsingRelatedList');
    if (!listContainer) {
        // 确保在容器不存在时也清理状态
        clearTimeout(window.__relatedJumpTimeout);
        pendingHighlightInfo = null;
        return;
    }
    
    // 查找所有匹配的记录项（URL匹配或标题匹配，与点击排行的计数逻辑保持一致）
    const items = listContainer.querySelectorAll('.related-history-item');
    const matchedItems = [];
    const normalizedTitle = title ? title.trim() : '';
    
    items.forEach(item => {
        const itemUrl = item.dataset.url;
        const itemTitle = item.dataset.title || '';
        
        // URL 精确匹配
        if (itemUrl === url) {
            matchedItems.push(item);
        }
        // 标题匹配（URL不同但标题相同）
        else if (normalizedTitle && itemTitle === normalizedTitle) {
            matchedItems.push(item);
        }
    });
    
    // 如果找到了匹配项，高亮显示
    if (matchedItems.length > 0) {
        // 移除之前的高亮
        listContainer.querySelectorAll('.related-history-item.highlight-target').forEach(el => {
            el.classList.remove('highlight-target');
        });
        
        // 为所有匹配项添加高亮
        matchedItems.forEach(item => {
            item.classList.add('highlight-target');
        });
        
        // 获取当前排序顺序（默认按时间降序，即最新的在前）
        const sortBtn = document.querySelector('.sort-indicator-btn');
        const isAscending = sortBtn && sortBtn.classList.contains('asc');
        
        // 根据排序滚动到第一个或最后一个（最新/最旧的记录）
        const targetItem = isAscending ? matchedItems[0] : matchedItems[0];
        targetItem.scrollIntoView({ behavior: 'instant', block: 'center' });
        
        // 显示返回按钮
        if (shouldShowBackButton && jumpSourceInfo) {
            showBackButton();
        }
        
        // 清除超时保护和待高亮信息
        clearTimeout(window.__relatedJumpTimeout);
        pendingHighlightInfo = null;
        return;
    }
    
    // 检查是否有未加载的数据（懒加载场景）
    const lazyState = listContainer.__lazyLoadState;
    if (lazyState && lazyState.getLoadedCount() < lazyState.totalItems) {
        // 还有未加载的数据，加载更多后重试
        lazyState.loadMore();
        if (retryCount < 20) {
            setTimeout(() => highlightAllRelatedHistoryItems(retryCount + 1), 100);
        } else {
            // 重试次数过多，加载全部然后最后尝试一次
            lazyState.loadAll();
            setTimeout(() => highlightAllRelatedHistoryItems(100), 100);
        }
        return;
    }
    
    // 没找到匹配项
    if (retryCount < 5) {
        setTimeout(() => highlightAllRelatedHistoryItems(retryCount + 1), 300);
    } else {
        // 清除超时保护
        clearTimeout(window.__relatedJumpTimeout);
        pendingHighlightInfo = null;
        // 显示暂无记录提示
        showNoRecordToast();
    }
}

// ============================================================================
// 返回按钮功能
// ============================================================================

// 显示返回按钮
function showBackButton() {
    // 如果已存在，先移除（但不清除 jumpSourceInfo）
    const existingBtn = document.getElementById('jumpBackBtn');
    if (existingBtn) existingBtn.remove();
    
    console.log('[showBackButton] 显示返回按钮, jumpSourceInfo:', jumpSourceInfo);
    
    const btn = document.createElement('button');
    btn.id = 'jumpBackBtn';
    btn.className = 'jump-back-btn';
    btn.innerHTML = '<i class="fas fa-arrow-left"></i>';
    btn.title = typeof currentLang !== 'undefined' && currentLang === 'zh_CN' ? '返回' : 'Go Back';
    
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[showBackButton] 点击返回按钮');
        goBackToSource();
    });
    
    document.body.appendChild(btn);
    
    // 显示动画
    setTimeout(() => {
        btn.style.opacity = '1';
        btn.style.transform = 'translateY(0)';
    }, 50);
}

// 隐藏返回按钮（可选是否清除来源信息）
function hideBackButton(clearSource = true) {
    const btn = document.getElementById('jumpBackBtn');
    if (btn) {
        btn.remove();
    }
    if (clearSource) {
        jumpSourceInfo = null;
    }
}

// 返回到跳转来源
async function goBackToSource() {
    if (!jumpSourceInfo) {
        console.warn('[goBackToSource] jumpSourceInfo 为空');
        return;
    }
    
    const { type, url, scrollTop } = jumpSourceInfo;
    console.log('[goBackToSource] 返回:', type, url);
    
    // 先隐藏返回按钮
    const btn = document.getElementById('jumpBackBtn');
    if (btn) btn.remove();
    
    // 清除来源信息（在使用完之后立即清除）
    jumpSourceInfo = null;
    
    if (type === 'browsingHistory') {
        // 返回点击记录 - 需要切换到「点击记录」子标签
        const historyTab = document.getElementById('browsingTabHistory');
        if (historyTab) {
            historyTab.click();
            console.log('[goBackToSource] 已切换到点击记录');
        }
        
        // 恢复滚动位置并高亮
        setTimeout(() => {
            const contentArea = document.querySelector('.content-area');
            if (contentArea && scrollTop) {
                contentArea.scrollTop = scrollTop;
            }
            highlightSourceBookmark(url);
        }, 500);
        
    } else if (type === 'bookmarkAdditions') {
        // 返回书签添加记录 - 需要切换到「书签添加记录」标签
        const reviewTab = document.getElementById('additionsTabReview');
        if (reviewTab) {
            reviewTab.click();
            console.log('[goBackToSource] 已切换到书签添加记录');
        }
        
        // 恢复滚动位置并高亮
        setTimeout(() => {
            const contentArea = document.querySelector('.content-area');
            if (contentArea && scrollTop) {
                contentArea.scrollTop = scrollTop;
            }
            highlightSourceBookmark(url);
        }, 500);
        
    } else if (type === 'clickRanking') {
        // 返回点击排行 - 需要切换到「点击排行」子标签
        const rankingTab = document.getElementById('browsingTabRanking');
        if (rankingTab) {
            rankingTab.click();
            console.log('[goBackToSource] 已切换到点击排行');
        }
        
        // 恢复滚动位置并高亮
        setTimeout(() => {
            const contentArea = document.querySelector('.content-area');
            if (contentArea && scrollTop) {
                contentArea.scrollTop = scrollTop;
            }
            highlightSourceRankingItem(url);
        }, 500);
    }
}

// 高亮来源书签
function highlightSourceBookmark(url) {
    // 在整个内容区域查找匹配的书签项
    const contentArea = document.querySelector('.content-area');
    if (!contentArea) {
        console.warn('[highlightSourceBookmark] 未找到 content-area');
        return;
    }
    
    // 查找所有匹配URL的书签项
    const items = contentArea.querySelectorAll('[data-bookmark-url]');
    console.log('[highlightSourceBookmark] 查找书签:', url, '找到', items.length, '个书签项');
    
    let found = false;
    
    items.forEach(item => {
        if (item.dataset.bookmarkUrl === url && !found) {
            found = true;
            console.log('[highlightSourceBookmark] 找到匹配书签，添加高亮');
            item.classList.add('highlight-source');
            item.scrollIntoView({ behavior: 'instant', block: 'center' });
            
            // 3秒后移除高亮
            setTimeout(() => {
                item.classList.remove('highlight-source');
            }, 3000);
        }
    });
    
    if (!found) {
        console.warn('[highlightSourceBookmark] 未找到匹配的书签');
    }
}

// 高亮点击排行中的来源书签
function highlightSourceRankingItem(url) {
    const listContainer = document.getElementById('browsingRankingList');
    if (!listContainer) {
        console.warn('[highlightSourceRankingItem] 未找到 browsingRankingList');
        return;
    }
    
    // 查找所有排行项
    const items = listContainer.querySelectorAll('.ranking-item');
    console.log('[highlightSourceRankingItem] 查找排行项:', url, '找到', items.length, '个项目');
    
    let found = false;
    
    items.forEach(item => {
        // 通过跳转按钮的 data-url 来匹配
        const jumpBtn = item.querySelector('.jump-to-related-btn');
        if (jumpBtn && jumpBtn.dataset.url === url && !found) {
            found = true;
            console.log('[highlightSourceRankingItem] 找到匹配排行项，添加高亮');
            item.classList.add('highlight-source');
            item.scrollIntoView({ behavior: 'instant', block: 'center' });
            
            // 3秒后移除高亮
            setTimeout(() => {
                item.classList.remove('highlight-source');
            }, 3000);
        }
    });
    
    if (!found) {
        console.warn('[highlightSourceRankingItem] 未找到匹配的排行项');
    }
}

// ============================================================================
// 回到顶部悬浮按钮功能
// ============================================================================

// 为指定面板创建回到顶部按钮
function createScrollToTopForPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    
    // 检查是否已存在
    if (panel.querySelector('.scroll-to-top-btn')) return;
    
    const btn = document.createElement('button');
    btn.className = 'scroll-to-top-btn';
    btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    btn.title = typeof currentLang !== 'undefined' && currentLang === 'zh_CN' ? '回到顶部' : 'Back to Top';
    
    btn.addEventListener('click', () => {
        const contentArea = document.querySelector('.content-area');
        if (contentArea) {
            contentArea.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    
    panel.style.position = 'relative';
    panel.appendChild(btn);
    
    return btn;
}

// 初始化所有回到顶部按钮
function initScrollToTopButtons() {
    const contentArea = document.querySelector('.content-area');
    if (!contentArea) return;
    
    // 为三个面板创建按钮
    createScrollToTopForPanel('browsingHistoryPanel');
    createScrollToTopForPanel('browsingRankingPanel');
    createScrollToTopForPanel('browsingRelatedPanel');
    
    // 获取所有按钮
    const buttons = document.querySelectorAll('.scroll-to-top-btn');
    
    // 监听滚动
    contentArea.addEventListener('scroll', () => {
        const show = contentArea.scrollTop > 200;
        buttons.forEach(btn => {
            btn.style.display = show ? 'flex' : 'none';
        });
    });
}

// 在 DOMContentLoaded 后初始化
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initScrollToTopButtons, 1000);
});
