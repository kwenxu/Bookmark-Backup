// =============================================================================
// 全局变量和常量
// =============================================================================

let currentLang = 'zh_CN';
let currentTheme = 'light';
let currentView = 'current-changes';
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

// 浏览器 API 兼容性
const browserAPI = (typeof chrome !== 'undefined') ? chrome : browser;

// 实时更新状态控制
let viewerInitialized = false;
let deferredAnalysisMessage = null;
let messageListenerRegistered = false;
let realtimeUpdateInProgress = false;
let pendingAnalysisMessage = null;
let lastAnalysisSignature = null;
// 显式移动集合（基于 onMoved 事件），用于同级移动标识，设置短期有效期
let explicitMovedIds = new Map(); // id -> expiryTimestamp

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
        'zh_CN': '查看未备份的书签变化详情'
    },
    historyViewTitle: {
        'zh_CN': '备份历史记录',
        'en': 'Backup History'
    },
    historyViewDesc: {
        'zh_CN': '查看所有备份记录及其详细变化'
    },
    additionsViewTitle: {
        'zh_CN': '书签添加记录',
        'en': 'Bookmark Additions'
    },
    additionsViewDesc: {
        'zh_CN': '按时间和文件夹分类查看新增书签'
    },
    treeViewTitle: {
        'zh_CN': '书签树',
        'en': 'Bookmark Tree'
    },
    treeViewDesc: {
        'zh_CN': '查看完整的书签结构及变动状态'
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
    
    // 恢复上次的视图（在初始化UI之前）
    try {
        const lastView = localStorage.getItem('lastActiveView');
        if (lastView && ['current-changes', 'history', 'additions', 'tree'].includes(lastView)) {
            currentView = lastView;
            console.log('[初始化] 恢复上次视图:', lastView);
        }
    } catch (e) {
        console.error('[初始化] 恢复视图失败:', e);
    }
    
    // 加载用户设置
    await loadUserSettings();
    
    // 初始化 UI（此时currentView已经是正确的值）
    initializeUI();
    
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
    
    // 先加载基础数据
    console.log('[初始化] 加载基础数据...');
    await loadAllData();
    
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
            const mainUITheme = result.currentTheme || 'light';
            
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
    
    // 更新按钮文本
    const copyAllHistoryText = document.getElementById('copyAllHistoryText');
    if (copyAllHistoryText) {
        copyAllHistoryText.textContent = i18n.copyAllHistory[currentLang];
    }
    const revertAllCurrentText = document.getElementById('revertAllCurrentText');
    if (revertAllCurrentText) revertAllCurrentText.textContent = i18n.revertAll[currentLang];
    const revertAllTreeText = document.getElementById('revertAllTreeText');
    if (revertAllTreeText) revertAllTreeText.textContent = i18n.revertAll[currentLang];
    document.getElementById('filterAll').textContent = i18n.filterAll[currentLang];
    document.getElementById('filterBackedUp').textContent = i18n.filterBackedUp[currentLang];
    document.getElementById('filterNotBackedUp').textContent = i18n.filterNotBackedUp[currentLang];
    document.getElementById('filterStatusLabel').textContent = i18n.filterStatus[currentLang];
    document.getElementById('filterTimeLabel').textContent = i18n.filterTime[currentLang];
    document.getElementById('timeFilterAll').textContent = i18n.timeFilterAll[currentLang];
    document.getElementById('timeFilterYear').textContent = i18n.timeFilterYear[currentLang];
    document.getElementById('timeFilterMonth').textContent = i18n.timeFilterMonth[currentLang];
    document.getElementById('timeFilterDay').textContent = i18n.timeFilterDay[currentLang];
    // 已删除JSON视图，不再需要更新这些元素
    // document.getElementById('treeViewModeText').textContent = i18n.treeViewMode[currentLang];
    // document.getElementById('jsonViewModeText').textContent = i18n.jsonViewMode[currentLang];
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
    
    // 状态过滤按钮
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdditionsView();
        });
    });
    
    // 时间过滤按钮
    document.querySelectorAll('.time-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentTimeFilter = btn.dataset.timeFilter;
            document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAdditionsView();
        });
    });
    
    // 工具按钮
    document.getElementById('refreshBtn').addEventListener('click', refreshData);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('langToggle').addEventListener('click', toggleLanguage);

    // 撤销全部按钮（当前变化和书签树）
    const revertAllCurrentBtn = document.getElementById('revertAllCurrentBtn');
    if (revertAllCurrentBtn) {
        revertAllCurrentBtn.addEventListener('click', () => handleRevertAll('current'));
    }
    const revertAllTreeBtn = document.getElementById('revertAllTreeBtn');
    if (revertAllTreeBtn) {
        revertAllTreeBtn.addEventListener('click', () => handleRevertAll('tree'));
    }
    
    // 搜索
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    
    // 弹窗关闭
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('detailModal').addEventListener('click', (e) => {
        if (e.target.id === 'detailModal') closeModal();
    });
    
    // 更新UI以反映当前视图状态
    updateUIForCurrentView();
}

// 二次确认并触发撤销全部
async function handleRevertAll(source) {
    try {
        // 第一次确认
        const first = confirm(`${i18n.revertConfirmTitle[currentLang]}\n\n${i18n.revertConfirmDesc[currentLang]}`);
        if (!first) return;
        // 第二次确认
        const second = confirm(i18n.revertConfirmSecondary[currentLang]);
        if (!second) return;

        // 发送到 background 执行撤销
        const response = await new Promise(resolve => {
            browserAPI.runtime.sendMessage({ action: 'revertAllToLastBackup' }, (res) => {
                resolve(res || { success: false, error: 'no response' });
            });
        });

        if (response && response.success) {
            showToast(i18n.revertSuccess[currentLang]);
            // 刷新状态卡片与角标：background 会更新缓存与角标，这里刷新视图
            try {
                await refreshData();
                await renderTreeView(true);
                await renderCurrentChangesView(true);
            } catch (e) {
                // 忽略渲染异常
            }
        } else {
            const msg = response && response.error ? response.error : 'Unknown error';
            showToast(i18n.revertFailed[currentLang] + msg);
        }
    } catch (error) {
        showToast(i18n.revertFailed[currentLang] + (error && error.message ? error.message : String(error)));
    }
}

// 更新UI以反映当前视图
function updateUIForCurrentView() {
    // 更新导航标签
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (tab.dataset.view === currentView) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // 更新视图容器
    document.querySelectorAll('.view').forEach(v => {
        if (v.id === `${currentView}View`) {
            v.classList.add('active');
        } else {
            v.classList.remove('active');
        }
    });
    
    console.log('[UI更新] 当前视图:', currentView);
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
    
    // 保存当前视图到 localStorage
    try {
        localStorage.setItem('lastActiveView', view);
        console.log('[视图切换] 保存视图:', view);
    } catch (e) {
        console.error('[视图切换] 保存失败:', e);
    }
    
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
                    diffHtml += `<button class="copy-diff-btn" onclick="window.copyCurrentDiff()" title="${currentLang === 'zh_CN' ? '复制Diff(JSON格式)' : 'Copy Diff (JSON)'}">`;
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
                            header.addEventListener('click', function() {
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
            html += `<div class="change-item">🔖 "${escapeHtml(item.title)}"<br>`;
            html += `<span style="margin-left: 20px; font-size: 0.85em; color: var(--text-tertiary); word-break: break-all;">`;
            html += `<span style="color: #dc3545;">- ${escapeHtml(item.oldUrl)}</span><br>`;
            html += `<span style="color: #28a745;">+ ${escapeHtml(item.newUrl)}</span>`;
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
        const fingerprint = record.fingerprint || '';
        
        // 计算变化
        const changes = calculateChanges(record, index, reversedHistory);
        
        // 方向标识
        const directionIcon = record.direction === 'upload' 
            ? '<i class="fas fa-cloud-upload-alt"></i>' 
            : '<i class="fas fa-cloud-download-alt"></i>';
        const directionText = record.direction === 'upload' 
            ? (currentLang === 'zh_CN' ? '上传' : 'Upload')
            : (currentLang === 'zh_CN' ? '下载' : 'Download');
        
        // 构建提交项
        return `
            <div class="commit-item" data-record-time="${record.time}">
                <div class="commit-header">
                    <div class="commit-title-group">
                        <div class="commit-title">${record.note || time}</div>
                        <div class="commit-time">
                            <i class="fas fa-clock"></i> ${time}
                        </div>
                        ${fingerprint ? `<div class="commit-fingerprint" title="Fingerprint">#${fingerprint}</div>` : ''}
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
                    <span class="commit-badge ${isAuto ? 'auto' : 'manual'}">
                        <i class="fas ${isAuto ? 'fa-robot' : 'fa-hand-pointer'}"></i>
                        ${isAuto ? i18n.autoBackup[currentLang] : i18n.manualBackup[currentLang]}
                    </span>
                    <span class="commit-badge ${isSuccess ? 'success' : 'error'}">
                        <i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
                        ${isSuccess ? i18n.success[currentLang] : i18n.error[currentLang]}
                    </span>
                    <span class="commit-badge direction">
                        ${directionIcon}
                        ${directionText}
                    </span>
                </div>
                ${renderCommitStats(changes)}
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
    
    // 按时间范围分组（年、月、日）
    const groupedByTime = groupBookmarksByTime(allBookmarks, currentTimeFilter);
    
    // 过滤
    const filtered = filterBookmarks(groupedByTime);
    
    container.innerHTML = renderBookmarkGroups(filtered, currentTimeFilter);
    
    // 绑定折叠/展开事件
    attachAdditionGroupEvents();
}

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
        <div class="addition-item">
            ${favicon ? `<img class="addition-icon" src="${favicon}" alt="" onerror="this.src='${fallbackIcon}'">` : ''}
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

async function renderTreeView(forceRefresh = false) {
    console.log('[renderTreeView] 开始渲染, forceRefresh:', forceRefresh);
    
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
            return;
        }
        
        // 树有变化，重新渲染
        console.log('[renderTreeView] 检测到书签变化，重新渲染');
        
        const oldTree = storageData.lastBookmarkData && storageData.lastBookmarkData.bookmarkTree;
        cachedOldTree = oldTree;
        cachedCurrentTree = currentTree; // 缓存当前树，用于智能路径检测
        
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
    }).catch(error => {
        console.error('[renderTreeView] 错误:', error);
        treeContainer.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
        treeContainer.style.display = 'block';
    });
}

// 树事件处理器（避免重复绑定）
let treeClickHandler = null;

// 绑定树的展开/折叠事件
function attachTreeEvents(treeContainer) {
    // 移除旧的事件监听器
    if (treeClickHandler) {
        treeContainer.removeEventListener('click', treeClickHandler);
    }
    
    // 创建新的事件处理器
    treeClickHandler = (e) => {
        // 处理移动标记的点击
        const moveBadge = e.target.closest('.change-badge.moved');
        if (moveBadge) {
            e.stopPropagation();
            const fromPath = moveBadge.getAttribute('data-move-from');
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
    treeContainer.addEventListener('click', treeClickHandler);
    
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
                detail.moved = { oldPath: getNodePath(oldTree, id), newPath: getNodePath(newTree, id) };
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
                <button class="json-copy-btn" onclick="copyJSONDiff()">
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
            <button class="json-copy-btn" onclick="copyJSONDiff()">
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
window.copyJSONDiff = function() {
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

    if (!node.children || node.children.length === 0) {
        // 叶子（书签）
        if (node.url) {
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
                        if (isMoved && change.moved) {
                            const tip = (change.moved.oldPath && change.moved.newPath) ? `${change.moved.oldPath} → ${change.moved.newPath}` : '';
                            statusIcon += `<span class="change-badge moved"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${escapeHtml(tip)}</span></span>`;
                        } else {
                            statusIcon += `<span class="change-badge moved"><i class="fas fa-arrows-alt"></i></span>`;
                        }
                    }
                }
            }
            const favicon = getFaviconUrl(node.url);
            return `
                <div class="tree-node" style="padding-left: ${level * 12}px">
                    <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-url="${escapeHtml(node.url || '')}" data-node-type="bookmark">
                        <span class="tree-toggle" style="opacity: 0"></span>
                        ${favicon ? `<img class="tree-icon" src="${favicon}" alt="" onerror="this.src='${fallbackIcon}'">` : `<i class="tree-icon fas fa-bookmark"></i>`}
                        <a href="${escapeHtml(node.url)}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer">${escapeHtml(node.title)}</a>
                        <span class="change-badges">${statusIcon}</span>
                    </div>
                </div>
            `;
        }
        return '';
    }

    // 文件夹
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
                if (isMoved && change.moved) {
                    const tip = (change.moved.oldPath && change.moved.newPath) ? `${change.moved.oldPath} → ${change.moved.newPath}` : '';
                    statusIcon += `<span class="change-badge moved"><i class="fas fa-arrows-alt"></i><span class="move-tooltip">${escapeHtml(tip)}</span></span>`;
                } else {
                    statusIcon += `<span class="change-badge moved"><i class="fas fa-arrows-alt"></i></span>`;
                }
            }
        }
    }

    const sortedChildren = node.children ? [...node.children].sort((a, b) => {
        const indexA = typeof a.index === 'number' ? a.index : 0;
        const indexB = typeof b.index === 'number' ? b.index : 0;
        return indexA - indexB;
    }) : [];

    return `
        <div class="tree-node" style="padding-left: ${level * 12}px">
            <div class="tree-item ${changeClass}" data-node-id="${node.id}" data-node-title="${escapeHtml(node.title)}" data-node-type="folder">
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
        <div class="tree-node" style="padding-left: ${(parseInt(parentItem.style.paddingLeft||'0',10)+12)||12}px">
            <div class="tree-item tree-change-added" data-node-id="${id}" data-node-title="${escapeHtml(bookmark.title||'')}" data-node-url="${escapeHtml(bookmark.url||'')}" data-node-type="${bookmark.url ? 'bookmark' : 'folder'}">
                <span class="tree-toggle" style="opacity: 0"></span>
                ${bookmark.url ? (favicon ? `<img class="tree-icon" src="${favicon}" alt="" onerror="this.src='${fallbackIcon}'">` : `<i class="tree-icon fas fa-bookmark"></i>`) : `<i class="tree-icon fas fa-folder"></i>`}
                ${bookmark.url ? `<a href="${escapeHtml(bookmark.url)}" target="_blank" class="tree-label tree-bookmark-link" rel="noopener noreferrer" style="${labelColor} ${labelFontWeight}">${escapeHtml(bookmark.title||'')}</a>` : `<span class="tree-label" style="${labelColor} ${labelFontWeight}">${escapeHtml(bookmark.title||'')}</span>`}
                <span class="change-badges"><span class="change-badge added">+</span></span>
            </div>
            ${bookmark.url ? '' : '<div class="tree-children"></div>'}
        </div>
    `;
    // 插入（末尾）
    parentNode.insertAdjacentHTML('beforeend', html);
}

// ===== 增量更新：删除 =====
function applyIncrementalRemoveFromTree(id) {
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
}

// ===== 增量更新：修改 =====
async function applyIncrementalChangeToTree(id, changeInfo) {
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
        item.setAttribute('data-node-url', escapeHtml(changeInfo.url||''));
    }

    // 给该节点增加"modified"标识
    const badges = item.querySelector('.change-badges');
    if (badges && !badges.querySelector('.modified')) {
        badges.insertAdjacentHTML('beforeend', '<span class="change-badge modified">~</span>');
    }
}

// ===== 增量更新：移动 =====
async function applyIncrementalMoveToTree(id, moveInfo) {
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
    // 按目标 index 插入更准确
    const targetIndex = (moveInfo && typeof moveInfo.index === 'number') ? moveInfo.index : null;
    if (targetIndex === null) {
        newParentChildren.insertAdjacentElement('beforeend', node);
    } else {
        const siblings = Array.from(newParentChildren.querySelectorAll(':scope > .tree-node'));
        const anchor = siblings[targetIndex] || null;
        if (anchor) newParentChildren.insertBefore(node, anchor); else newParentChildren.appendChild(node);
    }
    // 关键：仅对这个被拖拽的节点标记为蓝色"moved"
    // 其他由于这次移动而位置改变的兄弟节点不标记，因为我们只标识用户直接操作的对象
    const badges = item.querySelector('.change-badges');
    if (badges) {
        const existing = badges.querySelector('.change-badge.moved');
        if (existing) existing.remove();
        badges.insertAdjacentHTML('beforeend', '<span class="change-badge moved"><i class="fas fa-arrows-alt"></i></span>');
        item.classList.add('tree-change-moved');
    }
}



// =============================================================================
// 详情弹窗
// =============================================================================

function showDetailModal(record) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('modalBody');
    
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
                    header.addEventListener('click', function() {
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
}

// 生成详情内容（异步）
async function generateDetailContent(record) {
    const stats = record.bookmarkStats || {};
    const current = {
        bookmarks: stats.currentBookmarkCount || stats.currentBookmarks || 0,
        folders: stats.currentFolderCount || stats.currentFolders || 0
    };
    
    let html = `
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
    `;
    
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
            
            // 如果当前在 additions 视图，刷新添加记录视图
            if (currentView === 'additions') {
                console.log('[存储监听] 刷新书签添加记录视图');
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
            if (currentView === 'tree') {
                await applyIncrementalCreateToTree(id, bookmark);
            }
            // 立即刷新当前变化（轻量重绘容器，不刷新页面）
            if (currentView === 'current-changes') {
                await renderCurrentChangesViewWithRetry(1, true);
            }
        } catch (e) {
            refreshTreeViewIfVisible();
        }
    });
    
    // 书签删除
    browserAPI.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
        console.log('[书签监听] 书签删除:', id);
        try {
            if (currentView === 'tree') {
                applyIncrementalRemoveFromTree(id);
            }
            if (currentView === 'current-changes') {
                await renderCurrentChangesViewWithRetry(1, true);
            }
        } catch (e) {
            refreshTreeViewIfVisible();
        }
    });
    
    // 书签修改
    browserAPI.bookmarks.onChanged.addListener(async (id, changeInfo) => {
        console.log('[书签监听] 书签修改:', changeInfo);
        try {
            if (currentView === 'tree') {
                await applyIncrementalChangeToTree(id, changeInfo);
            }
            if (currentView === 'current-changes') {
                await renderCurrentChangesViewWithRetry(1, true);
            }
        } catch (e) {
            refreshTreeViewIfVisible();
        }
    });
    
    // 书签移动
    browserAPI.bookmarks.onMoved.addListener(async (id, moveInfo) => {
        console.log('[书签监听] 书签移动:', id);
        try {
            // 只保持已经存在的主动拖拽标记（蓝色标识规则：只有主动拖拽的对象才显示）
            // 如果这个对象不在explicitMovedIds中，说明是被动的移动，不添加标记
            if (!explicitMovedIds.has(id)) {
                // 这是被动的移动，不标记为蓝色"moved"
                console.log('[书签监听] 检测到被动移动（不标记为蓝色）:', id);
            } else {
                // 这是主动拖拽，继续保持标记
                explicitMovedIds.set(id, Date.now() + Infinity);
            }
            
            if (currentView === 'tree') {
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

// 如果当前在树视图，刷新书签树
async function refreshTreeViewIfVisible() {
    if (currentView === 'tree') {
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
        } else if (message.action === 'recentMovedBroadcast' && message.id) {
            // 后台广播的最近被移动的ID，立即记入显式集合（仅标记这个节点）
            // 这确保用户拖拽的节点优先被标识为蓝色"moved"
            // 永久记录，不再有时间限制
            explicitMovedIds.set(message.id, Date.now() + Infinity);
            // 若在树视图，立即给这个被拖拽的节点补蓝标（不影响其他节点）
            if (currentView === 'tree') {
                try {
                    const container = document.getElementById('bookmarkTree');
                    const item = container && container.querySelector(`.tree-item[data-node-id="${message.id}"]`);
                    if (item) {
                        const badges = item.querySelector('.change-badges');
                        if (badges) {
                            const existing = badges.querySelector('.change-badge.moved');
                            if (existing) existing.remove();
                            badges.insertAdjacentHTML('beforeend', '<span class="change-badge moved"><i class="fas fa-arrows-alt"></i></span>');
                            item.classList.add('tree-change-moved');
                        }
                    }
                } catch(_) {}
            }
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
        // 直接轻量刷新当前变化视图
        await renderCurrentChangesViewWithRetry(1, false);
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
window.copyCurrentDiff = async function() {
    try {
        const changeData = await getDetailedChanges(false);
        
        // 限制每个数组最多100项，防止数据过大
        const maxItems = 100;
        const added = (changeData.added || []).slice(0, maxItems);
        const deleted = (changeData.deleted || []).slice(0, maxItems);
        const modified = (changeData.modified || []).slice(0, maxItems);
        const moved = (changeData.moved || []).slice(0, maxItems);
        
        const diffData = {
            timestamp: new Date().toISOString(),
            type: 'current-changes',
            hasChanges: changeData.hasChanges,
            diffMeta: changeData.diffMeta,
            added: added,
            deleted: deleted,
            modified: modified,
            moved: moved,
            // 添加计数信息
            counts: {
                addedTotal: (changeData.added || []).length,
                deletedTotal: (changeData.deleted || []).length,
                modifiedTotal: (changeData.modified || []).length,
                movedTotal: (changeData.moved || []).length,
                addedShown: added.length,
                deletedShown: deleted.length,
                modifiedShown: modified.length,
                movedShown: moved.length,
                note: maxItems < Math.max(
                    (changeData.added || []).length,
                    (changeData.deleted || []).length,
                    (changeData.modified || []).length,
                    (changeData.moved || []).length
                ) ? (currentLang === 'zh_CN' ? '数据已截断，每类最多显示100项' : 'Data truncated, max 100 items per category') : ''
            }
        };
        
        const jsonString = JSON.stringify(diffData, null, 2);
        await navigator.clipboard.writeText(jsonString);
        
        const message = diffData.counts.note 
            ? (currentLang === 'zh_CN' ? 'Diff已复制（部分数据）' : 'Diff copied (partial data)')
            : (currentLang === 'zh_CN' ? 'Diff已复制到剪贴板' : 'Diff copied to clipboard');
        showToast(message);
    } catch (error) {
        console.error('[复制Diff] 失败:', error);
        showToast(currentLang === 'zh_CN' ? '复制失败' : 'Copy failed');
    }
};

// 复制历史记录的diff（JSON格式，排除bookmarkTree以防止卡顿）
window.copyHistoryDiff = async function(recordTime) {
    try {
        const record = syncHistory.find(r => r.time === recordTime);
        if (!record) {
            showToast(currentLang === 'zh_CN' ? '未找到记录' : 'Record not found');
            return;
        }
        
        let diffData;
        
        // 第一次备份：提供完整的书签列表（简化格式）
        if (record.isFirstBackup && record.bookmarkTree) {
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
                // 完整的书签列表（不分段）
                bookmarks: bookmarksList
            };
        } else {
            // 普通备份：只保留统计信息
            diffData = {
                timestamp: record.time,
                type: 'history-record',
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
            };
        }
        
        const jsonString = JSON.stringify(diffData, null, 2);
        await navigator.clipboard.writeText(jsonString);
        
        const message = record.isFirstBackup 
            ? (currentLang === 'zh_CN' ? `已复制首次备份（${diffData.bookmarks?.length || 0}个书签）` : `Copied first backup (${diffData.bookmarks?.length || 0} bookmarks)`)
            : (currentLang === 'zh_CN' ? 'Diff已复制到剪贴板' : 'Diff copied to clipboard');
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
window.copyAllHistoryDiff = async function() {
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
window.exportHistoryDiffToHTML = async function(recordTime) {
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
