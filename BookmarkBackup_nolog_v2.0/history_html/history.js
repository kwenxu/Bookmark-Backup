// =============================================================================
// 全局变量和常量
// =============================================================================

let currentLang = 'zh_CN';
let currentTheme = 'light';
let currentView = 'current-changes';
let currentFilter = 'all';
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

// 浏览器 API 兼容性
const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;

// 实时更新状态控制
let viewerInitialized = false;
let deferredAnalysisMessage = null;
let messageListenerRegistered = false;
let realtimeUpdateInProgress = false;
let pendingAnalysisMessage = null;
let lastAnalysisSignature = null;

// =============================================================================
// 辅助函数 - URL 处理
// =============================================================================

// 安全地获取网站图标 URL
function getFaviconUrl(url) {
    if (!url) return '';
    
    // 验证是否是有效的 HTTP/HTTPS URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return '';
    }
    
    try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch (error) {
        console.warn('[getFaviconUrl] 无效的 URL:', url);
        return '';
    }
}

// Fallback 图标（SVG 圆圈）
const fallbackIcon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23999"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3C/svg%3E';

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
    navCurrentChanges: {
        'zh_CN': '当前 数量/结构 变化',
        'en': 'Current Changes'
    },
    navHistory: {
        'zh_CN': '备份历史',
        'en': 'Backup History'
    },
    navAdditions: {
        'zh_CN': '书签添加记录',
        'en': 'Bookmark Additions'
    },
    navTree: {
        'zh_CN': '书签树',
        'en': 'Bookmark Tree'
    },
    statsTitle: {
        'zh_CN': '统计信息',
        'en': 'Statistics'
    },
    statBackups: {
        'zh_CN': '总备份次数',
        'en': 'Total Backups'
    },
    statBookmarks: {
        'zh_CN': '当前书签',
        'en': 'Current Bookmarks'
    },
    statFolders: {
        'zh_CN': '当前文件夹',
        'en': 'Current Folders'
    },
    currentChangesViewTitle: {
        'zh_CN': '当前 数量/结构 变化',
        'en': 'Current Changes'
    },
    currentChangesViewDesc: {
        'zh_CN': '查看未备份的书签变化详情',
        'en': 'View unbacked bookmark changes details'
    },
    historyViewTitle: {
        'zh_CN': '备份历史记录',
        'en': 'Backup History'
    },
    historyViewDesc: {
        'zh_CN': '查看所有备份记录及其详细变化',
        'en': 'View all backup records and detailed changes'
    },
    additionsViewTitle: {
        'zh_CN': '书签添加记录',
        'en': 'Bookmark Additions'
    },
    additionsViewDesc: {
        'zh_CN': '按时间和文件夹分类查看新增书签',
        'en': 'View new bookmarks by time and folder'
    },
    treeViewTitle: {
        'zh_CN': '书签树',
        'en': 'Bookmark Tree'
    },
    treeViewDesc: {
        'zh_CN': '查看完整的书签结构及备份状态',
        'en': 'View complete bookmark structure and backup status'
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
    emptyAdditions: {
        'zh_CN': '暂无书签添加记录',
        'en': 'No bookmark additions'
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
    }
};

// =============================================================================
// 初始化
// =============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('历史查看器初始化...');
    
    // 从 URL 参数检查是否直接跳转到详情视图
    const urlParams = new URLSearchParams(window.location.search);
    const recordTime = urlParams.get('record');
    
    // 加载用户设置
    await loadUserSettings();
    
    // 初始化 UI
    initializeUI();

    // 注册消息监听
    setupRealtimeMessageListener();
    
    // 显示加载状态
    const container = document.getElementById('currentChangesList');
    if (container) {
        container.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    }
    
    // 先加载基础数据
    console.log('[初始化] 加载基础数据...');
    await loadAllData();
    
    // 使用智能等待：尝试渲染，如果数据不完整则等待后重试
    // 初始化时强制刷新缓存，确保显示最新数据
    console.log('[初始化] 开始渲染（带重试机制，强制刷新缓存）...');
    await renderCurrentChangesViewWithRetry(3, true);
    
    // 并行预加载其他视图和图标（不阻塞）
    Promise.all([
        preloadAllViews(),
        preloadCommonIcons()
    ]).then(() => {
        console.log('[初始化] 所有资源预加载完成');
        
        // 如果有 recordTime 参数，直接打开详情弹窗
        if (recordTime) {
            const record = syncHistory.find(r => r.time === recordTime);
            if (record) {
                showDetailModal(record);
            }
        }
    }).catch(error => {
        console.error('[初始化] 预加载失败:', error);
    });
    
    // 监听存储变化（实时更新）
    browserAPI.storage.onChanged.addListener(handleStorageChange);

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

async function loadUserSettings() {
    return new Promise((resolve) => {
        browserAPI.storage.local.get(['preferredLang', 'currentTheme'], (result) => {
            currentLang = result.preferredLang || 'zh_CN';
            currentTheme = result.currentTheme || 'light';
            
            // 应用主题
            document.documentElement.setAttribute('data-theme', currentTheme);
            
            // 应用语言
            applyLanguage();
            
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
    document.getElementById('navTreeText').textContent = i18n.navTree[currentLang];
    document.getElementById('statsTitle').textContent = i18n.statsTitle[currentLang];
    document.getElementById('statBackupsLabel').textContent = i18n.statBackups[currentLang];
    document.getElementById('statBookmarksLabel').textContent = i18n.statBookmarks[currentLang];
    document.getElementById('statFoldersLabel').textContent = i18n.statFolders[currentLang];
    document.getElementById('currentChangesViewTitle').textContent = i18n.currentChangesViewTitle[currentLang];
    document.getElementById('currentChangesViewDesc').textContent = i18n.currentChangesViewDesc[currentLang];
    document.getElementById('historyViewTitle').textContent = i18n.historyViewTitle[currentLang];
    document.getElementById('historyViewDesc').textContent = i18n.historyViewDesc[currentLang];
    document.getElementById('additionsViewTitle').textContent = i18n.additionsViewTitle[currentLang];
    document.getElementById('additionsViewDesc').textContent = i18n.additionsViewDesc[currentLang];
    document.getElementById('treeViewTitle').textContent = i18n.treeViewTitle[currentLang];
    document.getElementById('treeViewDesc').textContent = i18n.treeViewDesc[currentLang];
    document.getElementById('filterAll').textContent = i18n.filterAll[currentLang];
    document.getElementById('filterBackedUp').textContent = i18n.filterBackedUp[currentLang];
    document.getElementById('filterNotBackedUp').textContent = i18n.filterNotBackedUp[currentLang];
    document.getElementById('modalTitle').textContent = i18n.modalTitle[currentLang];
    
    // 更新工具按钮气泡
    document.getElementById('refreshTooltip').textContent = i18n.refreshTooltip[currentLang];
    document.getElementById('themeTooltip').textContent = i18n.themeTooltip[currentLang];
    document.getElementById('langTooltip').textContent = i18n.langTooltip[currentLang];
    
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
    
    // 过滤按钮
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdditionsView();
        });
    });
    
    // 工具按钮
    document.getElementById('refreshBtn').addEventListener('click', refreshData);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('langToggle').addEventListener('click', toggleLanguage);
    
    // 搜索
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    
    // 弹窗关闭
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('detailModal').addEventListener('click', (e) => {
        if (e.target.id === 'detailModal') closeModal();
    });
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
        lastBackupTime = storageData.lastSyncTime || null;
        allBookmarks = flattenBookmarkTree(bookmarkTree);
        cachedBookmarkTree = bookmarkTree;
        
        console.log('[loadAllData] 数据加载完成:', {
            历史记录数: syncHistory.length,
            书签总数: allBookmarks.length
        });
        
        // 更新统计信息
        updateStats();
        
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

// 预加载单个图标
function preloadIcon(url) {
    return new Promise((resolve) => {
        // 基本验证
        if (!url || preloadedIcons.has(url)) {
            resolve();
            return;
        }
        
        // 验证 URL 格式
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            resolve();
            return;
        }
        
        try {
            const urlObj = new URL(url);
            const domain = urlObj.origin;
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
            
            const img = new Image();
            img.onload = () => {
                preloadedIcons.set(url, faviconUrl);
                resolve();
            };
            img.onerror = () => {
                resolve(); // 失败也继续
            };
            img.src = faviconUrl;
            
            // 超时保护
            setTimeout(() => resolve(), 2000);
        } catch (error) {
            console.warn('[图标预加载] URL 无效:', url, error.message);
            resolve();
        }
    });
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
        if (bookmarkMoved) {
            structuralParts.push(`${effectiveLang === 'en' ? 'BKM moved' : '书签移动'}${typeof stats?.bookmarkMoved === 'number' ? ` (${stats.bookmarkMoved})` : ''}`);
            summary.structuralItems.push(`${effectiveLang === 'en' ? 'Bookmark moved' : '书签移动'}${typeof stats?.bookmarkMoved === 'number' ? ` (${stats.bookmarkMoved})` : ''}`);
        }
        if (folderMoved) {
            structuralParts.push(`${effectiveLang === 'en' ? 'FLD moved' : '文件夹移动'}${typeof stats?.folderMoved === 'number' ? ` (${stats.folderMoved})` : ''}`);
            summary.structuralItems.push(`${effectiveLang === 'en' ? 'Folder moved' : '文件夹移动'}${typeof stats?.folderMoved === 'number' ? ` (${stats.folderMoved})` : ''}`);
        }
        if (bookmarkModified) {
            structuralParts.push(`${effectiveLang === 'en' ? 'BKM modified' : '书签修改'}${typeof stats?.bookmarkModified === 'number' ? ` (${stats.bookmarkModified})` : ''}`);
            summary.structuralItems.push(`${effectiveLang === 'en' ? 'Bookmark modified' : '书签修改'}${typeof stats?.bookmarkModified === 'number' ? ` (${stats.bookmarkModified})` : ''}`);
        }
        if (folderModified) {
            structuralParts.push(`${effectiveLang === 'en' ? 'FLD modified' : '文件夹修改'}${typeof stats?.folderModified === 'number' ? ` (${stats.folderModified})` : ''}`);
            summary.structuralItems.push(`${effectiveLang === 'en' ? 'Folder modified' : '文件夹修改'}${typeof stats?.folderModified === 'number' ? ` (${stats.folderModified})` : ''}`);
        }
        
        // 用具体的变化类型替代通用的"变动"标签
        const separator = effectiveLang === 'en' ? ' <span style="color:var(--text-tertiary);">|</span> ' : '、';
        const structuralText = structuralParts.join(separator);
        summary.structuralLine = `<span style="color:var(--accent-secondary, #FF9800);font-weight:bold;">${structuralText}</span>`;
    }

    return summary;
}

// =============================================================================
// 统计信息更新
// =============================================================================

function updateStats() {
    const totalBackups = syncHistory.length;
    const currentBookmarks = allBookmarks.length;
    
    // 计算文件夹数（从最新备份记录获取）
    let currentFolders = 0;
    if (syncHistory.length > 0) {
        const latestRecord = syncHistory[syncHistory.length - 1];
        currentFolders = latestRecord.bookmarkStats?.currentFolderCount || 
                        latestRecord.bookmarkStats?.currentFolders || 0;
    }
    
    document.getElementById('statBackupsCount').textContent = totalBackups;
    document.getElementById('statBookmarksCount').textContent = currentBookmarks;
    document.getElementById('statFoldersCount').textContent = currentFolders;
}

// =============================================================================
// 视图切换
// =============================================================================

function switchView(view) {
    currentView = view;
    
    // 更新导航标签
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (tab.dataset.view === view) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // 更新内容区域
    document.querySelectorAll('.view').forEach(v => {
        if (v.id === `${view}View`) {
            v.classList.add('active');
        } else {
            v.classList.remove('active');
        }
    });
    
    // 渲染当前视图
    renderCurrentView();
}

function renderCurrentView() {
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
        case 'tree':
            renderTreeView();
            break;
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
            // 创建一个网格容器来并排显示两个卡片
            html += '<div class="changes-grid">';
            
            // 数量变化卡片
            html += '<div class="change-card quantity-change">';
            html += `<div class="change-card-header">`;
            html += `<i class="fas fa-chart-line change-icon"></i>`;
            html += `<h3 class="change-title">${currentLang === 'zh_CN' ? '数量变化' : 'Quantity Changes'}</h3>`;
            html += `</div>`;
            html += `<div class="change-card-body">`;
            
            html += `<div class="change-summary">${summary.quantityTotalLine}</div>`;
            if (hasQuantityChange && summary.quantityDiffLine) {
                html += `<div class="change-details">${summary.quantityDiffLine}</div>`;
            } else {
                html += `<div class="change-empty">`;
                html += `<i class="fas fa-check-circle"></i>`;
                html += `<span>${currentLang === 'zh_CN' ? '无数量变化' : 'No quantity changes'}</span>`;
                html += `</div>`;
            }
            html += `</div>`; // 结束 change-card-body
            html += '</div>'; // 结束 change-card
            
            // 结构变化卡片
            html += '<div class="change-card structure-change">';
            html += `<div class="change-card-header">`;
            html += `<i class="fas fa-random change-icon"></i>`;
            html += `<h3 class="change-title">${currentLang === 'zh_CN' ? '结构变化' : 'Structure Changes'}</h3>`;
            html += `</div>`;
            html += `<div class="change-card-body">`;
            
            if (hasStructureChange && summary.structuralLine) {
                html += `<div class="change-details">${summary.structuralLine}</div>`;

                if (summary.structuralItems && summary.structuralItems.length > 0) {
                    html += '<ul class="change-list">';
                    summary.structuralItems.forEach(item => {
                        html += `<li>${item}</li>`;
                    });
                    html += '</ul>';
                }
            } else {
                html += `<div class="change-empty">`;
                html += `<i class="fas fa-check-circle"></i>`;
                html += `<span>${currentLang === 'zh_CN' ? '无结构变化' : 'No structure changes'}</span>`;
                html += `</div>`;
            }
            html += `</div>`; // 结束 change-card-body
            html += '</div>'; // 结束 change-card
            
            html += '</div>'; // 结束 changes-grid
        }
        
        // 2. 再显示详细列表（如果有）
        let detailsHtml = '';
        
        // 新增的书签
        if (changeData.added && changeData.added.length > 0) {
            detailsHtml += renderChangeCategory('added', changeData.added);
        }
        
        // 删除的书签
        if (changeData.deleted && changeData.deleted.length > 0) {
            detailsHtml += renderChangeCategory('deleted', changeData.deleted);
        }
        
        // 移动的书签
        if (changeData.moved && changeData.moved.length > 0) {
            detailsHtml += renderChangeCategory('moved', changeData.moved);
        }
        
        // 修改的书签  
        if (changeData.modified && changeData.modified.length > 0) {
            detailsHtml += renderChangeCategory('modified', changeData.modified);
        }
        
        if (detailsHtml === '') {
            // 只有数量/结构变化，没有详细列表
            html += `
                <div class="no-changes-message" style="margin-top: 20px;">
                    <div class="no-changes-icon"><i class="fas fa-info-circle"></i></div>
                    <div class="no-changes-title">${currentLang === 'zh_CN' ? '无详细列表' : 'No Detailed List'}</div>
                    <div class="no-changes-desc">
                        <small style="color: var(--text-tertiary);">
                            ${currentLang === 'zh_CN' ? '由于浏览器扩展限制，只能显示统计信息。请进行一次备份以记录当前状态。' : 'Due to browser extension limitations, only statistics are shown. Please perform a backup to record the current state.'}
                        </small>
                    </div>
                </div>
            `;
        } else {
            html += detailsHtml;
        }
        
        container.innerHTML = html;
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

function renderChangeCategory(type, bookmarks) {
    if (bookmarks.length === 0) return '';
    
    const icons = {
        'added': 'fa-plus',
        'deleted': 'fa-minus',
        'modified': 'fa-edit',
        'moved': 'fa-arrows-alt'
    };
    
    const titles = {
        'added': { 'zh_CN': '新增书签', 'en': 'Added Bookmarks' },
        'deleted': { 'zh_CN': '删除书签', 'en': 'Deleted Bookmarks' },
        'modified': { 'zh_CN': '修改书签', 'en': 'Modified Bookmarks' },
        'moved': { 'zh_CN': '移动书签', 'en': 'Moved Bookmarks' }
    };
    
    // 按文件夹路径分组
    const byFolder = {};
    bookmarks.forEach(bookmark => {
        // 使用 path 字段作为文件夹路径
        const folderPath = bookmark.path || (currentLang === 'zh_CN' ? '根目录' : 'Root');
        if (!byFolder[folderPath]) {
            byFolder[folderPath] = [];
        }
        byFolder[folderPath].push(bookmark);
    });
    
    return `
        <div class="change-category">
            <div class="change-category-header">
                <div class="change-category-icon ${type}">
                    <i class="fas ${icons[type]}"></i>
                </div>
                <div class="change-category-title">${titles[type][currentLang]}</div>
                <div class="change-category-count">${bookmarks.length} ${i18n.bookmarks[currentLang]}</div>
            </div>
            <div class="change-tree">
                ${Object.entries(byFolder).map(([folder, items]) => `
                    <div class="change-tree-node">
                        <div class="change-tree-folder">
                            <i class="fas fa-folder"></i>
                            <span class="change-tree-folder-name">${escapeHtml(folder)}</span>
                            <span style="color: var(--text-tertiary); font-size: 12px;">${items.length}</span>
                        </div>
                        <div class="change-tree-items">
                            ${items.map(item => renderChangeTreeItem(item, type)).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
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
        <div class="change-tree-item">
            ${favicon ? `<img class="change-tree-item-icon" 
                 src="${favicon}" 
                 alt=""
                 onerror="this.src='${fallbackIcon}'">` : ''}
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
        const isAuto = record.isAutoBackup !== false;
        const isSuccess = record.status === 'success';
        
        // 计算变化
        const changes = calculateChanges(record, index, reversedHistory);
        
        // 构建提交项
        return `
            <div class="commit-item" data-record-time="${record.time}">
                <div class="commit-header">
                    <div class="commit-title">
                        ${record.note || (isSuccess ? i18n.success[currentLang] : i18n.error[currentLang])}
                    </div>
                    <div class="commit-time">${time}</div>
                </div>
                <div class="commit-meta">
                    <span class="commit-badge ${isAuto ? 'auto' : 'manual'}">
                        <i class="fas ${isAuto ? 'fa-robot' : 'fa-hand-pointer'}"></i>
                        ${isAuto ? i18n.autoBackup[currentLang] : i18n.manualBackup[currentLang]}
                    </span>
                    <span class="commit-badge ${isSuccess ? 'success' : 'error'}">
                        <i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
                        ${isSuccess ? i18n.success[currentLang] : i18n.error[currentLang]}
                    </span>
                </div>
                ${renderCommitStats(changes)}
            </div>
        `;
    }).join('');
    
    // 添加点击事件
    container.querySelectorAll('.commit-item').forEach(item => {
        item.addEventListener('click', () => {
            const recordTime = item.dataset.recordTime;
            const record = syncHistory.find(r => r.time === recordTime);
            if (record) showDetailModal(record);
        });
    });
}

function calculateChanges(record, index, reversedHistory) {
    const current = record.bookmarkStats || {};
    const currentBookmarks = current.currentBookmarkCount || current.currentBookmarks || 0;
    const currentFolders = current.currentFolderCount || current.currentFolders || 0;
    
    // 如果是第一次备份
    if (record.isFirstBackup || index === reversedHistory.length - 1) {
        return {
            bookmarkDiff: currentBookmarks,
            folderDiff: currentFolders,
            isFirst: true
        };
    }
    
    // 查找前一条记录
    const prevRecord = reversedHistory[index + 1];
    const prev = prevRecord?.bookmarkStats || {};
    const prevBookmarks = prev.currentBookmarkCount || prev.currentBookmarks || 0;
    const prevFolders = prev.currentFolderCount || prev.currentFolders || 0;
    
    return {
        bookmarkDiff: currentBookmarks - prevBookmarks,
        folderDiff: currentFolders - prevFolders,
        isFirst: false
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
    
    const parts = [];
    
    if (changes.bookmarkDiff !== 0) {
        const className = changes.bookmarkDiff > 0 ? 'added' : 'deleted';
        const icon = changes.bookmarkDiff > 0 ? 'fa-plus' : 'fa-minus';
        parts.push(`
            <span class="stat-change ${className}">
                <i class="fas ${icon}"></i>
                ${Math.abs(changes.bookmarkDiff)} ${i18n.bookmarks[currentLang]}
            </span>
        `);
    }
    
    if (changes.folderDiff !== 0) {
        const className = changes.folderDiff > 0 ? 'added' : 'deleted';
        const icon = changes.folderDiff > 0 ? 'fa-plus' : 'fa-minus';
        parts.push(`
            <span class="stat-change ${className}">
                <i class="fas ${icon}"></i>
                ${Math.abs(changes.folderDiff)} ${i18n.folders[currentLang]}
            </span>
        `);
    }
    
    if (parts.length === 0) {
        parts.push(`<span>${i18n.noChanges[currentLang]}</span>`);
    }
    
    return `<div class="commit-stats">${parts.join('')}</div>`;
}

// =============================================================================
// 书签添加记录视图
// =============================================================================

function renderAdditionsView() {
    const container = document.getElementById('additionsList');
    
    if (allBookmarks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-bookmark"></i></div>
                <div class="empty-state-title">${i18n.emptyAdditions[currentLang]}</div>
            </div>
        `;
        return;
    }
    
    // 按日期分组
    const groupedByDate = groupBookmarksByDate(allBookmarks);
    
    // 过滤
    const filtered = filterBookmarks(groupedByDate);
    
    container.innerHTML = renderBookmarkGroups(filtered);
}

function groupBookmarksByDate(bookmarks) {
    const groups = {};
    
    bookmarks.forEach(bookmark => {
        const date = new Date(bookmark.dateAdded);
        const dateKey = date.toLocaleDateString(currentLang === 'en' ? 'en-US' : 'zh-CN');
        
        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        groups[dateKey].push(bookmark);
    });
    
    return groups;
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
    return bookmark.dateAdded < lastBackupTime;
}

function renderBookmarkGroups(groups) {
    const sortedDates = Object.keys(groups).sort((a, b) => {
        return new Date(b) - new Date(a);
    });
    
    return sortedDates.map(date => {
        const bookmarks = groups[date];
        return `
            <div class="addition-group">
                <div class="addition-group-header">
                    <span>${date}</span>
                    <span class="addition-count">${bookmarks.length} ${i18n.bookmarks[currentLang]}</span>
                </div>
                <div class="addition-items">
                    ${bookmarks.map(renderBookmarkItem).join('')}
                </div>
            </div>
        `;
    }).join('');
}

function renderBookmarkItem(bookmark) {
    const isBackedUp = isBookmarkBackedUp(bookmark);
    const favicon = getFaviconUrl(bookmark.url);
    
    return `
        <div class="addition-item">
            ${favicon ? `<img class="addition-icon" src="${favicon}" alt="" onerror="this.src='${fallbackIcon}'">` : ''}
            <div class="addition-info">
                <div class="addition-title">${escapeHtml(bookmark.title)}</div>
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

function renderTreeView() {
    const container = document.getElementById('bookmarkTree');
    
    // 优先使用缓存
    if (cachedBookmarkTree) {
        console.log('[renderTreeView] 使用缓存数据');
        const tree = cachedBookmarkTree;
        
        if (!tree || tree.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-sitemap"></i></div>
                    <div class="empty-state-title">${i18n.emptyTree[currentLang]}</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = renderTreeNode(tree[0]);
        
        // 添加展开/折叠功能
        container.querySelectorAll('.tree-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const node = toggle.closest('.tree-node');
                const children = node.querySelector('.tree-children');
                
                if (children) {
                    children.classList.toggle('expanded');
                    toggle.classList.toggle('expanded');
                }
            });
        });
        return;
    }
    
    // 如果没有缓存，显示加载状态并异步加载
    container.innerHTML = `<div class="loading">${i18n.loading[currentLang]}</div>`;
    
    browserAPI.bookmarks.getTree((tree) => {
        cachedBookmarkTree = tree;
        
        if (!tree || tree.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-sitemap"></i></div>
                    <div class="empty-state-title">${i18n.emptyTree[currentLang]}</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = renderTreeNode(tree[0]);
        
        // 添加展开/折叠功能
        container.querySelectorAll('.tree-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const node = toggle.closest('.tree-node');
                const children = node.querySelector('.tree-children');
                
                if (children) {
                    children.classList.toggle('expanded');
                    toggle.classList.toggle('expanded');
                }
            });
        });
    });
}

function renderTreeNode(node, level = 0) {
    if (!node.children || node.children.length === 0) {
        // 叶子节点（书签）
        if (node.url) {
            const bookmark = allBookmarks.find(b => b.id === node.id);
            const isBackedUp = bookmark ? isBookmarkBackedUp(bookmark) : false;
            const favicon = getFaviconUrl(node.url);
            
            return `
                <div class="tree-node" style="padding-left: ${level * 24}px">
                    <div class="tree-item">
                        <span class="tree-toggle" style="opacity: 0"></span>
                        ${favicon ? `<img class="tree-icon" src="${favicon}" alt="" onerror="this.src='${fallbackIcon}'">` : `<i class="tree-icon fas fa-bookmark"></i>`}
                        <span class="tree-label">${escapeHtml(node.title)}</span>
                        <span class="tree-backup-status ${isBackedUp ? 'backed-up' : 'not-backed-up'}">
                            ${isBackedUp ? '✓' : '○'}
                        </span>
                    </div>
                </div>
            `;
        }
        return '';
    }
    
    // 文件夹节点
    return `
        <div class="tree-node" style="padding-left: ${level * 24}px">
            <div class="tree-item">
                <span class="tree-toggle ${level === 0 ? 'expanded' : ''}">
                    <i class="fas fa-chevron-right"></i>
                </span>
                <i class="tree-icon fas fa-folder"></i>
                <span class="tree-label">${escapeHtml(node.title)}</span>
            </div>
            <div class="tree-children ${level === 0 ? 'expanded' : ''}">
                ${node.children.map(child => renderTreeNode(child, level + 1)).join('')}
            </div>
        </div>
    `;
}

// =============================================================================
// 详情弹窗
// =============================================================================

function showDetailModal(record) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('modalBody');
    
    body.innerHTML = renderDetailContent(record);
    modal.classList.add('show');
}

function closeModal() {
    document.getElementById('detailModal').classList.remove('show');
}

function renderDetailContent(record) {
    // 由于扩展限制，无法获取具体的书签列表，只能显示统计信息
    const stats = record.bookmarkStats || {};
    const current = {
        bookmarks: stats.currentBookmarkCount || stats.currentBookmarks || 0,
        folders: stats.currentFolderCount || stats.currentFolders || 0
    };
    
    return `
        <div class="detail-section">
            <div class="detail-section-title">
                <i class="fas fa-info-circle detail-section-icon"></i>
                ${i18n.statsTitle[currentLang]}
            </div>
            <div class="detail-list">
                <div class="detail-item">
                    <div class="detail-item-title">${i18n.statBookmarks[currentLang]}: ${current.bookmarks}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-title">${i18n.statFolders[currentLang]}: ${current.folders}</div>
                </div>
            </div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title">
                <i class="fas fa-sticky-note detail-section-icon"></i>
                备注
            </div>
            <div class="detail-item">
                ${record.note || '无备注'}
            </div>
        </div>
        <div class="detail-section">
            <div class="detail-empty">
                <i class="fas fa-exclamation-circle"></i>
                由于浏览器扩展限制，无法显示具体变化的书签列表。<br>
                建议在主界面的备份历史中对比不同时间点的备份文件查看详情。
            </div>
        </div>
    `;
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

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    
    // 同步到主 UI
    browserAPI.storage.local.set({ currentTheme: currentTheme });
    
    // 更新图标
    const icon = document.querySelector('#themeToggle i');
    icon.className = currentTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

function toggleLanguage() {
    currentLang = currentLang === 'zh_CN' ? 'en' : 'zh_CN';
    
    // 同步到主 UI
    browserAPI.storage.local.set({ preferredLang: currentLang });
    
    applyLanguage();
    renderCurrentView();
}

// =============================================================================
// 实时更新
// =============================================================================

function handleStorageChange(changes, namespace) {
    if (namespace !== 'local') return;
    
    console.log('[存储监听] 检测到变化:', Object.keys(changes));
    
    // 检查相关数据是否变化 - 实时更新
    if (changes.syncHistory || changes.lastSyncTime || changes.lastBookmarkData || changes.lastSyncOperations) {
        console.log('[存储监听] 书签数据变化，立即重新加载...');
        
        // 清除缓存，强制重新加载
        cachedCurrentChanges = null;
        cachedBookmarkTree = null;
        
        // 立即重新加载数据
        loadAllData({ skipRender: true }).then(async () => {
            console.log('[存储监听] 数据重新加载完成');
            
            // 如果当前在 current-changes 视图，使用重试机制刷新
            if (currentView === 'current-changes') {
                console.log('[存储监听] 刷新当前变化视图（带重试，强制刷新）');
                await renderCurrentChangesViewWithRetry(3, true);
            }
        });
        
        // 并行预加载其他视图
        setTimeout(() => {
            preloadAllViews();
        }, 500);
    }
    
    // 主题变化
    if (changes.currentTheme) {
        currentTheme = changes.currentTheme.newValue;
        document.documentElement.setAttribute('data-theme', currentTheme);
        applyLanguage();
    }
    
    // 语言变化
    if (changes.preferredLang) {
        currentLang = changes.preferredLang.newValue;
        applyLanguage();
        renderCurrentView();
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

    updateStatsFromAnalysisMessage(message);

    if (currentView === 'current-changes') {
        await renderCurrentChangesViewWithRetry(3, false);
    }

    setTimeout(() => {
        preloadAllViews();
    }, 500);
}

function updateStatsFromAnalysisMessage(message) {
    const bookmarksEl = document.getElementById('statBookmarksCount');
    if (bookmarksEl && typeof message.bookmarkCount === 'number') {
        bookmarksEl.textContent = message.bookmarkCount;
    }

    const foldersEl = document.getElementById('statFoldersCount');
    if (foldersEl && typeof message.folderCount === 'number') {
        foldersEl.textContent = message.folderCount;
    }
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
    
    // 如果当前在变化视图，强制刷新渲染
    if (currentView === 'current-changes') {
        await renderCurrentChangesViewWithRetry(3, true);
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
