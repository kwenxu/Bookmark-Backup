// =============================================================================
// 全局变量和常量
// =============================================================================

// Unified Export Folder Paths - 统一的导出文件夹路径（根据语言动态选择）
const getHistoryExportRootFolder = () => currentLang === 'zh_CN' ? '书签备份' : 'Bookmark Backup';
const getHistoryExportFolder = () => currentLang === 'zh_CN' ? '备份历史' : 'Bookmarks_History';
const getCurrentChangesExportFolder = () => currentLang === 'zh_CN' ? '当前变化' : 'Current Changes';

let currentLang = 'zh_CN';
// [Init] Restore custom language from storage immediately
try {
    const saved = localStorage.getItem('historyViewerCustomLang');
    if (saved === 'en' || saved === 'zh_CN') {
        currentLang = saved;
        // console.log('[History Viewer] Restored language:', currentLang);
    } else {
        try {
            const ui = (chrome?.i18n?.getUILanguage?.() || '').toLowerCase();
            currentLang = ui.startsWith('zh') ? 'zh_CN' : 'en';
        } catch (e) {
        }
    }
} catch (e) { }

window.currentLang = currentLang; // 暴露给其他模块使用
// 允许外部页面限制可用视图（拆分插件时使用）
const DEFAULT_VIEWS = ['current-changes', 'history'];
const ALLOWED_VIEWS = (Array.isArray(window.__ALLOWED_VIEWS) && window.__ALLOWED_VIEWS.length)
    ? window.__ALLOWED_VIEWS
    : DEFAULT_VIEWS;
const DEFAULT_VIEW = (typeof window.__DEFAULT_VIEW === 'string' && ALLOWED_VIEWS.includes(window.__DEFAULT_VIEW))
    ? window.__DEFAULT_VIEW
    : ALLOWED_VIEWS[0];
const isViewAllowed = (view) => ALLOWED_VIEWS.includes(view);
let currentTheme = 'light';
// =============================================================================
// 统一存储架构：historyViewSettings
// 将所有视图设置存储在 chrome.storage.local，替代分散的 localStorage
// 这样 background.js (Service Worker) 也能访问这些设置，实现 WYSIWYG 导出
// =============================================================================
let historyDetailMode = 'simple'; // 默认值，将在初始化时从 chrome.storage.local 加载
let historyViewSettings = null;   // 缓存视图设置对象
let historyViewSettingsSaveTimeout = null; // 防抖保存定时器

// 旧的 localStorage 键前缀（用于迁移）
const HISTORY_DETAIL_MODE_PREFIX = 'historyDetailMode:';
const HISTORY_DETAIL_EXPANDED_PREFIX = 'historyDetailExpanded:';

/**
 * 从 chrome.storage.local 加载视图设置
 * @returns {Promise<Object>} 视图设置对象
 */
async function loadHistoryViewSettings() {
    return new Promise(resolve => {
        const browserAPI = (typeof chrome !== 'undefined' && chrome.storage) ? chrome : (typeof browser !== 'undefined' ? browser : null);
        if (!browserAPI || !browserAPI.storage) {
            console.warn('[历史视图设置] 无法访问 storage API');
            historyViewSettings = { defaultMode: 'simple', recordModes: {}, recordExpandedStates: {} };
            historyDetailMode = 'simple';
            resolve(historyViewSettings);
            return;
        }
        browserAPI.storage.local.get(['historyViewSettings'], result => {
            historyViewSettings = result.historyViewSettings || {
                defaultMode: 'simple',
                recordModes: {},
                recordExpandedStates: {}
            };
            historyDetailMode = historyViewSettings.defaultMode || 'simple';
            console.log('[历史视图设置] 已加载:', {
                defaultMode: historyDetailMode,
                recordModesCount: Object.keys(historyViewSettings.recordModes || {}).length,
                expandedStatesCount: Object.keys(historyViewSettings.recordExpandedStates || {}).length
            });
            resolve(historyViewSettings);
        });
    });
}

/**
 * 保存视图设置到 chrome.storage.local（带防抖 300ms）
 * @returns {Promise<void>}
 */
async function saveHistoryViewSettings() {
    if (historyViewSettingsSaveTimeout) {
        clearTimeout(historyViewSettingsSaveTimeout);
    }
    return new Promise(resolve => {
        historyViewSettingsSaveTimeout = setTimeout(async () => {
            const browserAPI = (typeof chrome !== 'undefined' && chrome.storage) ? chrome : (typeof browser !== 'undefined' ? browser : null);
            if (!browserAPI || !browserAPI.storage || !historyViewSettings) {
                resolve();
                return;
            }
            await new Promise(r => {
                browserAPI.storage.local.set({ historyViewSettings }, r);
            });
            console.log('[历史视图设置] 已保存到 chrome.storage.local');
            resolve();
        }, 300);
    });
}

/**
 * 将 localStorage 中的历史视图设置迁移到 chrome.storage.local
 * 只在首次加载时执行一次
 */
async function migrateHistoryViewSettingsFromLocalStorage() {
    const browserAPI = (typeof chrome !== 'undefined' && chrome.storage) ? chrome : (typeof browser !== 'undefined' ? browser : null);
    if (!browserAPI || !browserAPI.storage) return;

    // 检查是否已迁移
    const result = await new Promise(resolve => {
        browserAPI.storage.local.get(['historyViewSettingsMigrated'], resolve);
    });

    if (result.historyViewSettingsMigrated) {
        console.log('[迁移] 历史视图设置已迁移，跳过');
        return;
    }

    console.log('[迁移] 开始迁移 localStorage 中的历史视图设置...');

    const newSettings = {
        defaultMode: 'simple',
        recordModes: {},
        recordExpandedStates: {}
    };

    try {
        // 迁移全局默认模式
        const defaultMode = localStorage.getItem('historyDetailMode');
        if (defaultMode === 'simple' || defaultMode === 'detailed') {
            newSettings.defaultMode = defaultMode;
        }

        // 遍历 localStorage，找出所有历史相关的 key
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;

            // 迁移每条记录的视图模式
            if (key.startsWith(HISTORY_DETAIL_MODE_PREFIX)) {
                const recordTime = key.replace(HISTORY_DETAIL_MODE_PREFIX, '');
                const mode = localStorage.getItem(key);
                if (mode === 'simple' || mode === 'detailed') {
                    newSettings.recordModes[recordTime] = mode;
                }
            }

            // 迁移每条记录的展开状态
            if (key.startsWith(HISTORY_DETAIL_EXPANDED_PREFIX)) {
                const recordTime = key.replace(HISTORY_DETAIL_EXPANDED_PREFIX, '');
                try {
                    const expandedIds = JSON.parse(localStorage.getItem(key));
                    if (Array.isArray(expandedIds)) {
                        newSettings.recordExpandedStates[recordTime] = expandedIds;
                    }
                } catch (e) { }
            }
        }

        // 保存到 chrome.storage.local
        await new Promise(resolve => {
            browserAPI.storage.local.set({
                historyViewSettings: newSettings,
                historyViewSettingsMigrated: true
            }, resolve);
        });

        // 更新全局变量
        historyViewSettings = newSettings;
        historyDetailMode = newSettings.defaultMode;

        console.log('[迁移] 历史视图设置迁移完成');
        console.log('[迁移] 迁移的数据:', {
            defaultMode: newSettings.defaultMode,
            recordModesCount: Object.keys(newSettings.recordModes).length,
            recordExpandedStatesCount: Object.keys(newSettings.recordExpandedStates).length
        });

    } catch (error) {
        console.error('[迁移] 迁移失败:', error);
    }
}
let currentDetailRecordMode = null;
let currentDetailRecord = null;
let currentDetailRecordTime = null; // 当前打开的详情面板对应的记录时间
let currentExportHistoryTreeContainer = null;
let currentRestoreRecord = null;
let restoreGeneralPreflight = null;
let restoreImportTarget = null; // { id, title, path }
const restoreImportTargetTreeCache = new Map(); // folderId -> { folders, stats }
const restoreImportTargetTreeLoading = new Map(); // folderId -> Promise
const restoreImportTargetPathCache = new Map(); // folderId -> fullPath
let restoreComparisonState = null; // 二级 UI 中部统计区状态
// 实时更新状态控制
let viewerInitialized = false;
let deferredAnalysisMessage = null;
let messageListenerRegistered = false;
let realtimeUpdateInProgress = false;
let pendingAnalysisMessage = null;
let lastAnalysisSignature = null;
// 显式移动集合（基于 onMoved 事件），用于同级移动标识，设置短期有效期
let explicitMovedIds = new Map(); // id -> expiryTimestamp

// 页面刷新/重新打开时，恢复“显式移动”标记
async function restoreExplicitMovedIdsFromStorage() {
    try {
        if (!browserAPI || !browserAPI.storage || !browserAPI.storage.local) return;
        const data = await browserAPI.storage.local.get(['recentMovedIds']);
        const recentMovedIds = data && Array.isArray(data.recentMovedIds) ? data.recentMovedIds : [];
        if (!recentMovedIds.length) return;

        // 防止极端情况下列表过大导致初始化变慢：只恢复最近 N 条（备份成功后会清空）
        const MAX_RESTORE = 2000;
        const slice = recentMovedIds.length > MAX_RESTORE ? recentMovedIds.slice(-MAX_RESTORE) : recentMovedIds;
        slice.forEach(entry => {
            if (!entry || typeof entry.id === 'undefined' || entry.id === null) return;
            explicitMovedIds.set(String(entry.id), Infinity);
        });
        console.log('[移动标识] 已从storage恢复显式移动ID数量:', explicitMovedIds.size);
    } catch (e) {
        console.warn('[移动标识] 从storage恢复显式移动ID失败:', e);
    }
}
// 从 localStorage 立即恢复视图，避免页面闪烁
// 从 URL 参数或 localStorage 恢复视图
let currentView = (() => {
    try {
        // 1. 优先尝试从 URL 参数获取
        // 注意：此时 window.location.search 可能已经可用
        const params = new URLSearchParams(window.location.search);
        const viewFromUrl = params.get('view');
        if (viewFromUrl) {
            console.log('[全局初始化] URL 参数中的视图:', viewFromUrl);
            return viewFromUrl;
        }

        // 2. 其次尝试从 localStorage 获取
        const saved = localStorage.getItem('lastActiveView');
        console.log('[全局初始化] localStorage中的视图:', saved);
        return saved || 'current-changes';
    } catch (e) {
        console.error('[全局初始化] 读取视图失败:', e);
        return 'current-changes';
    }
})();

// 用于避免重复在一次备份后多次重置（基于最近一条备份记录的指纹或时间）
window.__lastResetFingerprint = window.__lastResetFingerprint || null;

// 用于标记由拖拽操作处理过的移动，防止 applyIncrementalMoveToTree 重复处理
window.__dragMoveHandled = window.__dragMoveHandled || new Set();

// 在 Current Changes 预览中清理颜色标识，不改变布局/滚动/展开状态
function resetPermanentSectionChangeMarkers() {
    try {
        // 仅清理 Current Changes 视图中的书签树预览
        const sections = [];
        const previewSection = document.getElementById('changesPreviewPermanentSection');
        if (previewSection) sections.push(previewSection);
        if (!sections.length) return;

        const changeClasses = ['tree-change-added', 'tree-change-modified', 'tree-change-moved', 'tree-change-mixed', 'tree-change-deleted'];

        sections.forEach(section => {
            // 每个栏目内部都有自己独立的滚动容器和书签树
            const tree =
                section.querySelector('#bookmarkTree') || // 主树容器
                section.querySelector('.bookmark-tree');  // Current Changes 预览中的克隆树
            if (!tree) return;

            const body = section.querySelector('.permanent-section-body');
            const prevScrollTop = body ? body.scrollTop : null;

            // 1) 红色（deleted）项目：直接移除对应的 .tree-node
            tree.querySelectorAll('.tree-item.tree-change-deleted').forEach(item => {
                const node = item.closest('.tree-node');
                if (node && node.parentNode) node.parentNode.removeChild(node);
            });

            // 2) 清理其余颜色标识类和内联样式、徽标
            const selector = changeClasses.map(c => `.tree-item.${c}`).join(',');
            tree.querySelectorAll(selector).forEach(item => {
                changeClasses.forEach(c => item.classList.remove(c));
                const link = item.querySelector('.tree-bookmark-link');
                const label = item.querySelector('.tree-label');
                if (link) {
                    link.style.color = '';
                    link.style.fontWeight = '';
                    link.style.textDecoration = '';
                    link.style.opacity = '';
                }
                if (label) {
                    label.style.color = '';
                    label.style.fontWeight = '';
                    label.style.textDecoration = '';
                    label.style.opacity = '';
                }
                const badges = item.querySelector('.change-badges');
                if (badges) badges.innerHTML = '';
            });

            // 3) 清理灰色引导标识 (.change-badge.has-changes)
            // 这些标识可能存在于没有变化类的文件夹节点上（表示"此文件夹下有变化"）
            tree.querySelectorAll('.change-badge.has-changes').forEach(badge => {
                badge.remove();
            });

            // 4) 清理图例（备份后没有变化，无需显示图例）
            const legend = tree.querySelector('.tree-legend');
            if (legend) {
                legend.remove();
            }

            if (body != null && prevScrollTop != null) {
                body.scrollTop = prevScrollTop;
            }
        });

        console.log('[ChangesPreview] 预览颜色标识已清理完毕');
    } catch (e) {
        console.warn('[ChangesPreview] 清理预览标识时出错:', e);
    }
}
console.log('[全局初始化] currentView初始值:', currentView);
let currentFilter = 'all';
let currentTimeFilter = 'all'; // 'all', 'year', 'month', 'day'
let allBookmarks = [];
let syncHistory = [];
let lastBackupTime = null;
let currentBookmarkData = null;

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


// =============================================================================
// =============================================================================

let permanentTreeCopySyncObserver = null;
let permanentTreeCopySyncTarget = null;
let permanentTreeCopySyncScheduled = false;
let permanentTreeCopySyncTimer = null;


function __captureTreeExpandedNodeIds(tree) {
    const expanded = new Set();
    if (!tree) return expanded;
    try {
        tree.querySelectorAll('.tree-children.expanded').forEach(children => {
            const node = children.closest('.tree-node');
            const item = node ? node.querySelector(':scope > .tree-item[data-node-id]') : null;
            const nodeId = item && item.dataset ? item.dataset.nodeId : null;
            if (nodeId) expanded.add(String(nodeId));
        });
    } catch (_) { }
    return expanded;
}

function __resetTreeExpandedState(tree) {
    if (!tree) return;
    try {
        tree.querySelectorAll('.tree-children.expanded').forEach(children => {
            children.classList.remove('expanded');
        });
        tree.querySelectorAll('.tree-toggle.expanded').forEach(toggle => {
            toggle.classList.remove('expanded');
        });
        tree.querySelectorAll('.tree-item[data-node-type="folder"] .tree-icon.fas.fa-folder-open').forEach(icon => {
            icon.classList.remove('fa-folder-open');
            icon.classList.add('fa-folder');
        });
    } catch (_) { }
}

function __applyTreeExpandedNodeIds(tree, expandedNodeIds) {
    if (!tree || !expandedNodeIds) return;
    const expanded = expandedNodeIds instanceof Set ? expandedNodeIds : new Set(expandedNodeIds);
    if (!expanded.size) return;
    expanded.forEach(nodeId => {
        try {
            const selector = `.tree-item[data-node-id="${CSS.escape(String(nodeId))}"]`;
            const item = tree.querySelector(selector);
            if (!item) return;
            const node = item.closest('.tree-node');
            if (!node) return;
            const children = node.querySelector(':scope > .tree-children');
            const toggle = item.querySelector(':scope > .tree-toggle') || item.querySelector('.tree-toggle');
            if (children) children.classList.add('expanded');
            if (toggle) toggle.classList.add('expanded');
            const icon = item.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
            if (icon) {
                icon.classList.remove('fa-folder');
                icon.classList.add('fa-folder-open');
            }
        } catch (_) { }
    });
}

function __ensureTreeRootExpanded(tree) {
    if (!tree) return;
    try {
        const rootItem = tree.querySelector('.tree-item[data-node-type="folder"][data-node-level="0"][data-node-id]');
        if (!rootItem) return;
        const node = rootItem.closest('.tree-node');
        if (!node) return;
        const children = node.querySelector(':scope > .tree-children');
        const toggle = rootItem.querySelector('.tree-toggle');
        const icon = rootItem.querySelector('.tree-icon.fas');
        if (children) children.classList.add('expanded');
        if (toggle) toggle.classList.add('expanded');
        if (icon && icon.classList.contains('fa-folder')) {
            icon.classList.remove('fa-folder');
            icon.classList.add('fa-folder-open');
        }
    } catch (_) { }
}

function __getTreeExpandStateStorageKey(treeContainer) {
    // Current Changes 预览：独立持久化展开状态（不与其他树混用）
    try {
        const previewRoot = treeContainer && treeContainer.closest ? treeContainer.closest('#changesTreePreviewInline') : null;
        if (previewRoot) {
            const mode = previewRoot.classList && previewRoot.classList.contains('compact-mode') ? 'compact' : 'detailed';
            return `changesPreviewExpandedNodes:${mode}`;
        }
    } catch (_) { }
    return 'treeExpandedNodeIds';
}

function __readTreeExpandStateFromStorage(treeContainer) {
    const key = __getTreeExpandStateStorageKey(treeContainer);
    try {
        const raw = localStorage.getItem(key);
        if (raw) return raw;
    } catch (_) { }

    return null;
}





function __lazyLoadExpandedFolders(tree, expandedNodeIds) {
    if (!tree || !expandedNodeIds || typeof loadPermanentFolderChildrenLazy !== 'function') return;
    try {
        const ids = expandedNodeIds instanceof Set ? expandedNodeIds : new Set(expandedNodeIds);
        if (!ids.size) return;
        ids.forEach((nodeId) => {
            try {
                const item = tree.querySelector(`.tree-item[data-node-id="${CSS.escape(String(nodeId))}"]`);
                if (!item) return;
                if (item.dataset.nodeType !== 'folder') return;
                if (item.dataset.childrenLoaded !== 'false') return;
                if (item.dataset.hasChildren !== 'true') return;
                const node = item.closest('.tree-node');
                if (!node) return;
                const children = node.querySelector(':scope > .tree-children');
                if (!children) return;
                loadPermanentFolderChildrenLazy(item.dataset.nodeId, children, 0, null);
            } catch (_) { }
        });
    } catch (_) { }
}







// Debug helper: inspect copy-specific persisted states (run in DevTools: `__debugPermanentCopyStates()`)
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

        // 查找所有相关的img标签（通过data-favicon-domain或父元素的data-node-url/data-bookmark-url）
        const allImages = document.querySelectorAll('img.tree-icon, img.change-tree-item-icon, img.search-result-favicon');

        allImages.forEach(img => {
            // 优先检查 img 元素自身的 data-bookmark-url 属性（搜索结果场景）
            let itemUrl = img.dataset.bookmarkUrl;

            // 如果 img 自身没有，再检查父元素
            if (!itemUrl) {
                const item = img.closest('[data-node-url], [data-bookmark-url]');
                if (item) {
                    itemUrl = item.dataset.nodeUrl || item.dataset.bookmarkUrl;
                }
            }

            if (itemUrl) {
                try {
                    const itemDomain = new URL(itemUrl).hostname;
                    if (itemDomain === domain) {
                        // 更新图标
                        img.src = dataUrl;

                        // 如果图片之前是隐藏的（被黄色书签图标替代），现在显示它
                        if (img.style.display === 'none') {
                            img.style.display = '';
                            // 隐藏相邻的 fallback 图标（可能是 previousSibling 或在同一父容器中）
                            const prevSibling = img.previousElementSibling;
                            if (prevSibling && prevSibling.classList.contains('search-result-icon-box-inline')) {
                                prevSibling.style.display = 'none';
                            } else {
                                // 在父容器中查找 fallback 图标
                                const parent = img.parentElement;
                                if (parent) {
                                    const fallbackIcon = parent.querySelector('.search-result-icon-box-inline');
                                    if (fallbackIcon) {
                                        fallbackIcon.style.display = 'none';
                                    }
                                }
                            }
                        }

                        updatedCount++;
                    }
                } catch (e) {
                    // 忽略无效URL
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
                e.target.classList.contains('change-tree-item-icon') ||
                e.target.classList.contains('search-result-favicon'))) {
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

// Edge/Chrome 内置页面 scheme 不同（仅用于展示/跳转提示）
const internalScheme = (navigator.userAgent || '').includes('Edg/') ? 'edge://' : 'chrome://';

// =============================================================================
// 国际化文本
// =============================================================================

const i18n = {
    pageTitle: {
        'zh_CN': '书签备份',
        'en': 'Bookmark Backup'
    },
    pageSubtitle: {
        'zh_CN': '',
        'en': ''
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
        'zh_CN': '当前变化',
        'en': 'Current Changes'
    },
    navHistory: {
        'zh_CN': '备份历史',
        'en': 'Backup History'
    },
    currentChangesViewTitle: {
        'zh_CN': '当前变化',
        'en': 'Current Changes'
    },
    historyViewTitle: {
        'zh_CN': '备份历史',
        'en': 'Backup History'
    },
    clearBackupHistoryTooltip: {
        'zh_CN': '清除记录',
        'en': 'Clear history'
    },
    clearBackupHistoryModalTitle: {
        'zh_CN': '清除记录',
        'en': 'Clear Records'
    },
    clearBackupHistoryModalDesc: {
        'zh_CN': '选择要删除的备份历史记录数量：',
        'en': 'Select the number of backup history records to delete:'
    },
    clearHistoryModePercentLabel: {
        'zh_CN': '按百分比删除',
        'en': 'Delete by percentage'
    },
    clearHistoryModeCountLabel: {
        'zh_CN': '按条数删除',
        'en': 'Delete by count'
    },
    clearHistoryPercentLabelBefore: {
        'zh_CN': '删除最旧的',
        'en': 'Delete the oldest'
    },
    clearHistoryCountLabelBefore: {
        'zh_CN': '删除最旧的',
        'en': 'Delete the oldest'
    },
    clearHistoryCountLabelAfter: {
        'zh_CN': '条记录',
        'en': 'records'
    },
    clearBackupHistoryCancelBtn: {
        'zh_CN': '取消',
        'en': 'Cancel'
    },
    clearBackupHistoryConfirmBtn: {
        'zh_CN': '确认删除',
        'en': 'Confirm Delete'
    },
    clearBackupHistorySuccess: {
        'zh_CN': (deleted) => `已删除 ${deleted} 条历史记录`,
        'en': (deleted) => `Deleted ${deleted} history records`
    },
    clearBackupHistoryFailed: {
        'zh_CN': '删除历史记录失败',
        'en': 'Failed to delete history'
    },
    // 二次确认弹窗
    clearHistorySecondConfirmTitle: {
        'zh_CN': '确认删除',
        'en': 'Confirm Delete'
    },
    clearHistorySecondConfirmPrefix: {
        'zh_CN': '即将删除',
        'en': 'About to delete'
    },
    clearHistorySecondConfirmSuffix: {
        'zh_CN': '条记录',
        'en': 'records'
    },
    clearHistorySecondConfirmWarning: {
        'zh_CN': '此操作不可撤销，建议先备份再删除',
        'en': 'This action cannot be undone. We recommend exporting first.'
    },
    clearHistoryExportFirstBtn: {
        'zh_CN': '先备份这些记录',
        'en': 'Export these records first'
    },
    clearHistoryDirectDeleteBtn: {
        'zh_CN': '直接删除',
        'en': 'Delete directly'
    },
    clearHistorySecondConfirmCancelBtn: {
        'zh_CN': '返回修改',
        'en': 'Go back'
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
        'zh_CN': '打开「当前变化」视图',
        'en': 'Open "Current Changes" view'
    },
    shortcutHistory: {
        'zh_CN': '打开「备份历史」视图',
        'en': 'Open "Backup History" view'
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
    globalExport: {
        'zh_CN': '全局导出',
        'en': 'Global Export'
    },
    globalExportModalTitle: {
        'zh_CN': '全局备份导出',
        'en': 'Global Backup Export'
    },
    globalExportFormatTitle: {
        'zh_CN': '导出格式',
        'en': 'Export Format'
    },
    globalExportFormatHint: {
        'zh_CN': '勾选即可导出对应格式文件',
        'en': 'Select to export the corresponding file formats'
    },
    globalExportPackTitle: {
        'zh_CN': '打包结构',
        'en': 'Packaging'
    },
    globalExportPackZip: {
        'zh_CN': 'ZIP 归档',
        'en': 'ZIP'
    },
    globalExportPackMerge: {
        'zh_CN': '单一文件合并',
        'en': 'Merge'
    },
    globalExportPackHint: {
        'zh_CN': 'ZIP归档将包含多个独立文件<br>单一文件合并将生成一个汇总文件',
        'en': 'ZIP contains separate files<br>Merge generates a summary file'
    },
    globalExportSelectTitle: {
        'zh_CN': '选择备份记录',
        'en': 'Select Backup Records'
    },
    globalExportRangeEnabledText: {
        'zh_CN': '自动勾选',
        'en': 'Auto select'
    },
    globalExportThSeq: {
        'zh_CN': '序号',
        'en': 'No.'
    },
    globalExportThNote: {
        'zh_CN': '备注',
        'en': 'Note'
    },
    globalExportThHash: {
        'zh_CN': '哈希值',
        'en': 'Hash'
    },
    globalExportThViewMode: {
        'zh_CN': '视图模式',
        'en': 'View Mode'
    },
    globalExportThTime: {
        'zh_CN': '时间',
        'en': 'Time'
    },
    globalExportCancel: {
        'zh_CN': '取消',
        'en': 'Cancel'
    },
    globalExportConfirm: {
        'zh_CN': '导出选中项',
        'en': 'Export Selected'
    },

    historyDetailModeSimple: {
        'zh_CN': '简略',
        'en': 'Simple'
    },
    historyDetailModeDetailed: {
        'zh_CN': '详细',
        'en': 'Detailed'
    },
    revertConfirmTitle: {
        'zh_CN': '确认撤销全部变化？',
        'en': 'Revert all changes?'
    },
    revertConfirmDesc: {
        'zh_CN': '这将撤销所有未提交的变化（新增/删除/修改/移动），并恢复到上次备份状态。此操作不可撤销。',
        'en': 'This will revert all uncommitted changes (add/delete/modify/move) and restore to the last backup. This cannot be undone.'
    },
    revertSuccess: {
        'zh_CN': '已撤销全部变化，已恢复到上次备份',
        'en': 'All changes reverted. Restored to last backup.'
    },
    revertFailed: {
        'zh_CN': '撤销失败：',
        'en': 'Revert failed: '
    },
    revertNoBackup: {
        'zh_CN': '没有可用的备份快照，无法撤销',
        'en': 'No backup snapshot available. Cannot revert.'
    },
    revertDisabledTip: {
        'zh_CN': '需先有备份',
        'en': 'Backup required'
    },
    revertModalTitle: {
        'zh_CN': '撤销全部变化',
        'en': 'Revert All Changes'
    },
    revertSnapshotBadge: {
        'zh_CN': '快照',
        'en': 'Snapshot'
    },
    revertSnapshotReady: {
        'zh_CN': '参考快照：已就绪',
        'en': 'Snapshot: Ready'
    },
    revertSnapshotMissing: {
        'zh_CN': '参考快照：缺失',
        'en': 'Snapshot: Missing'
    },
    revertSnapshotSubReady: {
        'zh_CN': '来源：上次备份快照',
        'en': 'Source: last backup snapshot'
    },
    revertSnapshotSubMissing: {
        'zh_CN': '请先创建备份作为参考快照',
        'en': 'Create a backup to generate a reference snapshot'
    },
    revertSnapshotTimeLabel: {
        'zh_CN': '快照时间：',
        'en': 'Snapshot Time: '
    },
    revertSnapshotNoTime: {
        'zh_CN': '无可用快照',
        'en': 'No snapshot available'
    },
    revertCurrentLabel: {
        'zh_CN': '当前浏览器',
        'en': 'Current Browser'
    },
    revertSnapshotLabel: {
        'zh_CN': '参考快照',
        'en': 'Snapshot'
    },
    revertBookmarksLabel: {
        'zh_CN': '书签',
        'en': 'Bookmarks'
    },
    revertFoldersLabel: {
        'zh_CN': '文件夹',
        'en': 'Folders'
    },
    revertPreviewTitle: {
        'zh_CN': '预览',
        'en': 'Preview'
    },
    revertPreviewSubOverwrite: {
        'zh_CN': '快照覆盖预览',
        'en': 'Snapshot overwrite preview'
    },
    revertPreviewSubPatch: {
        'zh_CN': '补丁撤销预览',
        'en': 'Patch revert preview'
    },
    revertPreviewHelpBtnTitle: {
        'zh_CN': '补丁撤销说明',
        'en': 'Patch Revert Notes'
    },
    revertPreviewHelpExecLine: {
        'zh_CN': '执行层：底层按真实数据执行新增/删除/移动/修改，结果以实际书签树为准。',
        'en': 'Execution layer: add/delete/move/modify runs on real bookmark data, and the actual bookmark tree is the source of truth.'
    },
    revertPreviewHelpDisplayLine: {
        'zh_CN': '展示层：预览仅展示手动操作项（例如手动移动的 3 项），不展开显示被动联动位移。',
        'en': 'Display layer: preview only shows explicit manual operations (for example, 3 moved items), and does not expand passive linked shifts.'
    },
    revertStrategyAuto: {
        'zh_CN': '自动模式',
        'en': 'Auto Mode'
    },
    revertStrategyManual: {
        'zh_CN': '手动模式',
        'en': 'Manual Mode'
    },
    revertStrategyPatch: {
        'zh_CN': '补丁撤销',
        'en': 'Patch Revert'
    },
    revertStrategyOverwrite: {
        'zh_CN': '覆盖撤销',
        'en': 'Overwrite Revert'
    },
    revertPatchDescription: {
        'zh_CN': '补丁撤销说明：仅按 ID 匹配；ID 匹配执行新增/删除/移动/修改，ID 不匹配时按删除/新增处理。',
        'en': 'Patch revert note: match by ID only; matching IDs support add/delete/move/modify, non-matching IDs are handled as delete/create.'
    },
    revertThresholdText: {
        'zh_CN': '智能阈值',
        'en': 'Smart Threshold'
    },
    revertThresholdTip: {
        'zh_CN': '智能模式下：变化占比 ≤ 阈值 走补丁撤销，> 阈值 走覆盖撤销。',
        'en': 'In Smart mode: uses patch when change ratio is ≤ threshold, otherwise overwrite.'
    },
    revertConfirm: {
        'zh_CN': '撤销',
        'en': 'Revert'
    },
    revertCancel: {
        'zh_CN': '取消',
        'en': 'Cancel'
    },
    emptyTree: {
        'zh_CN': '无法加载书签树',
        'en': 'Unable to load bookmark tree'
    },
    loading: {
        'zh_CN': '加载中...',
        'en': 'Loading...'
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
    bookmarkGitTitle: {
        'zh_CN': '书签备份',
        'en': 'Bookmark Backup'
    },
    // ==================== 导出变化功能翻译 ====================
    exportChangesModalTitle: {
        'zh_CN': '导出书签变化',
        'en': 'Export Bookmark Changes'
    },
    exportChangesFormatLabel: {
        'zh_CN': '导出格式',
        'en': 'Export Format'
    },
    exportChangesLegendHelp: {
        'zh_CN': '标记说明',
        'en': 'Legend'
    },
    exportChangesLegendTitle: {
        'zh_CN': '标记说明：',
        'en': 'Legend:'
    },
    exportChangesModeLabel: {
        'zh_CN': '导出模式',
        'en': 'Export Mode'
    },
    exportChangesModeSimple: {
        'zh_CN': '简略',
        'en': 'Simple'
    },
    exportChangesModeDetailed: {
        'zh_CN': '详细',
        'en': 'Detailed'
    },
    exportChangesModeCollection: {
        'zh_CN': '集合',
        'en': 'Collection'
    },
    exportChangesModeHelp: {
        'zh_CN': '模式说明',
        'en': 'Mode Help'
    },
    exportChangesActionLabel: {
        'zh_CN': '操作方式',
        'en': 'Action'
    },
    exportChangesActionDownload: {
        'zh_CN': '导出文件',
        'en': 'Download File'
    },
    exportChangesActionCopy: {
        'zh_CN': '复制到剪贴板',
        'en': 'Copy to Clipboard'
    },
    // ==================== 导出变化功能翻译 ====================
    exportChangesModalTitle: {
        'zh_CN': '导出书签变化',
        'en': 'Export Bookmark Changes'
    },
    exportChangesFormatLabel: {
        'zh_CN': '导出格式',
        'en': 'Export Format'
    },
    exportChangesLegendHelp: {
        'zh_CN': '标记说明',
        'en': 'Legend'
    },
    exportChangesLegendTitle: {
        'zh_CN': '标记说明：',
        'en': 'Legend:'
    },
    exportChangesModeLabel: {
        'zh_CN': '导出模式',
        'en': 'Export Mode'
    },
    exportChangesModeSimple: {
        'zh_CN': '简略',
        'en': 'Simple'
    },
    exportChangesModeDetailed: {
        'zh_CN': '详细',
        'en': 'Detailed'
    },
    exportChangesModeCollection: {
        'zh_CN': '集合',
        'en': 'Collection'
    },
    exportChangesModeHelp: {
        'zh_CN': '模式说明',
        'en': 'Mode Help'
    },
    exportChangesActionLabel: {
        'zh_CN': '操作方式',
        'en': 'Action'
    },
    exportChangesActionDownload: {
        'zh_CN': '导出文件',
        'en': 'Download File'
    },
    exportChangesActionCopy: {
        'zh_CN': '复制到剪贴板',
        'en': 'Copy to Clipboard'
    },
    exportChangesConfirmText: {
        'zh_CN': '确认',
        'en': 'Confirm'
    },
    exportChangesCancelText: {
        'zh_CN': '取消',
        'en': 'Cancel'
    },
    // 导出功能翻译
    };
window.i18n = i18n; // 暴露给其他模块使用

// =============================================================================
// 初始化
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('历史查看器初始化...');

    // ========================================================================
    // 【关键步骤 -1】检测是否需要清除 localStorage（"恢复到初始状态"功能触发）
    // ========================================================================
    try {
        const resetCheck = await new Promise(resolve => {
            browserAPI.storage.local.get(['needClearLocalStorage'], result => resolve(result));
        });

        if (resetCheck && resetCheck.needClearLocalStorage === true) {
            console.log('[初始化] 检测到重置标志，正在清除 localStorage...');

            // 清除当前页面上下文的所有 localStorage
            localStorage.clear();

            // 移除重置标志（避免重复清除）
            await new Promise(resolve => {
                browserAPI.storage.local.remove(['needClearLocalStorage'], resolve);
            });

            console.log('[初始化] localStorage 已清除，重置标志已移除');
        }
    } catch (error) {
        console.warn('[初始化] 检测重置标志时出错:', error);
    }

    // ========================================================================
    // [关键步骤 -0.5] 迁移并加载历史视图设置（WYSIWYG 展开状态）
    // ========================================================================
    try {
        await migrateHistoryViewSettingsFromLocalStorage();
        await loadHistoryViewSettings();
    } catch (error) {
        console.warn('[初始化] 加载历史视图设置失败:', error);
    }

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
    if (viewParam && ALLOWED_VIEWS.includes(viewParam)) {
        currentView = viewParam;
        console.log('[初始化] 从URL参数设置视图:', currentView);

        // 【关键】应用 URL 参数后，立即从 URL 中移除 view 参数
        // 这样刷新页面时就会使用 localStorage，实现持久化
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('view');
        window.history.replaceState({}, '', newUrl.toString());
        console.log('[初始化] 已从URL中移除view参数，刷新时将使用localStorage');
    } else {
        const lastView = localStorage.getItem('lastActiveView');
        if (lastView && ALLOWED_VIEWS.includes(lastView)) {
            currentView = lastView;
            console.log('[初始化] 从localStorage恢复视图:', currentView);
        } else {
            currentView = DEFAULT_VIEW;
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

    // [Search Context Boot] 首次加载时同步 SearchContextManager 的 view/tab/subTab。
    // 这里不能依赖 switchView()，因为初始化阶段是直接改 DOM 来显示视图。
    try {
        if (window.SearchContextManager && typeof window.SearchContextManager.updateContext === 'function') {
            window.SearchContextManager.updateContext(currentView);
        }
    } catch (_) { }

    // ========================================================================
    // 其他初始化
    // ========================================================================
    const recordTime = urlParams.get('record');
    const recordAction = (urlParams.get('action') || '').toLowerCase();
    console.log('[URL参数] 完整URL:', window.location.href);
    console.log('[URL参数] recordTime:', recordTime, 'viewParam:', viewParam);

    // 加载用户设置
    await loadUserSettings();

    // 确保搜索模式按钮与当前视图/语言一致（避免刷新后显示为默认英文）
    try {
        if (window.SearchContextManager && typeof window.SearchContextManager.updateContext === 'function') {
            window.SearchContextManager.updateContext(currentView);
        }
        if (typeof window.setSearchMode === 'function') {
            window.setSearchMode(currentView, { switchView: false });
        } else if (typeof window.syncSearchContextFromCurrentUI === 'function') {
            window.syncSearchContextFromCurrentUI('post-loadUserSettings');
        }
        if (typeof window.updateSearchUILanguage === 'function') {
            window.updateSearchUILanguage();
        }
    } catch (_) { }

    // 初始化 UI（此时currentView已经是正确的值）
    initializeUI();

    // 初始化侧边栏收起功能
    initSidebarToggle();

    // 初始化导出变化模态框
    initExportChangesModal();
    // 初始化全局导出功能
    initGlobalExport();

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

    await restoreExplicitMovedIdsFromStorage();

    // 先加载基础数据
    console.log('[初始化] 加载基础数据...');
    await loadAllData();

    if (currentView === 'history') {
        try {
            await refreshHistoryIndexPage({ page: currentHistoryPage });
        } catch (e) {
            console.warn('[初始化] 预加载历史分页索引失败，使用已有数据回退:', e);
        }
    }

    // 如果有 recordTime 参数，按 action 打开对应二级UI（在UI渲染之前）
    if (recordTime) {
        console.log('[初始化] 快速打开条目动作，recordTime:', recordTime, 'action:', recordAction || 'detail');
        const record = syncHistory.find(r => r.time == recordTime);
        if (record) {
            console.log('[初始化] 找到记录，立即打开动作面板');

            // 立即打开，不等待UI渲染
            setTimeout(() => {
                if (recordAction === 'restore') {
                    const displayTitle = record.note || formatTime(record.time);
                    handleRestoreRecord(record, displayTitle || null);
                    return;
                }

                if (recordAction === 'detail-search') {
                    showDetailModal(record, { openDetailSearch: true });
                    return;
                }

                showDetailModal(record);
            }, 0);

            // 清除 URL 中的 record 参数，避免刷新后再次弹出详情
            // 使用 replaceState 避免产生新的浏览历史记录
            try {
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete('record');
                cleanUrl.searchParams.delete('action');
                window.history.replaceState({}, '', cleanUrl.toString());
                console.log('[初始化] 已清除 URL 中的 record/action 参数');
            } catch (e) {
                console.warn('[初始化] 清除 record/action 参数失败:', e);
            }
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
                window.currentLang = currentLang; // 同步到 window
                console.log('[加载用户设置] 使用History Viewer的语言覆盖:', currentLang);
            } else {
                currentLang = mainUILang;
                window.currentLang = currentLang; // 同步到 window
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
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = i18n.pageTitle[currentLang];
    const subtitleEl = document.getElementById('pageSubtitle');
    if (subtitleEl) {
        const subtitleText = (i18n.pageSubtitle && i18n.pageSubtitle[currentLang]) ? i18n.pageSubtitle[currentLang] : '';
        subtitleEl.textContent = subtitleText;
        subtitleEl.style.display = subtitleText ? '' : 'none';
    }

    // 搜索框 placeholder：由 SearchContextManager 统一根据 view/tab/subTab 控制
    try {
        if (window.SearchContextManager && typeof window.SearchContextManager.updateUI === 'function') {
            window.SearchContextManager.updateUI();
        } else {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.placeholder = i18n.searchPlaceholder[currentLang];
        }
    } catch (_) { }

    const navCurrentChangesText = document.getElementById('navCurrentChangesText');
    if (navCurrentChangesText) navCurrentChangesText.textContent = i18n.navCurrentChanges[currentLang];
    const navHistoryText = document.getElementById('navHistoryText');
    if (navHistoryText) navHistoryText.textContent = i18n.navHistory[currentLang];
    const bookmarkGitTitle = document.getElementById('bookmarkGitTitle');
    if (bookmarkGitTitle) bookmarkGitTitle.textContent = i18n.bookmarkGitTitle[currentLang];

    // 工具按钮提示
    const refreshTooltip = document.getElementById('refreshTooltip');
    if (refreshTooltip) refreshTooltip.textContent = i18n.refreshTooltip[currentLang];
    const themeTooltip = document.getElementById('themeTooltip');
    if (themeTooltip) themeTooltip.textContent = i18n.themeTooltip[currentLang];
    const langTooltip = document.getElementById('langTooltip');
    if (langTooltip) langTooltip.textContent = i18n.langTooltip[currentLang];
    const helpTooltip = document.getElementById('helpTooltip');
    if (helpTooltip) helpTooltip.textContent = i18n.helpTooltip[currentLang];

    // 快捷键信息
    const shortcutsModalTitle = document.getElementById('shortcutsModalTitle');
    if (shortcutsModalTitle) shortcutsModalTitle.textContent = i18n.shortcutsModalTitle[currentLang];
    const openSourceGithubLabel = document.getElementById('openSourceGithubLabel');
    if (openSourceGithubLabel) openSourceGithubLabel.textContent = i18n.openSourceGithubLabel[currentLang];
    const openSourceIssueLabel = document.getElementById('openSourceIssueLabel');
    if (openSourceIssueLabel) openSourceIssueLabel.textContent = i18n.openSourceIssueLabel[currentLang];
    const openSourceIssueText = document.getElementById('openSourceIssueText');
    if (openSourceIssueText) openSourceIssueText.textContent = i18n.openSourceIssueText[currentLang];
    const shortcutsContent = document.getElementById('shortcutsContent');
    if (shortcutsContent) {
        try { updateShortcutsDisplay(); } catch (_) { }
    }
    const closeShortcutsText = document.getElementById('closeShortcutsText');
    if (closeShortcutsText) closeShortcutsText.textContent = i18n.closeShortcutsText[currentLang];

    const currentChangesViewTitle = document.getElementById('currentChangesViewTitle');
    if (currentChangesViewTitle) currentChangesViewTitle.textContent = i18n.currentChangesViewTitle[currentLang];
    const historyViewTitle = document.getElementById('historyViewTitle');
    if (historyViewTitle) historyViewTitle.textContent = i18n.historyViewTitle[currentLang];

    // 备份历史：清除记录按钮与确认弹窗
    const clearBackupHistoryBtn = document.getElementById('clearBackupHistoryBtn');
    if (clearBackupHistoryBtn) {
        clearBackupHistoryBtn.setAttribute('data-title', i18n.clearBackupHistoryTooltip[currentLang]);
        clearBackupHistoryBtn.removeAttribute('title');
    }
    const clearBackupHistoryModalTitle = document.getElementById('clearBackupHistoryModalTitle');
    if (clearBackupHistoryModalTitle) clearBackupHistoryModalTitle.textContent = i18n.clearBackupHistoryModalTitle[currentLang];
    const clearBackupHistoryModalDesc = document.getElementById('clearBackupHistoryModalDesc');
    if (clearBackupHistoryModalDesc) clearBackupHistoryModalDesc.textContent = i18n.clearBackupHistoryModalDesc[currentLang];

    // 删除选项控件
    const clearHistoryModePercentLabel = document.getElementById('clearHistoryModePercentLabel');
    if (clearHistoryModePercentLabel) clearHistoryModePercentLabel.textContent = i18n.clearHistoryModePercentLabel[currentLang];
    const clearHistoryModeCountLabel = document.getElementById('clearHistoryModeCountLabel');
    if (clearHistoryModeCountLabel) clearHistoryModeCountLabel.textContent = i18n.clearHistoryModeCountLabel[currentLang];
    const clearHistoryPercentLabelBefore = document.getElementById('clearHistoryPercentLabelBefore');
    if (clearHistoryPercentLabelBefore) clearHistoryPercentLabelBefore.textContent = i18n.clearHistoryPercentLabelBefore[currentLang];
    const clearHistoryCountLabelBefore = document.getElementById('clearHistoryCountLabelBefore');
    if (clearHistoryCountLabelBefore) clearHistoryCountLabelBefore.textContent = i18n.clearHistoryCountLabelBefore[currentLang];
    const clearHistoryCountLabelAfter = document.getElementById('clearHistoryCountLabelAfter');
    if (clearHistoryCountLabelAfter) clearHistoryCountLabelAfter.textContent = i18n.clearHistoryCountLabelAfter[currentLang];

    const clearBackupHistoryCancelBtn = document.getElementById('clearBackupHistoryCancelBtn');
    if (clearBackupHistoryCancelBtn) clearBackupHistoryCancelBtn.textContent = i18n.clearBackupHistoryCancelBtn[currentLang];
    const clearBackupHistoryConfirmBtn = document.getElementById('clearBackupHistoryConfirmBtn');
    if (clearBackupHistoryConfirmBtn) clearBackupHistoryConfirmBtn.textContent = i18n.clearBackupHistoryConfirmBtn[currentLang];

    // 二次确认弹窗
    const clearHistorySecondConfirmTitle = document.getElementById('clearHistorySecondConfirmTitle');
    if (clearHistorySecondConfirmTitle) clearHistorySecondConfirmTitle.textContent = i18n.clearHistorySecondConfirmTitle[currentLang];
    const clearHistorySecondConfirmPrefix = document.getElementById('clearHistorySecondConfirmPrefix');
    if (clearHistorySecondConfirmPrefix) clearHistorySecondConfirmPrefix.textContent = i18n.clearHistorySecondConfirmPrefix[currentLang];
    const clearHistorySecondConfirmSuffix = document.getElementById('clearHistorySecondConfirmSuffix');
    if (clearHistorySecondConfirmSuffix) clearHistorySecondConfirmSuffix.textContent = i18n.clearHistorySecondConfirmSuffix[currentLang];
    const clearHistorySecondConfirmWarning = document.getElementById('clearHistorySecondConfirmWarning');
    if (clearHistorySecondConfirmWarning) clearHistorySecondConfirmWarning.textContent = i18n.clearHistorySecondConfirmWarning[currentLang];
    const clearHistoryExportFirstText = document.getElementById('clearHistoryExportFirstText');
    if (clearHistoryExportFirstText) clearHistoryExportFirstText.textContent = i18n.clearHistoryExportFirstBtn[currentLang];
    const clearHistoryDirectDeleteText = document.getElementById('clearHistoryDirectDeleteText');
    if (clearHistoryDirectDeleteText) clearHistoryDirectDeleteText.textContent = i18n.clearHistoryDirectDeleteBtn[currentLang];
    const clearHistorySecondConfirmCancelText = document.getElementById('clearHistorySecondConfirmCancelText');
    if (clearHistorySecondConfirmCancelText) clearHistorySecondConfirmCancelText.textContent = i18n.clearHistorySecondConfirmCancelBtn[currentLang];

    // 备份历史详略模式切换按钮
    const historyDetailModeSimpleText = document.getElementById('historyDetailModeSimpleText');
    if (historyDetailModeSimpleText) historyDetailModeSimpleText.textContent = i18n.historyDetailModeSimple[currentLang];
    const historyDetailModeDetailedText = document.getElementById('historyDetailModeDetailedText');
    if (historyDetailModeDetailedText) historyDetailModeDetailedText.textContent = i18n.historyDetailModeDetailed[currentLang];
    const historyDetailModeSimpleModalText = document.getElementById('historyDetailModeSimpleModalText');
    if (historyDetailModeSimpleModalText) historyDetailModeSimpleModalText.textContent = i18n.historyDetailModeSimple[currentLang];
    const historyDetailModeDetailedModalText = document.getElementById('historyDetailModeDetailedModalText');
    if (historyDetailModeDetailedModalText) historyDetailModeDetailedModalText.textContent = i18n.historyDetailModeDetailed[currentLang];

    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = i18n.modalTitle[currentLang];
    const detailExportChangesBtn = document.getElementById('detailExportChangesBtn');
    if (detailExportChangesBtn) {
        detailExportChangesBtn.title = currentLang === 'zh_CN' ? '导出变化' : 'Export Changes';
    }

    const globalExportBtn = document.getElementById('globalExportBtn');
    if (globalExportBtn) {
        globalExportBtn.setAttribute('data-title', i18n.globalExport[currentLang]);
        globalExportBtn.removeAttribute('title');
    }
    const globalExportModalTitle = document.getElementById('globalExportModalTitle');
    if (globalExportModalTitle) globalExportModalTitle.textContent = i18n.globalExportModalTitle[currentLang];
    const globalExportFormatTitle = document.getElementById('globalExportFormatTitle');
    if (globalExportFormatTitle) globalExportFormatTitle.textContent = i18n.globalExportFormatTitle[currentLang];
    const globalExportFormatHint = document.getElementById('globalExportFormatHint');
    if (globalExportFormatHint) globalExportFormatHint.textContent = i18n.globalExportFormatHint[currentLang];
    const globalExportPackTitle = document.getElementById('globalExportPackTitle');
    if (globalExportPackTitle) globalExportPackTitle.textContent = i18n.globalExportPackTitle[currentLang];
    const globalExportPackZipText = document.getElementById('globalExportPackZipText');
    if (globalExportPackZipText) globalExportPackZipText.textContent = i18n.globalExportPackZip[currentLang];
    const globalExportPackMergeText = document.getElementById('globalExportPackMergeText');
    if (globalExportPackMergeText) globalExportPackMergeText.textContent = i18n.globalExportPackMerge[currentLang];
    const globalExportPackHint = document.getElementById('globalExportPackHint');
    if (globalExportPackHint) globalExportPackHint.innerHTML = i18n.globalExportPackHint[currentLang];
    const globalExportSelectTitle = document.getElementById('globalExportSelectTitle');
    if (globalExportSelectTitle) globalExportSelectTitle.textContent = i18n.globalExportSelectTitle[currentLang];
    const globalExportRangeEnabledText = document.getElementById('globalExportRangeEnabledText');
    if (globalExportRangeEnabledText) globalExportRangeEnabledText.textContent = i18n.globalExportRangeEnabledText[currentLang];
    const globalExportThSeq = document.getElementById('globalExportThSeq');
    if (globalExportThSeq) globalExportThSeq.textContent = i18n.globalExportThSeq[currentLang];
    const globalExportThNote = document.getElementById('globalExportThNote');
    if (globalExportThNote) globalExportThNote.textContent = i18n.globalExportThNote[currentLang];
    const globalExportThHash = document.getElementById('globalExportThHash');
    if (globalExportThHash) globalExportThHash.textContent = i18n.globalExportThHash[currentLang];
    const globalExportThViewMode = document.getElementById('globalExportThViewMode');
    if (globalExportThViewMode) globalExportThViewMode.textContent = i18n.globalExportThViewMode[currentLang];
    const globalExportThTime = document.getElementById('globalExportThTime');
    if (globalExportThTime) globalExportThTime.textContent = i18n.globalExportThTime[currentLang];
    const globalExportCancelBtn = document.getElementById('globalExportCancelBtn');
    if (globalExportCancelBtn) globalExportCancelBtn.textContent = i18n.globalExportCancel[currentLang];
    const globalExportConfirmText = document.getElementById('globalExportConfirmText');
    if (globalExportConfirmText) globalExportConfirmText.textContent = i18n.globalExportConfirm[currentLang];
    const globalExportStatus = document.getElementById('globalExportStatus');
    if (globalExportStatus) {
        try {
            updateGlobalExportStatus();
            updateGlobalExportRangePreviewText();
        } catch (_) { }
    }

    // 导出书签变化模态框
    const exportChangesModalTitle = document.getElementById('exportChangesModalTitle');
    if (exportChangesModalTitle) exportChangesModalTitle.textContent = i18n.exportChangesModalTitle[currentLang];
    const exportChangesFormatLabel = document.getElementById('exportChangesFormatLabel');
    if (exportChangesFormatLabel) exportChangesFormatLabel.textContent = i18n.exportChangesFormatLabel[currentLang];
    const exportChangesLegendHelp = document.getElementById('exportChangesLegendHelp');
    if (exportChangesLegendHelp) exportChangesLegendHelp.title = i18n.exportChangesLegendHelp[currentLang];
    const exportChangesLegendTitle = document.getElementById('exportChangesLegendTitle');
    if (exportChangesLegendTitle) exportChangesLegendTitle.textContent = i18n.exportChangesLegendTitle[currentLang];
    const exportChangesModeLabel = document.getElementById('exportChangesModeLabel');
    if (exportChangesModeLabel) exportChangesModeLabel.textContent = i18n.exportChangesModeLabel[currentLang];
    const exportChangesModeSimple = document.getElementById('exportChangesModeSimple');
    if (exportChangesModeSimple) exportChangesModeSimple.textContent = i18n.exportChangesModeSimple[currentLang];
    const exportChangesModeDetailed = document.getElementById('exportChangesModeDetailed');
    if (exportChangesModeDetailed) exportChangesModeDetailed.textContent = i18n.exportChangesModeDetailed[currentLang];
    const exportChangesModeCollection = document.getElementById('exportChangesModeCollection');
    if (exportChangesModeCollection) exportChangesModeCollection.textContent = i18n.exportChangesModeCollection[currentLang];
    const exportChangesModeHelp = document.getElementById('exportChangesDetailedHelp');
    if (exportChangesModeHelp) exportChangesModeHelp.title = i18n.exportChangesModeHelp[currentLang];
    const exportChangesActionLabel = document.getElementById('exportChangesActionLabel');
    if (exportChangesActionLabel) exportChangesActionLabel.textContent = i18n.exportChangesActionLabel[currentLang];
    const exportChangesActionDownload = document.getElementById('exportChangesActionDownload');
    if (exportChangesActionDownload) exportChangesActionDownload.textContent = i18n.exportChangesActionDownload[currentLang];
    const exportChangesActionCopy = document.getElementById('exportChangesActionCopy');
    if (exportChangesActionCopy) exportChangesActionCopy.textContent = i18n.exportChangesActionCopy[currentLang];
    const exportChangesConfirmText = document.getElementById('exportChangesConfirmText');
    if (exportChangesConfirmText) exportChangesConfirmText.textContent = i18n.exportChangesConfirmText[currentLang];
    const exportChangesCancelText = document.getElementById('exportChangesCancelText');
    if (exportChangesCancelText) exportChangesCancelText.textContent = i18n.exportChangesCancelText[currentLang];
}


// =============================================================================
// UI 初始化
// =============================================================================

function initializeUI() {
    // 导航标签切换
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });


    // 工具按钮

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

    // 初始化历史列表分页
    initHistoryPagination();


    // 初始化书签树映射预览的交互
    initChangesTreePreview();

    // 搜索
    const searchInputEl = document.getElementById('searchInput');
    if (searchInputEl && !searchInputEl.hasAttribute('data-search-bound')) {
        searchInputEl.addEventListener('input', handleSearch);
        // Phase 1 & 2：支持键盘选择结果（↑/↓/Enter/Esc）
        searchInputEl.addEventListener('keydown', handleSearchKeydown);
        // Phase 1 & 2：点击搜索框时重新显示候选列表
        searchInputEl.addEventListener('focus', handleSearchInputFocus);
        searchInputEl.setAttribute('data-search-bound', 'true');
    }

    const searchResultsPanel = document.getElementById('searchResultsPanel');
    if (searchResultsPanel && !searchResultsPanel.hasAttribute('data-search-bound')) {
        searchResultsPanel.addEventListener('click', handleSearchResultsPanelClick);
        searchResultsPanel.addEventListener('mouseover', handleSearchResultsPanelMouseOver);
        searchResultsPanel.setAttribute('data-search-bound', 'true');
    }

    if (!document.documentElement.hasAttribute('data-search-outside-bound')) {
        document.addEventListener('click', handleSearchOutsideClick, true);
        document.documentElement.setAttribute('data-search-outside-bound', 'true');
    }

    // 弹窗关闭
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('detailModal').addEventListener('click', (e) => {
        if (e.target.id === 'detailModal') closeModal();
    });

    // 清空备份历史
    initClearBackupHistoryModal();

    // 注意：不再在这里调用 updateUIForCurrentView()，因为已经在 DOMContentLoaded 早期调用了 applyViewState()

    // 初始化备份历史详情模式切换按钮
    initHistoryDetailModeToggle();
    initDetailModalActions();

    console.log('[initializeUI] UI事件监听器初始化完成，当前视图:', currentView);
}

function clearBackupHistoryRecordsInBackground() {
    return new Promise((resolve) => {
        try {
            browserAPI.runtime.sendMessage({ action: "clearSyncHistory" }, (response) => {
                if (browserAPI.runtime.lastError) {
                    resolve({ success: false, error: browserAPI.runtime.lastError.message });
                    return;
                }
                resolve(response || { success: false, error: 'no response' });
            });
        } catch (error) {
            resolve({ success: false, error: error?.message || String(error) });
        }
    });
}

function initClearBackupHistoryModal() {
    const btn = document.getElementById('clearBackupHistoryBtn');
    const modal = document.getElementById('clearBackupHistoryModal');
    const closeBtn = document.getElementById('clearBackupHistoryModalClose');
    const cancelBtn = document.getElementById('clearBackupHistoryCancelBtn');
    const confirmBtn = document.getElementById('clearBackupHistoryConfirmBtn');

    // 二次确认弹窗
    const secondModal = document.getElementById('clearHistorySecondConfirmModal');
    const secondCloseBtn = document.getElementById('clearHistorySecondConfirmClose');
    const secondCancelBtn = document.getElementById('clearHistorySecondConfirmCancelBtn');
    const exportFirstBtn = document.getElementById('clearHistoryExportFirstBtn');
    const directDeleteBtn = document.getElementById('clearHistoryDirectDeleteBtn');
    const deleteCountDisplay = document.getElementById('clearHistoryDeleteCountDisplay');
    const rangeDisplay = document.getElementById('clearHistoryRangeDisplay');

    // 双滑块范围选择器
    const rangeMinSlider = document.getElementById('clearHistoryRangeMin');
    const rangeMaxSlider = document.getElementById('clearHistoryRangeMax');
    const rangeHighlight = document.getElementById('clearHistoryRangeHighlight');
    const minSeqLabel = document.getElementById('clearHistoryMinSeqLabel');
    const maxSeqLabel = document.getElementById('clearHistoryMaxSeqLabel');
    const selectionRange = document.getElementById('clearHistorySelectionRange');
    const selectionCount = document.getElementById('clearHistorySelectionCount');
    const selectionLabel = document.getElementById('clearHistorySelectionLabel');
    const previewTextEl = document.getElementById('clearHistoryPreviewText');

    if (!btn || !modal || !confirmBtn) return;

    // 存储当前要删除的范围
    let pendingDeleteMinSeq = 1;
    let pendingDeleteMaxSeq = 1;
    let pendingDeleteCount = 0;
    let clearHistoryActiveThumb = 'max'; // 'min' | 'max'

    // 获取记录的序号列表（按时间排序，最旧的在前）
    const getRecordSeqNumbers = () => {
        if (!syncHistory || syncHistory.length === 0) return [];
        return syncHistory.map((record, index) => {
            return record.seqNumber || (index + 1);
        });
    };

    // 获取序号范围
    const getSeqRange = () => {
        const seqNumbers = getRecordSeqNumbers();
        if (seqNumbers.length === 0) return { min: 1, max: 1 };
        return {
            min: Math.min(...seqNumbers),
            max: Math.max(...seqNumbers)
        };
    };

    // 更新滑块范围高亮
    const updateRangeHighlight = () => {
        if (!rangeHighlight || !rangeMinSlider || !rangeMaxSlider) return;

        const min = parseInt(rangeMinSlider.min, 10);
        const max = parseInt(rangeMinSlider.max, 10);
        const range = Math.max(1, max - min);

        const a = parseInt(rangeMinSlider.value, 10);
        const b = parseInt(rangeMaxSlider.value, 10);
        const low = Math.min(a, b);
        const high = Math.max(a, b);

        // Reverse logic: Max is on Left (0%), Min is on Right (100%)
        // Input logic (flipped by CSS scaleX(-1)):
        // Input Min (visual right) -> Input Max (visual left)
        // High Value should be at Left. Low Value should be at Right.
        // CSS transform: scaleX(-1) on inputs flips them so Left is Max.
        // So Highlight Logic:
        // Left Edge = Position of MaxVal. Right Edge = Position of MinVal.

        // Let's rely on standard logic but realizing the container is NOT flipped, only tracks/inputs.
        // Wait, if track is flipped, highlight inside it is also flipped.
        // So standard logic applies relative to the flipped coordinate system!
        // Min (1) -> 0% (Visual Right). Max (50) -> 50% (visual Mid).
        // Highlight: 0% to 50%.
        // So visual bar: Right Edge -> Mid. This covers 1 to 50. CORRECT.

        const leftPercent = ((low - min) / range) * 100;
        const widthPercent = ((high - low) / range) * 100;

        rangeHighlight.style.left = `${leftPercent}%`;
        rangeHighlight.style.width = `${widthPercent}%`;

        updateClearHistoryRangeBubbles();
    };

    const updateClearHistoryRangeBubbles = () => {
        const minBubble = document.getElementById('clearHistoryRangeMinBubble');
        const maxBubble = document.getElementById('clearHistoryRangeMaxBubble');
        const container = document.getElementById('clearHistoryRangeContainer');
        if (!rangeMinSlider || !rangeMaxSlider || !minBubble || !maxBubble || !container) return;

        const min = parseInt(rangeMinSlider.min, 10);
        const max = parseInt(rangeMinSlider.max, 10);
        const range = Math.max(1, max - min);

        const a = parseInt(rangeMinSlider.value, 10);
        const b = parseInt(rangeMaxSlider.value, 10);

        const aPercent = ((a - min) / range) * 100;
        const bPercent = ((b - min) / range) * 100;

        const insetPx = 10;
        const thumbSizePx = 20;
        const thumbHalfPx = thumbSizePx / 2;
        const trackWidthPx = Math.max(1, container.clientWidth - insetPx * 2);
        const effectiveWidthPx = Math.max(0, trackWidthPx - thumbSizePx);

        // Inputs are flipped (scaleX(-1)), so visual position is mirrored.
        const ax = insetPx + thumbHalfPx + (1 - (aPercent / 100)) * effectiveWidthPx;
        const bx = insetPx + thumbHalfPx + (1 - (bPercent / 100)) * effectiveWidthPx;

        minBubble.style.left = `${ax}px`;
        maxBubble.style.left = `${bx}px`;
        minBubble.textContent = String(a);
        maxBubble.textContent = String(b);

        const overlapThresholdPx = 14;
        const overlap = Math.abs(ax - bx) <= overlapThresholdPx;
        if (overlap) {
            if (clearHistoryActiveThumb === 'min') {
                minBubble.style.opacity = '1';
                minBubble.style.zIndex = '7';
                maxBubble.style.opacity = '0';
                maxBubble.style.zIndex = '6';
            } else {
                maxBubble.style.opacity = '1';
                maxBubble.style.zIndex = '7';
                minBubble.style.opacity = '0';
                minBubble.style.zIndex = '6';
            }
        } else {
            minBubble.style.opacity = '1';
            maxBubble.style.opacity = '1';
            minBubble.style.zIndex = '6';
            maxBubble.style.zIndex = '6';
        }
    };

    // 计算要删除的记录数量（根据序号范围）
    const calculateDeleteCount = () => {
        if (!rangeMinSlider || !rangeMaxSlider) return 0;

        const a = parseInt(rangeMinSlider.value, 10);
        const b = parseInt(rangeMaxSlider.value, 10);
        const minSeq = Math.min(a, b);
        const maxSeq = Math.max(a, b);

        // 统计在范围内的记录数
        const seqNumbers = getRecordSeqNumbers();
        let count = 0;
        for (const seq of seqNumbers) {
            if (seq >= minSeq && seq <= maxSeq) {
                count++;
            }
        }
        return count;
    };

    // 获取将要删除的序号范围字符串
    const getDeleteSeqRange = () => {
        if (!rangeMinSlider || !rangeMaxSlider) return '';
        const a = parseInt(rangeMinSlider.value, 10);
        const b = parseInt(rangeMaxSlider.value, 10);
        const minSeq = Math.min(a, b);
        const maxSeq = Math.max(a, b);
        if (minSeq === maxSeq) return String(minSeq);
        return `${minSeq}-${maxSeq}`;
    };

    // 更新显示
    const updateDisplay = () => {
        if (!rangeMinSlider || !rangeMaxSlider) return;

        const a = parseInt(rangeMinSlider.value, 10);
        const b = parseInt(rangeMaxSlider.value, 10);
        const minSeq = Math.min(a, b);
        const maxSeq = Math.max(a, b);
        const deleteCount = calculateDeleteCount();
        const total = syncHistory.length;

        // 隐藏原来的中间显示区域
        if (selectionRange && selectionRange.parentElement && selectionRange.parentElement.parentElement) {
            selectionRange.parentElement.parentElement.style.display = 'none';
        }

        // 更新预览文本 - 替换为用户要求的格式
        if (previewTextEl) {
            const seqRangeStr = minSeq === maxSeq ? String(minSeq) : `${minSeq}-${maxSeq}`;

            if (currentLang === 'en') {
                previewTextEl.textContent = `Will delete No. ${seqRangeStr} (${deleteCount} records)`;
            } else {
                // 用户要求的格式：「即将删除 2 条记录 (序号 4-5)」
                previewTextEl.textContent = `即将删除 ${deleteCount} 条记录 (序号 ${seqRangeStr})`;
            }
        }

        // 更新高亮
        updateRangeHighlight();
    };

    // 滑块事件处理 - 确保最小值不超过最大值
    const handleMinChange = () => {
        if (!rangeMinSlider || !rangeMaxSlider) return;
        clearHistoryActiveThumb = 'min';
        updateDisplay();
    };

    const handleMaxChange = () => {
        if (!rangeMinSlider || !rangeMaxSlider) return;
        clearHistoryActiveThumb = 'max';
        updateDisplay();
    };

    const openClearModal = () => {
        const seqRange = getSeqRange();
        const total = syncHistory.length;

        // 设置滑块范围
        if (rangeMinSlider) {
            rangeMinSlider.min = seqRange.min;
            rangeMinSlider.max = seqRange.max;
            rangeMinSlider.value = seqRange.min; // 起始从最小序号开始
        }
        if (rangeMaxSlider) {
            rangeMaxSlider.min = seqRange.min;
            rangeMaxSlider.max = seqRange.max;
            // 默认选中约50%的最旧记录
            const defaultMaxSeq = seqRange.min + Math.floor((seqRange.max - seqRange.min) / 2);
            rangeMaxSlider.value = Math.max(seqRange.min, defaultMaxSeq);
        }

        // 设置刻度标签 - Largest on Left
        if (minSeqLabel) minSeqLabel.textContent = String(seqRange.max); // Left Label = Max
        if (maxSeqLabel) maxSeqLabel.textContent = String(seqRange.min); // Right Label = Min

        modal.classList.add('show');
        // Must update after the modal is visible; otherwise container width can be 0 and bubbles won't render.
        requestAnimationFrame(() => {
            try {
                updateDisplay();
            } catch (e) {
                // ignore
            }
            requestAnimationFrame(() => {
                try {
                    updateDisplay();
                } catch (e) {
                    // ignore
                }
            });
        });
    };

    const closeClearModal = () => modal.classList.remove('show');

    const openSecondConfirmModal = () => {
        if (!rangeMinSlider || !rangeMaxSlider) return;

        const a = parseInt(rangeMinSlider.value, 10);
        const b = parseInt(rangeMaxSlider.value, 10);
        pendingDeleteMinSeq = Math.min(a, b);
        pendingDeleteMaxSeq = Math.max(a, b);
        pendingDeleteCount = calculateDeleteCount();

        if (deleteCountDisplay) {
            deleteCountDisplay.textContent = pendingDeleteCount;
        }
        if (rangeDisplay) {
            const seqRangeStr = pendingDeleteMinSeq === pendingDeleteMaxSeq
                ? String(pendingDeleteMinSeq)
                : `${pendingDeleteMinSeq}-${pendingDeleteMaxSeq}`;

            rangeDisplay.textContent = currentLang === 'en'
                ? `(No. ${seqRangeStr})`
                : `(序号 ${seqRangeStr})`;
        }
        if (secondModal) {
            secondModal.classList.add('show');
        }
    };

    const closeSecondConfirmModal = () => {
        if (secondModal) {
            secondModal.classList.remove('show');
        }
    };

    // 执行实际删除
    const executeDelete = async () => {
        if (pendingDeleteCount <= 0) {
            closeSecondConfirmModal();
            closeClearModal();
            return;
        }

        if (directDeleteBtn) directDeleteBtn.disabled = true;
        try {
            // 按序号范围删除（支持删除最新/中间/最旧；不重排其它记录的永久序号）
            const timesToDelete = [];
            const fingerprintsToDelete = [];
            for (let i = 0; i < syncHistory.length; i++) {
                const record = syncHistory[i];
                const seq = record.seqNumber || (i + 1);
                if (seq >= pendingDeleteMinSeq && seq <= pendingDeleteMaxSeq) {
                    if (record.fingerprint) fingerprintsToDelete.push(record.fingerprint);
                    else timesToDelete.push(record.time);
                }
            }

            const resp = await deleteBackupHistoryItems({ fingerprintsToDelete, timesToDelete });
            closeSecondConfirmModal();
            closeClearModal();

            if (resp && resp.success) {
                const deletedCount = resp.deleted || pendingDeleteCount;

                // 从 storage 重新获取数据以确保一致性
                try {
                    const data = await new Promise(resolve => {
                        browserAPI.storage.local.get(['syncHistory'], result => {
                            resolve(result);
                        });
                    });
                    syncHistory = data.syncHistory || [];
                } catch (e) {
                    console.warn('[executeDelete] Failed to reload syncHistory');
                    syncHistory = syncHistory.slice(deletedCount);
                }

                try {
                    renderHistoryView();
                } catch (e) {
                    console.warn('[executeDelete] renderHistoryView failed:', e);
                }

                const successTextFunc = i18n.clearBackupHistorySuccess[currentLang];
                const successMsg = typeof successTextFunc === 'function'
                    ? successTextFunc(deletedCount)
                    : `已删除 ${deletedCount} 条历史记录`;
                showToast(successMsg);
            } else {
                console.error('[executeDelete] Delete failed:', resp);
                showToast(i18n.clearBackupHistoryFailed[currentLang]);
            }
        } finally {
            if (directDeleteBtn) directDeleteBtn.disabled = false;
        }
    };

    const deleteBackupHistoryItems = ({ fingerprintsToDelete, timesToDelete }) => {
        const fp = Array.isArray(fingerprintsToDelete) ? fingerprintsToDelete : [];
        const ts = Array.isArray(timesToDelete) ? timesToDelete : [];
        return new Promise((resolve) => {
            try {
                if (fp.length > 0) {
                    browserAPI.runtime.sendMessage({ action: 'deleteSyncHistoryItems', fingerprints: fp }, (response) => {
                        if (browserAPI.runtime.lastError) {
                            resolve({ success: false, error: browserAPI.runtime.lastError.message });
                            return;
                        }
                        resolve(response || { success: true, deleted: fp.length });
                    });
                    return;
                }

                if (ts.length > 0) {
                    browserAPI.runtime.sendMessage({ action: 'deleteSyncHistoryItemsByTime', times: ts }, (response) => {
                        if (browserAPI.runtime.lastError) {
                            resolve({ success: false, error: browserAPI.runtime.lastError.message });
                            return;
                        }
                        resolve(response || { success: true, deleted: ts.length });
                    });
                    return;
                }

                resolve({ success: true, deleted: 0 });
            } catch (e) {
                resolve({ success: false, error: e?.message || String(e) });
            }
        });
    };

    // 事件绑定 - 主弹窗
    if (!btn.hasAttribute('data-listener-attached')) {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            openClearModal();
        });
        btn.setAttribute('data-listener-attached', 'true');
    }

    if (closeBtn && !closeBtn.hasAttribute('data-listener-attached')) {
        closeBtn.addEventListener('click', closeClearModal);
        closeBtn.setAttribute('data-listener-attached', 'true');
    }

    if (cancelBtn && !cancelBtn.hasAttribute('data-listener-attached')) {
        cancelBtn.addEventListener('click', closeClearModal);
        cancelBtn.setAttribute('data-listener-attached', 'true');
    }

    if (!modal.hasAttribute('data-listener-attached')) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeClearModal();
        });
        modal.setAttribute('data-listener-attached', 'true');
    }

    // 双滑块事件
    if (rangeMinSlider && !rangeMinSlider.hasAttribute('data-listener-attached')) {
        rangeMinSlider.addEventListener('input', handleMinChange);
        rangeMinSlider.addEventListener('pointerdown', () => {
            clearHistoryActiveThumb = 'min';
            rangeMinSlider.style.zIndex = '5';
            rangeMaxSlider.style.zIndex = '4';
        });
        rangeMinSlider.setAttribute('data-listener-attached', 'true');
    }
    if (rangeMaxSlider && !rangeMaxSlider.hasAttribute('data-listener-attached')) {
        rangeMaxSlider.addEventListener('input', handleMaxChange);
        rangeMaxSlider.addEventListener('pointerdown', () => {
            clearHistoryActiveThumb = 'max';
            rangeMaxSlider.style.zIndex = '5';
            rangeMinSlider.style.zIndex = '4';
        });
        rangeMaxSlider.setAttribute('data-listener-attached', 'true');
    }

    // 确认删除按钮 - 打开二次确认弹窗
    if (!confirmBtn.hasAttribute('data-listener-attached')) {
        confirmBtn.addEventListener('click', () => {
            const toDelete = calculateDeleteCount();
            if (toDelete <= 0) {
                closeClearModal();
                return;
            }
            // 打开二次确认弹窗（不需要传参，函数会直接读取滑块值）
            openSecondConfirmModal();
        });
        confirmBtn.setAttribute('data-listener-attached', 'true');
    }

    // 事件绑定 - 二次确认弹窗
    if (secondCloseBtn && !secondCloseBtn.hasAttribute('data-listener-attached')) {
        secondCloseBtn.addEventListener('click', closeSecondConfirmModal);
        secondCloseBtn.setAttribute('data-listener-attached', 'true');
    }

    if (secondCancelBtn && !secondCancelBtn.hasAttribute('data-listener-attached')) {
        secondCancelBtn.addEventListener('click', closeSecondConfirmModal);
        secondCancelBtn.setAttribute('data-listener-attached', 'true');
    }

    if (secondModal && !secondModal.hasAttribute('data-listener-attached')) {
        secondModal.addEventListener('click', (e) => {
            if (e.target === secondModal) closeSecondConfirmModal();
        });
        secondModal.setAttribute('data-listener-attached', 'true');
    }

    // "先备份"按钮 - 跳转到全局导出
    if (exportFirstBtn && !exportFirstBtn.hasAttribute('data-listener-attached')) {
        exportFirstBtn.addEventListener('click', () => {
            closeSecondConfirmModal();
            closeClearModal();

            // 延迟打开全局导出弹窗，并预选要删除的记录（根据序号范围）
            setTimeout(() => {
                showGlobalExportModalWithPreselectionBySeqRange(pendingDeleteMinSeq, pendingDeleteMaxSeq);
            }, 100);
        });
        exportFirstBtn.setAttribute('data-listener-attached', 'true');
    }

    // "直接删除"按钮
    if (directDeleteBtn && !directDeleteBtn.hasAttribute('data-listener-attached')) {
        directDeleteBtn.addEventListener('click', executeDelete);
        directDeleteBtn.setAttribute('data-listener-attached', 'true');
    }
}

// 部分删除备份历史记录
function clearBackupHistoryPartial(deleteCount) {
    return new Promise((resolve) => {
        try {
            console.log('[clearBackupHistoryPartial] Sending request to delete', deleteCount, 'records');

            // 确保 deleteCount 是数字
            const count = parseInt(deleteCount, 10);
            if (isNaN(count) || count <= 0) {
                console.warn('[clearBackupHistoryPartial] Invalid deleteCount:', deleteCount);
                resolve({ success: true, deleted: 0 });
                return;
            }

            browserAPI.runtime.sendMessage({
                action: "clearSyncHistoryPartial",
                deleteCount: count
            }, (response) => {
                if (browserAPI.runtime.lastError) {
                    console.error('[clearBackupHistoryPartial] Runtime error:', browserAPI.runtime.lastError);
                    resolve({ success: false, error: browserAPI.runtime.lastError.message });
                    return;
                }

                console.log('[clearBackupHistoryPartial] Response:', response);

                if (!response) {
                    console.warn('[clearBackupHistoryPartial] No response received');
                    resolve({ success: false, error: 'no response' });
                    return;
                }

                resolve(response);
            });
        } catch (error) {
            console.error('[clearBackupHistoryPartial] Exception:', error);
            resolve({ success: false, error: error?.message || String(error) });
        }
    });
}

// 显示全局导出弹窗并预选指定数量的最旧记录
function showGlobalExportModalWithPreselection(preselectCount = 0) {
    const modal = document.getElementById('globalExportModal');
    const tbody = document.getElementById('globalExportTableBody');

    if (!modal || !tbody) return;

    // 重置分页状态
    globalExportCurrentPage = 1;
    globalExportSelectedState = {};

    if (!syncHistory || syncHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 30px; text-align: center; color: var(--text-tertiary);">暂无备份记录</td></tr>';
        document.getElementById('globalExportPagination').style.display = 'none';
        modal.classList.add('show');
        return;
    }

    // 预选最旧的 preselectCount 条记录
    syncHistory.forEach((record, index) => {
        // 索引 0 是最旧的记录
        globalExportSelectedState[record.time] = (index < preselectCount);
    });

    globalExportSeqNumberByTime = new Map();
    syncHistory.forEach((record, index) => {
        const seqNumber = record.seqNumber || (index + 1);
        globalExportSeqNumberByTime.set(String(record.time), seqNumber);
    });

    // 显示分页控件
    document.getElementById('globalExportPagination').style.display = 'flex';

    // 渲染当前页
    renderGlobalExportPage();

    updateGlobalExportStatus();

    modal.classList.add('show');
}

// 显示全局导出弹窗并根据序号范围预选记录
function showGlobalExportModalWithPreselectionBySeqRange(minSeq, maxSeq) {
    const modal = document.getElementById('globalExportModal');
    const tbody = document.getElementById('globalExportTableBody');

    if (!modal || !tbody) return;

    // 重置分页状态
    globalExportCurrentPage = 1;
    globalExportSelectedState = {};

    if (!syncHistory || syncHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 30px; text-align: center; color: var(--text-tertiary);">暂无备份记录</td></tr>';
        document.getElementById('globalExportPagination').style.display = 'none';
        modal.classList.add('show');
        return;
    }

    // 根据序号范围预选记录
    syncHistory.forEach((record, index) => {
        const seqNumber = record.seqNumber || (index + 1);
        globalExportSelectedState[record.time] = (seqNumber >= minSeq && seqNumber <= maxSeq);
    });

    globalExportSeqNumberByTime = new Map();
    syncHistory.forEach((record, index) => {
        const seqNumber = record.seqNumber || (index + 1);
        globalExportSeqNumberByTime.set(String(record.time), seqNumber);
    });

    // 显示分页控件
    document.getElementById('globalExportPagination').style.display = 'flex';

    setupGlobalExportRangeUiForOpen({ source: 'delete', minSeq, maxSeq, autoEnable: true, autoExpand: true });

    // 渲染当前页
    renderGlobalExportPage();

    // 更新选中状态
    updateGlobalExportStatus();

    modal.classList.add('show');
}

// 用于防止Revert结果显示多次的标志
let revertInProgress = false;
let lastRevertMessageHandler = null;
let revertOverlayTimeout = null;

let revertModalInited = false;
let revertPreflight = null; // { strategy, changeMap, currentTree, targetTree }
let revertSnapshotCache = null; // lastBookmarkData

const REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT = 40;
const REVERT_PATCH_THRESHOLD_MIN_PERCENT = 1;
const REVERT_PATCH_THRESHOLD_MAX_PERCENT = 99;
const REVERT_SETTING_STRATEGY_KEY = 'revertStrategyPreference';
const REVERT_SETTING_THRESHOLD_KEY = 'revertPatchThresholdPercent';

let revertStrategyPreference = 'auto';
let revertPatchThresholdPercent = REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT;
let revertLiveAutoDecision = null;
let revertLiveAutoDecisionToken = 0;

async function loadRevertSnapshot() {
    const data = await browserAPI.storage.local.get(['lastBookmarkData', 'syncHistory']);
    const last = data && data.lastBookmarkData ? data.lastBookmarkData : null;
    if (!last || !Array.isArray(last.bookmarkTree)) return null;
    if (!last.bookmarkTree[0] || !Array.isArray(last.bookmarkTree[0].children)) return null;

    try {
        const history = Array.isArray(data && data.syncHistory) ? data.syncHistory : [];
        if (history.length > 0) {
            let matchedRecord = null;
            const baselineTs = last && last.timestamp ? String(last.timestamp) : '';
            if (baselineTs) {
                for (let i = history.length - 1; i >= 0; i--) {
                    const rec = history[i];
                    if (!rec) continue;
                    if (String(rec.time || '') === baselineTs && String(rec.status || '') === 'success') {
                        matchedRecord = rec;
                        break;
                    }
                }
            }

            if (!matchedRecord) {
                for (let i = history.length - 1; i >= 0; i--) {
                    const rec = history[i];
                    if (!rec) continue;
                    if (String(rec.status || '') === 'success') {
                        matchedRecord = rec;
                        break;
                    }
                }
            }

            if (matchedRecord && matchedRecord.fingerprint) {
                last.fingerprint = String(matchedRecord.fingerprint);
            }
        }
    } catch (_) { }

    return last;
}

async function loadRevertSettings() {
    try {
        const data = await browserAPI.storage.local.get([
            REVERT_SETTING_STRATEGY_KEY,
            REVERT_SETTING_THRESHOLD_KEY
        ]);
        const strategy = normalizeRevertStrategyValue(data && data[REVERT_SETTING_STRATEGY_KEY]);
        const threshold = normalizeRevertPatchThresholdPercent(data && data[REVERT_SETTING_THRESHOLD_KEY]);
        revertStrategyPreference = strategy;
        revertPatchThresholdPercent = threshold;
    } catch (_) {
        revertStrategyPreference = 'auto';
        revertPatchThresholdPercent = REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT;
    }
}

function applyRevertSettingsToUI() {
    const preferredStrategy = normalizeRevertStrategyValue(revertStrategyPreference);
    const strategyToUse = preferredStrategy === 'patch' || preferredStrategy === 'overwrite'
        ? preferredStrategy
        : 'patch';

    const modeAuto = document.getElementById('revertStrategyAuto');
    const modeManual = document.getElementById('revertStrategyManual');
    const radioPatch = document.getElementById('revertStrategyPatch');
    const radioOverwrite = document.getElementById('revertStrategyOverwrite');

    const manualMode = preferredStrategy !== 'auto';
    if (modeAuto) modeAuto.checked = !manualMode;
    if (modeManual) modeManual.checked = manualMode;

    if (radioPatch) radioPatch.checked = strategyToUse === 'patch';
    if (radioOverwrite) radioOverwrite.checked = strategyToUse === 'overwrite';

    const thresholdInput = document.getElementById('revertPatchThresholdInput');
    if (thresholdInput) {
        thresholdInput.value = String(revertPatchThresholdPercent);
    }

    updateRevertModeUI();
}

function normalizeRevertPatchThresholdPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return REVERT_PATCH_THRESHOLD_DEFAULT_PERCENT;
    return Math.min(
        REVERT_PATCH_THRESHOLD_MAX_PERCENT,
        Math.max(REVERT_PATCH_THRESHOLD_MIN_PERCENT, Math.round(num))
    );
}

function getCurrentRevertPatchThresholdPercent() {
    const thresholdInput = document.getElementById('revertPatchThresholdInput');
    if (!thresholdInput) return normalizeRevertPatchThresholdPercent(revertPatchThresholdPercent);

    const normalized = normalizeRevertPatchThresholdPercent(thresholdInput.value);
    if (String(normalized) !== String(thresholdInput.value)) {
        thresholdInput.value = String(normalized);
    }

    revertPatchThresholdPercent = normalized;
    return normalized;
}

function getCurrentRevertPatchThresholdRatio() {
    const percent = getCurrentRevertPatchThresholdPercent();
    return percent / 100;
}

async function refreshRevertLiveAutoDecision() {
    if (getSelectedRevertStrategy() !== 'auto') {
        return;
    }

    if (!revertSnapshotCache || !Array.isArray(revertSnapshotCache.bookmarkTree)) {
        revertLiveAutoDecision = null;
        updateRevertWarning(getSelectedRevertStrategy());
        return;
    }

    const requestToken = ++revertLiveAutoDecisionToken;
    const thresholdPercent = getCurrentRevertPatchThresholdPercent();
    revertLiveAutoDecision = {
        calculating: true,
        thresholdPercent
    };
    if (!revertPreflight) {
        updateRevertWarning(getSelectedRevertStrategy());
    }

    try {
        const diff = await buildRevertDiffSummary('auto', revertSnapshotCache.bookmarkTree, { thresholdPercent });
        if (requestToken !== revertLiveAutoDecisionToken) return;
        revertLiveAutoDecision = {
            resolvedStrategy: diff.resolvedStrategy,
            changeRatio: diff.changeRatio,
            changeScore: diff.changeScore,
            baselineCount: diff.baselineCount,
            thresholdPercent: diff.thresholdPercent
        };
    } catch (_) {
        if (requestToken !== revertLiveAutoDecisionToken) return;
        revertLiveAutoDecision = { thresholdPercent };
    }

    if (!revertPreflight) {
        updateRevertWarning(getSelectedRevertStrategy());
    }
}


async function persistRevertSettings(partial = {}) {
    const payload = {};

    if (Object.prototype.hasOwnProperty.call(partial, 'strategy')) {
        const strategy = normalizeRevertStrategyValue(partial.strategy);
        revertStrategyPreference = strategy;
        payload[REVERT_SETTING_STRATEGY_KEY] = strategy;
    }

    if (Object.prototype.hasOwnProperty.call(partial, 'thresholdPercent')) {
        const threshold = normalizeRevertPatchThresholdPercent(partial.thresholdPercent);
        revertPatchThresholdPercent = threshold;
        payload[REVERT_SETTING_THRESHOLD_KEY] = threshold;
    }

    if (!Object.keys(payload).length) return;

    try {
        await browserAPI.storage.local.set(payload);
    } catch (_) { }
}

function normalizeRevertStrategyValue(strategy) {
    const value = String(strategy || '').toLowerCase();
    if (value === 'patch') return 'patch';
    if (value === 'overwrite') return 'overwrite';
    return 'auto';
}

function isManualRevertMode() {
    return normalizeRevertStrategyValue(revertStrategyPreference) !== 'auto';
}

function updateRevertModeUI() {
    const manualMode = isManualRevertMode();

    const modeAuto = document.getElementById('revertStrategyAuto');
    const modeManual = document.getElementById('revertStrategyManual');
    if (modeAuto) modeAuto.checked = !manualMode;
    if (modeManual) modeManual.checked = manualMode;

    const manualGroup = document.getElementById('revertStrategyGroup');
    if (manualGroup) {
        manualGroup.classList.toggle('disabled', !manualMode);
        manualGroup.style.display = manualMode ? 'inline-flex' : 'none';
    }
    const thresholdLabel = document.getElementById('revertThresholdLabel');
    if (thresholdLabel) {
        thresholdLabel.style.display = manualMode ? 'none' : 'inline-flex';
    }

}

function getSelectedRevertStrategy() {
    const modeSelected = document.querySelector('input[name="revertMode"]:checked');
    const modeValue = modeSelected && modeSelected.value ? String(modeSelected.value) : (isManualRevertMode() ? 'manual' : 'auto');
    if (modeValue === 'auto') return 'auto';

    const manualSelected = document.querySelector('input[name="revertManualStrategy"]:checked');
    const manualValue = manualSelected && manualSelected.value ? String(manualSelected.value) : revertStrategyPreference;
    const normalized = normalizeRevertStrategyValue(manualValue);
    return normalized === 'overwrite' ? 'overwrite' : 'patch';
}

function getRevertSnapshotBaselineCount(snapshotTree) {
    const bookmarkCount = Number(revertSnapshotCache && revertSnapshotCache.bookmarkCount);
    const folderCount = Number(revertSnapshotCache && revertSnapshotCache.folderCount);
    if (Number.isFinite(bookmarkCount) && Number.isFinite(folderCount) && (bookmarkCount + folderCount) > 0) {
        return bookmarkCount + folderCount;
    }
    const stats = calculateNodeStats(snapshotTree);
    return Math.max(1, Number(stats.bookmarks || 0) + Number(stats.folders || 0));
}

function resolveRevertStrategyBySummary(summary, snapshotTree, requestedStrategy, thresholdPercent = getCurrentRevertPatchThresholdPercent()) {
    const requested = normalizeRevertStrategyValue(requestedStrategy);
    const safeSummary = summary && typeof summary === 'object' ? summary : {};
    const changeScore =
        Number(safeSummary.added || 0) +
        Number(safeSummary.deleted || 0) +
        Number(safeSummary.moved || 0) +
        Number(safeSummary.modified || 0);
    const baselineCount = Math.max(1, getRevertSnapshotBaselineCount(snapshotTree));
    const changeRatio = changeScore / baselineCount;

    const normalizedThresholdPercent = normalizeRevertPatchThresholdPercent(thresholdPercent);
    const thresholdRatio = normalizedThresholdPercent / 100;

    if (requested === 'patch' || requested === 'overwrite') {
        return {
            strategy: requested,
            requestedStrategy: requested,
            changeScore,
            baselineCount,
            changeRatio,
            thresholdPercent: normalizedThresholdPercent,
            thresholdRatio
        };
    }

    return {
        strategy: changeRatio > thresholdRatio ? 'overwrite' : 'patch',
        requestedStrategy: 'auto',
        changeScore,
        baselineCount,
        changeRatio,
        thresholdPercent: normalizedThresholdPercent,
        thresholdRatio
    };
}

function lockRevertStrategy(lock) {
    const modeRadios = document.querySelectorAll('input[name="revertMode"]');
    modeRadios.forEach((radio) => {
        radio.disabled = !!lock;
    });

    const manualRadios = document.querySelectorAll('input[name="revertManualStrategy"]');
    manualRadios.forEach((radio) => {
        radio.disabled = !!lock;
    });

    const thresholdInput = document.getElementById('revertPatchThresholdInput');
    if (thresholdInput) thresholdInput.disabled = !!lock;

    if (!lock) {
        updateRevertModeUI();
    }
}

function setRevertProgress(percent, text) {
    const section = document.getElementById('revertProgressSection');
    const bar = document.getElementById('revertProgressBar');
    const percentEl = document.getElementById('revertProgressPercent');
    const textEl = document.getElementById('revertProgressText');
    if (section) section.style.display = 'block';
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (percentEl) percentEl.textContent = `${Math.max(0, Math.min(100, percent))}%`;
    if (textEl && typeof text === 'string') textEl.textContent = text;
}

function setRevertDiffBarVisible(visible) {
    const bar = document.getElementById('revertDiffBar');
    if (bar) bar.style.display = visible ? 'flex' : 'none';
    const previewBtn = document.getElementById('revertPreviewBtn');
    if (previewBtn) previewBtn.style.display = visible ? 'inline-flex' : 'none';
}

function updateRevertWarning(strategy, preflightInfo = null) {
    const isZh = currentLang === 'zh_CN';
    const titleEl = document.getElementById('revertWarningTitle');
    const textEl = document.getElementById('revertWarningText');
    if (!titleEl || !textEl) return;

    const info = preflightInfo || revertLiveAutoDecision;
    const normalized = normalizeRevertStrategyValue(strategy);

    const thresholdInputPercent = getCurrentRevertPatchThresholdPercent();
    const thresholdPercent = normalizeRevertPatchThresholdPercent(
        preflightInfo && Number.isFinite(Number(preflightInfo.thresholdPercent))
            ? Number(preflightInfo.thresholdPercent)
            : thresholdInputPercent
    );

    const hasRatio = info && Number.isFinite(Number(info.changeRatio));
    const ratioPercent = hasRatio ? Math.round(Number(info.changeRatio) * 1000) / 10 : null;

    let title = isZh ? '提示' : 'Note';
    let text = '';

    if (normalized === 'patch') {
        text = `手动模式：${i18n.revertPatchDescription[currentLang]}`;
        if (!isZh) {
            text = `Manual mode: ${i18n.revertPatchDescription[currentLang]}`;
        }
    } else if (normalized === 'overwrite') {
        text = isZh
            ? '手动模式：覆盖撤销，清空并恢复到上次备份快照（会重建书签，ID 将变化）。'
            : 'Manual mode: overwrite revert clears and restores to the last backup snapshot (IDs will change).';
    } else if (hasRatio) {
        const ratioRawPercent = Number(info.changeRatio) * 100;
        const choosePatch = Number(ratioRawPercent) <= Number(thresholdPercent);
        const chosen = choosePatch
            ? (isZh ? '补丁撤销' : 'Patch Revert')
            : (isZh ? '覆盖撤销' : 'Overwrite Revert');
        text = isZh
            ? `自动模式：当前占比 ${ratioPercent}% ，阈值 ${thresholdPercent}%；当前：${chosen}。`
            : `Auto mode: ratio ${ratioPercent}%, threshold ${thresholdPercent}%; current: ${chosen}.`;
    } else if (info && info.calculating) {
        text = isZh
            ? `自动模式：当前占比计算中；阈值 ${thresholdPercent}%。`
            : `Auto mode: ratio calculating; threshold ${thresholdPercent}%.`;
    } else {
        text = isZh
            ? `自动模式：当前占比暂无；阈值 ${thresholdPercent}%。`
            : `Auto mode: ratio unavailable; threshold ${thresholdPercent}%.`;
    }

    titleEl.textContent = title;
    textEl.textContent = text;
}

async function buildRevertDiffSummary(strategy, snapshotTree, options = {}) {
    const currentTree = await browserAPI.bookmarks.getTree();
    const targetTree = snapshotTree;
    const requestedStrategy = normalizeRevertStrategyValue(strategy);

    const thresholdPercent = normalizeRevertPatchThresholdPercent(
        options && Object.prototype.hasOwnProperty.call(options, 'thresholdPercent')
            ? options.thresholdPercent
            : getCurrentRevertPatchThresholdPercent()
    );

    let rawChangeMap = new Map();
    try {
        rawChangeMap = computeIdStrictPatchChangeMap(currentTree, targetTree);
    } catch (_) {
        rawChangeMap = new Map();
    }

    const rawSummary = summarizeChangeMap(rawChangeMap);
    const decision = resolveRevertStrategyBySummary(rawSummary, targetTree, requestedStrategy, thresholdPercent);
    const resolvedStrategy = decision.strategy;

    const changeMap = resolvedStrategy === 'overwrite'
        ? normalizeChangeMapForOverwriteAddDeleteOnly(rawChangeMap)
        : rawChangeMap;

    const displaySummary = summarizeChangeMap(changeMap);
    const added = Number(displaySummary.added || 0);
    const deleted = Number(displaySummary.deleted || 0);
    const moved = Number(displaySummary.moved || 0);
    const modified = Number(displaySummary.modified || 0);

    const hasAddDel = (added + deleted) > 0;
    const hasMoveModify = (moved + modified) > 0;
    const hasAnyChange = hasAddDel || hasMoveModify;
    const isZh = currentLang === 'zh_CN';

    let html = '';
    if (!hasAnyChange) {
        html = `<span style="color: var(--text-tertiary);"><i class="fas fa-check-circle"></i> ${isZh ? '已一致（无需撤销）' : 'Already identical (no revert needed)'}</span>`;
    } else if (resolvedStrategy === 'overwrite') {
        html = `
            <span>${isZh ? '新增' : 'Added'}: <strong>${added}</strong></span>
            <span style="margin-left:8px;">${isZh ? '删除' : 'Deleted'}: <strong>${deleted}</strong></span>
        `;
    } else {
        html = `
            <span>${isZh ? '新增' : 'Added'}: <strong>${added}</strong></span>
            <span style="margin-left:8px;">${isZh ? '删除' : 'Deleted'}: <strong>${deleted}</strong></span>
            <span style="margin-left:8px;">${isZh ? '移动' : 'Moved'}: <strong>${moved}</strong></span>
            <span style="margin-left:8px;">${isZh ? '修改' : 'Modified'}: <strong>${modified}</strong></span>
        `;
    }

    return {
        html,
        changeMap,
        rawChangeMap,
        currentTree,
        targetTree,
        hasAddDel,
        hasMoveModify,
        hasAnyChange,
        requestedStrategy,
        resolvedStrategy,
        rawSummary,
        changeScore: decision.changeScore,
        baselineCount: decision.baselineCount,
        changeRatio: decision.changeRatio,
        thresholdPercent: decision.thresholdPercent,
        thresholdRatio: decision.thresholdRatio
    };
}

function closeRevertModal() {
    const modal = document.getElementById('revertModal');
    if (modal) modal.classList.remove('show');
    revertPreflight = null;
    revertLiveAutoDecision = null;
    revertLiveAutoDecisionToken += 1;
    setRevertDiffBarVisible(false);
    lockRevertStrategy(false);
    const progressSection = document.getElementById('revertProgressSection');
    if (progressSection) progressSection.style.display = 'none';
    const confirmBtn = document.getElementById('revertConfirmBtn');
    if (confirmBtn) {
        confirmBtn.textContent = currentLang === 'zh_CN' ? '撤销' : 'Revert';
        confirmBtn.disabled = false;
    }
    const cancelBtn = document.getElementById('revertCancelBtn');
    if (cancelBtn) cancelBtn.disabled = false;
    const mainView = document.getElementById('revertMainView');
    const previewView = document.getElementById('revertPreviewView');
    if (mainView) mainView.style.display = 'block';
    if (previewView) previewView.style.display = 'none';
    setRevertPreviewHelpVisible(false);
}

function setRevertPreviewHelpVisible(visible) {
    const helpBtn = document.getElementById('revertPreviewHelpBtn');
    const helpContent = document.getElementById('revertPreviewHelpContent');
    if (helpContent) {
        helpContent.style.display = visible ? 'block' : 'none';
    }
    if (helpBtn) {
        helpBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
}

async function switchToRevertPreview(currentTree, targetTree, changeMap, strategy) {
    const mainView = document.getElementById('revertMainView');
    const previewView = document.getElementById('revertPreviewView');
    const title = document.getElementById('revertModalTitle');
    const previewContent = document.getElementById('revertPreviewContent');
    const previewTitle = document.getElementById('revertPreviewTitle');
    const helpBtn = document.getElementById('revertPreviewHelpBtn');
    const isPatch = String(strategy || '').toLowerCase() === 'patch';

    if (!mainView || !previewView || !previewContent) return;

    mainView.style.display = 'none';
    previewView.style.display = 'flex';
    if (title) title.textContent = i18n.revertPreviewTitle[currentLang];
    if (previewTitle) {
        previewTitle.textContent = isPatch
            ? i18n.revertPreviewSubPatch[currentLang]
            : i18n.revertPreviewSubOverwrite[currentLang];
    }
    if (helpBtn) {
        helpBtn.style.display = isPatch ? 'inline-flex' : 'none';
    }
    setRevertPreviewHelpVisible(false);

    const closeBtn = document.getElementById('revertModalClose');
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.addEventListener('click', () => {
            previewView.style.display = 'none';
            mainView.style.display = 'block';
            setRevertPreviewHelpVisible(false);
            if (title) title.textContent = i18n.revertModalTitle[currentLang];

            const finalCloseBtn = newCloseBtn.cloneNode(true);
            newCloseBtn.parentNode.replaceChild(finalCloseBtn, newCloseBtn);
            finalCloseBtn.addEventListener('click', closeRevertModal);
        });
    }

    previewContent.innerHTML = `<div class="loading" style="padding: 30px; color: var(--text-secondary); text-align: center;">
        <i class="fas fa-spinner fa-spin" style="font-size: 22px; margin-bottom: 16px; opacity: 0.6;"></i><br>
        ${currentLang === 'zh_CN' ? '正在生成预览...' : 'Generating preview...'}
    </div>`;

    try {
        let map = changeMap;
        if (!map) {
            map = computeIdStrictPatchChangeMap(currentTree, targetTree);
        }
        if (String(strategy || '').toLowerCase() === 'overwrite') {
            map = normalizeChangeMapForOverwriteAddDeleteOnly(map);
        }

        let treeToRender = targetTree;
        let hasDeleted = false;
        map.forEach(change => {
            if (change && change.type && String(change.type).includes('deleted')) hasDeleted = true;
        });
        if (hasDeleted) {
            try {
                treeToRender = rebuildTreeWithDeleted(currentTree, targetTree, map);
            } catch (_) { }
        }
        const previewKey = `revert-preview-${Date.now()}`;
        const treeHtml = generateHistoryTreeHtml(treeToRender, map, 'detailed', {
            recordTime: previewKey,
            expandDepth: 1,
            lazyDepth: 1
        });

        previewContent.innerHTML = treeHtml || `<div style="padding: 20px; color: var(--text-tertiary); text-align: center;">No Data</div>`;
        if (treeHtml) bindRestorePreviewTreeEvents(previewContent, previewKey);
    } catch (e) {
        previewContent.innerHTML = `<div style="padding: 20px; color: var(--warning);">Error: ${e.message}</div>`;
    }
}

function initRevertModalEvents() {
    if (revertModalInited) return;
    revertModalInited = true;

    const closeBtn = document.getElementById('revertModalClose');
    const cancelBtn = document.getElementById('revertCancelBtn');
    const previewHelpBtn = document.getElementById('revertPreviewHelpBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeRevertModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeRevertModal);
    if (previewHelpBtn) {
        previewHelpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const helpContent = document.getElementById('revertPreviewHelpContent');
            const currentlyVisible = !!(helpContent && helpContent.style.display !== 'none');
            setRevertPreviewHelpVisible(!currentlyVisible);
        });
    }

    const resetPreflightAndConfirm = () => {
        revertPreflight = null;
        setRevertDiffBarVisible(false);
        const confirmBtn = document.getElementById('revertConfirmBtn');
        if (confirmBtn) confirmBtn.textContent = currentLang === 'zh_CN' ? '撤销' : 'Revert';
    };

    const modeRadios = document.querySelectorAll('input[name="revertMode"]');
    modeRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            const strategy = getSelectedRevertStrategy();
            persistRevertSettings({ strategy }).catch(() => { });
            updateRevertModeUI();
            resetPreflightAndConfirm();
            updateRevertWarning(strategy);
            refreshRevertLiveAutoDecision().catch(() => { });
        });
    });

    const manualRadios = document.querySelectorAll('input[name="revertManualStrategy"]');
    manualRadios.forEach((radio) => {
        radio.addEventListener('change', () => {
            const strategy = getSelectedRevertStrategy();
            persistRevertSettings({ strategy }).catch(() => { });
            updateRevertModeUI();
            resetPreflightAndConfirm();
            updateRevertWarning(strategy);
        });
    });

    const thresholdInput = document.getElementById('revertPatchThresholdInput');
    if (thresholdInput) {
        const syncThresholdDraft = () => {
            const normalized = normalizeRevertPatchThresholdPercent(thresholdInput.value);
            thresholdInput.value = String(normalized);
            revertPatchThresholdPercent = normalized;
            updateRevertWarning(getSelectedRevertStrategy());
        };

        const applyThresholdValue = () => {
            const normalized = normalizeRevertPatchThresholdPercent(thresholdInput.value);
            thresholdInput.value = String(normalized);
            revertPatchThresholdPercent = normalized;
            persistRevertSettings({ thresholdPercent: normalized }).catch(() => { });
            resetPreflightAndConfirm();
            updateRevertModalI18n();
            refreshRevertLiveAutoDecision().catch(() => { });
        };

        thresholdInput.addEventListener('input', syncThresholdDraft);
        thresholdInput.addEventListener('change', applyThresholdValue);
        thresholdInput.addEventListener('blur', applyThresholdValue);
    }

    const confirmBtn = document.getElementById('revertConfirmBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            executeRevert(getSelectedRevertStrategy()).catch(() => { });
        });
    }

    const previewBtn = document.getElementById('revertPreviewBtn');
    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            if (!revertPreflight || !revertPreflight.currentTree || !revertPreflight.targetTree) return;
            await switchToRevertPreview(revertPreflight.currentTree, revertPreflight.targetTree, revertPreflight.changeMap, revertPreflight.strategy);
        });
    }
}

async function showRevertModal() {
    initRevertModalEvents();
    await loadRevertSettings();
    applyRevertSettingsToUI();
    updateRevertModalI18n();
    revertPreflight = null;
    setRevertDiffBarVisible(false);

    const modal = document.getElementById('revertModal');
    if (!modal) return;

    const mainView = document.getElementById('revertMainView');
    const previewView = document.getElementById('revertPreviewView');
    if (mainView) mainView.style.display = 'block';
    if (previewView) previewView.style.display = 'none';
    const progressSection = document.getElementById('revertProgressSection');
    if (progressSection) progressSection.style.display = 'none';

    revertSnapshotCache = await loadRevertSnapshot();
    const hasSnapshot = !!(revertSnapshotCache && Array.isArray(revertSnapshotCache.bookmarkTree));
    const isEmptySnapshot = hasSnapshot && !hasBookmarkTreeContent(revertSnapshotCache.bookmarkTree);

    const badgeEl = document.getElementById('revertSnapshotBadge');
    const statusEl = document.getElementById('revertSnapshotStatusText');
    const subEl = document.getElementById('revertSnapshotSubText');
    const timeEl = document.getElementById('revertSnapshotTime');
    const fingerprintEl = document.getElementById('revertSnapshotFingerprint');
    const isZh = currentLang === 'zh_CN';

    if (badgeEl) {
        badgeEl.textContent = i18n.revertSnapshotBadge[currentLang];
        badgeEl.classList.toggle('ready', hasSnapshot && !isEmptySnapshot);
        badgeEl.classList.toggle('missing', !hasSnapshot || isEmptySnapshot);
    }
    if (statusEl) {
        statusEl.textContent = !hasSnapshot
            ? i18n.revertSnapshotMissing[currentLang]
            : (isEmptySnapshot
                ? (currentLang === 'zh_CN' ? '参考快照：为空（请先预演）' : 'Snapshot: Empty (review preflight first)')
                : i18n.revertSnapshotReady[currentLang]);
    }
    if (subEl) {
        subEl.textContent = !hasSnapshot
            ? i18n.revertSnapshotSubMissing[currentLang]
            : (isEmptySnapshot
                ? (currentLang === 'zh_CN' ? '目标书签树为空时，覆盖撤销可能清空现有书签' : 'An empty target bookmark tree may wipe current bookmarks in overwrite revert')
                : i18n.revertSnapshotSubReady[currentLang]);
    }
    if (timeEl) {
        timeEl.textContent = hasSnapshot && revertSnapshotCache.timestamp
            ? `${i18n.revertSnapshotTimeLabel[currentLang]}${formatTime(revertSnapshotCache.timestamp)}`
            : i18n.revertSnapshotNoTime[currentLang];
    }
    if (fingerprintEl) {
        const fp = hasSnapshot && revertSnapshotCache && revertSnapshotCache.fingerprint
            ? String(revertSnapshotCache.fingerprint)
            : '';
        fingerprintEl.textContent = fp
            ? `${isZh ? '快照哈希：' : 'Snapshot Hash: '}${fp}`
            : `${isZh ? '快照哈希：无' : 'Snapshot Hash: N/A'}`;
        if (fp) {
            fingerprintEl.title = fp;
        } else {
            fingerprintEl.removeAttribute('title');
        }
    }

    const currentCounts = await getCurrentCountsForRestore();
    const revertCurrentCount = document.getElementById('revertCurrentCount');
    const revertCurrentFolders = document.getElementById('revertCurrentFolders');
    if (revertCurrentCount) revertCurrentCount.textContent = String(currentCounts.bookmarks ?? 0);
    if (revertCurrentFolders) revertCurrentFolders.textContent = String(currentCounts.folders ?? 0);

    let snapBookmarks = 0;
    let snapFolders = 0;
    if (hasSnapshot) {
        if (typeof revertSnapshotCache.bookmarkCount === 'number') {
            snapBookmarks = revertSnapshotCache.bookmarkCount;
        }
        if (typeof revertSnapshotCache.folderCount === 'number') {
            snapFolders = revertSnapshotCache.folderCount;
        }
        if (!snapBookmarks && !snapFolders) {
            const stats = calculateNodeStats(revertSnapshotCache.bookmarkTree);
            snapBookmarks = stats.bookmarks;
            snapFolders = stats.folders;
        }
    }
    const revertSnapshotCount = document.getElementById('revertSnapshotCount');
    const revertSnapshotFolders = document.getElementById('revertSnapshotFolders');
    if (revertSnapshotCount) revertSnapshotCount.textContent = String(snapBookmarks ?? 0);
    if (revertSnapshotFolders) revertSnapshotFolders.textContent = String(snapFolders ?? 0);

    applyRevertSettingsToUI();
    updateRevertWarning(getSelectedRevertStrategy());

    const confirmBtn = document.getElementById('revertConfirmBtn');
    if (confirmBtn) {
        confirmBtn.textContent = i18n.revertConfirm[currentLang];
        confirmBtn.disabled = !hasSnapshot;
    }

    modal.classList.add('show');
    await refreshRevertLiveAutoDecision();
}

async function executeRevert(strategy) {
    if (!revertSnapshotCache || !revertSnapshotCache.bookmarkTree) {
        showRevertToast(false, i18n.revertNoBackup[currentLang]);
        return;
    }

    const requestedStrategy = normalizeRevertStrategyValue(strategy);
    const thresholdPercent = getCurrentRevertPatchThresholdPercent();

    if (!revertPreflight || revertPreflight.requestedStrategy !== requestedStrategy || Number(revertPreflight.thresholdPercent || 0) !== Number(thresholdPercent)) {
        const diff = await buildRevertDiffSummary(requestedStrategy, revertSnapshotCache.bookmarkTree, { thresholdPercent });
        const diffContainer = document.getElementById('revertDiffSummary');
        if (diffContainer) diffContainer.innerHTML = diff.html || '';

        revertPreflight = {
            ...diff,
            strategy: diff.resolvedStrategy,
            requestedStrategy,
            thresholdPercent: diff.thresholdPercent
        };

        setRevertDiffBarVisible(true);
        lockRevertStrategy(true);
        updateRevertWarning(requestedStrategy, revertPreflight);

        const confirmBtn = document.getElementById('revertConfirmBtn');
        if (confirmBtn) {
            confirmBtn.textContent = diff.resolvedStrategy === 'patch'
                ? (currentLang === 'zh_CN' ? '确认补丁撤销' : 'Confirm Patch Revert')
                : (currentLang === 'zh_CN' ? '确认覆盖撤销' : 'Confirm Overwrite Revert');
        }

        const chosenLabel = diff.resolvedStrategy === 'patch'
            ? (currentLang === 'zh_CN' ? '补丁撤销' : 'Patch Revert')
            : (currentLang === 'zh_CN' ? '覆盖撤销' : 'Overwrite Revert');

        showToast(currentLang === 'zh_CN'
            ? `已生成预演（${chosenLabel}），请查看差异/预览；再次点击确认按钮才会执行`
            : `Preflight ready (${chosenLabel}). Review diff/preview, then click confirm again to apply`, 2800);
        return;
    }

    const strategyToUse = normalizeRevertStrategyValue(revertPreflight.strategy || 'overwrite');

    if (strategyToUse === 'overwrite' && !hasBookmarkTreeContent(revertSnapshotCache.bookmarkTree)) {
        const summary = summarizeChangeMap(revertPreflight && revertPreflight.changeMap ? revertPreflight.changeMap : new Map());
        const total = Number(summary?.added || 0) + Number(summary?.deleted || 0) + Number(summary?.moved || 0) + Number(summary?.modified || 0);
        if (total > 0) {
            const msg = currentLang === 'zh_CN'
                ? '预演显示目标书签树为空，执行覆盖撤销会清空现有内容，已阻止执行。'
                : 'Preflight shows the target bookmark tree is empty. Overwrite revert would clear current content, so execution is blocked.';
            setRevertProgress(0, msg);
            showRevertToast(false, msg);
            return;
        }

        const noopMsg = currentLang === 'zh_CN'
            ? '预演结果：当前与目标空书签树一致（无需执行覆盖撤销）'
            : 'Preflight result: current data already matches the empty target bookmark tree (no overwrite revert needed).';
        setRevertProgress(100, noopMsg);
        showRevertToast(true, noopMsg);
        setTimeout(() => {
            closeRevertModal();
        }, 220);
        return;
    }

    const confirmBtn = document.getElementById('revertConfirmBtn');
    const cancelBtn = document.getElementById('revertCancelBtn');
    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    setRevertProgress(0, strategyToUse === 'patch'
        ? (currentLang === 'zh_CN' ? '正在补丁撤销...' : 'Applying patch revert...')
        : (currentLang === 'zh_CN' ? '正在覆盖撤销...' : 'Applying overwrite revert...'));

    try {
        try {
            await browserAPI.runtime.sendMessage({ action: 'setBookmarkRestoringFlag', value: true });
        } catch (_) { }

        let successMsg = i18n.revertSuccess[currentLang];
        const resp = await new Promise(resolve => {
            browserAPI.runtime.sendMessage({
                action: 'revertAllToLastBackup',
                strategy: strategyToUse,
                thresholdPercent: Number(revertPreflight && revertPreflight.thresholdPercent) || thresholdPercent
            }, (res) => resolve(res));
        });
        if (!resp || !resp.success) {
            const msg = resp && resp.error ? String(resp.error) : (currentLang === 'zh_CN' ? '撤销失败' : 'Revert failed');
            setRevertProgress(0, msg);
            showRevertToast(false, msg);
            return;
        }

        const appliedStrategy = normalizeRevertStrategyValue(resp.strategy || strategyToUse);
        if (appliedStrategy === 'patch') {
            successMsg = currentLang === 'zh_CN'
                ? '已完成补丁撤销，已恢复到上次备份状态'
                : 'Patch revert completed. Restored to the last backup state.';
        }

        setRevertProgress(100, appliedStrategy === 'patch'
            ? (currentLang === 'zh_CN' ? '补丁撤销完成！' : 'Patch revert completed!')
            : (currentLang === 'zh_CN' ? '覆盖撤销完成！' : 'Overwrite revert completed!'));
        showRevertToast(true, successMsg);

        revertPreflight = null;
        lockRevertStrategy(false);
        setRevertDiffBarVisible(false);

        setTimeout(async () => {
            closeRevertModal();
            try {
                await loadAllData({ skipRender: true });
                if (currentView === 'current-changes') {
                    await renderCurrentChangesViewWithRetry(1, true);
                } else if (currentView === 'history') {
                    await renderHistoryView();
                }
                try {
                    resetPermanentSectionChangeMarkers();
                } catch (_) { }
            } catch (_) { }
        }, 300);
    } catch (e) {
        const msg = currentLang === 'zh_CN' ? `撤销失败: ${e.message}` : `Revert failed: ${e.message}`;
        setRevertProgress(0, msg);
        showRevertToast(false, msg);
    } finally {
        try {
            await browserAPI.runtime.sendMessage({ action: 'setBookmarkRestoringFlag', value: false });
        } catch (_) { }
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        lockRevertStrategy(false);
    }
}


// 触发撤销入口：打开二级 UI
async function handleRevertAll(source) {
    await showRevertModal();
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
        // 并行加载所有数据
        const [storageData, bookmarkTree] = await Promise.all([
            loadStorageData(),
            loadBookmarkTree()
        ]);

        syncHistory = storageData.syncHistory || [];
        syncHistory = await ensureSyncHistorySeqNumbersPersisted(syncHistory);

        // 注意：不再清理 bookmarkTree，保留所有记录的详细数据
        // 用户存储空间无限制
        console.log('[loadAllData] 保留所有历史记录的详细数据');

        // 将 ISO 字符串格式转换为时间戳（毫秒）
        lastBackupTime = storageData.lastSyncTime ? new Date(storageData.lastSyncTime).getTime() : null;
        allBookmarks = flattenBookmarkTree(bookmarkTree);
        cachedBookmarkTree = bookmarkTree;

        console.log('[loadAllData] 数据加载完成:', {
            历史记录数: syncHistory.length,
            书签总数: allBookmarks.length
        });

        // NOTE:
        // loadAllData 只负责数据准备，不在这里触发 current-changes 的渲染。
        // 否则在初始化阶段会出现：loadAllData 内触发一次渲染 + 初始化流程再触发一次渲染，
        // 用户感知为“刷新后 2-3 秒又自动刷新了一次 DOM/书签树”。

    } catch (error) {
        console.error('[loadAllData] 加载数据失败:', error);
        showError('加载数据失败');
    }
}

async function ensureSyncHistorySeqNumbersPersisted(historyRecords) {
    const records = Array.isArray(historyRecords) ? historyRecords.slice() : [];
    if (records.length === 0) return records;

    const hasAnyMissing = records.some(r => !(Number.isFinite(Number(r?.seqNumber)) && Number(r?.seqNumber) > 0));
    if (!hasAnyMissing) return records;

    // One-time migration: assign missing seqNumber in time-ascending order without changing existing ones.
    const sorted = records.slice().sort((a, b) => Number(a?.time || 0) - Number(b?.time || 0));
    const used = new Set();
    for (const r of sorted) {
        const seq = Number(r?.seqNumber);
        if (Number.isFinite(seq) && seq > 0) used.add(seq);
    }

    let next = 1;
    const updatedByTime = new Map();
    for (const r of sorted) {
        const copy = { ...r };
        let seq = Number(copy.seqNumber);
        if (!(Number.isFinite(seq) && seq > 0)) {
            while (used.has(next)) next++;
            seq = next;
            used.add(seq);
            next++;
        }
        copy.seqNumber = seq;
        updatedByTime.set(String(copy.time), copy);
    }

    const updated = records.map(r => updatedByTime.get(String(r.time)) || r);

    try {
        // Mark: this is an internal migration write; avoid triggering a full UI reload via storage.onChanged.
        try {
            window.__skipNextSyncHistoryStorageRefresh = {
                at: Date.now(),
                reason: 'seqNumber-migration'
            };
        } catch (_) { }

        await new Promise((resolve) => {
            browserAPI.storage.local.set({ syncHistory: updated }, resolve);
        });
        console.log('[ensureSyncHistorySeqNumbersPersisted] Migrated seqNumber for syncHistory records');
    } catch (e) {
        console.warn('[ensureSyncHistorySeqNumbersPersisted] Failed to persist seqNumber migration:', e);
    }

    return updated;
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

    // 新口径：若 background 提供了新增/删除分开计数，则优先用它（支持“加减相同数量但内容不同”）
    const bookmarkAdded = typeof stats?.bookmarkAdded === 'number' ? stats.bookmarkAdded : null;
    const bookmarkDeleted = typeof stats?.bookmarkDeleted === 'number' ? stats.bookmarkDeleted : null;
    const folderAdded = typeof stats?.folderAdded === 'number' ? stats.folderAdded : null;
    const folderDeleted = typeof stats?.folderDeleted === 'number' ? stats.folderDeleted : null;
    const hasDetailedQuantity = (bookmarkAdded !== null) || (bookmarkDeleted !== null) || (folderAdded !== null) || (folderDeleted !== null);
    const hasQuantityChange = hasDetailedQuantity
        ? ((bookmarkAdded || 0) > 0 || (bookmarkDeleted || 0) > 0 || (folderAdded || 0) > 0 || (folderDeleted || 0) > 0)
        : hasNumericalChange;

    const i18nBookmarksLabel = window.i18nLabels?.bookmarksLabel || (effectiveLang === 'en' ? 'bookmarks' : '个书签');
    const i18nFoldersLabel = window.i18nLabels?.foldersLabel || (effectiveLang === 'en' ? 'folders' : '个文件夹');
    const totalBookmarkTerm = effectiveLang === 'en' ? 'BKM' : i18nBookmarksLabel;
    const totalFolderTerm = effectiveLang === 'en' ? 'FLD' : i18nFoldersLabel;

    summary.quantityTotalLine = effectiveLang === 'en'
        ? `${currentBookmarks} ${totalBookmarkTerm}, ${currentFolders} ${totalFolderTerm}`
        : `${currentBookmarks}${totalBookmarkTerm}，${currentFolders}${totalFolderTerm}`;

    if (hasQuantityChange) {
        summary.hasQuantityChange = true;
        const parts = [];

        if (hasDetailedQuantity) {
            const joinDelta = (deltaParts) => {
                const sep = '<span style="display:inline-block;width:3px;"></span>/<span style="display:inline-block;width:3px;"></span>';
                return deltaParts.join(sep);
            };

            const buildDual = (added, deleted, label) => {
                const deltaParts = [];
                if (added > 0) deltaParts.push(`<span style="color:var(--positive-color, #4CAF50);font-weight:bold;">+${added}</span>`);
                if (deleted > 0) deltaParts.push(`<span style="color:var(--negative-color, #F44336);font-weight:bold;">-${deleted}</span>`);
                if (deltaParts.length === 0) return '';
                const numbersHTML = joinDelta(deltaParts);
                return effectiveLang === 'en' ? `${numbersHTML} ${label}` : `${numbersHTML}${label}`;
            };

            const bookmarkLabel = effectiveLang === 'en' ? 'BKM' : '书签';
            const folderLabel = effectiveLang === 'en' ? 'FLD' : '文件夹';

            const bPart = buildDual(bookmarkAdded || 0, bookmarkDeleted || 0, bookmarkLabel);
            const fPart = buildDual(folderAdded || 0, folderDeleted || 0, folderLabel);

            if (bPart) parts.push(bPart);
            if (fPart) parts.push(fPart);
        } else {
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
        const movedCount = typeof stats?.movedCount === 'number'
            ? stats.movedCount
            : (typeof stats?.movedBookmarkCount === 'number' ? stats.movedBookmarkCount : 0) + (typeof stats?.movedFolderCount === 'number' ? stats.movedFolderCount : 0);
        const modifiedCount = typeof stats?.modifiedCount === 'number'
            ? stats.modifiedCount
            : (typeof stats?.modifiedBookmarkCount === 'number' ? stats.modifiedBookmarkCount : 0) + (typeof stats?.modifiedFolderCount === 'number' ? stats.modifiedFolderCount : 0);

        if (bookmarkMoved || folderMoved) {
            const movedLabel = effectiveLang === 'en' ? (movedCount > 0 ? `${movedCount} moved` : 'Moved') : (movedCount > 0 ? `${movedCount}个移动` : '移动');
            structuralParts.push(movedLabel);
            summary.structuralItems.push(movedLabel);
        }
        if (bookmarkModified || folderModified) {
            const modifiedLabel = effectiveLang === 'en' ? (modifiedCount > 0 ? `${modifiedCount} modified` : 'Modified') : (modifiedCount > 0 ? `${modifiedCount}个修改` : '修改');
            structuralParts.push(modifiedLabel);
            summary.structuralItems.push(modifiedLabel);
        }


        // 用具体的变化类型替代通用的"变动"标签
        const separator = effectiveLang === 'en' ? ' <span style="color:var(--text-tertiary);">|</span> ' : '、';
        const structuralText = structuralParts.join(separator);
        summary.structuralLine = `<span style="color:var(--accent-secondary, #FF9800);font-weight:bold;">${structuralText}</span>`;
    }

    return summary;
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
    // 无需处理小组件显示逻辑

    // 点击切换按钮
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('collapsed');

        // 保存状态到 localStorage
        const isCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebarCollapsed', isCollapsed.toString());

        // 更新 CSS 变量（用于弹窗定位）
        syncSidebarWidth();
        // 无需处理小组件刷新

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

    // 仅保留 current-changes / history，不再处理其他视图的特殊逻辑

    // 更新全局变量
    currentView = view;

    // 视图切换时隐藏搜索结果面板并清除搜索缓存（Phase 1 & 2 & 2.5）
    try {
        // [隔离增强] 确保清理搜索 UI 状态
        if (typeof cancelPendingMainSearchDebounce === 'function') cancelPendingMainSearchDebounce();
        if (typeof hideSearchResultsPanel === 'function') hideSearchResultsPanel();
        if (typeof toggleSearchModeMenu === 'function') toggleSearchModeMenu(false);

        // [Search Isolation] Search box behaviors differ by view.
        // When leaving a view, clear the shared top search input to avoid leaking queries.
        if (previousView !== view && typeof window !== 'undefined' && typeof window.resetMainSearchUI === 'function') {
            window.resetMainSearchUI({ reason: 'switchView' });
        }

        if (window.SearchContextManager) {
            window.SearchContextManager.updateContext(view);
        }

        // 同步搜索模式 UI（搜索框左侧模式按钮）
        if (typeof window.setSearchMode === 'function') {
            window.setSearchMode(view, { switchView: false });
        } else if (typeof setSearchMode === 'function') {
            setSearchMode(view, { switchView: false });
        } else if (typeof renderSearchModeUI === 'function') {
            renderSearchModeUI();
        }
        if (window.SearchContextManager && typeof window.SearchContextManager.updateUI === 'function') {
            window.SearchContextManager.updateUI();
        }

        // 清除 Phase 1 缓存
        if (typeof resetCurrentChangesSearchDb === 'function') {
            resetCurrentChangesSearchDb('switchView');
        }
        // 清除 Phase 2 缓存
        if (typeof resetBackupHistorySearchDb === 'function') {
            resetBackupHistorySearchDb('switchView');
        }
        // 清除 Phase 2.5 缓存
        if (typeof clearAllHistoryDetailSearchDb === 'function') {
            clearAllHistoryDetailSearchDb();
        }
    } catch (_) { }

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

function renderCurrentView() {
    switch (currentView) {
        case 'current-changes':
            // 使用带重试 + 合并请求的渲染函数，避免多次抖动
            renderCurrentChangesViewWithRetry(1, false);
            break;
        case 'history':
            renderHistoryView();
            break;
    }
}

// =============================================================================
// 当前变化视图
// =============================================================================

const CHANGES_PREVIEW_EXPANDED_KEY = 'changesPreviewExpandedNodes';
const CHANGES_PREVIEW_SCROLL_KEY = 'changesPreviewScrollTop';

// 右侧内容区域（.content-area）滚动位置持久化：按“当前变化 + 详略模式”分别记忆
const CURRENT_CHANGES_CONTENT_SCROLL_KEY = 'currentChangesContentScrollTop';

let __currentChangesContentAreaScrollBound = false;
let __currentChangesContentAreaScrollHandler = null;

function __getCurrentChangesContentScrollStorageKey() {
    return `${CURRENT_CHANGES_CONTENT_SCROLL_KEY}:${__getChangesPreviewMode()}`;
}

function __getContentAreaEl() {
    try {
        return document.querySelector('.content-area');
    } catch (_) {
        return null;
    }
}

function getCurrentChangesContentScrollTop() {
    try {
        const raw = localStorage.getItem(__getCurrentChangesContentScrollStorageKey());
        const value = raw != null ? parseInt(raw, 10) : 0;
        return Number.isNaN(value) ? 0 : value;
    } catch (_) {
        return 0;
    }
}

function saveCurrentChangesContentScrollTop(scrollTop) {
    try {
        const value = typeof scrollTop === 'number' && !Number.isNaN(scrollTop) ? scrollTop : 0;
        localStorage.setItem(__getCurrentChangesContentScrollStorageKey(), String(value));
    } catch (_) { }
}

function bindCurrentChangesContentScrollPersistence() {
    if (currentView !== 'current-changes') return;
    const el = __getContentAreaEl();
    if (!el) return;

    try {
        if (__currentChangesContentAreaScrollHandler) {
            el.removeEventListener('scroll', __currentChangesContentAreaScrollHandler);
        }
    } catch (_) { }

    __currentChangesContentAreaScrollHandler = () => {
        try {
            saveCurrentChangesContentScrollTop(el.scrollTop);
        } catch (_) { }
    };
    el.addEventListener('scroll', __currentChangesContentAreaScrollHandler, { passive: true });
    __currentChangesContentAreaScrollBound = true;
}

function restoreCurrentChangesContentScrollPosition() {
    if (currentView !== 'current-changes') return;
    const el = __getContentAreaEl();
    if (!el) return;
    const top = getCurrentChangesContentScrollTop();
    try {
        el.scrollTop = top;
    } catch (_) { }
}

function __flushCurrentChangesScrollState() {
    try {
        if (currentView !== 'current-changes') return;

        try {
            const contentArea = __getContentAreaEl();
            if (contentArea) saveCurrentChangesContentScrollTop(contentArea.scrollTop);
        } catch (_) { }

        try {
            const previewBody = document.querySelector('#changesPreviewPermanentSection .permanent-section-body');
            if (previewBody) saveChangesPreviewScrollTop(previewBody.scrollTop);
        } catch (_) { }
    } catch (_) { }
}

function __getChangesPreviewMode() {
    try {
        const root = document.getElementById('changesTreePreviewInline');
        return root && root.classList && root.classList.contains('compact-mode') ? 'compact' : 'detailed';
    } catch (_) {
        return 'detailed';
    }
}

function __getChangesPreviewExpandedStorageKey() {
    // Mode-scoped key to avoid detailed/compact fighting each other.
    return `${CHANGES_PREVIEW_EXPANDED_KEY}:${__getChangesPreviewMode()}`;
}

function __getChangesPreviewScrollStorageKey() {
    // Mode-scoped key to avoid detailed/compact fighting each other.
    return `${CHANGES_PREVIEW_SCROLL_KEY}:${__getChangesPreviewMode()}`;
}

// 当前变化视图渲染状态（避免重复触发多次抖动）
let isRenderingCurrentChangesView = false;
let pendingCurrentChangesRender = null;
let pendingCurrentChangesEventTimer = null;

// 最新的 current changes 数据（供“原地刷新 / 导出”等复用，避免闭包抓到旧数据）
let latestCurrentChangesData = null;

let currentChangesInPlaceRefreshInProgress = false;
let currentChangesInPlaceRefreshQueued = false;

function __getCurrentChangesOpsEls(root) {
    const container = root || document;
    const opsGrid = container.querySelector('.current-changes-ops-grid');
    return {
        opsGrid,
        added: container.querySelector('#currentChangesOpAdded'),
        moved: container.querySelector('#currentChangesOpMoved'),
        deleted: container.querySelector('#currentChangesOpDeleted'),
        modified: container.querySelector('#currentChangesOpModified'),
        unchanged: container.querySelector('#currentChangesOpUnchanged')
    };
}

function __setCurrentChangesOpLine(el, { visible, prefix, text, title, display = 'flex' }) {
    if (!el) return;
    try {
        el.style.display = visible ? display : 'none';
    } catch (_) { }

    try {
        const prefixEl = el.querySelector('.diff-prefix');
        if (prefixEl && typeof prefix === 'string') prefixEl.textContent = prefix;
    } catch (_) { }

    try {
        const contentEl = el.querySelector('.diff-content');
        if (contentEl) contentEl.textContent = text || '';
    } catch (_) { }

    try {
        const btn = el.querySelector('.jump-to-related-btn');
        if (btn && typeof title === 'string') btn.title = title;
    } catch (_) { }
}

function __updateCurrentChangesSingleOpLayout(opsGrid) {
    if (!opsGrid) return;
    try {
        const visibleLines = Array.from(opsGrid.querySelectorAll('.diff-line.clickable'))
            .filter(el => el && el.style && el.style.display !== 'none');
        if (visibleLines.length === 1) opsGrid.classList.add('single-op');
        else opsGrid.classList.remove('single-op');
    } catch (_) { }
}

async function __computeMovedModifiedCountsForCurrentChanges(changeData, stats) {
    let movedCount = (changeData?.moved && changeData.moved.length) || 0;
    let modifiedCount = (changeData?.modified && changeData.modified.length) || 0;

    if (typeof stats?.movedCount === 'number') movedCount = stats.movedCount;
    if (typeof stats?.modifiedCount === 'number') modifiedCount = stats.modifiedCount;

    // 如果没有从 changeData 获取到移动数量，但有移动标记，尝试从 recentMovedIds 获取
    if (movedCount === 0 && (stats?.bookmarkMoved || stats?.folderMoved)) {
        try {
            const data = await new Promise(resolve => {
                browserAPI.storage.local.get(['recentMovedIds'], result => resolve(result));
            });
            const recentMovedIds = data && Array.isArray(data.recentMovedIds) ? data.recentMovedIds : [];
            movedCount = recentMovedIds.length;
        } catch (_) { }
    }

    // 如果没有从 changeData 获取到修改数量，但有修改标记，尝试从 recentModifiedIds 获取
    if (modifiedCount === 0 && (stats?.bookmarkModified || stats?.folderModified)) {
        try {
            const data = await new Promise(resolve => {
                browserAPI.storage.local.get(['recentModifiedIds'], result => resolve(result));
            });
            const recentModifiedIds = data && Array.isArray(data.recentModifiedIds) ? data.recentModifiedIds : [];
            modifiedCount = recentModifiedIds.length;
        } catch (_) { }
    }

    return { movedCount, modifiedCount };
}

async function updateCurrentChangesOpsGridInPlace(changeData, context = {}) {
    const container = document.getElementById('currentChangesList');
    if (!container) return;

    const { opsGrid, added, moved, deleted, modified, unchanged } = __getCurrentChangesOpsEls(container);
    if (!opsGrid || !added || !moved || !deleted || !modified) return;

    const { hasQuantityChange = false, hasStructureChange = false, stats = {}, diffMeta = {} } = context;
    const bookmarkDiff = diffMeta.bookmarkDiff || 0;
    const folderDiff = diffMeta.folderDiff || 0;
    const isZh = currentLang === 'zh_CN';

    // 数量变化部分 - 书签和文件夹合并显示（与原逻辑一致）
    const bookmarkAddedCount = typeof stats.bookmarkAdded === 'number' ? stats.bookmarkAdded : (bookmarkDiff > 0 ? bookmarkDiff : 0);
    const folderAddedCount = typeof stats.folderAdded === 'number' ? stats.folderAdded : (folderDiff > 0 ? folderDiff : 0);
    const bookmarkDeletedCount = typeof stats.bookmarkDeleted === 'number' ? stats.bookmarkDeleted : (bookmarkDiff < 0 ? Math.abs(bookmarkDiff) : 0);
    const folderDeletedCount = typeof stats.folderDeleted === 'number' ? stats.folderDeleted : (folderDiff < 0 ? Math.abs(folderDiff) : 0);

    const addedParts = [];
    if (bookmarkAddedCount > 0) addedParts.push(`${bookmarkAddedCount} ${isZh ? '个书签' : 'bookmarks'}`);
    if (folderAddedCount > 0) addedParts.push(`${folderAddedCount} ${isZh ? '个文件夹' : 'folders'}`);

    const deletedParts = [];
    if (bookmarkDeletedCount > 0) deletedParts.push(`${bookmarkDeletedCount} ${isZh ? '个书签' : 'bookmarks'}`);
    if (folderDeletedCount > 0) deletedParts.push(`${folderDeletedCount} ${isZh ? '个文件夹' : 'folders'}`);

    // 结构变化部分
    const { movedCount, modifiedCount } = await __computeMovedModifiedCountsForCurrentChanges(changeData, stats);

    const addedVisible = hasQuantityChange && addedParts.length > 0;
    const deletedVisible = hasQuantityChange && deletedParts.length > 0;
    const movedVisible = (movedCount > 0) || (stats.bookmarkMoved || stats.folderMoved);
    const modifiedVisible = (modifiedCount > 0) || (stats.bookmarkModified || stats.folderModified);

    __setCurrentChangesOpLine(added, {
        visible: addedVisible,
        prefix: '+',
        text: addedParts.join(isZh ? '，' : ', '),
        title: isZh ? '跳转至对应位置' : 'Jump to changes'
    });

    __setCurrentChangesOpLine(deleted, {
        visible: deletedVisible,
        prefix: '-',
        text: deletedParts.join(isZh ? '，' : ', '),
        title: isZh ? '跳转至对应位置' : 'Jump to changes'
    });

    const movedText = isZh
        ? (movedCount > 0 ? `${movedCount} 个移动` : '移动')
        : (movedCount > 0 ? `${movedCount} moved` : 'Moved');
    __setCurrentChangesOpLine(moved, {
        visible: movedVisible,
        prefix: '>>',
        text: movedVisible ? movedText : '',
        title: isZh ? '跳转至对应位置' : 'Jump to changes'
    });

    const modifiedText = isZh
        ? (modifiedCount > 0 ? `${modifiedCount} 个修改` : '修改')
        : (modifiedCount > 0 ? `${modifiedCount} modified` : 'Modified');
    __setCurrentChangesOpLine(modified, {
        visible: modifiedVisible,
        prefix: '~',
        text: modifiedVisible ? modifiedText : '',
        title: isZh ? '跳转至对应位置' : 'Jump to changes'
    });

    // 如果没有任何变化（hasChanges=true 但 diff 汇总没有变化的场景）
    const showUnchanged = !addedVisible && !deletedVisible && !movedVisible && !modifiedVisible && !hasQuantityChange && !hasStructureChange;
    __setCurrentChangesOpLine(unchanged, {
        visible: showUnchanged,
        prefix: '=',
        text: isZh ? '无变化' : 'No changes',
        display: 'block'
    });

    __updateCurrentChangesSingleOpLayout(opsGrid);
}

function bindCurrentChangesOpsEventsOnce() {
    try {
        const container = document.getElementById('currentChangesList');
        const opsGrid = container ? container.querySelector('.current-changes-ops-grid') : null;
        if (!opsGrid) return;
        if (opsGrid.dataset.opsBound === 'true') return;
        opsGrid.dataset.opsBound = 'true';

        opsGrid.addEventListener('click', (e) => {
            const btn = e.target.closest('.jump-to-related-btn');
            if (btn) {
                e.stopPropagation();
                const changeType = btn.dataset.changeType;
                highlightTreeNodesByChangeType(changeType);
                return;
            }
            const line = e.target.closest('.diff-line.clickable');
            if (!line) return;
            const changeType = line.dataset.changeType;
            highlightTreeNodesByChangeType(changeType);
        });
    } catch (_) { }
}

async function refreshCurrentChangesViewInPlace(reason = '') {
    if (currentView !== 'current-changes') return;
    const container = document.getElementById('currentChangesList');
    if (!container) return;

    // 若当前还没渲染出 diff 容器，直接回退为一次“正常渲染”（避免原地刷新找不到节点）
    const hasOpsGrid = !!container.querySelector('.current-changes-ops-grid');
    const hasDiffContainer = !!container.querySelector('.git-diff-container');
    if (!hasOpsGrid || !hasDiffContainer) {
        renderCurrentChangesViewWithRetry(1, false).catch(() => { });
        return;
    }

    if (currentChangesInPlaceRefreshInProgress) {
        currentChangesInPlaceRefreshQueued = true;
        return;
    }

    currentChangesInPlaceRefreshInProgress = true;
    try {
        const changeData = await getDetailedChanges(false);
        latestCurrentChangesData = changeData;

        if (!changeData || !changeData.hasChanges) {
            // 变化从有到无：需要切换到“无变化”态，交给完整渲染处理
            renderCurrentChangesViewWithRetry(1, false).catch(() => { });
            return;
        }

        const stats = changeData.stats || {};
        const diffMeta = changeData.diffMeta || {
            bookmarkDiff: stats.bookmarkDiff || 0,
            folderDiff: stats.folderDiff || 0,
            hasNumericalChange: stats.hasNumericalChange === true || (stats.bookmarkDiff !== 0 || stats.folderDiff !== 0),
            currentBookmarkCount: stats.currentBookmarkCount ?? stats.bookmarkCount ?? 0,
            currentFolderCount: stats.currentFolderCount ?? stats.folderCount ?? 0
        };
        const summary = buildChangeSummary(diffMeta, stats, currentLang);
        const bookmarkDiff = diffMeta.bookmarkDiff || 0;
        const folderDiff = diffMeta.folderDiff || 0;
        const hasQuantityChange = summary.hasQuantityChange || (bookmarkDiff !== 0 || folderDiff !== 0);
        const hasStructureChange = summary.hasStructuralChange;

        await updateCurrentChangesOpsGridInPlace(changeData, { hasQuantityChange, hasStructureChange, stats, diffMeta });
        bindCurrentChangesOpsEventsOnce();

        // 预览树：只刷新预览容器，避免整页重渲
        try {
            const previewContainer = document.getElementById('changesTreePreviewInline');
            if (previewContainer) {
                try { await ensureChangesPreviewTreeDataLoaded(); } catch (_) { }
                await renderChangesTreePreview(changeData);
                try { await maybeAutoExpandCurrentChangesCompactPreview(); } catch (_) { }
            }
        } catch (_) { }

        // 搜索：更新索引并刷新结果（如用户已输入）
        try {
            buildCurrentChangesSearchDb();
            if (searchUiState.view === 'current-changes' && searchUiState.query) {
                searchCurrentChangesAndRender(searchUiState.query);
            }
        } catch (_) { }
    } finally {
        currentChangesInPlaceRefreshInProgress = false;
        if (currentChangesInPlaceRefreshQueued) {
            currentChangesInPlaceRefreshQueued = false;
            refreshCurrentChangesViewInPlace('queued').catch(() => { });
        }
    }
}

function scheduleCurrentChangesRerender(reason = '') {
    if (currentView !== 'current-changes') return;
    if (pendingCurrentChangesEventTimer) clearTimeout(pendingCurrentChangesEventTimer);
    pendingCurrentChangesEventTimer = setTimeout(() => {
        pendingCurrentChangesEventTimer = null;
        // 不再整页重渲：debounce 后原地更新（必要时内部会回退到完整渲染）
        refreshCurrentChangesViewInPlace(reason).catch(() => { });
        try {
            // 同步刷新 cachedCurrentTree（供预览路径/tooltip/懒加载提示使用；轻量且去抖）
            scheduleCachedCurrentTreeSnapshotRefresh(reason);
        } catch (_) { }
    }, 350);
}

function highlightTreeNodesByChangeTypeInContainer(changeType, container, options = {}) {
    if (!container) return;
    const { onAutoExpandParent } = options;

    // 移除之前的所有高亮（在 .tree-item 上操作）
    container.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('highlight-added', 'highlight-deleted', 'highlight-modified', 'highlight-moved');
    });

    // 只高亮“节点自身”的变化类型（tree-change-*）。
    // 不使用 .change-badge.*，否则祖先路径上的聚合徽标也会被误高亮。
    // 注意：tree-change-mixed 类表示同时有 modified 和 moved，需要在两种情况下都选中。
    let selector;
    switch (changeType) {
        case 'added':
            selector = '.tree-item.tree-change-added';
            break;
        case 'deleted':
            selector = '.tree-item.tree-change-deleted';
            break;
        case 'modified':
            // modified 也选择 mixed 类（mixed = modified + moved）
            selector = '.tree-item.tree-change-modified, .tree-item.tree-change-mixed';
            break;
        case 'moved':
            // moved 也选择 mixed 类（mixed = modified + moved）
            selector = '.tree-item.tree-change-moved, .tree-item.tree-change-mixed';
            break;
        default:
            return;
    }

    const matchedElements = container.querySelectorAll(selector);
    const itemsToHighlight = new Set();

    matchedElements.forEach(el => {
        // 找到tree-item元素
        const treeItem = el.classList.contains('tree-item') ? el : el.closest('.tree-item');
        if (treeItem) {
            itemsToHighlight.add(treeItem);

            // 展开所有父节点
            let parent = treeItem.parentElement;
            while (parent && parent !== container) {
                if (parent.classList.contains('tree-children')) {
                    parent.classList.add('expanded');
                }
                const parentItem = parent.previousElementSibling;
                if (parentItem && parentItem.classList.contains('tree-item')) {
                    const toggle = parentItem.querySelector('.tree-toggle');
                    const folderIcon = parentItem.querySelector('.fa-folder');
                    if (toggle) toggle.classList.add('expanded');
                    if (folderIcon) {
                        folderIcon.classList.remove('fa-folder');
                        folderIcon.classList.add('fa-folder-open');
                    }
                    // 将自动展开的父节点写入状态（如需要）
                    const parentId = parentItem.getAttribute('data-node-id');
                    if (parentId && typeof onAutoExpandParent === 'function') onAutoExpandParent(String(parentId));
                }
                parent = parent.parentElement;
            }
        }
    });

    // 添加高亮动画
    itemsToHighlight.forEach(item => {
        item.classList.add(`highlight-${changeType}`);
    });

    // 滚动到第一个高亮的节点
    if (itemsToHighlight.size > 0) {
        const firstItem = Array.from(itemsToHighlight)[0];
        firstItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // 动画结束后移除高亮类
    setTimeout(() => {
        itemsToHighlight.forEach(item => {
            item.classList.remove(`highlight-${changeType}`);
        });
    }, 1200); // 0.6s * 2次 = 1.2s
}

// 点击diff行时高亮对应的书签树节点（当前变化预览）
async function highlightTreeNodesByChangeType(changeType) {
    const previewContainer = document.getElementById('changesTreePreviewInline');
    if (!previewContainer) return;

    // 当前变化预览使用懒加载，需要先展开到对应变化类型的节点位置
    // 从 treeChangeMap 中找到对应变化类型的节点ID，然后展开其祖先路径
    const treeEl = document.getElementById('preview_bookmarkTree');
    const previewIndex = (window.__changesPreviewTreeIndex instanceof Map) ? window.__changesPreviewTreeIndex : null;

    if (treeEl && previewIndex && treeChangeMap instanceof Map) {
        const movedSet = __getActiveExplicitMovedIdSetFromMap(explicitMovedIds);
        const targetIds = [];

        // 找出对应变化类型的节点ID
        treeChangeMap.forEach((change, id) => {
            if (id == null || !change || !change.type) return;
            const types = change.type.split('+');
            let match = false;
            switch (changeType) {
                case 'added':
                    match = types.includes('added');
                    break;
                case 'deleted':
                    match = types.includes('deleted');
                    break;
                case 'modified':
                    match = types.includes('modified');
                    break;
                case 'moved':
                    match = types.includes('moved');
                    break;
            }
            if (match) targetIds.push(String(id));
        });

        // 对于 moved 类型，也检查 explicitMovedIds
        if (changeType === 'moved') {
            movedSet.forEach(id => {
                if (!targetIds.includes(String(id))) {
                    targetIds.push(String(id));
                }
            });
        }

        // 收集所有目标节点的祖先路径，按深度排序
        const folderDepthMap = new Map();
        for (const targetId of targetIds) {
            const chain = __buildIdChainToRoot(targetId, previewIndex);
            if (!chain.length) continue;
            const ancestorsToExpand = chain.slice(0, -1).filter(id => id && id !== '0');
            for (let i = 0; i < ancestorsToExpand.length; i++) {
                const fid = ancestorsToExpand[i];
                const depth = i + 1;
                if (!folderDepthMap.has(fid) || folderDepthMap.get(fid) > depth) {
                    folderDepthMap.set(fid, depth);
                }
            }
        }

        // 按深度排序后展开
        const sortedFolders = Array.from(folderDepthMap.entries())
            .sort((a, b) => a[1] - b[1])
            .map(entry => entry[0]);

        for (const folderId of sortedFolders) {
            const expanded = await __expandReadOnlyFolderById(treeEl, folderId);
            // 如果成功展开且触发了懒加载，给DOM一帧时间来渲染子节点
            if (expanded) {
                await new Promise(resolve => requestAnimationFrame(resolve));
            }
        }
    }

    // 现在所有目标节点应该都已经被渲染，可以正常查找和高亮
    highlightTreeNodesByChangeTypeInContainer(changeType, previewContainer, {
        onAutoExpandParent: (parentId) => {
            try { saveChangesPreviewExpandedState(String(parentId), true); } catch (_) { }
        }
    });
}

// =============================================================================
// 当前变化：简略模式默认展开至“第一处变化”（但变化太多时不自动展开）
// =============================================================================

const SIMPLE_MODE_AUTO_EXPAND_MAX_BOOKMARKS = 50;
const SIMPLE_MODE_AUTO_EXPAND_MAX_FOLDERS = 10;

function __getActiveExplicitMovedIdSetFromMap(explicitMovedIdMap) {
    const out = new Set();
    try {
        const now = Date.now();
        if (!(explicitMovedIdMap instanceof Map)) return out;
        for (const [id, expiry] of explicitMovedIdMap.entries()) {
            if (typeof expiry !== 'number' || expiry > now) out.add(String(id));
        }
    } catch (_) { }
    return out;
}

function __countChangedNodesForAutoExpand(changedIds, previewIndex, oldIndex) {
    let changedBookmarks = 0;
    let changedFolders = 0;
    if (!(changedIds instanceof Set) || changedIds.size === 0) {
        return { changedBookmarks, changedFolders };
    }

    changedIds.forEach((id) => {
        const sid = String(id);
        const node = (previewIndex instanceof Map ? previewIndex.get(sid) : null) ||
            (oldIndex instanceof Map ? oldIndex.get(sid) : null);

        const isFolder = !!(node && !node.url && node.children);
        if (isFolder) changedFolders += 1;
        else changedBookmarks += 1;
    });

    return { changedBookmarks, changedFolders };
}

function __findFirstChangedIdByDfs(rootNode, isChanged) {
    if (!rootNode || typeof isChanged !== 'function') return null;
    const stack = [rootNode];
    while (stack.length) {
        const node = stack.pop();
        if (!node || node.id == null) continue;
        const sid = String(node.id);
        if (isChanged(sid, node)) return sid;
        if (Array.isArray(node.children) && node.children.length) {
            for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
        }
    }
    return null;
}

function __buildIdChainToRoot(targetId, index) {
    const chain = [];
    if (!targetId || !(index instanceof Map)) return chain;
    let cur = String(targetId);
    let guard = 0;
    while (guard++ < 512) {
        chain.push(cur);
        const node = index.get(cur);
        if (!node) break;
        const parentId = node.parentId != null ? String(node.parentId) : '';
        if (!parentId) break;
        if (parentId === cur) break;
        cur = parentId;
        if (cur === '0') {
            chain.push(cur);
            break;
        }
    }
    return chain.reverse(); // root -> ... -> target
}

async function __expandReadOnlyFolderById(treeEl, folderId) {
    if (!treeEl || !folderId) return false;
    const idStr = String(folderId);
    const item = treeEl.querySelector(`.tree-item[data-node-id="${CSS.escape(idStr)}"]`);
    if (!item) return false;
    if ((item.getAttribute('data-node-type') || item.dataset.nodeType) !== 'folder') return true;
    const treeNode = item.closest('.tree-node');
    const children = treeNode?.querySelector(':scope > .tree-children');
    const toggle = item.querySelector('.tree-toggle');
    if (toggle) toggle.classList.add('expanded');
    if (children) children.classList.add('expanded');
    const icon = item.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
    if (icon) {
        icon.classList.remove('fa-folder');
        icon.classList.add('fa-folder-open');
    }

    // Readonly preview uses the same lazy loader; load just the needed path.
    try {
        if (children &&
            item.dataset &&
            item.dataset.childrenLoaded === 'false' &&
            item.dataset.hasChildren === 'true' &&
            typeof loadPermanentFolderChildrenLazy === 'function') {
            await loadPermanentFolderChildrenLazy(idStr, children, 0, null, true);
        }
    } catch (_) { /* ignore */ }

    return true;
}

async function maybeAutoExpandCurrentChangesCompactPreview() {
    if (currentView !== 'current-changes') return;
    const previewRoot = document.getElementById('changesTreePreviewInline');
    if (!previewRoot || !previewRoot.classList.contains('compact-mode')) return;

    // Build changed id set (treeChangeMap + explicit moved ids).
    const movedSet = __getActiveExplicitMovedIdSetFromMap(explicitMovedIds);
    const changedIds = new Set();
    try {
        if (treeChangeMap instanceof Map) {
            treeChangeMap.forEach((_, id) => {
                if (id != null) changedIds.add(String(id));
            });
        }
        movedSet.forEach(id => changedIds.add(String(id)));
    } catch (_) { /* ignore */ }

    const previewIndex = (window.__changesPreviewTreeIndex instanceof Map) ? window.__changesPreviewTreeIndex : null;
    let oldIndex = null;
    try {
        if (cachedOldTree && cachedOldTree[0] && typeof buildTreeIndexFromRoot === 'function') {
            oldIndex = buildTreeIndexFromRoot(cachedOldTree[0]);
        }
    } catch (_) { oldIndex = null; }

    const { changedBookmarks, changedFolders } = __countChangedNodesForAutoExpand(changedIds, previewIndex, oldIndex);
    if (changedBookmarks >= SIMPLE_MODE_AUTO_EXPAND_MAX_BOOKMARKS || changedFolders >= SIMPLE_MODE_AUTO_EXPAND_MAX_FOLDERS) {
        // 变化太多时，尝试恢复用户之前保存的状态
        try {
            const treeEl = document.getElementById('preview_bookmarkTree');
            if (treeEl) {
                const userState = getChangesPreviewExpandedState();
                if (userState && userState.length > 0) {
                    for (const folderId of userState) {
                        await __expandReadOnlyFolderById(treeEl, folderId);
                    }
                }
            }
        } catch (_) { /* ignore */ }
        return;
    }

    const treeEl = document.getElementById('preview_bookmarkTree');
    if (!treeEl) return;

    // 收集所有变化节点的祖先路径，记录每个节点的深度
    // Map<folderId, depth>
    const folderDepthMap = new Map();
    for (const changedId of changedIds) {
        const chain = __buildIdChainToRoot(changedId, previewIndex);
        if (!chain.length) continue;
        // chain: [root, ..., parent, changedId]
        // 展开到变化节点的父级（如果变化的是文件夹则展开到该文件夹所在位置，不展开文件夹内部）
        const ancestorsToExpand = chain.slice(0, -1).filter(id => id && id !== '0');
        for (let i = 0; i < ancestorsToExpand.length; i++) {
            const fid = ancestorsToExpand[i];
            // depth = i+1 (因为已经过滤掉了 root '0')
            const depth = i + 1;
            // 记录最小深度（如果同一个文件夹在多个路径中出现）
            if (!folderDepthMap.has(fid) || folderDepthMap.get(fid) > depth) {
                folderDepthMap.set(fid, depth);
            }
        }
    }

    // 按深度排序：深度小的先展开（从根向叶展开，确保父节点先被展开/加载）
    const sortedFolders = Array.from(folderDepthMap.entries())
        .sort((a, b) => a[1] - b[1])
        .map(entry => entry[0]);

    // 自动展开到所有变化节点的位置（不保存状态）
    // 按层级顺序展开，确保父节点先展开，子节点的DOM才会被懒加载出来
    for (const folderId of sortedFolders) {
        const expanded = await __expandReadOnlyFolderById(treeEl, folderId);
        // 如果成功展开且触发了懒加载，给DOM一帧时间来渲染子节点
        if (expanded) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    // 然后恢复用户之前手动保存的展开/折叠状态
    try {
        const userState = getChangesPreviewExpandedState();
        if (userState && userState.length > 0) {
            // 用户手动展开的节点
            for (const folderId of userState) {
                await __expandReadOnlyFolderById(treeEl, folderId);
            }
        }
    } catch (_) { /* ignore */ }

    // Scroll the first visible changed node into view.
    try {
        const rootNode = window.__changesPreviewTreeRoot || (cachedCurrentTree && cachedCurrentTree[0]) || null;
        const firstChangedId = __findFirstChangedIdByDfs(rootNode, (sid) => changedIds.has(String(sid)));
        if (firstChangedId) {
            const item = treeEl.querySelector(`.tree-item[data-node-id="${CSS.escape(String(firstChangedId))}"]`);
            if (item) item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } catch (_) { /* ignore */ }
}

function getChangesPreviewExpandedState() {
    try {
        const modeKey = __getChangesPreviewExpandedStorageKey();
        const savedMode = localStorage.getItem(modeKey);
        if (savedMode) {
            const parsed = JSON.parse(savedMode);
            return Array.isArray(parsed) ? parsed : [];
        }

        // Backward compat: legacy non-mode key.
        const legacy = localStorage.getItem(CHANGES_PREVIEW_EXPANDED_KEY);
        if (legacy) {
            const parsed = JSON.parse(legacy);
            return Array.isArray(parsed) ? parsed : [];
        }

        return [];
    } catch (e) {
        return [];
    }
}

function saveChangesPreviewExpandedState(nodeId, isExpanded) {
    try {
        const storageKey = __getChangesPreviewExpandedStorageKey();
        const expandedIds = getChangesPreviewExpandedState();
        const index = expandedIds.indexOf(nodeId);

        if (isExpanded && index === -1) {
            expandedIds.push(nodeId);
        } else if (!isExpanded && index !== -1) {
            expandedIds.splice(index, 1);
        }

        localStorage.setItem(storageKey, JSON.stringify(expandedIds));
    } catch (e) {
        console.warn('[书签树预览] 保存展开状态失败:', e);
    }
}

function getChangesPreviewScrollTop() {
    try {
        const modeKey = __getChangesPreviewScrollStorageKey();
        const savedMode = localStorage.getItem(modeKey);
        const saved = savedMode != null ? savedMode : localStorage.getItem(CHANGES_PREVIEW_SCROLL_KEY);
        const value = saved != null ? parseInt(saved, 10) : 0;
        return Number.isNaN(value) ? 0 : value;
    } catch (e) {
        return 0;
    }
}

function saveChangesPreviewScrollTop(scrollTop) {
    try {
        const value = typeof scrollTop === 'number' && !Number.isNaN(scrollTop) ? scrollTop : 0;
        localStorage.setItem(__getChangesPreviewScrollStorageKey(), String(value));
    } catch (e) {
        console.warn('[书签树预览] 保存滚动位置失败:', e);
    }
}

const __changesPreviewScrollHandlers = new WeakMap();
const __changesPreviewScrollGuards = new Map();
const __changesPreviewInteractionHandlers = new WeakMap();
const __changesPreviewSettleObservers = new WeakMap();

function __showChangesPreviewAfterSettle(targetContainer, previewBody, observeRoot) {
    if (!targetContainer) return;

    // Always start hidden to avoid visible scroll/layout jitter.
    try { targetContainer.style.visibility = 'hidden'; } catch (_) { }

    // Disconnect any previous observer attached to this container.
    try {
        const prev = __changesPreviewSettleObservers.get(targetContainer);
        if (prev && prev.disconnect) prev.disconnect();
    } catch (_) { }

    // Wait until DOM mutations quiet down for a short window, then show.
    // This hides "late" lazy-load / layout adjustments during initial render.
    const QUIET_MS = 140;
    const MAX_WAIT_MS = 1200;
    let lastMutationAt = Date.now();
    let done = false;

    const finish = () => {
        if (done) return;
        done = true;
        try { targetContainer.style.visibility = ''; } catch (_) { }
        try { __maybeReapplyChangesPreviewScroll(previewBody); } catch (_) { }
        try {
            const prev = __changesPreviewSettleObservers.get(targetContainer);
            if (prev && prev.disconnect) prev.disconnect();
        } catch (_) { }
    };

    let obs = null;
    try {
        if (observeRoot && window.MutationObserver) {
            obs = new MutationObserver(() => {
                lastMutationAt = Date.now();
                try { __maybeReapplyChangesPreviewScroll(previewBody); } catch (_) { }
            });
            obs.observe(observeRoot, { childList: true, subtree: true });
            __changesPreviewSettleObservers.set(targetContainer, obs);
        }
    } catch (_) {
        obs = null;
    }

    const start = Date.now();
    const tick = () => {
        if (done) return;
        const now = Date.now();
        if ((now - lastMutationAt) >= QUIET_MS) {
            finish();
            return;
        }
        if ((now - start) >= MAX_WAIT_MS) {
            finish();
            return;
        }
        setTimeout(tick, 60);
    };
    setTimeout(tick, 60);
}

function __maybeReapplyChangesPreviewScroll(previewBody) {
    if (!previewBody) return;
    try {
        const key = __getChangesPreviewScrollStorageKey();
        const guard = __changesPreviewScrollGuards.get(key);
        if (!guard) return;

        const now = Date.now();
        if (now >= guard.suppressUntil) {
            __changesPreviewScrollGuards.delete(key);
            return;
        }

        // If user hasn't interacted, keep scrollTop stable against async layout shifts.
        const restoredTop = guard.restoredTop || 0;
        const delta = Math.abs((previewBody.scrollTop || 0) - restoredTop);
        if (!guard.userInteracted && restoredTop > 0 && delta > 2) {
            try { previewBody.scrollTop = restoredTop; } catch (_) { }
            requestAnimationFrame(() => {
                try { previewBody.scrollTop = restoredTop; } catch (_) { }
            });
        }
    } catch (_) { }
}

function __bindChangesPreviewBodyScrollPersistence(previewBody) {
    if (!previewBody) return;
    try {
        const prev = __changesPreviewScrollHandlers.get(previewBody);
        if (prev) previewBody.removeEventListener('scroll', prev);
    } catch (_) { }

    const handler = () => {
        try {
            const key = __getChangesPreviewScrollStorageKey();
            const guard = __changesPreviewScrollGuards.get(key);
            if (guard) {
                const now = Date.now();
                // During restore window, ignore auto scroll changes unless user interacted.
                if (now < guard.suppressUntil && !guard.userInteracted) {
                    return;
                }
                if (now >= guard.suppressUntil) {
                    __changesPreviewScrollGuards.delete(key);
                }
            }
            saveChangesPreviewScrollTop(previewBody.scrollTop);
        } catch (_) { }
    };
    previewBody.addEventListener('scroll', handler, { passive: true });
    __changesPreviewScrollHandlers.set(previewBody, handler);

    // Mark user interaction to stop auto-stabilization.
    try {
        const prev = __changesPreviewInteractionHandlers.get(previewBody);
        if (prev) {
            previewBody.removeEventListener('wheel', prev);
            previewBody.removeEventListener('touchstart', prev);
            previewBody.removeEventListener('pointerdown', prev);
            previewBody.removeEventListener('keydown', prev);
        }
    } catch (_) { }
    const onInteract = () => {
        try {
            const key = __getChangesPreviewScrollStorageKey();
            const guard = __changesPreviewScrollGuards.get(key);
            if (guard) guard.userInteracted = true;
        } catch (_) { }
    };
    try {
        previewBody.addEventListener('wheel', onInteract, { passive: true });
        previewBody.addEventListener('touchstart', onInteract, { passive: true });
        previewBody.addEventListener('pointerdown', onInteract, { passive: true });
        previewBody.addEventListener('keydown', onInteract);
    } catch (_) { }
    __changesPreviewInteractionHandlers.set(previewBody, onInteract);
}

function __restoreChangesPreviewBodyScroll(previewBody, targetTop) {
    if (!previewBody) return;
    const top = typeof targetTop === 'number' && !Number.isNaN(targetTop) ? targetTop : 0;

    try {
        const key = __getChangesPreviewScrollStorageKey();
        __changesPreviewScrollGuards.set(key, {
            restoredTop: top,
            suppressUntil: Date.now() + 6000,
            userInteracted: false
        });
    } catch (_) { }

    // Use multi-phase restore to survive async layout / font load.
    try { previewBody.scrollTop = top; } catch (_) { }
    requestAnimationFrame(() => {
        try { previewBody.scrollTop = top; } catch (_) { }
        setTimeout(() => {
            try { previewBody.scrollTop = top; } catch (_) { }
        }, 60);
        setTimeout(() => {
            try { previewBody.scrollTop = top; } catch (_) { }
        }, 240);
        setTimeout(() => {
            try { previewBody.scrollTop = top; } catch (_) { }
        }, 600);
    });
}

// 渲染书签树映射预览（完全克隆永久栏目）
// 渲染书签树映射预览（优化版：独立渲染稀疏树，不克隆内容）
async function renderChangesTreePreview(changeData) {
    const targetContainer = document.getElementById('changesTreePreviewInline');
    if (!targetContainer) return;

    // Hide during build to avoid visible jitter.
    try { targetContainer.style.visibility = 'hidden'; } catch (_) { }

    try {
        console.log('[书签树映射预览] 开始...');

        let lastScrollTop = getChangesPreviewScrollTop();
        const existingPreviewBody = targetContainer.querySelector('.changes-preview-readonly .permanent-section-body');
        if (existingPreviewBody) {
            lastScrollTop = existingPreviewBody.scrollTop;
            saveChangesPreviewScrollTop(lastScrollTop);
        }

        // 1. 准备永久栏目模板源（用于预览树）
        let permanentSection = document.getElementById('permanentSection');
        if (!permanentSection) {
            permanentSection = document.createElement('div');
            permanentSection.id = 'permanentSection';
            permanentSection.className = 'permanent-bookmark-section';
            permanentSection.innerHTML = `
                <div class=\"permanent-section-body\">
                    <div id=\"bookmarkTree\" class=\"bookmark-tree\"></div>
                </div>
            `;
        }

        // 之前这里调用 renderTreeViewSync()，会额外渲染一次 #bookmarkTree（完全没必要），
        // 在“大量书签 + 大量变化”时会造成明显卡顿/黑屏感。
        const hasChangesFlag = !!(changeData && changeData.hasChanges);
        const mapEmptyWithChanges = hasChangesFlag && (treeChangeMap instanceof Map) && treeChangeMap.size === 0;
        const shouldReloadPreviewData = !cachedCurrentTree || !treeChangeMap || mapEmptyWithChanges;

        if (shouldReloadPreviewData) {
            console.log('[书签树映射预览] 数据未就绪，准备变化预览数据...');
            // 先给用户一个可见的占位，避免长时间空白
            try {
                targetContainer.innerHTML = `<div class="loading" style="padding:10px 12px;">${i18n.loading?.[currentLang] || (currentLang === 'zh_CN' ? '加载中...' : 'Loading...')}</div>`;
            } catch (_) { }
            // 让出一帧，确保 Loading 能先绘制出来
            await new Promise(resolve => requestAnimationFrame(() => resolve()));
            await ensureChangesPreviewTreeDataLoaded({ requireDiffMap: hasChangesFlag });
        }

        if (!permanentSection || !cachedCurrentTree) {
            console.error('[书签树映射预览] 无法获取模板或数据');
            targetContainer.innerHTML = `<div class="empty-state-small">${currentLang === 'zh_CN' ? '暂无可用的预览数据' : 'No preview data available'}</div>`;
            return;
        }

        // 3. 构建预览容器（只克隆外壳）
        console.log('[书签树映射预览] 构建独立渲染容器...');
        let previewSection = document.getElementById('changesPreviewPermanentSection');

        if (!previewSection) {
            // 克隆外壳，但清空内容
            previewSection = permanentSection.cloneNode(true);
            previewSection.id = 'changesPreviewPermanentSection';
            previewSection.classList.add('changes-preview-readonly');

            // 清空树的容器，准备重新渲染
            const innerTree = previewSection.querySelector('#bookmarkTree');
            if (innerTree) {
                innerTree.id = 'preview_bookmarkTree'; // 修改ID
                innerTree.innerHTML = ''; // 关键：清空内容！
            }

            // 修改其他 ID，防止冲突
            previewSection.querySelectorAll('[id]').forEach(el => {
                if (el.id !== 'changesPreviewPermanentSection' && el.id !== 'preview_bookmarkTree') {
                    el.id = 'preview_' + el.id;
                }
            });

            // UI 调整（隐藏不需要的元素）
            const header = previewSection.querySelector('.permanent-section-header');
            if (header) header.style.display = 'none';
            const treeLegend = previewSection.querySelector('.tree-legend');
            if (treeLegend) treeLegend.style.display = 'none';

            // 存入容器
            targetContainer.innerHTML = '';
            targetContainer.appendChild(previewSection);
        }

        // 4. 在新容器中独立渲染树
        const previewTreeContainer = previewSection.querySelector('#preview_bookmarkTree');
        if (previewTreeContainer) {
            previewTreeContainer.dataset.treeReadonly = 'true';
            previewTreeContainer.innerHTML = ''; // 再次确保干净

            // A. 生成树结构（使用 cachedCurrentTree + oldTree，必要时合并 deleted 节点）
            // 注意：Current Changes 预览必须使用“永久栏目同款懒加载”来避免 DOM 爆炸。
            // 这里我们只用 forceExpandSet 提供“包含变化”的提示点，不用它来强制递归渲染。
            const fragment = document.createDocumentFragment();
            const tempDiv = document.createElement('div');

            // Current Changes 预览：如有 deleted 节点，合并 oldTree 以保留原位置展示
            let treeToRender = cachedCurrentTree;
            try {
                const oldTree = cachedOldTree;
                if (oldTree && oldTree[0] && treeChangeMap && treeChangeMap.size > 0) {
                    let hasDeleted = false;
                    for (const [, ch] of treeChangeMap) {
                        if (ch && ch.type === 'deleted') { hasDeleted = true; break; }
                    }
                    if (hasDeleted && typeof rebuildTreeWithDeleted === 'function') {
                        treeToRender = rebuildTreeWithDeleted(oldTree, cachedCurrentTree, treeChangeMap);
                    }
                }
            } catch (_) {
                treeToRender = cachedCurrentTree;
            }

            try {
                const map = new Map();
                const stack = (treeToRender && treeToRender[0]) ? [treeToRender[0]] : [];
                while (stack.length) {
                    const node = stack.pop();
                    if (!node || node.id == null) continue;
                    map.set(String(node.id), node);
                    if (Array.isArray(node.children) && node.children.length) {
                        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
                    }
                }
                window.__changesPreviewTreeIndex = map;
                // Keep an ordered root reference so we can deterministically pick "the first change" for auto-expand.
                window.__changesPreviewTreeRoot = (treeToRender && treeToRender[0]) ? treeToRender[0] : null;
            } catch (_) { }

            let movedSet = null;
            try {
                const now = Date.now();
                if (explicitMovedIds instanceof Map) {
                    movedSet = new Set();
                    for (const [id, expiry] of explicitMovedIds.entries()) {
                        if (typeof expiry !== 'number' || expiry > now) {
                            movedSet.add(String(id));
                        }
                    }
                }
            } catch (_) {
                movedSet = null;
            }

            // 懒加载提示集合（灰点）：避免 O(N) 整树扫描，直接用 changeMap 回溯祖先。
            let hintSet = null;
            try {
                hintSet = computeChangesHintSetFast(treeChangeMap, movedSet);
            } catch (_) {
                hintSet = null;
            }

            // 祖先聚合徽标（+/-/~/>>）：不加载子树也可看到变化类型
            try {
                const badgeMap = computeAncestorChangeBadgesFast(treeChangeMap, movedSet);
                window.__changesPreviewAncestorBadges = badgeMap;
            } catch (_) {
                try { window.__changesPreviewAncestorBadges = null; } catch (_) { }
            }

            // Expose for lazy-load rendering (Current Changes preview only)
            try { window.__changesPreviewHintSet = hintSet; } catch (_) { }

            tempDiv.innerHTML = renderTreeNodeWithChanges(treeToRender[0], 0, 50, new Set(), hintSet, {
                forceExpandOverrideLazyStop: false,
                preferPreviewAncestorBadges: true
            });

            while (tempDiv.firstChild) {
                fragment.appendChild(tempDiv.firstChild);
            }
            previewTreeContainer.appendChild(fragment);

            // C. 绑定必要的交互事件（折叠/展开、点击跳转）
            // 我们复用 attachTreeEvents，它会处理 class 为 tree-toggle 的点击
            attachTreeEvents(previewTreeContainer);

            try {
                restoreTreeExpandState(previewTreeContainer);
            } catch (_) { }

            // 注意：预览树保持“严格懒加载”，不在详细模式下自动加载子树。
        }

        // 5. 恢复滚动位置
        const previewBody = previewSection.querySelector('.permanent-section-body');
        if (previewBody) {
            __restoreChangesPreviewBodyScroll(previewBody, lastScrollTop);
            __bindChangesPreviewBodyScrollPersistence(previewBody);

            // Re-apply on late async mutations (lazy-load / icon load / layout).
            try {
                const treeForObserve = previewSection.querySelector('#preview_bookmarkTree');
                if (treeForObserve && window.MutationObserver) {
                    const until = Date.now() + 5000;
                    const obs = new MutationObserver(() => {
                        try {
                            if (Date.now() > until) {
                                try { obs.disconnect(); } catch (_) { }
                                return;
                            }
                            __maybeReapplyChangesPreviewScroll(previewBody);
                        } catch (_) { }
                    });
                    obs.observe(treeForObserve, { childList: true, subtree: true });
                    setTimeout(() => {
                        try { obs.disconnect(); } catch (_) { }
                    }, 5200);
                }
            } catch (_) { }
        }

        console.log('[书签树映射预览] 完成 (独立内核模式)');

        // Show only after initial DOM settles (prevents post-render "jump").
        try {
            const observeRoot = previewTreeContainer || previewSection;
            __showChangesPreviewAfterSettle(targetContainer, previewBody, observeRoot);
        } catch (_) {
            try { targetContainer.style.visibility = ''; } catch (_) { }
        }

    } catch (error) {
        console.error('[书签树映射预览] 失败:', error);
        targetContainer.innerHTML = '';
    }
}










// 初始化书签树映射预览的交互
function initChangesTreePreview() {
    const previewSection = document.getElementById('changesTreePreview');
    const toggleBtn = document.getElementById('changesTreeToggleBtn');
    const editBtn = document.getElementById('changesTreeEditBtn');
    const header = document.querySelector('.changes-tree-header');

    if (!previewSection) return;

    // 折叠/展开功能
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            previewSection.classList.toggle('collapsed');
        });
    }

    // 点击头部也可以折叠/展开
    if (header) {
        header.addEventListener('click', (e) => {
            if (e.target.closest('.changes-tree-action-btn')) return;
            previewSection.classList.toggle('collapsed');
        });
    }

    if (editBtn && editBtn.parentNode) {
        editBtn.parentNode.removeChild(editBtn);
    }
}

function isReadOnlyBookmarkTreeContainer(treeContainer) {
    try {
        if (!treeContainer) return false;
        if (treeContainer.dataset && treeContainer.dataset.treeReadonly === 'true') return true;
        if (treeContainer.classList && treeContainer.classList.contains('history-tree-container')) return true;
        if (treeContainer.closest && treeContainer.closest('.changes-preview-readonly')) return true;
        if (treeContainer.closest && treeContainer.closest('[data-tree-readonly="true"]')) return true;
        return false;
    } catch (_) {
        return false;
    }
}

// 带重试机制的渲染函数
async function renderCurrentChangesViewWithRetry(maxRetries = 3, forceRefresh = false) {
    // 合并并发请求，避免多次抖动
    if (isRenderingCurrentChangesView) {
        pendingCurrentChangesRender = pendingCurrentChangesRender || { maxRetries: 0, forceRefresh: false };
        pendingCurrentChangesRender.maxRetries = Math.max(pendingCurrentChangesRender.maxRetries, maxRetries);
        pendingCurrentChangesRender.forceRefresh = pendingCurrentChangesRender.forceRefresh || forceRefresh;
        console.log('[渲染重试] 已有渲染在进行中，合并请求:', pendingCurrentChangesRender);
        return;
    }

    isRenderingCurrentChangesView = true;

    try {
        let finalChangeData = null;
        let finalForceRefresh = forceRefresh;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`[渲染重试] 第 ${attempt}/${maxRetries} 次尝试`);

            // 默认不强制刷新：允许复用 background 的缓存，避免每次都重算。
            // 若第一次结果缺少详细列表，再在后续重试中强制刷新。
            const shouldForceRefresh = forceRefresh || attempt > 1;

            // 先静默获取数据，不碰 UI，避免多次抖动
            const changeData = await getDetailedChanges(shouldForceRefresh);
            finalChangeData = changeData;
            finalForceRefresh = shouldForceRefresh;

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
                console.log(`[渲染重试] 完成，不再重试（即将一次性渲染 UI）`);
                break;
            }

            // 等待 300ms 后重试
            console.log(`[渲染重试] 等待 300ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 仅在最终数据确定后渲染一次 UI，避免多次抖动
        await renderCurrentChangesView(finalForceRefresh, { prefetchedChangeData: finalChangeData });
    } finally {
        isRenderingCurrentChangesView = false;

        // 如果期间又有新的请求，合并后再额外渲染一次
        if (pendingCurrentChangesRender) {
            const next = pendingCurrentChangesRender;
            pendingCurrentChangesRender = null;
            console.log('[渲染重试] 处理挂起的渲染请求:', next);
            // 不递归阻塞：异步延迟一段时间再执行，防抖动
            setTimeout(() => {
                renderCurrentChangesViewWithRetry(next.maxRetries, next.forceRefresh);
            }, 300);
        }
    }
}

async function renderCurrentChangesView(forceRefresh = false, options = {}) {
    const { prefetchedChangeData = null } = options;
    const container = document.getElementById('currentChangesList');

    // 仅在首次渲染或容器为空时显示加载状态，避免刷新时闪烁
    const isFirstRender = !container.children.length || container.querySelector('.loading') || container.querySelector('.no-changes-message');
    if (isFirstRender) {
        container.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    }

    console.log('[当前变化视图] 开始加载...', forceRefresh ? '(强制刷新)' : '');

    try {
        // 从 background 获取详细变化数据（如果上游已预取，则复用）
        const changeData = prefetchedChangeData || await getDetailedChanges(forceRefresh);

        console.log('[当前变化视图] 获取到的数据:', changeData);

        if (!changeData || !changeData.hasChanges) {
            // 没有变化
            console.log('[当前变化视图] 无变化');
            // 清理缓存，避免搜索/定位使用旧数据
            try { treeChangeMap = new Map(); } catch (_) { }
            try {
                cachedCurrentTree = null;
                cachedOldTree = null;
                cachedCurrentTreeIndex = null;
                cachedRenderTreeIndex = null;
                try { window.__canvasRenderTreeIndex = null; } catch (_) { }
                try { window.__changesPreviewTreeIndex = null; } catch (_) { }
                try { window.__changesPreviewTreeRoot = null; } catch (_) { }
                try { window.__changesPreviewHintSet = null; } catch (_) { }
                try { window.__changesPreviewAncestorBadges = null; } catch (_) { }
            } catch (_) { }
            try { resetCurrentChangesSearchDb('no-changes'); } catch (_) { }
            try { hideSearchResultsPanel(); } catch (_) { }
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

        // 确保 hasNumericalChange 正确设置（即使 diffMeta 来自 changeData）
        const bookmarkDiff = diffMeta.bookmarkDiff || 0;
        const folderDiff = diffMeta.folderDiff || 0;
        if (!diffMeta.hasNumericalChange && (bookmarkDiff !== 0 || folderDiff !== 0)) {
            diffMeta.hasNumericalChange = true;
        }

        const summary = buildChangeSummary(diffMeta, stats, currentLang);
        // 直接检查是否有数量变化（不仅依赖 summary）
        const hasQuantityChange = summary.hasQuantityChange || (bookmarkDiff !== 0 || folderDiff !== 0);
        const hasStructureChange = summary.hasStructuralChange;

        if (hasQuantityChange || hasStructureChange) {
            // Git diff 风格的容器
            html += '<div class="git-diff-container">';

            // diff 头部
            html += '<div class="diff-header">';
            html += `<span class="diff-title">${currentLang === 'zh_CN' ? '当前变化' : 'Current Changes'}</span>`;
            // 图例放在标题右边
            html += '<span class="diff-header-legend">';
            html += `<span class="legend-item"><span class="legend-dot added"></span>${currentLang === 'zh_CN' ? '新增' : 'Added'}</span>`;
            html += `<span class="legend-item"><span class="legend-dot deleted"></span>${currentLang === 'zh_CN' ? '删除' : 'Deleted'}</span>`;
            html += `<span class="legend-item"><span class="legend-dot moved"></span>${currentLang === 'zh_CN' ? '移动' : 'Moved'}</span>`;
            html += `<span class="legend-item"><span class="legend-dot modified"></span>${currentLang === 'zh_CN' ? '修改' : 'Modified'}</span>`;
            html += '</span>';
            html += '<span class="diff-header-spacer"></span>';
            // 导出按钮
            html += `<button class="diff-edit-btn icon-only" id="exportChangesBtn">`;
            html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
            html += `<span class="btn-tooltip">${currentLang === 'zh_CN' ? '导出变化' : 'Export Changes'}</span>`;
            html += '</button>';
            // 详略切换按钮 - 使用两个SVG图标，根据状态显示不同图标
            // 详细模式图标：4条横线（表示展开全部）
            // 简略模式图标：2条横线（表示只显示变化）
            html += `<button class="diff-edit-btn icon-only" id="toggleTreeDetailBtn">`;
            // 默认显示详细模式图标（4条横线）
            html += '<svg class="icon-detail" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
            // 简略模式图标（2条横线+高亮）- 默认隐藏
            html += '<svg class="icon-compact" style="display:none" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><circle cx="2" cy="9" r="1.5" fill="currentColor" stroke="none"/><circle cx="2" cy="15" r="1.5" fill="currentColor" stroke="none"/></svg>';
            html += `<span class="btn-tooltip" id="toggleTreeDetailTooltip">${currentLang === 'zh_CN' ? '切换为简略' : 'Switch to compact'}</span>`;
            html += '</button>';
            // 全部撤销按钮
            html += `<button class="diff-edit-btn icon-only" id="revertAllCurrentBtn">`;
            html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>';
            html += `<span class="btn-tooltip">${currentLang === 'zh_CN' ? '全部撤销' : 'Revert All'}</span>`;
            html += '</button>';
            html += '</div>';

            // diff 主体
            html += '<div class="diff-body">';

            // 四个操作（新增/删除/移动/修改）：2x2
            // 永远渲染出来（只切换 display + 更新文字），避免实时更新时增删节点导致事件丢失
            html += '<div class="current-changes-ops-grid">';
            // 新增(左上)
            html += '<div class="diff-line added clickable" id="currentChangesOpAdded" data-change-type="added" style="display: none; align-items: center; justify-content: space-between;">';
            html += '<div style="display: flex; align-items: center;">';
            html += '<span class="diff-prefix">+</span>';
            html += '<span class="diff-content"></span>';
            html += '</div>';
            html += '<div class="jump-to-related-btn-container" style="opacity: 0; transition: opacity 0.2s ease; margin-right: 8px;">';
            html += '<button class="jump-to-related-btn" data-change-type="added">';
            html += '<i class="fas fa-external-link-alt"></i>';
            html += '</button>';
            html += '</div>';
            html += '</div>';

            // 移动(右上)
            html += '<div class="diff-line moved clickable" id="currentChangesOpMoved" data-change-type="moved" style="display: none; align-items: center; justify-content: space-between;">';
            html += '<div style="display: flex; align-items: center;">';
            html += '<span class="diff-prefix">>></span>';
            html += '<span class="diff-content"></span>';
            html += '</div>';
            html += '<div class="jump-to-related-btn-container" style="opacity: 0; transition: opacity 0.2s ease; margin-right: 8px;">';
            html += '<button class="jump-to-related-btn" data-change-type="moved">';
            html += '<i class="fas fa-external-link-alt"></i>';
            html += '</button>';
            html += '</div>';
            html += '</div>';

            // 删除(左下)
            html += '<div class="diff-line deleted clickable" id="currentChangesOpDeleted" data-change-type="deleted" style="display: none; align-items: center; justify-content: space-between;">';
            html += '<div style="display: flex; align-items: center;">';
            html += '<span class="diff-prefix">-</span>';
            html += '<span class="diff-content"></span>';
            html += '</div>';
            html += '<div class="jump-to-related-btn-container" style="opacity: 0; transition: opacity 0.2s ease; margin-right: 8px;">';
            html += '<button class="jump-to-related-btn" data-change-type="deleted">';
            html += '<i class="fas fa-external-link-alt"></i>';
            html += '</button>';
            html += '</div>';
            html += '</div>';

            // 修改(右下)
            html += '<div class="diff-line modified clickable" id="currentChangesOpModified" data-change-type="modified" style="display: none; align-items: center; justify-content: space-between;">';
            html += '<div style="display: flex; align-items: center;">';
            html += '<span class="diff-prefix">~</span>';
            html += '<span class="diff-content"></span>';
            html += '</div>';
            html += '<div class="jump-to-related-btn-container" style="opacity: 0; transition: opacity 0.2s ease; margin-right: 8px;">';
            html += '<button class="jump-to-related-btn" data-change-type="modified">';
            html += '<i class="fas fa-external-link-alt"></i>';
            html += '</button>';
            html += '</div>';
            html += '</div>';

            // 无变化（占位：与旧逻辑一致，仍在 ops-grid 内）
            html += '<div class="diff-line unchanged" id="currentChangesOpUnchanged" style="display: none;">';
            html += '<span class="diff-prefix">=</span>';
            html += '<span class="diff-content"></span>';
            html += '</div>';

            html += '</div>';

            // 书签树预览（放在变化统计下方）
            html += '<div id="changesTreePreviewInline" class="changes-tree-preview-inline"></div>';

            html += '</div>'; // 结束 diff-body
            html += '</div>'; // 结束 git-diff-container
        }

        // 2. 智能分析书签变化 + 生成 Git diff
        browserAPI.storage.local.get(['lastBookmarkData', 'currentChangesViewMode'], async (lastData) => {
            // 获取当前书签树（working directory）
            browserAPI.bookmarks.getTree(async (currentTree) => {
                // 获取上次备份的书签树（HEAD / last commit）
                let oldTree = null;
                if (lastData.lastBookmarkData && lastData.lastBookmarkData.bookmarkTree) {
                    oldTree = lastData.lastBookmarkData.bookmarkTree;
                }

                container.innerHTML = html;

                // 原地更新四个操作行文本/显示，并按“可见行数量”决定 single-op
                try {
                    latestCurrentChangesData = changeData;
                    await updateCurrentChangesOpsGridInPlace(changeData, { hasQuantityChange, hasStructureChange, stats, diffMeta });
                    bindCurrentChangesOpsEventsOnce();
                } catch (_) { }

                // =================================================================
                // 1. 立即绑定基础事件 (Fix: 移到渲染前，避免被阻塞)
                // =================================================================

                // 保存展开函数的引用，供渲染后调用
                let expandFoldersRef = null;

                // 详略切换按钮逻辑
                const toggleTreeDetailBtn = document.getElementById('toggleTreeDetailBtn');
                const treePreviewContainer = document.getElementById('changesTreePreviewInline');

                if (toggleTreeDetailBtn && treePreviewContainer) {
                    const expandFoldersWithChanges = (forceCollapseChangedFolders = false) => {
                        const changeClasses = ['.tree-change-added', '.tree-change-deleted', '.tree-change-modified', '.tree-change-moved', '.tree-change-mixed'];
                        const selector = changeClasses.join(', ');
                        const changedItems = treePreviewContainer.querySelectorAll(selector);

                        console.log('[详略切换] 找到变化节点数:', changedItems.length);

                        const isCompactMode = treePreviewContainer.classList.contains('compact-mode');
                        const isChangedFolderItem = (item) => {
                            try {
                                const type = (item.getAttribute('data-node-type') || item.dataset.nodeType);
                                if (type !== 'folder') return false;
                                return item.classList.contains('tree-change-added') ||
                                    item.classList.contains('tree-change-deleted') ||
                                    item.classList.contains('tree-change-modified') ||
                                    item.classList.contains('tree-change-moved') ||
                                    item.classList.contains('tree-change-mixed');
                            } catch (_) {
                                return false;
                            }
                        };
                        const syncCompactRevealAll = () => {
                            if (!isCompactMode) return;
                            try {
                                treePreviewContainer.querySelectorAll('.tree-item[data-node-type="folder"]').forEach(item => {
                                    const treeNode = item.closest('.tree-node');
                                    const children = treeNode?.querySelector(':scope > .tree-children');
                                    if (!treeNode || !children) return;
                                    const isChangedFolder = isChangedFolderItem(item);
                                    if (isChangedFolder && children.classList.contains('expanded')) {
                                        treeNode.classList.add('compact-reveal-all');
                                    } else {
                                        treeNode.classList.remove('compact-reveal-all');
                                    }
                                });
                            } catch (_) { /* ignore */ }
                        };

                        // 切换到简略模式时：强制把“变更文件夹对象”折叠回去（祖先路径仍可展开）
                        if (isCompactMode && forceCollapseChangedFolders) {
                            try {
                                treePreviewContainer.querySelectorAll('.tree-item[data-node-type="folder"]').forEach(item => {
                                    if (!isChangedFolderItem(item)) return;
                                    const treeNode = item.closest('.tree-node');
                                    const children = treeNode?.querySelector(':scope > .tree-children');
                                    const toggle = item.querySelector('.tree-toggle');
                                    if (children) children.classList.remove('expanded');
                                    if (toggle) toggle.classList.remove('expanded');
                                    const folderIcon = item.querySelector('.tree-icon.fas.fa-folder-open');
                                    if (folderIcon) {
                                        folderIcon.classList.remove('fa-folder-open');
                                        folderIcon.classList.add('fa-folder');
                                    }
                                    if (treeNode) treeNode.classList.remove('compact-reveal-all');
                                });
                            } catch (_) { /* ignore */ }
                        }

                        changedItems.forEach(item => {
                            // 简略模式：变更文件夹本身默认折叠，但其祖先路径保持展开
                            // 同时：变更文件夹即使包含其他变化，也不自动展开（由用户手动展开）
                            let parent = item.closest('.tree-node');
                            while (parent) {
                                const children = parent.querySelector(':scope > .tree-children');
                                const treeItem = parent.querySelector(':scope > .tree-item');

                                // compact 模式下：遇到“变更文件夹”则保持折叠（但仍继续展开其祖先）
                                let shouldSkipExpand = isCompactMode && treeItem && isChangedFolderItem(treeItem);

                                if (!shouldSkipExpand && children) {
                                    children.classList.add('expanded');
                                    children.style.display = '';
                                }

                                // 懒加载优化：如果节点尚未加载子节点，不要强制展开（避免触发大量 DOM 渲染）
                                if (treeItem && treeItem.dataset && treeItem.dataset.childrenLoaded === 'false') {
                                    shouldSkipExpand = true;
                                }

                                // 性能优化：在简略模式下，如果文件夹包含大量书签（> 50）或层级过深，不要自动展开
                                // 避免"全部展开"导致 DOM 爆炸，也符合"简略"的视觉预期
                                const childCount = parseInt((treeItem && treeItem.dataset ? treeItem.dataset.childCount : '0') || '0', 10);
                                if (isCompactMode && childCount > 50) {
                                    shouldSkipExpand = true;
                                }

                                if (!shouldSkipExpand && treeItem) {
                                    const toggle = treeItem.querySelector('.tree-toggle');
                                    if (toggle) toggle.classList.add('expanded');
                                    const icon = treeItem.querySelector('.tree-icon.fas');
                                    if (icon) {
                                        icon.classList.remove('fa-folder');
                                        icon.classList.add('fa-folder-open');
                                    }
                                }

                                const parentChildren = parent.parentElement;
                                parent = parentChildren ? parentChildren.closest('.tree-node') : null;
                            }
                        });
                        syncCompactRevealAll();
                    };
                    expandFoldersRef = expandFoldersWithChanges;

                    // 初始化状态：读取存储的模式（默认为详细模式 'detailed'）
                    const savedMode = lastData.currentChangesViewMode || 'detailed';
                    const isCompactInit = savedMode === 'compact';

                    // 辅助函数：更新图标显示
                    const updateDetailToggleIcon = (isCompact) => {
                        const iconDetail = toggleTreeDetailBtn.querySelector('.icon-detail');
                        const iconCompact = toggleTreeDetailBtn.querySelector('.icon-compact');
                        if (isCompact) {
                            // 简略模式：显示简略图标，隐藏详细图标
                            if (iconDetail) iconDetail.style.display = 'none';
                            if (iconCompact) iconCompact.style.display = 'block';
                        } else {
                            // 详细模式：显示详细图标，隐藏简略图标
                            if (iconDetail) iconDetail.style.display = 'block';
                            if (iconCompact) iconCompact.style.display = 'none';
                        }
                    };

                    // 获取tooltip元素
                    const toggleTooltip = document.getElementById('toggleTreeDetailTooltip');

                    if (isCompactInit) {
                        treePreviewContainer.classList.add('compact-mode');
                        toggleTreeDetailBtn.classList.add('active');
                        if (toggleTooltip) toggleTooltip.textContent = currentLang === 'zh_CN' ? '切换为详细' : 'Switch to detailed';
                        updateDetailToggleIcon(true);
                    } else {
                        treePreviewContainer.classList.remove('compact-mode');
                        toggleTreeDetailBtn.classList.remove('active');
                        if (toggleTooltip) toggleTooltip.textContent = currentLang === 'zh_CN' ? '切换为简略' : 'Switch to compact';
                        updateDetailToggleIcon(false);
                    }

                    // 绑定点击事件
                    toggleTreeDetailBtn.addEventListener('click', () => {
                        // 模式切换前：先保存旧模式的滚动/展开状态（同一个 DOM 容器会复用）
                        try {
                            const previewBody = treePreviewContainer.querySelector('.changes-preview-readonly .permanent-section-body');
                            if (previewBody) saveChangesPreviewScrollTop(previewBody.scrollTop);
                        } catch (_) { }
                        // 保存右侧主滚动容器（content-area）的滚动位置
                        try {
                            const contentArea = __getContentAreaEl();
                            if (contentArea) saveCurrentChangesContentScrollTop(contentArea.scrollTop);
                        } catch (_) { }
                        try {
                            const previewTree = treePreviewContainer.querySelector('#preview_bookmarkTree');
                            if (previewTree) saveTreeExpandState(previewTree);
                        } catch (_) { }

                        const isCompact = treePreviewContainer.classList.contains('compact-mode');
                        // 切换状态
                        if (isCompact) {
                            // 当前是简略，切换到详细
                            treePreviewContainer.classList.remove('compact-mode');
                            toggleTreeDetailBtn.classList.remove('active');
                            if (toggleTooltip) toggleTooltip.textContent = currentLang === 'zh_CN' ? '切换为简略' : 'Switch to compact';
                            updateDetailToggleIcon(false);
                            // 保存状态
                            browserAPI.storage.local.set({ currentChangesViewMode: 'detailed' });

                        } else {
                            // 当前是详细，切换到简略
                            treePreviewContainer.classList.add('compact-mode');
                            toggleTreeDetailBtn.classList.add('active');
                            if (toggleTooltip) toggleTooltip.textContent = currentLang === 'zh_CN' ? '切换为详细' : 'Switch to detailed';
                            updateDetailToggleIcon(true);
                            // 保存状态
                            browserAPI.storage.local.set({ currentChangesViewMode: 'compact' });
                        }

                        // 模式切换后：恢复新模式的滚动/展开记忆
                        try {
                            const previewTree = treePreviewContainer.querySelector('#preview_bookmarkTree');
                            if (previewTree) {
                                // 清空旧模式展开状态
                                previewTree.querySelectorAll('.tree-children.expanded').forEach(el => el.classList.remove('expanded'));
                                previewTree.querySelectorAll('.tree-toggle.expanded').forEach(el => el.classList.remove('expanded'));
                                previewTree.querySelectorAll('.tree-icon.fas.fa-folder-open').forEach(el => {
                                    el.classList.remove('fa-folder-open');
                                    el.classList.add('fa-folder');
                                });
                                __ensureTreeRootExpanded(previewTree);
                                restoreTreeExpandState(previewTree);
                            }
                        } catch (_) { }

                        try {
                            const previewBody = treePreviewContainer.querySelector('.changes-preview-readonly .permanent-section-body');
                            if (previewBody) {
                                const top = getChangesPreviewScrollTop();
                                if (typeof top === 'number' && !Number.isNaN(top)) previewBody.scrollTop = top;
                            }
                        } catch (_) { }

                        // 恢复右侧主滚动容器（content-area）的滚动位置
                        try {
                            restoreCurrentChangesContentScrollPosition();
                        } catch (_) { }
                    });
                }


                // 导出按钮
                const exportChangesBtn = document.getElementById('exportChangesBtn');
                if (exportChangesBtn) {
                    if (exportChangesBtn.dataset.bound !== 'true') {
                        exportChangesBtn.dataset.bound = 'true';
                        exportChangesBtn.addEventListener('click', () => {
                            showExportChangesModal(latestCurrentChangesData || changeData);
                        });
                    }
                }

                // 全部撤销按钮（该按钮由 current-changes 视图动态渲染，需在这里绑定）
                const revertAllCurrentBtn = document.getElementById('revertAllCurrentBtn');
                if (revertAllCurrentBtn) {
                    if (revertAllCurrentBtn.dataset.bound !== 'true') {
                        revertAllCurrentBtn.dataset.bound = 'true';
                        revertAllCurrentBtn.addEventListener('click', () => handleRevertAll('current'));
                    }
                }

                // Diff行点击事件：由 bindCurrentChangesOpsEventsOnce() 统一做事件委托，避免刷新时丢绑定

                // =================================================================
                // 2. 渲染预览树
                // =================================================================
                try {
                    // 渲染书签树映射预览（内嵌到Bookmark Changes内部）
                    await renderChangesTreePreview(changeData);

                    // 简略模式：默认展开至“第一处变化”（变化过多时不展开）
                    try { await maybeAutoExpandCurrentChangesCompactPreview(); } catch (_) { }

                    // 绑定并恢复右侧主滚动条位置（content-area）
                    try {
                        bindCurrentChangesContentScrollPersistence();
                        // 延迟一帧：等 diff + 预览树都把高度撑开后再恢复
                        requestAnimationFrame(() => {
                            try { restoreCurrentChangesContentScrollPosition(); } catch (_) { }
                        });
                    } catch (_) { }

                    // Phase 1：构建「当前变化」搜索索引；若用户已在加载期输入，则刷新结果
                    try {
                        buildCurrentChangesSearchDb();
                        if (searchUiState.view === 'current-changes' && searchUiState.query) {
                            searchCurrentChangesAndRender(searchUiState.query);
                        }
                    } catch (_) { }
                } catch (err) {
                    console.warn('[CurrentChanges] Tree preview render error:', err);
                }

            });
        });
    } catch (error) {
        console.error('加载变化数据失败:', error);
        try { resetCurrentChangesSearchDb('render-error'); } catch (_) { }
        try { hideSearchResultsPanel(); } catch (_) { }
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
    const CURRENT_CHANGES_CACHE_KEY = 'current-changes-cache:v1';

    // 失效规则：
    // - lastBookmarkData.timestamp 变化（代表已备份、基准更新）
    // - lastBookmarkChangeTime 变化（代表书签又发生了新改动）
    if (!forceRefresh) {
        try {
            const cached = await browserAPI.storage.local.get([
                CURRENT_CHANGES_CACHE_KEY,
                'lastBookmarkData',
                'lastBookmarkChangeTime'
            ]);

            const lastData = cached?.lastBookmarkData || null;
            const baselineTs = lastData?.timestamp || null;
            const lastChangeTime = typeof cached?.lastBookmarkChangeTime === 'number'
                ? cached.lastBookmarkChangeTime
                : 0;

            const payload = cached ? cached[CURRENT_CHANGES_CACHE_KEY] : null;
            const metaOk = payload && payload.meta && payload.data &&
                payload.meta.lastBookmarkDataTimestamp === baselineTs &&
                payload.meta.lastBookmarkChangeTime === lastChangeTime;

            if (metaOk) {
                console.log('[getDetailedChanges] 命中持久缓存');
                return payload.data;
            }
        } catch (e) {
            console.warn('[getDetailedChanges] 读取持久缓存失败，回退到计算:', e);
        }
    }

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
                    if (browserAPI.runtime.lastError) {
                        rej(new Error(browserAPI.runtime.lastError.message));
                        return;
                    }
                    if (response && response.success) res(response);
                    else rej(new Error(response?.error || '获取备份统计失败'));
                });
            }),
            // 2. 获取备份历史
            new Promise((res, rej) => {
                browserAPI.runtime.sendMessage({ action: "getSyncHistory" }, response => {
                    if (browserAPI.runtime.lastError) {
                        rej(new Error(browserAPI.runtime.lastError.message));
                        return;
                    }
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

            // 新口径：若 background 提供新增/删除分开计数，则数量变化以它为准
            const bmAdded = typeof backupResponse.stats.bookmarkAdded === 'number' ? backupResponse.stats.bookmarkAdded : null;
            const bmDeleted = typeof backupResponse.stats.bookmarkDeleted === 'number' ? backupResponse.stats.bookmarkDeleted : null;
            const fdAdded = typeof backupResponse.stats.folderAdded === 'number' ? backupResponse.stats.folderAdded : null;
            const fdDeleted = typeof backupResponse.stats.folderDeleted === 'number' ? backupResponse.stats.folderDeleted : null;
            const hasDetailedQuantity = (bmAdded !== null) || (bmDeleted !== null) || (fdAdded !== null) || (fdDeleted !== null);
            const hasQuantityChange = hasDetailedQuantity
                ? ((bmAdded || 0) > 0 || (bmDeleted || 0) > 0 || (fdAdded || 0) > 0 || (fdDeleted || 0) > 0)
                : hasNumericalChange;

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
            const hasChanges = hasQuantityChange || hasStructuralChanges;

            console.log('[getDetailedChanges] 是否有变化:', hasChanges);

            if (!hasChanges) {
                console.log('[getDetailedChanges] 无变化，返回');
                const out = {
                    hasChanges: false,
                    stats: { ...backupResponse.stats, bookmarkDiff, folderDiff, hasNumericalChange: false },
                    diffMeta: { ...diffResult, hasNumericalChange: false }
                };

                // 写入持久缓存（无变化也缓存，避免反复触发重算）
                try {
                    browserAPI.storage.local.get(['lastBookmarkData', 'lastBookmarkChangeTime'], (x) => {
                        try {
                            const baselineTs = x?.lastBookmarkData?.timestamp || null;
                            const lastChangeTime = typeof x?.lastBookmarkChangeTime === 'number' ? x.lastBookmarkChangeTime : 0;
                            browserAPI.storage.local.set({
                                [CURRENT_CHANGES_CACHE_KEY]: {
                                    meta: { lastBookmarkDataTimestamp: baselineTs, lastBookmarkChangeTime: lastChangeTime },
                                    data: out,
                                    cachedAt: Date.now()
                                }
                            });
                        } catch (_) { }
                    });
                } catch (_) { }

                resolve(out);
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
                hasNumericalChange: hasQuantityChange
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

                // 获取当前书签树并生成指纹（优先走 background 快照缓存，避免直接 getTree）
                (async () => {
                    try {
                        const snapshot = await getBookmarkTreeSnapshot();
                        const tree = snapshot ? snapshot.tree : null;
                        const currentPrints = generateFingerprintsFromTree(tree || []);
                        const oldBookmarkPrints = new Set(lastData.bookmarkPrints || []);
                        const newBookmarkPrints = new Set(currentPrints.bookmarks);

                        const added = [];
                        const deleted = [];
                        const moved = [];
                        const modified = [];

                        // 性能优化：避免 O(N^2) 的嵌套遍历（新 prints × 旧 prints）。
                        // 用 url -> 候选列表 建索引，再为每个新增 fingerprint 寻找匹配。
                        const oldByUrl = new Map();
                        for (const raw of oldBookmarkPrints) {
                            const b = parseBookmarkFingerprint(raw);
                            if (!b || !b.url) continue;
                            const arr = oldByUrl.get(b.url) || [];
                            arr.push({ raw, b });
                            oldByUrl.set(b.url, arr);
                        }
                        const matchedOldRaw = new Set();

                        for (const raw of newBookmarkPrints) {
                            if (oldBookmarkPrints.has(raw)) continue;
                            const b = parseBookmarkFingerprint(raw);
                            if (!b || !b.url) continue;

                            const candidates = oldByUrl.get(b.url) || [];
                            let picked = null;
                            let pickedType = null;

                            for (const c of candidates) {
                                if (!c || matchedOldRaw.has(c.raw)) continue;
                                const pathChanged = c.b.path !== b.path;
                                const titleChanged = c.b.title !== b.title;
                                if (pathChanged) {
                                    picked = c;
                                    pickedType = 'moved';
                                    break;
                                }
                                if (!picked && titleChanged) {
                                    picked = c;
                                    pickedType = 'modified';
                                }
                            }

                            if (picked && pickedType === 'moved') {
                                matchedOldRaw.add(picked.raw);
                                moved.push({
                                    ...b,
                                    oldPath: picked.b.path,
                                    oldTitle: picked.b.title,
                                    changeType: 'moved'
                                });
                            } else if (picked && pickedType === 'modified') {
                                matchedOldRaw.add(picked.raw);
                                modified.push({
                                    ...b,
                                    oldTitle: picked.b.title,
                                    changeType: 'modified'
                                });
                            } else {
                                added.push(b);
                            }
                        }

                        for (const raw of oldBookmarkPrints) {
                            if (newBookmarkPrints.has(raw)) continue;
                            if (matchedOldRaw.has(raw)) continue;
                            const b = parseBookmarkFingerprint(raw);
                            if (b) deleted.push(b);
                        }

                        console.log('变化分析结果:', {
                            added: added.length,
                            deleted: deleted.length,
                            moved: moved.length,
                            stats
                        });

                        const out = {
                            hasChanges: true,
                            stats,
                            diffMeta: diffResult,
                            added,
                            deleted,
                            moved,
                            modified
                        };

                        try {
                            browserAPI.storage.local.get(['lastBookmarkData', 'lastBookmarkChangeTime'], (x) => {
                                try {
                                    const baselineTs = x?.lastBookmarkData?.timestamp || null;
                                    const lastChangeTime = typeof x?.lastBookmarkChangeTime === 'number' ? x.lastBookmarkChangeTime : 0;
                                    browserAPI.storage.local.set({
                                        [CURRENT_CHANGES_CACHE_KEY]: {
                                            meta: { lastBookmarkDataTimestamp: baselineTs, lastBookmarkChangeTime: lastChangeTime },
                                            data: out,
                                            cachedAt: Date.now()
                                        }
                                    });
                                } catch (_) { }
                            });
                        } catch (_) { }

                        resolve(out);
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
                })();
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
        // Use a plain-text marker so it also stays consistent in exported text.
        html += `<div class="change-type">>> ${isZh ? '移动' : 'Moved'} (${changes.moved.length})</div>`;
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

let currentHistoryPage = 1;
const HISTORY_PAGE_SIZE = 10;

let historyIndexMeta = {
    totalRecords: 0,
    totalPages: 1
};

function clampHistoryPage(page, totalPages = null) {
    const maxPages = Math.max(1, Number.isFinite(Number(totalPages)) ? Number(totalPages) : (historyIndexMeta.totalPages || 1));
    const raw = Number(page);
    if (!Number.isInteger(raw) || raw < 1) return 1;
    return Math.min(raw, maxPages);
}

async function fetchHistoryPageData(page = 1, pageSize = HISTORY_PAGE_SIZE) {
    const safePageSize = Math.max(1, Number(pageSize) || HISTORY_PAGE_SIZE);
    const safePage = clampHistoryPage(page);

    return await new Promise((resolve) => {
        browserAPI.runtime.sendMessage({
            action: 'getSyncHistory',
            paged: true,
            page: safePage,
            pageSize: safePageSize
        }, (response) => {
            if (browserAPI.runtime.lastError || !response || !response.success) {
                resolve({
                    records: [],
                    totalRecords: 0,
                    totalPages: 1,
                    currentPage: 1,
                    pageSize: safePageSize
                });
                return;
            }

            resolve({
                records: Array.isArray(response.syncHistory) ? response.syncHistory : [],
                totalRecords: Number.isFinite(Number(response.totalRecords)) ? Number(response.totalRecords) : 0,
                totalPages: Math.max(1, Number.isFinite(Number(response.totalPages)) ? Number(response.totalPages) : 1),
                currentPage: clampHistoryPage(response.currentPage, response.totalPages),
                pageSize: Number.isFinite(Number(response.pageSize)) ? Number(response.pageSize) : safePageSize
            });
        });
    });
}

async function refreshHistoryIndexPage(options = {}) {
    const { page = currentHistoryPage, pageSize = HISTORY_PAGE_SIZE } = options;
    const data = await fetchHistoryPageData(page, pageSize);

    syncHistory = data.records;
    currentHistoryPage = data.currentPage;
    historyIndexMeta = {
        totalRecords: data.totalRecords,
        totalPages: data.totalPages
    };

    return data;
}

function getUnifiedHistoryRecordNote(record, lang) {
    const rawNote = (record && typeof record.note === 'string') ? record.note.trim() : '';
    const isEn = lang === 'en';

    const manualLabel = isEn ? 'Manual Backup' : '手动备份';
    const switchLabel = isEn ? 'Switch Backup' : '切换备份';
    const autoPrefix = isEn ? 'Auto Backup' : '自动备份';
    const autoRealtimeLabel = isEn ? `${autoPrefix}--Realtime` : `${autoPrefix}--实时`;
    const autoRegularLabel = isEn ? `${autoPrefix}--Regular` : `${autoPrefix}--常规`;
    const autoSpecificLabel = isEn ? `${autoPrefix}--Specific` : `${autoPrefix}--特定`;

    const recordType = record?.type || (() => {
        if (rawNote === '手动备份' || rawNote === 'Manual Backup') return 'manual';
        if (rawNote === '切换备份' || rawNote === 'Switch Backup') return 'switch';
        return 'auto';
    })();

    const isSystemManualNote = !rawNote || rawNote === '手动备份' || rawNote === 'Manual Backup';
    const isSystemSwitchNote = !rawNote || rawNote === '切换备份' || rawNote === 'Switch Backup';

    if (recordType === 'switch' || recordType === 'auto_switch') {
        return isSystemSwitchNote ? switchLabel : rawNote;
    }

    if (recordType === 'manual') {
        return isSystemManualNote ? manualLabel : rawNote;
    }

    if (recordType === 'restore') {
        return rawNote;
    }

    const lowerNote = rawNote.toLowerCase();
    const looksLikeSpecificReason = rawNote.includes('特定') ||
        lowerNote.includes('specific') ||
        /\d{4}-\d{2}-\d{2}[ tT]\d{2}:\d{2}/.test(rawNote);
    const looksLikeRegularReason = rawNote.includes('常规') ||
        lowerNote.includes('regular') ||
        rawNote.includes(' - ') ||
        rawNote.includes('每') ||
        rawNote.includes('周') ||
        lowerNote.includes('every');

    const looksLikeLegacyReasonOnly = (recordType === 'auto') && (looksLikeSpecificReason || looksLikeRegularReason);

    const isSystemAutoNote = !rawNote ||
        rawNote === '自动备份' ||
        rawNote === 'Auto Backup' ||
        rawNote.startsWith('自动备份 - ') ||
        rawNote.startsWith('Auto Backup - ') ||
        rawNote.startsWith('自动备份--') ||
        rawNote.startsWith('Auto Backup--') ||
        looksLikeLegacyReasonOnly;

    if (isSystemAutoNote) {
        if (looksLikeSpecificReason) return autoSpecificLabel;
        if (looksLikeRegularReason) return autoRegularLabel;
        return autoRealtimeLabel;
    }

    return rawNote;
}

function renderHistoryView() {
    const container = document.getElementById('historyList');
    // 分页控件元素
    const pagination = document.getElementById('historyPagination');
    const pageInput = document.getElementById('historyPageInput');
    const totalPagesEl = document.getElementById('historyTotalPages');
    const prevBtn = document.getElementById('historyPrevPage');
    const nextBtn = document.getElementById('historyNextPage');

    if (syncHistory.length === 0) {
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-history"></i></div>
                    <div class="empty-state-title">${i18n.emptyHistory[currentLang]}</div>
                </div>
            `;
        }
        if (pagination) pagination.style.display = 'none';
        return;
    }

    const totalRecords = Number.isFinite(Number(historyIndexMeta.totalRecords))
        ? Number(historyIndexMeta.totalRecords)
        : syncHistory.length;
    const totalPages = Math.max(1, Number.isFinite(Number(historyIndexMeta.totalPages))
        ? Number(historyIndexMeta.totalPages)
        : Math.ceil(Math.max(1, totalRecords) / HISTORY_PAGE_SIZE));

    currentHistoryPage = clampHistoryPage(currentHistoryPage, totalPages);
    const startIndex = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
    const pageRecords = syncHistory;

    // 更新分页控件 UI
    if (pagination) {
        if (totalPages <= 1) {
            pagination.style.display = 'none';
        } else {
            pagination.style.display = 'flex';
            if (pageInput) {
                pageInput.value = currentHistoryPage;
                // pageInput.max = totalPages; // input type="text" doesn't use max
            }
            if (totalPagesEl) totalPagesEl.textContent = totalPages;
            if (prevBtn) prevBtn.disabled = currentHistoryPage <= 1;
            if (nextBtn) nextBtn.disabled = currentHistoryPage >= totalPages;
        }
    }

    if (!container) return;

    // 使用当前页的数据进行渲染，注意 index 需要加上 offset 以保持 calculateChanges 正确（如果它依赖全局索引）
    // calculateChanges takes (record, index, allRecords). 
    // Usually index is used to compare with previous record (index+1).
    // So passing reversedHistory (full list) to calculateChanges is correct, but we need the correct index in that full list.

    container.innerHTML = pageRecords.map((record, i) => {
        const globalIndex = startIndex + i; // Index in the full reversedHistory array
        const seqNumber = Number.isFinite(Number(record.seqNumber)) ? Number(record.seqNumber) : '-';

        const time = formatTime(record.time);
        // 使用 type 字段代替 isAutoBackup：'manual', 'auto', 'switch'
        const isAuto = record.type !== 'manual';
        const fingerprint = record.fingerprint || '';
        const isRestore = record.type === 'restore';

        // 计算变化
        const changes = calculateChanges(record, globalIndex, { totalRecords });

        // 位置/方向标识（兼容旧记录 + 云端1/云端2）
        const directionKey = (record.direction || 'none').toString().toLowerCase();
        const cloud1Label = currentLang === 'zh_CN' ? '云端1' : 'Cloud 1';
        const cloud2Label = currentLang === 'zh_CN' ? '云端2' : 'Cloud 2';
        const localLabel = currentLang === 'zh_CN' ? '本地' : 'Local';
        const cloudLabel = currentLang === 'zh_CN' ? '云端' : 'Cloud';
        const joinText = ', ';

        const directionInfoMap = {
            // Legacy
            upload: { icon: '<i class="fas fa-cloud-upload-alt"></i>', text: cloudLabel },
            download: { icon: '<i class="fas fa-hdd"></i>', text: localLabel },
            both: { icon: '<i class="fas fa-cloud"></i> <i class="fas fa-hdd"></i>', text: `${cloud1Label}${joinText}${localLabel}` },

            // New
            webdav: { icon: '<i class="fas fa-cloud"></i>', text: `${cloud1Label} (WebDAV)` },
            github_repo: { icon: '<i class="fab fa-github"></i>', text: `${cloud2Label} (GitHub Repo)` },
            gist: { icon: '<i class="fab fa-github"></i>', text: `${cloud2Label} (GitHub Repo)` }, // legacy
            cloud: { icon: '<i class="fas fa-cloud"></i> <i class="fab fa-github"></i>', text: `${cloud1Label}${joinText}${cloud2Label}` },
            webdav_local: { icon: '<i class="fas fa-cloud"></i> <i class="fas fa-hdd"></i>', text: `${cloud1Label} (WebDAV)${joinText}${localLabel}` },
            github_repo_local: { icon: '<i class="fab fa-github"></i> <i class="fas fa-hdd"></i>', text: `${cloud2Label} (GitHub Repo)${joinText}${localLabel}` },
            gist_local: { icon: '<i class="fab fa-github"></i> <i class="fas fa-hdd"></i>', text: `${cloud2Label} (GitHub Repo)${joinText}${localLabel}` }, // legacy
            cloud_local: { icon: '<i class="fas fa-cloud"></i> <i class="fab fa-github"></i> <i class="fas fa-hdd"></i>', text: `${cloud1Label}${joinText}${cloud2Label}${joinText}${localLabel}` },
            local: { icon: '<i class="fas fa-hdd"></i>', text: localLabel },
            none: { icon: '<i class="fas fa-minus-circle"></i>', text: currentLang === 'zh_CN' ? '无' : 'None' }
        };

        const directionInfo = directionInfoMap[directionKey] || { icon: '<i class="fas fa-question-circle"></i>', text: directionKey };
        const directionIcon = directionInfo.icon;
        const directionText = directionInfo.text;

        // 构建提交项
        // 切换标识徽章（可选显示）
        // 模式显示文本
        const savedMode = getRecordDetailMode(record.time);
        const defaultMode = historyDetailMode || 'simple';
        const mode = savedMode || defaultMode;
        const modeText = mode === 'simple'
            ? (currentLang === 'zh_CN' ? '简略' : 'Simple')
            : (currentLang === 'zh_CN' ? '详细' : 'Detailed');

        let displayTitle = getUnifiedHistoryRecordNote(record, currentLang);
        if (isRestore && record.restoreInfo && (!displayTitle || !String(displayTitle).trim())) {
            const sourceSeq = record.restoreInfo.sourceSeqNumber;
            const sourceTime = record.restoreInfo.sourceTime ? formatTime(record.restoreInfo.sourceTime) : '';
            const sourceNote = record.restoreInfo.sourceNote ? String(record.restoreInfo.sourceNote) : '';
            const seqText = sourceSeq ? `#${sourceSeq}` : '#-';
            const noteText = sourceNote ? ` ${sourceNote}` : '';
            displayTitle = currentLang === 'zh_CN'
                ? `恢复至 ${seqText}${noteText}${sourceTime ? ` (${sourceTime})` : ''}`
                : `Restored to ${seqText}${noteText}${sourceTime ? ` (${sourceTime})` : ''}`;
        }
        displayTitle = displayTitle || time;

        if (isRestore && record.restoreInfo) {
            let hashToUse = record.restoreInfo.sourceFingerprint;
            if (!hashToUse && record.restoreInfo.sourceTime) {
                const sourceRecord = syncHistory.find(r => r.time === record.restoreInfo.sourceTime);
                if (sourceRecord) {
                    hashToUse = sourceRecord.fingerprint;
                }
            }
            const finalHash = hashToUse || record.fingerprint;
            const shortHash = (finalHash || '').substring(0, 7);
            if (shortHash && !displayTitle.includes(shortHash)) {
                displayTitle = `${displayTitle} (${shortHash})`;
            }
        }

        let typeBadge = '';
        if (record.type === 'switch') {
            typeBadge = `<span class="commit-badge switch" title="${currentLang === 'zh_CN' ? '切换备份' : 'Switch Backup'}">
                   <i class="fas fa-exchange-alt"></i> ${currentLang === 'zh_CN' ? '切换' : 'Switch'}
               </span>`;
        } else if (isRestore) {
            typeBadge = `<span class="commit-badge restore" title="${currentLang === 'zh_CN' ? '恢复操作' : 'Restore Operation'}" style="background: var(--accent-light); color: var(--accent-primary); border: 1px solid var(--accent-primary);">
                   <i class="fas fa-undo"></i> ${currentLang === 'zh_CN' ? '恢复' : 'Restore'}
               </span>`;
        }

        const titleClass = isRestore ? 'commit-title restore-title' : 'commit-title';
        const seqClass = isRestore ? 'commit-seq-badge restore-seq' : 'commit-seq-badge';

        const detailSearchAriaLabel = currentLang === 'zh_CN' ? '搜索' : 'Search';

        return `
            <div class="commit-item" data-record-time="${record.time}">
                <div class="commit-header">
                    <div class="commit-title-group">
                        <span class="${seqClass}" title="${currentLang === 'zh_CN' ? '序号' : 'No.'}">${seqNumber}</span>
        <div class="${titleClass}" title="${currentLang === 'zh_CN' ? '点击编辑备注' : 'Click to edit note'}">${escapeHtml(displayTitle)}</div>
                        <button class="commit-note-edit-btn" data-time="${record.time}" title="${currentLang === 'zh_CN' ? '编辑备注' : 'Edit Note'}">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    <div class="commit-actions">
                        <button class="action-btn detail-search-open-btn" data-time="${record.time}" aria-label="${detailSearchAriaLabel}">
                            <i class="fas fa-search"></i>
                            <span class="btn-tooltip">${detailSearchAriaLabel}</span>
                        </button>
                        <button class="action-btn restore-btn" data-time="${record.time}" data-display-title="${escapeHtml(displayTitle)}" aria-label="${currentLang === 'zh_CN' ? '恢复到此版本' : 'Restore to this version'}">
                            <i class="fas fa-undo"></i>
                            <span class="btn-tooltip">${currentLang === 'zh_CN' ? '恢复' : 'Restore'}</span>
                        </button>
                        <button class="action-btn detail-btn" data-time="${record.time}">
                            <i class="fas fa-angle-right"></i>
                            <span class="btn-tooltip">${modeText}</span>
                        </button>
                    </div>
                </div>
                <div class="commit-meta">
                    <div class="commit-meta-left">
                        <div class="commit-time">
                            <i class="fas fa-clock"></i> ${time}
                        </div>
                    ${renderCommitStatsInline(changes)}
                    ${!typeBadge ? `<span class="commit-badge ${isAuto ? 'auto' : 'manual'}">
                        <i class="fas ${isAuto ? 'fa-robot' : 'fa-hand-pointer'}"></i>
                        ${isAuto ? i18n.autoBackup[currentLang] : i18n.manualBackup[currentLang]}
                    </span>` : ''}
                        ${typeBadge}
                        <span class="commit-badge direction">
                            ${directionIcon}
                            ${directionText}
                        </span>
                    </div>
                    <span class="commit-fingerprint" title="提交指纹号">#${escapeHtml(fingerprint)}</span>
                </div>
            </div>
        `;
    }).join('');

    // 添加按钮事件（使用事件委托）
    container.querySelectorAll('.action-btn.detail-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const recordTime = btn.dataset.time;
            const record = syncHistory.find(r => r.time === recordTime);
            if (record) showDetailModal(record);
        });
    });

    // 添加恢复按钮事件
    container.querySelectorAll('.action-btn.restore-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const recordTime = btn.dataset.time;
            const displayTitle = btn.dataset.displayTitle;
            const record = syncHistory.find(r => r.time === recordTime);
            if (record) handleRestoreRecord(record, displayTitle || null);
        });
    });

    // [New] 直接打开“详情搜索变化”UI
    container.querySelectorAll('.action-btn.detail-search-open-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const recordTime = btn.dataset.time;
            const record = syncHistory.find(r => r.time === recordTime);
            if (record) showDetailModal(record, { openDetailSearch: true });
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

    // 添加行点击交互 (详情)
    container.querySelectorAll('.commit-item').forEach(item => {
        item.style.cursor = 'pointer';
        item.addEventListener('click', (e) => {
            // 如果点击的是按钮或交互元素，则忽略
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.commit-note-edit-btn')) return;

            const recordTime = item.dataset.recordTime;
            const record = syncHistory.find(r => r.time === recordTime);
            if (record) showDetailModal(record);
        });
    });
}

function initHistoryPagination() {
    const prevBtn = document.getElementById('historyPrevPage');
    const nextBtn = document.getElementById('historyNextPage');
    const pageInput = document.getElementById('historyPageInput');

    if (prevBtn) {
        prevBtn.addEventListener('click', async () => {
            if (currentHistoryPage > 1) {
                await refreshHistoryIndexPage({ page: currentHistoryPage - 1 });
                renderHistoryView();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', async () => {
            const totalPages = historyIndexMeta.totalPages || 1;
            if (currentHistoryPage < totalPages) {
                await refreshHistoryIndexPage({ page: currentHistoryPage + 1 });
                renderHistoryView();
            }
        });
    }

    if (pageInput) {
        pageInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const totalPages = historyIndexMeta.totalPages || 1;
                const targetPage = clampHistoryPage(parseInt(pageInput.value, 10), totalPages);
                await refreshHistoryIndexPage({ page: targetPage });
                renderHistoryView();
            }
        });
        pageInput.addEventListener('blur', async () => {
            const totalPages = historyIndexMeta.totalPages || 1;
            const targetPage = clampHistoryPage(parseInt(pageInput.value, 10), totalPages);
            if (targetPage !== currentHistoryPage) {
                await refreshHistoryIndexPage({ page: targetPage });
                renderHistoryView();
            } else {
                pageInput.value = currentHistoryPage;
            }
        });
    }
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

async function handleRestoreRecord(record, displayTitle) {
    if (!record) return;
    const title = displayTitle || record.note || formatTime(record.time);
    showRestoreModal(record, title);
}

function closeRestoreModal() {
    const modal = document.getElementById('restoreModal');
    if (modal) modal.classList.remove('show');
    try {
        const importModal = document.getElementById('importTargetModal');
        if (importModal) importModal.style.display = 'none';
    } catch (_) { }
    restoreGeneralPreflight = null;
    restoreComparisonState = null;
    try { setRestoreDiffBarVisible(false); } catch (_) { }
    try {
        const strategyGroup = document.getElementById('restoreStrategyGroup');
        const strategyOverwriteRadio = document.getElementById('restoreStrategyOverwrite');
        const strategyMergeRadio = document.getElementById('restoreStrategyMerge');
        if (strategyGroup) strategyGroup.classList.remove('disabled');
        if (strategyOverwriteRadio) strategyOverwriteRadio.disabled = false;
        if (strategyMergeRadio) strategyMergeRadio.disabled = false;
    } catch (_) { }
    try {
        const progressSection = document.getElementById('restoreProgressSection');
        if (progressSection) progressSection.style.display = 'none';
    } catch (_) { }
    const confirmBtn = document.getElementById('restoreConfirmBtn');
    if (confirmBtn) {
        confirmBtn.textContent = currentLang === 'zh_CN' ? '恢复' : 'Restore';
    }
}

function getSelectedRestoreStrategy() {
    const selected = document.querySelector('input[name="restoreStrategy"]:checked');
    const value = selected && selected.value ? String(selected.value) : 'overwrite';
    if (value === 'merge' || value === 'overwrite') return value;
    return 'overwrite';
}

function updateRestoreWarning(strategy) {
    const isZh = currentLang === 'zh_CN';

    const box = document.querySelector('#restoreModal .restore-warning');
    const icon = box ? box.querySelector('i.fas') : null;

    const titleEl = document.getElementById('restoreWarningTitle');
    const textEl = document.getElementById('restoreWarningText');

    if (!titleEl || !textEl) return;

    let title = isZh ? '警告' : 'Warning';
    let text = isZh
        ? '覆盖恢复：清空并重建「书签栏」与「其他书签」，使其与该版本一致。书签会被重新创建，ID 将变化，可能导致「书签记录」「书签推荐」等依赖书签 ID 的数据失效/重置。'
        : 'Overwrite will clear and rebuild Bookmarks Bar + Other Bookmarks. Bookmarks will be recreated (IDs will change), which may reset/lose ID-based data (e.g., Records/Recommendations).';

    let boxBg = 'var(--warning-light)';
    let boxBorder = '1px solid var(--warning)';
    let iconColor = 'var(--warning)';
    let iconClass = 'fas fa-exclamation-triangle';

    if (strategy === 'merge') {
        title = isZh ? '提示' : 'Note';
        text = isZh
            ? '导入合并：导入该记录的「差异视图」到书签树的新文件夹（不删除现有书签；标题带 [+]/[-]/[~]/[↔] 前缀）。'
            : 'Import merge: imports this record’s “changes view” into a new folder under bookmark roots (no deletion; titles prefixed with [+]/[-]/[~]/[↔]).';
        boxBg = 'var(--info-light)';
        boxBorder = '1px solid var(--info)';
        iconColor = 'var(--info)';
        iconClass = 'fas fa-info-circle';
    }

    titleEl.textContent = title;
    textEl.textContent = text;

    if (box) {
        box.style.background = boxBg;
        box.style.border = boxBorder;
    }

    if (icon) {
        icon.className = iconClass;
        icon.style.color = iconColor;
    }
}

function setRestoreProgress(percent, text) {
    const section = document.getElementById('restoreProgressSection');
    const bar = document.getElementById('restoreProgressBar');
    const percentEl = document.getElementById('restoreProgressPercent');
    const textEl = document.getElementById('restoreProgressText');
    if (section) section.style.display = 'block';
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (percentEl) percentEl.textContent = `${Math.max(0, Math.min(100, percent))}%`;
    if (textEl && typeof text === 'string') textEl.textContent = text;
}

function setRestoreDiffBarVisible(visible) {
    const bar = document.getElementById('restoreDiffBar');
    if (bar) bar.style.display = visible ? 'flex' : 'none';
    const previewBtn = document.getElementById('restorePreviewBtn');
    if (previewBtn) {
        previewBtn.style.display = visible ? 'inline-flex' : 'none';
    }
}

function updateRestoreImportTargetHint(strategy) {
    const hint = document.getElementById('restoreImportTargetHint');
    const btn = document.getElementById('restoreImportTargetBtn');
    if (btn) {
        btn.style.display = strategy === 'merge' ? 'inline-flex' : 'none';
    }
    if (!hint) return;
    if (strategy !== 'merge') {
        hint.style.display = 'none';
        return;
    }
    const text = restoreImportTarget
        ? (currentLang === 'zh_CN' ? `导入位置：${restoreImportTarget.path || restoreImportTarget.title}` : `Import to: ${restoreImportTarget.path || restoreImportTarget.title}`)
        : (currentLang === 'zh_CN' ? '导入位置：自动' : 'Import to: Auto');
    hint.textContent = text;
    hint.style.display = 'block';
}

async function openRestoreImportTargetModal() {
    const modal = document.getElementById('importTargetModal');
    const list = document.getElementById('importTargetList');
    const titleEl = document.getElementById('importTargetTitle');
    const descEl = document.getElementById('importTargetDesc');
    const autoBtn = document.getElementById('importTargetAutoBtn');
    const cancelBtn = document.getElementById('importTargetCancelBtn');
    const confirmBtn = document.getElementById('importTargetConfirmBtn');
    const closeBtn = document.getElementById('closeImportTargetModal');
    const clearBtn = document.getElementById('clearImportTargetSelectionBtn');

    if (!modal || !list) return;

    restoreImportTargetTreeCache.clear();
    restoreImportTargetTreeLoading.clear();
    restoreImportTargetPathCache.clear();

    let pendingRestoreImportTarget = restoreImportTarget
        ? { ...restoreImportTarget }
        : null;
    const getPendingRestoreImportTarget = () => pendingRestoreImportTarget || null;

    const getFolderDisplayTitle = (node) => {
        const rawTitle = String(node?.title || '').trim();
        return rawTitle || (currentLang === 'zh_CN' ? '未命名文件夹' : 'Untitled Folder');
    };

    const fetchBookmarkChildren = (parentId) => {
        return new Promise((resolve) => {
            try {
                browserAPI.bookmarks.getChildren(String(parentId), (children) => {
                    if (browserAPI.runtime.lastError) {
                        resolve([]);
                        return;
                    }
                    resolve(Array.isArray(children) ? children : []);
                });
            } catch (_) {
                resolve([]);
            }
        });
    };

    const ensureChildrenLoaded = async (folderId) => {
        const key = String(folderId);
        if (restoreImportTargetTreeCache.has(key)) {
            return restoreImportTargetTreeCache.get(key);
        }

        if (restoreImportTargetTreeLoading.has(key)) {
            return await restoreImportTargetTreeLoading.get(key);
        }

        const task = (async () => {
            const allChildren = await fetchBookmarkChildren(key);
            const folderChildren = allChildren
                .filter((node) => node && !node.url && String(node.id || '') !== '0')
                .map((node, index) => ({
                    id: String(node.id),
                    title: getFolderDisplayTitle(node),
                    index: Number.isFinite(Number(node.index)) ? Number(node.index) : index
                }));

            folderChildren.sort((a, b) => a.index - b.index);

            const stats = {
                folderCount: folderChildren.length,
                bookmarkCount: allChildren.filter((node) => node && !!node.url).length
            };

            const entry = { folders: folderChildren, stats };
            restoreImportTargetTreeCache.set(key, entry);
            return entry;
        })();

        restoreImportTargetTreeLoading.set(key, task);
        try {
            return await task;
        } finally {
            restoreImportTargetTreeLoading.delete(key);
        }
    };

    const getFolderStatsText = (folderId) => {
        const cached = restoreImportTargetTreeCache.get(String(folderId));
        if (!cached || !cached.stats) {
            return currentLang === 'zh_CN' ? '夹- · 签-' : 'F- · B-';
        }
        const folderCount = Number(cached.stats.folderCount || 0);
        const bookmarkCount = Number(cached.stats.bookmarkCount || 0);
        return currentLang === 'zh_CN'
            ? `夹${folderCount} · 签${bookmarkCount}`
            : `F${folderCount} · B${bookmarkCount}`;
    };

    const getNodePath = (nodeId, nodeTitle, parentPath = '') => {
        const key = String(nodeId);
        if (restoreImportTargetPathCache.has(key)) {
            return restoreImportTargetPathCache.get(key);
        }
        const path = parentPath ? `${parentPath} / ${nodeTitle}` : nodeTitle;
        restoreImportTargetPathCache.set(key, path);
        return path;
    };

    const prefetchNodeStats = (nodeId, metaEl) => {
        if (!metaEl || !nodeId) return;
        ensureChildrenLoaded(nodeId)
            .then(() => {
                if (!metaEl.isConnected) return;
                metaEl.textContent = getFolderStatsText(nodeId);
            })
            .catch(() => {
                if (!metaEl.isConnected) return;
                metaEl.textContent = currentLang === 'zh_CN' ? '夹- · 签-' : 'F- · B-';
            });
    };

    const createTreeNode = (node, level = 0, parentPath = '') => {
        const nodeId = String(node.id || '');
        const nodeTitle = getFolderDisplayTitle(node);
        const nodePath = getNodePath(nodeId, nodeTitle, parentPath);

        const nodeEl = document.createElement('div');
        nodeEl.className = 'import-target-tree-node';
        nodeEl.dataset.id = nodeId;
        nodeEl.dataset.title = nodeTitle;
        nodeEl.dataset.path = nodePath;
        nodeEl.dataset.level = String(level);

        const rowEl = document.createElement('div');
        rowEl.className = 'import-target-tree-row';
        rowEl.style.paddingLeft = `${8 + (level * 16)}px`;

        const selected = getPendingRestoreImportTarget();
        if (selected && String(selected.id) === nodeId) {
            rowEl.classList.add('selected');
        }

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'import-target-tree-toggle';
        toggleBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';

        const iconEl = document.createElement('span');
        iconEl.className = 'import-target-tree-icon';
        iconEl.innerHTML = '<i class="fas fa-folder"></i>';

        const titleNode = document.createElement('span');
        titleNode.className = 'import-target-tree-title';
        titleNode.textContent = nodeTitle;

        const metaEl = document.createElement('span');
        metaEl.className = 'import-target-tree-meta';
        metaEl.textContent = getFolderStatsText(nodeId);
        prefetchNodeStats(nodeId, metaEl);

        const markEl = document.createElement('span');
        markEl.className = 'import-target-tree-selected-mark';
        markEl.innerHTML = selected && String(selected.id) === nodeId ? '<i class="fas fa-check"></i>' : '';

        rowEl.appendChild(toggleBtn);
        rowEl.appendChild(iconEl);
        rowEl.appendChild(titleNode);
        rowEl.appendChild(metaEl);
        rowEl.appendChild(markEl);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'import-target-tree-children';
        childrenEl.hidden = true;

        nodeEl.appendChild(rowEl);
        nodeEl.appendChild(childrenEl);
        return nodeEl;
    };

    const setListMessage = (message, type = 'normal') => {
        const className = type === 'error' ? 'import-target-tree-empty error' : 'import-target-tree-empty';
        list.innerHTML = `<div class="${className}">${message}</div>`;
    };

    const markSelectedRows = () => {
        const selected = getPendingRestoreImportTarget();
        const selectedId = selected ? String(selected.id) : '';
        list.querySelectorAll('.import-target-tree-row').forEach((row) => {
            const nodeEl = row.closest('.import-target-tree-node');
            const nodeId = nodeEl ? String(nodeEl.dataset.id || '') : '';
            const markEl = row.querySelector('.import-target-tree-selected-mark');
            const isSelected = selectedId && nodeId === selectedId;
            row.classList.toggle('selected', !!isSelected);
            if (markEl) {
                markEl.innerHTML = isSelected ? '<i class="fas fa-check"></i>' : '';
            }
        });
    };

    const expandNode = async (nodeEl) => {
        const childrenEl = nodeEl.querySelector(':scope > .import-target-tree-children');
        const toggleIcon = nodeEl.querySelector(':scope > .import-target-tree-row .import-target-tree-toggle i');
        const rowMeta = nodeEl.querySelector(':scope > .import-target-tree-row .import-target-tree-meta');
        if (!childrenEl) return;

        const shouldExpand = childrenEl.hidden;
        childrenEl.hidden = !shouldExpand;
        if (toggleIcon) {
            toggleIcon.className = shouldExpand ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
        }
        if (!shouldExpand) return;
        if (childrenEl.dataset.loaded === 'true') return;

        childrenEl.innerHTML = `<div class="import-target-tree-loading">${currentLang === 'zh_CN' ? '正在加载子文件夹...' : 'Loading folders...'}</div>`;

        const nodeId = String(nodeEl.dataset.id || '');
        const level = Number(nodeEl.dataset.level || 0);
        const nodePath = String(nodeEl.dataset.path || nodeEl.dataset.title || '');

        const entry = await ensureChildrenLoaded(nodeId);
        if (rowMeta) rowMeta.textContent = getFolderStatsText(nodeId);

        const folders = Array.isArray(entry?.folders) ? entry.folders : [];
        if (!folders.length) {
            childrenEl.innerHTML = `<div class="import-target-tree-empty">${currentLang === 'zh_CN' ? '没有子文件夹' : 'No subfolders'}</div>`;
            childrenEl.dataset.loaded = 'true';
            return;
        }

        const fragment = document.createDocumentFragment();
        folders.forEach((child) => {
            fragment.appendChild(createTreeNode(child, level + 1, nodePath));
        });
        childrenEl.innerHTML = '';
        childrenEl.appendChild(fragment);
        childrenEl.dataset.loaded = 'true';
        markSelectedRows();
    };

    const renderRootTree = async () => {
        list.innerHTML = '';
        const rootEntry = await ensureChildrenLoaded('0');
        const roots = Array.isArray(rootEntry?.folders) ? rootEntry.folders : [];

        if (!roots.length) {
            setListMessage(currentLang === 'zh_CN' ? '未找到可用的书签文件夹。' : 'No folders found in bookmarks.', 'error');
            return;
        }

        const fragment = document.createDocumentFragment();
        roots.forEach((node) => {
            fragment.appendChild(createTreeNode(node, 0, ''));
        });
        list.appendChild(fragment);
    };

    if (titleEl) titleEl.textContent = currentLang === 'zh_CN' ? '选择导入位置' : 'Select Import Location';
    if (descEl) {
        descEl.textContent = currentLang === 'zh_CN'
            ? '可选择任意文件夹作为导入位置，子文件夹按展开加载。'
            : 'Browse any folder. Subfolders load when expanded.';
    }
    if (autoBtn) autoBtn.textContent = currentLang === 'zh_CN' ? '自动选择' : 'Auto';
    if (confirmBtn) confirmBtn.textContent = currentLang === 'zh_CN' ? '确认选择' : 'Confirm Selection';
    if (cancelBtn) cancelBtn.textContent = currentLang === 'zh_CN' ? '取消' : 'Cancel';

    const closeModal = () => { modal.style.display = 'none'; };
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeBtn) closeBtn.onclick = closeModal;
    if (clearBtn) {
        const clearLabel = currentLang === 'zh_CN' ? '清除选择' : 'Clear selection';
        clearBtn.title = clearLabel;
        clearBtn.setAttribute('aria-label', clearLabel);
        clearBtn.onclick = () => {
            pendingRestoreImportTarget = null;
            markSelectedRows();
        };
    }
    if (autoBtn) {
        autoBtn.onclick = () => {
            pendingRestoreImportTarget = null;
            markSelectedRows();
        };
    }
    if (confirmBtn) {
        confirmBtn.onclick = () => {
            restoreImportTarget = pendingRestoreImportTarget ? { ...pendingRestoreImportTarget } : null;
            updateRestoreImportTargetHint('merge');
            closeModal();
        };
    }

    modal.style.display = 'flex';
    setListMessage(currentLang === 'zh_CN' ? '正在加载文件夹...' : 'Loading folders...');

    list.onclick = async (event) => {
        const toggleBtn = event.target?.closest?.('.import-target-tree-toggle');
        const row = event.target?.closest?.('.import-target-tree-row');
        const nodeEl = event.target?.closest?.('.import-target-tree-node');
        if (!nodeEl || !list.contains(nodeEl)) return;

        if (toggleBtn) {
            await expandNode(nodeEl);
            return;
        }

        if (row) {
            const id = String(nodeEl.dataset.id || '');
            const title = String(nodeEl.dataset.title || id);
            const path = String(nodeEl.dataset.path || title);
            if (id) {
                pendingRestoreImportTarget = { id, title, path };
                markSelectedRows();
            }
        }
    };

    try {
        await renderRootTree();
        markSelectedRows();
    } catch (_) {
        setListMessage(currentLang === 'zh_CN' ? '加载文件夹失败。' : 'Failed to load folders.', 'error');
    }
}

function lockRestoreStrategy(lock) {
    const strategyGroup = document.getElementById('restoreStrategyGroup');
    const strategyOverwriteRadio = document.getElementById('restoreStrategyOverwrite');
    const strategyMergeRadio = document.getElementById('restoreStrategyMerge');
    if (strategyGroup) {
        if (lock) strategyGroup.classList.add('disabled');
        else strategyGroup.classList.remove('disabled');
    }
    if (strategyOverwriteRadio) strategyOverwriteRadio.disabled = !!lock;
    if (strategyMergeRadio) strategyMergeRadio.disabled = !!lock;
}

function summarizeChangeMap(changeMap) {
    const summary = { added: 0, deleted: 0, moved: 0, modified: 0 };
    if (!changeMap || !(changeMap instanceof Map)) return summary;
    changeMap.forEach(change => {
        const types = (change && change.type ? String(change.type).split('+') : []);
        if (types.includes('added')) summary.added += 1;
        if (types.includes('deleted')) summary.deleted += 1;
        if (types.includes('moved')) summary.moved += 1;
        if (types.includes('modified')) summary.modified += 1;
    });
    return summary;
}

function normalizeChangeMapForOverwriteAddDeleteOnly(changeMap) {
    if (!changeMap || !(changeMap instanceof Map)) return new Map();

    const normalized = new Map();
    changeMap.forEach((change, id) => {
        if (!change || typeof change.type !== 'string') return;

        const sourceTypes = change.type.split('+').filter(Boolean);
        const isAmbiguous = sourceTypes.includes('ambiguous');
        const hasAdded = sourceTypes.includes('added') || sourceTypes.includes('modified') || sourceTypes.includes('moved');
        const hasDeleted = sourceTypes.includes('deleted') || sourceTypes.includes('modified') || sourceTypes.includes('moved');

        if (!hasAdded && !hasDeleted && !isAmbiguous) return;

        const nextTypes = [];
        if (hasAdded) nextTypes.push('added');
        if (hasDeleted) nextTypes.push('deleted');
        if (isAmbiguous && nextTypes.length === 0) nextTypes.push('ambiguous');

        if (nextTypes.length === 0) return;

        const nextChange = { ...change, type: nextTypes.join('+') };
        delete nextChange.moved;
        delete nextChange.modified;
        normalized.set(id, nextChange);
    });

    return normalized;
}

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

    for (const list of byParent.values()) {
        list.sort((a, b) => {
            const ai = typeof a.index === 'number' ? a.index : 0;
            const bi = typeof b.index === 'number' ? b.index : 0;
            return ai - bi;
        });
    }

    return { nodes, byParent };
}

function normalizeRevertRootKeyForDiff(id, title) {
    const idText = String(id || '');
    const titleText = String(title || '').toLowerCase();
    if (!idText && !titleText) return 'unknown';
    if (idText === '1' || idText === 'toolbar_____') return 'toolbar';
    if (idText === '2' || idText === 'menu________') return 'menu';
    if (idText === '3' || idText === 'unfiled_____') return 'unfiled';
    if (idText === 'mobile______') return 'mobile';
    if (titleText.includes('toolbar') || titleText.includes('书签栏')) return 'toolbar';
    if (titleText.includes('menu') || titleText.includes('菜单') || titleText.includes('其他书签')) return 'menu';
    if (titleText.includes('unfiled')) return 'unfiled';
    if (titleText.includes('mobile') || titleText.includes('移动')) return 'mobile';
    return idText || titleText || 'unknown';
}

function mapRevertRootIdsForDiff(currentTree, targetTree) {
    const map = new Map();
    const currentRoot = Array.isArray(currentTree) ? currentTree[0] : currentTree;
    const targetRoot = Array.isArray(targetTree) ? targetTree[0] : targetTree;
    if (!currentRoot || !targetRoot) return map;

    if (currentRoot.id != null && targetRoot.id != null) {
        map.set(String(targetRoot.id), String(currentRoot.id));
    }

    const currentChildren = Array.isArray(currentRoot.children) ? currentRoot.children : [];
    const targetChildren = Array.isArray(targetRoot.children) ? targetRoot.children : [];

    const currentByKey = new Map();
    currentChildren.forEach((node) => {
        if (!node || node.id == null) return;
        const key = normalizeRevertRootKeyForDiff(node.id, node.title);
        if (!currentByKey.has(key)) {
            currentByKey.set(key, String(node.id));
        }
    });

    targetChildren.forEach((node) => {
        if (!node || node.id == null) return;
        const key = normalizeRevertRootKeyForDiff(node.id, node.title);
        const mapped = currentByKey.get(key);
        if (mapped) {
            map.set(String(node.id), String(mapped));
        }
    });

    return map;
}

function mergeRevertChangeType(typeA, typeB) {
    const ordered = ['added', 'deleted', 'modified', 'moved'];
    const set = new Set();

    const add = (value) => {
        if (!value || typeof value !== 'string') return;
        value.split('+').forEach((part) => {
            const key = String(part || '').trim();
            if (key) set.add(key);
        });
    };

    add(typeA);
    add(typeB);

    const merged = ordered.filter((key) => set.has(key));
    return merged.join('+');
}

function computeIdStrictPatchChangeMap(oldTree, newTree) {
    const changeMap = new Map();

    if (!Array.isArray(oldTree) || !Array.isArray(newTree) || !oldTree[0] || !newTree[0]) {
        return changeMap;
    }

    const oldIndex = buildTreeIndexForDiff(oldTree);
    const newIndex = buildTreeIndexForDiff(newTree);

    const oldNodes = new Map();
    const newNodes = new Map();

    oldIndex.nodes.forEach((node, id) => oldNodes.set(String(id), node));
    newIndex.nodes.forEach((node, id) => newNodes.set(String(id), node));

    const buildPathResolver = (index) => {
        const cache = new Map();
        return (nodeId) => {
            const key = String(nodeId || '');
            if (!key) return '';
            if (cache.has(key)) return cache.get(key);

            const parts = [];
            let curId = key;
            let guard = 0;

            while (curId && guard++ < 1024) {
                const node = index.nodes.get(curId);
                if (!node) break;
                parts.push(String(node.title || ''));
                curId = node.parentId != null ? String(node.parentId) : '';
            }

            const path = parts.reverse().join(' > ');
            cache.set(key, path);
            return path;
        };
    };

    const getOldPath = buildPathResolver(oldIndex);
    const getNewPath = buildPathResolver(newIndex);

    const idRemap = mapRevertRootIdsForDiff(oldTree, newTree);
    const resolveTargetId = (targetId) => {
        if (targetId == null) return null;
        const key = String(targetId);
        return idRemap.has(key) ? String(idRemap.get(key)) : key;
    };

    const oldRoot = oldTree[0];
    const newRoot = newTree[0];
    const protectedCurrentIds = new Set();
    const protectedTargetIds = new Set();

    if (oldRoot && oldRoot.id != null) {
        protectedCurrentIds.add(String(oldRoot.id));
        const oldRootChildren = Array.isArray(oldRoot.children) ? oldRoot.children : [];
        oldRootChildren.forEach((child) => {
            if (!child || child.id == null) return;
            protectedCurrentIds.add(String(child.id));
        });
    }

    if (newRoot && newRoot.id != null) {
        protectedTargetIds.add(String(newRoot.id));
        const newRootChildren = Array.isArray(newRoot.children) ? newRoot.children : [];
        newRootChildren.forEach((child) => {
            if (!child || child.id == null) return;
            protectedTargetIds.add(String(child.id));
        });
    }

    const targetResolvedIds = new Set();
    const addedTargetIds = new Set();
    const deletedCurrentIds = new Set();
    const crossMovedTargetIds = new Set();
    const matchedTargetByCurrentId = new Map();
    const explicitMovedSet = __getActiveExplicitMovedIdSetFromMap(explicitMovedIds);
    const hasExplicitMovedSet = explicitMovedSet instanceof Set && explicitMovedSet.size > 0;

    const applyMovedForTarget = (targetId, oldNode, targetNode, oldParentId, newParentId) => {
        const key = String(targetId);
        const oldPos = Number.isFinite(Number(oldNode && oldNode.index)) ? Number(oldNode.index) : null;
        const newPos = Number.isFinite(Number(targetNode && targetNode.index)) ? Number(targetNode.index) : null;
        const existing = changeMap.get(key) || {};
        const mergedType = mergeRevertChangeType(existing.type, 'moved');
        changeMap.set(key, {
            ...existing,
            type: mergedType,
            moved: {
                oldPath: getOldPath(oldNode && oldNode.id != null ? oldNode.id : key),
                newPath: getNewPath(key),
                oldParentId,
                oldIndex: oldPos,
                newParentId,
                newIndex: newPos
            }
        });
    };

    newNodes.forEach((targetNode, targetIdRaw) => {
        const targetId = String(targetIdRaw);
        if (protectedTargetIds.has(targetId)) return;

        const actualId = resolveTargetId(targetId);
        if (actualId) targetResolvedIds.add(String(actualId));

        const oldNode = actualId ? oldNodes.get(String(actualId)) : null;
        if (!oldNode) {
            addedTargetIds.add(targetId);
            changeMap.set(targetId, { type: 'added' });
            return;
        }

        matchedTargetByCurrentId.set(String(actualId), targetId);

        const oldTitle = String(oldNode.title || '');
        const newTitle = String(targetNode.title || '');
        const oldUrl = String(oldNode.url || '');
        const newUrl = String(targetNode.url || '');
        if (oldTitle !== newTitle || oldUrl !== newUrl) {
            changeMap.set(targetId, {
                ...(changeMap.get(targetId) || {}),
                type: mergeRevertChangeType(changeMap.get(targetId)?.type, 'modified')
            });
        }

        const oldParentId = oldNode.parentId != null ? String(oldNode.parentId) : null;
        const newParentIdRaw = resolveTargetId(targetNode.parentId);
        const newParentId = newParentIdRaw != null ? String(newParentIdRaw) : null;

        if (oldParentId !== newParentId) {
            crossMovedTargetIds.add(targetId);
            applyMovedForTarget(targetId, oldNode, targetNode, oldParentId, newParentId);
        }
    });

    oldNodes.forEach((oldNode, oldIdRaw) => {
        const oldId = String(oldIdRaw);
        if (protectedCurrentIds.has(oldId)) return;
        if (targetResolvedIds.has(oldId)) return;

        deletedCurrentIds.add(oldId);
        changeMap.set(oldId, {
            type: 'deleted',
            deleted: {
                oldPath: getOldPath(oldId),
                oldParentId: oldNode.parentId != null ? String(oldNode.parentId) : null,
                oldIndex: Number.isFinite(Number(oldNode.index)) ? Number(oldNode.index) : null
            }
        });
    });

    if (hasExplicitMovedSet) {
        explicitMovedSet.forEach((currentIdRaw) => {
            const currentId = String(currentIdRaw || '');
            if (!currentId || protectedCurrentIds.has(currentId)) return;

            const targetId = matchedTargetByCurrentId.get(currentId);
            if (!targetId || protectedTargetIds.has(String(targetId))) return;

            const oldNode = oldNodes.get(currentId);
            const targetNode = newNodes.get(String(targetId));
            if (!oldNode || !targetNode) return;

            const oldParentId = oldNode.parentId != null ? String(oldNode.parentId) : null;
            const newParentIdRaw = resolveTargetId(targetNode.parentId);
            const newParentId = newParentIdRaw != null ? String(newParentIdRaw) : null;

            const oldPos = Number.isFinite(Number(oldNode.index)) ? Number(oldNode.index) : null;
            const newPos = Number.isFinite(Number(targetNode.index)) ? Number(targetNode.index) : null;

            if (oldParentId !== newParentId || oldPos !== newPos) {
                applyMovedForTarget(targetId, oldNode, targetNode, oldParentId, newParentId);
            }
        });
    }

    const parentsWithChildSetChange = new Set();
    addedTargetIds.forEach((targetId) => {
        const node = newNodes.get(String(targetId));
        const parentId = node && node.parentId != null ? resolveTargetId(node.parentId) : null;
        if (parentId != null) parentsWithChildSetChange.add(String(parentId));
    });
    deletedCurrentIds.forEach((oldId) => {
        const node = oldNodes.get(String(oldId));
        if (node && node.parentId != null) parentsWithChildSetChange.add(String(node.parentId));
    });
    crossMovedTargetIds.forEach((targetId) => {
        const node = newNodes.get(String(targetId));
        const actualId = resolveTargetId(targetId);
        const oldNode = actualId ? oldNodes.get(String(actualId)) : null;
        if (oldNode && oldNode.parentId != null) parentsWithChildSetChange.add(String(oldNode.parentId));
        const newParentId = node && node.parentId != null ? resolveTargetId(node.parentId) : null;
        if (newParentId != null) parentsWithChildSetChange.add(String(newParentId));
    });

    if (hasExplicitMovedSet) {
        return changeMap;
    }

    newIndex.byParent.forEach((targetChildren, targetParentIdRaw) => {
        const targetParentId = String(targetParentIdRaw);
        const actualParentId = resolveTargetId(targetParentId);
        if (!actualParentId) return;
        const actualParentIdStr = String(actualParentId);
        if (parentsWithChildSetChange.has(actualParentIdStr)) return;

        const oldChildren = oldIndex.byParent.get(actualParentIdStr) || [];
        if (oldChildren.length <= 1 || !Array.isArray(targetChildren) || targetChildren.length <= 1) return;

        const targetCurrentOrder = [];
        targetChildren.forEach((item) => {
            const targetChildId = String(item && item.id != null ? item.id : '');
            if (!targetChildId || protectedTargetIds.has(targetChildId)) return;
            const currentChildId = resolveTargetId(targetChildId);
            if (!currentChildId) return;
            const currentNode = oldNodes.get(String(currentChildId));
            if (!currentNode) return;
            if (String(currentNode.parentId || '') !== actualParentIdStr) return;
            targetCurrentOrder.push(String(currentChildId));
        });

        if (targetCurrentOrder.length <= 1) return;

        const targetSet = new Set(targetCurrentOrder);
        const oldCommonOrder = oldChildren
            .map((item) => String(item && item.id != null ? item.id : ''))
            .filter((id) => id && targetSet.has(id));

        if (oldCommonOrder.length <= 1 || oldCommonOrder.length !== targetCurrentOrder.length) return;

        let sameOrder = true;
        for (let i = 0; i < oldCommonOrder.length; i++) {
            if (oldCommonOrder[i] !== targetCurrentOrder[i]) {
                sameOrder = false;
                break;
            }
        }
        if (sameOrder) return;

        const oldPosById = new Map();
        oldCommonOrder.forEach((id, idx) => oldPosById.set(id, idx));

        const seq = [];
        for (const currentId of targetCurrentOrder) {
            const oldPos = oldPosById.get(currentId);
            if (typeof oldPos !== 'number') {
                seq.length = 0;
                break;
            }
            seq.push({ currentId, oldPos });
        }
        if (!seq.length) return;

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

        const stableCurrentIds = new Set();
        let k = tailsIdx.length ? tailsIdx[tailsIdx.length - 1] : -1;
        while (k >= 0) {
            stableCurrentIds.add(seq[k].currentId);
            k = prevIdx[k];
        }

        seq.forEach(({ currentId }) => {
            if (stableCurrentIds.has(currentId)) return;
            const targetId = matchedTargetByCurrentId.get(String(currentId));
            if (!targetId) return;
            const oldNode = oldNodes.get(String(currentId));
            const targetNode = newNodes.get(String(targetId));
            if (!oldNode || !targetNode) return;
            const oldParentId = oldNode.parentId != null ? String(oldNode.parentId) : null;
            const newParentIdRaw = resolveTargetId(targetNode.parentId);
            const newParentId = newParentIdRaw != null ? String(newParentIdRaw) : null;
            applyMovedForTarget(targetId, oldNode, targetNode, oldParentId, newParentId);
        });
    });

    return changeMap;
}

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

    for (const id of oldIndex.nodes.keys()) {
        if (!newIndex.nodes.has(id)) deletedIds.add(id);
    }

    const urlToDeletedId = new Map();
    for (const id of deletedIds) {
        const node = oldIndex.nodes.get(id);
        if (node && node.url) {
            urlToDeletedId.set(node.url, id);
        }
    }

    const reconciledAddedIds = new Set();

    for (const id of addedIds) {
        const newNode = newIndex.nodes.get(id);
        if (!newNode || !newNode.url) continue;

        const oldId = urlToDeletedId.get(newNode.url);
        if (oldId) {
            const oldNode = oldIndex.nodes.get(oldId);

            reconciledAddedIds.add(id);
            deletedIds.delete(oldId);

            if (oldNode.title !== newNode.title) {
                modifiedIds.add(id);
            }

            const oldParent = oldIndex.nodes.get(oldNode.parentId);
            const newParent = newIndex.nodes.get(newNode.parentId);

            if (oldParent && newParent && oldParent.title !== newParent.title) {
                movedIds.add(id);
                crossParentMovedIds.add(id);
            }

            urlToDeletedId.delete(newNode.url);
        }
    }

    for (const id of reconciledAddedIds) {
        addedIds.delete(id);
    }

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
        const n = newIndex.nodes.get(id);
        const o = oldIndex.nodes.get(id);
        if (o && o.parentId) parentsWithChildSetChange.add(o.parentId);
        if (n && n.parentId) parentsWithChildSetChange.add(n.parentId);
    }

    const hasExplicitMovedInfo = explicitMovedIds && explicitMovedIds.size > 0;

    if (hasExplicitMovedInfo) {
        // No explicit moved info in restore context; fallthrough
    }

    {
        for (const [parentId, newList] of newIndex.byParent.entries()) {
            if (parentsWithChildSetChange.has(parentId)) continue;

            const oldList = oldIndex.byParent.get(parentId) || [];
            if (oldList.length === 0 || newList.length === 0) continue;
            if (oldList.length !== newList.length) continue;

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

    const report = {
        ambiguous: [],
        matched: {
            id: 0,
            manual: 0,
            structure: 0,
            url: 0,
            title: 0
        }
    };

    const recordAmbiguous = (item) => {
        try {
            if (report.ambiguous.length >= 200) return;
            report.ambiguous.push(item);
        } catch (_) {
        }
    };

    const pickUniqueClosestByIndex = (targetIndex, candidates) => {
        if (typeof targetIndex !== 'number' || !Number.isFinite(targetIndex)) return null;
        if (!Array.isArray(candidates) || candidates.length === 0) return null;

        const withIndex = candidates
            .filter(c => c && typeof c.index === 'number' && Number.isFinite(c.index))
            .slice();

        if (withIndex.length === 0) return null;

        withIndex.sort((a, b) => {
            const da = Math.abs(a.index - targetIndex);
            const db = Math.abs(b.index - targetIndex);
            if (da !== db) return da - db;
            return a.index - b.index;
        });

        const best = withIndex[0];
        const bestDist = Math.abs(best.index - targetIndex);
        const tieCount = withIndex.filter(c => Math.abs(c.index - targetIndex) === bestDist).length;
        if (tieCount === 1) return best;
        return null;
    };

    const manualMatchMap = (() => {
        if (!options || typeof options !== 'object' || !options.manualMatches) return null;
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
                child.parentId = newId;
            });
        }
    };

    const pass1_IDMatch = (nodes) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach(node => {
            const id = String(node.id);
            if (refPool.ids.has(id)) {
                if (!refPool.claimedIds.has(id)) {
                    const refNode = refPool.nodeMap.get(id);
                    const isSameType = (!!node.url === !!refNode.url);
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

    if (manualMatchMap && manualMatchMap.size > 0) {
        const pass1_5_ManualMatch = (nodes) => {
            if (!nodes) return;
            const list = Array.isArray(nodes) ? nodes : [nodes];
            list.forEach(node => {
                if (!node || !node.id) return;

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

    const pass2_StructureMatch = (nodes, parentRefNode) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach((node, index) => {
            if (!node || !node.id) return;

            if (!node._matchedRefNode) {
                const refParentId = parentRefNode && parentRefNode.id ? String(parentRefNode.id) : null;
                const candidates = [];

                if (refParentId) {
                    for (const [id, refNode] of refPool.nodeMap.entries()) {
                        if (refPool.claimedIds.has(id)) continue;
                        if (String(refNode.parentId || '') !== refParentId) continue;

                        const isSameType = (!!node.url === !!refNode.url);
                        if (!isSameType) continue;

                        const targetKey = normalizeTitle(node.title || '');
                        const refKey = normalizeTitle(refNode.title || '');
                        const titleMatch = targetKey && refKey && targetKey === refKey;

                        if (node.url && refNode.url && node.url === refNode.url) {
                            candidates.push(refNode);
                        } else if (!node.url && titleMatch) {
                            candidates.push(refNode);
                        } else if (node.url && titleMatch) {
                            candidates.push(refNode);
                        }
                    }
                }

                if (candidates.length === 1) {
                    const chosen = candidates[0];
                    const newId = String(chosen.id);
                    updateNodeId(node, newId);
                    refPool.claimedIds.add(newId);
                    node._matchedRefNode = chosen;
                    report.matched.structure += 1;
                } else if (candidates.length > 1) {
                    const targetId = String(node.id);
                    const targetIndex = (typeof node.index === 'number' && Number.isFinite(node.index)) ? node.index : index;

                    const pickByIndex = pickUniqueClosestByIndex(targetIndex, candidates);
                    if (pickByIndex) {
                        const newId = String(pickByIndex.id);
                        updateNodeId(node, newId);
                        refPool.claimedIds.add(newId);
                        node._matchedRefNode = pickByIndex;
                        report.matched.structure += 1;
                    } else {
                        recordAmbiguous({
                            phase: 'structure',
                            type: node.url ? 'bookmark' : 'folder',
                            targetId,
                            targetParentId: node.parentId != null ? String(node.parentId) : '',
                            targetIndex,
                            title: node.title || '',
                            url: node.url || '',
                            candidates: candidates.slice(0, 6).map(c => ({
                                id: String(c.id),
                                title: c.title || '',
                                url: c.url || ''
                            }))
                        });
                    }
                }
            }

            if (node.children) {
                pass2_StructureMatch(node.children, node._matchedRefNode || null);
            }
        });
    };
    pass2_StructureMatch(targetTree, null);

    const pass3_GlobalUrlMatch = (nodes, parentRefNode) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach((node, index) => {
            if (!node || !node.id) return;

            if (!node._matchedRefNode && node.url) {
                const candidatesSet = refPool.urlMap.get(node.url);
                if (candidatesSet && candidatesSet.size > 0) {
                    const candidates = Array.from(candidatesSet).filter(refNode => {
                        if (!refNode || !refNode.id) return false;
                        if (refPool.claimedIds.has(String(refNode.id))) return false;
                        return true;
                    });

                    let bestMatch = null;
                    if (candidates.length === 1) {
                        bestMatch = candidates[0];
                    } else if (candidates.length > 1) {
                        const refParentId = parentRefNode && parentRefNode.id ? String(parentRefNode.id) : null;
                        const parentMatched = candidates.filter(c => String(c.parentId || '') === refParentId);

                        if (parentMatched.length === 1) {
                            bestMatch = parentMatched[0];
                        } else if (parentMatched.length > 1) {
                            const targetIndex = (typeof node.index === 'number' && Number.isFinite(node.index)) ? node.index : index;
                            const pickByIndex = pickUniqueClosestByIndex(targetIndex, parentMatched);
                            if (pickByIndex) {
                                bestMatch = pickByIndex;
                            } else {
                                recordAmbiguous({
                                    phase: 'url',
                                    type: 'bookmark',
                                    targetId: String(node.id),
                                    targetParentId: node.parentId != null ? String(node.parentId) : '',
                                    targetIndex,
                                    title: node.title || '',
                                    url: node.url || '',
                                    candidates: parentMatched.slice(0, 6).map(c => ({ id: String(c.id), title: c.title || '', url: c.url || '' }))
                                });
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

    const pass4_GlobalFolderTitleMatch = (nodes, parentRefNode) => {
        if (!nodes) return;
        const list = Array.isArray(nodes) ? nodes : [nodes];
        list.forEach(node => {
            if (!node || node.url) {
                if (node && node.children) pass4_GlobalFolderTitleMatch(node.children, node._matchedRefNode || null);
                return;
            }

            if (!node._matchedRefNode && node.title) {
                const key = normalizeTitle(node.title);
                const candidatesSet = key ? refPool.titleMap.get(key) : null;
                if (candidatesSet && candidatesSet.size > 0) {
                    const candidates = Array.from(candidatesSet).filter(refNode => {
                        if (!refNode || !refNode.id) return false;
                        if (refPool.claimedIds.has(String(refNode.id))) return false;
                        return true;
                    });

                    let bestMatch = null;
                    if (candidates.length === 1) {
                        bestMatch = candidates[0];
                    } else if (candidates.length > 1) {
                        const refParentId = parentRefNode && parentRefNode.id ? String(parentRefNode.id) : null;
                        const parentMatched = candidates.filter(c => String(c.parentId || '') === refParentId);
                        if (parentMatched.length === 1) {
                            bestMatch = parentMatched[0];
                        } else if (parentMatched.length > 1) {
                            const targetIndex = (typeof node.index === 'number' && Number.isFinite(node.index)) ? node.index : null;
                            const pickByIndex = pickUniqueClosestByIndex(targetIndex, parentMatched);
                            if (pickByIndex) {
                                bestMatch = pickByIndex;
                            } else {
                                recordAmbiguous({
                                    phase: 'title',
                                    type: 'folder',
                                    targetId: String(node.id),
                                    targetParentId: node.parentId != null ? String(node.parentId) : '',
                                    targetIndex,
                                    title: node.title || '',
                                    url: '',
                                    candidates: parentMatched.slice(0, 6).map(c => ({ id: String(c.id), title: c.title || '', url: '' }))
                                });
                            }
                        }
                    }

                    if (bestMatch) {
                        const newId = String(bestMatch.id);
                        updateNodeId(node, newId);
                        refPool.claimedIds.add(newId);
                        node._matchedRefNode = bestMatch;
                        report.matched.title += 1;
                    } else if (candidates.length > 1) {
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

function calculateNodeStats(nodes) {
    let stats = { bookmarks: 0, folders: 0 };
    if (!nodes) return stats;

    const list = Array.isArray(nodes) ? nodes : [nodes];

    for (const node of list) {
        if (node.children) {
            stats.folders++;
            const childStats = calculateNodeStats(node.children);
            stats.bookmarks += childStats.bookmarks;
            stats.folders += childStats.folders;
        } else {
            stats.bookmarks++;
        }
    }
    return stats;
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

function assertBookmarkTreeContent(snapshotTree, options = {}) {
    if (hasBookmarkTreeContent(snapshotTree)) return;

    const defaultMessage = currentLang === 'zh_CN'
        ? '目标书签树为空，已阻止操作以避免清空当前书签。'
        : 'Target bookmark tree is empty. Operation blocked to avoid wiping current bookmarks.';
    throw new Error(options && options.message ? String(options.message) : defaultMessage);
}

async function updateLastBookmarkDataSnapshot(snapshotTree, baselineTimestamp) {
    try {
        const tree = snapshotTree || await browserAPI.bookmarks.getTree();
        const stats = calculateNodeStats(tree);
        const prints = generateFingerprintsFromTree(tree || []);
        const timestamp = (baselineTimestamp && String(baselineTimestamp).trim() !== '')
            ? baselineTimestamp
            : new Date().toISOString();
        await browserAPI.storage.local.set({
            lastBookmarkData: {
                bookmarkCount: stats.bookmarks,
                folderCount: stats.folders,
                bookmarkPrints: prints.bookmarks,
                folderPrints: prints.folders,
                bookmarkTree: tree,
                timestamp: timestamp
            }
        });
        try {
            await browserAPI.storage.local.remove(['current-changes-cache:v1']);
        } catch (_) { }
    } catch (_) { }
}

async function buildRestoreDiffSummary(record, strategy = 'overwrite') {
    if (!record) return { html: '', changeMap: new Map(), currentTree: null, targetTree: null };
    await ensureRecordBookmarkTree(record);
    const targetTree = record.bookmarkTree;
    const currentTree = await browserAPI.bookmarks.getTree();
    const rawChangeMap = await detectTreeChangesFast(currentTree, targetTree, {
        useGlobalExplicitMovedIds: false
    });
    const normalizedStrategy = strategy === 'merge' ? 'merge' : 'overwrite';
    const changeMap = normalizedStrategy === 'overwrite'
        ? normalizeChangeMapForOverwriteAddDeleteOnly(rawChangeMap)
        : rawChangeMap;
    const { added, deleted } = summarizeChangeMap(changeMap);
    const isZh = currentLang === 'zh_CN';
    const html = `
        <span>${isZh ? '新增' : 'Added'}: <strong>${added}</strong></span>
        <span style="margin-left:8px;">${isZh ? '删除' : 'Deleted'}: <strong>${deleted}</strong></span>
    `;
    return { html, changeMap, currentTree, targetTree };
}

async function updateRestoreDiffSummaryByStrategy(strategy) {
    if (!currentRestoreRecord) return;
    const diffContainer = document.getElementById('restoreDiffSummary');
    if (!diffContainer) return;

    const { html, changeMap, currentTree, targetTree } = await buildRestoreDiffSummary(currentRestoreRecord, strategy);
    diffContainer.innerHTML = html || '';
    restoreGeneralPreflight = {
        recordTime: String(currentRestoreRecord.time),
        strategy,
        changeMap,
        currentTree,
        targetTree
    };
}

async function switchToRestorePreview(currentTree, targetTree, changeMap, options = {}) {
    const mainView = document.getElementById('restoreMainView');
    const previewView = document.getElementById('restorePreviewView');
    const title = document.getElementById('restoreModalTitle');
    const previewContent = document.getElementById('restorePreviewContent');

    if (!mainView || !previewView || !previewContent) return;

    mainView.style.display = 'none';
    previewView.style.display = 'flex';
    if (title) title.textContent = currentLang === 'zh_CN' ? '预览' : 'Preview';

    const closeBtn = document.getElementById('restoreModalClose');
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.addEventListener('click', () => {
            previewView.style.display = 'none';
            mainView.style.display = 'block';
            if (title) title.textContent = currentLang === 'zh_CN' ? '恢复到对应版本' : 'Restore to Version';

            const finalCloseBtn = newCloseBtn.cloneNode(true);
            newCloseBtn.parentNode.replaceChild(finalCloseBtn, newCloseBtn);
            finalCloseBtn.addEventListener('click', closeRestoreModal);
        });
    }

    previewContent.innerHTML = `<div class="loading" style="padding: 30px; color: var(--text-secondary); text-align: center;">
        <i class="fas fa-spinner fa-spin" style="font-size: 22px; margin-bottom: 16px; opacity: 0.6;"></i><br>
        ${currentLang === 'zh_CN' ? '正在生成预览...' : 'Generating preview...'}
    </div>`;

    try {
        let map = changeMap;
        if (!map) {
            map = await detectTreeChangesFast(currentTree, targetTree, { useGlobalExplicitMovedIds: false });
        }
        map = normalizeChangeMapForOverwriteAddDeleteOnly(map);

        let treeToRender = targetTree;
        let hasDeleted = false;
        map.forEach(change => {
            if (change && change.type && String(change.type).includes('deleted')) hasDeleted = true;
        });
        if (hasDeleted) {
            try {
                treeToRender = rebuildTreeWithDeleted(currentTree, targetTree, map);
            } catch (_) { }
        }
        const previewRecordKey = `restore-preview-${Date.now()}`;
        const treeHtml = generateHistoryTreeHtml(treeToRender, map, 'detailed', {
            recordTime: previewRecordKey,
            expandDepth: 1,
            lazyDepth: 1
        });

    const bodyHtml = treeHtml || `<div style="padding: 20px; color: var(--text-tertiary); text-align: center;">No Data</div>`;
    previewContent.innerHTML = bodyHtml;
        if (treeHtml) bindRestorePreviewTreeEvents(previewContent, previewRecordKey);
    } catch (e) {
        previewContent.innerHTML = `<div style="padding: 20px; color: var(--warning);">Error: ${e.message}</div>`;
    }
}

function bindRestorePreviewTreeEvents(previewContent, recordTimeKey) {
    if (!previewContent) return;
    const treeContainers = [];
    if (previewContent.classList && previewContent.classList.contains('history-tree-container')) {
        treeContainers.push(previewContent);
    }
    previewContent.querySelectorAll('.history-tree-container').forEach(el => {
        if (!treeContainers.includes(el)) treeContainers.push(el);
    });
    if (!treeContainers.length) return;

    const leafContainers = treeContainers.filter(el => {
        return !treeContainers.some(other => other !== el && el.contains(other));
    });

    leafContainers.forEach(treeContainer => {
        treeContainer.addEventListener('click', (e) => {
            const treeItem = e.target && e.target.closest ? e.target.closest('.tree-item') : null;
            if (!treeItem) return;
            if (e.target.closest && e.target.closest('a')) return;

            const treeNode = treeItem.closest('.tree-node');
            const children = treeNode ? treeNode.querySelector('.tree-children') : null;
            const toggle = treeItem.querySelector('.tree-toggle:not([style*="opacity: 0"])');
            if (children && toggle) {
                const isExpanding = !children.classList.contains('expanded');
                toggle.classList.toggle('expanded');
                children.classList.toggle('expanded');

                const folderIcon = treeItem.querySelector('.tree-icon.fa-folder, .tree-icon.fa-folder-open');
                if (folderIcon) {
                    if (isExpanding) {
                        folderIcon.classList.remove('fa-folder');
                        folderIcon.classList.add('fa-folder-open');
                    } else {
                        folderIcon.classList.remove('fa-folder-open');
                        folderIcon.classList.add('fa-folder');
                    }
                }

                try {
                    if (isExpanding &&
                        children.dataset &&
                        children.dataset.childrenLoaded === 'false' &&
                        treeItem.dataset &&
                        treeItem.dataset.nodeId) {
                        const lazyKey = treeContainer.dataset && treeContainer.dataset.lazyKey
                            ? treeContainer.dataset.lazyKey
                            : String(recordTimeKey || '');
                        const ctx = window.__historyTreeLazyContexts instanceof Map
                            ? window.__historyTreeLazyContexts.get(String(lazyKey))
                            : null;
                        if (ctx && typeof ctx.renderChildren === 'function') {
                            const html = ctx.renderChildren(
                                treeItem.dataset.nodeId,
                                children.dataset.childLevel,
                                children.dataset.nextForceInclude
                            );
                            children.innerHTML = html;
                            children.dataset.childrenLoaded = 'true';
                        }
                    }
                } catch (_) { }
            }
        });
    });
}

async function getCurrentCountsForRestore() {
    return new Promise(resolve => {
        browserAPI.runtime.sendMessage({ action: 'getBackupStats' }, response => {
            if (response && response.success && response.stats) {
                const counts = extractCountsFromStatsSource(response.stats);
                resolve(counts);
            } else {
                resolve({ bookmarks: 0, folders: 0 });
            }
        });
    });
}

function normalizeRestoreCountsForDisplay(counts) {
    const bookmarksValue = Number(counts && counts.bookmarks);
    const foldersValue = Number(counts && counts.folders);
    return {
        bookmarks: Number.isFinite(bookmarksValue) ? Math.max(0, Math.round(bookmarksValue)) : 0,
        folders: Number.isFinite(foldersValue) ? Math.max(0, Math.round(foldersValue)) : 0
    };
}

function setRestoreComparisonNumber(elementId, value) {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (typeof value === 'number' && Number.isFinite(value)) {
        element.textContent = String(Math.max(0, Math.round(value)));
        return;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        element.textContent = value;
        return;
    }

    element.textContent = '0';
}

function setRestoreComparisonNumberTone(elementId, tone = 'default') {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (tone === 'increase') {
        element.style.color = 'var(--success)';
        return;
    }

    if (tone === 'decrease') {
        element.style.color = 'var(--error)';
        return;
    }

    element.style.color = 'var(--text-primary)';
}

async function estimateRestoreMergeProjectedCounts(record, currentCounts) {
    const safeCurrentCounts = normalizeRestoreCountsForDisplay(currentCounts);
    if (!record) return safeCurrentCounts;

    await ensureRecordBookmarkTree(record);
    let treeToImport = record.bookmarkTree;

    try {
        const mode = getRecordDetailMode(record.time);
        const viewMode = (mode === 'simple' || mode === 'detailed') ? mode : 'simple';
        const processed = await getProcessedTreeForRecord(record, viewMode);
        if (processed && Array.isArray(processed.children)) {
            treeToImport = { title: 'root', children: processed.children };
        }
    } catch (_) { }

    const importedCounts = { bookmarks: 0, folders: 1 };
    const rootNodes = Array.isArray(treeToImport) ? treeToImport : [treeToImport];

    for (const rootNode of rootNodes) {
        if (!rootNode || !Array.isArray(rootNode.children)) continue;

        for (const topFolder of rootNode.children) {
            if (!topFolder) continue;
            importedCounts.folders += 1;

            if (!Array.isArray(topFolder.children)) continue;
            for (const child of topFolder.children) {
                const childStats = calculateNodeStats(child);
                importedCounts.bookmarks += childStats.bookmarks;
                importedCounts.folders += childStats.folders;
            }
        }
    }

    return {
        bookmarks: safeCurrentCounts.bookmarks + importedCounts.bookmarks,
        folders: safeCurrentCounts.folders + importedCounts.folders
    };
}

async function updateRestoreComparisonByStrategy(strategy) {
    const state = restoreComparisonState;
    if (!state) return;

    const normalizedStrategy = strategy === 'merge' ? 'merge' : 'overwrite';
    const isZh = currentLang === 'zh_CN';
    const currentCounts = normalizeRestoreCountsForDisplay(state.currentCounts);
    const backupCounts = normalizeRestoreCountsForDisplay(state.backupCounts);

    const currentLabel = document.getElementById('restoreCurrentLabel');
    const backupLabel = document.getElementById('restoreBackupLabel');
    const fingerprintEl = document.getElementById('restoreBackupFingerprint');

    if (currentLabel) currentLabel.textContent = isZh ? '当前浏览器' : 'Current Browser';

    setRestoreComparisonNumber('restoreCurrentCount', currentCounts.bookmarks);
    setRestoreComparisonNumber('restoreCurrentFolders', currentCounts.folders);

    if (normalizedStrategy !== 'merge') {
        if (backupLabel) backupLabel.textContent = isZh ? '备份记录' : 'Backup Record';
        if (fingerprintEl) fingerprintEl.style.display = 'none';
        setRestoreComparisonNumber('restoreBackupCount', backupCounts.bookmarks);
        setRestoreComparisonNumber('restoreBackupFolders', backupCounts.folders);
        setRestoreComparisonNumberTone('restoreBackupCount', 'default');
        setRestoreComparisonNumberTone('restoreBackupFolders', 'default');
        return;
    }

    if (backupLabel) backupLabel.textContent = isZh ? '加入后效果' : 'After Import';
    if (fingerprintEl) {
        const fullFingerprint = fingerprintEl.dataset && fingerprintEl.dataset.fullFingerprint
            ? String(fingerprintEl.dataset.fullFingerprint)
            : '';
        fingerprintEl.style.display = fullFingerprint ? 'inline-flex' : 'none';
    }

    if (state.mergeProjectedCounts) {
        const projectedCounts = normalizeRestoreCountsForDisplay(state.mergeProjectedCounts);
        const bookmarkDelta = projectedCounts.bookmarks - currentCounts.bookmarks;
        const folderDelta = projectedCounts.folders - currentCounts.folders;

        setRestoreComparisonNumber('restoreBackupCount', projectedCounts.bookmarks);
        setRestoreComparisonNumber('restoreBackupFolders', projectedCounts.folders);
        setRestoreComparisonNumberTone('restoreBackupCount', bookmarkDelta > 0 ? 'increase' : (bookmarkDelta < 0 ? 'decrease' : 'default'));
        setRestoreComparisonNumberTone('restoreBackupFolders', folderDelta > 0 ? 'increase' : (folderDelta < 0 ? 'decrease' : 'default'));
        return;
    }

    setRestoreComparisonNumber('restoreBackupCount', '...');
    setRestoreComparisonNumber('restoreBackupFolders', '...');
    setRestoreComparisonNumberTone('restoreBackupCount', 'default');
    setRestoreComparisonNumberTone('restoreBackupFolders', 'default');

    if (!state.mergeProjectedPromise) {
        const recordAtStart = currentRestoreRecord;
        const stateRecordTime = String(state.recordTime || '');
        state.mergeProjectedPromise = estimateRestoreMergeProjectedCounts(recordAtStart, currentCounts)
            .then((projectedCounts) => {
                if (!restoreComparisonState) return;
                if (String(restoreComparisonState.recordTime || '') !== stateRecordTime) return;
                restoreComparisonState.mergeProjectedCounts = normalizeRestoreCountsForDisplay(projectedCounts);
            })
            .catch(() => {
                if (!restoreComparisonState) return;
                if (String(restoreComparisonState.recordTime || '') !== stateRecordTime) return;
                restoreComparisonState.mergeProjectedCounts = { ...currentCounts };
            })
            .finally(() => {
                if (!restoreComparisonState) return;
                if (String(restoreComparisonState.recordTime || '') !== stateRecordTime) return;
                restoreComparisonState.mergeProjectedPromise = null;
                if (getSelectedRestoreStrategy() === 'merge') {
                    updateRestoreComparisonByStrategy('merge').catch(() => { });
                }
            });
    }
}

function updateRestoreModalI18n() {
    const isZh = currentLang === 'zh_CN';

    const texts = {
        restoreModalTitle: isZh ? '恢复到对应版本' : 'Restore to Version',
        restoreVersionLabel: isZh ? '即将恢复到以下版本:' : 'Restore to the following version:',
        restoreProgressLabel: isZh ? '正在恢复...' : 'Restoring...',
        restoreConfirmBtn: isZh ? '恢复' : 'Restore',
        restoreCancelBtn: isZh ? '取消' : 'Cancel',
        restoreCurrentLabel: isZh ? '当前浏览器' : 'Current Browser',
        restoreCurrentBookmarksLabel: isZh ? '书签' : 'Bookmarks',
        restoreCurrentFoldersLabel: isZh ? '文件夹' : 'Folders',
        restoreBackupLabel: isZh ? '备份记录' : 'Backup Record',
        restoreBackupBookmarksLabel: isZh ? '书签' : 'Bookmarks',
        restoreBackupFoldersLabel: isZh ? '文件夹' : 'Folders',
        restorePreviewBtnText: isZh ? '预览' : 'Preview',
        restoreImportTargetBtnText: isZh ? '导入位置' : 'Import Target'
    };

    Object.entries(texts).forEach(([id, text]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    });

    const setStrategyLabel = (labelId, text) => {
        const labelEl = document.getElementById(labelId);
        if (!labelEl) return;
        const span = labelEl.querySelector('span:last-child');
        if (span) span.textContent = text;
    };

    setStrategyLabel('restoreStrategyOverwriteLabel', isZh ? '覆盖' : 'Overwrite');
    setStrategyLabel('restoreStrategyMergeLabel', isZh ? '导入合并' : 'Import Merge');

    const overwriteWrap = document.getElementById('restoreStrategyOverwriteLabelWrap');
    if (overwriteWrap) {
        overwriteWrap.title = isZh
            ? '覆盖：用该版本替换当前「书签栏」与「其他书签」（会重建书签并改变 ID，可能影响书签记录/推荐等数据）。'
            : 'Overwrite: replace Bookmarks Bar + Other Bookmarks (bookmarks are recreated; IDs change, may reset ID-based data).';
    }

    const mergeWrap = document.getElementById('restoreStrategyMergeLabelWrap');
    if (mergeWrap) {
        mergeWrap.title = isZh
            ? '导入合并：导入该记录的「差异视图」到书签树的新文件夹（不删除现有书签；标题带 [+]/[-]/[~]/[↔] 前缀）。'
            : 'Import Merge: import this record’s changes view into a new folder under bookmark roots (no deletion; titles prefixed with [+]/[-]/[~]/[↔]).';
    }

    updateRestoreWarning(getSelectedRestoreStrategy());
    updateRestoreImportTargetHint(getSelectedRestoreStrategy());
    updateRestoreComparisonByStrategy(getSelectedRestoreStrategy()).catch(() => { });
}

function updateRevertModalI18n() {
    const isZh = currentLang === 'zh_CN';
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setText('revertModalTitle', i18n.revertModalTitle[currentLang]);
    setText('revertCurrentLabel', i18n.revertCurrentLabel[currentLang]);
    setText('revertSnapshotLabel', i18n.revertSnapshotLabel[currentLang]);
    setText('revertCurrentBookmarksLabel', i18n.revertBookmarksLabel[currentLang]);
    setText('revertCurrentFoldersLabel', i18n.revertFoldersLabel[currentLang]);
    setText('revertSnapshotBookmarksLabel', i18n.revertBookmarksLabel[currentLang]);
    setText('revertSnapshotFoldersLabel', i18n.revertFoldersLabel[currentLang]);
    setText('revertPreviewBtnText', i18n.revertPreviewTitle[currentLang]);
    setText('revertPreviewTitle', i18n.revertPreviewTitle[currentLang]);
    setText('revertPreviewHelpExecLine', i18n.revertPreviewHelpExecLine[currentLang]);
    setText('revertPreviewHelpDisplayLine', i18n.revertPreviewHelpDisplayLine[currentLang]);

    const previewHelpBtn = document.getElementById('revertPreviewHelpBtn');
    if (previewHelpBtn) {
        const helpTitle = i18n.revertPreviewHelpBtnTitle[currentLang];
        previewHelpBtn.title = helpTitle;
        previewHelpBtn.setAttribute('aria-label', helpTitle);
    }

    setText('revertStrategyAutoText', i18n.revertStrategyAuto[currentLang]);
    setText('revertStrategyManualText', i18n.revertStrategyManual[currentLang]);
    setText('revertStrategyPatchText', i18n.revertStrategyPatch[currentLang]);
    setText('revertStrategyOverwriteText', i18n.revertStrategyOverwrite[currentLang]);
    setText('revertThresholdText', i18n.revertThresholdText[currentLang]);

    setText('revertConfirmBtn', i18n.revertConfirm[currentLang]);
    setText('revertCancelBtn', i18n.revertCancel[currentLang]);

    const badge = document.getElementById('revertSnapshotBadge');
    if (badge) badge.textContent = i18n.revertSnapshotBadge[currentLang];

    const thresholdPercent = getCurrentRevertPatchThresholdPercent();

    const autoWrap = document.getElementById('revertStrategyAutoLabelWrap');
    if (autoWrap) {
        autoWrap.title = isZh
            ? `智能撤销：变化占比 ≤${thresholdPercent}% 走补丁撤销，>${thresholdPercent}% 走覆盖撤销。`
            : `Smart revert: use patch when change ratio is ≤${thresholdPercent}%, otherwise overwrite.`;
    }

    const manualWrap = document.getElementById('revertStrategyManualLabelWrap');
    if (manualWrap) {
        manualWrap.title = isZh
            ? '手动模式：手动选择补丁撤销或覆盖撤销。'
            : 'Manual mode: choose patch revert or overwrite revert manually.';
    }

    const patchWrap = document.getElementById('revertStrategyPatchLabelWrap');
    if (patchWrap) {
        patchWrap.title = isZh
            ? '补丁撤销：仅按 ID 匹配；ID 匹配执行新增/删除/移动/修改，ID 不匹配按删除/新增处理。'
            : 'Patch revert: ID match only; matching IDs support add/delete/move/modify, non-matching IDs are handled as delete/create.';
    }

    const overwriteWrap = document.getElementById('revertStrategyOverwriteLabelWrap');
    if (overwriteWrap) {
        overwriteWrap.title = isZh
            ? '覆盖撤销：清空并恢复到上次备份快照（会重建书签，ID 将变化）。'
            : 'Overwrite revert: clears and restores to the last backup snapshot (IDs will change).';
    }

    const thresholdLabel = document.getElementById('revertThresholdLabel');
    if (thresholdLabel) thresholdLabel.title = i18n.revertThresholdTip[currentLang];

    updateRevertModeUI();
    updateRevertWarning(getSelectedRevertStrategy());
}

async function showRestoreModal(record, displayTitle) {
    if (!record) return;
    initRestoreModalEvents();
    updateRestoreModalI18n();

    currentRestoreRecord = record;
    restoreGeneralPreflight = null;
    try { setRestoreDiffBarVisible(false); } catch (_) { }
    const confirmBtn = document.getElementById('restoreConfirmBtn');
    if (confirmBtn) {
        confirmBtn.textContent = currentLang === 'zh_CN' ? '恢复' : 'Restore';
    }

    const modal = document.getElementById('restoreModal');
    if (!modal) return;

    const mainView = document.getElementById('restoreMainView');
    const previewView = document.getElementById('restorePreviewView');
    if (mainView) mainView.style.display = 'block';
    if (previewView) previewView.style.display = 'none';

    const infoContainer = document.getElementById('restoreVersionInfo');
    if (infoContainer) {
        const isRestore = record.type === 'restore';
        const seqNumber = record.seqNumber || '-';
        const titleClass = isRestore ? 'commit-title restore-title' : 'commit-title';
        const seqClass = isRestore ? 'commit-seq-badge restore-seq' : 'commit-seq-badge';
        const titleToUse = displayTitle || record.note || formatTime(record.time);

        const itemHtml = `
            <div class="restore-target-label">${currentLang === 'zh_CN' ? '即将恢复到以下版本:' : 'Restore to the following version:'}</div>
            <div class="commit-item">
                <div class="commit-header" style="margin-bottom: 0; width: 100%;">
                    <div class="commit-title-group" style="max-width: 100%;">
                        <span class="${seqClass}">#${seqNumber}</span>
                        <div class="${titleClass}" style="font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px;">${escapeHtml(titleToUse)}</div>
                    </div>
                    <div class="commit-time" style="margin-left: auto; font-size: 12px; white-space: nowrap;">
                         ${formatTime(record.time)}
                    </div>
                </div>
            </div>
        `;

        infoContainer.innerHTML = itemHtml;
        infoContainer.style.background = 'transparent';
        infoContainer.style.border = 'none';
        infoContainer.style.padding = '0';
        infoContainer.style.textAlign = 'left';
    }

    // 填充统计（覆盖模式：当前 vs 备份；导入合并：当前 vs 加入后效果）
    const backupCounts = extractCountsFromHistoryRecord(record) || { bookmarks: 0, folders: 0 };
    const currentCounts = await getCurrentCountsForRestore();
    restoreComparisonState = {
        recordTime: String(record.time || ''),
        currentCounts: normalizeRestoreCountsForDisplay(currentCounts),
        backupCounts: normalizeRestoreCountsForDisplay(backupCounts),
        mergeProjectedCounts: null,
        mergeProjectedPromise: null
    };

    // 默认策略
    const overwriteRadio = document.getElementById('restoreStrategyOverwrite');
    if (overwriteRadio) overwriteRadio.checked = true;
    await updateRestoreComparisonByStrategy('overwrite');
    updateRestoreWarning('overwrite');
    updateRestoreImportTargetHint('overwrite');
    lockRestoreStrategy(false);
    setRestoreDiffBarVisible(false);

    // 重置进度
    const progressSection = document.getElementById('restoreProgressSection');
    if (progressSection) progressSection.style.display = 'none';
    const progressBar = document.getElementById('restoreProgressBar');
    const progressPercent = document.getElementById('restoreProgressPercent');
    const progressText = document.getElementById('restoreProgressText');
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressText) progressText.textContent = currentLang === 'zh_CN' ? '准备中...' : 'Preparing...';

    const fingerprintEl = document.getElementById('restoreBackupFingerprint');
    if (fingerprintEl) {
        const fp = record && record.fingerprint ? String(record.fingerprint) : '';
        if (fp) {
            fingerprintEl.textContent = fp.slice(0, 12);
            fingerprintEl.title = fp;
            fingerprintEl.dataset.fullFingerprint = fp;
        } else {
            fingerprintEl.textContent = '';
            fingerprintEl.removeAttribute('title');
            delete fingerprintEl.dataset.fullFingerprint;
        }
        fingerprintEl.style.display = 'none';
    }

    await updateRestoreComparisonByStrategy(getSelectedRestoreStrategy());

    modal.classList.add('show');
}

function initRestoreModalEvents() {
    const modal = document.getElementById('restoreModal');
    if (!modal || modal.getAttribute('data-inited') === 'true') return;
    modal.setAttribute('data-inited', 'true');

    const closeBtn = document.getElementById('restoreModalClose');
    const cancelBtn = document.getElementById('restoreCancelBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeRestoreModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeRestoreModal);

    const radios = modal.querySelectorAll('input[name="restoreStrategy"]');
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const strategy = getSelectedRestoreStrategy();
            updateRestoreWarning(strategy);
            updateRestoreImportTargetHint(strategy);
            updateRestoreComparisonByStrategy(strategy).catch(() => { });
            const confirmBtn = document.getElementById('restoreConfirmBtn');
            if (confirmBtn) {
                confirmBtn.textContent = currentLang === 'zh_CN' ? '恢复' : 'Restore';
            }
            const previewBtn = document.getElementById('restorePreviewBtn');
            if (previewBtn) {
                previewBtn.classList.remove('preview-warning');
                previewBtn.classList.remove('preview-danger');
            }
        });
    });

    const importTargetBtn = document.getElementById('restoreImportTargetBtn');
    if (importTargetBtn) {
        importTargetBtn.addEventListener('click', () => {
            openRestoreImportTargetModal().catch(() => { });
        });
    }

    const confirmBtn = document.getElementById('restoreConfirmBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            if (!currentRestoreRecord) return;
            const strategy = getSelectedRestoreStrategy();
            executeRestore(strategy, confirmBtn, cancelBtn);
        });
    }

    const previewBtn = document.getElementById('restorePreviewBtn');
    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            if (!currentRestoreRecord) return;
            const strategy = getSelectedRestoreStrategy();
            const preflight = restoreGeneralPreflight;
            let currentTree = preflight?.currentTree;
            let targetTree = preflight?.targetTree;
            let changeMap = preflight?.changeMap;
            if (!currentTree || !targetTree) {
                await ensureRecordBookmarkTree(currentRestoreRecord);
                currentTree = await browserAPI.bookmarks.getTree();
                targetTree = currentRestoreRecord.bookmarkTree;
            }
            await switchToRestorePreview(currentTree, targetTree, changeMap, { strategy });
        });
    }

}

async function executeRestore(strategy, confirmBtn, cancelBtn) {
    if (!currentRestoreRecord) return;

    if (strategy !== 'overwrite' && strategy !== 'merge') {
        strategy = 'overwrite';
    }

    const recordTime = String(currentRestoreRecord.time || '');
    const isPreflightReady = restoreGeneralPreflight &&
        restoreGeneralPreflight.recordTime === recordTime &&
        restoreGeneralPreflight.strategy === strategy;

    if (!isPreflightReady) {
        await updateRestoreDiffSummaryByStrategy(strategy);
        setRestoreDiffBarVisible(true);
        lockRestoreStrategy(true);
        if (confirmBtn) {
            confirmBtn.textContent = strategy === 'merge'
                ? (currentLang === 'zh_CN' ? '确认导入合并' : 'Confirm Import Merge')
                : (currentLang === 'zh_CN' ? '确认覆盖恢复' : 'Confirm Overwrite');
        }
        try {
            const previewBtn = document.getElementById('restorePreviewBtn');
            if (previewBtn) {
                previewBtn.classList.remove('preview-warning');
                previewBtn.classList.remove('preview-danger');
            }
        } catch (_) { }
        showToast(currentLang === 'zh_CN'
            ? '已生成预演，请查看差异；再次点击确认按钮才会执行'
            : 'Preflight ready. Review diff; click confirm again to apply', 2600);
        return;
    }

    restoreGeneralPreflight = null;

    await ensureRecordBookmarkTree(currentRestoreRecord);
    const bookmarkTree = currentRestoreRecord.bookmarkTree;
    if (!bookmarkTree) {
        showToast(currentLang === 'zh_CN' ? '此记录不包含书签树数据' : 'This record does not contain bookmark tree data');
        return;
    }

    if (confirmBtn) confirmBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    lockRestoreStrategy(true);

    const isZh = currentLang === 'zh_CN';
    const startText = strategy === 'merge'
        ? (isZh ? '正在准备导入合并...' : 'Preparing import merge...')
        : (isZh ? '正在准备覆盖恢复...' : 'Preparing overwrite restore...');

    setRestoreProgress(0, startText);

    let result = null;
    let restoreBackupResp = null;
    let restoreBaselineCaptured = false;

    try {
        try {
            await browserAPI.runtime.sendMessage({ action: 'setBookmarkRestoringFlag', value: true });
        } catch (_) { }
        setRestoreProgress(5, isZh ? '已暂停书签监听...' : 'Bookmark listening paused...');

        try {
            const preRestoreTree = await browserAPI.bookmarks.getTree();
            if (Array.isArray(preRestoreTree) && preRestoreTree.length > 0) {
                await browserAPI.storage.local.set({
                    restoreBaselineSnapshot: {
                        bookmarkTree: preRestoreTree,
                        capturedAt: Date.now(),
                        capturedAtIso: new Date().toISOString(),
                        source: 'history_executeRestore'
                    }
                });
                restoreBaselineCaptured = true;
            }
        } catch (baselineError) {
            console.warn('[executeRestore] 捕获恢复前基线失败:', baselineError);
        }

        if (strategy === 'overwrite') {
            result = await executeOverwriteRestore(bookmarkTree);
        } else if (strategy === 'merge') {
            result = await executeMergeRestore(bookmarkTree, { importParentId: restoreImportTarget?.id || null });
        } else {
            throw new Error(`Unknown restore strategy: ${strategy}`);
        }

        setRestoreProgress(90, isZh ? '正在创建恢复记录...' : 'Creating restore record...');

        const restoreNote = (() => {
            const timeText = formatTime(currentRestoreRecord.time);
            const seqText = currentRestoreRecord.seqNumber;
            if (strategy === 'overwrite') {
                return isZh
                    ? `覆盖恢复至 #${seqText} (${timeText})`
                    : `Overwrite restored to #${seqText} (${timeText})`;
            }
            if (strategy === 'merge') {
                return isZh
                    ? `导入合并自 #${seqText} (${timeText})`
                    : `Import merged from #${seqText} (${timeText})`;
            }
            return isZh
                ? `恢复至 #${seqText} (${timeText})`
                : `Restored to #${seqText} (${timeText})`;
        })();

        try {
            restoreBackupResp = await browserAPI.runtime.sendMessage({
                action: 'triggerRestoreBackup',
                note: restoreNote,
                sourceSeqNumber: currentRestoreRecord.seqNumber,
                sourceTime: currentRestoreRecord.time,
                sourceNote: currentRestoreRecord.note || '',
                sourceFingerprint: currentRestoreRecord.fingerprint || '',
                strategy
            });
        } catch (e) {
            restoreBackupResp = null;
        }

        if (restoreBackupResp && restoreBackupResp.success === true) {
            setRestoreProgress(100, isZh ? '恢复完成！' : 'Restore completed!');
        } else {
            const errText = restoreBackupResp && restoreBackupResp.error ? String(restoreBackupResp.error) : '';
            setRestoreProgress(100, isZh
                ? `恢复完成，但创建恢复记录失败${errText ? `：${errText}` : ''}`
                : `Restore completed, but failed to create restore record${errText ? `: ${errText}` : ''}`);
        }

        let successMsg = isZh ? '恢复成功！' : 'Restore successful!';

        if (strategy === 'overwrite') {
            const created = Number.isFinite(Number(result?.created)) ? Number(result.created) : 0;
            const deleted = Number.isFinite(Number(result?.deleted)) ? Number(result.deleted) : 0;
            successMsg = isZh
                ? `覆盖恢复成功！创建 ${created} 个节点，删除 ${deleted} 个节点`
                : `Overwrite restore successful! Created ${created} nodes, removed ${deleted} nodes`;
        } else if (strategy === 'merge') {
            const created = Number.isFinite(Number(result?.created)) ? Number(result.created) : 0;
            const folderTitle = result?.folderTitle ? String(result.folderTitle) : '';
            successMsg = isZh
                ? `导入合并完成！已导入 ${created} 个节点${folderTitle ? `（${folderTitle}）` : ''}`
                : `Import merge completed! Imported ${created} nodes${folderTitle ? ` (${folderTitle})` : ''}`;
        }

        showToast(successMsg);

        if (!restoreBackupResp || restoreBackupResp.success !== true) {
            const errText = restoreBackupResp && restoreBackupResp.error ? String(restoreBackupResp.error) : '';
            showToast(currentLang === 'zh_CN'
                ? `恢复记录创建失败${errText ? `：${errText}` : ''}`
                : `Failed to create restore record${errText ? `: ${errText}` : ''}`);
        }

        setTimeout(async () => {
            closeRestoreModal();
            try {
                await loadAllData({ skipRender: true });
                renderHistoryView();
            } catch (_) { }
        }, 1200);
    } catch (error) {
        console.error('[executeRestore] restore failed:', error);
        const msg = currentLang === 'zh_CN' ? `恢复失败: ${error.message}` : `Restore failed: ${error.message}`;
        setRestoreProgress(0, msg);
        showToast(msg);
    } finally {
        if (restoreBaselineCaptured && (!restoreBackupResp || restoreBackupResp.success !== true)) {
            try {
                await browserAPI.storage.local.remove(['restoreBaselineSnapshot']);
            } catch (_) { }
        }

        try {
            await browserAPI.runtime.sendMessage({ action: 'setBookmarkRestoringFlag', value: false });
        } catch (_) { }
        if (confirmBtn) confirmBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        lockRestoreStrategy(false);
    }
}

async function executeOverwriteRestore(bookmarkTree) {
    const isZh = currentLang === 'zh_CN';

    if (!hasBookmarkTreeContent(bookmarkTree)) {
        const currentTreeForGuard = await browserAPI.bookmarks.getTree();
        if (hasBookmarkTreeContent(currentTreeForGuard)) {
            throw new Error(isZh
                ? '预演显示目标书签树为空，覆盖恢复会清空现有内容，已阻止执行。'
                : 'Preflight shows the target bookmark tree is empty. Overwrite restore would clear current content, so execution is blocked.');
        }

        setRestoreProgress(100, isZh ? '预演结果：当前已与目标空书签树一致，无需覆盖恢复。' : 'Preflight result: current data already matches the empty target bookmark tree.');
        return { success: true, created: 0, deleted: 0, skipped: true };
    }

    setRestoreProgress(10, isZh ? '正在清空当前书签...' : 'Clearing current bookmarks...');

    const [root] = await browserAPI.bookmarks.getTree();

    let bookmarkBar = root.children?.find(c => c.id === '1');
    let otherBookmarks = root.children?.find(c => c.id === '2');

    if (!bookmarkBar) {
        bookmarkBar = root.children?.find(c =>
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
        otherBookmarks = root.children?.find(c =>
            c.title === '其他书签' ||
            c.title === 'Other Bookmarks' ||
            c.title === 'Other bookmarks' ||
            c.title === 'Other Favorites' ||
            c.title === 'Other favorites' ||
            c.title === 'Other favourites' ||
            c.title === '其他收藏夹' ||
            c.title === 'menu________' ||
            c.title === 'unfiled_____'
        );
    }

    if (!bookmarkBar && root.children?.length > 0) {
        bookmarkBar = root.children[0];
    }
    if (!otherBookmarks && root.children?.length > 1) {
        otherBookmarks = root.children[1];
    }

    let deletedCount = 0;
    for (const container of [bookmarkBar, otherBookmarks]) {
        if (container && container.children) {
            for (const child of [...container.children]) {
                try {
                    await browserAPI.bookmarks.removeTree(child.id);
                    deletedCount++;
                } catch (e) {
                    console.warn('[executeOverwriteRestore] 删除节点失败:', child.id, e);
                }
            }
        }
    }

    setRestoreProgress(40, isZh ? `已清空 ${deletedCount} 个节点，正在重建...` : `Cleared ${deletedCount} nodes, rebuilding...`);

    let createdCount = 0;
    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];

    const createNodeRecursive = async (node, parentId) => {
        if (!node) return 0;
        if (node.url) {
            await browserAPI.bookmarks.create({
                parentId,
                title: node.title || '',
                url: node.url,
                index: node.index
            });
            return 1;
        }
        const folder = await browserAPI.bookmarks.create({
            parentId,
            title: node.title || '',
            index: node.index
        });
        let count = 1;
        if (node.children && node.children.length) {
            for (const child of node.children) {
                count += await createNodeRecursive(child, folder.id);
            }
        }
        return count;
    };

    for (const node of nodes) {
        if (node.children) {
            for (const topFolder of node.children) {
                const isBookmarkBarFolder = topFolder.id === '1' ||
                    topFolder.title === '书签栏' ||
                    topFolder.title === 'Bookmarks Bar' ||
                    topFolder.title === 'Bookmarks bar' ||
                    topFolder.title === 'toolbar_____';

                const targetContainer = isBookmarkBarFolder ? bookmarkBar : otherBookmarks;
                if (!targetContainer) {
                    console.warn('[executeOverwriteRestore] 目标容器不存在，跳过:', topFolder.title);
                    continue;
                }
                const targetId = targetContainer.id;

                for (const child of topFolder.children || []) {
                    try {
                        createdCount += await createNodeRecursive(child, targetId);
                        setRestoreProgress(40 + Math.min(45, (createdCount / 100) * 45),
                            isZh ? `已创建 ${createdCount} 个节点...` : `Created ${createdCount} nodes...`);
                    } catch (e) {
                        console.warn('[executeOverwriteRestore] 创建节点失败:', child, e);
                    }
                }
            }
        }
    }

    await updateLastBookmarkDataSnapshot(null, currentRestoreRecord ? currentRestoreRecord.time : null);

    return { success: true, created: createdCount, deleted: deletedCount };
}

// 导入式合并（不删除）：把目标版本导入到书签树下的新文件夹中
// 默认导入“差异视图”（与全局导出的简略/详细一致），使导入后的树带有 [+]/[-]/[~]/[↔] 前缀
async function executeMergeRestore(bookmarkTree, options = {}) {
    const isZh = currentLang === 'zh_CN';

    assertBookmarkTreeContent(bookmarkTree, {
        message: isZh
            ? '目标书签树为空，已阻止导入合并。'
            : 'Target bookmark tree is empty. Import merge blocked.'
    });

    setRestoreProgress(10, isZh ? '正在创建导入文件夹...' : 'Creating import folder...');

    const [root] = await browserAPI.bookmarks.getTree();

    let bookmarkBar = root.children?.find(c => c.id === '1');
    let otherBookmarks = root.children?.find(c => c.id === '2');
    if (!bookmarkBar) {
        bookmarkBar = root.children?.find(c =>
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
        otherBookmarks = root.children?.find(c =>
            c.title === '其他书签' ||
            c.title === 'Other Bookmarks' ||
            c.title === 'Other bookmarks' ||
            c.title === 'Other Favorites' ||
            c.title === 'Other favorites' ||
            c.title === 'Other favourites' ||
            c.title === '其他收藏夹' ||
            c.title === 'menu________' ||
            c.title === 'unfiled_____'
        );
    }
    if (!bookmarkBar && root.children?.length > 0) {
        bookmarkBar = root.children[0];
    }
    if (!otherBookmarks && root.children?.length > 1) {
        otherBookmarks = root.children[1];
    }
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
        targetContainer = otherBookmarks || bookmarkBar || root.children?.[0];
    }

    if (!targetContainer) {
        throw new Error(isZh ? '找不到可用的书签根目录' : 'Cannot find bookmark root container');
    }

    const resolveViewMode = () => {
        try {
            const mode = currentRestoreRecord ? getRecordDetailMode(currentRestoreRecord.time) : 'simple';
            return (mode === 'simple' || mode === 'detailed') ? mode : 'simple';
        } catch (_) {
            return 'simple';
        }
    };

    const viewMode = resolveViewMode();
    const viewModeLabel = viewMode === 'detailed'
        ? (isZh ? '详细' : 'Detailed')
        : (isZh ? '简略' : 'Simple');

    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const seqText = currentRestoreRecord && currentRestoreRecord.seqNumber != null ? String(currentRestoreRecord.seqNumber) : '-';
    const folderTitle = isZh
        ? `导入合并(${viewModeLabel}) - #${seqText} - ${ts}`
        : `Import Merge (${viewModeLabel}) - #${seqText} - ${ts}`;

    const importRootFolder = await browserAPI.bookmarks.create({
        parentId: targetContainer.id,
        title: folderTitle
    });

    setRestoreProgress(25, isZh ? '正在导入差异视图...' : 'Importing changes view...');

    let treeToImport = bookmarkTree;
    try {
        if (currentRestoreRecord) {
            const processed = await getProcessedTreeForRecord(currentRestoreRecord, viewMode);
            if (processed && Array.isArray(processed.children)) {
                treeToImport = { title: 'root', children: processed.children };
            }
        }
    } catch (e) {
        console.warn('[executeMergeRestore] Build diff view failed, fallback to snapshot import:', e);
        treeToImport = bookmarkTree;
    }

    const createNodeRecursive = async (node, parentId) => {
        if (!node) return 0;
        if (node.url) {
            await browserAPI.bookmarks.create({
                parentId,
                title: node.title || '',
                url: node.url,
                index: node.index
            });
            return 1;
        }
        const folder = await browserAPI.bookmarks.create({
            parentId,
            title: node.title || '',
            index: node.index
        });
        let count = 1;
        if (node.children && node.children.length) {
            for (const child of node.children) {
                count += await createNodeRecursive(child, folder.id);
            }
        }
        return count;
    };

    let createdCount = 1;
    const nodes = Array.isArray(treeToImport) ? treeToImport : [treeToImport];

    let processedTop = 0;
    let totalTop = 0;
    for (const node of nodes) {
        if (node && Array.isArray(node.children)) totalTop += node.children.length;
    }
    totalTop = Math.max(1, totalTop);

    for (const node of nodes) {
        if (!node || !Array.isArray(node.children)) continue;

        for (const topFolder of node.children || []) {
            const topTitle = String(topFolder?.title || '').trim() || (isZh ? '书签' : 'Bookmarks');
            const topContainer = await browserAPI.bookmarks.create({
                parentId: importRootFolder.id,
                title: topTitle
            });
            createdCount += 1;

            for (const child of topFolder.children || []) {
                createdCount += await createNodeRecursive(child, topContainer.id);
            }

            processedTop += 1;
            const pct = 25 + Math.min(55, Math.round((processedTop / totalTop) * 55));
            setRestoreProgress(pct, isZh ? '正在导入差异视图...' : 'Importing changes view...');
        }
    }

    return { success: true, created: createdCount, folderId: importRootFolder.id, folderTitle };
}

function calculateChanges(record, index, historyContext) {
    const totalRecords = Number.isFinite(Number(historyContext?.totalRecords))
        ? Number(historyContext.totalRecords)
        : (Array.isArray(historyContext) ? historyContext.length : 0);
    const bookmarkStats = record.bookmarkStats || {};

    // 如果是第一次备份
    // 兼容旧数据：如果没有 isFirstBackup 字段，则把最旧的一条视为首次备份
    const isFirstBackup = record.isFirstBackup === true ||
        (typeof record.isFirstBackup !== 'boolean' && totalRecords > 0 && index === totalRecords - 1);
    if (isFirstBackup) {
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

    // 新口径：新增/删除分开计数（支持“加减相同数量但内容不同”）
    const bookmarkAdded = typeof bookmarkStats.bookmarkAdded === 'number' ? bookmarkStats.bookmarkAdded : (bookmarkDiff > 0 ? bookmarkDiff : 0);
    const bookmarkDeleted = typeof bookmarkStats.bookmarkDeleted === 'number' ? bookmarkStats.bookmarkDeleted : (bookmarkDiff < 0 ? Math.abs(bookmarkDiff) : 0);
    const folderAdded = typeof bookmarkStats.folderAdded === 'number' ? bookmarkStats.folderAdded : (folderDiff > 0 ? folderDiff : 0);
    const folderDeleted = typeof bookmarkStats.folderDeleted === 'number' ? bookmarkStats.folderDeleted : (folderDiff < 0 ? Math.abs(folderDiff) : 0);

    // 获取结构变化标记（来自 bookmarkStats）
    const bookmarkMoved = bookmarkStats.bookmarkMoved || false;
    const folderMoved = bookmarkStats.folderMoved || false;
    const bookmarkModified = bookmarkStats.bookmarkModified || false;
    const folderModified = bookmarkStats.folderModified || false;

    // 获取结构变化的具体数量（如果是数字则使用，否则为0或1）
    const bookmarkMovedCount = typeof bookmarkStats.movedBookmarkCount === 'number'
        ? bookmarkStats.movedBookmarkCount
        : (typeof bookmarkStats.bookmarkMoved === 'number' ? bookmarkStats.bookmarkMoved : (bookmarkMoved ? 1 : 0));
    const folderMovedCount = typeof bookmarkStats.movedFolderCount === 'number'
        ? bookmarkStats.movedFolderCount
        : (typeof bookmarkStats.folderMoved === 'number' ? bookmarkStats.folderMoved : (folderMoved ? 1 : 0));
    const bookmarkModifiedCount = typeof bookmarkStats.modifiedBookmarkCount === 'number'
        ? bookmarkStats.modifiedBookmarkCount
        : (typeof bookmarkStats.bookmarkModified === 'number' ? bookmarkStats.bookmarkModified : (bookmarkModified ? 1 : 0));
    const folderModifiedCount = typeof bookmarkStats.modifiedFolderCount === 'number'
        ? bookmarkStats.modifiedFolderCount
        : (typeof bookmarkStats.folderModified === 'number' ? bookmarkStats.folderModified : (folderModified ? 1 : 0));

    // 判断变化类型
    const hasNumericalChange = bookmarkAdded > 0 || bookmarkDeleted > 0 || folderAdded > 0 || folderDeleted > 0;
    const hasStructuralChange = bookmarkMoved || folderMoved || bookmarkModified || folderModified;
    const hasNoChange = !hasNumericalChange && !hasStructuralChange;

    return {
        bookmarkDiff,
        folderDiff,
        bookmarkAdded,
        bookmarkDeleted,
        folderAdded,
        folderDeleted,
        isFirst: false,
        hasNoChange,
        hasNumericalChange,
        hasStructuralChange,
        bookmarkMoved,
        folderMoved,
        bookmarkModified,
        folderModified,
        // 新增：具体数量
        bookmarkMovedCount,
        folderMovedCount,
        bookmarkModifiedCount,
        folderModifiedCount
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
        const quantityParts = [];
        if (changes.bookmarkAdded > 0) quantityParts.push(`+${changes.bookmarkAdded} ${i18n.bookmarks[currentLang]}`);
        if (changes.bookmarkDeleted > 0) quantityParts.push(`-${changes.bookmarkDeleted} ${i18n.bookmarks[currentLang]}`);
        if (changes.folderAdded > 0) quantityParts.push(`+${changes.folderAdded} ${i18n.folders[currentLang]}`);
        if (changes.folderDeleted > 0) quantityParts.push(`-${changes.folderDeleted} ${i18n.folders[currentLang]}`);
        const quantityText = quantityParts.join(', ');

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
            <span class="stat-change moved">
                >>
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
        return `<span class="stat-badge first">${currentLang === 'zh_CN' ? '首次备份' : 'First Backup'}</span>`;
    }

    if (changes.hasNoChange) {
        return `
            <span class="stat-badge no-change">
                <i class="fas fa-check-circle" style="color: var(--success);"></i>
                ${currentLang === 'zh_CN' ? '无变化' : 'No Changes'}
            </span>
        `;
    }

    const statItems = [];

    if (Number(changes.bookmarkAdded || 0) > 0 || Number(changes.folderAdded || 0) > 0) {
        const addedParts = [];
        if (Number(changes.bookmarkAdded || 0) > 0) {
            const bookmarkLabel = currentLang === 'zh_CN' ? '书签' : 'BKM';
            addedParts.push(`<span class="stat-label">${bookmarkLabel}</span> <span class="stat-color added">+${Number(changes.bookmarkAdded || 0)}</span>`);
        }
        if (Number(changes.folderAdded || 0) > 0) {
            const folderLabel = currentLang === 'zh_CN' ? '文件夹' : 'FLD';
            addedParts.push(`<span class="stat-label">${folderLabel}</span> <span class="stat-color added">+${Number(changes.folderAdded || 0)}</span>`);
        }
        if (addedParts.length > 0) statItems.push(addedParts.join(' '));
    }

    if (Number(changes.bookmarkDeleted || 0) > 0 || Number(changes.folderDeleted || 0) > 0) {
        const deletedParts = [];
        if (Number(changes.bookmarkDeleted || 0) > 0) {
            const bookmarkLabel = currentLang === 'zh_CN' ? '书签' : 'BKM';
            deletedParts.push(`<span class="stat-label">${bookmarkLabel}</span> <span class="stat-color deleted">-${Number(changes.bookmarkDeleted || 0)}</span>`);
        }
        if (Number(changes.folderDeleted || 0) > 0) {
            const folderLabel = currentLang === 'zh_CN' ? '文件夹' : 'FLD';
            deletedParts.push(`<span class="stat-label">${folderLabel}</span> <span class="stat-color deleted">-${Number(changes.folderDeleted || 0)}</span>`);
        }
        if (deletedParts.length > 0) statItems.push(deletedParts.join(' '));
    }

    if (changes.bookmarkMoved || changes.folderMoved) {
        const movedTotal = Number(changes.bookmarkMovedCount || 0) + Number(changes.folderMovedCount || 0);
        const movedLabel = currentLang === 'zh_CN' ? '移动' : 'Moved';
        if (movedTotal > 0) {
            statItems.push(`<span class="stat-label">${movedLabel}</span> <span class="stat-color moved">${movedTotal}</span>`);
        } else {
            statItems.push(`<span class="stat-color moved">${movedLabel}</span>`);
        }
    }

    if (changes.bookmarkModified || changes.folderModified) {
        const modifiedTotal = Number(changes.bookmarkModifiedCount || 0) + Number(changes.folderModifiedCount || 0);
        const modifiedLabel = currentLang === 'zh_CN' ? '修改' : 'Modified';
        if (modifiedTotal > 0) {
            statItems.push(`<span class="stat-label">${modifiedLabel}</span> <span class="stat-color modified">${modifiedTotal}</span>`);
        } else {
            statItems.push(`<span class="stat-color modified">${modifiedLabel}</span>`);
        }
    }

    if (statItems.length === 0) {
        return `<span class="stat-badge no-change">${currentLang === 'zh_CN' ? '无变化' : 'No Changes'}</span>`;
    }

    const separator = ' <span style="color:var(--text-tertiary);margin:0 4px;">|</span> ';
    return `<span class="stat-badge quantity">${statItems.join(separator)}</span>`;
}

// =============================================================================
// 书签树视图
// =============================================================================

let treeChangeMap = null; // 缓存变动映射
let cachedTreeData = null; // 缓存树数据
let cachedOldTree = null; // 缓存旧树数据
let cachedCurrentTree = null; // 缓存当前树数据（用于智能路径检测）
let lastTreeFingerprint = null; // 上次树的指纹
let lastTreeSnapshotVersion = null; // 上次快照版本（来自 background 缓存）
let cachedCurrentTreeIndex = null; // id -> node（懒加载用，按需构建）
let cachedRenderTreeIndex = null; // id -> node（懒加载用，包含 deleted 合并树）
const detailChangeCache = new Map(); // key(recordTime:mode) -> { treeToRender, changeMap, ts }
const DETAIL_CHANGE_CACHE_MAX = 20;

function getDetailChangeCacheKey(recordTime, mode) {
    return `${String(recordTime)}:${mode === 'detailed' ? 'detailed' : 'simple'}`;
}

function getDetailChangeCache(recordTime, mode) {
    const key = getDetailChangeCacheKey(recordTime, mode);
    const entry = detailChangeCache.get(key);
    if (!entry) return null;
    entry.ts = Date.now();
    return entry;
}

function setDetailChangeCache(recordTime, mode, payload) {
    const key = getDetailChangeCacheKey(recordTime, mode);
    detailChangeCache.set(key, { ...payload, ts: Date.now() });

    if (detailChangeCache.size <= DETAIL_CHANGE_CACHE_MAX) return;

    const sorted = Array.from(detailChangeCache.entries()).sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0));
    while (sorted.length > DETAIL_CHANGE_CACHE_MAX) {
        const victim = sorted.shift();
        if (!victim) break;
        detailChangeCache.delete(victim[0]);
    }
}

function clearDetailChangeCache() {
    detailChangeCache.clear();
}

let __canvasPermanentHintSet = null;
let __canvasPermanentAncestorBadges = null;

const CANVAS_PERMANENT_TREE_LAZY_ENABLED = true;
const CANVAS_PERMANENT_TREE_CHILD_BATCH = 200;

const CANVAS_LAZY_CHANGE_HINT_TTL_MS = 5 * 60 * 1000;
let canvasLazyChangeHints = {
    updatedAt: 0,
    added: new Set(),
    modified: new Set(),
    moved: new Set(),
    movedInfo: new Map(), // key -> { oldPath }
    deletedCount: 0,
    hasAny: false
};
let canvasLazyChangeHintsPromise = null;

// 清除树缓存（供拖拽模块调用，防止缓存覆盖DOM更新）
function clearTreeCache() {
    cachedTreeData = null;
    lastTreeFingerprint = null;
    lastTreeSnapshotVersion = null;
    cachedCurrentTreeIndex = null;
    cachedRenderTreeIndex = null;
    console.log('[树缓存] 已清除');
}
window.clearTreeCache = clearTreeCache;

function buildTreeIndexFromRoot(root) {
    if (!root) return null;
    const map = new Map();
    const stack = [{ node: root, parentId: null, index: null }];
    while (stack.length) {
        const current = stack.pop();
        const node = current ? current.node : null;
        if (!node || node.id == null) continue;

        try {
            if (current && current.parentId != null && typeof node.parentId === 'undefined') {
                node.parentId = String(current.parentId);
            }
            if (
                current
                && typeof current.index === 'number'
                && !Number.isNaN(current.index)
                && typeof node.index !== 'number'
            ) {
                node.index = current.index;
            }
        } catch (_) { }

        map.set(String(node.id), node);
        if (Array.isArray(node.children) && node.children.length) {
            for (let i = node.children.length - 1; i >= 0; i--) {
                stack.push({ node: node.children[i], parentId: node.id, index: i });
            }
        }
    }
    return map;
}

function clearCanvasLazyChangeHints(reason = '') {
    canvasLazyChangeHints = {
        updatedAt: 0,
        added: new Set(),
        modified: new Set(),
        moved: new Set(),
        movedInfo: new Map(),
        deletedCount: 0,
        hasAny: false
    };
    if (reason) console.log('[Canvas变化提示] 已清空:', reason);
}

function buildFingerprintKeyFromChangeItem(item) {
    if (!item) return '';
    const path = typeof item.path === 'string' ? item.path : '';
    const title = typeof item.title === 'string' ? item.title : '';
    const url = typeof item.url === 'string' ? item.url : '';
    return `B:${path}|${title}|${url}`;
}

function getFolderPathFromBreadcrumb(bc) {
    if (!bc) return '';
    const parts = bc.split(' > ').map(s => s.trim()).filter(Boolean);
    const rootTitle = cachedCurrentTree && cachedCurrentTree[0] ? cachedCurrentTree[0].title : '';
    if (rootTitle && parts[0] === rootTitle) parts.shift();
    if (parts.length <= 1) return '';
    parts.pop(); // 移除当前节点名
    return parts.join('/');
}

function buildFingerprintKeyForBookmarkNode(node) {
    if (!node || !node.url) return '';
    const bc = cachedCurrentTree ? getNamedPathFromTree(cachedCurrentTree, node.id) : '';
    const folderPath = getFolderPathFromBreadcrumb(bc);
    return `B:${folderPath}|${node.title || ''}|${node.url || ''}`;
}

function formatFingerprintPathToSlash(path) {
    if (typeof path !== 'string' || !path.length) return '/';
    return path.startsWith('/') ? path : `/${path}`;
}

async function ensureCanvasLazyChangeHints(forceRefresh = false) {
    if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return null;
    const now = Date.now();
    if (!forceRefresh && canvasLazyChangeHints.updatedAt && (now - canvasLazyChangeHints.updatedAt) < CANVAS_LAZY_CHANGE_HINT_TTL_MS) {
        return canvasLazyChangeHints;
    }
    if (canvasLazyChangeHintsPromise) return canvasLazyChangeHintsPromise;

    canvasLazyChangeHintsPromise = (async () => {
        try {
            const changeData = await getDetailedChanges(forceRefresh);
            const added = new Set();
            const modified = new Set();
            const moved = new Set();
            const movedInfo = new Map();
            let deletedCount = 0;

            const stats = changeData && changeData.stats ? changeData.stats : null;
            const statsHasAny = !!(stats && (
                stats.bookmarkDiff || stats.folderDiff ||
                stats.bookmarkMoved || stats.folderMoved ||
                stats.bookmarkModified || stats.folderModified
            ));

            if (changeData && (changeData.hasChanges || statsHasAny)) {
                if (Array.isArray(changeData.added)) {
                    changeData.added.forEach(item => {
                        const key = buildFingerprintKeyFromChangeItem(item);
                        if (key) added.add(key);
                    });
                }
                if (Array.isArray(changeData.modified)) {
                    changeData.modified.forEach(item => {
                        const key = buildFingerprintKeyFromChangeItem(item);
                        if (key) modified.add(key);
                    });
                }
                if (Array.isArray(changeData.moved)) {
                    changeData.moved.forEach(item => {
                        const key = buildFingerprintKeyFromChangeItem(item);
                        if (key) {
                            moved.add(key);
                            if (item.oldPath) movedInfo.set(key, { oldPath: item.oldPath });
                        }
                    });
                }
                if (Array.isArray(changeData.deleted)) {
                    deletedCount = changeData.deleted.length;
                }
            }

            canvasLazyChangeHints = {
                updatedAt: Date.now(),
                added,
                modified,
                moved,
                movedInfo,
                deletedCount,
                hasAny: added.size > 0 || modified.size > 0 || moved.size > 0 || deletedCount > 0 || statsHasAny
            };
            return canvasLazyChangeHints;
        } catch (e) {
            console.warn('[Canvas变化提示] 生成失败，回退为空:', e);
            canvasLazyChangeHints = {
                updatedAt: Date.now(),
                added: new Set(),
                modified: new Set(),
                moved: new Set(),
                movedInfo: new Map(),
                deletedCount: 0,
                hasAny: false
            };
            return canvasLazyChangeHints;
        } finally {
            canvasLazyChangeHintsPromise = null;
        }
    })();

    return canvasLazyChangeHintsPromise;
}

function getCanvasLazyHintForBookmark(node) {
    if (!node || !node.url) return null;
    if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return null;
    if (!canvasLazyChangeHints || !canvasLazyChangeHints.hasAny) return null;
    const key = buildFingerprintKeyForBookmarkNode(node);
    if (!key) return null;
    if (canvasLazyChangeHints.added.has(key)) return { type: 'added' };
    if (canvasLazyChangeHints.modified.has(key)) return { type: 'modified' };
    if (canvasLazyChangeHints.moved.has(key)) {
        const info = canvasLazyChangeHints.movedInfo.get(key) || {};
        return { type: 'moved', oldPath: info.oldPath || '' };
    }
    return null;
}

function ensureCanvasLazyLegend(treeContainer) {
    if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return;
    const container = treeContainer || document.getElementById('bookmarkTree');
    if (!container) return;
    const existing = container.querySelector('.tree-legend');
    if (!canvasLazyChangeHints || !canvasLazyChangeHints.hasAny) {
        if (existing) existing.remove();
        return;
    }
    if (existing) return;
    const legend = document.createElement('div');
    legend.className = 'tree-legend';
    legend.innerHTML = `
        <span class="legend-item"><span class="legend-dot added"></span> ${currentLang === 'zh_CN' ? '新增' : 'Added'}</span>
        <span class="legend-item"><span class="legend-dot deleted"></span> ${currentLang === 'zh_CN' ? '删除' : 'Deleted'}</span>
        <span class="legend-item"><span class="legend-dot moved"></span> ${currentLang === 'zh_CN' ? '移动' : 'Moved'}</span>
        <span class="legend-item"><span class="legend-dot modified"></span> ${currentLang === 'zh_CN' ? '修改' : 'Modified'}</span>
    `;
    container.insertBefore(legend, container.firstChild);
}

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

// 从 background.js 获取书签树快照（优先走缓存，失败再直连 getTree）
async function getBookmarkTreeSnapshot() {
    try {
        if (browserAPI && browserAPI.runtime && typeof browserAPI.runtime.sendMessage === 'function') {
            const resp = await browserAPI.runtime.sendMessage({ action: 'getBookmarkSnapshot' });
            if (resp && resp.success && Array.isArray(resp.tree)) {
                return { tree: resp.tree, version: resp.version ?? null };
            }
        }
    } catch (e) {
        console.warn('[TreeSnapshot] 获取后台快照失败，回退直连:', e);
    }
    const tree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
    return { tree, version: null };
}

// 若只做 DOM 增量更新但不刷新 cachedCurrentTree，则在“展开/加载更多”时可能被旧快照覆盖，
// 造成“刷新/展开后移动效果消失 / 节点跑回去”的错觉。
let pendingTreeSnapshotRefreshTimer = null;
let treeSnapshotRefreshing = false;
let treeSnapshotRefreshQueued = false;

async function refreshCachedCurrentTreeSnapshot(reason = '') {
    if (!((currentView === 'current-changes' || currentView === 'current-changes') && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return;
    if (treeSnapshotRefreshing) {
        treeSnapshotRefreshQueued = true;
        return;
    }
    treeSnapshotRefreshing = true;
    try {
        const snapshot = await getBookmarkTreeSnapshot();
        if (snapshot && Array.isArray(snapshot.tree)) {
            cachedCurrentTree = snapshot.tree;
            cachedCurrentTreeIndex = null;
            cachedRenderTreeIndex = null;
            try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            if (typeof snapshot.version !== 'undefined') {
                lastTreeSnapshotVersion = snapshot.version;
            }
            console.log('[TreeSnapshot] 已刷新 cachedCurrentTree（Canvas懒加载）', reason || '');
        }
    } catch (e) {
        console.warn('[TreeSnapshot] 刷新 cachedCurrentTree 失败:', e);
    } finally {
        treeSnapshotRefreshing = false;
        if (treeSnapshotRefreshQueued) {
            treeSnapshotRefreshQueued = false;
            refreshCachedCurrentTreeSnapshot('queued').catch(() => { });
        }
    }
}

function scheduleCachedCurrentTreeSnapshotRefresh(reason = '') {
    if (!((currentView === 'current-changes' || currentView === 'current-changes') && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return;
    if (pendingTreeSnapshotRefreshTimer) clearTimeout(pendingTreeSnapshotRefreshTimer);
    pendingTreeSnapshotRefreshTimer = setTimeout(() => {
        pendingTreeSnapshotRefreshTimer = null;
        refreshCachedCurrentTreeSnapshot(reason).catch(() => { });
    }, 300);
}

function applyIncrementalCreateToCachedCurrentTree(id, bookmark) {
    try {
        if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id || !bookmark || typeof bookmark.parentId === 'undefined') return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const parent = index.get(String(bookmark.parentId));
        if (!parent) return false;

        const nodeId = String(id);
        const children = Array.isArray(parent.children)
            ? parent.children.filter(child => String(child?.id) !== nodeId)
            : [];
        const insertIndex = (typeof bookmark.index === 'number')
            ? Math.max(0, Math.min(bookmark.index, children.length))
            : children.length;

        const newNode = {
            id: nodeId,
            title: bookmark.title || '',
            url: bookmark.url || undefined,
            parentId: String(bookmark.parentId),
            index: (typeof bookmark.index === 'number') ? bookmark.index : insertIndex
        };
        if (!bookmark.url) newNode.children = [];

        children.splice(insertIndex, 0, newNode);
        parent.children = children;

        if (cachedCurrentTreeIndex instanceof Map) {
            cachedCurrentTreeIndex.set(nodeId, newNode);
        }
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        return false;
    }
}

function applyIncrementalRemoveFromCachedCurrentTree(id, removeInfo) {
    try {
        if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id) return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const key = String(id);
        const node = index.get(key);
        const parentId = (node && typeof node.parentId !== 'undefined')
            ? node.parentId
            : (removeInfo && typeof removeInfo.parentId !== 'undefined'
                ? removeInfo.parentId
                : (removeInfo && removeInfo.node && typeof removeInfo.node.parentId !== 'undefined'
                    ? removeInfo.node.parentId
                    : null));
        if (!parentId) return false;

        const parent = index.get(String(parentId));
        if (!parent || !Array.isArray(parent.children)) return false;
        parent.children = parent.children.filter(child => String(child?.id) !== key);

        cachedCurrentTreeIndex = null;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        return false;
    }
}

function applyIncrementalChangeToCachedCurrentTree(id, changeInfo) {
    try {
        if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id || !changeInfo) return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const node = index.get(String(id));
        if (!node) return false;
        if (typeof changeInfo.title !== 'undefined') node.title = changeInfo.title;
        if (typeof changeInfo.url !== 'undefined') node.url = changeInfo.url || undefined;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        return false;
    }
}

function applyIncrementalMoveToCachedCurrentTree(id, moveInfo) {
    try {
        if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) return false;
        if (!id || !moveInfo || typeof moveInfo.parentId === 'undefined' || typeof moveInfo.oldParentId === 'undefined') return false;
        if (!cachedCurrentTree || !cachedCurrentTree[0]) return false;

        const index = getCachedCurrentTreeIndex();
        if (!index) return false;

        const keyId = String(id);
        const movedNode = index.get(keyId);
        const oldParent = index.get(String(moveInfo.oldParentId));
        const newParent = index.get(String(moveInfo.parentId));
        if (!movedNode || !oldParent || !newParent) return false;

        const oldChildren = Array.isArray(oldParent.children) ? oldParent.children : [];
        oldParent.children = oldChildren.filter(child => String(child?.id) !== keyId);

        const newChildren = Array.isArray(newParent.children) ? newParent.children : [];
        const filteredNew = newChildren.filter(child => String(child?.id) !== keyId);
        const insertIndex = (typeof moveInfo.index === 'number')
            ? Math.max(0, Math.min(moveInfo.index, filteredNew.length))
            : filteredNew.length;
        filteredNew.splice(insertIndex, 0, movedNode);
        newParent.children = filteredNew;

        // 更新节点自身的父信息（供路径/懒加载逻辑使用）
        movedNode.parentId = String(moveInfo.parentId);
        if (typeof moveInfo.index === 'number') movedNode.index = moveInfo.index;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        return true;
    } catch (_) {
        // 静默失败：最终会由 refreshCachedCurrentTreeSnapshot() 兜底
        return false;
    }
}

function getCachedCurrentTreeIndex() {
    if (cachedCurrentTreeIndex) return cachedCurrentTreeIndex;
    if (!cachedCurrentTree || !cachedCurrentTree[0]) return null;
    cachedCurrentTreeIndex = buildTreeIndexFromRoot(cachedCurrentTree[0]);
    return cachedCurrentTreeIndex;
}

function getCachedRenderTreeIndex() {
    if (cachedRenderTreeIndex) return cachedRenderTreeIndex;
    try {
        if (window.__canvasRenderTreeIndex instanceof Map) {
            cachedRenderTreeIndex = window.__canvasRenderTreeIndex;
            return cachedRenderTreeIndex;
        }
    } catch (_) { }
    return null;
}

function getChangesPreviewTreeIndex() {
    try {
        if (window.__changesPreviewTreeIndex instanceof Map) return window.__changesPreviewTreeIndex;
    } catch (_) { }
    return null;
}

async function loadPermanentFolderChildrenLazy(parentId, childrenContainer, startIndex = 0, triggerBtn = null, isReadOnly = false) {
    try {
        if (!parentId || !childrenContainer) return;
        const treeRoot = childrenContainer.closest('.bookmark-tree') || document.getElementById('bookmarkTree') || document;
        const index = isReadOnly
            ? getChangesPreviewTreeIndex()
            : ((currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)
                ? (getCachedRenderTreeIndex() || getCachedCurrentTreeIndex())
                : getCachedCurrentTreeIndex());
        const parent = index ? index.get(String(parentId)) : null;
        if (!parent || !Array.isArray(parent.children) || parent.children.length === 0) {
            const item = treeRoot.querySelector(`.tree-item[data-node-id="${CSS.escape(String(parentId))}"]`);
            if (item) {
                item.dataset.childrenLoaded = 'true';
                item.dataset.hasChildren = 'false';
            }
            if (triggerBtn) {
                try { triggerBtn.remove(); } catch (_) { }
            }
            return;
        }

        const item = treeRoot.querySelector(`.tree-item[data-node-id="${CSS.escape(String(parentId))}"]`);
        const level = item ? (parseInt(item.dataset.nodeLevel, 10) || 0) : 0;
        const nextLevel = level + 1;
        const underDeletedAncestor = !!(item && item.classList && item.classList.contains('tree-change-deleted'));

        const slice = parent.children.slice(startIndex, startIndex + CANVAS_PERMANENT_TREE_CHILD_BATCH);
        const visited = new Set([String(parentId)]);
        let hintSet = null;
        if (isReadOnly && (window.__changesPreviewHintSet instanceof Set)) {
            hintSet = window.__changesPreviewHintSet;
        } else if (!isReadOnly && currentView === 'current-changes' && (window.__canvasPermanentHintSet instanceof Set)) {
            hintSet = window.__canvasPermanentHintSet;
        }
        const options = isReadOnly
            ? { forceExpandOverrideLazyStop: false, preferPreviewAncestorBadges: true }
            : undefined;
        const html = slice.map(child => renderTreeNodeWithChanges(child, nextLevel, 50, visited, hintSet, options, underDeletedAncestor)).join('');

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const frag = document.createDocumentFragment();
        while (tempDiv.firstChild) {
            frag.appendChild(tempDiv.firstChild);
        }

        if (startIndex === 0 && !triggerBtn) {
            childrenContainer.innerHTML = '';
        }

        // 插入到“加载更多”按钮之前（若存在）
        if (triggerBtn && triggerBtn.parentElement === childrenContainer) {
            childrenContainer.insertBefore(frag, triggerBtn);
        } else {
            childrenContainer.appendChild(frag);
        }

        if (item) {
            item.dataset.childrenLoaded = 'true';
            item.dataset.hasChildren = 'true';
        }

        const nextStart = startIndex + slice.length;
        const remaining = parent.children.length - nextStart;

        let loadMoreBtn = triggerBtn;
        if (remaining > 0) {
            if (!loadMoreBtn) {
                loadMoreBtn = document.createElement('button');
                loadMoreBtn.type = 'button';
                loadMoreBtn.className = 'tree-load-more';
                childrenContainer.appendChild(loadMoreBtn);
            }
            loadMoreBtn.dataset.parentId = String(parentId);
            loadMoreBtn.dataset.startIndex = String(nextStart);
            loadMoreBtn.textContent = currentLang === 'zh_CN'
                ? `加载更多（剩余 ${remaining} 项）`
                : `Load more (${remaining} remaining)`;
        } else if (loadMoreBtn) {
            try { loadMoreBtn.remove(); } catch (_) { }
        }

        // 懒加载插入新节点后：补绑定拖拽事件（内部拖拽排序/移动）
        try {
            // 仅对“刚插入的子树”补绑，避免每次懒加载都扫描整棵书签树
            if (typeof attachDragEvents === 'function' && !isReadOnly) {
                attachDragEvents(childrenContainer);
            }
        } catch (_) { }

        // 如果是只读模式（Current Changes 预览），处理新插入的节点
        if (isReadOnly) {
            try {
                // 1. 禁用拖拽
                childrenContainer.querySelectorAll('[draggable="true"]').forEach(el => {
                    el.setAttribute('draggable', 'false');
                });
                // 2. 添加 dataset-readonly
                childrenContainer.querySelectorAll('.tree-item').forEach(el => {
                    el.dataset.readonly = 'true';
                });
                // 3. 移除右键菜单（如果有）
                childrenContainer.querySelectorAll('#bookmark-context-menu, .bookmark-context-menu').forEach(el => {
                    el.remove();
                });
            } catch (_) { }
        }

        // Current Changes 预览：懒加载插入后，避免滚动位置被浏览器 clamp 回 0
        if (isReadOnly) {
            try {
                const previewBody = childrenContainer.closest('.permanent-section-body');
                __maybeReapplyChangesPreviewScroll(previewBody);
            } catch (_) { }
        }

        // 懒加载完成后：检查新加载的子节点是否有需要恢复展开状态的
        try {
            const treeForState = childrenContainer && childrenContainer.closest ? childrenContainer.closest('.bookmark-tree') : null;
            const savedState = __readTreeExpandStateFromStorage(treeForState);
            if (savedState) {
                const expandedIds = JSON.parse(savedState);
                if (Array.isArray(expandedIds) && expandedIds.length > 0) {
                    const expandedSet = new Set(expandedIds);
                    // 只检查刚加载的子节点
                    childrenContainer.querySelectorAll(':scope > .tree-node > .tree-item[data-node-id]').forEach(item => {
                        if (expandedSet.has(item.dataset.nodeId)) {
                            const node = item.closest('.tree-node');
                            if (!node) return;
                            const children = node.querySelector(':scope > .tree-children');
                            const toggle = item.querySelector('.tree-toggle');
                            const icon = item.querySelector('.tree-icon.fas');
                            if (children && toggle) {
                                children.classList.add('expanded');
                                toggle.classList.add('expanded');
                                if (icon && icon.classList.contains('fa-folder')) {
                                    icon.classList.remove('fa-folder');
                                    icon.classList.add('fa-folder-open');
                                }
                                // 如果这个节点也需要懒加载，递归加载
                                 if (item.dataset.childrenLoaded === 'false' && item.dataset.hasChildren === 'true') {
                                     setTimeout(() => {
                                         loadPermanentFolderChildrenLazy(item.dataset.nodeId, children, 0, null, isReadOnly);
                                     }, 10);
                                 }
                             }
                         }
                    });
                }
            }
        } catch (_) { }
    } catch (e) {
        console.warn('[Canvas Tree Lazy] load children failed:', e);
    }
}
// 导出到全局，供拖拽模块在悬浮展开时调用
window.loadPermanentFolderChildrenLazy = loadPermanentFolderChildrenLazy;


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

// 防止并发渲染和闪烁的标志
let isRenderingTree = false;
let pendingRenderRequest = null;

// 同步版本的树渲染（真正可 await，用于 Current Changes 预览）
async function renderTreeViewSync() {
    console.log('[renderTreeViewSync] 开始同步渲染...');

    const treeContainer = document.getElementById('bookmarkTree');
    if (!treeContainer) {
        console.error('[renderTreeViewSync] 容器元素未找到');
        return;
    }

    // 清除缓存，确保重新渲染
    cachedTreeData = null;
    lastTreeFingerprint = null;
    lastTreeSnapshotVersion = null;
    cachedCurrentTreeIndex = null;

    try {
        // 并行获取数据
        const [snapshot, storageData] = await Promise.all([
            getBookmarkTreeSnapshot(),
            new Promise(resolve => browserAPI.storage.local.get(['lastBookmarkData'], resolve))
        ]);
        const currentTree = snapshot ? snapshot.tree : null;
        lastTreeSnapshotVersion = snapshot ? snapshot.version : null;

        if (!currentTree || currentTree.length === 0) {
            treeContainer.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-sitemap"></i></div><div class="empty-state-title">${i18n.emptyTree[currentLang]}</div></div>`;
            return;
        }

        const oldTree = storageData.lastBookmarkData && storageData.lastBookmarkData.bookmarkTree;
        cachedOldTree = oldTree;
        cachedCurrentTree = currentTree;
        cachedCurrentTreeIndex = null;

        // 检测变动
        if (oldTree && oldTree[0]) {
            treeChangeMap = await detectTreeChangesFast(oldTree, currentTree);
            console.log('[renderTreeViewSync] 检测到变动数量:', treeChangeMap.size);
        } else {
            treeChangeMap = new Map();
        }

        // 合并旧树和新树，显示删除的节点
        let treeToRender = currentTree;
        if (oldTree && oldTree[0] && treeChangeMap && treeChangeMap.size > 0) {
            let hasDeletedNodes = false;
            for (const [, change] of treeChangeMap) {
                if (change.type === 'deleted') {
                    hasDeletedNodes = true;
                    break;
                }
            }
            if (hasDeletedNodes) {
                try {
                    treeToRender = rebuildTreeWithDeleted(oldTree, currentTree, treeChangeMap);
                } catch (error) {
                    console.error('[renderTreeViewSync] 重建树时出错:', error);
                    treeToRender = currentTree;
                }
            }
        }

        // 渲染树
        const fragment = document.createDocumentFragment();

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

        treeContainer.innerHTML = '';
        treeContainer.appendChild(fragment);
        treeContainer.style.display = 'block';

        // 绑定事件
        attachTreeEvents(treeContainer);

        console.log('[renderTreeViewSync] 渲染完成');

    } catch (error) {
        console.error('[renderTreeViewSync] 渲染失败:', error);
        treeContainer.innerHTML = `<div class="error">${currentLang === 'zh_CN' ? '加载失败' : 'Failed to load'}</div>`;
    }
}

// 仅用于「当前变化」预览：加载 currentTree + changeMap（不触碰/渲染 #bookmarkTree DOM）
// 目标：避免 renderTreeViewSync 的整树 DOM 构建导致“黑屏/卡顿感”。
async function ensureChangesPreviewTreeDataLoaded(options = {}) {
    const requireDiffMap = !!(options && options.requireDiffMap);

    try {
        const [snapshot, storageData] = await Promise.all([
            getBookmarkTreeSnapshot(),
            new Promise(resolve => browserAPI.storage.local.get(['lastBookmarkData'], resolve))
        ]);

        const currentTree = snapshot ? snapshot.tree : null;
        if (!currentTree || !Array.isArray(currentTree) || currentTree.length === 0) {
            cachedCurrentTree = null;
            cachedCurrentTreeIndex = null;
            cachedRenderTreeIndex = null;
            try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            treeChangeMap = new Map();
            return;
        }

        const oldTree = storageData?.lastBookmarkData?.bookmarkTree || null;
        cachedOldTree = oldTree;
        cachedCurrentTree = currentTree;
        cachedCurrentTreeIndex = null;
        cachedRenderTreeIndex = null;
        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
        lastTreeSnapshotVersion = snapshot ? snapshot.version : null;

        if (oldTree && oldTree[0]) {
            treeChangeMap = await detectTreeChangesFast(oldTree, currentTree);
        } else {
            treeChangeMap = new Map();
        }

        if (requireDiffMap && oldTree && oldTree[0] && treeChangeMap instanceof Map && treeChangeMap.size === 0) {
            try {
                const liveTree = await new Promise(resolve => browserAPI.bookmarks.getTree(resolve));
                if (Array.isArray(liveTree) && liveTree.length > 0) {
                    const liveMap = await detectTreeChangesFast(oldTree, liveTree);
                    if (liveMap instanceof Map && liveMap.size > 0) {
                        cachedCurrentTree = liveTree;
                        cachedCurrentTreeIndex = null;
                        cachedRenderTreeIndex = null;
                        try { window.__canvasRenderTreeIndex = null; } catch (_) { }
                        lastTreeSnapshotVersion = null;
                        treeChangeMap = liveMap;
                        console.log('[ensureChangesPreviewTreeDataLoaded] fallback to live tree map size:', liveMap.size);
                    }
                }
            } catch (liveError) {
                console.warn('[ensureChangesPreviewTreeDataLoaded] live-tree fallback failed:', liveError);
            }
        }
    } catch (e) {
        console.warn('[ensureChangesPreviewTreeDataLoaded] Failed:', e);
        try { treeChangeMap = new Map(); } catch (_) { }
    }
}

async function renderTreeView(forceRefresh = false) {
    console.log('[renderTreeView] 开始渲染, forceRefresh:', forceRefresh);

    // 如果正在渲染中，合并请求，避免重复渲染导致闪烁
    if (isRenderingTree) {
        console.log('[renderTreeView] 已有渲染进行中，合并请求');
        pendingRenderRequest = forceRefresh;
        return;
    }

    isRenderingTree = true;

    // 记录永久栏目滚动位置，渲染后恢复
    // 优先使用当前滚动位置；如果是0，尝试从 localStorage 读取持久化的值（页面刷新场景）
    const permBody = document.querySelector('.permanent-section-body');
    let permScrollTop = permBody ? permBody.scrollTop : null;
    let permScrollLeft = permBody ? permBody.scrollLeft : 0;

    // 避免“渲染后多次恢复滚动”与用户滚动产生抢夺：一旦检测到用户开始滚动，短时间内停止自动恢复
    const isScrollRestoreBlocked = () => {
        if (!permBody) return false;
        try {
            const until = parseInt(permBody.dataset.scrollRestoreBlockUntil || '0', 10) || 0;
            return until && Date.now() < until;
        } catch (_) {
            return false;
        }
    };
    if (permBody && permBody.dataset.scrollRestoreGuardAttached !== 'true') {
        permBody.dataset.scrollRestoreGuardAttached = 'true';
        const blockMs = 1000;
        const block = () => {
            try {
                permBody.dataset.scrollRestoreBlockUntil = String(Date.now() + blockMs);
            } catch (_) { }
        };
        permBody.addEventListener('wheel', block, { passive: true });
        permBody.addEventListener('touchstart', block, { passive: true });
        permBody.addEventListener('touchmove', block, { passive: true });
        // 仅当直接在滚动容器上按下（如拖动滚动条/空白区域）才算用户滚动意图，避免点击树节点误触发
        permBody.addEventListener('pointerdown', (e) => {
            if (e && e.target === permBody) block();
        }, { passive: true });
    }

    // 页面刷新后，permScrollTop 是 0，需要从 localStorage 恢复
    if (permScrollTop === 0 && currentView === 'current-changes') {
        try {
            const persisted = JSON.parse(localStorage.getItem('permanent-section-scroll'));
            if (persisted && typeof persisted.top === 'number') {
                permScrollTop = persisted.top;
                permScrollLeft = persisted.left || 0;
            }
        } catch (_) { }
    }

    const treeContainer = document.getElementById('bookmarkTree');

    if (!treeContainer) {
        console.error('[renderTreeView] 容器元素未找到');
        isRenderingTree = false;
        return;
    }

    // 强制刷新时清除缓存，确保重新渲染
    if (forceRefresh) {
        cachedTreeData = null;
        lastTreeFingerprint = null;
        lastTreeSnapshotVersion = null;
        cachedCurrentTreeIndex = null;
        console.log('[renderTreeView] 强制刷新，已清除缓存');
    }

    // 如果已有缓存且不强制刷新，直接使用（快速路径）
    if (!forceRefresh && cachedTreeData && cachedTreeData.treeFragment) {
        console.log('[renderTreeView] 使用现有缓存（快速显示）');
        if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
            await ensureCanvasLazyChangeHints(false);
        }
        if (currentView === 'current-changes' && treeContainer.children.length) {
            treeContainer.style.display = 'block';
            ensureCanvasLazyLegend(treeContainer);
        } else {
            treeContainer.innerHTML = '';
            treeContainer.appendChild(cachedTreeData.treeFragment.cloneNode(true));
            treeContainer.style.display = 'block';
            ensureCanvasLazyLegend(treeContainer);
        }

        // 重新绑定事件
        attachTreeEvents(treeContainer);

        console.log('[renderTreeView] 缓存显示完成');
        // 恢复滚动位置（延迟确保展开状态恢复后再恢复滚动位置）
        if (permBody && permScrollTop !== null) {
            const restoreScroll = () => {
                if (isScrollRestoreBlocked()) return;
                permBody.scrollTop = permScrollTop;
                permBody.scrollLeft = permScrollLeft;
            };
            restoreScroll();
            requestAnimationFrame(() => {
                restoreScroll();
                setTimeout(restoreScroll, 50);
                setTimeout(restoreScroll, 150);
                setTimeout(restoreScroll, 300);
                setTimeout(restoreScroll, 500);
            });
        }

        // 【关键修复】即使使用缓存，也要预热内存缓存
        // 因为内存缓存可能在页面刷新后被清空，导致图标显示为五角星
        // 预热完成后会自动更新页面上的图标
        (async () => {
            try {
                if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
                    return;
                }
                // 获取当前书签树（优先后台快照）
                const snapshot = await getBookmarkTreeSnapshot();
                const currentTree = snapshot ? snapshot.tree : null;
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

        // 重置渲染标志并处理合并请求
        isRenderingTree = false;
        if (pendingRenderRequest !== null) {
            const pending = pendingRenderRequest;
            pendingRenderRequest = null;
            console.log('[renderTreeView] 处理待处理的渲染请求（快速路径）');
            renderTreeView(pending);
        }
        return;
    }

    // 没有缓存，开始加载数据
    // 注意：不清空容器，保持原有内容，避免闪烁和滚动位置丢失
    // 只有在容器为空时才显示加载状态
    console.log('[renderTreeView] 无缓存，开始加载数据');
    if (!treeContainer.children.length || treeContainer.querySelector('.loading') || treeContainer.querySelector('.empty-state') || treeContainer.querySelector('.error')) {
        treeContainer.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    }
    treeContainer.style.display = 'block';

    // 获取数据并行处理
    Promise.all([
        getBookmarkTreeSnapshot(),
        new Promise(resolve => browserAPI.storage.local.get(['lastBookmarkData'], resolve))
    ]).then(async ([snapshot, storageData]) => {
        const currentTree = snapshot ? snapshot.tree : null;
        const snapshotVersion = snapshot ? snapshot.version : null;
        if (!currentTree || currentTree.length === 0) {
            treeContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-sitemap"></i></div>
                    <div class="empty-state-title">${i18n.emptyTree[currentLang]}</div>
                </div>
            `;
            isRenderingTree = false;
            if (pendingRenderRequest !== null) {
                const pending = pendingRenderRequest;
                pendingRenderRequest = null;
                renderTreeView(pending);
            }
            return;
        }

        // 版本快路径：优先使用 background 快照版本，避免对整棵树做 JSON 指纹（非常耗时）
        const canUseVersion = snapshotVersion !== null && typeof snapshotVersion !== 'undefined';
        const currentFingerprint = canUseVersion ? null : getTreeFingerprint(currentTree);

        // 如果版本/指纹相同，直接使用缓存（树没有变化）
        if (cachedTreeData && ((canUseVersion && snapshotVersion === lastTreeSnapshotVersion) || (!canUseVersion && currentFingerprint === lastTreeFingerprint))) {
            console.log('[renderTreeView] 使用缓存（书签未变化）');

            if (currentView === 'current-changes' && treeContainer.children.length) {
                cachedCurrentTree = currentTree;
                cachedCurrentTreeIndex = null;
                if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
                    await ensureCanvasLazyChangeHints(false);
                    ensureCanvasLazyLegend(treeContainer);
                }
                // 恢复滚动位置
                if (permBody && permScrollTop !== null && !isScrollRestoreBlocked()) {
                    permBody.scrollTop = permScrollTop;
                    permBody.scrollLeft = permScrollLeft;
                }
                isRenderingTree = false;
                if (pendingRenderRequest !== null) {
                    const pending = pendingRenderRequest;
                    pendingRenderRequest = null;
                    console.log('[renderTreeView] 处理待处理的渲染请求（Canvas无变化）');
                    renderTreeView(pending);
                }
                return;
            }

            treeContainer.innerHTML = '';
            treeContainer.appendChild(cachedTreeData.treeFragment.cloneNode(true));
            treeContainer.style.display = 'block';
            if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
                await ensureCanvasLazyChangeHints(false);
                ensureCanvasLazyLegend(treeContainer);
            }

            // 重新绑定事件
            attachTreeEvents(treeContainer);
            // 恢复滚动位置（延迟确保展开状态恢复后再恢复滚动位置）
            if (permBody && permScrollTop !== null) {
                const restoreScroll = () => {
                    if (isScrollRestoreBlocked()) return;
                    permBody.scrollTop = permScrollTop;
                    permBody.scrollLeft = permScrollLeft;
                };
                restoreScroll();
                requestAnimationFrame(() => {
                    restoreScroll();
                    setTimeout(restoreScroll, 50);
                    setTimeout(restoreScroll, 150);
                    setTimeout(restoreScroll, 300);
                    setTimeout(restoreScroll, 500);
                });
            }

            // 重置渲染标志并处理合并请求
            isRenderingTree = false;
            if (pendingRenderRequest !== null) {
                const pending = pendingRenderRequest;
                pendingRenderRequest = null;
                console.log('[renderTreeView] 处理待处理的渲染请求（指纹一致）');
                renderTreeView(pending);
            }
            return;
        }

        // 树有变化，重新渲染
        console.log('[renderTreeView] 检测到书签变化，重新渲染');

        const oldTree = storageData.lastBookmarkData && storageData.lastBookmarkData.bookmarkTree;
        cachedOldTree = oldTree;
        cachedCurrentTree = currentTree; // 缓存当前树，用于智能路径检测
        cachedCurrentTreeIndex = null;

        // 【关键修复】预热 favicon 缓存 - 从 IndexedDB 批量加载到内存
        if (!(currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED)) {
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
        }

        // 快速检测变动（只在有备份数据时才检测）
        console.log('[renderTreeView] oldTree 存在:', !!oldTree);
        console.log('[renderTreeView] oldTree[0] 存在:', !!(oldTree && oldTree[0]));

        if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
            // [Modified] In lazy mode, we still need diff detection to show "Add/Reduce/Modify/Move" indicators
            // previously we skipped it for performance, now we keep it but optimize rendering
            // treeChangeMap = new Map(); // Don't skip!
            console.log('[renderTreeView] Canvas lazy mode: executing diff detection to show indicators');
            treeChangeMap = await detectTreeChangesFast(oldTree, currentTree);
        } else if (oldTree && oldTree[0]) {
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

        let canvasHints = null;
        if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
            canvasHints = await ensureCanvasLazyChangeHints(false);
        }

        // 合并旧树和新树，显示删除的节点
        let treeToRender = currentTree;
        if (oldTree && oldTree[0] && treeChangeMap && treeChangeMap.size > 0) {
            // 检查是否有删除的节点，只有在有删除节点时才重建树
            let hasDeletedNodes = false;
            for (const [, change] of treeChangeMap) {
                if (change.type === 'deleted') {
                    hasDeletedNodes = true;
                    break;
                }
            }
            if (hasDeletedNodes) {
                console.log('[renderTreeView] 检测到删除节点，合并旧树和新树');
                try {
                    treeToRender = rebuildTreeWithDeleted(oldTree, currentTree, treeChangeMap);
                } catch (error) {
                    console.error('[renderTreeView] 重建树时出错:', error);
                    treeToRender = currentTree; // 回退到原始树
                }
            }
        }
        console.log('[renderTreeView] 使用树:', treeToRender === currentTree ? 'currentTree' : 'rebuiltTree');

        // 否则当 treeToRender 是 rebuiltTree（包含 deleted）时，展开文件夹仍会按 currentTreeIndex 取 children，导致 deleted 永远看不到。
        try {
            cachedRenderTreeIndex = null;
            if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED && treeToRender && treeToRender[0]) {
                const idx = buildTreeIndexFromRoot(treeToRender[0]);
                if (idx) {
                    cachedRenderTreeIndex = idx;
                    try { window.__canvasRenderTreeIndex = idx; } catch (_) { }
                }
            } else {
                try { window.__canvasRenderTreeIndex = null; } catch (_) { }
            }
        } catch (_) { }

        // 使用 DocumentFragment 优化渲染
        const fragment = document.createDocumentFragment();

        if (treeChangeMap.size > 0 || (canvasHints && canvasHints.hasAny)) {
            const legend = document.createElement('div');
            legend.className = 'tree-legend';
            const cursorStyle = 'cursor: pointer; user-select: none;';
            legend.innerHTML = `
                <span class="legend-item" data-change-type="added" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看新增项' : 'Click to view added items'}"><span class="legend-dot added"></span> ${currentLang === 'zh_CN' ? '新增' : 'Added'}</span>
                <span class="legend-item" data-change-type="deleted" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看删除项' : 'Click to view deleted items'}"><span class="legend-dot deleted"></span> ${currentLang === 'zh_CN' ? '删除' : 'Deleted'}</span>
                <span class="legend-item" data-change-type="moved" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看移动项' : 'Click to view moved items'}"><span class="legend-dot moved"></span> ${currentLang === 'zh_CN' ? '移动' : 'Moved'}</span>
                <span class="legend-item" data-change-type="modified" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看修改项' : 'Click to view modified items'}"><span class="legend-dot modified"></span> ${currentLang === 'zh_CN' ? '修改' : 'Modified'}</span>
            `;
            fragment.appendChild(legend);
        }

        // 改为回溯祖先（不做 O(N) 整树扫描），避免大树/大变化导致“没有任何标识/简略空白”。
        let hintSet = null;
        if (currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED) {
            const explicitSet = new Set();
            try {
                if (explicitMovedIds instanceof Map && explicitMovedIds.size) {
                    const now = Date.now();
                    for (const [id, expiry] of explicitMovedIds.entries()) {
                        if (typeof expiry !== 'number' || expiry > now) {
                            explicitSet.add(String(id));
                        }
                    }
                }
            } catch (_) { }

            try {
                hintSet = computeChangesHintSetFast(treeChangeMap, explicitSet);
                console.log('[renderTreeView] Changes hint nodes count:', hintSet.size);
            } catch (e) {
                console.warn('[renderTreeView] build hintSet failed:', e);
                hintSet = null;
            }

            // 祖先聚合徽标：不加载子树也能看出变化类型
            try {
                const badgeMap = computeAncestorChangeBadgesFast(treeChangeMap, explicitSet);
                window.__canvasPermanentAncestorBadges = badgeMap;
                __canvasPermanentAncestorBadges = badgeMap;
            } catch (_) {
                try { window.__canvasPermanentAncestorBadges = null; } catch (_) { }
                __canvasPermanentAncestorBadges = null;
            }

            // 供后续懒加载子节点渲染使用（否则展开后灰点会消失）
            try { window.__canvasPermanentHintSet = hintSet; } catch (_) { }
            __canvasPermanentHintSet = hintSet;
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderTreeNodeWithChanges(treeToRender[0], 0, 50, new Set(), hintSet);
        while (tempDiv.firstChild) {
            fragment.appendChild(tempDiv.firstChild);
        }

        // 更新缓存
        cachedTreeData = {
            treeFragment: fragment.cloneNode(true),
            currentTree: currentTree,
            renderTree: treeToRender
        };
        if (canUseVersion) {
            lastTreeSnapshotVersion = snapshotVersion;
        } else {
            lastTreeFingerprint = currentFingerprint;
        }

        // 使用 requestAnimationFrame 确保 DOM 更新和滚动恢复在同一帧内完成，减少闪烁
        requestAnimationFrame(() => {
            treeContainer.innerHTML = '';
            treeContainer.appendChild(fragment);
            treeContainer.style.display = 'block';

            // 绑定事件
            attachTreeEvents(treeContainer);

            // 恢复滚动位置（延迟确保展开状态和懒加载完成后再恢复滚动位置）
            if (permBody && permScrollTop !== null) {
                const restoreScroll = () => {
                    if (isScrollRestoreBlocked()) return;
                    permBody.scrollTop = permScrollTop;
                    permBody.scrollLeft = permScrollLeft;
                };
                restoreScroll();
                setTimeout(restoreScroll, 50);
                setTimeout(restoreScroll, 150);
                setTimeout(restoreScroll, 300); // 等待懒加载完成
                setTimeout(restoreScroll, 500); // 最终确保
            }

            console.log('[renderTreeView] 渲染完成');
        });

        // 重置渲染标志
        isRenderingTree = false;

        // 如果有待处理的渲染请求，处理它
        if (pendingRenderRequest !== null) {
            const pending = pendingRenderRequest;
            pendingRenderRequest = null;
            console.log('[renderTreeView] 处理待处理的渲染请求');
            renderTreeView(pending);
        }
    }).catch(error => {
        console.error('[renderTreeView] 错误:', error);
        treeContainer.innerHTML = `<div class="error">加载失败: ${escapeHtml(error && error.message ? error.message : String(error))}</div>`;
        treeContainer.style.display = 'block';

        // 重置渲染标志
        isRenderingTree = false;
        pendingRenderRequest = null;
    });
}

// 树事件处理器映射（避免重复绑定）
const treeClickHandlers = new WeakMap();
const treeContextMenuHandlers = new WeakMap();

// 绑定树的展开/折叠事件
function attachTreeEvents(treeContainer) {
    const isReadOnlyChangesPreview = (() => {
        try {
            return !!(treeContainer && treeContainer.closest && treeContainer.closest('.changes-preview-readonly'));
        } catch (_) {
            return false;
        }
    })();
    const isReadOnlyTree = isReadOnlyBookmarkTreeContainer(treeContainer);

    // 移除旧的事件监听器
    const existingHandler = treeClickHandlers.get(treeContainer);
    if (existingHandler) {
        treeContainer.removeEventListener('click', existingHandler);
    }

    // 创建新的事件处理器
    const clickHandler = async (e) => {
        try {
            const loadMoreBtn = e.target && e.target.closest ? e.target.closest('.tree-load-more') : null;
            if (loadMoreBtn && CANVAS_PERMANENT_TREE_LAZY_ENABLED && (currentView === 'current-changes' || isReadOnlyChangesPreview)) {
                e.preventDefault();
                e.stopPropagation();
                const parentId = loadMoreBtn.dataset.parentId;
                const startIndex = parseInt(loadMoreBtn.dataset.startIndex, 10) || 0;
                const childrenContainer = loadMoreBtn.closest('.tree-children');
                loadPermanentFolderChildrenLazy(parentId, childrenContainer, startIndex, loadMoreBtn, isReadOnlyChangesPreview);
                return;
            }
        } catch (_) { }

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

        // =============================================================================
        // 书签左键点击处理器（与右键菜单动作保持一致）
        // =============================================================================
        // 左键点击书签标签，根据默认打开方式打开（避免重复绑定多个 click 监听器）
        try {
            const link = e.target && e.target.closest ? e.target.closest('a.tree-bookmark-link') : null;
            if (link && treeContainer.contains(link)) {
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
                // 永久栏目副本：补充 copyId / displayIndex，供“同窗专属组 / 专属标签组 / 专属窗口”等按栏目作用域区分
                try {
                    const sectionEl = link.closest ? link.closest('.permanent-bookmark-section') : null;
                    if (sectionEl && sectionEl.classList && sectionEl.classList.contains('permanent-section-copy') && sectionEl.dataset) {
                        const copyIdRaw = sectionEl.dataset.permanentSectionCopyId;
                        const copyId = (typeof copyIdRaw === 'string') ? copyIdRaw.trim() : '';
                        if (copyId) contextInfo.permanentCopyId = copyId;
                        const displayIndexRaw = sectionEl.dataset.permanentSectionDisplayIndex;
                        const displayIndex = parseInt(displayIndexRaw, 10);
                        if (Number.isFinite(displayIndex) && displayIndex > 0) {
                            contextInfo.permanentDisplayIndex = displayIndex;
                        }
                    }
                } catch (_) { }

                try {
                    if (window.defaultOpenMode === undefined && typeof window.getDefaultOpenMode === 'function') {
                        window.defaultOpenMode = window.getDefaultOpenMode();
                    }
                } catch (_) { }
                const mode = (typeof window !== 'undefined' && window.defaultOpenMode) || (typeof defaultOpenMode !== 'undefined' ? defaultOpenMode : 'new-tab');

                const actionKey = `left-click-${mode}-${url}`;
                if (typeof shouldAllowBookmarkOpen === 'function' && !shouldAllowBookmarkOpen(actionKey)) {
                    return;
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
                } else if (mode === 'manual-select') {
                    if (typeof openBookmarkWithManualSelection === 'function') openBookmarkWithManualSelection(url); else window.open(url, '_blank');
                } else {
                    if (typeof openBookmarkNewTab === 'function') openBookmarkNewTab(url); else window.open(url, '_blank');
                }
                return;
            }
        } catch (_) { }

        // 点击整个文件夹行都可以展开
        const treeItem = e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
        if (treeItem) {
            // 找到包含这个tree-item的tree-node
            const node = treeItem.closest('.tree-node');
            if (!node) {
                console.log('[树事件] 未找到tree-node');
                return;
            }

            const children = node.querySelector(':scope > .tree-children');
            const toggle = treeItem.querySelector(':scope > .tree-toggle');

            console.log('[树事件] 点击节点:', {
                hasChildren: !!children,
                hasToggle: !!toggle,
                nodeHTML: node.outerHTML.substring(0, 200)
            });

            if (children && toggle) {
                e.stopPropagation();
                children.classList.toggle('expanded');
                toggle.classList.toggle('expanded');

                const expanded = children.classList.contains('expanded');
                console.log('[树事件] 切换展开状态:', expanded);

                // 视觉同步：文件夹图标随展开状态切换
                try {
                    const folderIcon = treeItem.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
                    if (folderIcon) {
                        if (expanded) {
                            folderIcon.classList.remove('fa-folder');
                            folderIcon.classList.add('fa-folder-open');
                        } else {
                            folderIcon.classList.remove('fa-folder-open');
                            folderIcon.classList.add('fa-folder');
                        }
                    }
                } catch (_) { }

                // 简略模式：若手动展开“变化文件夹”，应显示其子内容（不再被 compact 过滤隐藏）
                try {
                    const previewRoot = treeContainer && treeContainer.closest
                        ? treeContainer.closest('#changesTreePreviewInline')
                        : null;
                    const isCompactMode = !!(previewRoot && previewRoot.classList && previewRoot.classList.contains('compact-mode'));
                    const nodeType = (treeItem.getAttribute('data-node-type') || treeItem.dataset.nodeType || '');
                    const isChangedFolder = nodeType === 'folder' && (
                        treeItem.classList.contains('tree-change-added') ||
                        treeItem.classList.contains('tree-change-deleted') ||
                        treeItem.classList.contains('tree-change-modified') ||
                        treeItem.classList.contains('tree-change-moved') ||
                        treeItem.classList.contains('tree-change-mixed')
                    );
                    if (isCompactMode && isChangedFolder && node) {
                        if (expanded) node.classList.add('compact-reveal-all');
                        else node.classList.remove('compact-reveal-all');
                    }
                } catch (_) { }

                // 保存展开状态
                saveTreeExpandState(treeContainer);

                try {
                    if (expanded &&
                        CANVAS_PERMANENT_TREE_LAZY_ENABLED &&
                        (currentView === 'current-changes' || isReadOnlyChangesPreview) &&
                        treeItem.dataset.nodeType === 'folder' &&
                        treeItem.dataset.childrenLoaded === 'false' &&
                        treeItem.dataset.hasChildren === 'true') {
                        loadPermanentFolderChildrenLazy(treeItem.dataset.nodeId, children, 0, null, isReadOnlyChangesPreview);
                    }
                } catch (_) { }
            }
        }
    };

    // 绑定新的事件监听器
    treeContainer.addEventListener('click', clickHandler);
    treeClickHandlers.set(treeContainer, clickHandler);

    // 绑定右键菜单事件（只读树禁用）
    if (!isReadOnlyTree) {
        const existingContextHandler = treeContextMenuHandlers.get(treeContainer);
        if (existingContextHandler) {
            treeContainer.removeEventListener('contextmenu', existingContextHandler);
        }
        const contextHandler = (e) => {
            const item = e && e.target && e.target.closest ? e.target.closest('.tree-item[data-node-id]') : null;
            if (!item || !treeContainer.contains(item)) return;
            if (typeof showContextMenu === 'function') {
                showContextMenu(e, item);
            }
        };
        treeContainer.addEventListener('contextmenu', contextHandler);
        treeContextMenuHandlers.set(treeContainer, contextHandler);
    }

    // 绑定拖拽事件（只读树禁用）
    if (!isReadOnlyTree && typeof attachDragEvents === 'function') {
        attachDragEvents(treeContainer);
    }

    // 绑定指针拖拽事件（只读树禁用）
    if (!isReadOnlyTree && typeof attachPointerDragEvents === 'function') {
        attachPointerDragEvents(treeContainer);
        console.log('[树事件] 指针拖拽事件已绑定');
    }

    console.log('[树事件] 事件绑定完成');

    // 恢复展开状态
    restoreTreeExpandState(treeContainer);

    // 绑定Permanent Section图例点击事件
    setupLegendClickHandlers(treeContainer);
}

// 绑定图例点击导航功能
function setupLegendClickHandlers(container) {
    const legends = container.querySelectorAll('.tree-legend .legend-item[data-change-type]');
    legends.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const type = item.getAttribute('data-change-type');
            if (type) {
                jumpToNextChangeType(type, container);
            }
        });
    });
}

// 导航到下一个指定类型的变动节点
// 维护每个类型的当前索引，实现循环跳转
const _changeTypeIndices = { added: -1, deleted: -1, modified: -1, moved: -1 };
async function jumpToNextChangeType(type, container) {
    if (!treeChangeMap || treeChangeMap.size === 0) {
        const msg = currentLang === 'zh_CN' ? '当前没有变动' : 'No changes detected';
        // 使用简单的提示，或者 custom toast
        console.log(msg);
        return;
    }

    // 收集所有符合类型的节点ID
    let targetIds = [];
    const candidates = new Set();
    for (const [id, change] of treeChangeMap.entries()) {
        let match = false;
        if (type === 'added' && change.type === 'added') match = true;
        else if (type === 'deleted' && change.type === 'deleted') match = true;
        else if (type === 'modified' && change.type.includes('modified')) match = true;
        else if (type === 'moved' && change.type.includes('moved')) match = true;

        if (match) candidates.add(id);
    }

    // 还有显式移动的
    if (type === 'moved' && explicitMovedIds) {
        const now = Date.now();
        for (const [id, expiry] of explicitMovedIds.entries()) {
            if (expiry > now) {
                candidates.add(id);
            }
        }
    }

    // [New] 按照树的视觉顺序（从上到下）排序 targetIds
    if (candidates.size > 0) {
        if (cachedTreeData && cachedTreeData.renderTree) {
            const sorted = [];
            const traverse = (nodes) => {
                if (!nodes || !Array.isArray(nodes)) return;
                for (const node of nodes) {
                    if (candidates.has(node.id)) {
                        sorted.push(node.id);
                    }
                    if (node.children && node.children.length > 0) {
                        traverse(node.children);
                    }
                }
            };
            // 根节点通常是虚拟的或者就是 treeToRender[0]
            traverse(cachedTreeData.renderTree);
            targetIds = sorted;

            // 兜底：如果有遗漏（理论上不应该，除非 renderTree 不全），把剩下的追加在后面
            if (sorted.length < candidates.size) {
                candidates.forEach(id => {
                    if (!sorted.includes(id)) targetIds.push(id);
                });
            }
        } else {
            // 降级：无树结构缓存，使用默认 Map 顺序
            targetIds = Array.from(candidates);
        }
    }



    if (targetIds.length === 0) {
        const typeLabels = {
            added: currentLang === 'zh_CN' ? '新增' : 'Added',
            deleted: currentLang === 'zh_CN' ? '删除' : 'Deleted',
            modified: currentLang === 'zh_CN' ? '修改' : 'Modified',
            moved: currentLang === 'zh_CN' ? '移动' : 'Moved'
        };
        const msg = currentLang === 'zh_CN'
            ? `没有找到"${typeLabels[type]}"类型的变动`
            : `No items found for "${typeLabels[type]}"`;
        alert(msg);
        return;
    }

    // 循环索引
    _changeTypeIndices[type]++;
    if (_changeTypeIndices[type] >= targetIds.length) {
        _changeTypeIndices[type] = 0;
    }
    const targetId = targetIds[_changeTypeIndices[type]];

    console.log(`[JumpToChange] Type: ${type}, Index: ${_changeTypeIndices[type]}/${targetIds.length}, ID: ${targetId}`);

    // 如果节点未渲染（在懒加载的折叠文件夹中），需要先展开父级
    // 我们复用 computeForceExpandSet 的逻辑思想，但这里针对单个节点
    // 1. 找到该节点的所有父ID
    // 2. 强制展开这些父ID
    // 3. 滚动到该节点

    // 获取路径
    // 由于我们可能是在 collapsed 的文件夹里，DOM里可能没有这个元素
    let targetItem = container.querySelector(`.tree-item[data-node-id="${targetId}"]`);

    if (!targetItem) {
        // 尝试在 cachedTreeData.currentTree (或者 rebuilding logic) 中找路径
        // 但最简单的是：触发一次带 forceExpand 的渲染，但这比较重
        // 替代方案：根据 treeChangeMap 里的 info (detectTreeChangesFast 里有 parentId) 
        // 但 fast map里存的结构可能不全。
        // 可靠方案：如果 treeChangeMap 存在，说明我们有完整树数据。
        // 我们利用 search 的 jumpToResult 逻辑（如果它通用），或者简单地：
        // 强制把这个 targetId 加入 forceExpandSet（如果能传进去），然后重绘? 
        // 不，重绘太慢。

        // 更好的方式：利用 loadPermanentFolderChildrenLazy 递归加载/展开路径
        // 但我们需要知道路径。
        // 如果我们有 cachedOldTree 和 cachedCurrentTree (treeToRender)，我们可以遍历找到路径。

        // 这里简化处理：如果找不到DOM，提示用户展开文件夹，或者尝试触发一次“定位重绘”
        // 实际上，我们之前的 forceExpandSet 逻辑应该已经保证了“有变动的节点”是渲染了的（除非是“此文件夹下有变化”的深层节点）
        // 等等，之前的 forceExpandSet 是把**所有**变动节点都强制展开了吗？
        // 是的：computeForceExpandSet 递归检查，如果子节点有变动，父节点加入set。
        // 此时 renderTreeView 会使用 set 来决定是否截断懒加载。
        // 所以，如果 renderTreeView 已经运行过且正确，target element 应该已经在 DOM 中了！
        // 除非 target element 本身是折叠状态（但 forceExpandSet 也会展开它？不，forceExpandSet 是让它*被渲染*，是否 `expanded` 取决于 `expanded` class）

        // 检查 renderTreeNodeWithChanges:
        // const shouldForceExpand = forceExpandSet && forceExpandSet.has(node.id);
        // <span class="tree-children ${level === 0 || shouldForceExpand ? 'expanded' : ''}">
        // 所以，如果有变动，父文件夹应该是 expanded 的。
        // 唯一的例外是：如果是 lazy rendering 初次加载，可能还在进行中？或者 forceExpandSet 被漏了？

        // 所以理论上 targetItem 应该存在。如果不存在，可能是：
        // 1. 这是一个删除的节点，且父节点被折叠 (?)
        // 2. 这是一个“移动”的节点，在 lazy load 区域 (?)
    }

    if (targetItem) {
        // 确保父级视觉上展开 (css check)
        let parent = targetItem.closest('.tree-children');
        let expandedAny = false;
        while (parent && parent !== container) {
            if (!parent.classList.contains('expanded')) {
                parent.classList.add('expanded');
                expandedAny = true;
                const pNode = parent.closest('.tree-node');
                if (pNode) {
                    const toggle = pNode.querySelector('.tree-toggle');
                    if (toggle) toggle.classList.add('expanded');
                    const icon = pNode.querySelector('.tree-icon.fas.fa-folder');
                    if (icon) {
                        icon.classList.remove('fa-folder');
                        icon.classList.add('fa-folder-open');
                    }
                }
            }
            parent = parent.parentElement ? parent.parentElement.closest('.tree-children') : null;
        }

        // 如果展开了任何文件夹，保存展开状态以实现持久化
        if (expandedAny) {
            saveTreeExpandState(container);
        }

        // 滚动并高亮
        targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 移除旧的跳转高亮（不要复用 .highlight-target，它在别处是统一橙色高亮）
        container.querySelectorAll('.jump-highlight').forEach(el => {
            el.classList.remove('jump-highlight');
            el.style.animation = '';
        });

        const pulseByType = {
            added: 'highlightPulseAdded',
            deleted: 'highlightPulseDeleted',
            modified: 'highlightPulseModified',
            moved: 'highlightPulseMoved'
        };
        const pulse = pulseByType[type] || 'highlightPulseModified';

        // 高亮所有该类型的节点 (Added matches Added, Modified matches Modifed, etc)
        // 从 targetIds 列表里找，只要 DOM 里存在的都高亮
        let highlightCount = 0;
        targetIds.forEach(id => {
            const item = container.querySelector(`.tree-item[data-node-id="${id}"]`);
            if (item) {
                // 确保样式类存在并触发重绘
                item.classList.add('jump-highlight');
                item.style.animation = 'none';
                item.offsetHeight; /* trigger reflow */
                // 使用各自的变化颜色（而不是统一橙色）
                item.style.animation = `${pulse} 2s ease-out infinite`;
                highlightCount++;

                // 3秒后移除动画
                setTimeout(() => {
                    // 检查是否还在 DOM 中（防止已经被重新渲染替换）
                    if (item.isConnected) {
                        item.style.animation = '';
                        item.classList.remove('jump-highlight');
                    }
                }, 3000);
            }
        });

        console.log(`[JumpToChange] Scrolled to ${targetId}, Highlighted ${highlightCount} items`);
    } else {
        console.warn(`[JumpToChange] Element ${targetId} not found in DOM even after force expand check.`);
        // fallback?
    }
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

// 保存树的展开状态（使用节点 ID，更可靠）
const _saveTreeExpandStateTimers = new WeakMap();
function __saveTreeExpandStateToStorage(treeContainer) {
    if (!treeContainer) return;
    try {
        const expandedIds = [];
        treeContainer.querySelectorAll('.tree-children.expanded').forEach(children => {
            const node = children.closest('.tree-node');
            const item = node ? node.querySelector(':scope > .tree-item[data-node-id]') : null;
            if (item && item.dataset && item.dataset.nodeId) {
                expandedIds.push(item.dataset.nodeId);
            }
        });
        const key = __getTreeExpandStateStorageKey(treeContainer);
        localStorage.setItem(key, JSON.stringify(expandedIds));
        console.log('[树状态] 保存展开节点:', expandedIds.length, 'key:', key);
    } catch (e) {
        console.error('[树状态] 保存失败:', e);
    }
}
function saveTreeExpandState(treeContainer) {
    try {
        if (!treeContainer) return;
        // Current Changes 预览：立即写入（模式切换时同一个 treeContainer 会复用，debounce 会丢旧模式状态）
        try {
            const key = __getTreeExpandStateStorageKey(treeContainer);
            if (key && key.startsWith('changesPreviewExpandedNodes:')) {
                const prevTimer = _saveTreeExpandStateTimers.get(treeContainer);
                if (prevTimer) {
                    clearTimeout(prevTimer);
                    try { _saveTreeExpandStateTimers.delete(treeContainer); } catch (_) { }
                }
                __saveTreeExpandStateToStorage(treeContainer);
                return;
            }
        } catch (_) { }

        const prevTimer = _saveTreeExpandStateTimers.get(treeContainer);
        if (prevTimer) {
            clearTimeout(prevTimer);
        }
        const timer = setTimeout(() => {
            try { _saveTreeExpandStateTimers.delete(treeContainer); } catch (_) { }
            __saveTreeExpandStateToStorage(treeContainer);
        }, 250);
        _saveTreeExpandStateTimers.set(treeContainer, timer);
    } catch (e) {
        console.error('[树状态] 保存失败:', e);
    }
}

// 恢复树的展开状态（使用节点 ID，更可靠）
function restoreTreeExpandState(treeContainer) {
    try {
        const savedState = __readTreeExpandStateFromStorage(treeContainer);
        if (!savedState) return;

        const expandedIds = JSON.parse(savedState);
        if (!Array.isArray(expandedIds) || expandedIds.length === 0) return;

        const expandedSet = new Set(expandedIds);
        const nodesToLazyLoad = []; // 预览懒加载模式下需要加载子节点的文件夹

        const isReadOnlyChangesPreview = (() => {
            try {
                return !!(treeContainer && treeContainer.closest && treeContainer.closest('.changes-preview-readonly'));
            } catch (_) {
                return false;
            }
        })();

        treeContainer.querySelectorAll('.tree-item[data-node-id]').forEach(item => {
            if (expandedSet.has(item.dataset.nodeId)) {
                const node = item.closest('.tree-node');
                if (!node) return;
                const children = node.querySelector(':scope > .tree-children');
                const toggle = item.querySelector('.tree-toggle');
                const icon = item.querySelector('.tree-icon.fas');
                if (children && toggle) {
                    children.classList.add('expanded');
                    toggle.classList.add('expanded');
                    // 更新文件夹图标
                    if (icon && icon.classList.contains('fa-folder')) {
                        icon.classList.remove('fa-folder');
                        icon.classList.add('fa-folder-open');
                    }
                    // 预览懒加载：如果子节点未加载，记录下来稍后加载
                    if (isReadOnlyChangesPreview &&
                        CANVAS_PERMANENT_TREE_LAZY_ENABLED &&
                        item.dataset.childrenLoaded === 'false' &&
                        item.dataset.hasChildren === 'true') {
                        nodesToLazyLoad.push({ parentId: item.dataset.nodeId, children });
                    }
                }
            }
        });

        // 预览懒加载：批量加载需要展开的文件夹的子节点
        if (nodesToLazyLoad.length > 0) {
            console.log('[树状态] 预览懒加载：需要加载', nodesToLazyLoad.length, '个文件夹的子节点');
            // 延迟加载，避免阻塞渲染
                setTimeout(() => {
                    nodesToLazyLoad.forEach(({ parentId, children }) => {
                        try {
                            loadPermanentFolderChildrenLazy(parentId, children, 0, null, isReadOnlyChangesPreview);
                        } catch (e) {
                            console.warn('[树状态] 懒加载子节点失败:', parentId, e);
                        }
                    });
                }, 50);
        }

        console.log('[树状态] 恢复展开节点:', expandedIds.length);
    } catch (e) {
        console.error('[树状态] 恢复失败:', e);
    }
}


if (!window.__currentChangesScrollStateFlushBound) {
    window.__currentChangesScrollStateFlushBound = true;
    window.addEventListener('pagehide', __flushCurrentChangesScrollState);
    document.addEventListener('visibilitychange', () => {
        try {
            if (document.visibilityState === 'hidden') {
                __flushCurrentChangesScrollState();
            }
        } catch (_) { }
    });
}

// 快速检测书签树变动（性能优化版 + 智能移动检测）
// options:
// - explicitMovedIdSet: 指定一个 Set/Array 的 moved ids（用于备份历史按“当次提交”复现），传 null 表示禁用显式 moved
async function detectTreeChangesFast(oldTree, newTree, options = {}) {
    const changes = new Map();
    if (!oldTree || !newTree) return changes;

    const now = Date.now();

    const useGlobalExplicitMovedIds = options.useGlobalExplicitMovedIds !== false;
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
    } else if (useGlobalExplicitMovedIds && explicitMovedIds instanceof Map) {
        explicitMovedIdSet = new Set();
        for (const [id, expiry] of explicitMovedIds.entries()) {
            if (typeof expiry !== 'number' || expiry > now) {
                explicitMovedIdSet.add(String(id));
            }
        }
    }
    const hasExplicitMovedInfo = explicitMovedIdSet instanceof Set && explicitMovedIdSet.size > 0;

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

    // 删除（补充 oldParentId / oldIndex / oldPath，供懒加载“灰点提示”快速回溯祖先）
    oldNodes.forEach((o, id) => {
        if (newNodes.has(id)) return;
        try {
            changes.set(id, {
                type: 'deleted',
                deleted: {
                    oldPath: getNodePath(oldTree, id),
                    oldParentId: o && o.parentId ? o.parentId : null,
                    oldIndex: (o && typeof o.index === 'number') ? o.index : null
                }
            });
        } catch (_) {
            changes.set(id, { type: 'deleted' });
        }
    });

    // 建立“子节点集合发生变化”的父级集合：
    // - add/delete 会导致同级 index 被动变化（不应被当成 moved）
    // - 跨级移动会改变源/目标父级的 children 集合（同样不应误标同级为 moved）
    const parentsWithChildSetChange = new Set();
    changes.forEach((change, id) => {
        if (!change || !change.type) return;

        if (change.type.includes('added') || change.type.includes('deleted')) {
            const node = change.type.includes('added') ? newNodes.get(id) : oldNodes.get(id);
            if (node && node.parentId) parentsWithChildSetChange.add(node.parentId);
        }

        // 跨级移动：把 old/new parent 都加入（避免同级被动位移误标）
        if (change.type.includes('moved') && change.moved && change.moved.oldParentId !== change.moved.newParentId) {
            if (change.moved.oldParentId) parentsWithChildSetChange.add(change.moved.oldParentId);
            if (change.moved.newParentId) parentsWithChildSetChange.add(change.moved.newParentId);
        }
    });

    const markMoved = (id) => {
        const existing = changes.get(id);
        const types = existing && existing.type ? new Set(existing.type.split('+')) : new Set();
        types.add('moved');
        const movedDetail = { oldPath: getNodePath(oldTree, id), newPath: getNodePath(newTree, id) };
        changes.set(id, { type: Array.from(types).join('+'), moved: movedDetail });
    };

    // 同级移动（重要：只标记“被拖动”的对象；不标记因为插入/删除/跨级移动导致的同级被动位移）
    // - 有显式 moved IDs（onMoved）时：只按显式集合打标（即使该父级也发生了 add/delete 或跨级移动）
    // - 无显式 moved IDs 时：仅在该父级 children 集合未变化时，用 LIS 推导最小 moved 集合
    const commonPosCache = new Map(); // parentId -> { oldPosById, newPosById } （仅针对 common ids）
    const getCommonPositions = (parentId) => {
        if (commonPosCache.has(parentId)) return commonPosCache.get(parentId);

        const oldList = oldByParent.get(parentId) || [];
        const newList = newByParent.get(parentId) || [];
        const newIdSet = new Set(newList.map(x => String(x.id)));

        const oldPosById = new Map();
        let oldPos = 0;
        for (const item of oldList) {
            const sid = String(item.id);
            if (newIdSet.has(sid)) {
                oldPosById.set(sid, oldPos++);
            }
        }

        const newPosById = new Map();
        let newPos = 0;
        for (const item of newList) {
            const sid = String(item.id);
            if (oldPosById.has(sid)) {
                newPosById.set(sid, newPos++);
            }
        }

        const entry = { oldPosById, newPosById };
        commonPosCache.set(parentId, entry);
        return entry;
    };

    if (hasExplicitMovedInfo) {
        for (const id of explicitMovedIdSet) {
            const o = oldNodes.get(id);
            const n = newNodes.get(id);
            if (!o || !n) continue; // added/deleted: Git 口径不算 moved
            if (!o.parentId || !n.parentId) continue;
            if (o.parentId !== n.parentId) continue; // 跨级 moved 已在上方标记

            const parentId = n.parentId;
            const { oldPosById, newPosById } = getCommonPositions(parentId);
            const oldPos = oldPosById.get(id);
            const newPos = newPosById.get(id);
            if (typeof oldPos === 'number' && typeof newPos === 'number' && oldPos !== newPos) {
                markMoved(id);
            }
        }
    } else {
        // 无显式 moved：对“children 集合未变化”的父级做最小 moved 推导
        newByParent.forEach((newList, parentId) => {
            if (parentsWithChildSetChange.has(parentId)) return;

            const oldList = oldByParent.get(parentId) || [];
            if (oldList.length === 0 || newList.length === 0) return;
            if (oldList.length !== newList.length) return;

            // 先快速判等（完全一致则不必做 LIS）
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
                if (typeof oldPos !== 'number') return; // children 集合变化（保险兜底）
                seq.push({ id, oldPos });
            }

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
                    markMoved(item.id);
                }
            }
        });
    }

    return changes;
}

// 懒加载场景下的“包含变化”提示集合：
// - 不做 O(N) 整树扫描（避免大树/大变化卡顿）
// - 只从 changeMap 的 changed ids 出发，用 parentId 链回溯祖先
// 作用：给“祖先文件夹”显示灰点（.change-badge.has-changes），避免详细/简略模式看起来“没有任何标识”。
function computeChangesHintSetFast(changeMap, explicitMovedIdSet = null) {
    const out = new Set();
    if (!changeMap || !(changeMap instanceof Map) || changeMap.size === 0) return out;

    const index = getCachedCurrentTreeIndex();
    if (!index) return out;

    const addAncestorsFrom = (startId) => {
        let curId = String(startId);
        let guard = 0;
        while (guard++ < 256) {
            const node = index.get(curId);
            if (!node) break;
            const parentId = node.parentId != null ? String(node.parentId) : '';
            if (!parentId) break;
            if (!out.has(parentId)) out.add(parentId);
            curId = parentId;
        }
    };

    // 1) 基于 changeMap：为每个变化节点回溯祖先
    try {
        changeMap.forEach((change, id) => {
            if (!id) return;

            // deleted：节点本身不在 currentTree 里，优先用 oldParentId
            const type = change && typeof change.type === 'string' ? change.type : '';
            if (type.includes('deleted')) {
                const oldParentId = change && change.deleted && change.deleted.oldParentId ? change.deleted.oldParentId : null;
                if (oldParentId != null) {
                    out.add(String(oldParentId));
                    addAncestorsFrom(String(oldParentId));
                }
                return;
            }

            addAncestorsFrom(String(id));
        });
    } catch (_) { /* ignore */ }

    // 2) 显式 moved：同样回溯祖先
    try {
        if (explicitMovedIdSet instanceof Set && explicitMovedIdSet.size) {
            for (const id of explicitMovedIdSet) {
                if (!id) continue;
                addAncestorsFrom(String(id));
            }
        }
    } catch (_) { /* ignore */ }

    return out;
}

function computeAncestorChangeBadgesFast(changeMap, explicitMovedIdSet = null) {
    // bitmask: 1=added, 2=deleted, 4=modified, 8=moved
    const out = new Map();
    if (!changeMap || !(changeMap instanceof Map) || changeMap.size === 0) return out;

    const index = getCachedCurrentTreeIndex();
    if (!index) return out;

    const addMask = (folderId, mask) => {
        if (!folderId) return;
        const sid = String(folderId);
        const prev = out.get(sid) || 0;
        out.set(sid, prev | mask);
    };

    const bubbleUp = (startId, mask) => {
        let curId = String(startId);
        let guard = 0;
        while (guard++ < 256) {
            const node = index.get(curId);
            if (!node) break;
            const parentId = node.parentId != null ? String(node.parentId) : '';
            if (!parentId) break;
            addMask(parentId, mask);
            curId = parentId;
        }
    };

    try {
        changeMap.forEach((change, id) => {
            if (!id) return;
            const type = change && typeof change.type === 'string' ? change.type : '';
            if (!type) return;

            // deleted：从 oldParentId 向上冒泡（被删除节点本身不在 currentTree）
            if (type.includes('deleted')) {
                const oldParentId = change && change.deleted && change.deleted.oldParentId ? change.deleted.oldParentId : null;
                if (oldParentId != null) {
                    addMask(String(oldParentId), 2);
                    bubbleUp(String(oldParentId), 2);
                }
                return;
            }

            const masks = [];
            if (type.includes('added')) masks.push(1);
            if (type.includes('modified')) masks.push(4);
            if (type.includes('moved')) masks.push(8);
            // 注意：非 deleted 情况下，folderDiff / bookmarkDiff 的“数量变化”不在 treeChangeMap 里，
            // 这里只聚合结构变化（added/modified/moved）即可。
            masks.forEach(mask => bubbleUp(String(id), mask));
        });
    } catch (_) { /* ignore */ }

    // 显式 moved：同样向上冒泡 moved
    try {
        if (explicitMovedIdSet instanceof Set && explicitMovedIdSet.size) {
            for (const id of explicitMovedIdSet) {
                if (!id) continue;
                bubbleUp(String(id), 8);
            }
        }
    } catch (_) { /* ignore */ }

    return out;
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

// 重建树结构，包含删除的节点（以新树顺序为主，仅为 deleted 插入占位）
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

            // 处理子节点：以“新树顺序”为主，再插入 deleted 占位节点。
            // 这样能避免在 add/delete 共存时把 moved 节点视觉上拉回旧位置。
            if (oldNode.children || newNode.children) {
                const oldChildren = Array.isArray(oldNode.children) ? oldNode.children : [];
                const newChildren = Array.isArray(newNode.children) ? newNode.children : [];

                const oldChildById = new Map();
                oldChildren.forEach((child) => {
                    if (!child || child.id == null) return;
                    oldChildById.set(String(child.id), child);
                });

                const newChildIdSet = new Set();
                newChildren.forEach((child) => {
                    if (!child || child.id == null) return;
                    newChildIdSet.add(String(child.id));
                });

                const rebuiltChildren = [];

                // 1) 先按新树顺序放置现存节点（保留 moved 后的位置）
                newChildren.forEach((newChild) => {
                    if (!newChild || newChild.id == null) return;
                    const sid = String(newChild.id);
                    const oldChild = oldChildById.get(sid);

                    if (oldChild) {
                        const rebuiltChild = rebuildNode(oldChild, newChildren, depth + 1);
                        if (rebuiltChild) rebuiltChildren.push(rebuiltChild);
                    } else {
                        console.log('[树重建] 添加新节点:', newChild.title);
                        rebuiltChildren.push(newChild);
                    }
                });

                // 2) 再把 deleted 节点插回到“旧顺序中的相对位置”
                oldChildren.forEach((oldChild, oldIndex) => {
                    if (!oldChild || oldChild.id == null) return;
                    const sid = String(oldChild.id);
                    if (newChildIdSet.has(sid)) return;

                    const oldChange = changeMap ? changeMap.get(oldChild.id) : null;
                    const oldType = (oldChange && typeof oldChange.type === 'string') ? oldChange.type : '';
                    if (!oldType.includes('deleted')) return;

                    const deletedChild = rebuildNode(oldChild, null, depth + 1);
                    if (!deletedChild) return;

                    let anchorId = null;
                    for (let i = oldIndex + 1; i < oldChildren.length; i++) {
                        const candidate = oldChildren[i];
                        if (!candidate || candidate.id == null) continue;
                        const candidateId = String(candidate.id);
                        if (newChildIdSet.has(candidateId)) {
                            anchorId = candidateId;
                            break;
                        }
                    }

                    if (anchorId) {
                        const insertAt = rebuiltChildren.findIndex((child) => child && String(child.id) === anchorId);
                        if (insertAt >= 0) {
                            rebuiltChildren.splice(insertAt, 0, deletedChild);
                            return;
                        }
                    }

                    rebuiltChildren.push(deletedChild);
                });

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
// Helper to identify nodes that must be expanded because they contain changes
function computeForceExpandSet(nodes, changeMap, explicitMovedIdSet = null) {
    const set = new Set();
    const hasAny =
        (!!(changeMap && changeMap.size)) ||
        (!!(explicitMovedIdSet && explicitMovedIdSet.size));
    if (!nodes || !hasAny) return set;

    // Recursive check. Returns true if node or descendants have changes.
    const check = (node) => {
        if (!node) return false;
        const id = String(node.id);
        let hasChange =
            (!!(changeMap && changeMap.has(node.id))) ||
            (!!(explicitMovedIdSet && explicitMovedIdSet.has(id)));

        if (node.children) {
            node.children.forEach(child => {
                if (check(child)) {
                    hasChange = true;
                }
            });
        }

        // If this node or any child has changes, this node must be expanded/rendered
        // Note: we might want to distinguish between "render children" and "expand visually".
        // Here we put it in the set, meaning "override lazy loading stop".
        if (hasChange) {
            set.add(node.id);
        }
        return hasChange;
    };

    if (Array.isArray(nodes)) {
        nodes.forEach(node => check(node));
    } else {
        check(nodes);
    }
    return set;
}

function renderTreeNodeWithChanges(node, level = 0, maxDepth = 50, visitedIds = new Set(), forceExpandSet = null, options = {}, underDeletedAncestor = false) {
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
    const changeTypeStr = (change && typeof change.type === 'string') ? change.type : '';

    if (node.url) {
        // 叶子（书签）
        if (node.url) {
            const isExplicitMovedOnly = explicitMovedIds.has(node.id) && explicitMovedIds.get(node.id) > Date.now();
            const lazyHint = getCanvasLazyHintForBookmark(node);
            if (change) {
                if (change.type === 'added') {
                    changeClass = 'tree-change-added';
                    statusIcon = '<span class="change-badge added"><span class="badge-symbol">+</span></span>';
                } else if (change.type === 'deleted') {
                    changeClass = 'tree-change-deleted';
                    statusIcon = '<span class="change-badge deleted"><span class="badge-symbol">-</span></span>';
                } else {
                    const types = change.type.split('+');
                    const hasModified = types.includes('modified');
                    const isMoved = types.includes('moved');
                    const isExplicitMoved = isExplicitMovedOnly;

                    if (hasModified) {
                        changeClass = 'tree-change-modified';
                        statusIcon += '<span class="change-badge modified"><span class="badge-symbol">~</span></span>';
                    }

                    // 移动标记：检测到 moved 类型就显示，不仅限于显式拖动
                    // isMoved 为 true 表示 detectTreeChangesFast 检测到了跨级移动
                    if (isMoved) {
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
                            statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><span class="badge-symbol">>></span><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
                        }
                    }
                }
            } else if (lazyHint) {
                if (lazyHint.type === 'added') {
                    changeClass = 'tree-change-added';
                    statusIcon = '<span class="change-badge added"><span class="badge-symbol">+</span></span>';
                } else if (lazyHint.type === 'modified') {
                    changeClass = 'tree-change-modified';
                    statusIcon += '<span class="change-badge modified"><span class="badge-symbol">~</span></span>';
                } else if (lazyHint.type === 'moved') {
                    changeClass = 'tree-change-moved';
                    const slash = formatFingerprintPathToSlash(lazyHint.oldPath || '');
                    statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><span class="badge-symbol">>></span><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
                }
            } else if (isExplicitMovedOnly) {
                // 无 diff 记录但存在显式移动标识：也显示蓝色移动徽标
                changeClass = 'tree-change-moved';
                let slash = '';
                if (cachedOldTree) {
                    const bc = getNamedPathFromTree(cachedOldTree, node.id);
                    slash = breadcrumbToSlashFolders(bc);
                }
                statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><span class="badge-symbol">>></span><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
            }
            const favicon = getFaviconUrl(node.url);
            return `
                <div class="tree-node">
                    <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-url="${escapeHtml(node.url || '')}" data-node-type="bookmark" data-node-level="${level}" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
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
            statusIcon = '<span class="change-badge added"><span class="badge-symbol">+</span></span>';
        } else if (change.type === 'deleted') {
            changeClass = 'tree-change-deleted';
            statusIcon = '<span class="change-badge deleted"><span class="badge-symbol">-</span></span>';
        } else {
            const types = change.type.split('+');
            const hasModified = types.includes('modified');
            const isMoved = types.includes('moved');
            const isExplicitMoved = explicitMovedIds.has(node.id) && explicitMovedIds.get(node.id) > Date.now();

            if (hasModified) {
                changeClass = 'tree-change-modified';
                statusIcon += '<span class="change-badge modified"><span class="badge-symbol">~</span></span>';
            }

            // 移动标记：检测到 moved 类型就显示，不仅限于显式拖动
            // isMoved 为 true 表示 detectTreeChangesFast 检测到了跨级移动
            if (isMoved) {
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
                    statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><span class="badge-symbol">>></span><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
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
        statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><span class="badge-symbol">>></span><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
    }

    // forceExpandSet 仅用于“包含变化”的提示点（灰点），不再用于覆盖懒加载。
    // 需求：即使是新增/删除/移动/修改相关的文件夹，也必须保持与普通文件夹一致的懒加载行为。
    const shouldForceExpand = forceExpandSet && forceExpandSet.has(node.id);
    const allowOverrideLazyStop = !!(options && options.forceExpandOverrideLazyStop === true);
    const shouldOverrideLazyStop = allowOverrideLazyStop && shouldForceExpand;
    const isLazyEnabledInContext = CANVAS_PERMANENT_TREE_LAZY_ENABLED;
    const isCurrentChangesView = currentView === 'current-changes';
    const preferPreviewAncestorBadges = !!(options && options.preferPreviewAncestorBadges === true);
    let canvasAncestorBadges = null;
    let previewAncestorBadges = null;
    try {
        if (window.__canvasPermanentAncestorBadges instanceof Map) {
            canvasAncestorBadges = window.__canvasPermanentAncestorBadges;
        }
        if (window.__changesPreviewAncestorBadges instanceof Map) {
            previewAncestorBadges = window.__changesPreviewAncestorBadges;
        }
    } catch (_) { }
    const resolvedAncestorBadgeMap = preferPreviewAncestorBadges
        ? (previewAncestorBadges || canvasAncestorBadges)
        : (isCurrentChangesView ? (canvasAncestorBadges || previewAncestorBadges) : previewAncestorBadges);
    const isLazyStop = !shouldOverrideLazyStop && isLazyEnabledInContext && isCurrentChangesView && level > 0;
    const hasOwnChange = !!(change || __isExplicitMovedOnlyFolder);
    let hasChangesHintBadge = false;
    const isDeletedFolder = !!(!node.url && node.children && changeTypeStr && changeTypeStr.split('+').includes('deleted'));

    // 并显示子树聚合徽标（+/-/~/>>）。
    //
    // 注意：聚合徽标来自 badgeMap，代表“子树中出现的变化类型”，不应被父节点自身的变化类型掩盖。
    // 例如：父=修改+移动，子树也有移动，仍应显示灰点 + 子树聚合移动标识。
    if (!underDeletedAncestor && level > 0 && isLazyEnabledInContext && isCurrentChangesView) {
        try {
            // 祖先聚合徽标
            const badgeMap = resolvedAncestorBadgeMap;

            const mask = badgeMap ? (badgeMap.get(String(node.id)) || 0) : 0;
            // Note: in this function the 5th param is historically used as the "hint set"
            // (ancestor path ids). Keep using it here to avoid adding a new parameter.
            const hintHasDescendants = !!(forceExpandSet && forceExpandSet.has && forceExpandSet.has(String(node.id)));
            const hasDescendants = !!(mask || hintHasDescendants);
            if (hasDescendants) {
                const title = currentLang === 'zh_CN' ? '此文件夹下有变化' : 'Contains changes';
                let pathBadges = `<span class="path-badges"><span class="path-dot" title="${escapeHtml(title)}">•</span>`;
                hasChangesHintBadge = true;

                // 子树聚合徽标：即使与父自身类型重复，也保留（避免“被掩盖”）
                if (mask) {
                    if (mask & 1) pathBadges += '<span class="path-symbol added" title="+">+</span>';
                    if (mask & 2) pathBadges += '<span class="path-symbol deleted" title="-">-</span>';
                    if (mask & 4) pathBadges += '<span class="path-symbol modified" title="~">~</span>';
                    if (mask & 8) pathBadges += '<span class="path-symbol moved" title=">>">>></span>';
                }
                pathBadges += '</span>';
                statusIcon += pathBadges;
            }
        } catch (_) { }
    }

    if (isLazyStop) {
        const childCount = Array.isArray(node.children) ? node.children.length : 0;
        const hasChildren = childCount > 0;
        return `
            <div class="tree-node">
                <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-type="folder" data-node-level="${level}" data-has-children="${hasChildren ? 'true' : 'false'}" data-children-loaded="${hasChildren ? 'false' : 'true'}" data-child-count="${childCount}" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
                    <span class="tree-toggle"><i class="fas fa-chevron-right"></i></span>
                    <i class="tree-icon fas fa-folder"></i>
                    <span class="tree-label">${escapeHtml(node.title)}</span>
                    <span class="change-badges">${statusIcon}</span>
                </div>
                <div class="tree-children"></div>
            </div>
        `;
    }

    // 若文件夹本身无变化，但其子树存在变化，追加灰色“指引”标识。
    // 因此这里只在“非懒加载上下文”下才允许 descendant scan。
    if (!underDeletedAncestor &&
        !hasChangesHintBadge &&
        !(isLazyEnabledInContext && isCurrentChangesView)) {
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
                const badgeMap = resolvedAncestorBadgeMap;
                const mask = badgeMap ? (badgeMap.get(String(node.id)) || 0) : 0;
                const title = currentLang === 'zh_CN' ? '此文件夹下有变化' : 'Contains changes';
                let pathBadges = `<span class="path-badges"><span class="path-dot" title="${escapeHtml(title)}">•</span>`;
                if (mask) {
                    if (mask & 1) pathBadges += '<span class="path-symbol added" title="+">+</span>';
                    if (mask & 2) pathBadges += '<span class="path-symbol deleted" title="-">-</span>';
                    if (mask & 4) pathBadges += '<span class="path-symbol modified" title="~">~</span>';
                    if (mask & 8) pathBadges += '<span class="path-symbol moved" title=">>">>></span>';
                }
                pathBadges += '</span>';
                statusIcon += pathBadges;
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

    // 保持删除标识在原位置显示：
    // rebuildTreeWithDeleted 已经按照旧树的顺序构建了children数组，
    // 删除的节点在数据层面不占位（不影响浏览器书签库），
    // 但在视觉层面保持原有位置
    const sortedChildren = children.slice().sort((a, b) => {
        const pa = originalPos.get(a?.id) ?? Number.POSITIVE_INFINITY;
        const pb = originalPos.get(b?.id) ?? Number.POSITIVE_INFINITY;
        return pa - pb;
    });

    const nextUnderDeletedAncestor = underDeletedAncestor || isDeletedFolder;

    return `
            <div class="tree-node">
                <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-type="folder" data-node-level="${level}" data-has-children="${Array.isArray(node.children) && node.children.length ? 'true' : 'false'}" data-children-loaded="true" data-child-count="${Array.isArray(node.children) ? node.children.length : 0}" data-node-index="${typeof node.index === 'number' ? node.index : ''}">
                    <span class="tree-toggle ${level === 0 ? 'expanded' : ''}"><i class="fas fa-chevron-right"></i></span>
                    <i class="tree-icon fas fa-folder${level === 0 ? '-open' : ''}"></i>
                    <span class="tree-label">${escapeHtml(node.title)}</span>
                    <span class="change-badges">${statusIcon}</span>
                </div>
                <div class="tree-children ${level === 0 ? 'expanded' : ''}">
                    ${sortedChildren.map(child => renderTreeNodeWithChanges(child, level + 1, maxDepth, visitedIds, forceExpandSet, options, nextUnderDeletedAncestor)).join('')}
                </div>
            </div>
        `;
}

// ===== 辅助函数：确保图例存在 =====
// 在增量更新时，如果图例不存在，则创建并插入到书签树顶部
function ensureTreeLegendExists(container) {
    if (!container) return;

    // 检查图例是否已存在
    const existingLegend = container.querySelector('.tree-legend');
    if (existingLegend) return; // 已存在，无需创建

    // 创建图例
    const legend = document.createElement('div');
    legend.className = 'tree-legend';
    const cursorStyle = 'cursor: pointer; user-select: none;';
    legend.innerHTML = `
        <span class="legend-item" data-change-type="added" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看新增项' : 'Click to view added items'}"><span class="legend-dot added"></span> ${currentLang === 'zh_CN' ? '新增' : 'Added'}</span>
        <span class="legend-item" data-change-type="deleted" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看删除项' : 'Click to view deleted items'}"><span class="legend-dot deleted"></span> ${currentLang === 'zh_CN' ? '删除' : 'Deleted'}</span>
        <span class="legend-item" data-change-type="moved" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看移动项' : 'Click to view moved items'}"><span class="legend-dot moved"></span> ${currentLang === 'zh_CN' ? '移动' : 'Moved'}</span>
        <span class="legend-item" data-change-type="modified" style="${cursorStyle}" title="${currentLang === 'zh_CN' ? '点击查看修改项' : 'Click to view modified items'}"><span class="legend-dot modified"></span> ${currentLang === 'zh_CN' ? '修改' : 'Modified'}</span>
    `;

    // 插入到容器顶部
    container.insertBefore(legend, container.firstChild);

    // 绑定点击事件
    setupLegendClickHandlers(container);

    console.log('[增量更新] 图例已创建');
}

// ===== 增量更新：创建 =====
async function applyIncrementalCreateToTree(id, bookmark) {
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    if (isReadOnlyBookmarkTreeContainer(container)) return;
    // 获取父节点 DOM
    const parentId = bookmark.parentId;
    const parentItem = parentId
        ? container.querySelector(`.tree-item[data-node-id="${CSS.escape(String(parentId))}"]`)
        : null;
    const parentTreeNode = parentItem ? parentItem.closest('.tree-node') : null;
    const parentNode = parentTreeNode ? parentTreeNode.querySelector(':scope > .tree-children') : null;
    const isCanvasLazyMode = currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED;

    if (!parentItem || !parentNode) {
        // 数据层面的快照刷新会保证用户后续展开时看到正确结果。
        if (isCanvasLazyMode) return;

        // 非懒加载模式：兜底全量渲染
        await renderTreeView(true);
        return;
    }
    // 生成新节点 HTML（添加绿色变更标记）
    const favicon = getFaviconUrl(bookmark.url || '');
    const labelColor = 'color: #28a745;'; // 绿色
    const labelFontWeight = 'font-weight: 500;';
    const html = `
        <div class="tree-node">
            <div class="tree-item tree-change-added" data-node-id="${id}" data-node-title="${escapeHtml(bookmark.title || '')}" data-node-url="${escapeHtml(bookmark.url || '')}" data-node-type="${bookmark.url ? 'bookmark' : 'folder'}">
                <span class="tree-toggle" style="opacity: 0"></span>
                ${bookmark.url ? (favicon ? `<img class="tree-icon" src="${favicon}" alt="">` : `<i class="tree-icon fas fa-bookmark"></i>`) : `<i class="tree-icon fas fa-folder"></i>`}
                ${bookmark.url ? `<a href="${escapeHtml(bookmark.url)}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer" style="${labelColor} ${labelFontWeight}">${escapeHtml(bookmark.title || '')}</a>` : `<span class="tree-label" style="${labelColor} ${labelFontWeight}">${escapeHtml(bookmark.title || '')}</span>`}
                <span class="change-badges"><span class="change-badge added"><span class="badge-symbol">+</span></span></span>
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

    }
    // 确保图例存在
    ensureTreeLegendExists(container);
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}

// ===== 增量更新：删除 =====
function applyIncrementalRemoveFromTree(id) {
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    if (isReadOnlyBookmarkTreeContainer(container)) return;
    const item = container.querySelector(`.tree-item[data-node-id="${id}"]`);
    if (!item) {
        // 这里不要触发全量重绘，否则在大量删除时会非常卡。
        const isCanvasLazyMode = currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED;
        if (!isCanvasLazyMode) {
            renderTreeView(true).catch(e => console.error(e));
        }
        return;
    }

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
        badges.innerHTML = '<span class="change-badge deleted"><span class="badge-symbol">-</span></span>';
    } else {
        item.insertAdjacentHTML('beforeend', '<span class="change-badges"><span class="change-badge deleted"><span class="badge-symbol">-</span></span></span>');
    }

    // 保持删除标识在原位显示，不自动移除节点
    // 用户可以通过"清理变动标识"功能来清除这些已删除的项目
    // 确保图例存在
    ensureTreeLegendExists(container);
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}

// ===== 增量更新：修改 =====
async function applyIncrementalChangeToTree(id, changeInfo) {
    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    if (isReadOnlyBookmarkTreeContainer(container)) return;
    const item = container.querySelector(`.tree-item[data-node-id="${id}"]`);
    if (!item) {
        const isCanvasLazyMode = currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED;
        if (!isCanvasLazyMode) {
            await renderTreeView(true);
        }
        return;
    }

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
        badges.insertAdjacentHTML('beforeend', '<span class="change-badge modified"><span class="badge-symbol">~</span></span>');
    }
    // 确保图例存在
    ensureTreeLegendExists(container);
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}

// ===== 增量更新：移动 =====
async function applyIncrementalMoveToTree(id, moveInfo) {
    console.log('[增量移动] 开始处理:', id, moveInfo);

    const permBody = document.querySelector('.permanent-section-body');
    const permScrollTop = permBody ? permBody.scrollTop : null;
    const container = document.getElementById('bookmarkTree');
    if (!container) return;
    if (isReadOnlyBookmarkTreeContainer(container)) return;
    const item = container.querySelector(`.tree-item[data-node-id="${id}"]`);
    if (!item) {
        // 大量移动/批量操作时如果这里触发全量重绘，会造成灾难级卡顿。
        // 数据层面会通过 scheduleCachedCurrentTreeSnapshotRefresh 刷新快照，用户展开时即可看到。
        const isCanvasLazyMode = currentView === 'current-changes' && CANVAS_PERMANENT_TREE_LAZY_ENABLED;
        if (!isCanvasLazyMode) {
            const isDragHandled = window.__dragMoveHandled && window.__dragMoveHandled.has(id);
            if (!isDragHandled) {
                renderTreeView(true).catch(e => console.error(e));
            }
        }
        return;
    }
    const node = item.closest('.tree-node');
    const oldParentItem = container.querySelector(`.tree-item[data-node-id="${moveInfo.oldParentId}"]`);
    const newParentItem = container.querySelector(`.tree-item[data-node-id="${moveInfo.parentId}"]`);
    const newParentChildren = newParentItem && newParentItem.nextElementSibling && newParentItem.nextElementSibling.classList.contains('tree-children')
        ? newParentItem.nextElementSibling : null;

    if (!newParentChildren) {
        // 如果找不到新父容器但节点有移动标记，说明即时更新已处理，只需添加徽标
        if (item.classList.contains('tree-change-moved')) {
            console.log('[增量移动] 节点已有移动标记，跳过DOM操作');
            if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
            return;
        }
        console.warn('[增量移动] 找不到新父容器，跳过');
        return;
    }

    // 关键修复：同一父级内的“排序移动”时，node 仍在 newParentChildren 里，但位置需要更新。
    // 之前的 alreadyInPlace 逻辑会直接跳过，导致移动后视觉不跟随（只能依赖全量 renderTreeView 修正）。
    if (!node) {
        console.warn('[增量移动] 找不到tree-node容器，跳过');
        return;
    }
    // 从旧位置移除并插入新父下（即使同父级也需要重排）
    try {
        if (node.parentNode) node.parentNode.removeChild(node);
    } catch (_) { /* ignore */ }

    // 按目标 index 插入更准确（忽略已删除的同级节点）
    const targetIndex = (moveInfo && typeof moveInfo.index === 'number') ? moveInfo.index : null;
    const siblingsAll = Array.from(newParentChildren.querySelectorAll(':scope > .tree-node'));
    const presentSiblings = siblingsAll.filter(n => !n.querySelector(':scope > .tree-item')?.classList.contains('tree-change-deleted'));

    if (targetIndex === null) {
        // 尽量插在第一个已删除节点之前
        const firstDeleted = siblingsAll.find(n => n.querySelector(':scope > .tree-item')?.classList.contains('tree-change-deleted'));
        if (firstDeleted) newParentChildren.insertBefore(node, firstDeleted);
        else newParentChildren.appendChild(node);
    } else {
        const safeIndex = Math.max(0, targetIndex);
        const anchor = presentSiblings[safeIndex] || null;
        if (anchor) newParentChildren.insertBefore(node, anchor);
        else {
            const firstDeleted = siblingsAll.find(n => n.querySelector(':scope > .tree-item')?.classList.contains('tree-change-deleted'));
            if (firstDeleted) newParentChildren.insertBefore(node, firstDeleted);
            else newParentChildren.appendChild(node);
        }
    }

    // 注意：缩进由 DOM 结构（.tree-children 的 margin-left）自动决定。
    // 这里不要给 .tree-node 设 padding-left，否则会导致“放手瞬间层级不对齐”的视觉问题。
    // 清理历史遗留的 padding-left（旧版本曾写入），避免刷新前后出现“对齐忽然变正常/又异常”的错觉。
    try {
        if (node && node.style) node.style.paddingLeft = '';
        // 仅清理确实带有 padding-left 的节点，避免无谓遍历
        node.querySelectorAll('.tree-node[style*="padding-left"]').forEach(n => {
            try { n.style.paddingLeft = ''; } catch (_) { }
        });
    } catch (_) { /* ignore */ }

    // 如果已经有移动标记（由即时更新处理），跳过徽标添加
    if (item.classList.contains('tree-change-moved') && item.querySelector('.change-badge.moved')) {
        console.log('[增量移动] 节点已有移动徽标，跳过');
        if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
        return;
    }

    // 关键：仅对这个被拖拽的节点标记为蓝色"moved"
    // 其他由于这次移动而位置改变的兄弟节点不标记，因为我们只标识用户直接操作的对象
    let badges = item.querySelector('.change-badges');
    if (!badges) {
        item.insertAdjacentHTML('beforeend', '<span class="change-badges"></span>');
        badges = item.querySelector('.change-badges');
    }
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
        badges.insertAdjacentHTML('beforeend', `<span class="change-badge moved" data-move-from="${escapeHtml(tip)}" title="${escapeHtml(tip)}"><span class="badge-symbol">>></span><span class="move-tooltip">${slashPathToChipsHTML(tip)}</span></span>`);
        item.classList.add('tree-change-moved');

        // 设置蓝色样式
        const labelLink = item.querySelector('.tree-bookmark-link');
        const labelSpan = item.querySelector('.tree-label');
        if (labelLink) {
            labelLink.style.setProperty('color', '#007bff', 'important');
            labelLink.style.setProperty('font-weight', '500', 'important');
        }
        if (labelSpan) {
            labelSpan.style.setProperty('color', '#007bff', 'important');
            labelSpan.style.setProperty('font-weight', '500', 'important');
        }
    }
    // 确保图例存在
    ensureTreeLegendExists(container);
    // 恢复滚动位置
    if (permBody && permScrollTop !== null) permBody.scrollTop = permScrollTop;
}



// =============================================================================
// 详情弹窗
// =============================================================================

function getRecordDetailMode(recordTime) {
    if (!recordTime) return historyDetailMode || 'simple';
    // 从统一存储对象中读取
    if (historyViewSettings && historyViewSettings.recordModes) {
        const mode = historyViewSettings.recordModes[String(recordTime)];
        if (mode) return mode;
    }
    return historyDetailMode || 'simple';
}

function setRecordDetailMode(recordTime, mode) {
    if (!recordTime || !mode) return;
    // 确保 historyViewSettings 已初始化
    if (!historyViewSettings) {
        historyViewSettings = { defaultMode: 'simple', recordModes: {}, recordExpandedStates: {} };
    }
    historyViewSettings.recordModes[String(recordTime)] = mode;
    // 异步保存（带防抖）
    saveHistoryViewSettings();
}

function hasRecordExpandedState(recordTime) {
    if (!recordTime) return false;
    if (historyViewSettings && historyViewSettings.recordExpandedStates) {
        return historyViewSettings.recordExpandedStates[String(recordTime)] != null;
    }
    return false;
}

function getRecordExpandedState(recordTime) {
    if (!recordTime) return new Set();
    if (historyViewSettings && historyViewSettings.recordExpandedStates) {
        const ids = historyViewSettings.recordExpandedStates[String(recordTime)];
        if (Array.isArray(ids)) {
            return new Set(ids.map(id => String(id)));
        }
    }
    return new Set();
}

function saveRecordExpandedState(recordTime, nodeId, isExpanded) {
    if (!recordTime || !nodeId) return;
    // 确保 historyViewSettings 已初始化
    if (!historyViewSettings) {
        historyViewSettings = { defaultMode: 'simple', recordModes: {}, recordExpandedStates: {} };
    }
    if (!historyViewSettings.recordExpandedStates) {
        historyViewSettings.recordExpandedStates = {};
    }

    const timeKey = String(recordTime);
    const currentIds = historyViewSettings.recordExpandedStates[timeKey] || [];
    const ids = new Set(Array.isArray(currentIds) ? currentIds.map(id => String(id)) : []);
    const idStr = String(nodeId);

    if (isExpanded) {
        ids.add(idStr);
    } else {
        ids.delete(idStr);
    }

    historyViewSettings.recordExpandedStates[timeKey] = Array.from(ids);
    saveHistoryViewSettings();
}

function captureRecordExpandedState(recordTime, treeContainer) {
    if (!recordTime || !treeContainer) return;
    if (!historyViewSettings) {
        historyViewSettings = { defaultMode: 'simple', recordModes: {}, recordExpandedStates: {} };
    }
    if (!historyViewSettings.recordExpandedStates) {
        historyViewSettings.recordExpandedStates = {};
    }

    const expandedIds = [];
    treeContainer.querySelectorAll('.tree-item[data-node-id]').forEach(item => {
        const nodeId = item.getAttribute('data-node-id');
        if (!nodeId) return;
        const treeNode = item.closest('.tree-node');
        const children = treeNode?.querySelector(':scope > .tree-children');
        if (children && children.classList.contains('expanded')) {
            expandedIds.push(String(nodeId));
        }
    });

    historyViewSettings.recordExpandedStates[String(recordTime)] = expandedIds;
    saveHistoryViewSettings();
}

function applyRecordExpandedState(recordTime, treeContainer) {
    if (!recordTime || !treeContainer) return;
    const expandedIds = getRecordExpandedState(recordTime);
    if (!expandedIds.size) return;

    // 重置所有展开状态
    treeContainer.querySelectorAll('.tree-children').forEach(children => {
        children.classList.remove('expanded');
    });
    treeContainer.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.classList.remove('expanded');
    });
    treeContainer.querySelectorAll('.tree-item[data-node-type="folder"] .tree-icon.fa-folder-open').forEach(icon => {
        icon.classList.remove('fa-folder-open');
        icon.classList.add('fa-folder');
    });

    const expandItem = (item) => {
        const treeNode = item?.closest('.tree-node');
        const children = treeNode?.querySelector(':scope > .tree-children');
        const toggle = item?.querySelector('.tree-toggle:not([style*="opacity: 0"])');
        if (children && toggle) {
            children.classList.add('expanded');
            toggle.classList.add('expanded');
            const folderIcon = item.querySelector('.tree-icon.fa-folder, .tree-icon.fa-folder-open');
            if (folderIcon) {
                folderIcon.classList.remove('fa-folder');
                folderIcon.classList.add('fa-folder-open');
            }
        }
    };

    const expandParents = (item) => {
        let parent = item?.closest('.tree-children');
        while (parent) {
            parent.classList.add('expanded');
            const parentItem = parent.previousElementSibling;
            if (parentItem && parentItem.classList.contains('tree-item')) {
                const parentToggle = parentItem.querySelector('.tree-toggle');
                if (parentToggle) parentToggle.classList.add('expanded');
                const parentIcon = parentItem.querySelector('.tree-icon.fa-folder, .tree-icon.fa-folder-open');
                if (parentIcon) {
                    parentIcon.classList.remove('fa-folder');
                    parentIcon.classList.add('fa-folder-open');
                }
            }
            parent = parent.parentElement ? parent.parentElement.closest('.tree-children') : null;
        }
    };

    treeContainer.querySelectorAll('.tree-item[data-node-id]').forEach(item => {
        const nodeId = item.getAttribute('data-node-id');
        if (!nodeId || !expandedIds.has(String(nodeId))) return;
        expandParents(item);
        expandItem(item);
    });

    // Detailed modal uses lazy child rendering; when restoring expanded state we must rebuild children DOM
    // for the expanded folders, otherwise the UI (and WYSIWYG export) won't match the saved state.
    try {
        const ctx = (window.__historyTreeLazyContexts instanceof Map)
            ? window.__historyTreeLazyContexts.get(String(recordTime))
            : null;
        if (ctx && typeof ctx.renderChildren === 'function') {
            const remaining = new Set(Array.from(expandedIds).map(String));
            for (let pass = 0; pass < 8 && remaining.size; pass++) {
                let progressed = false;
                for (const id of Array.from(remaining)) {
                    const item = treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(String(id))}"]`);
                    if (!item) continue;
                    const treeNode = item.closest('.tree-node');
                    const children = treeNode?.querySelector(':scope > .tree-children');
                    if (!children) {
                        remaining.delete(id);
                        continue;
                    }
                    if (children.dataset && children.dataset.childrenLoaded === 'false') {
                        const html = ctx.renderChildren(
                            item.dataset.nodeId,
                            children.dataset.childLevel,
                            children.dataset.nextForceInclude
                        );
                        children.innerHTML = html;
                        children.dataset.childrenLoaded = 'true';
                        progressed = true;
                    }
                    remaining.delete(id);
                }
                if (!progressed) break;
            }
        }
    } catch (_) { /* ignore */ }
}

function updateDetailModalToggleUI(mode) {
    const simpleBtn = document.getElementById('historyDetailModeSimpleModal');
    const detailedBtn = document.getElementById('historyDetailModeDetailedModal');
    if (!simpleBtn || !detailedBtn) return;

    if (mode === 'detailed') {
        simpleBtn.classList.remove('active');
        detailedBtn.classList.add('active');
    } else {
        simpleBtn.classList.add('active');
        detailedBtn.classList.remove('active');
    }
}


function updateHistoryListItemMode(recordTime, mode) {
    const item = document.querySelector(`.commit-item[data-record-time="${recordTime}"]`);
    if (!item) return;

    const tooltip = item.querySelector('.action-btn.detail-btn .btn-tooltip');
    if (!tooltip) return;
    tooltip.textContent = mode === 'simple'
        ? (currentLang === 'zh_CN' ? '简略' : 'Simple')
        : (currentLang === 'zh_CN' ? '详细' : 'Detailed');
}

function initDetailModalActions() {
    const simpleBtn = document.getElementById('historyDetailModeSimpleModal');
    const detailedBtn = document.getElementById('historyDetailModeDetailedModal');
    const exportBtn = document.getElementById('detailExportChangesBtn');

    if (simpleBtn && !simpleBtn.hasAttribute('data-listener-attached')) {
        simpleBtn.addEventListener('click', () => {
            if (!currentDetailRecordTime) return;
            if (currentDetailRecordMode === 'simple') return;
            currentDetailRecordMode = 'simple';
            setRecordDetailMode(currentDetailRecordTime, 'simple');
            updateDetailModalToggleUI('simple');
            updateHistoryListItemMode(currentDetailRecordTime, 'simple');
            if (currentDetailRecord) renderDetailModalContent(currentDetailRecord, 'simple');
        });
        simpleBtn.setAttribute('data-listener-attached', 'true');
    }

    if (detailedBtn && !detailedBtn.hasAttribute('data-listener-attached')) {
        detailedBtn.addEventListener('click', () => {
            if (!currentDetailRecordTime) return;
            if (currentDetailRecordMode === 'detailed') return;
            currentDetailRecordMode = 'detailed';
            setRecordDetailMode(currentDetailRecordTime, 'detailed');
            updateDetailModalToggleUI('detailed');
            updateHistoryListItemMode(currentDetailRecordTime, 'detailed');
            if (currentDetailRecord) renderDetailModalContent(currentDetailRecord, 'detailed');
        });
        detailedBtn.setAttribute('data-listener-attached', 'true');
    }

    if (exportBtn && !exportBtn.hasAttribute('data-listener-attached')) {
        exportBtn.addEventListener('click', () => {
            if (!currentDetailRecord) return;
            const treeContainer = document.querySelector('#modalBody .history-tree-container');
            showHistoryExportChangesModal(currentDetailRecord.time, {
                preferredMode: currentDetailRecordMode || getRecordDetailMode(currentDetailRecord.time),
                useDomTreeContainer: true,
                treeContainer
            });
        });
        exportBtn.setAttribute('data-listener-attached', 'true');
    }
}

// Pending UI action: open Phase 2.5 detail search UI after modal content renders.
let pendingOpenDetailSearch = null; // { recordTime: string }

function renderDetailModalContent(record, mode) {
    const body = document.getElementById('modalBody');
    if (!body) return;

    body.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;

    generateDetailContent(record, mode).then(html => {
        body.innerHTML = html;

        setTimeout(() => {
            initDetailModalActions();
            updateDetailModalToggleUI(mode);
            const treeContainer = body.querySelector('.history-tree-container');
            if (treeContainer) {
                if (mode === 'detailed') {
                    if (hasRecordExpandedState(record.time)) {
                        applyRecordExpandedState(record.time, treeContainer);
                    }
                }

                treeContainer.addEventListener('click', (e) => {
                    const treeItem = e.target.closest('.tree-item');
                    if (!treeItem) return;

                    // 允许链接点击
                    if (e.target.closest('a')) return;

                    // 展开/折叠
                    const treeNode = treeItem.closest('.tree-node');
                    const children = treeNode?.querySelector('.tree-children');
                    const toggle = treeItem.querySelector('.tree-toggle:not([style*="opacity: 0"])');

                    if (children && toggle) {
                        const isExpanding = !children.classList.contains('expanded');
                        toggle.classList.toggle('expanded');
                        children.classList.toggle('expanded');

                        // 更新文件夹图标
                        const folderIcon = treeItem.querySelector('.tree-icon.fa-folder, .tree-icon.fa-folder-open');
                        if (folderIcon) {
                            if (isExpanding) {
                                folderIcon.classList.remove('fa-folder');
                                folderIcon.classList.add('fa-folder-open');
                            } else {
                                folderIcon.classList.remove('fa-folder-open');
                                folderIcon.classList.add('fa-folder');
                            }
                        }

                        if (mode === 'detailed') {
                            const nodeId = treeItem.getAttribute('data-node-id');
                            if (nodeId) saveRecordExpandedState(record.time, nodeId, isExpanding);
                        }

                        // Lazy render: only build children DOM when the folder is actually expanded.
                        try {
                            if (isExpanding &&
                                children.dataset &&
                                children.dataset.childrenLoaded === 'false' &&
                                treeItem.dataset &&
                                treeItem.dataset.nodeId) {
                                const ctx = window.__historyTreeLazyContexts instanceof Map
                                    ? window.__historyTreeLazyContexts.get(String(record.time))
                                    : null;
                                if (ctx && typeof ctx.renderChildren === 'function') {
                                    const html = ctx.renderChildren(
                                        treeItem.dataset.nodeId,
                                        children.dataset.childLevel,
                                        children.dataset.nextForceInclude
                                    );
                                    children.innerHTML = html;
                                    children.dataset.childrenLoaded = 'true';
                                }
                            }
                        } catch (_) { /* ignore */ }
                    }
                });
            }

            // Backup history detail: allow clicking the legend dots to highlight corresponding nodes in the tree.
            const legend = body.querySelector('.detail-section-title-with-legend .detail-title-legend');
            if (legend && treeContainer) {
                legend.querySelectorAll('.legend-item[data-change-type]').forEach(item => {
                    if (item.hasAttribute('data-listener-attached')) return;
                    item.style.cursor = 'pointer';
                    item.addEventListener('click', () => {
                        const changeType = item.getAttribute('data-change-type');
                        if (!changeType) return;
                        highlightTreeNodesByChangeTypeInContainer(changeType, treeContainer);
                    });
                    item.setAttribute('data-listener-attached', 'true');
                });
            }

            // 兼容旧的 hunk 折叠事件监听
            body.querySelectorAll('.diff-hunk-header.collapsible').forEach(header => {
                const hunkId = header.getAttribute('data-hunk-id');
                if (hunkId) {
                    header.addEventListener('click', function () {
                        toggleHunk(hunkId);
                    });
                }
            });

            body.querySelectorAll('.commit-note-edit-btn').forEach(btn => {
                if (btn.hasAttribute('data-listener-attached')) return;
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    await editCommitNote(record.time);
                    const updatedRecord = syncHistory.find(r => r.time === record.time);
                    if (updatedRecord) {
                        currentDetailRecord = updatedRecord;
                        renderDetailModalContent(updatedRecord, currentDetailRecordMode || getRecordDetailMode(record.time));
                    }
                });
                btn.setAttribute('data-listener-attached', 'true');
            });

            // ==================== Phase 2.5: 初始化历史详情搜索 ====================
            const modalContent = body.closest('.modal-content');
            const searchBtn = body.querySelector('#detailSearchChangesBtn');
            const searchContainer = body.querySelector('#detailSearchContainer');

            if (searchBtn && searchContainer && modalContent) {
                // 绑定搜索按钮点击事件
                searchBtn.addEventListener('click', () => {
                    const isVisible = searchContainer.classList.contains('visible');
                    if (isVisible) {
                        searchContainer.classList.remove('visible');
                        searchBtn.classList.remove('active');
                        // 隐藏搜索结果面板
                        const resultsPanel = searchContainer.querySelector('.detail-search-results-panel');
                        if (resultsPanel) resultsPanel.classList.remove('visible');
                    } else {
                        searchContainer.classList.add('visible');
                        searchBtn.classList.add('active');
                        // 聚焦到搜索输入框
                        const searchInput = searchContainer.querySelector('.detail-search-input');
                        if (searchInput) {
                            setTimeout(() => searchInput.focus(), 100);
                        }
                    }
                });

                // 异步初始化搜索（需要 changeMap）
                (async () => {
                    try {
                        // 获取变化数据（与 generateTreeBasedChanges 相同的逻辑）
                        if (!record.bookmarkTree && (record.hasData || record.status === 'success')) {
                            try {
                                const tree = await getBackupDataLazy(record.time);
                                if (tree) record.bookmarkTree = tree;
                            } catch (_) { }
                        }
                        if (!record.bookmarkTree) {
                            console.log('[Search] Phase 2.5: No bookmarkTree in record');
                            searchBtn.style.display = 'none';
                            return;
                        }

                        // 找到上一条记录
                        const recordIndex = syncHistory.findIndex(r => r.time === record.time);
                        let previousRecord = null;
                        if (recordIndex > 0) {
                            for (let i = recordIndex - 1; i >= 0; i--) {
                                if (syncHistory[i].status === 'success' && (syncHistory[i].bookmarkTree || syncHistory[i].hasData)) {
                                    previousRecord = syncHistory[i];
                                    break;
                                }
                            }
                        }

                        // 如果没有上一条记录，尝试从缓存获取
                        if (!previousRecord && recordIndex === 0) {
                            try {
                                const cachedData = await new Promise(resolve => {
                                    browserAPI.storage.local.get('cachedRecordAfterClear', result => {
                                        resolve(result.cachedRecordAfterClear);
                                    });
                                });
                                if (cachedData && cachedData.bookmarkTree) {
                                    previousRecord = cachedData;
                                }
                            } catch (e) { }
                        }

                        // 计算变化
                        let changeMap = new Map();
                        if (previousRecord && !previousRecord.bookmarkTree && (previousRecord.hasData || previousRecord.status === 'success')) {
                            try {
                                const prevTree = await getBackupDataLazy(previousRecord.time);
                                if (prevTree) previousRecord.bookmarkTree = prevTree;
                            } catch (_) { }
                        }
                        if (previousRecord && previousRecord.bookmarkTree) {
                            changeMap = await detectTreeChangesFast(previousRecord.bookmarkTree, record.bookmarkTree, {
                                useGlobalExplicitMovedIds: false,
                                explicitMovedIdSet: (record.bookmarkStats && Array.isArray(record.bookmarkStats.explicitMovedIds))
                                    ? record.bookmarkStats.explicitMovedIds
                                    : null
                            });
                        } else if (record.isFirstBackup) {
                            // 首次备份：全部是新增
                            const allNodes = flattenBookmarkTree(record.bookmarkTree);
                            allNodes.forEach(item => {
                                if (item.id) changeMap.set(item.id, { type: 'added' });
                            });
                        }

                        // 检查是否有变化可搜索
                        if (changeMap.size === 0) {
                            console.log('[Search] Phase 2.5: No changes to search');
                            searchBtn.style.display = 'none';
                            return;
                        }

                        // 初始化搜索模块
                        if (typeof initHistoryDetailSearch === 'function') {
                            initHistoryDetailSearch(
                                record,
                                changeMap,
                                record.bookmarkTree,
                                previousRecord ? previousRecord.bookmarkTree : null,
                                modalContent
                            );
                        }
                    } catch (e) {
                        console.error('[Search] Phase 2.5 init error:', e);
                        searchBtn.style.display = 'none';
                    }
                })();
            }

            // If requested, open the search UI immediately after the content is ready.
            try {
                if (pendingOpenDetailSearch && String(record.time) === pendingOpenDetailSearch.recordTime) {
                    const btn = body.querySelector('#detailSearchChangesBtn');
                    const containerEl = body.querySelector('#detailSearchContainer');
                    if (btn && containerEl) {
                        containerEl.classList.add('visible');
                        btn.classList.add('active');
                        const input = containerEl.querySelector('.detail-search-input');
                        if (input) setTimeout(() => input.focus(), 0);
                    }
                    pendingOpenDetailSearch = null;
                }
            } catch (_) { }
        }, 0);
    }).catch(error => {
        console.error('[详情弹窗] 生成失败:', error);
        body.innerHTML = `<div class="detail-empty"><i class="fas fa-exclamation-circle"></i>加载失败: ${escapeHtml(error && error.message ? error.message : String(error))}</div>`;
    });
}

function showDetailModal(record, options = {}) {
    const modal = document.getElementById('detailModal');

    // Allow opening the embedded search UI directly from list items.
    try {
        if (options && options.openDetailSearch) {
            pendingOpenDetailSearch = { recordTime: String(record.time) };
        } else {
            pendingOpenDetailSearch = null;
        }
    } catch (_) { }

    // 保存当前打开的记录时间，用于关闭时滚动
    currentDetailRecordTime = record.time;
    currentDetailRecord = record;
    currentDetailRecordMode = getRecordDetailMode(record.time);

    updateDetailModalToggleUI(currentDetailRecordMode);

    const exportBtn = document.getElementById('detailExportChangesBtn');
    if (exportBtn) {
        exportBtn.title = currentLang === 'zh_CN' ? '导出变化' : 'Export Changes';
    }

    modal.classList.add('show');

    renderDetailModalContent(record, currentDetailRecordMode);
}

function closeModal() {
    // ==================== Phase 2.5: 清理历史详情搜索 ====================
    const modalContent = document.querySelector('#detailModal .modal-content');
    if (typeof cleanupHistoryDetailSearch === 'function') {
        cleanupHistoryDetailSearch(currentDetailRecordTime, modalContent);
    }

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
            currentDetailRecord = null;
            currentDetailRecordMode = null;
        }, 100);
    }
}

// =============================================================================
// 备份历史详情模式切换
// =============================================================================

// 初始化备份历史详情模式切换按钮
function initHistoryDetailModeToggle() {
    const simpleBtn = document.getElementById('historyDetailModeSimple');
    const detailedBtn = document.getElementById('historyDetailModeDetailed');

    if (!simpleBtn || !detailedBtn) return;

    // 恢复保存的模式状态
    if (historyDetailMode === 'detailed') {
        simpleBtn.classList.remove('active');
        detailedBtn.classList.add('active');
    } else {
        simpleBtn.classList.add('active');
        detailedBtn.classList.remove('active');
    }

    // 点击事件
    simpleBtn.addEventListener('click', () => {
        if (historyDetailMode === 'simple') return;
        historyDetailMode = 'simple';
        if (historyViewSettings) {
            historyViewSettings.defaultMode = 'simple';
            saveHistoryViewSettings();
        }
        simpleBtn.classList.add('active');
        detailedBtn.classList.remove('active');
        // 全局覆盖：同步更新每条记录的持久化模式
        try {
            (syncHistory || []).forEach(r => setRecordDetailMode(r?.time, 'simple'));
        } catch (_) { }
        // 立即刷新列表（未保存单条模式的记录会跟随全局模式）
        try { renderHistoryView(); } catch (_) { }
    });

    detailedBtn.addEventListener('click', () => {
        if (historyDetailMode === 'detailed') return;
        historyDetailMode = 'detailed';
        if (historyViewSettings) {
            historyViewSettings.defaultMode = 'detailed';
            saveHistoryViewSettings();
        }
        detailedBtn.classList.add('active');
        simpleBtn.classList.remove('active');
        // 全局覆盖：同步更新每条记录的持久化模式
        try {
            (syncHistory || []).forEach(r => setRecordDetailMode(r?.time, 'detailed'));
        } catch (_) { }
        // 立即刷新列表（未保存单条模式的记录会跟随全局模式）
        try { renderHistoryView(); } catch (_) { }
    });
}

// 生成详情内容（异步）
async function generateDetailContent(record, mode) {
    const stats = record.bookmarkStats || {};
    const detailMode = mode || getRecordDetailMode(record.time);

    let html = '';

    const seqMap = buildSequenceMapFromHistory(syncHistory);
    const seqNumber = seqMap.get(String(record.time));
    const seqText = Number.isFinite(seqNumber) ? String(seqNumber) : '-';

    const noteText = (record.note && record.note.trim())
        ? record.note
        : (currentLang === 'zh_CN' ? '（无备注）' : '(No note)');
    html += `
        <div class="detail-section">
            <div class="detail-note-row">
                <span class="commit-seq-badge" title="${currentLang === 'zh_CN' ? '序号' : 'No.'}">${seqText}</span>
                <span class="detail-note-label">${currentLang === 'zh_CN' ? '备注：' : 'Note:'}</span>
                <span class="detail-note-text-wrapper">
                    <span class="detail-note-text">${escapeHtml(noteText)}</span>
                    <button class="commit-note-edit-btn detail-note-edit-btn" data-time="${record.time}" title="${currentLang === 'zh_CN' ? '编辑备注' : 'Edit Note'}">
                        <i class="fas fa-edit"></i>
                    </button>
                </span>
                <div class="detail-actions-right">
                    <button id="detailSearchChangesBtn" class="detail-search-btn" title="${currentLang === 'zh_CN' ? '搜索变化' : 'Search Changes'}">
                        <i class="fas fa-search"></i>
                    </button>
                    <button id="detailExportChangesBtn" class="action-btn compact" title="${currentLang === 'zh_CN' ? '导出变化' : 'Export Changes'}">
                        <i class="fas fa-file-export"></i>
                    </button>
                    <div class="toggle-btn-group" id="historyDetailModeToggleModal">
                        <button id="historyDetailModeSimpleModal" class="toggle-btn ${detailMode === 'simple' ? 'active' : ''}" data-mode="simple" title="${currentLang === 'zh_CN' ? '简略模式' : 'Simple mode'}">
                            <svg class="icon-compact" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="4" y1="9" x2="20" y2="9" />
                                <line x1="4" y1="15" x2="20" y2="15" />
                                <circle cx="2" cy="9" r="1.5" fill="currentColor" stroke="none" />
                                <circle cx="2" cy="15" r="1.5" fill="currentColor" stroke="none" />
                            </svg>
                            <span id="historyDetailModeSimpleModalText">${currentLang === 'zh_CN' ? '简略' : 'Simple'}</span>
                        </button>
                        <button id="historyDetailModeDetailedModal" class="toggle-btn ${detailMode === 'detailed' ? 'active' : ''}" data-mode="detailed" title="${currentLang === 'zh_CN' ? '详细模式' : 'Detailed mode'}">
                            <svg class="icon-detail" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="4" y1="10" x2="20" y2="10" />
                                <line x1="4" y1="14" x2="20" y2="14" />
                                <line x1="4" y1="18" x2="20" y2="18" />
                            </svg>
                            <span id="historyDetailModeDetailedModalText">${currentLang === 'zh_CN' ? '详细' : 'Detailed'}</span>
                        </button>
                    </div>
                </div>
            </div>
            <!-- Phase 2.5: 搜索容器 -->
            <div class="detail-search-container" id="detailSearchContainer">
                <div class="detail-search-input-wrapper">
                    <i class="fas fa-search search-icon"></i>
                    <input type="text" class="detail-search-input" id="detailSearchInput" placeholder="${currentLang === 'zh_CN' ? '搜索书签/文件夹变化...' : 'Search bookmark/folder changes...'}">
                </div>
                <div class="detail-search-results-panel" id="detailSearchResultsPanel">
                    <!-- 搜索结果将动态填充 -->
                </div>
            </div>
        </div>
    `;

    // 尝试获取详细变化 - 使用树形视图
    try {
        const treeHtml = await generateTreeBasedChanges(record, detailMode);
        if (treeHtml) {
            html += treeHtml;
        } else {
            html += `
                <div class="detail-section">
                    <div class="detail-empty">
                        <i class="fas fa-info-circle"></i>
                        ${currentLang === 'zh_CN'
                    ? '无详细变化记录（该记录可能来自旧版本）'
                    : 'No detailed changes available (this record may be from an older version)'}
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

/**
 * 惰性加载备份数据
 * @param {string|number} recordTime 
 * @returns {Promise<Object>} bookmarkTree
 */
async function getBackupDataLazy(recordTime) {
    return new Promise(resolve => {
        browserAPI.runtime.sendMessage({
            action: 'getBackupData',
            time: recordTime
        }, response => {
            if (response && response.success) {
                resolve(response.bookmarkTree);
            } else {
                console.warn('[getBackupDataLazy] Failed or data missing:', response?.error);
                resolve(null);
            }
        });
    });
}

async function ensureRecordBookmarkTree(record) {
    if (!record) return null;
    if (record.bookmarkTree) return record.bookmarkTree;
    if (!(record.hasData || record.status === 'success')) return null;
    const tree = await getBackupDataLazy(record.time);
    if (tree) record.bookmarkTree = tree;
    return record.bookmarkTree || null;
}

async function getPreviousHistoryRecordMeta(recordTime) {
    return await new Promise((resolve) => {
        browserAPI.runtime.sendMessage({ action: 'getPreviousHistoryRecord', time: recordTime }, (response) => {
            if (browserAPI.runtime.lastError || !response || !response.success) {
                resolve(null);
                return;
            }

            resolve(response.record || null);
        });
    });
}

// 生成树形视图的变化详情
async function generateTreeBasedChanges(record, mode) {
    console.log('[树形视图] ========== 开始生成详细变化 ==========');
    console.log('[树形视图] 记录时间:', record.time);
    console.log('[树形视图] 显示模式:', mode);

    const cachedDetail = getDetailChangeCache(record.time, mode);
    if (cachedDetail && cachedDetail.treeToRender && cachedDetail.changeMap instanceof Map) {
        if (cachedDetail.changeMap.size === 0) {
            return `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-check-circle"></i>
                    ${currentLang === 'zh_CN' ? '无变化' : 'No changes'}
                </div>
            </div>
        `;
        }

        return generateHistoryTreeHtml(cachedDetail.treeToRender, cachedDetail.changeMap, mode, record.time);
    }

    // Split storage：按需加载 bookmarkTree
    await ensureRecordBookmarkTree(record);

    // 检查当前记录是否有 bookmarkTree
    if (!record.bookmarkTree) {
        console.log('[树形视图] ❌ 当前记录没有 bookmarkTree（可能是旧记录或保存失败）');
        return null;
    }

    // 找到上一条记录进行对比
    const recordIndex = syncHistory.findIndex(r => String(r.time) === String(record.time));
    console.log('[树形视图] 记录索引:', recordIndex);

    // 分页模式下，当前页不一定包含“上一条记录”，优先走 background 的全量索引定位。
    let previousRecord = null;
    try {
        previousRecord = await getPreviousHistoryRecordMeta(record.time);
    } catch (_) {
        previousRecord = null;
    }

    // 回退：兼容旧行为（当后台接口不可用时）
    if (!previousRecord && recordIndex > 0) {
        for (let i = recordIndex - 1; i >= 0; i--) {
            if (syncHistory[i].status === 'success' && (syncHistory[i].bookmarkTree || syncHistory[i].hasData)) {
                previousRecord = syncHistory[i];
                break;
            }
        }
    }

    // 如果找不到上一条记录，尝试从 cachedRecordAfterClear 获取（清空历史后的第一条记录）
    if (!previousRecord) {
        try {
            const cachedData = await new Promise(resolve => {
                browserAPI.storage.local.get('cachedRecordAfterClear', result => {
                    resolve(result.cachedRecordAfterClear);
                });
            });
            if (cachedData && cachedData.bookmarkTree) {
                console.log('[树形视图] 使用 cachedRecordAfterClear 作为对比基准');
                previousRecord = cachedData;
            }
        } catch (e) {
            console.warn('[树形视图] 获取 cachedRecordAfterClear 失败:', e);
        }
    }

    // 使用与「当前变化」相同的 detectTreeChangesFast 函数计算变化
    let changeMap = new Map();
    let treeToRender = record.bookmarkTree;

    // Split storage：上一条记录如果没有 bookmarkTree，也需要按需加载
    if (previousRecord && !previousRecord.bookmarkTree && (previousRecord.hasData || previousRecord.status === 'success')) {
        try {
            const prevTree = await getBackupDataLazy(previousRecord.time);
            if (prevTree) previousRecord.bookmarkTree = prevTree;
        } catch (e) {
            console.warn('[树形视图] 按需加载上一条 bookmarkTree 失败:', e);
        }
    }

    if (previousRecord && previousRecord.bookmarkTree) {
        console.log('[树形视图] 找到上一条记录:', previousRecord.time);
        changeMap = await detectTreeChangesFast(previousRecord.bookmarkTree, record.bookmarkTree, {
            useGlobalExplicitMovedIds: false,
            explicitMovedIdSet: (record && record.bookmarkStats && Array.isArray(record.bookmarkStats.explicitMovedIds))
                ? record.bookmarkStats.explicitMovedIds
                : null
        });

        // 关键：如果有删除的节点，需要重建树结构（与"当前变化"一致）
        let hasDeleted = false;
        for (const [, change] of changeMap) {
            if (change.type && change.type.includes('deleted')) {
                hasDeleted = true;
                break;
            }
        }
        if (hasDeleted) {
            try {
                treeToRender = rebuildTreeWithDeleted(previousRecord.bookmarkTree, record.bookmarkTree, changeMap);
                console.log('[树形视图] 已重建包含删除节点的树');
            } catch (error) {
                console.error('[树形视图] 重建树失败:', error);
                treeToRender = record.bookmarkTree;
            }
        }
    } else if (record.isFirstBackup) {
        console.log('[树形视图] 第一次备份，所有书签都是新增');
        // 第一次备份，所有书签都是新增
        const allNodes = flattenBookmarkTree(record.bookmarkTree);
        allNodes.forEach(item => {
            if (item.id) changeMap.set(item.id, { type: 'added' });
        });
    } else {
        // 例如：用户清空了备份历史后，这条记录变成"第一条记录"，但它并不是"首次备份"，也没有缓存可对比
        return `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-info-circle"></i>
                    ${currentLang === 'zh_CN'
                ? '无法计算变化：缺少上一条可对比的备份记录（上一条记录可能来自旧版本，或你刚清空了备份历史）'
                : 'Cannot compute changes: no previous backup record to compare (the previous record may be from an older version, or you may have just cleared the backup history).'}
                </div>
            </div>
        `;
    }

    console.log('[树形视图] 变化统计: changeMap.size =', changeMap.size);

    setDetailChangeCache(record.time, mode, {
        treeToRender,
        changeMap
    });

    if (changeMap.size === 0) {
        return `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-check-circle"></i>
                    ${currentLang === 'zh_CN' ? '无变化' : 'No changes'}
                </div>
            </div>
        `;
    }

    // 生成树形 HTML（使用重建后的树）
    return generateHistoryTreeHtml(treeToRender, changeMap, mode, record.time);
}

// 计算两个书签树之间的变化
function computeBookmarkChanges(oldTree, newTree) {
    const oldMap = buildBookmarkMap(oldTree);
    const newMap = buildBookmarkMap(newTree);

    const added = [];
    const deleted = [];
    const modified = [];
    const moved = [];

    // 检测新增和修改/移动
    for (const [id, newItem] of newMap) {
        const oldItem = oldMap.get(id);
        if (!oldItem) {
            // 新增
            added.push(newItem);
        } else {
            // 检测修改
            if (oldItem.title !== newItem.title || oldItem.url !== newItem.url) {
                modified.push({ ...newItem, oldTitle: oldItem.title, oldUrl: oldItem.url });
            }
            // 检测移动
            if (oldItem.parentId !== newItem.parentId || oldItem.index !== newItem.index) {
                moved.push({ ...newItem, oldParentId: oldItem.parentId, oldIndex: oldItem.index });
            }
        }
    }

    // 检测删除
    for (const [id, oldItem] of oldMap) {
        if (!newMap.has(id)) {
            deleted.push(oldItem);
        }
    }

    return { added, deleted, modified, moved };
}

// 构建书签ID映射
function buildBookmarkMap(tree, map = new Map(), parentId = '0') {
    if (!tree) return map;

    const nodes = Array.isArray(tree) ? tree : [tree];
    nodes.forEach((node, index) => {
        if (node.id) {
            map.set(node.id, {
                id: node.id,
                title: node.title || '',
                url: node.url || '',
                parentId: parentId,
                index: node.index !== undefined ? node.index : index,
                isFolder: !node.url && node.children
            });
        }
        if (node.children) {
            buildBookmarkMap(node.children, map, node.id);
        }
    });

    return map;
}

// 展平书签树为数组
function flattenBookmarkTree(tree, result = []) {
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
            flattenBookmarkTree(node.children, result);
        }
    });

    return result;
}

// 生成备份历史的树形 HTML（与"当前变化"视图保持一致的结构）
// changeMap: Map<id, {type: 'added'|'deleted'|'modified'|'moved'|'modified+moved', moved?: {...}}>
function generateHistoryTreeHtml(bookmarkTree, changeMap, mode, recordOrOptions) {
    const isZh = currentLang === 'zh_CN';
    const hasOptions = recordOrOptions && typeof recordOrOptions === 'object' && !Array.isArray(recordOrOptions);
    const options = hasOptions ? recordOrOptions : {};
    const recordTimeKey = options.recordTime != null
        ? String(options.recordTime)
        : (!hasOptions && recordOrOptions != null ? String(recordOrOptions) : '');
    const lazyKey = options.lazyKey != null ? String(options.lazyKey) : recordTimeKey;
    const lazyDepth = Number.isFinite(options.lazyDepth) ? Number(options.lazyDepth) : null;
    const expandDepth = Number.isFinite(options.expandDepth)
        ? Number(options.expandDepth)
        : (Number.isFinite(options.maxDepth) ? Number(options.maxDepth) : null);
    const customTitle = typeof options.customTitle === 'string' ? options.customTitle : '';
    const customLabel = typeof options.customLabel === 'string' ? options.customLabel : null;
    const hideLegend = options.hideLegend === true;
    const hideModeLabel = options.hideModeLabel === true;

    // Backup history tree lazy context (per record).
    // This lets us lazily render children only when a folder is expanded.
    try {
        if (!window.__historyTreeLazyContexts) window.__historyTreeLazyContexts = new Map();
    } catch (_) { /* ignore */ }

    // 为“路径上的灰点/聚合徽标”构建祖先映射（与 Current Changes / 永久栏目一致）
    // - hintSet: Set<folderId> 需要显示灰点（此文件夹下有变化）
    // - ancestorBadgeMask: Map<folderId, bitmask> 1=added,2=deleted,4=modified,8=moved
    const { hintSet, ancestorBadgeMask, parentById } = (() => {
        const hint = new Set();
        const maskMap = new Map();
        const parentById = new Map();

        const roots = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
        const stack = [];
        for (const r of roots) {
            if (!r) continue;
            stack.push({ node: r, parentId: '' });
        }

        while (stack.length) {
            const { node, parentId } = stack.pop();
            if (!node || node.id == null) continue;
            parentById.set(String(node.id), parentId);
            if (Array.isArray(node.children) && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i], parentId: String(node.id) });
                }
            }
        }

        const addMask = (folderId, mask) => {
            if (!folderId) return;
            const sid = String(folderId);
            const prev = maskMap.get(sid) || 0;
            maskMap.set(sid, prev | mask);
        };

        const bubbleUp = (startId, mask) => {
            let cur = String(startId);
            let guard = 0;
            while (guard++ < 512) {
                const parentId = parentById.get(cur);
                if (!parentId) break;
                hint.add(parentId);
                addMask(parentId, mask);
                cur = parentId;
            }
        };

        try {
            changeMap.forEach((change, id) => {
                if (id == null) return;
                const types = (change && typeof change.type === 'string') ? change.type.split('+') : [];

                let mask = 0;
                if (types.includes('added')) mask |= 1;
                if (types.includes('deleted')) mask |= 2;
                if (types.includes('modified')) mask |= 4;
                if (types.includes('moved')) mask |= 8;
                if (!mask) return;

                // deleted 节点可能不在 newTree 里：优先用 oldParentId
                if (types.includes('deleted')) {
                    const oldParentId = change && change.deleted && change.deleted.oldParentId != null
                        ? String(change.deleted.oldParentId)
                        : '';
                    if (oldParentId) {
                        hint.add(oldParentId);
                        addMask(oldParentId, mask);
                        bubbleUp(oldParentId, mask);
                        return;
                    }
                }

                bubbleUp(String(id), mask);
            });
        } catch (_) { /* ignore */ }

        return { hintSet: hint, ancestorBadgeMask: maskMap, parentById };
    })();

    // Build node index for lazy child rendering.
    const nodeById = new Map();
    try {
        const roots = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
        const stack = roots.filter(Boolean).map(n => ({ node: n, level: 0 }));
        while (stack.length) {
            const { node } = stack.pop();
            if (!node || node.id == null) continue;
            nodeById.set(String(node.id), node);
            if (Array.isArray(node.children) && node.children.length) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push({ node: node.children[i] });
                }
            }
        }
    } catch (_) { /* ignore */ }

    // 简略模式：默认展开到所有变化节点的位置（变化太多时不自动展开）
    let allowSimpleAutoExpand = false;
    const simpleExpandSet = new Set();
    try {
        if (mode !== 'detailed') {
            let changedBookmarks = 0;
            let changedFolders = 0;
            changeMap.forEach((_, id) => {
                if (id == null) return;
                const node = nodeById.get(String(id));
                const isFolder = !!(node && !node.url && node.children);
                if (isFolder) changedFolders += 1;
                else changedBookmarks += 1;
            });

            allowSimpleAutoExpand =
                changedBookmarks < SIMPLE_MODE_AUTO_EXPAND_MAX_BOOKMARKS &&
                changedFolders < SIMPLE_MODE_AUTO_EXPAND_MAX_FOLDERS;

            // 收集所有变化节点的祖先路径（自动展开到变化节点所在位置）
            if (allowSimpleAutoExpand && parentById instanceof Map) {
                changeMap.forEach((_, id) => {
                    if (id == null) return;
                    // 展开变化节点的所有祖先（如果变化的是文件夹，则展开到该文件夹所在位置，不展开文件夹内部）
                    let cur = String(id);
                    let guard = 0;
                    while (guard++ < 512) {
                        const pid = parentById.get(cur);
                        if (!pid) break;
                        simpleExpandSet.add(String(pid));
                        cur = String(pid);
                    }
                });
            }
        }
    } catch (_) { /* ignore */ }

    // 递归生成树形 HTML（使用与永久栏目相同的结构）
    // forceInclude: 简略模式下的“上下文展开”开关（例如：文件夹被移动时，为了能展开查看内容，需要把其子树也渲染出来）
    function renderHistoryTreeNode(node, level = 0, forceInclude = false, underDeletedAncestor = false) {
        if (!node) return '';

        const isFolder = !node.url && node.children;
        const idStr = node.id != null ? String(node.id) : '';
        const selfChanged = !!(changeMap && changeMap.has(node.id));
        const hasDescendantChanged = !!(isFolder && idStr && hintSet && hintSet.has(idStr));

        // 简略模式下只显示有变化的节点（自身变化 or 属于变化路径祖先）
        const shouldInclude = mode === 'detailed' || forceInclude || selfChanged || hasDescendantChanged;
        if (!shouldInclude) return '';

        const change = changeMap.get(node.id);
        let changeClass = '';
        let statusIcon = '';
        const isDeletedFolder = !!(isFolder && change && typeof change.type === 'string' && change.type.split('+').includes('deleted'));

        if (change) {
            const types = change.type ? change.type.split('+') : [];
            const isAmbiguous = types.includes('ambiguous');
            const isAdded = types.includes('added');
            const isDeleted = types.includes('deleted');
            const isModified = types.includes('modified');
            const isMoved = types.includes('moved');
            const isAddDelete = isAdded && isDeleted;

            if (isAmbiguous) {
                changeClass = 'tree-change-ambiguous';
                statusIcon = '<span class="change-badge ambiguous"><span class="badge-symbol">?</span></span>';
            } else if (isAddDelete) {
                changeClass = 'tree-change-mixed';
                statusIcon = '<span class="change-badge added"><span class="badge-symbol">+</span></span><span class="change-badge deleted"><span class="badge-symbol">-</span></span>';
            } else if (isAdded) {
                changeClass = 'tree-change-added';
                statusIcon = '<span class="change-badge added"><span class="badge-symbol">+</span></span>';
            } else if (isDeleted) {
                changeClass = 'tree-change-deleted';
                statusIcon = '<span class="change-badge deleted"><span class="badge-symbol">-</span></span>';
            } else {
                // 处理 modified 和 moved 的组合（与"当前变化"一致）
                if (isModified) {
                    changeClass = 'tree-change-modified';
                    statusIcon += '<span class="change-badge modified"><span class="badge-symbol">~</span></span>';
                }

                if (isMoved) {
                    // 如果既有modified又有moved，添加mixed类
                    if (isModified) {
                        changeClass = 'tree-change-mixed';
                    } else {
                        changeClass = 'tree-change-moved';
                    }
                    // 使用与"当前变化"相同的路径格式和tooltip
                    let slash = '';
                    if (change.moved && change.moved.oldPath) {
                        slash = breadcrumbToSlashFolders(change.moved.oldPath);
                    }
                    statusIcon += `<span class="change-badge moved" data-move-from="${escapeHtml(slash)}" title="${escapeHtml(slash)}"><span class="badge-symbol">>></span><span class="move-tooltip">${slashPathToChipsHTML(slash)}</span></span>`;
                }
            }
            // Detailed mode only: descendant path hint badges.
            // Note: descendant mask is independent from the folder's own change type; do not "hide" overlaps.
            if (!underDeletedAncestor && mode === 'detailed' && hasDescendantChanged) {
                const mask = ancestorBadgeMask.get(idStr) || 0;
                let pathBadges = `<span class="path-badges"><span class="path-dot" title="${isZh ? '此文件夹下有变化' : 'Contains changes'}">•</span>`;
                if (mask & 1) pathBadges += '<span class="path-symbol added" title="+">+</span>';
                if (mask & 2) pathBadges += '<span class="path-symbol deleted" title="-">-</span>';
                if (mask & 4) pathBadges += '<span class="path-symbol modified" title="~">~</span>';
                if (mask & 8) pathBadges += '<span class="path-symbol moved" title=">>">>></span>';
                pathBadges += '</span>';
                statusIcon += pathBadges;
            }
        } else if (!underDeletedAncestor && mode === 'detailed' && hasDescendantChanged && isFolder) {
            // 文件夹本身无变化，但子节点有变化：显示路径灰点 + 聚合徽标
            let pathBadges = `<span class="path-badges"><span class="path-dot" title="${isZh ? '此文件夹下有变化' : 'Contains changes'}">•</span>`;

            const mask = ancestorBadgeMask.get(idStr) || 0;
            if (mask) {
                if (mask & 1) pathBadges += '<span class="path-symbol added" title="+">+</span>';
                if (mask & 2) pathBadges += '<span class="path-symbol deleted" title="-">-</span>';
                if (mask & 4) pathBadges += '<span class="path-symbol modified" title="~">~</span>';
                if (mask & 8) pathBadges += '<span class="path-symbol moved" title=">>">>></span>';
            }
            pathBadges += '</span>';
            statusIcon = pathBadges;
        }

        const title = escapeHtml(node.title || (isZh ? '(无标题)' : '(Untitled)'));
        const hasChildren = isFolder && node.children && node.children.length > 0;
        const nextUnderDeletedAncestor = underDeletedAncestor || isDeletedFolder;

        // 展开逻辑（与“当前变化”对齐）：
        // - 详细模式：默认不自动展开（靠路径徽标提示；用户可手动展开）
        // - 简略模式：默认只展开到“第一处变化”（变化过多时不自动展开）
        let shouldExpand = false;
        if (mode === 'detailed') {
            if (Number.isFinite(expandDepth)) {
                shouldExpand = level < expandDepth;
            } else {
                shouldExpand = false;
            }
        } else {
            shouldExpand = (allowSimpleAutoExpand && simpleExpandSet.has(idStr));
        }
        if (Number.isFinite(lazyDepth) && level + 1 > lazyDepth) {
            shouldExpand = false;
        }

        // 关键：当“文件夹本身发生移动（拖动）”时，简略模式也需要允许展开查看其内容。
        // 否则简略模式只会显示这个文件夹节点，展开后是空的，用户无法确认“移动的是什么”。
        const shouldForceIncludeChildrenInSimple =
            mode !== 'detailed' &&
            !forceInclude &&
            isFolder &&
            change &&
            typeof change.type === 'string';
        const nextForceInclude = forceInclude || shouldForceIncludeChildrenInSimple;

        if (isFolder) {
            // 文件夹节点
            let shouldLazyRenderChildren = !(shouldExpand && hasChildren);
            if (hasChildren && Number.isFinite(lazyDepth) && level + 1 > lazyDepth) {
                shouldLazyRenderChildren = true;
            }
            const childrenHtml = (!shouldLazyRenderChildren && hasChildren)
                ? node.children.map(child => renderHistoryTreeNode(child, level + 1, nextForceInclude, nextUnderDeletedAncestor)).join('')
                : '';

            return `
                <div class="tree-node">
                    <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-type="folder" data-node-level="${level}">
                        <span class="tree-toggle ${shouldExpand ? 'expanded' : ''}"><i class="fas fa-chevron-right"></i></span>
                        <i class="tree-icon fas fa-folder${shouldExpand ? '-open' : ''}"></i>
                        <span class="tree-label">${title}</span>
                        <span class="change-badges">${statusIcon}</span>
                    </div>
                    <div class="tree-children ${shouldExpand ? 'expanded' : ''}" data-children-loaded="${shouldLazyRenderChildren ? 'false' : 'true'}" data-parent-id="${escapeHtml(String(node.id))}" data-child-level="${level + 1}" data-next-force-include="${nextForceInclude ? 'true' : 'false'}">
                        ${childrenHtml}
                    </div>
                </div>
            `;
        } else {
            // 书签节点
            const favicon = typeof getFaviconUrl === 'function' ? getFaviconUrl(node.url) : '';
            return `
                <div class="tree-node">
                    <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-type="bookmark" data-node-level="${level}">
                        <span class="tree-toggle" style="opacity: 0"></span>
                        ${favicon ? `<img class="tree-icon" src="${favicon}" alt="">` : `<i class="tree-icon fas fa-bookmark"></i>`}
                        <a href="${escapeHtml(node.url || '')}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer">${title}</a>
                        <span class="change-badges">${statusIcon}</span>
                    </div>
                </div>
            `;
        }
    }

    // Expose lazy render function for the currently rendered record.
    try {
        const contextKey = lazyKey || recordTimeKey;
        if (window.__historyTreeLazyContexts && contextKey) {
            window.__historyTreeLazyContexts.set(contextKey, {
                renderChildren: (parentId, childLevel, nextForceInclude) => {
                    const parent = nodeById.get(String(parentId));
                    if (!parent || !Array.isArray(parent.children)) return '';
                    const lvl = Number.isFinite(Number(childLevel)) ? Number(childLevel) : 0;
                    const force = String(nextForceInclude) === 'true';
                    const parentChange = changeMap.get(parentId);
                    const parentIsDeletedFolder = !!(parent && !parent.url && parent.children && parentChange && typeof parentChange.type === 'string' && parentChange.type.split('+').includes('deleted'));
                    return parent.children.map(ch => renderHistoryTreeNode(ch, lvl, force, parentIsDeletedFolder)).join('');
                }
            });
        }
    } catch (_) { /* ignore */ }

    // 生成树内容
    let treeContent = '';
    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    nodes.forEach(node => {
        if (node.children) {
            node.children.forEach(child => {
                treeContent += renderHistoryTreeNode(child, 0);
            });
        }
    });

    if (!treeContent) {
        return `
            <div class="detail-section">
                <div class="detail-empty">
                    <i class="fas fa-check-circle"></i>
                    ${isZh ? '无变化' : 'No changes'}
                </div>
            </div>
        `;
    }

    // 获取各类型变化数量（区分文件夹F和书签B）
    let addedFolders = 0, addedBookmarks = 0;
    let deletedFolders = 0, deletedBookmarks = 0;
    let modifiedFolders = 0, modifiedBookmarks = 0;
    let movedFolders = 0, movedBookmarks = 0;

    // 构建节点ID到节点的映射，用于判断节点类型
    const nodeMap = new Map();
    function buildNodeMap(node) {
        if (!node) return;
        if (node.id) nodeMap.set(node.id, node);
        if (node.children) node.children.forEach(buildNodeMap);
    }
    const treeNodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    treeNodes.forEach(buildNodeMap);

    changeMap.forEach((change, id) => {
        const node = nodeMap.get(id);
        const isFolder = node && !node.url && node.children;
        const types = change.type ? change.type.split('+') : [];

        if (types.includes('added')) {
            if (isFolder) addedFolders++; else addedBookmarks++;
        }
        if (types.includes('deleted')) {
            if (isFolder) deletedFolders++; else deletedBookmarks++;
        }
        if (types.includes('modified')) {
            if (isFolder) modifiedFolders++; else modifiedBookmarks++;
        }
        if (types.includes('moved')) {
            if (isFolder) movedFolders++; else movedBookmarks++;
        }
    });

    // 生成图例（内联在标题行，带数量，区分F/B）
    const formatCount = (folders, bookmarks) => {
        const parts = [];
        if (folders > 0) parts.push(`${folders}F`);
        if (bookmarks > 0) parts.push(`${bookmarks}B`);
        return parts.join(' ');
    };

    const legendItems = [];
    const addedTotal = addedFolders + addedBookmarks;
    const deletedTotal = deletedFolders + deletedBookmarks;
    const modifiedTotal = modifiedFolders + modifiedBookmarks;
    const movedTotal = movedFolders + movedBookmarks;

    // 增加和删除显示F/B详情，移动和修改只显示总数
    const legendTitle = isZh ? '点击高亮对应变化' : 'Click to highlight';
    if (addedTotal > 0) legendItems.push(`<span class="legend-item" data-change-type="added" title="${legendTitle}"><span class="legend-dot added"></span><span class="legend-count">:${formatCount(addedFolders, addedBookmarks)}</span></span>`);
    if (deletedTotal > 0) legendItems.push(`<span class="legend-item" data-change-type="deleted" title="${legendTitle}"><span class="legend-dot deleted"></span><span class="legend-count">:${formatCount(deletedFolders, deletedBookmarks)}</span></span>`);
    if (movedTotal > 0) legendItems.push(`<span class="legend-item" data-change-type="moved" title="${legendTitle}"><span class="legend-dot moved"></span><span class="legend-count">:${movedTotal}</span></span>`);
    if (modifiedTotal > 0) legendItems.push(`<span class="legend-item" data-change-type="modified" title="${legendTitle}"><span class="legend-dot modified"></span><span class="legend-count">:${modifiedTotal}</span></span>`);
    const legend = hideLegend ? '' : legendItems.join('');
    const titleText = escapeHtml(customTitle || (isZh ? '书签变化' : 'Bookmark Changes'));
    const detailLabel = customLabel != null
        ? customLabel
        : (mode === 'detailed' ? (isZh ? '详细' : 'Detailed') : (isZh ? '简略' : 'Simple'));
    const modeLabelHtml = hideModeLabel || !detailLabel
        ? ''
        : `<span class="detail-mode-label">(${escapeHtml(detailLabel)})</span>`;
    const lazyAttr = lazyKey ? ` data-lazy-key="${escapeHtml(lazyKey)}"` : '';

    return `
        <div class="detail-section">
            <div class="detail-section-title detail-section-title-with-legend">
                <span class="detail-title-left">
                    ${titleText}
                    ${modeLabelHtml}
                </span>
                <span class="detail-title-legend">${legend}</span>
            </div>
            <div class="history-tree-container bookmark-tree" data-tree-readonly="true"${lazyAttr}>
                <div class="history-tree-root-children">
                    ${treeContent}
                </div>
            </div>
        </div>
    `;
}

// 截断 URL 显示
function truncateUrl(url, maxLength) {
    if (!url || url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
}

// 生成详细变化的 HTML（Git diff 风格）
async function generateDetailedChanges(record) {
    console.log('[详细变化] ========== 开始生成详细变化 ==========');
    console.log('[详细变化] 记录时间:', record.time);
    console.log('[详细变化] 记录状态:', record.status);
    console.log('[详细变化] 记录有 bookmarkTree:', !!record.bookmarkTree);
    console.log('[详细变化] bookmarkTree 类型:', typeof record.bookmarkTree);

    await ensureRecordBookmarkTree(record);

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
        if (syncHistory[i].status === 'success' && (syncHistory[i].bookmarkTree || syncHistory[i].hasData)) {
            previousRecord = syncHistory[i];
            break;
        }
    }

    if (previousRecord && !previousRecord.bookmarkTree && (previousRecord.hasData || previousRecord.status === 'success')) {
        try {
            const prevTree = await getBackupDataLazy(previousRecord.time);
            if (prevTree) previousRecord.bookmarkTree = prevTree;
        } catch (_) { }
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
// 搜索功能（核心逻辑已移动到 search/search.js）
// =============================================================================

// NOTE:
// 顶部搜索框在多个视图/子标签共用。
// 这里做“请求隔离 + 防抖取消”，避免：
// - 用户清空输入 / 切换视图后，旧的 debounce 回调仍执行，导致候选列表“串台”
// - 首次进入页面/快捷键进入/刷新时，初始化时序导致的旧状态残留

let mainSearchDebounceTimer = null;
let mainSearchDebounceSeq = 0;

function getMainSearchContextKey() {
    const view = (typeof currentView === 'string' && currentView) ? currentView : 'unknown';
    try {
        const ctx = window.SearchContextManager && window.SearchContextManager.currentContext
            ? window.SearchContextManager.currentContext
            : null;
        if (ctx && typeof ctx === 'object') {
            const parts = [ctx.view || view, ctx.tab, ctx.subTab].filter(Boolean);
            if (parts.length) return parts.join('|');
        }
    } catch (_) { }
    return view;
}

function cancelPendingMainSearchDebounce() {
    try {
        if (mainSearchDebounceTimer) {
            clearTimeout(mainSearchDebounceTimer);
            mainSearchDebounceTimer = null;
        }
    } catch (_) { }
    // bump seq so any already-scheduled closures become stale
    mainSearchDebounceSeq += 1;
}

try {
    window.cancelPendingMainSearchDebounce = cancelPendingMainSearchDebounce;
} catch (_) { }

function handleSearch(e) {
    const inputEl = e && e.target;
    const raw = (inputEl && typeof inputEl.value === 'string') ? inputEl.value : '';
    const normalizedQuery = raw.trim().toLowerCase();

    // 清空输入：立即执行清理，且取消所有排队的搜索
    if (!normalizedQuery) {
        cancelPendingMainSearchDebounce();
        performSearch('');
        return;
    }

    const seq = (mainSearchDebounceSeq += 1);
    const scheduledContextKey = getMainSearchContextKey();

    if (mainSearchDebounceTimer) clearTimeout(mainSearchDebounceTimer);
    mainSearchDebounceTimer = setTimeout(() => {
        // 1) 新的输入事件已经触发，旧回调作废
        if (seq !== mainSearchDebounceSeq) return;

        // 2) 切换了视图/子标签：作废（避免候选列表串台）
        if (scheduledContextKey !== getMainSearchContextKey()) return;

        // 3) 输入框内容已变化：作废（避免输入已清空但旧结果仍渲染）
        const currentInput = document.getElementById('searchInput');
        const currentNormalized = (currentInput && typeof currentInput.value === 'string')
            ? currentInput.value.trim().toLowerCase()
            : '';
        if (currentNormalized !== normalizedQuery) return;

        performSearch(normalizedQuery);
    }, 260);
}

function performSearch(query) {
    if (!query) {
        // 仅 current-changes / history
        hideSearchResultsPanel();
        return;
    }

    // 根据当前视图执行搜索
    switch (currentView) {
        case 'current-changes':
            // Phase 1：当前变化搜索
            searchCurrentChangesAndRender(query);
            break;
        case 'history':
            // Phase 2：备份历史搜索（使用 search.js 中的新实现）
            if (typeof searchBackupHistoryAndRender === 'function') {
                searchBackupHistoryAndRender(query);
            } else {
                // 回退到旧的过滤方式（不应该发生）
                console.warn('[Search] searchBackupHistoryAndRender not available, falling back to filter');
                hideSearchResultsPanel();
                searchHistoryLegacy(query);
            }
            break;
    }
}

// 旧版历史搜索（仅作为回退，Phase 2 实现后不再使用）
function searchHistoryLegacy(query) {
    const container = document.getElementById('historyList');
    const originalHistory = [...syncHistory]; // 保存原始数据
    const filtered = syncHistory.filter(record => {
        const note = (record.note || '').toLowerCase();
        const time = formatTime(record.time).toLowerCase();
        return note.includes(query) || time.includes(query);
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">未找到匹配的记录</div></div>`;
        return;
    }

    // 重新渲染过滤后的历史（注意：这会修改 syncHistory，不推荐）
    // syncHistory = filtered;
    // renderHistoryView();
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
    window.currentLang = currentLang; // 同步到 window

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

    // [User Request] 更新搜索组件语言
    if (typeof window.updateSearchUILanguage === 'function') {
        window.updateSearchUILanguage();
    }
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
            <span class="legend-item"><span class="legend-dot moved"></span> ${isEn ? 'Moved' : '移动'}</span>
            <span class="legend-item"><span class="legend-dot modified"></span> ${isEn ? 'Modified' : '修改'}</span>
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
}


// =============================================================================
// 实时更新
// =============================================================================

function handleStorageChange(changes, namespace) {
    if (namespace !== 'local') return;

    // Internal migration: syncHistory seqNumber backfill.
    // This can happen shortly after page load and would otherwise cause a full reload/render,
    // which users perceive as an extra "refresh" + scroll jump.
    try {
        const marker = window.__skipNextSyncHistoryStorageRefresh;
        const onlySyncHistoryChanged = !!changes.syncHistory &&
            !changes.lastSyncOperations &&
            !changes.lastSyncTime &&
            !changes.lastBookmarkData;
        if (marker && onlySyncHistoryChanged && (Date.now() - (marker.at || 0) < 15000)) {
            console.log('[存储监听] 跳过 seqNumber 迁移触发的 syncHistory 刷新');
            window.__skipNextSyncHistoryStorageRefresh = null;
            return;
        }
    } catch (_) { }

    console.log('[存储监听] 检测到变化:', Object.keys(changes));

    // 备份历史被清空：关闭详情弹窗并清理本地状态，避免残留旧记录内容/展开状态
    if (changes.syncHistory) {
        try {
            const newHistory = changes.syncHistory.newValue || [];
            if (Array.isArray(newHistory) && newHistory.length === 0) {
                const modal = document.getElementById('detailModal');
                if (modal && modal.classList.contains('show')) {
                    closeModal();
                } else {
                    currentDetailRecordTime = null;
                    currentDetailRecord = null;
                    currentDetailRecordMode = null;
                }

                try {
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                        const key = localStorage.key(i);
                        if (!key) continue;
                        if (key.startsWith(HISTORY_DETAIL_MODE_PREFIX) || key.startsWith(HISTORY_DETAIL_EXPANDED_PREFIX)) {
                            localStorage.removeItem(key);
                        }
                    }
                } catch (_) { }

                try {
                    const body = document.getElementById('modalBody');
                    if (body) body.innerHTML = '';
                } catch (_) { }
            }
        } catch (e) {
            console.warn('[存储监听] 清空备份历史后的 UI 清理失败:', e);
        }
    }

    // 成功备份后（自动/手动/切换），立即清理永久栏目/预览中的颜色标识，并清空显式移动集合
    try {
        if (changes.syncHistory) {
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

    // Current Changes 视图：lastSyncOperations 只是“增量结构变化标记”，树本身由 bookmarks API 增量更新。
    // 在这里做全量重载会造成预览树与滚动条明显抖动（用户感知为“页面又刷新一次”）。
    const isCurrentChangesOpsOnly =
        currentView === 'current-changes' &&
        !!changes.lastSyncOperations &&
        !changes.syncHistory &&
        !changes.lastSyncTime &&
        !changes.lastBookmarkData;
    if (isCurrentChangesOpsOnly) {
        console.log('[存储监听] Current Changes下仅 lastSyncOperations 变化，跳过自动刷新以避免滚动抖动');
        return;
    }

    // 检查相关数据是否变化 - 实时更新
    if (changes.syncHistory || changes.lastSyncTime || changes.lastBookmarkData || changes.lastSyncOperations) {
        console.log('[存储监听] 书签数据变化，立即重新加载...');

        clearDetailChangeCache();

        // 重新加载/重渲前先 flush 当前滚动位置，避免后续重渲导致“先恢复后又跳顶”
        try { __flushCurrentChangesScrollState(); } catch (_) { }

        // 清除缓存，强制重新加载
        cachedCurrentChanges = null;
        cachedBookmarkTree = null;
        cachedTreeData = null; // 清除树视图缓存
        cachedOldTree = null;
        lastTreeFingerprint = null;
        lastTreeSnapshotVersion = null;
        cachedCurrentTreeIndex = null;
        jsonDiffRendered = false; // 重置JSON渲染标志

        // 历史视图下仅 syncHistory 更新时，避免全量 bookmarks.getTree + flatten（成本很高）
        const historyOnlySyncHistoryUpdate =
            currentView === 'history' &&
            !!changes.syncHistory &&
            !changes.lastSyncTime &&
            !changes.lastBookmarkData &&
            !changes.lastSyncOperations;

        if (historyOnlySyncHistoryUpdate) {
            refreshHistoryIndexPage({ page: currentHistoryPage }).then(() => {
                if (currentView === 'history') {
                    console.log('[存储监听] 历史视图增量刷新（仅重拉分页索引）');
                    renderHistoryView();
                }
            }).catch((e) => {
                console.warn('[存储监听] 历史增量刷新失败，回退全量刷新:', e);
                loadAllData({ skipRender: true }).then(async () => {
                    if (currentView === 'history') {
                        try {
                            await refreshHistoryIndexPage({ page: currentHistoryPage });
                        } catch (pageError) {
                            console.warn('[存储监听] 历史增量回退分页失败，使用本地倒序回退:', pageError);
                            const localHistory = Array.isArray(syncHistory) ? syncHistory.slice() : [];
                            const sortedLocal = localHistory.sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0));
                            const totalRecords = sortedLocal.length;
                            const totalPages = Math.max(1, Math.ceil(totalRecords / HISTORY_PAGE_SIZE));
                            currentHistoryPage = clampHistoryPage(currentHistoryPage, totalPages);
                            const pageStart = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
                            syncHistory = sortedLocal.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
                            historyIndexMeta = { totalRecords, totalPages };
                        }
                        await renderHistoryView();
                    }
                });
            });
            return;
        }

        // 立即重新加载数据
        loadAllData({ skipRender: true }).then(async () => {
            console.log('[存储监听] 数据重新加载完成');

            // 如果当前在 current-changes 视图，使用重试机制刷新
            if (currentView === 'current-changes') {
                console.log('[存储监听] 刷新当前变化视图（带重试，强制刷新）');
                await renderCurrentChangesViewWithRetry(3, true);
            }

            // 如果当前在 history 视图，刷新历史记录视图
            if (currentView === 'history') {
                console.log('[存储监听] 刷新历史记录视图');
                try {
                    await refreshHistoryIndexPage({ page: currentHistoryPage });
                } catch (pageError) {
                    console.warn('[存储监听] 历史视图分页刷新失败，使用本地倒序回退:', pageError);
                    const localHistory = Array.isArray(syncHistory) ? syncHistory.slice() : [];
                    const sortedLocal = localHistory.sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0));
                    const totalRecords = sortedLocal.length;
                    const totalPages = Math.max(1, Math.ceil(totalRecords / HISTORY_PAGE_SIZE));
                    currentHistoryPage = clampHistoryPage(currentHistoryPage, totalPages);
                    const pageStart = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
                    syncHistory = sortedLocal.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
                    historyIndexMeta = { totalRecords, totalPages };
                }
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
        window.currentLang = currentLang; // 同步到 window

        // 更新语言切换按钮文本
        const langText = document.querySelector('#langToggle .lang-text');
        if (langText) {
            langText.textContent = currentLang === 'zh_CN' ? 'EN' : '中';
        }

        // 应用新语言到所有UI元素
        applyLanguage();

        // 重新渲染当前视图以应用语言
        renderCurrentView();

    }
}

// =============================================================================
// 书签API监听（实时更新书签树）
// =============================================================================

const BULK_ADD_REMOVE_THRESHOLD = 300;
const BULK_ADD_REMOVE_QUIET_MS = 220;

let pendingAddRemoveEvents = [];
let pendingAddRemoveTimer = null;
let addRemoveFlushInProgress = false;
let addRemoveFlushQueued = false;

async function handleBookmarkCreateRealtime(id, bookmark) {
    const appliedToCachedTree = applyIncrementalCreateToCachedCurrentTree(id, bookmark);
    if (!appliedToCachedTree) {
        scheduleCachedCurrentTreeSnapshotRefresh('onCreated-fast-fallback');
    }
    clearCanvasLazyChangeHints('onCreated');
}

async function handleBookmarkRemoveRealtime(id, removeInfo) {
    if (removeInfo && removeInfo.node && removeInfo.node.url) {
        FaviconCache.clear(removeInfo.node.url);
    }

    const appliedToCachedTree = applyIncrementalRemoveFromCachedCurrentTree(id, removeInfo);
    if (!appliedToCachedTree) {
        scheduleCachedCurrentTreeSnapshotRefresh('onRemoved-fast-fallback');
    }
    clearCanvasLazyChangeHints('onRemoved');
}

function scheduleAddRemoveEventFlush() {
    if (pendingAddRemoveTimer) {
        clearTimeout(pendingAddRemoveTimer);
    }
    pendingAddRemoveTimer = setTimeout(() => {
        pendingAddRemoveTimer = null;
        flushPendingAddRemoveEvents('quiet-window').catch((e) => {
            console.warn('[书签监听] 批处理 flush 失败:', e);
        });
    }, BULK_ADD_REMOVE_QUIET_MS);
}

function enqueueAddRemoveEvent(event) {
    if (!event || !event.type || !event.id) return;
    pendingAddRemoveEvents.push(event);
    scheduleAddRemoveEventFlush();
}

async function flushPendingAddRemoveEvents(reason = '') {
    if (pendingAddRemoveTimer) {
        clearTimeout(pendingAddRemoveTimer);
        pendingAddRemoveTimer = null;
    }

    if (addRemoveFlushInProgress) {
        addRemoveFlushQueued = true;
        return;
    }

    if (!pendingAddRemoveEvents.length) return;

    addRemoveFlushInProgress = true;
    const batch = pendingAddRemoveEvents;
    pendingAddRemoveEvents = [];

    try {
        const isBulk = batch.length >= BULK_ADD_REMOVE_THRESHOLD;

        if (isBulk) {
            console.log(`[书签监听][批处理] 新增/删除事件数=${batch.length}，触发批处理 (${reason || 'unknown'})`);

            batch.forEach((event) => {
                if (event.type !== 'removed') return;
                if (event.removeInfo && event.removeInfo.node && event.removeInfo.node.url) {
                    FaviconCache.clear(event.removeInfo.node.url);
                }
            });

            clearCanvasLazyChangeHints('bulk-add-remove');

            if (currentView === 'current-changes') {
                if (pendingCurrentChangesEventTimer) {
                    clearTimeout(pendingCurrentChangesEventTimer);
                    pendingCurrentChangesEventTimer = null;
                }
                await renderCurrentChangesViewWithRetry(1, true);
                scheduleCachedCurrentTreeSnapshotRefresh('bulk-add-remove');
            }
            return;
        }

        for (const event of batch) {
            if (event.type === 'created') {
                await handleBookmarkCreateRealtime(event.id, event.bookmark);
            } else if (event.type === 'removed') {
                await handleBookmarkRemoveRealtime(event.id, event.removeInfo);
            }
        }

        if (currentView === 'current-changes') {
            scheduleCurrentChangesRerender(reason || 'add-remove-batch');
        }
    } finally {
        addRemoveFlushInProgress = false;
        if (addRemoveFlushQueued) {
            addRemoveFlushQueued = false;
            flushPendingAddRemoveEvents('queued').catch((e) => {
                console.warn('[书签监听] queued flush 失败:', e);
            });
        }
    }
}

function setupBookmarkListener() {
    if (!browserAPI.bookmarks) {
        console.warn('[书签监听] 书签API不可用');
        return;
    }

    console.log('[书签监听] 设置书签API监听器');

    // 书签创建
browserAPI.bookmarks.onCreated.addListener((id, bookmark) => {
        console.log('[书签监听] 书签创建:', bookmark.title);
        try {
            enqueueAddRemoveEvent({
                type: 'created',
                id: String(id),
                bookmark
            });
        } catch (e) {
            // 仅记录错误，不触发完全刷新以避免页面闪烁和滚动位置丢失
            console.warn('[书签监听] onCreated 处理异常:', e);
        }
    });

    // 书签删除
browserAPI.bookmarks.onRemoved.addListener((id, removeInfo) => {
        console.log('[书签监听] 书签删除:', id);
        try {
            enqueueAddRemoveEvent({
                type: 'removed',
                id: String(id),
                removeInfo
            });
        } catch (e) {
            // 仅记录错误，不触发完全刷新以避免页面闪烁和滚动位置丢失
            console.warn('[书签监听] onRemoved 处理异常:', e);
        }
    });

    // 书签修改
browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
        console.log('[书签监听] 书签修改:', changeInfo);
        try {
            await flushPendingAddRemoveEvents('before-onChanged');
            const appliedToCachedTree = applyIncrementalChangeToCachedCurrentTree(id, changeInfo);
            if (!appliedToCachedTree) {
                scheduleCachedCurrentTreeSnapshotRefresh('onChanged-fast-fallback');
            }
            clearCanvasLazyChangeHints('onChanged');
            if (currentView === 'current-changes') {
                scheduleCurrentChangesRerender('onChanged');
            }
        } catch (e) {
            // 仅记录错误，不触发完全刷新以避免页面闪烁和滚动位置丢失
            console.warn('[书签监听] onChanged 处理异常:', e);
        }
    });

    // 书签移动
browserAPI.bookmarks.onMoved.addListener(async (id, moveInfo) => {
        console.log('[书签监听] 书签移动:', id);

        try {
            await flushPendingAddRemoveEvents('before-onMoved');
            // 将本次移动记为显式主动移动，确保稳定显示蓝色标识
            explicitMovedIds.set(id, Date.now() + Infinity);

            const appliedToCachedTree = applyIncrementalMoveToCachedCurrentTree(id, moveInfo);
            if (!appliedToCachedTree) {
                scheduleCachedCurrentTreeSnapshotRefresh('onMoved-fast-fallback');
            }

            clearCanvasLazyChangeHints('onMoved');
            if (currentView === 'current-changes') {
                scheduleCurrentChangesRerender('onMoved');
            }
        } catch (e) {
            // 仅记录错误，不触发完全刷新以避免页面闪烁和滚动位置丢失
            console.warn('[书签监听] onMoved 处理异常:', e);
        }
    });
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
        } else if (message.action === 'clearExplicitMoved') {
            try {
                explicitMovedIds = new Map();
                resetPermanentSectionChangeMarkers();
            } catch (e) { /* 忽略 */ }
        } else if (message.action === 'recentMovedBroadcast' && message.id) {
            // 后台广播的最近被移动的ID，立即记入显式集合（仅标记这个节点）
            // 这确保用户拖拽的节点优先被标识为蓝色"moved"
            // 永久记录，不再有时间限制
            explicitMovedIds.set(message.id, Date.now() + Infinity);
        } else if (message.action === 'clearLocalStorage') {
            // 收到来自 background.js 的清除 localStorage 请求（"恢复到初始状态"功能）
            console.log('[history.js] 收到清除 localStorage 请求');
            try {
                localStorage.clear();
                console.log('[history.js] localStorage 已清除');
            } catch (e) {
                console.warn('[history.js] 清除 localStorage 失败:', e);
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
        bookmarkAdded: message.bookmarkAdded,
        bookmarkDeleted: message.bookmarkDeleted,
        folderAdded: message.folderAdded,
        folderDeleted: message.folderDeleted,
        movedCount: message.movedCount,
        modifiedCount: message.modifiedCount,
        bookmarkCount: message.bookmarkCount,
        folderCount: message.folderCount
    });

    const analysisSignature = JSON.stringify({
        bookmarkDiff: message.bookmarkDiff,
        folderDiff: message.folderDiff,
        bookmarkAdded: message.bookmarkAdded,
        bookmarkDeleted: message.bookmarkDeleted,
        folderAdded: message.folderAdded,
        folderDeleted: message.folderDeleted,
        movedCount: message.movedCount,
        modifiedCount: message.modifiedCount,
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
        // 统一走同一条刷新通道（去抖），避免与其他触发源叠加导致“刷两三次”
        scheduleCurrentChangesRerender('analysisUpdated');
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

// 用于导出文件名的本地时间格式化（避免 toISOString 的 UTC 时区问题）
function formatTimeForFilename(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function sanitizeFilenameSegment(text) {
    return String(text || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function buildSequenceMapFromHistory(historyRecords) {
    const records = Array.isArray(historyRecords) ? historyRecords.slice() : [];
    records.sort((a, b) => Number(a?.time || 0) - Number(b?.time || 0));
    const map = new Map();
    const used = new Set();
    for (const r of records) {
        const seq = Number(r?.seqNumber);
        if (Number.isFinite(seq) && seq > 0) used.add(seq);
    }
    let next = 1;
    for (const r of records) {
        let seq = Number(r?.seqNumber);
        if (!(Number.isFinite(seq) && seq > 0)) {
            while (used.has(next)) next++;
            seq = next;
            used.add(seq);
            next++;
        }
        map.set(String(r.time), seq);
    }
    return map;
}

function formatSelectedSequenceRanges(seqNumbers, lang) {
    const delim = lang === 'zh_CN' ? '、' : ',';
    const nums = Array.from(new Set((seqNumbers || []).filter(n => Number.isFinite(n) && n > 0)))
        .sort((a, b) => a - b);
    if (nums.length === 0) return '';

    const parts = [];
    let start = nums[0];
    let end = nums[0];
    for (let i = 1; i < nums.length; i++) {
        const n = nums[i];
        if (n === end + 1) {
            end = n;
            continue;
        }
        parts.push(start === end ? String(start) : `${start}-${end}`);
        start = n;
        end = n;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    return parts.join(delim);
}

function generateBookmarkExportHTMLFromTree(treeRoot) {
    const escapeAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapeText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    html += '<TITLE>Bookmarks</TITLE>\n';
    html += '<H1>Bookmarks</H1>\n';
    html += '<DL><p>\n';

    const generateNodeHTML = (node, indentLevel) => {
        const indent = '    '.repeat(indentLevel);
        const title = escapeText(node?.title || '');
        const url = node?.url ? String(node.url) : '';
        const isFolder = !url && node && Array.isArray(node.children);

        if (isFolder) {
            let result = `${indent}<DT><H3>${title}</H3>\n`;
            result += `${indent}<DL><p>\n`;
            node.children.forEach(child => {
                result += generateNodeHTML(child, indentLevel + 1);
            });
            result += `${indent}</DL><p>\n`;
            return result;
        }

        if (url) {
            return `${indent}<DT><A HREF="${escapeAttr(url)}">${title}</A>\n`;
        }

        // fallback: treat as folder-ish if children exists, otherwise skip
        if (node && Array.isArray(node.children)) {
            let result = `${indent}<DT><H3>${title}</H3>\n`;
            result += `${indent}<DL><p>\n`;
            node.children.forEach(child => {
                result += generateNodeHTML(child, indentLevel + 1);
            });
            result += `${indent}</DL><p>\n`;
            return result;
        }

        return '';
    };

    const nodes = Array.isArray(treeRoot) ? treeRoot : [treeRoot];
    nodes.forEach(root => {
        if (!root) return;
        if (root.title) {
            html += generateNodeHTML({ title: root.title, children: root.children || [] }, 1);
            return;
        }
        if (Array.isArray(root.children)) {
            root.children.forEach(child => {
                html += generateNodeHTML(child, 1);
            });
        }
    });

    html += '</DL><p>\n';
    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading() {
    document.querySelectorAll('.view.active .history-commits, .view.active .bookmark-tree').forEach(el => {
        el.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    });
}

function showError(message) {
    const container = document.querySelector('.view.active > div:last-child');
    if (container) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="empty-state-title">${escapeHtml(message)}</div>
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
// ==================== 导出变化功能 ====================

// 当前导出的变化数据（供模态框使用）
let currentExportChangeData = null;
// 当前变化手动导出：后台同源生成的建议文件名
let currentChangesManualExportLastFileName = '';
// 当前导出的历史记录（供备份历史导出使用）
let currentExportHistoryRecord = null;
// 当前导出的书签树（供备份历史导出使用）
let currentExportBookmarkTree = null;

function updateExportChangesActionOptionsByMode(modal) {
    if (!modal) return;

    const modeValue = modal.querySelector('input[name="exportChangesMode"]:checked')?.value || 'simple';
    const isCollectionMode = modeValue === 'collection';

    const copyInput = modal.querySelector('input[name="exportChangesAction"][value="copy"]');
    const downloadInput = modal.querySelector('input[name="exportChangesAction"][value="download"]');
    const copyLabel = copyInput ? copyInput.closest('label') : null;

    if (copyLabel) {
        copyLabel.style.display = isCollectionMode ? 'none' : '';
    }

    if (copyInput) {
        copyInput.disabled = isCollectionMode;
    }

    if (isCollectionMode && copyInput && copyInput.checked && downloadInput) {
        downloadInput.checked = true;
    }
}

// 显示导出变化模态框
function showExportChangesModal(changeData) {
    console.log('[showExportChangesModal] 接收到的 changeData:', changeData);
    console.log('[showExportChangesModal] changeData 的所有属性:', Object.keys(changeData || {}));
    console.log('[showExportChangesModal] hasChanges:', changeData?.hasChanges);
    console.log('[showExportChangesModal] stats:', changeData?.stats);
    console.log('[showExportChangesModal] diffMeta:', changeData?.diffMeta);
    console.log('[showExportChangesModal] added:', changeData?.added?.length || 0, changeData?.added);
    console.log('[showExportChangesModal] deleted:', changeData?.deleted?.length || 0, changeData?.deleted);
    console.log('[showExportChangesModal] modified:', changeData?.modified?.length || 0, changeData?.modified);
    console.log('[showExportChangesModal] moved:', changeData?.moved?.length || 0, changeData?.moved);

    currentExportChangeData = changeData;
    const modal = document.getElementById('exportChangesModal');
    if (modal) {
        modal.classList.add('show');
        // 重置为默认值
        const formatHtml = modal.querySelector('input[name="exportChangesFormat"][value="html"]');
        if (formatHtml) formatHtml.checked = true;
        const modeSimple = modal.querySelector('input[name="exportChangesMode"][value="simple"]');
        if (modeSimple) modeSimple.checked = true;
        const actionDownload = modal.querySelector('input[name="exportChangesAction"][value="download"]');
        if (actionDownload) actionDownload.checked = true;
        updateExportChangesActionOptionsByMode(modal);
        // 隐藏扩展层级
        const depthSection = document.getElementById('exportChangesDepthSection');
        if (depthSection) depthSection.style.display = 'none';

        // 隐藏详细模式说明
        const helpContent = document.getElementById('exportChangesDetailedHelpContent');
        if (helpContent) helpContent.style.display = 'none';

        // 隐藏标记说明
        const legendHelpContent = document.getElementById('exportChangesLegendHelpContent');
        if (legendHelpContent) legendHelpContent.style.display = 'none';
    }
}

// 显示备份历史的导出变化模态框
async function showHistoryExportChangesModal(recordTime, options = {}) {
    console.log('[showHistoryExportChangesModal] 记录时间:', recordTime);
    const { preferredMode, useDomTreeContainer, treeContainer } = options;

    // 查找记录
    const record = syncHistory.find(r => r.time === recordTime);
    if (!record) {
        showToast(currentLang === 'zh_CN' ? '未找到记录' : 'Record not found');
        return;
    }

    // 检查是否有 bookmarkTree
    await ensureRecordBookmarkTree(record);
    if (!record.bookmarkTree) {
        showToast(currentLang === 'zh_CN' ? '该记录没有详细数据（旧记录已清理）' : 'No detailed data available (old records cleaned)');
        return;
    }

    // 找到上一条记录进行对比
    const recordIndex = syncHistory.findIndex(r => r.time === recordTime);
    let previousRecord = null;
    if (recordIndex > 0) {
        for (let i = recordIndex - 1; i >= 0; i--) {
            if (syncHistory[i].status === 'success' && (syncHistory[i].bookmarkTree || syncHistory[i].hasData)) {
                previousRecord = syncHistory[i];
                break;
            }
        }
    }

    // 计算变化 - 使用与"当前变化"相同的 detectTreeChangesFast
    let changeMap = new Map();
    let treeToExport = record.bookmarkTree;

    if (previousRecord && !previousRecord.bookmarkTree && (previousRecord.hasData || previousRecord.status === 'success')) {
        try {
            const prevTree = await getBackupDataLazy(previousRecord.time);
            if (prevTree) previousRecord.bookmarkTree = prevTree;
        } catch (_) { }
    }
    if (previousRecord && previousRecord.bookmarkTree) {
        changeMap = await detectTreeChangesFast(previousRecord.bookmarkTree, record.bookmarkTree, {
            useGlobalExplicitMovedIds: false,
            explicitMovedIdSet: (record && record.bookmarkStats && Array.isArray(record.bookmarkStats.explicitMovedIds))
                ? record.bookmarkStats.explicitMovedIds
                : null
        });

        // 关键：如果有删除的节点，需要重建树结构（与"当前变化"一致）
        let hasDeleted = false;
        for (const [, change] of changeMap) {
            if (change.type && change.type.includes('deleted')) {
                hasDeleted = true;
                break;
            }
        }
        if (hasDeleted) {
            try {
                treeToExport = rebuildTreeWithDeleted(previousRecord.bookmarkTree, record.bookmarkTree, changeMap);
                console.log('[showHistoryExportChangesModal] 已重建包含删除节点的树');
            } catch (error) {
                console.error('[showHistoryExportChangesModal] 重建树失败:', error);
                treeToExport = record.bookmarkTree;
            }
        }
    } else if (record.isFirstBackup) {
        // 第一次备份，所有书签都是新增
        const allNodes = flattenBookmarkTree(record.bookmarkTree);
        allNodes.forEach(item => {
            if (item.id) changeMap.set(item.id, { type: 'added' });
        });
    }

    console.log('[showHistoryExportChangesModal] 变化统计:', changeMap.size);

    // 保存当前导出数据（现在是 Map 格式）
    currentExportChangeData = changeMap;
    currentExportHistoryRecord = record;
    currentExportBookmarkTree = treeToExport;
    currentExportHistoryTreeContainer = useDomTreeContainer ? (treeContainer || document.querySelector('#modalBody .history-tree-container')) : null;

    // 显示模态框
    const modal = document.getElementById('exportChangesModal');
    if (modal) {
        modal.classList.add('show');
        // 重置为默认值
        const formatHtml = modal.querySelector('input[name="exportChangesFormat"][value="html"]');
        if (formatHtml) formatHtml.checked = true;

        // 使用当前备份历史的详略模式
        const modeValue = preferredMode || getRecordDetailMode(recordTime) || historyDetailMode || 'simple';
        const modeRadio = modal.querySelector(`input[name="exportChangesMode"][value="${modeValue}"]`);
        if (modeRadio) modeRadio.checked = true;

        const actionDownload = modal.querySelector('input[name="exportChangesAction"][value="download"]');
        if (actionDownload) actionDownload.checked = true;
        updateExportChangesActionOptionsByMode(modal);

        // 隐藏扩展层级
        const depthSection = document.getElementById('exportChangesDepthSection');
        if (depthSection) depthSection.style.display = 'none';

        // 隐藏详细模式说明
        const helpContent = document.getElementById('exportChangesDetailedHelpContent');
        if (helpContent) helpContent.style.display = 'none';

        // 隐藏标记说明
        const legendHelpContent = document.getElementById('exportChangesLegendHelpContent');
        if (legendHelpContent) legendHelpContent.style.display = 'none';
    }
}

// 初始化导出变化模态框
function initExportChangesModal() {
    const modal = document.getElementById('exportChangesModal');
    if (!modal) return;

    // 关闭按钮
    const closeBtn = document.getElementById('exportChangesModalClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('show');
            // 清除历史导出数据
            currentExportHistoryRecord = null;
            currentExportBookmarkTree = null;
            currentExportHistoryTreeContainer = null;
        });
    }

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
            // 清除历史导出数据
            currentExportHistoryRecord = null;
            currentExportBookmarkTree = null;
            currentExportHistoryTreeContainer = null;
        }
    });

    // 模式切换 - 控制扩展层级显示
    const modeRadios = modal.querySelectorAll('input[name="exportChangesMode"]');
    const depthSection = document.getElementById('exportChangesDepthSection');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (depthSection) {
                // 新的详细模式（快照）不需要手动选择层级，完全依赖界面展开状态
                // 所以隐藏层级选择器
                depthSection.style.display = 'none';
            }
            updateExportChangesActionOptionsByMode(modal);
            // 切换模式时隐藏帮助内容
            const helpContent = document.getElementById('exportChangesDetailedHelpContent');
            if (helpContent) helpContent.style.display = 'none';
        });
    });

    // 绑定标记说明图标点击事件
    const legendHelpIcon = document.getElementById('exportChangesLegendHelp');
    if (legendHelpIcon) {
        legendHelpIcon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const legendHelpContent = document.getElementById('exportChangesLegendHelpContent');
            if (legendHelpContent) {
                legendHelpContent.style.display = legendHelpContent.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    // 绑定帮助图标点击事件
    const helpIcon = document.getElementById('exportChangesDetailedHelp');
    if (helpIcon) {
        helpIcon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 切换功能说明显示状态
            const helpContent = document.getElementById('exportChangesDetailedHelpContent');
            if (helpContent) {
                if (helpContent.style.display === 'none') {
                    const isZh = currentLang === 'zh_CN';
                    helpContent.innerHTML = isZh
                        ? '<strong>模式说明：</strong><br>• 简略：仅导出有变化的分支，保持原生书签树层级。<br>• 详细：导出 html 页面「当前变化」里已展开的内容（所见即所得）。<br>• 集合：按增加/删除/移动/修改分组导出为文件夹集合。'
                        : '<strong>Mode Guide:</strong><br>• Simple: Export changed branches only, keeping native bookmark-tree hierarchy.<br>• Detailed: Export expanded content from the HTML "Current Changes" page (WYSIWYG).<br>• Collection: Export grouped folders by Added/Deleted/Moved/Modified.';
                    helpContent.style.display = 'block';
                } else {
                    helpContent.style.display = 'none';
                }
            }
        });
    }

    // 扩展层级滑块
    const depthSlider = document.getElementById('exportChangesDepth');
    const depthValue = document.getElementById('exportChangesDepthValue');
    if (depthSlider && depthValue) {
        depthSlider.addEventListener('input', () => {
            const val = parseInt(depthSlider.value);
            const isZh = currentLang === 'zh_CN';
            if (val === 0) {
                depthValue.textContent = isZh ? '仅同级' : 'Same level';
            } else {
                depthValue.textContent = isZh ? `${val} 层` : `${val} level${val > 1 ? 's' : ''}`;
            }
        });
    }

    // 开始导出按钮
    const exportBtn = document.getElementById('doExportChangesBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            executeExportChanges();
        });
    }
}

// 执行导出
async function executeExportChanges() {
    const modal = document.getElementById('exportChangesModal');
    if (!modal || !currentExportChangeData) return;

    const format = modal.querySelector('input[name="exportChangesFormat"]:checked')?.value || 'html';
    const mode = modal.querySelector('input[name="exportChangesMode"]:checked')?.value || 'simple';
    const action = modal.querySelector('input[name="exportChangesAction"]:checked')?.value || 'download';
    const depth = parseInt(document.getElementById('exportChangesDepth')?.value || '1');
    const confirmBtn = document.getElementById('doExportChangesBtn');

    // 保存原始按钮状态
    const originalBtnHTML = confirmBtn.innerHTML;
    const isZh = currentLang === 'zh_CN';

    // 判断是否是备份历史导出
    const isHistoryExport = !!currentExportHistoryRecord;
    const useHistoryDomTree = isHistoryExport && !!currentExportHistoryTreeContainer;

    try {
        let content = '';
        let filename = '';
        const timestamp = formatTimeForFilename(); // 当前时间（导出时间）

        // 设置按钮加载状态
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${isZh ? '处理中...' : 'Processing...'}`;

        // 稍微延迟一下让UI更新，避免大计算量卡顿
        await new Promise(resolve => setTimeout(resolve, 50));

        if (format === 'html') {
            if (isHistoryExport) {
                // 备份历史导出 - 优先使用详情面板DOM（所见即所得）
                content = useHistoryDomTree
                    ? await generateHistoryChangesHTMLFromDOM(currentExportHistoryTreeContainer, mode)
                    : await generateHistoryChangesHTML(currentExportBookmarkTree, currentExportChangeData, mode);

                // Construct filename: Note_Hash_Mode_Time
                const record = currentExportHistoryRecord;
                const dateStr = formatTimeForFilename(record.time); // 备份时间（本地时间）
                const cleanNote = record.note ? record.note.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_') : '';
                const fingerprint = record.fingerprint ? `_${record.fingerprint.substring(0, 8)}` : '';
                const modeStr = mode === 'detailed'
                    ? (isZh ? '_详细' : '_Detailed')
                    : (mode === 'collection' ? (isZh ? '_集合' : '_Collection') : (isZh ? '_简略' : '_Simple'));
                const defaultPrefix = isZh ? '书签' : 'bookmark';

                const baseName = cleanNote
                    ? `${cleanNote}${fingerprint}${modeStr}_${dateStr}`
                    : `${defaultPrefix}${fingerprint}${modeStr}_${dateStr}`;

                filename = `${baseName}.html`;
            } else {
                // 当前变化导出 - 与主 UI 自动归档同源生成
                content = await generateChangesHTML(currentExportChangeData, mode, depth);
                const changesPrefix = isZh ? '书签变化' : 'bookmark-changes';
                const suggestedName = String(currentChangesManualExportLastFileName || '').trim();
                filename = (/\.html$/i.test(suggestedName) ? suggestedName : `${changesPrefix}-${timestamp}.html`);
            }
        } else {
            if (isHistoryExport) {
                // 备份历史导出 - 优先使用详情面板DOM（所见即所得）
                content = useHistoryDomTree
                    ? await generateHistoryChangesJSONFromDOM(currentExportHistoryTreeContainer, mode)
                    : await generateHistoryChangesJSON(currentExportBookmarkTree, currentExportChangeData, mode);

                // Construct filename: Note_Hash_Mode_Time
                const record = currentExportHistoryRecord;
                const dateStr = formatTimeForFilename(record.time); // 备份时间（本地时间）
                const cleanNote = record.note ? record.note.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_') : '';
                const fingerprint = record.fingerprint ? `_${record.fingerprint.substring(0, 8)}` : '';
                const modeStr = mode === 'detailed'
                    ? (isZh ? '_详细' : '_Detailed')
                    : (mode === 'collection' ? (isZh ? '_集合' : '_Collection') : (isZh ? '_简略' : '_Simple'));
                const defaultPrefix = isZh ? '书签' : 'bookmark';

                const baseName = cleanNote
                    ? `${cleanNote}${fingerprint}${modeStr}_${dateStr}`
                    : `${defaultPrefix}${fingerprint}${modeStr}_${dateStr}`;

                filename = `${baseName}.json`;
            } else {
                // 当前变化导出 - 与主 UI 自动归档同源生成
                content = await generateChangesJSON(currentExportChangeData, mode, depth);
                const changesPrefix = isZh ? '书签变化' : 'bookmark-changes';
                const suggestedName = String(currentChangesManualExportLastFileName || '').trim();
                filename = (/\.json$/i.test(suggestedName) ? suggestedName : `${changesPrefix}-${timestamp}.json`);
            }
            // 如果是 JSON 格式，content 是对象，需要 stringify
            if (typeof content === 'object') {
                content = JSON.stringify(content, null, 2);
            }
        }

        if (action === 'download') {
            // 同步导出到云端（云端1 WebDAV + 云端2 GitHub Repo）
            try {
                if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
                    const folderKey = isHistoryExport ? 'history' : 'current_changes';
                    const contentType = format === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8';
                    chrome.runtime.sendMessage({
                        action: 'exportFileToClouds',
                        folderKey,
                        lang: currentLang,
                        fileName: filename,
                        content,
                        contentType
                    }, (resp) => {
                        try {
                            if (!resp) return;
                            const isEnLang = currentLang !== 'zh_CN';

                            const webdavOk = resp.webdav && resp.webdav.success === true;
                            const githubRepoOk = resp.githubRepo && resp.githubRepo.success === true;
                            const webdavSkipped = resp.webdav && resp.webdav.skipped === true;
                            const githubRepoSkipped = resp.githubRepo && resp.githubRepo.skipped === true;

                            if (webdavOk && githubRepoOk) {
                                showToast(isEnLang ? 'Uploaded to Cloud 1 & Cloud 2' : '已上传到云端1&云端2');
                                return;
                            }
                            if (webdavOk) {
                                showToast(isEnLang ? 'Uploaded to Cloud 1 (WebDAV)' : '已上传到云端1(WebDAV)');
                                return;
                            }
                            if (githubRepoOk) {
                                showToast(isEnLang ? 'Uploaded to Cloud 2 (GitHub Repo)' : '已上传到云端2(GitHub仓库)');
                                return;
                            }

                            const attempted = !(webdavSkipped && githubRepoSkipped);
                            const errorMsg = resp.webdav?.error || resp.githubRepo?.error || resp.error || null;
                            if (attempted && errorMsg) {
                                showToast(isEnLang ? `Cloud upload failed: ${errorMsg}` : `云端上传失败：${errorMsg}`);
                            }
                        } catch (_) { }
                    });
                }
            } catch (_) { }

            // 下载文件 - 使用统一的导出文件夹结构
            const blob = new Blob([content], { type: format === 'html' ? 'text/html' : 'application/json' });
            const url = URL.createObjectURL(blob);

            // 根据导出类型选择不同的子文件夹（根据语言动态选择）
            const exportSubFolder = isHistoryExport ? getHistoryExportFolder() : getCurrentChangesExportFolder();
            const exportPath = `${getHistoryExportRootFolder()}/${exportSubFolder}`;

            // 尝试使用 chrome.downloads API 以支持子目录
            if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
                chrome.downloads.download({
                    url: url,
                    filename: `${exportPath}/${filename}`,
                    saveAs: false,
                    conflictAction: 'uniquify'
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.warn('chrome.downloads API failed, falling back to <a> tag:', chrome.runtime.lastError);
                        // 降级方案
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        a.click();
                    }
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                });
            } else {
                // 降级方案
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            }
        } else {
            // 复制到剪贴板
            await navigator.clipboard.writeText(content);
        }

        // 显示成功状态（绿色背景 + 绿色脉冲）
        confirmBtn.style.setProperty('background-color', 'var(--success)', 'important');
        confirmBtn.style.setProperty('color', 'white', 'important');
        confirmBtn.style.setProperty('border-color', 'var(--success)', 'important');
        confirmBtn.style.animation = 'pulse-green 1s';

        // 图标白色，并添加弹跳动画
        confirmBtn.innerHTML = `<i class="fas fa-check-circle" style="color: white; animation: bounce-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); font-size: 1.2em;"></i> ${isZh ? '成功' : 'Success'}`;

        // 1.5秒后关闭模态框并恢复按钮
        setTimeout(() => {
            modal.classList.remove('show');
            // 清除历史导出数据
            currentExportHistoryRecord = null;
            currentExportBookmarkTree = null;
            currentExportHistoryTreeContainer = null;
            // 恢复按钮状态
            setTimeout(() => {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = originalBtnHTML;
                confirmBtn.style.backgroundColor = '';
                confirmBtn.style.color = '';
                confirmBtn.style.borderColor = '';
                confirmBtn.style.animation = ''; // 清除动画
            }, 300);
        }, 1200);

    } catch (error) {
        console.error('[导出变化] 失败:', error);

        // 显示错误状态
        confirmBtn.style.backgroundColor = 'var(--danger-color)';
        confirmBtn.style.color = 'white';
        confirmBtn.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${isZh ? '失败' : 'Failed'}`;

        alert(isZh ? `导出失败: ${error.message}` : `Export failed: ${error.message}`);

        // 恢复按钮状态
        setTimeout(() => {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalBtnHTML;
            confirmBtn.style.backgroundColor = '';
            confirmBtn.style.color = '';
        }, 2000);
    }
}

function formatExportTimeText(date = new Date()) {
    try {
        if (typeof formatTime === 'function') {
            return formatTime(date);
        }
        return date.toLocaleString();
    } catch (e) {
        return new Date().toISOString();
    }
}

function getChangeCountsFromChangeData(changeData) {
    if (!changeData) return null;
    const diffMeta = changeData.diffMeta || {};
    const stats = changeData.stats || {};

    const bookmarkDiff = typeof diffMeta.bookmarkDiff === 'number' ? diffMeta.bookmarkDiff : 0;
    const folderDiff = typeof diffMeta.folderDiff === 'number' ? diffMeta.folderDiff : 0;

    const addedBookmarks = bookmarkDiff > 0 ? bookmarkDiff : 0;
    const deletedBookmarks = bookmarkDiff < 0 ? Math.abs(bookmarkDiff) : 0;
    const addedFolders = folderDiff > 0 ? folderDiff : 0;
    const deletedFolders = folderDiff < 0 ? Math.abs(folderDiff) : 0;

    const bookmarkMoved = typeof stats.bookmarkMoved === 'number' ? stats.bookmarkMoved : (stats.bookmarkMoved ? 1 : 0);
    const folderMoved = typeof stats.folderMoved === 'number' ? stats.folderMoved : (stats.folderMoved ? 1 : 0);
    const bookmarkModified = typeof stats.bookmarkModified === 'number' ? stats.bookmarkModified : (stats.bookmarkModified ? 1 : 0);
    const folderModified = typeof stats.folderModified === 'number' ? stats.folderModified : (stats.folderModified ? 1 : 0);

    const counts = {
        added: { bookmarks: addedBookmarks, folders: addedFolders },
        deleted: { bookmarks: deletedBookmarks, folders: deletedFolders },
        modified: { bookmarks: bookmarkModified, folders: folderModified },
        moved: { bookmarks: bookmarkMoved, folders: folderMoved }
    };

    if (addedBookmarks || addedFolders || deletedBookmarks || deletedFolders || bookmarkModified || folderModified || bookmarkMoved || folderMoved) {
        return counts;
    }
    return null;
}

function countChangeTypesFromDOM(treeContainer) {
    if (!treeContainer) {
        return {
            added: { bookmarks: 0, folders: 0 },
            deleted: { bookmarks: 0, folders: 0 },
            modified: { bookmarks: 0, folders: 0 },
            moved: { bookmarks: 0, folders: 0 }
        };
    }
    const treeRoot = treeContainer.querySelector('.bookmark-tree') || treeContainer;
    if (!treeRoot) {
        return {
            added: { bookmarks: 0, folders: 0 },
            deleted: { bookmarks: 0, folders: 0 },
            modified: { bookmarks: 0, folders: 0 },
            moved: { bookmarks: 0, folders: 0 }
        };
    }

    const counts = {
        added: { bookmarks: 0, folders: 0 },
        deleted: { bookmarks: 0, folders: 0 },
        modified: { bookmarks: 0, folders: 0 },
        moved: { bookmarks: 0, folders: 0 }
    };
    treeRoot.querySelectorAll('.tree-item').forEach(item => {
        const type = item.dataset.nodeType || (item.querySelector('.tree-bookmark-link') ? 'bookmark' : 'folder');
        const target = type === 'folder' ? 'folders' : 'bookmarks';
        if (item.classList.contains('tree-change-added')) counts.added[target] += 1;
        if (item.classList.contains('tree-change-deleted')) counts.deleted[target] += 1;
        if (item.classList.contains('tree-change-modified')) counts.modified[target] += 1;
        if (item.classList.contains('tree-change-moved')) counts.moved[target] += 1;
        if (item.classList.contains('tree-change-mixed')) {
            counts.modified[target] += 1;
            counts.moved[target] += 1;
        }
    });
    return counts;
}

function getHistoryChangeCounts(changeMap, bookmarkTree) {
    const counts = {
        added: { bookmarks: 0, folders: 0 },
        deleted: { bookmarks: 0, folders: 0 },
        modified: { bookmarks: 0, folders: 0 },
        moved: { bookmarks: 0, folders: 0 }
    };
    if (!changeMap) return counts;

    const nodeMap = new Map();
    function buildNodeMap(node) {
        if (!node) return;
        if (node.id) nodeMap.set(node.id, node);
        if (node.children) node.children.forEach(buildNodeMap);
    }
    const treeNodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    treeNodes.forEach(buildNodeMap);

    changeMap.forEach((change, id) => {
        if (!change || !change.type) return;
        const node = nodeMap.get(id);
        const isFolder = node && !node.url && node.children;
        const bucket = isFolder ? 'folders' : 'bookmarks';
        const types = change.type.split('+');
        if (types.includes('added')) counts.added[bucket] += 1;
        if (types.includes('deleted')) counts.deleted[bucket] += 1;
        if (types.includes('modified')) counts.modified[bucket] += 1;
        if (types.includes('moved')) counts.moved[bucket] += 1;
    });

    return counts;
}

function formatCountsLine(counts, isZh) {
    const labels = isZh
        ? { added: '新增', deleted: '删除', modified: '修改', moved: '移动', b: '书签', f: '文件夹' }
        : { added: 'Added', deleted: 'Deleted', modified: 'Modified', moved: 'Moved', b: 'BKM', f: 'FLD' };
    const formatPair = (pair) => {
        const parts = [];
        if (pair.bookmarks) parts.push(`${pair.bookmarks}${labels.b}`);
        if (pair.folders) parts.push(`${pair.folders}${labels.f}`);
        return parts.join(' ');
    };
    const parts = [];
    if (counts.added.bookmarks || counts.added.folders) parts.push(`${labels.added}:${formatPair(counts.added)}`);
    if (counts.deleted.bookmarks || counts.deleted.folders) parts.push(`${labels.deleted}:${formatPair(counts.deleted)}`);
    if (counts.modified.bookmarks || counts.modified.folders) parts.push(`${labels.modified}:${formatPair(counts.modified)}`);
    if (counts.moved.bookmarks || counts.moved.folders) parts.push(`${labels.moved}:${formatPair(counts.moved)}`);
    return parts.join('  ');
}

function hasAnyCounts(counts) {
    if (!counts) return false;
    return Object.values(counts).some(pair => (pair?.bookmarks || pair?.folders));
}

function getCurrentChangesTreeItemChangeTypes(treeItem) {
    const types = [];
    if (!treeItem) return types;

    if (treeItem.classList.contains('tree-change-added')) types.push('added');
    if (treeItem.classList.contains('tree-change-deleted')) types.push('deleted');
    if (treeItem.classList.contains('tree-change-modified')) types.push('modified');
    if (treeItem.classList.contains('tree-change-moved')) types.push('moved');

    if (treeItem.classList.contains('tree-change-mixed')) {
        if (!types.includes('modified')) types.push('modified');
        if (!types.includes('moved')) types.push('moved');
    }

    return types;
}

function buildCurrentChangesCollectionGroupsFromDOM(bookmarkTreeRoot, counts, isZh) {
    if (!bookmarkTreeRoot) return [];

    const buckets = {
        added: [],
        deleted: [],
        moved: [],
        modified: []
    };

    const readPair = (key) => ({
        bookmarks: Number(counts?.[key]?.bookmarks || 0),
        folders: Number(counts?.[key]?.folders || 0)
    });

    const formatPairText = (pair) => {
        const parts = [];
        if (pair.bookmarks > 0) {
            parts.push(isZh ? `${pair.bookmarks}个书签` : `${pair.bookmarks} bookmarks`);
        }
        if (pair.folders > 0) {
            parts.push(isZh ? `${pair.folders}个文件夹` : `${pair.folders} folders`);
        }
        return parts.join(isZh ? '，' : ', ');
    };

    const buildGroupTitle = ({ marker, zhVerb, enVerb, pair }) => {
        const pairText = formatPairText(pair);
        if (pairText) {
            return isZh ? `${marker} ${zhVerb}${pairText}` : `${marker} ${enVerb} ${pairText}`;
        }
        const total = Number(pair.bookmarks || 0) + Number(pair.folders || 0);
        if (total > 0) {
            return isZh ? `${marker} ${zhVerb}${total}项` : `${marker} ${enVerb} ${total} items`;
        }
        return isZh ? `${marker} ${zhVerb}` : `${marker} ${enVerb}`;
    };

    const buildNodeItemFromTreeItem = (treeItem, changeType = '') => {
        if (!treeItem) return null;

        let title = treeItem.dataset.nodeTitle || treeItem.querySelector('.tree-label')?.textContent?.trim() || '';
        const link = treeItem.querySelector('a.tree-bookmark-link') || treeItem.querySelector('a');
        if (!title && link) title = link.textContent?.trim() || '';
        if (!title) title = isZh ? '根目录' : 'Root';

        const url = treeItem.dataset.nodeUrl || (link ? (link.getAttribute('href') || '') : '');
        const nodeType = treeItem.dataset.nodeType;
        const isFolder = nodeType === 'folder' || !url;

        return {
            title,
            type: isFolder ? 'folder' : 'bookmark',
            ...(url ? { url } : {}),
            ...(changeType ? { changeType } : {})
        };
    };

    const buildFullSubtreeEntry = (treeNode, changeType = '') => {
        if (!treeNode) return null;

        const treeItem = treeNode.querySelector(':scope > .tree-item');
        if (!treeItem) return null;

        const item = buildNodeItemFromTreeItem(treeItem, changeType);
        if (!item) return null;

        if (item.type === 'folder') {
            const childrenContainer = treeNode.querySelector(':scope > .tree-children');
            if (childrenContainer) {
                item.children = Array.from(childrenContainer.querySelectorAll(':scope > .tree-node'))
                    .map(childNode => buildFullSubtreeEntry(childNode, ''))
                    .filter(Boolean);
            } else {
                item.children = [];
            }
        }

        return item;
    };

    const appendEntry = (bucketKey, treeNode, changeType, options = {}) => {
        const includeDescendants = options.includeDescendants === true;
        if (!treeNode || !bucketKey || !buckets[bucketKey]) return;

        if (includeDescendants) {
            const subtreeEntry = buildFullSubtreeEntry(treeNode, changeType);
            if (subtreeEntry) buckets[bucketKey].push(subtreeEntry);
            return;
        }

        const treeItem = treeNode.querySelector(':scope > .tree-item');
        if (!treeItem) return;
        const item = buildNodeItemFromTreeItem(treeItem, changeType);
        if (item) buckets[bucketKey].push(item);
    };

    const traverse = (nodeEl) => {
        if (!nodeEl) return;
        const treeNodes = nodeEl.querySelectorAll(':scope > .tree-node');

        treeNodes.forEach(treeNode => {
            const treeItem = treeNode.querySelector(':scope > .tree-item');
            if (!treeItem) return;

            const types = getCurrentChangesTreeItemChangeTypes(treeItem);
            const nodeType = treeItem.dataset.nodeType;
            const link = treeItem.querySelector('a.tree-bookmark-link') || treeItem.querySelector('a');
            const url = treeItem.dataset.nodeUrl || (link ? (link.getAttribute('href') || '') : '');
            const isFolder = nodeType === 'folder' || !url;

            if (types.includes('added')) appendEntry('added', treeNode, 'added');
            if (types.includes('deleted')) appendEntry('deleted', treeNode, 'deleted');
            if (types.includes('moved')) appendEntry('moved', treeNode, 'moved', { includeDescendants: isFolder });
            if (types.includes('modified')) appendEntry('modified', treeNode, 'modified', { includeDescendants: isFolder });

            const childrenContainer = treeNode.querySelector(':scope > .tree-children');
            if (childrenContainer) {
                traverse(childrenContainer);
            }
        });
    };

    traverse(bookmarkTreeRoot);

    const groupDefs = [
        { key: 'added', marker: '[+]', zhVerb: '增加了', enVerb: 'Added' },
        { key: 'deleted', marker: '[-]', zhVerb: '删除了', enVerb: 'Deleted' },
        { key: 'moved', marker: '[>>]', zhVerb: '移动了', enVerb: 'Moved' },
        { key: 'modified', marker: '[~]', zhVerb: '修改了', enVerb: 'Modified' }
    ];

    return groupDefs
        .map(def => {
            const children = buckets[def.key] || [];
            const pair = readPair(def.key);
            return {
                title: buildGroupTitle({
                    marker: def.marker,
                    zhVerb: def.zhVerb,
                    enVerb: def.enVerb,
                    pair
                }),
                type: 'folder',
                children
            };
        })
        .filter(group => Array.isArray(group.children) && group.children.length > 0);
}

function normalizeCurrentChangesExportModeManual(mode) {
    const text = String(mode || '').toLowerCase();
    if (text === 'detailed') return 'detailed';
    if (text === 'collection') return 'collection';
    return 'simple';
}

function normalizeCurrentChangesExportStatsManual(changeData) {
    const stats = changeData?.stats || {};
    const diffMeta = changeData?.diffMeta || {};
    const toNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    const bookmarkDiff = toNum(diffMeta.bookmarkDiff ?? stats.bookmarkDiff);
    const folderDiff = toNum(diffMeta.folderDiff ?? stats.folderDiff);

    const bookmarkAdded = toNum(stats.bookmarkAdded) || (bookmarkDiff > 0 ? bookmarkDiff : 0);
    const bookmarkDeleted = toNum(stats.bookmarkDeleted) || (bookmarkDiff < 0 ? Math.abs(bookmarkDiff) : 0);
    const folderAdded = toNum(stats.folderAdded) || (folderDiff > 0 ? folderDiff : 0);
    const folderDeleted = toNum(stats.folderDeleted) || (folderDiff < 0 ? Math.abs(folderDiff) : 0);

    const movedBookmarkCount = toNum(stats.movedBookmarkCount) || (stats.bookmarkMoved ? 1 : 0);
    const movedFolderCount = toNum(stats.movedFolderCount) || (stats.folderMoved ? 1 : 0);
    const modifiedBookmarkCount = toNum(stats.modifiedBookmarkCount) || (stats.bookmarkModified ? 1 : 0);
    const modifiedFolderCount = toNum(stats.modifiedFolderCount) || (stats.folderModified ? 1 : 0);

    const movedCount = toNum(stats.movedCount) || (movedBookmarkCount + movedFolderCount);
    const modifiedCount = toNum(stats.modifiedCount) || (modifiedBookmarkCount + modifiedFolderCount);

    return {
        bookmarkAdded,
        bookmarkDeleted,
        folderAdded,
        folderDeleted,
        movedCount,
        modifiedCount,
        movedBookmarkCount,
        movedFolderCount,
        modifiedBookmarkCount,
        modifiedFolderCount,
        bookmarkCount: (typeof stats.bookmarkCount === 'number' ? stats.bookmarkCount : (typeof stats.currentBookmarkCount === 'number' ? stats.currentBookmarkCount : null)),
        folderCount: (typeof stats.folderCount === 'number' ? stats.folderCount : (typeof stats.currentFolderCount === 'number' ? stats.currentFolderCount : null))
    };
}

function buildCurrentChangesStatsLineManual(stats, lang) {
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

function getCurrentChangesExportExpandedIdsManual() {
    try {
        const previewTree = document.querySelector('#changesTreePreviewInline #preview_bookmarkTree')
            || document.querySelector('#changesTreePreviewInline .bookmark-tree');
        if (previewTree) {
            return __captureTreeExpandedNodeIds(previewTree);
        }
    } catch (_) { }

    try {
        const stored = getChangesPreviewExpandedState();
        if (Array.isArray(stored)) {
            return new Set(stored.map(v => String(v)));
        }
    } catch (_) { }

    return new Set();
}

async function getCurrentChangesExportTreeDataManual(mode) {
    try {
        await ensureChangesPreviewTreeDataLoaded({ requireDiffMap: true });
    } catch (_) { }

    const changeMap = treeChangeMap instanceof Map ? treeChangeMap : new Map();
    const currentTree = Array.isArray(cachedCurrentTree) ? cachedCurrentTree : [];
    const oldTree = Array.isArray(cachedOldTree) ? cachedOldTree : null;

    let treeToExport = currentTree;
    if (oldTree && currentTree && changeMap.size > 0) {
        let hasDeleted = false;
        for (const [, change] of changeMap) {
            if (change?.type && String(change.type).includes('deleted')) {
                hasDeleted = true;
                break;
            }
        }
        if (hasDeleted) {
            try {
                treeToExport = rebuildTreeWithDeleted(oldTree, currentTree, changeMap);
            } catch (_) {
                treeToExport = currentTree;
            }
        }
    }

    const expandedIds = mode === 'detailed' ? getCurrentChangesExportExpandedIdsManual() : null;
    return { treeToExport, changeMap, expandedIds };
}

function buildCurrentChangesExportTreeManual(bookmarkTree, changeMap, options = {}) {
    const mode = options?.mode === 'detailed'
        ? 'detailed'
        : (options?.mode === 'collection' ? 'collection' : 'simple');
    const expandedIds = options?.expandedIds instanceof Set ? options.expandedIds : null;
    const isZh = options?.lang === 'zh_CN';
    const stats = options?.stats || {};
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

        const appendEntry = (bucketKey, node, changeType, options2 = {}) => {
            const includeDescendants = options2?.includeDescendants === true;
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

async function buildCurrentChangesExportPayloadManual(changeData, mode) {
    const normalizedMode = normalizeCurrentChangesExportModeManual(mode);
    const isZh = currentLang === 'zh_CN';
    const lang = isZh ? 'zh_CN' : 'en';

    const { treeToExport, changeMap, expandedIds } = await getCurrentChangesExportTreeDataManual(normalizedMode);
    const normalizedStats = normalizeCurrentChangesExportStatsManual(changeData);

    const exportChildren = buildCurrentChangesExportTreeManual(treeToExport, changeMap, {
        mode: normalizedMode,
        expandedIds,
        lang,
        stats: normalizedStats
    });

    const exportTimeText = new Date().toLocaleString(isZh ? 'zh-CN' : 'en-US');
    const countsLine = buildCurrentChangesStatsLineManual(normalizedStats, lang);
    const legendTitle = isZh
        ? `前缀说明: [+]新增  [-]删除  [~]修改  [>>]移动`
        : `Prefix legend: [+]Added  [-]Deleted  [~]Modified  [>>]Moved`;

    return {
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
            exportMode: normalizedMode,
            source: 'bookmark-backup-changes',
            legend: {
                '[+]': isZh ? '新增' : 'Added',
                '[-]': isZh ? '删除' : 'Deleted',
                '[~]': isZh ? '修改' : 'Modified',
                '[>>]': isZh ? '移动' : 'Moved'
            }
        }
    };
}

function buildCurrentChangesNetscapeHtmlManual(payload, lang) {
    const isZh = lang === 'zh_CN';
    const title = isZh ? '书签变化' : 'Bookmark Changes';
    const heading = title;
    const payloadJsonText = JSON.stringify(payload || {}, null, 2);
    const scriptSafeJson = String(payloadJsonText || '').replace(/<\/script/gi, '<\\/script');

    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    html += `<TITLE>${escapeHtml(title)}</TITLE>\n`;
    html += `<H1>${escapeHtml(heading)}</H1>\n`;
    html += `<script type="application/json" id="bookmarkCurrentChangesData">${scriptSafeJson}</script>\n`;
    html += '<DL><p>\n';

    const walk = (nodes, level = 1) => {
        if (!Array.isArray(nodes) || nodes.length === 0) return;

        nodes.forEach(node => {
            if (!node || typeof node !== 'object') return;

            const indent = '    '.repeat(level);
            const nodeTitle = escapeHtml(node.title || (isZh ? '(无标题)' : '(Untitled)'));
            const hasChildren = Array.isArray(node.children);
            const isFolder = hasChildren || (!node.url && node.type === 'folder');

            if (isFolder) {
                html += `${indent}<DT><H3>${nodeTitle}</H3>\n`;
                html += `${indent}<DL><p>\n`;
                walk(hasChildren ? node.children : [], level + 1);
                html += `${indent}</DL><p>\n`;
            } else {
                const href = escapeHtml(node.url || 'about:blank');
                html += `${indent}<DT><A HREF="${href}">${nodeTitle}</A>\n`;
            }
        });
    };

    walk(Array.isArray(payload?.children) ? payload.children : []);

    html += '</DL><p>\n';
    return html;
}

async function buildCurrentChangesManualExportFallback({ mode, format, changeData }) {
    const payload = await buildCurrentChangesExportPayloadManual(changeData, mode);
    currentChangesManualExportLastFileName = '';

    if (format === 'json') {
        return JSON.stringify(payload, null, 2);
    }

    const lang = currentLang === 'zh_CN' ? 'zh_CN' : 'en';
    return buildCurrentChangesNetscapeHtmlManual(payload, lang);
}

async function requestCurrentChangesManualExportFromBackground({ mode, format, changeData }) {
    const timeoutMs = 12000;

    try {
        const response = await new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('Current changes export request timed out'));
            }, timeoutMs);

            const finalize = (handler) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                handler();
            };

            try {
                browserAPI.runtime.sendMessage({
                    action: 'buildCurrentChangesManualExport',
                    mode,
                    format,
                    lang: currentLang
                }, (responseData) => {
                    const runtimeError = browserAPI.runtime.lastError;
                    if (runtimeError) {
                        finalize(() => reject(new Error(runtimeError.message || 'Failed to request current changes export')));
                        return;
                    }
                    finalize(() => resolve(responseData));
                });
            } catch (error) {
                finalize(() => reject(error));
            }
        });

        if (!response || response.success !== true || typeof response.content !== 'string') {
            throw new Error(response?.error || 'Failed to build current changes export content');
        }

        currentChangesManualExportLastFileName = String(response.fileName || '').trim();
        return response.content;
    } catch (error) {
        console.warn('[requestCurrentChangesManualExportFromBackground] fallback to local builder:', error);
        return await buildCurrentChangesManualExportFallback({ mode, format, changeData });
    }
}

// 生成变化HTML
async function generateChangesHTML(changeData, mode, depth) {
    const normalizedMode = normalizeCurrentChangesExportModeManual(mode);
    return await requestCurrentChangesManualExportFromBackground({
        mode: normalizedMode,
        format: 'html',
        changeData
    });
}

// 生成变化JSON
async function generateChangesJSON(changeData, mode, depth) {
    const normalizedMode = normalizeCurrentChangesExportModeManual(mode);
    return await requestCurrentChangesManualExportFromBackground({
        mode: normalizedMode,
        format: 'json',
        changeData
    });
}

// 生成备份历史的变化HTML（从详情面板DOM提取，所见即所得）
async function generateHistoryChangesHTMLFromDOM(treeContainer, mode) {
    const isZh = currentLang === 'zh_CN';

    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    html += `<TITLE>${isZh ? '书签变化' : 'Bookmark Changes'}</TITLE>\n`;
    html += `<H1>${isZh ? '书签变化' : 'Bookmark Changes'}</H1>\n`;
    html += '<DL><p>\n';

    const legendText = isZh
        ? '📋 前缀说明: [+]新增  [-]删除  [~]修改  [>>]移动'
        : '📋 Prefix legend: [+]Added  [-]Deleted  [~]Modified  [>>]Moved';
    html += `    <DT><H3>${legendText}</H3>\n`;
    const counts = getHistoryChangeCounts(currentExportChangeData, currentExportBookmarkTree);
    const exportTimeText = formatExportTimeText();
    const backupTimeText = currentExportHistoryRecord?.time
        ? (typeof formatTime === 'function' ? formatTime(new Date(currentExportHistoryRecord.time)) : new Date(currentExportHistoryRecord.time).toLocaleString())
        : '';
    const noteText = currentExportHistoryRecord?.note ? currentExportHistoryRecord.note : (isZh ? '（无备注）' : '(No note)');
    html += `    <DL><p>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '操作统计' : 'Operation Counts'}: ${formatCountsLine(counts, isZh)}</A>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '导出时间' : 'Export Time'}: ${escapeHtml(exportTimeText)}</A>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '备份时间' : 'Backup Time'}: ${escapeHtml(backupTimeText)}</A>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '备注' : 'Note'}: ${escapeHtml(noteText)}</A>\n`;
    html += `    </DL><p>\n`;

    const bookmarkTree = treeContainer?.classList?.contains('bookmark-tree')
        ? treeContainer
        : treeContainer?.querySelector?.('.bookmark-tree');

    if (!bookmarkTree) {
        html += `    <DT><H3>${isZh ? '(无书签树数据)' : '(No bookmark tree data)'}</H3>\n`;
        html += '</DL><p>\n';
        return html;
    }

    // History detail tree uses an extra wrapper for root children to align visuals.
    // DOM export must treat that wrapper as the "root children container",
    // otherwise ':scope > .tree-node' would return empty.
    const bookmarkTreeRoot = bookmarkTree.querySelector(':scope > .history-tree-root-children') || bookmarkTree;

    function hasChanges(treeNode) {
        const treeItem = treeNode.querySelector(':scope > .tree-item');
        if (!treeItem) return false;

        if (treeItem.classList.contains('tree-change-added') ||
            treeItem.classList.contains('tree-change-deleted') ||
            treeItem.classList.contains('tree-change-modified') ||
            treeItem.classList.contains('tree-change-moved') ||
            treeItem.classList.contains('tree-change-mixed')) {
            return true;
        }

        const childrenContainer = treeNode.querySelector(':scope > .tree-children');
        if (childrenContainer) {
            const childNodes = childrenContainer.querySelectorAll(':scope > .tree-node');
            for (const child of childNodes) {
                if (hasChanges(child)) return true;
            }
        }

        return false;
    }

    function getChangePrefixFromItem(treeItem) {
        if (treeItem.classList.contains('tree-change-added')) return '[+] ';
        if (treeItem.classList.contains('tree-change-deleted')) return '[-] ';
        if (treeItem.classList.contains('tree-change-mixed')) return '[~>>] ';
        if (treeItem.classList.contains('tree-change-modified')) return '[~] ';
        if (treeItem.classList.contains('tree-change-moved')) return '[>>] ';
        return '';
    }

    // 检查当前节点（treeItem）是否自身有变化标记
    function hasSelfChange(treeItem) {
        if (!treeItem) return false;
        return treeItem.classList.contains('tree-change-added') ||
            treeItem.classList.contains('tree-change-deleted') ||
            treeItem.classList.contains('tree-change-modified') ||
            treeItem.classList.contains('tree-change-moved') ||
            treeItem.classList.contains('tree-change-mixed');
    }

    // forceInclude: 如果为true，表示父级文件夹有变化标记，当前节点应该被强制导出
    function generateNodeHTML(nodeEl, indentLevel, forceInclude = false) {
        let result = '';
        const indent = '    '.repeat(indentLevel);
        const treeNodes = nodeEl.querySelectorAll(':scope > .tree-node');

        treeNodes.forEach(treeNode => {
            const treeItem = treeNode.querySelector(':scope > .tree-item');
            if (!treeItem) return;

            // 简略模式：只导出有变化的分支，或者被强制包含的节点
            if (mode !== 'detailed' && !forceInclude && !hasChanges(treeNode)) return;

            const link = treeItem.querySelector('a.tree-bookmark-link') || treeItem.querySelector('a');
            const url = link ? link.getAttribute('href') : '';
            let title = treeItem.dataset.nodeTitle || treeItem.querySelector('.tree-label')?.textContent?.trim() || '';
            if (!title && link) title = link.textContent.trim();
            if (!title) title = isZh ? '根目录' : 'Root';

            const nodeType = treeItem.dataset.nodeType;
            const isFolder = nodeType === 'folder' || !url;
            const displayTitle = getChangePrefixFromItem(treeItem) + title;

            if (isFolder) {
                result += `${indent}<DT><H3>${escapeHtml(displayTitle)}</H3>\n`;
                result += `${indent}<DL><p>\n`;

                const childrenContainer = treeNode.querySelector(':scope > .tree-children');
                if (childrenContainer) {
                    let shouldRecurse = false;
                    // 简略模式下，如果当前文件夹自身有变化标记，则强制包含所有子节点
                    const shouldForceIncludeChildren = mode !== 'detailed' && !forceInclude && hasSelfChange(treeItem);
                    const nextForceInclude = forceInclude || shouldForceIncludeChildren;

                    if (mode === 'detailed') {
                        shouldRecurse = childrenContainer.classList.contains('expanded');
                    } else {
                        shouldRecurse = true;
                    }

                    if (shouldRecurse) {
                        result += generateNodeHTML(childrenContainer, indentLevel + 1, nextForceInclude);
                    }
                }

                result += `${indent}</DL><p>\n`;
            } else {
                result += `${indent}<DT><A HREF="${escapeHtml(url)}">${escapeHtml(displayTitle)}</A>\n`;
            }
        });

        return result;
    }

    html += generateNodeHTML(bookmarkTreeRoot, 1);
    html += '</DL><p>\n';

    return html;
}

// 生成备份历史的变化JSON（从详情面板DOM提取，所见即所得）
async function generateHistoryChangesJSONFromDOM(treeContainer, mode) {
    const isZh = currentLang === 'zh_CN';
    const now = new Date().toISOString();

    const bookmarkTree = treeContainer?.classList?.contains('bookmark-tree')
        ? treeContainer
        : treeContainer?.querySelector?.('.bookmark-tree');

    if (!bookmarkTree) {
        return {
            title: isZh ? '书签变化导出' : 'Bookmark Changes Export',
            children: [],
            _exportInfo: {
                exportDate: now,
                exportMode: mode,
                source: 'bookmark-backup-history',
                error: isZh ? '无书签树数据' : 'No bookmark tree data'
            }
        };
    }

    // Same wrapper handling as HTML DOM export.
    const bookmarkTreeRoot = bookmarkTree.querySelector(':scope > .history-tree-root-children') || bookmarkTree;

    function hasChanges(treeNode) {
        const treeItem = treeNode.querySelector(':scope > .tree-item');
        if (!treeItem) return false;

        if (treeItem.classList.contains('tree-change-added') ||
            treeItem.classList.contains('tree-change-deleted') ||
            treeItem.classList.contains('tree-change-modified') ||
            treeItem.classList.contains('tree-change-moved') ||
            treeItem.classList.contains('tree-change-mixed')) {
            return true;
        }

        const childrenContainer = treeNode.querySelector(':scope > .tree-children');
        if (childrenContainer) {
            const childNodes = childrenContainer.querySelectorAll(':scope > .tree-node');
            for (const child of childNodes) {
                if (hasChanges(child)) return true;
            }
        }

        return false;
    }

    function getChangeTypeFromItem(treeItem) {
        if (treeItem.classList.contains('tree-change-added')) return 'added';
        if (treeItem.classList.contains('tree-change-deleted')) return 'deleted';
        if (treeItem.classList.contains('tree-change-mixed')) return 'modified+moved';
        if (treeItem.classList.contains('tree-change-modified')) return 'modified';
        if (treeItem.classList.contains('tree-change-moved')) return 'moved';
        return null;
    }

    // 检查当前节点（treeItem）是否自身有变化标记
    function hasSelfChange(treeItem) {
        if (!treeItem) return false;
        return treeItem.classList.contains('tree-change-added') ||
            treeItem.classList.contains('tree-change-deleted') ||
            treeItem.classList.contains('tree-change-modified') ||
            treeItem.classList.contains('tree-change-moved') ||
            treeItem.classList.contains('tree-change-mixed');
    }

    // forceInclude: 如果为true，表示父级文件夹有变化标记，当前节点应该被强制导出
    function extractTree(nodeEl, forceInclude = false) {
        const result = [];
        const treeNodes = nodeEl.querySelectorAll(':scope > .tree-node');

        treeNodes.forEach(treeNode => {
            const treeItem = treeNode.querySelector(':scope > .tree-item');
            if (!treeItem) return;

            // 简略模式：只导出有变化的分支，或者被强制包含的节点
            if (mode !== 'detailed' && !forceInclude && !hasChanges(treeNode)) return;

            const link = treeItem.querySelector('a.tree-bookmark-link') || treeItem.querySelector('a');
            const url = link ? link.getAttribute('href') : '';
            let title = treeItem.dataset.nodeTitle || treeItem.querySelector('.tree-label')?.textContent?.trim() || '';
            if (!title && link) title = link.textContent.trim();
            if (!title) title = isZh ? '根目录' : 'Root';

            const nodeType = treeItem.dataset.nodeType;
            const isFolder = nodeType === 'folder' || !url;
            const changeType = getChangeTypeFromItem(treeItem);

            const item = {
                title: changeType ? `${getChangePrefix(changeType)} ${title}` : title,
                type: isFolder ? 'folder' : 'bookmark',
                ...(url ? { url } : {}),
                ...(changeType ? { changeType } : {})
            };

            if (isFolder) {
                const childrenContainer = treeNode.querySelector(':scope > .tree-children');
                if (childrenContainer) {
                    let shouldRecurse = false;
                    // 简略模式下，如果当前文件夹自身有变化标记，则强制包含所有子节点
                    const shouldForceIncludeChildren = mode !== 'detailed' && !forceInclude && hasSelfChange(treeItem);
                    const nextForceInclude = forceInclude || shouldForceIncludeChildren;

                    if (mode === 'detailed') {
                        shouldRecurse = childrenContainer.classList.contains('expanded');
                    } else {
                        shouldRecurse = true;
                    }

                    item.children = shouldRecurse ? extractTree(childrenContainer, nextForceInclude) : [];
                }
            }

            result.push(item);
        });

        return result;
    }

    const counts = getHistoryChangeCounts(currentExportChangeData, currentExportBookmarkTree);
    const exportTimeText = formatExportTimeText();
    const backupTimeText = currentExportHistoryRecord?.time
        ? (typeof formatTime === 'function' ? formatTime(new Date(currentExportHistoryRecord.time)) : new Date(currentExportHistoryRecord.time).toLocaleString())
        : '';
    const noteText = currentExportHistoryRecord?.note ? currentExportHistoryRecord.note : (isZh ? '（无备注）' : '(No note)');
    const legendFolder = {
        title: isZh
            ? '📋 前缀说明: [+]新增  [-]删除  [~]修改  [>>]移动'
            : '📋 Prefix legend: [+]Added  [-]Deleted  [~]Modified  [>>]Moved',
        children: [
            {
                title: `${isZh ? '操作统计' : 'Operation Counts'}: ${formatCountsLine(counts, isZh)}`,
                url: 'about:blank'
            },
            {
                title: `${isZh ? '导出时间' : 'Export Time'}: ${exportTimeText}`,
                url: 'about:blank'
            },
            {
                title: `${isZh ? '备份时间' : 'Backup Time'}: ${backupTimeText}`,
                url: 'about:blank'
            },
            {
                title: `${isZh ? '备注' : 'Note'}: ${noteText}`,
                url: 'about:blank'
            }
        ]
    };

    return {
        title: isZh ? '书签变化导出' : 'Bookmark Changes Export',
        children: [legendFolder, ...extractTree(bookmarkTreeRoot)],
        _exportInfo: {
            exportDate: now,
            exportMode: mode,
            source: 'bookmark-backup-history',
            legend: {
                '[+]': isZh ? '新增' : 'Added',
                '[-]': isZh ? '删除' : 'Deleted',
                '[~]': isZh ? '修改' : 'Modified',
                '[>>]': isZh ? '移动' : 'Moved',
                '[~>>]': isZh ? '修改+移动' : 'Modified+Moved'
            }
        }
    };
}

// 生成备份历史的变化HTML（从书签树直接生成，不依赖DOM）
// changeMap: Map<id, {type: 'added'|'deleted'|'modified'|'moved'|'modified+moved', moved?: {...}}>
async function generateHistoryChangesHTML(bookmarkTree, changeMap, mode, expandedIds = null) {
    const isZh = currentLang === 'zh_CN';
    const now = new Date().toLocaleString();

    // 在详细模式下，如果提供了 expandedIds，则只展开这些节点（WYSIWYG）
    // 注意：expandedIds 可能为空集合（用户已“全收起”）；仍应视为 WYSIWYG，而不是回退到默认展开规则。
    const useWysiwygExpansion = mode === 'detailed' && (expandedIds instanceof Set);

    let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    html += `<TITLE>${isZh ? '书签变化' : 'Bookmark Changes'}</TITLE>\n`;
    html += `<H1>${isZh ? '书签变化' : 'Bookmark Changes'}</H1>\n`;
    html += '<DL><p>\n';

    // 添加图例说明（一行）
    const legendText = isZh
        ? '📋 前缀说明: [+]新增  [-]删除  [~]修改  [>>]移动'
        : '📋 Prefix legend: [+]Added  [-]Deleted  [~]Modified  [>>]Moved';
    html += `    <DT><H3>${legendText}</H3>\n`;
    const counts = getHistoryChangeCounts(changeMap, bookmarkTree);
    const exportTimeText = formatExportTimeText();
    const backupTimeText = currentExportHistoryRecord?.time
        ? (typeof formatTime === 'function' ? formatTime(new Date(currentExportHistoryRecord.time)) : new Date(currentExportHistoryRecord.time).toLocaleString())
        : '';
    const noteText = currentExportHistoryRecord?.note ? currentExportHistoryRecord.note : (isZh ? '（无备注）' : '(No note)');
    html += `    <DL><p>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '操作统计' : 'Operation Counts'}: ${formatCountsLine(counts, isZh)}</A>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '导出时间' : 'Export Time'}: ${escapeHtml(exportTimeText)}</A>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '备份时间' : 'Backup Time'}: ${escapeHtml(backupTimeText)}</A>\n`;
    html += `        <DT><A HREF="about:blank">${isZh ? '备注' : 'Note'}: ${escapeHtml(noteText)}</A>\n`;
    html += `    </DL><p>\n`;

    if (!bookmarkTree) {
        html += `    <DT><H3>${isZh ? '(无书签树数据)' : '(No bookmark tree data)'}</H3>\n`;
        html += '</DL><p>\n';
        return html;
    }

    // 检查某个节点或其子节点是否有变化
    function hasChangesRecursive(node) {
        if (!node) return false;
        if (changeMap.has(node.id)) return true;
        if (node.children) {
            return node.children.some(child => hasChangesRecursive(child));
        }
        return false;
    }

    // 递归生成 HTML
    // 详细模式：显示所有节点，但只展开有变化的路径（与"当前变化"一致）
    // 简略模式：只导出有变化的分支
    function generateNodeHTML(node, indentLevel) {
        if (!node) return '';

        // 检查该节点或其子节点是否有变化
        const nodeHasChanges = hasChangesRecursive(node);

        // 简略模式：只导出有变化的分支
        if (mode !== 'detailed' && !nodeHasChanges) return '';

        let result = '';
        const indent = '    '.repeat(indentLevel);

        const title = node.title || (isZh ? '(无标题)' : '(Untitled)');
        const url = node.url || '';
        const isFolder = !url && node.children;

        // 检查变化类型并添加前缀（支持组合类型如 'modified+moved'）
        let prefix = '';
        const change = changeMap.get(node.id);
        if (change) {
            const types = change.type ? change.type.split('+') : [];
            if (types.includes('added')) {
                prefix = '[+] ';
            } else if (types.includes('deleted')) {
                prefix = '[-] ';
            } else if (types.includes('modified') && types.includes('moved')) {
                prefix = '[~>>] ';
            } else if (types.includes('modified')) {
                prefix = '[~] ';
            } else if (types.includes('moved')) {
                prefix = '[>>] ';
            }
        }

        const displayTitle = prefix + escapeHtml(title);

        if (isFolder) {
            // 文件夹
            result += `${indent}<DT><H3>${displayTitle}</H3>\n`;
            result += `${indent}<DL><p>\n`;

            // 递归处理子节点
            // 详细模式：只有该节点路径有变化时才展开（递归子节点）
            // 简略模式：只要有变化就递归
            if (node.children && node.children.length > 0) {
                let shouldRecurse = false;

                if (mode === 'detailed') {
                    // 详细模式
                    if (useWysiwygExpansion) {
                        // WYSIWYG: 只展开用户手动展开过的节点
                        shouldRecurse = expandedIds.has(String(node.id));
                    } else {
                        // 默认行为：只有有变化的路径才展开
                        shouldRecurse = nodeHasChanges;
                    }
                } else {
                    // 简略模式：一定有变化才能到这里，所以递归
                    shouldRecurse = true;
                }

                if (shouldRecurse) {
                    node.children.forEach(child => {
                        result += generateNodeHTML(child, indentLevel + 1);
                    });
                }
            }

            result += `${indent}</DL><p>\n`;
        } else if (url) {
            // 书签
            result += `${indent}<DT><A HREF="${escapeHtml(url)}">${displayTitle}</A>\n`;
        }

        return result;
    }

    // 生成书签树 HTML
    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    nodes.forEach(node => {
        if (node.children) {
            node.children.forEach(child => {
                html += generateNodeHTML(child, 1);
            });
        }
    });

    html += '</DL><p>\n';

    console.log('[generateHistoryChangesHTML] 生成的 HTML 长度:', html.length);

    return html;
}

// 生成备份历史的变化JSON（从书签树直接生成，不依赖DOM）
// changeMap: Map<id, {type: 'added'|'deleted'|'modified'|'moved'|'modified+moved', moved?: {...}}>
async function generateHistoryChangesJSON(bookmarkTree, changeMap, mode, expandedIds = null) {
    const isZh = currentLang === 'zh_CN';
    const now = new Date().toISOString();

    // 在详细模式下，如果提供了 expandedIds，则只展开这些节点（WYSIWYG）
    // 注意：expandedIds 可能为空集合（用户已“全收起”）；仍应视为 WYSIWYG，而不是回退到默认展开规则。
    const useWysiwygExpansion = mode === 'detailed' && (expandedIds instanceof Set);

    if (!bookmarkTree) {
        return {
            title: isZh ? '书签变化导出' : 'Bookmark Changes Export',
            children: [],
            _exportInfo: {
                exportDate: now,
                exportMode: mode,
                source: 'bookmark-backup-history',
                error: isZh ? '无书签树数据' : 'No bookmark tree data'
            }
        };
    }

    // 检查某个节点或其子节点是否有变化
    function hasChangesRecursive(node) {
        if (!node) return false;
        if (changeMap.has(node.id)) return true;
        if (node.children) {
            return node.children.some(child => hasChangesRecursive(child));
        }
        return false;
    }

    // 递归提取树结构
    // 详细模式：显示所有节点，但只展开有变化的路径（与"当前变化"一致）
    // 简略模式：只导出有变化的分支
    function extractTree(node) {
        if (!node) return null;

        // 检查该节点或其子节点是否有变化
        const nodeHasChanges = hasChangesRecursive(node);

        // 简略模式：只导出有变化的分支
        if (mode !== 'detailed' && !nodeHasChanges) return null;

        const title = node.title || (isZh ? '(无标题)' : '(Untitled)');
        const url = node.url || '';
        const isFolder = !url && node.children;

        // 检查变化类型（支持组合类型如 'modified+moved'）
        const change = changeMap.get(node.id);
        let prefix = '';
        let changeType = null;
        if (change) {
            changeType = change.type;
            const types = change.type ? change.type.split('+') : [];
            if (types.includes('added')) {
                prefix = '[+] ';
            } else if (types.includes('deleted')) {
                prefix = '[-] ';
            } else if (types.includes('modified') && types.includes('moved')) {
                prefix = '[~>>] ';
            } else if (types.includes('modified')) {
                prefix = '[~] ';
            } else if (types.includes('moved')) {
                prefix = '[>>] ';
            }
        }

        const item = {
            title: prefix + title,
            type: isFolder ? 'folder' : 'bookmark',
            ...(url ? { url } : {}),
            ...(changeType ? { changeType } : {})
        };

        if (isFolder && node.children) {
            // 详细模式：只有有变化的路径才展开（递归子节点）
            // 简略模式：一定有变化才能到这里，所以递归
            let shouldRecurse = false;

            if (mode === 'detailed') {
                // 详细模式
                if (useWysiwygExpansion) {
                    // WYSIWYG: 只展开用户手动展开过的节点
                    shouldRecurse = expandedIds.has(String(node.id));
                } else {
                    // 默认行为：只有有变化的路径才展开
                    shouldRecurse = nodeHasChanges;
                }
            } else {
                // 简略模式：一定有变化才能到这里，所以递归
                shouldRecurse = true;
            }

            if (shouldRecurse) {
                item.children = node.children
                    .map(child => extractTree(child))
                    .filter(child => child !== null);
            } else {
                item.children = [];
            }
        }

        return item;
    }

    // 提取书签树
    const nodes = Array.isArray(bookmarkTree) ? bookmarkTree : [bookmarkTree];
    const children = [];
    nodes.forEach(node => {
        if (node.children) {
            node.children.forEach(child => {
                const extracted = extractTree(child);
                if (extracted) {
                    children.push(extracted);
                }
            });
        }
    });

    // 构建兼容 Chrome bookmarks API 格式的输出
    const counts = getHistoryChangeCounts(changeMap, bookmarkTree);
    const exportTimeText = formatExportTimeText();
    const backupTimeText = currentExportHistoryRecord?.time
        ? (typeof formatTime === 'function' ? formatTime(new Date(currentExportHistoryRecord.time)) : new Date(currentExportHistoryRecord.time).toLocaleString())
        : '';
    const noteText = currentExportHistoryRecord?.note ? currentExportHistoryRecord.note : (isZh ? '（无备注）' : '(No note)');
    const legendFolder = {
        title: isZh
            ? '📋 前缀说明: [+]新增  [-]删除  [~]修改  [>>]移动'
            : '📋 Prefix legend: [+]Added  [-]Deleted  [~]Modified  [>>]Moved',
        children: [
            {
                title: `${isZh ? '操作统计' : 'Operation Counts'}: ${formatCountsLine(counts, isZh)}`,
                url: 'about:blank'
            },
            {
                title: `${isZh ? '导出时间' : 'Export Time'}: ${exportTimeText}`,
                url: 'about:blank'
            },
            {
                title: `${isZh ? '备份时间' : 'Backup Time'}: ${backupTimeText}`,
                url: 'about:blank'
            },
            {
                title: `${isZh ? '备注' : 'Note'}: ${noteText}`,
                url: 'about:blank'
            }
        ]
    };

    const result = {
        title: isZh ? '书签变化导出' : 'Bookmark Changes Export',
        children: [legendFolder, ...children],
        _exportInfo: {
            exportDate: now,
            exportMode: mode,
            source: 'bookmark-backup-history',
            legend: {
                '[+]': isZh ? '新增' : 'Added',
                '[-]': isZh ? '删除' : 'Deleted',
                '[~]': isZh ? '修改' : 'Modified',
                '[>>]': isZh ? '移动' : 'Moved',
                '[~>>]': isZh ? '修改+移动' : 'Modified+Moved'
            }
        }
    };

    return result;
}

// 收集要导出的变化项
function collectChangesForExport(changeData, mode, depth) {
    let changes = [];

    console.log('[导出变化] changeData:', changeData);
    console.log('[导出变化] mode:', mode, 'depth:', depth);

    if (!changeData) {
        console.warn('[导出变化] changeData 为空');
        return changes;
    }

    // 添加基本变化
    if (changeData.added && Array.isArray(changeData.added)) {
        console.log('[导出变化] added 数量:', changeData.added.length);
        for (const item of changeData.added) {
            changes.push({ ...item, changeType: 'added' });
        }
    }
    if (changeData.deleted && Array.isArray(changeData.deleted)) {
        console.log('[导出变化] deleted 数量:', changeData.deleted.length);
        for (const item of changeData.deleted) {
            changes.push({ ...item, changeType: 'deleted' });
        }
    }
    if (changeData.modified && Array.isArray(changeData.modified)) {
        console.log('[导出变化] modified 数量:', changeData.modified.length);
        for (const item of changeData.modified) {
            changes.push({ ...item, changeType: 'modified' });
        }
    }
    if (changeData.moved && Array.isArray(changeData.moved)) {
        console.log('[导出变化] moved 数量:', changeData.moved.length);
        for (const item of changeData.moved) {
            changes.push({ ...item, changeType: 'moved' });
        }
    }

    // 如果变化数组为空，尝试从 DOM 提取变化
    if (changes.length === 0) {
        console.log('[导出变化] 变化数组为空，尝试从 DOM 提取');
        changes = collectChangesFromDOM();
    }

    console.log('[导出变化] 收集到的变化总数:', changes.length);
    if (changes.length > 0) {
        console.log('[导出变化] 第一个变化项示例:', changes[0]);
    }

    // 如果是详细模式，扩展上下文
    if (mode === 'detailed' && depth > 0) {
        // TODO: 实现上下文扩展逻辑
        // 这里需要获取变化项的父级和同级书签
        // 暂时只返回变化项本身
        console.log('[导出变化] 详细模式，扩展层级:', depth);
    }

    return changes;
}

// 从 DOM 中提取完整的书签树数据（简略模式）
function collectChangesFromDOM() {
    const treeContainer = document.getElementById('changesTreePreviewInline');

    if (!treeContainer) {
        console.warn('[导出变化] 未找到书签树容器');
        return [];
    }

    // 递归提取书签树
    function extractTreeNode(nodeEl, depth = 0) {
        const result = [];

        // 找到当前节点下的所有直接 tree-node
        const treeNodes = nodeEl.querySelectorAll(':scope > .tree-node');

        treeNodes.forEach(treeNode => {
            const treeItem = treeNode.querySelector(':scope > .tree-item');
            if (!treeItem) return;

            // 获取标题
            const labelEl = treeItem.querySelector('.tree-label');
            const linkEl = treeItem.querySelector('a.tree-label');

            const title = labelEl?.textContent?.trim() || linkEl?.textContent?.trim() || 'Untitled';
            const url = linkEl?.href || '';

            // 检查变化类型
            let changeType = null;
            if (treeItem.classList.contains('tree-change-added')) {
                changeType = 'added';
            } else if (treeItem.classList.contains('tree-change-deleted')) {
                changeType = 'deleted';
            } else if (treeItem.classList.contains('tree-change-modified')) {
                changeType = 'modified';
            } else if (treeItem.classList.contains('tree-change-moved')) {
                changeType = 'moved';
            }

            const isFolder = !url;

            const item = {
                title,
                url,
                changeType,
                isFolder,
                depth,
                children: []
            };

            // 如果是文件夹，递归获取子项
            if (isFolder) {
                const childrenContainer = treeNode.querySelector(':scope > .tree-children');
                if (childrenContainer) {
                    item.children = extractTreeNode(childrenContainer, depth + 1);
                }
            }

            result.push(item);
        });

        return result;
    }

    // 从根节点开始提取
    const rootChildren = treeContainer.querySelector('.tree-children');
    if (!rootChildren) {
        // 尝试直接从容器开始
        const directNodes = treeContainer.querySelectorAll('.tree-node');
        if (directNodes.length === 0) {
            console.warn('[导出变化] 书签树为空');
            return [];
        }
    }

    const tree = extractTreeNode(treeContainer, 0);
    console.log('[导出变化] 从 DOM 提取的书签树:', tree);

    // 展平树结构为变化列表（保留路径信息）
    const flatChanges = [];

    function flattenTree(nodes, path = '') {
        for (const node of nodes) {
            const currentPath = path ? `${path}/${node.title}` : node.title;

            // 添加到结果
            flatChanges.push({
                title: node.title,
                url: node.url,
                changeType: node.changeType,
                path: path,
                isFolder: node.isFolder,
                depth: node.depth
            });

            // 递归子节点
            if (node.children && node.children.length > 0) {
                flattenTree(node.children, node.isFolder ? currentPath : path);
            }
        }
    }

    flattenTree(tree);
    console.log('[导出变化] 展平后的变化列表:', flatChanges.length, '项');

    return flatChanges;
}

// 获取变化类型前缀
function getChangePrefix(changeType) {
    switch (changeType) {
        case 'added': return '[+]';
        case 'deleted': return '[-]';
        case 'modified': return '[~]';
        case 'moved': return '[>>]';
        case 'modified+moved': return '[~>>]';
        default: return '';
    }
}

// HTML转义
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// =============================================================================
// 全局导出功能 (Global Export)
// =============================================================================

// =============================================================================
// 全局导出功能 (Global Export)
// =============================================================================

function initGlobalExport() {
    const btn = document.getElementById('globalExportBtn');
    if (btn) {
        btn.addEventListener('click', showGlobalExportModal);
    }

    const closeBtn = document.getElementById('globalExportModalClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeGlobalExportModal);
    }

    const cancelBtn = document.getElementById('globalExportCancelBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeGlobalExportModal);
    }

    const confirmBtn = document.getElementById('globalExportConfirmBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', startGlobalExport);
    }

    // 全选交互
    const selectAllCbox = document.getElementById('globalExportSelectAll');
    if (selectAllCbox) {
        selectAllCbox.addEventListener('change', (e) => {
            const checked = e.target.checked;
            // 更新所有记录的选中状态（跨页）
            Object.keys(globalExportSelectedState).forEach(key => {
                globalExportSelectedState[key] = checked;
            });
            // 更新当前页的 UI
            document.querySelectorAll('.global-export-row-checkbox').forEach(cb => cb.checked = checked);
            updateGlobalExportStatus();
            syncGlobalExportRangeUiAfterListSelectionChange();
        });
    }

    initGlobalExportRangeUI();

    // 导出格式：三选一（HTML / JSON / Markdown）
    const formatHtmlCbox = document.getElementById('globalExportFormatHtml');
    const formatJsonCbox = document.getElementById('globalExportFormatJson');
    const formatMdCbox = document.getElementById('globalExportFormatMd');

    const packMergeRadio = document.getElementById('globalExportPackMerge');
    const packZipRadio = document.getElementById('globalExportPackZip');

    const formatCboxes = [formatHtmlCbox, formatJsonCbox, formatMdCbox].filter(Boolean);

    const applyPackRulesForMd = (isMdSelected) => {
        if (!packMergeRadio || !packZipRadio) return;

        if (isMdSelected) {
            // MD 强制“合并”，并禁用 Zip
            packMergeRadio.checked = true;
            packZipRadio.disabled = true;
            if (packZipRadio.parentElement) packZipRadio.parentElement.style.opacity = '0.5';
        } else {
            // 非 MD 恢复 Zip 可用
            packZipRadio.disabled = false;
            if (packZipRadio.parentElement) packZipRadio.parentElement.style.opacity = '1';
        }
    };

    const enforceSingleFormat = (activeCbox) => {
        formatCboxes.forEach((cbox) => {
            if (cbox !== activeCbox) cbox.checked = false;
        });
        applyPackRulesForMd(Boolean(formatMdCbox?.checked));
    };

    formatCboxes.forEach((cbox) => {
        cbox.addEventListener('change', (e) => {
            const target = e.target;
            if (target.checked) {
                enforceSingleFormat(target);
                return;
            }

            // 不允许全部取消：如果用户把最后一个也取消，则自动恢复勾选
            const anyChecked = formatCboxes.some(cb => cb.checked);
            if (!anyChecked) {
                target.checked = true;
            }
            applyPackRulesForMd(Boolean(formatMdCbox?.checked));
        });
    });

    // 初始化一次（防止默认勾选/历史状态导致 pack 状态不一致）
    applyPackRulesForMd(Boolean(formatMdCbox?.checked));

    // 导出卡片点击交互 (让整个卡片可点击)
    document.querySelectorAll('.export-option-card').forEach(card => {
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
            // 初始化状态
            if (checkbox.checked) card.classList.add('selected');

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    card.classList.add('selected');
                } else {
                    card.classList.remove('selected');
                }
            });
        }
    });

    const modal = document.getElementById('globalExportModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeGlobalExportModal();
        });
    }
}

function closeGlobalExportModal() {
    document.getElementById('globalExportModal').classList.remove('show');
}

function updateGlobalExportStatus() {
    const selectedCount = Object.values(globalExportSelectedState).filter(v => v === true).length;
    const total = Object.keys(globalExportSelectedState).length;
    const statusEl = document.getElementById('globalExportStatus');

    if (statusEl) {
        statusEl.textContent = `${currentLang === 'zh_CN' ? '已选' : 'Selected'} ${selectedCount} / ${total}`;
    }

    const confirmBtn = document.getElementById('globalExportConfirmBtn');
    if (confirmBtn) {
        confirmBtn.disabled = selectedCount === 0;
        confirmBtn.style.opacity = selectedCount === 0 ? '0.5' : '1';
    }

    // 联动全选按钮状态
    updateSelectAllCheckboxState();
}

// 全局导出分页状态
let globalExportCurrentPage = 1;
const GLOBAL_EXPORT_PAGE_SIZE = 10;
let globalExportSelectedState = {}; // 保存每条记录的选中状态

let globalExportSeqNumberByTime = new Map(); // time(string) -> seqNumber(number)

let globalExportRangeBoundsCache = { min: 1, max: 1 };
let globalExportRangeApplyingSelection = false;
let globalExportActiveRangeThumb = 'max'; // 'min' | 'max'
let globalExportRangeRafPending = false;

function initGlobalExportRangeUI() {
    const toggleBtn = document.getElementById('globalExportRangeToggleBtn');
    const panel = document.getElementById('globalExportRangePanel');
    const enabledCbox = document.getElementById('globalExportRangeEnabled');
    const minSlider = document.getElementById('globalExportRangeMin');
    const maxSlider = document.getElementById('globalExportRangeMax');

    if (!toggleBtn || !panel || !enabledCbox || !minSlider || !maxSlider) return;

    if (!toggleBtn.hasAttribute('data-listener-attached')) {
        toggleBtn.addEventListener('click', () => {
            const isExpanded = panel.style.display !== 'none';
            setGlobalExportRangePanelExpanded(!isExpanded);
        });
        toggleBtn.setAttribute('data-listener-attached', 'true');
    }

    if (!enabledCbox.hasAttribute('data-listener-attached')) {
        enabledCbox.addEventListener('change', () => {
            const enabled = Boolean(enabledCbox.checked);
            setGlobalExportRangeEnabled(enabled);
            updateGlobalExportRangeHighlight();
            updateGlobalExportRangePreviewText();
            if (enabled) {
                applyGlobalExportSelectionByCurrentThumbRange();
            }
        });
        enabledCbox.setAttribute('data-listener-attached', 'true');
    }

    const handleMinInput = () => {
        updateGlobalExportRangeHighlight();
        updateGlobalExportRangePreviewText();
        if (isGlobalExportRangePanelExpanded()) {
            globalExportCurrentPage = 1;
            renderGlobalExportPage();
        }
        if (enabledCbox.checked) {
            applyGlobalExportSelectionByCurrentThumbRange();
        }
    };

    const handleMaxInput = () => {
        updateGlobalExportRangeHighlight();
        updateGlobalExportRangePreviewText();
        if (isGlobalExportRangePanelExpanded()) {
            globalExportCurrentPage = 1;
            renderGlobalExportPage();
        }
        if (enabledCbox.checked) {
            applyGlobalExportSelectionByCurrentThumbRange();
        }
    };

    if (!minSlider.hasAttribute('data-listener-attached')) {
        minSlider.addEventListener('input', handleMinInput);
        minSlider.addEventListener('pointerdown', () => {
            minSlider.style.zIndex = '5';
            maxSlider.style.zIndex = '4';
            globalExportActiveRangeThumb = 'min';
        });
        minSlider.setAttribute('data-listener-attached', 'true');
    }
    if (!maxSlider.hasAttribute('data-listener-attached')) {
        maxSlider.addEventListener('input', handleMaxInput);
        maxSlider.addEventListener('pointerdown', () => {
            maxSlider.style.zIndex = '5';
            minSlider.style.zIndex = '4';
            globalExportActiveRangeThumb = 'max';
        });
        maxSlider.setAttribute('data-listener-attached', 'true');
    }

    setGlobalExportRangePanelExpanded(false);
    setGlobalExportRangeEnabled(false);
    updateGlobalExportRangePreviewText();
}

function scheduleGlobalExportRangeUiUpdate() {
    if (globalExportRangeRafPending) return;
    globalExportRangeRafPending = true;
    requestAnimationFrame(() => {
        globalExportRangeRafPending = false;
        updateGlobalExportRangeHighlight();
        updateGlobalExportRangePreviewText();
    });
}

function isGlobalExportRangePanelExpanded() {
    const panel = document.getElementById('globalExportRangePanel');
    if (!panel) return false;
    return panel.style.display !== 'none';
}

function setGlobalExportRangePanelExpanded(expanded) {
    const panel = document.getElementById('globalExportRangePanel');
    const toggleBtn = document.getElementById('globalExportRangeToggleBtn');
    if (!panel || !toggleBtn) return;

    const wasExpanded = panel.style.display !== 'none';
    panel.style.display = expanded ? 'block' : 'none';
    const icon = toggleBtn.querySelector('i');
    if (icon) {
        icon.classList.toggle('fa-chevron-down', !expanded);
        icon.classList.toggle('fa-chevron-up', expanded);
    }

    // 收起时回到“原来的”模式：关闭范围勾选联动（但不改当前勾选状态）
    if (!expanded) {
        const enabledCbox = document.getElementById('globalExportRangeEnabled');
        if (enabledCbox && enabledCbox.checked) {
            enabledCbox.checked = false;
            setGlobalExportRangeEnabled(false);
            updateGlobalExportRangePreviewText();
        }
    }

    // 展开/收起会影响“下方列表显示什么”
    if (wasExpanded !== expanded) {
        globalExportCurrentPage = 1;
        try {
            renderGlobalExportPage();
        } catch (e) {
            // ignore if called before table exists
        }
    }
}

function setGlobalExportRangeEnabled(enabled) {
    // 注意：滑块在“视觉模式/勾选模式”都应保持可操作、视觉不变暗；
    // 这里的“启用”仅表示是否将范围应用到列表勾选
}

function getGlobalExportSeqRangeBounds() {
    if (!syncHistory || syncHistory.length === 0) return { min: 1, max: 1 };

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < syncHistory.length; i++) {
        const record = syncHistory[i];
        const seqNumber = record.seqNumber || (i + 1);
        if (seqNumber < min) min = seqNumber;
        if (seqNumber > max) max = seqNumber;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 1, max: 1 };
    return { min, max };
}

function updateGlobalExportRangeHighlight() {
    const highlight = document.getElementById('globalExportRangeHighlight');
    const minSlider = document.getElementById('globalExportRangeMin');
    const maxSlider = document.getElementById('globalExportRangeMax');
    if (!highlight || !minSlider || !maxSlider) return;

    const min = parseInt(minSlider.min, 10);
    const max = parseInt(minSlider.max, 10);
    const range = Math.max(1, max - min);

    const a = parseInt(minSlider.value, 10);
    const b = parseInt(maxSlider.value, 10);
    const low = Math.min(a, b);
    const high = Math.max(a, b);

    const leftPercent = ((low - min) / range) * 100;
    const widthPercent = ((high - low) / range) * 100;

    highlight.style.left = `${leftPercent}%`;
    highlight.style.width = `${widthPercent}%`;

    updateGlobalExportRangeBubbles();
}

function updateGlobalExportRangeBubbles() {
    const minSlider = document.getElementById('globalExportRangeMin');
    const maxSlider = document.getElementById('globalExportRangeMax');
    const minBubble = document.getElementById('globalExportRangeMinBubble');
    const maxBubble = document.getElementById('globalExportRangeMaxBubble');
    const container = document.getElementById('globalExportRangeContainer');
    const track = container ? container.querySelector('.range-slider-track') : null;
    const leftLabel = document.getElementById('globalExportRangeLeftLabel');
    const rightLabel = document.getElementById('globalExportRangeRightLabel');
    if (!minSlider || !maxSlider || !minBubble || !maxBubble || !container || !track) return;

    const min = parseInt(minSlider.min, 10);
    const max = parseInt(minSlider.max, 10);
    const range = Math.max(1, max - min);

    const minVal = parseInt(minSlider.value, 10);
    const maxVal = parseInt(maxSlider.value, 10);

    // Inputs are flipped (scaleX(-1)), so visual position is mirrored.
    const minPercent = ((minVal - min) / range) * 100;
    const maxPercent = ((maxVal - min) / range) * 100;

    // Use container pixels instead of getBoundingClientRect() to avoid occasional
    // jitter when the table below rerenders and layout shifts during dragging.
    const insetPx = 10; // keep in sync with #globalExportRangeContainer track/input inset
    const thumbSizePx = 20; // keep in sync with .range-slider-input thumb size
    const thumbHalfPx = thumbSizePx / 2;

    const trackWidthPx = Math.max(1, container.clientWidth - insetPx * 2);
    const effectiveWidthPx = Math.max(0, trackWidthPx - thumbSizePx);

    const minX = insetPx + thumbHalfPx + (1 - (minPercent / 100)) * effectiveWidthPx;
    const maxX = insetPx + thumbHalfPx + (1 - (maxPercent / 100)) * effectiveWidthPx;

    minBubble.style.left = `${minX}px`;
    maxBubble.style.left = `${maxX}px`;
    minBubble.textContent = String(minVal);
    maxBubble.textContent = String(maxVal);

    // If two thumbs overlap, don't draw both numbers on top of each other.
    const overlapThresholdPx = 14;
    const overlap = Math.abs(minX - maxX) <= overlapThresholdPx;
    if (overlap) {
        if (globalExportActiveRangeThumb === 'min') {
            minBubble.style.opacity = '1';
            minBubble.style.zIndex = '7';
            maxBubble.style.opacity = '0';
            maxBubble.style.zIndex = '6';
        } else {
            maxBubble.style.opacity = '1';
            maxBubble.style.zIndex = '7';
            minBubble.style.opacity = '0';
            minBubble.style.zIndex = '6';
        }
    } else {
        minBubble.style.opacity = '1';
        maxBubble.style.opacity = '1';
        minBubble.style.zIndex = '6';
        maxBubble.style.zIndex = '6';
    }

    // When a thumb reaches the end, let it cover the end label (avoid visual clutter).
    // If either thumb is close to an edge, hide that edge label.
    const edgeThresholdPx = thumbHalfPx + 2;
    const leftEdgeX = insetPx;
    const rightEdgeX = insetPx + trackWidthPx;
    const nearLeftEdge = Math.min(Math.abs(minX - leftEdgeX), Math.abs(maxX - leftEdgeX)) <= edgeThresholdPx;
    const nearRightEdge = Math.min(Math.abs(minX - rightEdgeX), Math.abs(maxX - rightEdgeX)) <= edgeThresholdPx;

    if (leftLabel) leftLabel.style.opacity = nearLeftEdge ? '0' : '1';
    if (rightLabel) rightLabel.style.opacity = nearRightEdge ? '0' : '1';
}

function updateGlobalExportRangePreviewText() {
    const previewEl = document.getElementById('globalExportRangePreviewText');
    const enabledCbox = document.getElementById('globalExportRangeEnabled');
    const minSlider = document.getElementById('globalExportRangeMin');
    const maxSlider = document.getElementById('globalExportRangeMax');
    if (!previewEl || !enabledCbox || !minSlider || !maxSlider) return;

    const a = parseInt(minSlider.value, 10);
    const b = parseInt(maxSlider.value, 10);
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const seqRangeStr = low === high ? String(low) : `${low}-${high}`;
    const countInRange = countGlobalExportRecordsInSeqRange(low, high);

    updateGlobalExportRangeBubbles();

    if (!enabledCbox.checked) {
        // 视觉查看模式：仅影响下方列表显示范围，不改勾选
        previewEl.textContent = currentLang === 'en'
            ? `Showing No. ${seqRangeStr} (${countInRange})`
            : `显示：序号 ${seqRangeStr}（${countInRange} 条）`;
        return;
    }

    // 勾选模式：影响下方列表显示，并把范围应用到勾选
    previewEl.textContent = currentLang === 'en'
        ? `Selecting No. ${seqRangeStr} (${countInRange})`
        : `勾选：序号 ${seqRangeStr}（${countInRange} 条）`;
}

function countGlobalExportRecordsInSeqRange(minSeq, maxSeq) {
    if (!syncHistory || syncHistory.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < syncHistory.length; i++) {
        const record = syncHistory[i];
        const seqNumber = globalExportSeqNumberByTime.get(String(record.time)) || record.seqNumber || (i + 1);
        if (seqNumber >= minSeq && seqNumber <= maxSeq) count++;
    }
    return count;
}

function applyGlobalExportSelectionByCurrentThumbRange() {
    const minSlider = document.getElementById('globalExportRangeMin');
    const maxSlider = document.getElementById('globalExportRangeMax');
    if (!minSlider || !maxSlider) return;

    const a = parseInt(minSlider.value, 10);
    const b = parseInt(maxSlider.value, 10);
    const low = Math.min(a, b);
    const high = Math.max(a, b);

    applyGlobalExportSelectionBySeqRange(low, high);
}

function applyGlobalExportSelectionBySeqRange(minSeq, maxSeq) {
    if (!syncHistory || syncHistory.length === 0) return;

    globalExportRangeApplyingSelection = true;
    for (let i = 0; i < syncHistory.length; i++) {
        const record = syncHistory[i];
        const seqNumber = globalExportSeqNumberByTime.get(String(record.time)) || record.seqNumber || (i + 1);
        globalExportSelectedState[record.time] = (seqNumber >= minSeq && seqNumber <= maxSeq);
    }

    document.querySelectorAll('.global-export-row-checkbox').forEach(cb => {
        const time = cb.dataset.time;
        cb.checked = globalExportSelectedState[time] === true;
    });

    updateGlobalExportStatus();
    updateGlobalExportRangeHighlight();
    updateGlobalExportRangePreviewText();
    globalExportRangeApplyingSelection = false;
}

function setupGlobalExportRangeUiForOpen({ source = 'global', minSeq = null, maxSeq = null, autoEnable = false, autoExpand = false } = {}) {
    const enabledCbox = document.getElementById('globalExportRangeEnabled');
    const minSlider = document.getElementById('globalExportRangeMin');
    const maxSlider = document.getElementById('globalExportRangeMax');
    const leftLabel = document.getElementById('globalExportRangeLeftLabel');
    const rightLabel = document.getElementById('globalExportRangeRightLabel');

    if (!enabledCbox || !minSlider || !maxSlider) return;

    globalExportRangeBoundsCache = getGlobalExportSeqRangeBounds();
    const bounds = globalExportRangeBoundsCache;

    minSlider.min = String(bounds.min);
    minSlider.max = String(bounds.max);
    maxSlider.min = String(bounds.min);
    maxSlider.max = String(bounds.max);

    const nextMinSeq = minSeq == null ? bounds.min : minSeq;
    const nextMaxSeq = maxSeq == null ? bounds.max : maxSeq;

    minSlider.value = String(nextMinSeq);
    maxSlider.value = String(nextMaxSeq);

    if (leftLabel) leftLabel.textContent = String(bounds.max);
    if (rightLabel) rightLabel.textContent = String(bounds.min);

    setGlobalExportRangePanelExpanded(Boolean(autoExpand));
    enabledCbox.checked = Boolean(autoEnable);
    setGlobalExportRangeEnabled(Boolean(autoEnable));

    updateGlobalExportRangeHighlight();
    updateGlobalExportRangePreviewText();
    updateGlobalExportRangeBubbles();

    if (source === 'delete' && autoEnable) {
        applyGlobalExportSelectionBySeqRange(parseInt(minSlider.value, 10), parseInt(maxSlider.value, 10));
    }
}

function syncGlobalExportRangeUiAfterListSelectionChange() {
    const enabledCbox = document.getElementById('globalExportRangeEnabled');
    if (!enabledCbox || !enabledCbox.checked) return;
    if (globalExportRangeApplyingSelection) return;

    // 如果用户手动改了列表勾选，则退出“范围应用”模式，避免滑块显示与实际勾选不一致
    enabledCbox.checked = false;
    setGlobalExportRangeEnabled(false);
    updateGlobalExportRangePreviewText();
}

function showGlobalExportModal() {
    const modal = document.getElementById('globalExportModal');
    const tbody = document.getElementById('globalExportTableBody');

    if (!modal || !tbody) return;

    // 重置分页状态
    globalExportCurrentPage = 1;
    globalExportSelectedState = {};

    if (!syncHistory || syncHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding: 30px; text-align: center; color: var(--text-tertiary);">暂无备份记录</td></tr>';
        document.getElementById('globalExportPagination').style.display = 'none';
        modal.classList.add('show');
        return;
    }

    // 初始化所有记录为选中状态
    syncHistory.forEach(record => {
        globalExportSelectedState[record.time] = true;
    });

    // 建立序号映射（与删除弹窗口径一致：syncHistory 顺序的 index+1；newer 具有更大序号）
    globalExportSeqNumberByTime = new Map();
    syncHistory.forEach((record, index) => {
        const seqNumber = record.seqNumber || (index + 1);
        globalExportSeqNumberByTime.set(String(record.time), seqNumber);
    });

    // 渲染当前页
    renderGlobalExportPage();

    // 绑定分页按钮事件
    const prevBtn = document.getElementById('globalExportPrevPage');
    const nextBtn = document.getElementById('globalExportNextPage');
    const pageInput = document.getElementById('globalExportPageInput');

    // 移除旧事件（防止重复绑定）
    prevBtn.replaceWith(prevBtn.cloneNode(true));
    nextBtn.replaceWith(nextBtn.cloneNode(true));
    pageInput.replaceWith(pageInput.cloneNode(true));

    document.getElementById('globalExportPrevPage').addEventListener('click', () => {
        if (globalExportCurrentPage > 1) {
            globalExportCurrentPage--;
            renderGlobalExportPage();
        }
    });

    document.getElementById('globalExportNextPage').addEventListener('click', () => {
        const totalPages = Math.ceil(syncHistory.length / GLOBAL_EXPORT_PAGE_SIZE);
        if (globalExportCurrentPage < totalPages) {
            globalExportCurrentPage++;
            renderGlobalExportPage();
        }
    });

    // 页码输入框跳转
    const newPageInput = document.getElementById('globalExportPageInput');
    newPageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const totalPages = Math.ceil(syncHistory.length / GLOBAL_EXPORT_PAGE_SIZE);
            let targetPage = parseInt(newPageInput.value, 10);
            if (isNaN(targetPage) || targetPage < 1) targetPage = 1;
            if (targetPage > totalPages) targetPage = totalPages;
            globalExportCurrentPage = targetPage;
            renderGlobalExportPage();
        }
    });
    newPageInput.addEventListener('blur', () => {
        const totalPages = Math.ceil(syncHistory.length / GLOBAL_EXPORT_PAGE_SIZE);
        let targetPage = parseInt(newPageInput.value, 10);
        if (isNaN(targetPage) || targetPage < 1) targetPage = 1;
        if (targetPage > totalPages) targetPage = totalPages;
        if (targetPage !== globalExportCurrentPage) {
            globalExportCurrentPage = targetPage;
            renderGlobalExportPage();
        } else {
            // 只更新输入框显示（防止显示非法值）
            newPageInput.value = globalExportCurrentPage;
        }
    });

    setupGlobalExportRangeUiForOpen({ source: 'global', autoEnable: false, autoExpand: false });
    updateGlobalExportStatus();
    modal.classList.add('show');
}

function renderGlobalExportPage() {
    const tbody = document.getElementById('globalExportTableBody');
    const pagination = document.getElementById('globalExportPagination');
    const prevBtn = document.getElementById('globalExportPrevPage');
    const nextBtn = document.getElementById('globalExportNextPage');
    const pageInput = document.getElementById('globalExportPageInput');
    const totalPagesEl = document.getElementById('globalExportTotalPages');

    if (!tbody) return;

    tbody.innerHTML = '';

    const reversedHistory = [...syncHistory].reverse();
    let visibleHistory = reversedHistory;

    // 视觉查看模式：如果范围面板展开，则下方列表只显示该范围内的记录
    if (isGlobalExportRangePanelExpanded()) {
        const minSlider = document.getElementById('globalExportRangeMin');
        const maxSlider = document.getElementById('globalExportRangeMax');
        if (minSlider && maxSlider) {
            const a = parseInt(minSlider.value, 10);
            const b = parseInt(maxSlider.value, 10);
            const minSeq = Math.min(a, b);
            const maxSeq = Math.max(a, b);
            visibleHistory = reversedHistory.filter((record) => {
                const seqNumber = globalExportSeqNumberByTime.get(String(record.time));
                if (!Number.isFinite(seqNumber)) return true;
                return seqNumber >= minSeq && seqNumber <= maxSeq;
            });
        }
    }

    if (visibleHistory.length === 0) {
        const colspan = 6;
        tbody.innerHTML = `<tr><td colspan="${colspan}" style="padding: 20px; text-align: center; color: var(--text-tertiary);">${currentLang === 'zh_CN' ? '该范围内暂无记录' : 'No records in this range'}</td></tr>`;
        if (pagination) pagination.style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(visibleHistory.length / GLOBAL_EXPORT_PAGE_SIZE);
    const startIndex = (globalExportCurrentPage - 1) * GLOBAL_EXPORT_PAGE_SIZE;
    const endIndex = Math.min(startIndex + GLOBAL_EXPORT_PAGE_SIZE, visibleHistory.length);
    const pageRecords = visibleHistory.slice(startIndex, endIndex);

    // 显示/隐藏分页控件
    if (totalPages <= 1) {
        pagination.style.display = 'none';
    } else {
        pagination.style.display = 'flex';
        pageInput.value = globalExportCurrentPage;
        pageInput.max = totalPages;
        totalPagesEl.textContent = totalPages;
        prevBtn.disabled = globalExportCurrentPage <= 1;
        nextBtn.disabled = globalExportCurrentPage >= totalPages;
    }

    pageRecords.forEach((record, idx) => {
        const tr = document.createElement('tr');

        const timeStr = formatTime(record.time);
        const note = record.note || '';
        const noteDisplay = note ? escapeHtml(note) : `<span style="color:var(--text-tertiary); font-style: italic;">${currentLang === 'zh_CN' ? '无备注' : 'No Note'}</span>`;
        const fingerprint = record.fingerprint || '-';
        const seqNumber = globalExportSeqNumberByTime.get(String(record.time)) || record.seqNumber || '';

        const savedMode = getRecordDetailMode(record.time);
        const defaultMode = historyDetailMode || 'simple';
        const mode = savedMode || defaultMode;

        const isChecked = globalExportSelectedState[record.time] !== false;

        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="global-export-row-checkbox" data-time="${record.time}" ${isChecked ? 'checked' : ''}>
            </td>
            <td style="text-align: center; font-family: monospace; color: var(--text-secondary);">${seqNumber}</td>
            <td>
                <div style="max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: normal; line-height: 1.4;">${noteDisplay}</div>
            </td>
            <td style="font-family: monospace; color: var(--text-secondary);">${fingerprint}</td>
            <td>
            <div class="global-export-toggle-group" data-time="${record.time}">
                <button class="global-export-toggle-btn ${mode === 'simple' ? 'active' : ''}" data-value="simple">${currentLang === 'zh_CN' ? '简略' : 'Simple'}</button>
                <button class="global-export-toggle-btn ${mode === 'detailed' ? 'active' : ''}" data-value="detailed">${currentLang === 'zh_CN' ? '详细' : 'Detailed'}</button>
            </div>
            </td>
            <td>
                <div style="font-weight: 500; white-space: nowrap;">${timeStr}</div>
            </td>
        `;

        // 添加行点击交互：点击行任意位置（除了按钮和复选框）触发选中
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', (e) => {
            // 如果点击的是按钮或复选框本身，则忽略
            if (e.target.closest('.global-export-toggle-btn') || e.target.closest('.global-export-row-checkbox')) return;

            // 切换选中状态
            const checkbox = tr.querySelector('.global-export-row-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                // 手动触发 change 事件或者直接更新状态
                // 这里我们直接更新状态并由 change 事件回调处理（如果触发的话），或者直接复制 change 逻辑
                // 为了简单，我们直接更新状态
                globalExportSelectedState[record.time] = checkbox.checked;
                updateGlobalExportStatus();
                syncGlobalExportRangeUiAfterListSelectionChange();
            }
        });

        tbody.appendChild(tr);
    });

    // 绑定行复选框事件
    tbody.querySelectorAll('.global-export-row-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const time = e.target.dataset.time;
            globalExportSelectedState[time] = e.target.checked;
            updateGlobalExportStatus();
            syncGlobalExportRangeUiAfterListSelectionChange();
        });
    });

    // 绑定视图模式切换事件
    tbody.querySelectorAll('.global-export-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const button = e.currentTarget;
            if (button.classList.contains('active')) return;

            const container = button.closest('.global-export-toggle-group');
            const time = container.dataset.time;
            const newMode = button.dataset.value;

            // 更新UI
            container.querySelectorAll('.global-export-toggle-btn').forEach(b => b.classList.remove('active'));
            button.classList.add('active');

            // 更新数据
            setRecordDetailMode(time, newMode);
        });
    });

    // 更新全选框状态
    updateSelectAllCheckboxState();

    // After rerendering the table, layout may shift slightly; keep bubbles stable.
    if (isGlobalExportRangePanelExpanded()) {
        scheduleGlobalExportRangeUiUpdate();
    }
}

function updateSelectAllCheckboxState() {
    const selectAllCheckbox = document.getElementById('globalExportSelectAll');
    if (!selectAllCheckbox) return;

    const allSelected = Object.values(globalExportSelectedState).every(v => v === true);
    const noneSelected = Object.values(globalExportSelectedState).every(v => v === false);

    selectAllCheckbox.checked = allSelected;
    selectAllCheckbox.indeterminate = !allSelected && !noneSelected;
}

async function startGlobalExport() {
    // 从 globalExportSelectedState 获取选中的记录
    const selectedTimes = Object.entries(globalExportSelectedState)
        .filter(([_, selected]) => selected)
        .map(([time, _]) => time);

    if (selectedTimes.length === 0) return;

    // 导出顺序：倒序（新的在前）
    const selectedTimesSorted = selectedTimes
        .slice()
        .sort((a, b) => Number(b) - Number(a));

    const seqMap = buildSequenceMapFromHistory(syncHistory);
    const selectedSeqNumbers = selectedTimes
        .map(t => seqMap.get(String(t)))
        .filter(n => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
    const rangeText = formatSelectedSequenceRanges(selectedSeqNumbers, currentLang);
    const selectionLabel = (() => {
        if (currentLang === 'zh_CN') {
            return rangeText
                ? `【序号${rangeText}-共${selectedTimes.length}个】`
                : `【共${selectedTimes.length}个】`;
        }
        return rangeText
            ? `[No${rangeText}-${selectedTimes.length}items]`
            : `[${selectedTimes.length}items]`;
    })();
    const selectionPrefix = sanitizeFilenameSegment(selectionLabel);
    const seqWidth = String(Math.max(syncHistory?.length || 1, 1)).length;

    const confirmBtn = document.getElementById('globalExportConfirmBtn');
    const originalText = confirmBtn.innerHTML;
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${currentLang === 'zh_CN' ? '正在处理...' : 'Processing...'}`;

    try {
        const formatHtml = document.getElementById('globalExportFormatHtml').checked;
        const formatJson = document.getElementById('globalExportFormatJson').checked;
        const formatMd = document.getElementById('globalExportFormatMd') ? document.getElementById('globalExportFormatMd').checked : false;

        const packMode = document.querySelector('input[name="globalExportPackMode"]:checked')?.value || 'zip';

        if (!formatHtml && !formatJson && !formatMd) {
            showToast(currentLang === 'zh_CN' ? '没有选择导出格式' : 'No export format selected');
            return;
        }

        let processedCount = 0;
        const totalCount = selectedTimesSorted.length;

        // ---------------------------------------------------------------------
        // 模式 A: ZIP 归档 (每个备份独立文件夹)
        // ---------------------------------------------------------------------
        if (packMode === 'zip') {
            const files = [];
            const timestamp = formatTimeForFilename(); // 导出时间（本地时间）
            const zipPrefix = currentLang === 'zh_CN' ? '全局备份归档' : 'Global_Backup_Archive';
            const zipRootFolder = selectionPrefix ? `${selectionPrefix}_${zipPrefix}_${timestamp}` : `${zipPrefix}_${timestamp}`;
            for (const recordTime of selectedTimesSorted) {
                // 更新进度
                processedCount++;
                confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${currentLang === 'zh_CN' ? '正在处理' : 'Processing'} (${processedCount}/${totalCount})`;
                // 让UI有时间渲染
                await new Promise(r => requestAnimationFrame(r));

                const record = syncHistory.find(r => String(r.time) === String(recordTime));
                if (!record) continue;

                // 获取保存的视图模式
                const savedMode = getRecordDetailMode(record.time);
                const defaultMode = historyDetailMode || 'simple';
                const mode = savedMode || defaultMode;

                const dateStr = formatTimeForFilename(record.time); // 备份时间（本地时间）
                // Sanitize note for filename use
                const cleanNote = record.note ? record.note.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_') : '';
                const fingerprint = record.fingerprint ? `_${record.fingerprint.substring(0, 8)}` : '';
                const modeStr = mode === 'simple' ? (currentLang === 'zh_CN' ? '_简略' : '_Simple') : (currentLang === 'zh_CN' ? '_详细' : '_Detailed');
                const defaultPrefix = currentLang === 'zh_CN' ? '书签' : 'bookmark';

                const baseName = cleanNote
                    ? `${cleanNote}${fingerprint}${modeStr}_${dateStr}`
                    : `${defaultPrefix}${fingerprint}${modeStr}_${dateStr}`;

                const seqNumber = seqMap.get(String(record.time));
                const seqStr = Number.isFinite(seqNumber) ? String(seqNumber).padStart(seqWidth, '0') : '00';
                const fileBasePath = `${zipRootFolder}/${seqStr}_${baseName}`;

                if (formatHtml) {
                    try {
                        const htmlContent = await generateExportHtmlContentForGlobal(record, mode);
                        files.push({
                            name: `${fileBasePath}.html`,
                            data: new TextEncoder().encode(htmlContent)
                        });
                    } catch (err) {
                        console.error('HTML Gen Error', err);
                    }
                }

                if (formatJson) {
                    try {
                        const jsonContentObj = await generateExportJsonContentForGlobal(record, mode);
                        files.push({
                            name: `${fileBasePath}.json`,
                            data: new TextEncoder().encode(JSON.stringify(jsonContentObj, null, 2))
                        });
                    } catch (err) {
                        console.error('JSON Gen Error', err);
                    }
                }

                // ZIP mode does not explicitly support MD as per requirements (MD enforces Merge), 
                // but if we wanted to support it, we'd add it here.
            }

            if (files.length === 0) {
                // 如果只选了MD但强行进了Zip模式（不应该发生），则报错
                throw new Error('No files generated (MD format requires Merge mode)');
            }

            // 确保 ZIP 内的文件名排序为倒序（大的在前）
            files.sort((a, b) => String(b.name).localeCompare(String(a.name)));

            const zipBlob = __zipStore(files);
            const zipUrl = URL.createObjectURL(zipBlob);
            const zipName = selectionPrefix
                ? `${selectionPrefix}_${zipPrefix}_${timestamp}.zip`
                : `${zipPrefix}_${timestamp}.zip`;

            downloadBlob(zipUrl, zipName);
        }
        // ---------------------------------------------------------------------
        // 模式 B: 单一文件合并 (Merged Single File)
        // ---------------------------------------------------------------------
        else if (packMode === 'merge') {
            const mergedRoot = {
                title: currentLang === 'zh_CN' ? '全局备份合并历史' : 'Global Merged Backup History',
                children: []
            };

            const mergedItems = [];
            for (const recordTime of selectedTimesSorted) {
                processedCount++;
                confirmBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${currentLang === 'zh_CN' ? '正在合并' : 'Merging'} (${processedCount}/${totalCount})`;
                await new Promise(r => requestAnimationFrame(r));

                const record = syncHistory.find(r => String(r.time) === String(recordTime));
                if (!record) continue;

                // 获取保存的视图模式
                const savedMode = getRecordDetailMode(record.time);
                const defaultMode = historyDetailMode || 'simple';
                const mode = savedMode || defaultMode;

                // 1. 获取该记录的处理后树（带 [+] [-] 前缀）
                const processedTree = await getProcessedTreeForRecord(record, mode);

                // 2. 创建容器文件夹
                const timeStr = formatTime(record.time);
                // 改为 Note + Hash + Mode + Time 格式
                const fingerprint = record.fingerprint ? ` [${record.fingerprint.substring(0, 8)}]` : '';
                const titlePrefix = record.note ? record.note : (currentLang === 'zh_CN' ? '备份' : 'Backup');
                const modeLabel = mode === 'simple' ? (currentLang === 'zh_CN' ? '简略' : 'Simple') : (currentLang === 'zh_CN' ? '详细' : 'Detailed');

                const seqNumber = seqMap.get(String(record.time));
                const seqStr = Number.isFinite(seqNumber) ? String(seqNumber).padStart(seqWidth, '0') : '00';
                const containerTitle = `${seqStr} ${titlePrefix}${fingerprint} (${modeLabel}) (${timeStr})`;
                const containerFolder = {
                    title: containerTitle,
                    children: processedTree.children || [] // processedTree 本身是 root，我们取其 children
                };

                mergedItems.push({ seq: Number.isFinite(seqNumber) ? seqNumber : -1, folder: containerFolder });
            }

            // 3. 添加到合并根（倒序：大的在前）
            mergedItems
                .sort((a, b) => b.seq - a.seq)
                .forEach(item => mergedRoot.children.push(item.folder));

            // 4. 生成合并后的文件
            if (formatHtml) {
                const htmlContent = generateBookmarkExportHTMLFromTree(mergedRoot);
                const blob = new Blob([htmlContent], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const timestamp = formatTimeForFilename();
                const mergedPrefix = currentLang === 'zh_CN' ? '全局合并历史' : 'Global_Merged_History';
                const namePrefix = selectionPrefix ? `${selectionPrefix}_${mergedPrefix}` : mergedPrefix;
                downloadBlob(url, `${namePrefix}_${timestamp}.html`);
            }

            if (formatJson) {
                const jsonContent = JSON.stringify(mergedRoot, null, 2);
                const blob = new Blob([jsonContent], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const timestamp = formatTimeForFilename();
                const mergedPrefix = currentLang === 'zh_CN' ? '全局合并历史' : 'Global_Merged_History';
                const namePrefix = selectionPrefix ? `${selectionPrefix}_${mergedPrefix}` : mergedPrefix;
                downloadBlob(url, `${namePrefix}_${timestamp}.json`);
            }

            if (formatMd) {
                // 使用 generateHistorySummaryMD 生成摘要表格 (替代原来的内容导出)
                // 注意：这里我们只生成一个包含所有选定记录摘要的文件
                // 我们不需要遍历记录来生成内容，而是直接传入 selectedTimes（需确保 generateHistorySummaryMD 接受此参数）

                const mdContent = await generateHistorySummaryMD(selectedTimesSorted);
                const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const timestamp = formatTimeForFilename();
                const prefix = currentLang === 'zh_CN' ? '书签备份历史记录' : 'Bookmark_Backup_History';
                const namePrefix = selectionPrefix ? `${selectionPrefix}_${prefix}` : prefix;
                downloadBlob(url, `${namePrefix}_${timestamp}.md`);
            }
        }

        closeGlobalExportModal();
        showToast(currentLang === 'zh_CN' ? '全局导出成功' : 'Global export successful');

    } catch (e) {
        console.error('Global Export Failed', e);
        showToast(currentLang === 'zh_CN' ? '导出失败' : 'Export failed');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = originalText;
    }
}

function __toUint8(text) {
    return new TextEncoder().encode(String(text || ''));
}

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

function __zipStore(files) {
    // files: Array<{ name: string, data: Uint8Array }>
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

function downloadBlob(url, filename) {
    // 同步导出到云端（云端1 WebDAV + 云端2 GitHub Repo）
    try {
        if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
            const lower = String(filename || '').toLowerCase();
            const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
            const contentTypeMap = {
                '.html': 'text/html;charset=utf-8',
                '.json': 'application/json;charset=utf-8',
                '.md': 'text/markdown;charset=utf-8',
                '.txt': 'text/plain;charset=utf-8',
                '.zip': 'application/zip'
            };
            const contentType = contentTypeMap[ext] || 'application/octet-stream';
            const isText = ext === '.html' || ext === '.json' || ext === '.md' || ext === '.txt';

            (async () => {
                try {
                    const res = await fetch(url);
                    if (!res.ok) return;

                    if (isText) {
                        const text = await res.text();
                        chrome.runtime.sendMessage({
                            action: 'exportFileToClouds',
                            folderKey: 'history',
                            lang: currentLang,
                            fileName: filename,
                            content: text,
                            contentType
                        }, () => { });
                        return;
                    }

                    const buf = await res.arrayBuffer();
                    // Chrome sendMessage 不支持直接传递 ArrayBuffer，需转换为 Base64
                    const bytes = new Uint8Array(buf);
                    const chunkSize = 0x2000;
                    let binary = '';
                    for (let i = 0; i < bytes.length; i += chunkSize) {
                        const chunk = bytes.subarray(i, i + chunkSize);
                        binary += String.fromCharCode(...chunk);
                    }
                    const base64 = btoa(binary);
                    chrome.runtime.sendMessage({
                        action: 'exportFileToClouds',
                        folderKey: 'history',
                        lang: currentLang,
                        fileName: filename,
                        contentBase64Binary: base64,
                        contentType
                    }, () => { });
                } catch (_) { }
            })();
        }
    } catch (_) { }

    // 使用统一的导出文件夹结构（根据语言动态选择）
    const exportPath = `${getHistoryExportRootFolder()}/${getHistoryExportFolder()}`;

    // 尝试使用 chrome.downloads API 以支持子目录
    if (chrome && chrome.downloads && typeof chrome.downloads.download === 'function') {
        chrome.downloads.download({
            url: url,
            filename: `${exportPath}/${filename}`,
            saveAs: false,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.warn('chrome.downloads API failed, falling back to <a> tag:', chrome.runtime.lastError);
                // 降级方案
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        });
    } else {
        // 降级方案
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
}

// 辅助：获取 JSON 内容对象（复用 generateHistoryChangesJSON 的逻辑但只返回对象）
async function generateExportJsonContentForGlobal(record, mode) {
    // 逻辑同 generateExportHtmlContentForGlobal，准备数据
    const { treeToExport, changeMap } = await prepareDataForExport(record);

    // 在详细模式下，尝试获取存储的展开状态（WYSIWYG）
    let expandedIds = null;
    if (mode === 'detailed' && hasRecordExpandedState(record.time)) {
        expandedIds = getRecordExpandedState(record.time);
    }

    return await generateHistoryChangesJSON(treeToExport, changeMap, mode, expandedIds);
}

// 辅助：准备导出数据 (Tree + ChangeMap)
async function prepareDataForExport(record) {
    let changeMap = new Map();
    await ensureRecordBookmarkTree(record);
    if (!record.bookmarkTree) {
        return { treeToExport: null, changeMap };
    }
    const recordIndex = syncHistory.findIndex(r => r.time === record.time);
    let previousRecord = null;
    if (recordIndex > 0) {
        for (let i = recordIndex - 1; i >= 0; i--) {
            if (syncHistory[i].status === 'success' && (syncHistory[i].bookmarkTree || syncHistory[i].hasData)) {
                previousRecord = syncHistory[i];
                break;
            }
        }
    }

    let treeToExport = record.bookmarkTree;
    if (previousRecord && !previousRecord.bookmarkTree && (previousRecord.hasData || previousRecord.status === 'success')) {
        try {
            const prevTree = await getBackupDataLazy(previousRecord.time);
            if (prevTree) previousRecord.bookmarkTree = prevTree;
        } catch (_) { }
    }
    if (previousRecord && previousRecord.bookmarkTree) {
        changeMap = await detectTreeChangesFast(previousRecord.bookmarkTree, record.bookmarkTree, {
            useGlobalExplicitMovedIds: false,
            explicitMovedIdSet: (record.bookmarkStats && Array.isArray(record.bookmarkStats.explicitMovedIds))
                ? record.bookmarkStats.explicitMovedIds
                : null
        });

        // 重建删除节点
        let hasDeleted = false;
        for (const [, change] of changeMap) {
            if (change.type && change.type.includes('deleted')) {
                hasDeleted = true;
                break;
            }
        }
        if (hasDeleted) {
            try {
                treeToExport = rebuildTreeWithDeleted(previousRecord.bookmarkTree, record.bookmarkTree, changeMap);
            } catch (error) {
                treeToExport = record.bookmarkTree; // fallback
            }
        }
    } else if (record.isFirstBackup) {
        const allNodes = flattenBookmarkTree(record.bookmarkTree);
        allNodes.forEach(item => {
            if (item.id) changeMap.set(item.id, { type: 'added' });
        });
    }

    return { treeToExport, changeMap };
}

// 重构：原有的 HTML 生成函数调用
async function generateExportHtmlContentForGlobal(record, mode) {
    const { treeToExport, changeMap } = await prepareDataForExport(record);

    // 在详细模式下，尝试获取存储的展开状态（WYSIWYG）
    let expandedIds = null;
    if (mode === 'detailed' && hasRecordExpandedState(record.time)) {
        expandedIds = getRecordExpandedState(record.time);
    }

    return await generateHistoryChangesHTML(treeToExport, changeMap, mode, expandedIds);
}

// 辅助：获取处理过的树（带前缀，已过滤）供合并使用
async function getProcessedTreeForRecord(record, mode) {
    const { treeToExport, changeMap } = await prepareDataForExport(record);

    // 在详细模式下，尝试获取存储的展开状态（WYSIWYG）
    let expandedIds = null;
    if (mode === 'detailed' && hasRecordExpandedState(record.time)) {
        expandedIds = getRecordExpandedState(record.time);
    }

    // 我们利用 generateHistoryChangesJSON 的 extractTree 逻辑来获取一个纯净的树对象
    // 但 generateHistoryChangesJSON 返回的是 { title:..., children:..., _exportInfo:... }
    // 我们只需要它的 children 部分，且它的 title 已经处理过前缀了。

    const jsonObj = await generateHistoryChangesJSON(treeToExport, changeMap, mode, expandedIds);

    // generateHistoryChangesJSON 返回结构：
    // { title: '...', children: [Legend, ...ActualTree], _exportInfo: ... }

    // 我们不需要 Legend 文件夹 (LegendFolder 是第一个 child)
    // 也不需要 _exportInfo
    // 我们只需要 ActualTree 部分

    const actualChildren = jsonObj.children ? jsonObj.children.filter(child => child.title && !child.title.startsWith('📋') && !child.title.startsWith('Log')) : [];

    // 过滤掉 Legend 之后就是我们的树了。
    // 但是 generateHistoryChangesJSON 里的 extractTree 会返回兼容 Chrome API 的结构 { title, url, children }
    // 这正是我们需要的结构，以便再次喂给 generateHistoryChangesHTML

    return {
        children: actualChildren
    };
}

// 辅助：生成 Markdown 内容 (Tree -> MD)
async function generateHistoryChangesMD(treeRoot, changeMap = new Map(), mode = 'simple') {
    let mdContent = '';

    // 递归函数生成 MD
    function traverse(node, depth) {
        // 跳过特定文件夹
        if (node.title && (node.title.startsWith('📋') || node.title.startsWith('Log'))) {
            return;
        }

        if (node.children) {
            // Folder
            if (depth === 0) {
                // Root level
                if (node.title) mdContent += `# ${node.title}\n\n`;
            } else if (depth === 1) {
                // Level 1: Backup Containers (in merged mode)
                if (node.title) mdContent += `## ${node.title}\n\n`;
            } else {
                // Sub-folders: Nested list item
                // Adjust indent: depth 2 -> 0 spaces (top level list under header)
                const indentLevel = Math.max(0, depth - 2);
                const indent = '  '.repeat(indentLevel);
                const title = node.title || 'Untitled Folder';
                mdContent += `${indent}- **${title}**\n`;
            }

            node.children.forEach(child => traverse(child, depth + 1));
        } else {
            // Bookmark
            const indentLevel = Math.max(0, depth - 2);
            const indent = '  '.repeat(indentLevel);

            // Standard: - [Title](URL)
            // Title check
            const title = node.title || node.url || 'Untitled';
            const url = node.url || '';

            // Escape brackets in title to avoid breaking MD links?
            // Simple replace [ ] with ( ) or just escape.
            const safeTitle = title.replace(/\[/g, '(').replace(/\]/g, ')');

            mdContent += `${indent}- [${safeTitle}](${url})\n`;
        }
    }

    traverse(treeRoot, 0);
    return mdContent;
}

// 辅助：生成 Markdown 摘要表格 (逻辑移植自 popup.js)
async function generateHistorySummaryMD(selectedTimes) {
    let mdContent = '';
    const lang = currentLang; // 获取当前语言
    const naText = lang === 'zh_CN' ? '无' : 'N/A';

    // 1. 获取选中的记录并按时间排序 (新的在前)
    // selectedTimes 是时间戳字符串数组，syncHistory 是记录数组
    const selectedRecords = syncHistory.filter(r => selectedTimes.includes(String(r.time)))
        .sort((a, b) => new Date(b.time) - new Date(a.time));
    const seqMap = buildSequenceMapFromHistory(syncHistory);

    // 2. 准备表头和文本
    const exportTitle = {
        'zh_CN': "# 书签备份历史记录",
        'en': "# Bookmark Backup History"
    };
    const exportNote = {
        'zh_CN': "注意：此文件包含了所选备份历史记录的摘要统计表格。",
        'en': "Note: This file contains a summary table of the selected backup history records."
    };
    const tableHeaders = {
        seq: { 'zh_CN': "序号", 'en': "No." },
        notes: { 'zh_CN': "备注", 'en': "Notes" },
        timestamp: { 'zh_CN': "时间戳", 'en': "Timestamp" },
        bookmarkChange: { 'zh_CN': "书签变化", 'en': "BKM Change" },
        folderChange: { 'zh_CN': "文件夹变化", 'en': "FLD Change" },
        movedCount: { 'zh_CN': "移动", 'en': "Moved" },
        modifiedCount: { 'zh_CN': "修改", 'en': "Modified" },
        location: { 'zh_CN': "位置", 'en': "Location" },
        backupMode: { 'zh_CN': "方式", 'en': "Mode" },
        status: { 'zh_CN': "状态/错误", 'en': "Status/Error" },
        hash: { 'zh_CN': "哈希值", 'en': "Hash" }
    };
    const locationValues = {
        upload: { 'zh_CN': "云端", 'en': "Cloud" }, // 兼容旧记录
        cloud: { 'zh_CN': "云端1, 云端2", 'en': "Cloud 1, Cloud 2" },
        webdav: { 'zh_CN': "云端1(WebDAV)", 'en': "Cloud 1 (WebDAV)" },
        github_repo: { 'zh_CN': "云端2(GitHub仓库)", 'en': "Cloud 2 (GitHub Repo)" },
        gist: { 'zh_CN': "云端2(GitHub仓库)", 'en': "Cloud 2 (GitHub Repo)" }, // legacy
        cloud_local: { 'zh_CN': "云端1, 云端2, 本地", 'en': "Cloud 1, Cloud 2, Local" },
        webdav_local: { 'zh_CN': "云端1(WebDAV), 本地", 'en': "Cloud 1 (WebDAV), Local" },
        github_repo_local: { 'zh_CN': "云端2(GitHub仓库), 本地", 'en': "Cloud 2 (GitHub Repo), Local" },
        gist_local: { 'zh_CN': "云端2(GitHub仓库), 本地", 'en': "Cloud 2 (GitHub Repo), Local" }, // legacy
        local: { 'zh_CN': "本地", 'en': "Local" },
        both: { 'zh_CN': "云端1(WebDAV), 本地", 'en': "Cloud 1 (WebDAV), Local" }, // 兼容旧记录
        none: { 'zh_CN': "无", 'en': "None" }
    };
    const statusValues = {
        success: { 'zh_CN': "成功", 'en': "Success" },
        error: { 'zh_CN': "错误", 'en': "Error" },
        locked: { 'zh_CN': "文件锁定", 'en': "File Locked" },
        noBackupNeeded: { 'zh_CN': "无需备份", 'en': "No backup needed" },
        checkCompleted: { 'zh_CN': "检查完成", 'en': "Check completed" }
    };
    const backupModeValues = {
        auto: { 'zh_CN': "自动", 'en': "Auto" },
        manual: { 'zh_CN': "手动", 'en': "Manual" },
        switch: { 'zh_CN': "切换", 'en': "Switch" },
        migration: { 'zh_CN': "迁移", 'en': "Migration" },
        check: { 'zh_CN': "检查", 'en': "Check" },
        restore: { 'zh_CN': "恢复", 'en': "Restore" },
        unknown: { 'zh_CN': "未知", 'en': "Unknown" }
    };

    const formatTimeForExport = (date) => {
        return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    };

    // Header section
    mdContent += exportTitle[lang] + "\n\n";
    mdContent += exportNote[lang] + "\n\n";

    // Table Headers
    mdContent += `| ${tableHeaders.seq[lang]} | ${tableHeaders.notes[lang]} | ${tableHeaders.timestamp[lang]} | ${tableHeaders.bookmarkChange[lang]} | ${tableHeaders.folderChange[lang]} | ${tableHeaders.movedCount[lang]} | ${tableHeaders.modifiedCount[lang]} | ${tableHeaders.location[lang]} | ${tableHeaders.backupMode[lang]} | ${tableHeaders.status[lang]} | ${tableHeaders.hash[lang]} |\n`;
    mdContent += "|---|---|---|---|---|---|---|---|---|---|---|\n";

    // 3. 遍历记录生成表格行
    let previousDateStr = null;

    selectedRecords.forEach(record => {
        const recordDate = new Date(record.time);
        const time = formatTimeForExport(recordDate);

        // 检查日期是否变化（年月日）
        const currentDateStr = `${recordDate.getFullYear()}-${recordDate.getMonth() + 1}-${recordDate.getDate()}`;

        // 如果日期变化，添加分界线
        if (previousDateStr && previousDateStr !== currentDateStr) {
            const formattedPreviousDate = lang === 'en' ?
                `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
                `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;

            // 添加简洁的分界线，并入表格中
            mdContent += `|  | **${formattedPreviousDate}** |  |  |  |  |  |  |  |  |  |\n`;
        }
        previousDateStr = currentDateStr;

        // 获取统计数据逻辑（与 popup.js / 主UI一致：显示 +x/-y 的绝对量；旧数据回退到 diff）
        const bookmarkAdded = typeof record.bookmarkStats?.bookmarkAdded === 'number' ? record.bookmarkStats.bookmarkAdded : 0;
        const bookmarkDeleted = typeof record.bookmarkStats?.bookmarkDeleted === 'number' ? record.bookmarkStats.bookmarkDeleted : 0;
        const folderAdded = typeof record.bookmarkStats?.folderAdded === 'number' ? record.bookmarkStats.folderAdded : 0;
        const folderDeleted = typeof record.bookmarkStats?.folderDeleted === 'number' ? record.bookmarkStats.folderDeleted : 0;

        // 格式化书签变化（+x/-y 或者 0）
        let bookmarkChangeText = '';
        if (bookmarkAdded > 0 && bookmarkDeleted > 0) {
            bookmarkChangeText = `+${bookmarkAdded}/-${bookmarkDeleted}`;
        } else if (bookmarkAdded > 0) {
            bookmarkChangeText = `+${bookmarkAdded}`;
        } else if (bookmarkDeleted > 0) {
            bookmarkChangeText = `-${bookmarkDeleted}`;
        } else {
            // 兼容旧数据：使用 bookmarkDiff
            const diff = record.bookmarkStats?.bookmarkDiff ?? 0;
            bookmarkChangeText = diff > 0 ? `+${diff}` : (diff < 0 ? `${diff}` : '0');
        }

        // 格式化文件夹变化（+x/-y 或者 0）
        let folderChangeText = '';
        if (folderAdded > 0 && folderDeleted > 0) {
            folderChangeText = `+${folderAdded}/-${folderDeleted}`;
        } else if (folderAdded > 0) {
            folderChangeText = `+${folderAdded}`;
        } else if (folderDeleted > 0) {
            folderChangeText = `-${folderDeleted}`;
        } else {
            // 兼容旧数据：使用 folderDiff
            const diff = record.bookmarkStats?.folderDiff ?? 0;
            folderChangeText = diff > 0 ? `+${diff}` : (diff < 0 ? `${diff}` : '0');
        }

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

        let locationText = naText;
        const recordDirection = (record.direction ?? 'none').toString();
        if (locationValues[recordDirection]) {
            locationText = locationValues[recordDirection][lang];
        } else if (recordDirection === 'download') {
            // 兼容旧记录
            locationText = locationValues.local[lang];
        } else if (recordDirection === 'none') {
            locationText = locationValues.none[lang];
        }

        const normalizeBackupModeKey = (recordType, direction) => {
            const raw = (recordType ?? '').toString().trim();
            const lowered = raw.toLowerCase();

            if (lowered === 'restore' || raw.includes('恢复')) return 'restore';
            if (lowered === 'manual' || raw === '（手动）' || raw.includes('手动')) return 'manual';
            if (lowered === 'switch' || lowered === 'auto_switch' || raw === '（切换）' || raw.includes('切换')) return 'switch';
            if (lowered === 'migration' || raw === '（迁移）' || raw.includes('迁移')) return 'migration';
            if (lowered === 'check' || raw.includes('检查')) return 'check';
            // “direction === none” 基本是检查类记录
            if (direction === 'none') return 'check';
            if (lowered === 'auto' || raw === '（自动）' || raw.includes('自动') || !raw) return 'auto';
            return 'unknown';
        };
        const backupModeKey = normalizeBackupModeKey(record.type, record.direction);
        const backupModeText = (backupModeValues[backupModeKey] || backupModeValues.unknown)[lang];

        let statusText = naText;
        if (record.status === 'success') {
            if (record.direction === 'none') {
                statusText = statusValues.checkCompleted[lang] || statusValues.noBackupNeeded[lang];
            } else {
                statusText = statusValues.success[lang];
            }
        } else if (record.status === 'error') {
            statusText = record.errorMessage ? `${statusValues.error[lang]}: ${record.errorMessage}` : statusValues.error[lang];
        } else if (record.status === 'locked') {
            statusText = statusValues.locked[lang];
        }

        const fingerprint = record.fingerprint ? String(record.fingerprint) : '-';

        const safeNote = String(record.note || '').replace(/\|/g, '\\|');
        const safeStatusText = String(statusText || '').replace(/\|/g, '\\|');
        const safeFingerprint = String(fingerprint || '').replace(/\|/g, '\\|');

        const seqNumber = seqMap.get(String(record.time));
        const seqText = Number.isFinite(seqNumber) ? String(seqNumber) : '-';

        // 行数据
        mdContent += `| ${seqText} | ${safeNote} | ${time} | ${bookmarkChangeText} | ${folderChangeText} | ${movedText} | ${modifiedText} | ${locationText} | ${backupModeText} | ${safeStatusText} | ${safeFingerprint} |\n`;
    });

    // 最后添加日期分界线
    if (previousDateStr) {
        const formattedPreviousDate = lang === 'en' ?
            `${previousDateStr.split('-')[0]}-${previousDateStr.split('-')[1].padStart(2, '0')}-${previousDateStr.split('-')[2].padStart(2, '0')}` :
            `${previousDateStr.split('-')[0]}年${previousDateStr.split('-')[1]}月${previousDateStr.split('-')[2]}日`;
        mdContent += `|  | **${formattedPreviousDate}** |  |  |  |  |  |  |  |  |  |\n`;
    }

    return mdContent;
}
