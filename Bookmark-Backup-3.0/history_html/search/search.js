/**
 * 搜索功能模块（当前变化 + 备份历史）
 * Search Module (Current Changes + Backup History)
 *
 * 文件位置：history_html/search/search.js
 *
 * 当前变化搜索：
 * - 搜索范围：`history.html` 的 `view=current-changes`
 * - 行为：定位到变化树节点并高亮
 *
 * 备份历史搜索：
 * - 搜索范围：`history.html` 的 `view=history`
 * - 行为：定位到提交卡片并高亮
 *
 * 依赖：
 * - history.js 中的全局变量：currentView, currentLang, syncHistory
 * - history.js 中的工具函数：escapeHtml, i18n, formatTime
 */

// ==================== 模块状态 ====================

/**
 * 搜索 UI 状态
 */
const searchUiState = {
    view: null,
    query: '',
    selectedIndex: -1,
    results: [],
    activeMode: 'current-changes',
    isMenuOpen: false,
    isHelpOpen: false
};

/**
 * 当前变化搜索数据库（缓存索引）
 */
let currentChangesSearchDb = {
    signature: null,
    version: null,
    size: 0,
    items: [],
    itemById: new Map()
};

// ==================== 搜索上下文管理器 (Phase 4) ====================

/**
 * 搜索上下文管理器
 * 负责根据当前视图状态（View/Tab）动态配置搜索行为
 */
window.SearchContextManager = {
    currentContext: {
        view: 'current-changes', // current changes + backup history
        tab: null,
        subTab: null
    },

    _lastContextKey: '',

    /**
     * 更新搜索上下文
     * @param {string} [subTab] - 三级标签（预留）
     */
    updateContext(view, tab = null, subTab = null) {
        const next = { view, tab, subTab };
        const key = `${String(view || '')}::${String(tab || '')}::${String(subTab || '')}`;
        const changed = key !== this._lastContextKey;

        this.currentContext = next;
        this._lastContextKey = key;
        console.log('[SearchContext] Context Updated:', this.currentContext);

        // [Search Isolation] Different pages share the same top search input but have different behaviors.
        // When context changes, clear the input + results so queries won't leak across views/tabs.
        if (changed && typeof window.resetMainSearchUI === 'function') {
            window.resetMainSearchUI({ reason: 'context-change' });
        }

        this.updateUI();

    },

    /**
     * 根据当前上下文更新 UI（如 Placeholder）
     */
    updateUI() {
        const input = document.getElementById('searchInput');
        if (!input) return;

        let placeholder = '';
        const ctx = this.currentContext;

        if (ctx.view === 'current-changes') {
            // Note: current-changes search is text-based (title/url/path). It does not support +/- change filters.
            placeholder = currentLang === 'zh_CN'
                ? '标题 / URL / 路径（空格=并且）'
                : 'Title / URL / path (space = AND)';
        } else if (ctx.view === 'history') {
            placeholder = currentLang === 'zh_CN'
                ? '序号 / 备注 / 哈希 / 日期 / 类型 / 方向 / 变化'
                : 'Seq / note / hash / date / type / direction / changes';
        }

        if (placeholder) {
            input.setAttribute('placeholder', placeholder);
        }
    },

    /**
     * 获取当前上下文的搜索模式 ID
     */
    getModeId() {
        return 'default';
    }
};

function syncSearchContextFromCurrentUI(reason = 'sync') {
    try {
        if (!window.SearchContextManager || typeof window.SearchContextManager.updateContext !== 'function') return;

        const view = (typeof window.currentView === 'string' && window.currentView)
            ? window.currentView
            : 'current-changes';

        window.SearchContextManager.updateContext(view, null, null);
        try {
            if (typeof setSearchMode === 'function') {
                setSearchMode(view, { switchView: false });
            }
        } catch (_) { }
        console.log('[SearchContext] Synced from UI:', { reason, view });
    } catch (_) { }
}

try {
    window.syncSearchContextFromCurrentUI = syncSearchContextFromCurrentUI;
} catch (_) { }

// Ensure correct placeholder after refresh.
// history.js runs before search.js, and initAdditionsSubTabs() may restore tabs in the background.
// We re-sync once the DOM is ready so the placeholder matches the actual active view.
document.addEventListener('DOMContentLoaded', () => {
    // Defer 1 tick to let history.js finish early view restore.
    setTimeout(() => syncSearchContextFromCurrentUI('DOMContentLoaded'), 0);
});

// ==================== DOM 操作辅助函数 ====================

/**
 * 获取搜索结果面板元素
 */
function getSearchResultsPanel() {
    return document.getElementById('searchResultsPanel');
}

/**
 * 显示搜索结果面板
 */
function showSearchResultsPanel() {
    const panel = getSearchResultsPanel();
    if (panel) panel.classList.add('visible');
}

/**
 * 隐藏搜索结果面板
 */
function hideSearchResultsPanel() {
    const panel = getSearchResultsPanel();
    if (panel) {
        panel.classList.remove('visible');
        try { panel.dataset.panelType = ''; } catch (_) { }
    }
}

/**
 * 重置顶部主搜索框（跨视图/标签隔离）
 * - 清空输入框
 * - 隐藏并清空结果面板
 * - 清空 searchUiState
 */
function resetMainSearchUI(options = {}) {
    const { clearInput = true } = options;

    // Cancel any pending debounced search from history.js
    // (Shared top search box across views/sub-tabs: avoid stale renders)
    try {
        if (typeof window.cancelPendingMainSearchDebounce === 'function') {
            window.cancelPendingMainSearchDebounce();
        }
    } catch (_) { }

    // Cancel focus-triggered delayed search to avoid cross-view leakage
    try {
        if (typeof focusSearchTimeout !== 'undefined' && focusSearchTimeout) {
            clearTimeout(focusSearchTimeout);
            focusSearchTimeout = null;
        }
    } catch (_) { }

    try {
        if (clearInput) {
            const input = document.getElementById('searchInput');
            if (input) input.value = '';
        }

        const panel = getSearchResultsPanel();
        if (panel) panel.innerHTML = '';

        if (typeof hideSearchResultsPanel === 'function') hideSearchResultsPanel();
        if (typeof toggleSearchModeMenu === 'function') toggleSearchModeMenu(false);

        // Reset UI state
        if (typeof searchUiState === 'object' && searchUiState) {
            searchUiState.view = null;
            searchUiState.query = '';
            searchUiState.results = [];
            searchUiState.selectedIndex = -1;
        }
    } catch (_) { }

    // Close any help/mode menu to avoid cross-view leakage
    try {
        toggleSearchModeMenu(false);
        toggleSearchHelpMenu(false);
    } catch (_) { }
}

try {
    window.resetMainSearchUI = resetMainSearchUI;
} catch (_) { }

/**
 * 更新搜索结果选中项
 */
function updateSearchResultSelection(nextIndex) {
    const panel = getSearchResultsPanel();
    if (!panel) return;
    const items = panel.querySelectorAll('.search-result-item');
    if (!items.length) {
        searchUiState.selectedIndex = -1;
        return;
    }
    const maxIdx = items.length - 1;
    const clamped = Math.max(0, Math.min(maxIdx, nextIndex));

    items.forEach(el => el.classList.remove('selected'));
    const selectedEl = items[clamped];
    if (selectedEl) {
        selectedEl.classList.add('selected');
        // 仅在面板内滚动，不影响页面滚动
        try {
            selectedEl.scrollIntoView({ block: 'nearest' });
        } catch (_) { }
    }
    searchUiState.selectedIndex = clamped;
}

// ==================== 搜索结果渲染 ====================

/**
 * 渲染搜索结果面板
 * @param {Array} results - 搜索结果数组
 * @param {Object} options - 渲染选项
 */
function renderSearchResultsPanel(results, options = {}) {
    const { view = null, query = '' } = options;
    const panel = getSearchResultsPanel();
    if (!panel) return;

    // Isolation guard:
    // Prevent stale (debounced/queued) renders from a different view/query from overwriting the panel.
    try {
        const input = document.getElementById('searchInput');
        const currentQ = (input && typeof input.value === 'string') ? input.value.trim().toLowerCase() : '';
        const expectedQ = String(query || '').trim().toLowerCase();
        if (currentQ !== expectedQ) return;
        if (view && typeof window.currentView === 'string' && window.currentView !== view) return;
    } catch (_) { }

    searchUiState.view = view;
    searchUiState.query = query;
    searchUiState.results = Array.isArray(results) ? results : [];
    searchUiState.selectedIndex = -1;
    try {
        panel.dataset.panelType = 'results';
    } catch (_) { }

    if (!searchUiState.results.length) {
        const emptyText = options.emptyText || i18n.searchNoResults[currentLang];
        panel.innerHTML = `<div class="search-results-empty">${escapeHtml(emptyText)}</div>`;
        showSearchResultsPanel();
        return;
    }

    const rowsHtml = searchUiState.results.map((item, idx) => {
        const safeTitle = escapeHtml(item.title || (currentLang === 'zh_CN' ? '（无标题）' : '(Untitled)'));

        // Meta Logic: Path or URL
        // If meta is provided (e.g. "Added on 2024..."), use it.
        // If not, and it's a bookmark, try to show URL.
        let metaText = item.meta ? escapeHtml(item.meta) : '';
        if (!metaText && item.nodeType === 'bookmark' && item.url) {
            metaText = escapeHtml(item.url);
        }

        // Badges (Moved up to be available for all blocks)
        const parts = Array.isArray(item.changeTypeParts) ? item.changeTypeParts : [];
        const badges = [];
        if (parts.includes('added') || item.changeType === 'added') badges.push(`<span class="search-change-prefix added">+</span>`);
        if (parts.includes('deleted') || item.changeType === 'deleted') badges.push(`<span class="search-change-prefix deleted">-</span>`);
        if (parts.includes('moved')) badges.push(`<span class="search-change-prefix moved">>></span>`);
        if (parts.includes('modified')) badges.push(`<span class="search-change-prefix modified">~</span>`);

        const badgesHtml = badges.length ? badges.join('') : '';
        const changeIconsHtml = badgesHtml ? `<span class="search-change-icons">${badgesHtml}</span>` : '';

        // Favicon / Icon Logic - 使用全局 FaviconCache 统一缓存系统
        // 策略: 优先使用 FaviconCache 获取的真实 favicon，
        // 如果获取不到（返回 fallbackIcon）则使用黄色书签 SVG 图标
        let iconHtml = '';

        // 黄色书签图标（书签搜索模式的默认 fallback）
        const bookmarkFallbackIcon = `<div class="search-result-icon-box-inline" style="display:flex; align-items:center; justify-content:center; width:20px; height:20px; flex-shrink:0;">
            <i class="fas fa-bookmark" style="color:#f59e0b; font-size:14px;"></i>
        </div>`;

        if (item.nodeType === 'bookmark' && item.url) {
            // 使用全局的 getFaviconUrl 函数（如果存在）
            // 这会自动从 FaviconCache（IndexedDB + 内存缓存）获取图标
            if (typeof getFaviconUrl === 'function' && typeof fallbackIcon !== 'undefined') {
                const faviconSrc = getFaviconUrl(item.url);
                // 检查是否获取到真实 favicon（不是 fallbackIcon 灰色星标）
                if (faviconSrc && !faviconSrc.startsWith('data:image/svg+xml')) {
                    // 真实 favicon（已缓存的 Base64 或第三方服务 URL）
                    iconHtml = `<img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" alt="">`;
                } else {
                    // 返回的是 fallbackIcon（灰色星标 SVG），使用黄色书签图标替代
                    // 但仍然添加一个隐藏的 img 以便后台加载完成后可以触发更新
                    iconHtml = bookmarkFallbackIcon + `<img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" alt="" style="display:none;">`;
                }
            } else if (typeof getFaviconUrl === 'function') {
                // getFaviconUrl 可用但 fallbackIcon 未定义，直接使用 favicon
                const faviconSrc = getFaviconUrl(item.url);
                iconHtml = `<img class="search-result-favicon" src="${faviconSrc}" data-bookmark-url="${escapeHtml(item.url)}" alt="">`;
            } else {
                // Fallback: 如果全局函数不可用，使用黄色书签图标
                iconHtml = bookmarkFallbackIcon;
            }
        } else if (item.nodeType === 'folder') {
            // 文件夹使用蓝色文件夹图标
            iconHtml = `<div class="search-result-icon-box-inline" style="display:flex; align-items:center; justify-content:center; width:20px; height:20px; flex-shrink:0;">
                <i class="fas fa-folder" style="color:#2563eb; font-size:14px;"></i>
            </div>`;
        }



        // Layout:
        // [Icon/Favicon]  [Title + Badges]
        //                 [Meta/URL]
        return `
            <div class="search-result-item" role="option" data-index="${idx}" data-type="${item.type || ''}" data-node-id="${escapeHtml(item.id)}">
                <div class="search-result-left">
                    ${iconHtml}
                </div>
                <div class="search-result-content">
                    <div class="search-result-title-row">
                        ${changeIconsHtml}
                        <span class="search-result-title-text" style="${item.nodeType === 'group_action' ? 'color:var(--accent-primary); font-weight:700;' : ''}">${safeTitle}</span>
                        ${!iconHtml ? `<span class="search-result-index-tag">${idx + 1}</span>` : ''} 
                    </div>
                    ${metaText ? `<div class="search-result-meta-row">${metaText}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    panel.innerHTML = rowsHtml;
    showSearchResultsPanel();
    updateSearchResultSelection(0);
}

// ==================== 搜索索引构建 ====================

/**
 * 重置当前变化搜索数据库
 */
function resetCurrentChangesSearchDb(reason = '') {
    currentChangesSearchDb = {
        signature: null,
        version: null,
        size: 0,
        items: [],
        itemById: new Map()
    };
}

/**
 * 获取当前变化搜索签名（用于缓存失效判断）
 */
function getCurrentChangesSearchSignature() {
    const version = lastTreeSnapshotVersion || '';
    const size = (treeChangeMap instanceof Map) ? treeChangeMap.size : 0;
    return `${version}:${size}`;
}

/**
 * 从树结构中收集指定 ID 的节点信息
 * @param {Array} tree - 树结构
 * @param {Set} idSet - 需要收集的 ID 集合
 */
function collectNodeInfoForIds(tree, idSet) {
    const result = new Map();
    try {
        if (!tree || !tree[0] || !(idSet instanceof Set) || idSet.size === 0) return result;
        // 仅在命中目标ID时才 join，避免为整棵树频繁分配数组/字符串
        const pathStack = [];
        const dfs = (node) => {
            if (!node || result.size >= idSet.size) return;
            if (typeof node.id === 'undefined' || node.id === null) return;

            const title = typeof node.title === 'string' ? node.title : '';
            if (title) pathStack.push(title);

            const id = String(node.id);
            if (idSet.has(id) && !result.has(id)) {
                result.set(id, {
                    id,
                    title,
                    url: node.url || '',
                    namedPath: pathStack.join(' > ')
                });
            }

            if (Array.isArray(node.children) && node.children.length) {
                for (const child of node.children) dfs(child);
            }

            if (title) pathStack.pop();
        };
        dfs(tree[0]);
    } catch (_) { }
    return result;
}

/**
 * 构建当前变化搜索数据库
 */
function buildCurrentChangesSearchDb() {
    const signature = getCurrentChangesSearchSignature();
    if (currentChangesSearchDb.signature === signature && Array.isArray(currentChangesSearchDb.items)) {
        return currentChangesSearchDb;
    }

    const changeMap = treeChangeMap instanceof Map ? treeChangeMap : null;
    const size = changeMap ? changeMap.size : 0;
    const ids = changeMap ? Array.from(changeMap.keys()).map(v => String(v)) : [];
    const idSet = new Set(ids);

    const currentInfo = collectNodeInfoForIds(cachedCurrentTree, idSet);
    const oldInfo = collectNodeInfoForIds(cachedOldTree, idSet);

    const items = [];
    const itemById = new Map();

    for (const id of ids) {
        const change = changeMap ? (changeMap.get(id) || {}) : {};
        const changeType = typeof change.type === 'string' ? change.type : '';
        const changeTypeParts = changeType ? changeType.split('+') : [];

        const cur = currentInfo.get(id) || null;
        const old = oldInfo.get(id) || null;
        const title = (cur?.title || old?.title || '').trim();
        const url = (cur?.url || old?.url || '').trim();
        const nodeType = url ? 'bookmark' : 'folder';

        const newNamedPath = (change.moved && change.moved.newPath) ? String(change.moved.newPath) : (cur?.namedPath || '');
        const oldNamedPath = (change.moved && change.moved.oldPath) ? String(change.moved.oldPath) : (old?.namedPath || '');

        const newFolderSlash = newNamedPath ? breadcrumbToSlashFolders(newNamedPath) : '';
        const oldFolderSlash = oldNamedPath ? breadcrumbToSlashFolders(oldNamedPath) : '';

        const newPathSlash = newNamedPath ? breadcrumbToSlashFull(newNamedPath) : '';
        const oldPathSlash = oldNamedPath ? breadcrumbToSlashFull(oldNamedPath) : '';

        const titleLower = title.toLowerCase();
        const urlLower = url.toLowerCase();
        const newPathLower = (newNamedPath || '').toLowerCase();
        const oldPathLower = (oldNamedPath || '').toLowerCase();
        const newSlashLower = (newPathSlash || newFolderSlash || '').toLowerCase();
        const oldSlashLower = (oldPathSlash || oldFolderSlash || '').toLowerCase();

        const item = {
            id,
            title,
            url,
            nodeType,
            changeType,
            changeTypeParts,
            newNamedPath,
            oldNamedPath,
            newFolderSlash,
            oldFolderSlash,
            newPathSlash,
            oldPathSlash,
            __t: titleLower,
            __u: urlLower,
            __pn: newPathLower,
            __po: oldPathLower,
            __sn: newSlashLower,
            __so: oldSlashLower
        };

        items.push(item);
        itemById.set(id, item);
    }

    currentChangesSearchDb = {
        signature,
        version: lastTreeSnapshotVersion || null,
        size,
        items,
        itemById
    };
    return currentChangesSearchDb;
}

// ==================== 搜索匹配与排序 ====================

/**
 * 计算搜索项的匹配分数
 * @param {Object} item - 搜索项
 * @param {Array} tokens - 搜索关键词数组
 */
function scoreCurrentChangesSearchItem(item, tokens) {
    let score = 0;
    for (const t of tokens) {
        if (!t) continue;

        if (item.__t && item.__t.startsWith(t)) { score += 120; continue; }
        if (item.__t && item.__t.includes(t)) { score += 90; continue; }
        if (item.__u && item.__u.includes(t)) { score += 70; continue; }

        if (item.__pn && item.__pn.includes(t)) { score += 50; continue; }
        if (item.__so && item.__so.includes(t)) { score += 45; continue; }
        if (item.__po && item.__po.includes(t)) { score += 40; continue; }

        return -Infinity;
    }

    // 轻量加权：书签优先于文件夹（更常见的定位目标）
    if (item.nodeType === 'bookmark') score += 2;
    return score;
}

/**
 * 执行当前变化搜索并渲染结果
 * @param {string} query - 搜索关键词
 */
function searchCurrentChangesAndRender(query) {
    // 数据尚未准备好：先给出加载提示
    if (!(treeChangeMap instanceof Map)) {
        renderSearchResultsPanel([], { view: 'current-changes', query, emptyText: i18n.searchLoading[currentLang] });
        return;
    }

    const db = buildCurrentChangesSearchDb();
    if (!db.items || db.items.length === 0) {
        renderSearchResultsPanel([], { view: 'current-changes', query, emptyText: i18n.searchNoResults[currentLang] });
        return;
    }

    const tokens = String(query).split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (!tokens.length) {
        hideSearchResultsPanel();
        return;
    }

    const scored = [];
    for (const item of db.items) {
        const s = scoreCurrentChangesSearchItem(item, tokens);
        if (s > -Infinity) scored.push({ item, s });
    }

    scored.sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        // 稳定排序：title 再 url
        const ta = a.item.title || '';
        const tb = b.item.title || '';
        const tc = ta.localeCompare(tb);
        if (tc !== 0) return tc;
        return (a.item.url || '').localeCompare((b.item.url || ''));
    });

    const MAX_RESULTS = 20;
    const results = scored.slice(0, MAX_RESULTS).map(x => x.item);
    renderSearchResultsPanel(results, { view: 'current-changes', query });
}

// ==================== 定位与高亮 ====================

/**
 * 根据变化类型获取高亮 CSS 类名
 */
function getHighlightClassFromChangeType(changeType) {
    const parts = String(changeType || '').split('+').filter(Boolean);
    if (parts.includes('added')) return 'highlight-added';
    if (parts.includes('deleted')) return 'highlight-deleted';
    if (parts.includes('moved')) return 'highlight-moved';
    if (parts.includes('modified')) return 'highlight-modified';
    return '';
}

/**
 * 展开树项的所有祖先节点
 * @param {Element} treeItem - 树项 DOM 元素
 * @param {Element} previewContainer - 预览容器
 */
function expandAncestorsForTreeItem(treeItem, previewContainer) {
    try {
        let parent = treeItem.parentElement;
        while (parent && parent !== previewContainer) {
            if (parent.classList.contains('tree-children')) {
                parent.classList.add('expanded');
            }

            const parentItem = parent.previousElementSibling;
            if (parentItem && parentItem.classList.contains('tree-item')) {
                const toggle = parentItem.querySelector('.tree-toggle');
                if (toggle) toggle.classList.add('expanded');

                const folderIcon = parentItem.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
                if (folderIcon) {
                    folderIcon.classList.remove('fa-folder');
                    folderIcon.classList.add('fa-folder-open');
                }

                const parentId = parentItem.getAttribute('data-node-id');
                if (parentId) {
                    try { saveChangesPreviewExpandedState(String(parentId), true); } catch (_) { }
                }
            }

            parent = parent.parentElement;
        }
    } catch (_) { }
}

/**
 * 在当前变化预览中定位到指定节点
 * @param {string} nodeId - 节点 ID
 * @param {Object} options - 定位选项
 */
async function locateNodeInCurrentChangesPreview(nodeId, options = {}) {
    const previewContainer = document.getElementById('changesTreePreviewInline');
    if (!previewContainer) return false;

    const id = String(nodeId);
    const findTarget = () => previewContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`);

    let target = findTarget();
    if (!target) {
        // 可能是预览尚未完成渲染：尝试触发一次渲染并重试
        try {
            await renderCurrentChangesViewWithRetry(1, false);
        } catch (_) { }
        target = findTarget();
    }
    if (!target) return false;

    expandAncestorsForTreeItem(target, previewContainer);

    try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }

    const highlightClass = options.highlightClass || getHighlightClassFromChangeType(options.changeType || '');
    if (highlightClass) {
        target.classList.add(highlightClass);
        setTimeout(() => {
            try { target.classList.remove(highlightClass); } catch (_) { }
        }, 1200);
    }
    return true;
}

// ==================== 搜索结果激活 ====================

/**
 * 激活指定索引的搜索结果
 * @param {number} index - 结果索引
 */
async function activateSearchResultAtIndex(index) {
    const idx = typeof index === 'number' ? index : parseInt(index, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= searchUiState.results.length) return;

    const item = searchUiState.results[idx];
    if (!item) return;

    hideSearchResultsPanel();
    // 选择候选后清空输入框（便于继续下一次搜索）
    try {
        const inputEl = document.getElementById('searchInput');
        if (inputEl) inputEl.value = '';
    } catch (_) { }

    await locateNodeInCurrentChangesPreview(item.id, { changeType: item.changeType });
}

// ==================== 事件处理 ====================

/**
 * 激活搜索结果（根据当前视图调用对应的激活函数）
 * @param {number} index - 结果索引
 */
function activateSearchResult(index) {
    const view = searchUiState.view;
    if (view === 'history') {
        activateHistorySearchResultAtIndex(index);
    } else {
        activateSearchResultAtIndex(index);
    }
}

/**
 * 搜索输入框键盘事件处理
 */
function handleSearchKeydown(e) {
    try {
        if (!e) return;
        if (e.isComposing) return;

        const panel = getSearchResultsPanel();
        const panelVisible = !!(panel && panel.classList.contains('visible'));

        if (e.key === 'ArrowDown') {
            if (panelVisible) {
                e.preventDefault();
                updateSearchResultSelection(searchUiState.selectedIndex + 1);
            } else if (searchUiState.isMenuOpen) {
                e.preventDefault();
                cycleSearchMode(1);
            }
            return;
        }

        if (e.key === 'ArrowUp') {
            if (panelVisible) {
                e.preventDefault();
                updateSearchResultSelection(searchUiState.selectedIndex - 1);
            } else if (searchUiState.isMenuOpen) {
                e.preventDefault();
                cycleSearchMode(-1);
            }
            return;
        }

        if (e.key === 'Enter') {
            if (panelVisible && searchUiState.selectedIndex >= 0) {
                e.preventDefault();
                activateSearchResult(searchUiState.selectedIndex);
            }
            return;
        }

        if (e.key === 'Escape') {
            if (panelVisible) {
                e.preventDefault();
                hideSearchResultsPanel();
            }
            toggleSearchModeMenu(false);
            toggleSearchHelpMenu(false);
        }
    } catch (_) { }
}

/**
 * 搜索输入框聚焦处理
 */
function handleSearchInputFocus(e) {
    try {
        const input = e && e.target ? e.target : document.getElementById('searchInput');
        if (!input) return;
        const q = (input.value || '').trim().toLowerCase();
        if (!q) {
            hideSearchResultsPanel();
            toggleSearchModeMenu(true);
            return;
        }
        toggleSearchModeMenu(false);
        if (typeof handleSearch === 'function') {
            handleSearch({ target: input });
            return;
        }
        if (typeof performSearch === 'function') {
            performSearch(q);
        }
    } catch (_) { }
}

/**
 * 点击搜索结果
 */
function handleSearchResultsPanelClick(e) {
    const item = e && e.target ? e.target.closest('.search-result-item') : null;
    if (!item) return;
    const idx = parseInt(item.getAttribute('data-index') || '-1', 10);
    if (Number.isNaN(idx)) return;
    activateSearchResult(idx);
}

/**
 * 悬停搜索结果
 */
function handleSearchResultsPanelMouseOver(e) {
    const item = e && e.target ? e.target.closest('.search-result-item') : null;
    if (!item) return;
    const idx = parseInt(item.getAttribute('data-index') || '-1', 10);
    if (Number.isNaN(idx)) return;
    updateSearchResultSelection(idx);
}

/**
 * 搜索面板外部点击处理
 */
function handleSearchOutsideClick(e) {
    const container = document.querySelector('.search-container');
    const panel = getSearchResultsPanel();
    if (!container || !panel) return;
    if (container.contains(e.target)) return;
    hideSearchResultsPanel();
    toggleSearchModeMenu(false);
    toggleSearchHelpMenu(false);
}

// ==================== Robust Date Parser ====================

/**
 * Robust Date Parser
 * Supports: 
 * - Numeric: YYYY, YYYY-MM, YYYYMMDD, YYYY.MM.DD, YYYY/MM/DD
 * - Relative: 今天/Today, 昨天/Yesterday, 前天
 * - Chinese: 2024年1月5日, 1月5日, 2024年1月, 1月
 * - Strict: NO standalone day numbers (e.g. "15", "15日")
 */
function parseDateQuery(query) {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const currentYear = now.getFullYear();

    // --- 1. Relative Keywords ---
    if (['今天', 'today'].includes(q)) {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }
    if (['昨天', 'yesterday'].includes(q)) {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${day}`, y, m, day };
    }
    if (['前天', 'day before yesterday'].includes(q)) {
        const d = new Date(now);
        d.setDate(d.getDate() - 2);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${day}`, y, m, day };
    }

    // --- 2. Numeric Formats ---

    // YYYYMMDD (8 digits) -> YYYY-MM-DD
    if (/^\d{8}$/.test(q)) {
        const y = q.substring(0, 4);
        const m = q.substring(4, 6);
        const d = q.substring(6, 8);
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }

    // MMDD (4 digits) -> CurrentYear-MM-DD
    // Conflict with YYYY (Year). Logic:
    // - Years are usually 1990-2100.
    // - MMDD is 0101-1231.
    // - Overlap: 1990-2025 might be year OR time (e.g. 2025 = 8:25pm? No, strict date).
    // - User asked for "0115". 
    // Logic: If starts with '0' or '1' (up to 12), and valid day, treat as MMDD. 
    // Exception: 1998, 2000 are definitely Years. 
    // Heuristic: If it looks like a valid MMDD (MM=01-12, DD=01-31), AND (startswith 0 OR (startswith 1 and year outside typical range?)).
    // Actually, "0115" is unambiguous (Year 115 vs Jan 15). User implies Current Year.
    if (/^\d{4}$/.test(q)) {
        const val = parseInt(q, 10);
        // Valid Year Range for this app: 2010 - 2030+
        const isLikelyYear = (val >= 2000 && val <= 2100);

        // Check MMDD validity
        const mStr = q.substring(0, 2);
        const dStr = q.substring(2, 4);
        const m = parseInt(mStr, 10);
        const d = parseInt(dStr, 10);
        const isValidMMDD = (m >= 1 && m <= 12 && d >= 1 && d <= 31);

        // Decision: 
        // If it starts with '0', it's MMDD (e.g. 0115).
        // If it is 2024, it's Year.
        // If it is 1231, it's Dec 31 (Year 1231 unlikely).
        if (!isLikelyYear && isValidMMDD) {
            const y = String(currentYear);
            return { type: 'day', key: `${y}-${mStr}-${dStr}`, y, m: mStr, d: dStr, ignoreYear: true };
        }
        // Fallback to Year logic later
    }

    // YYYYMM (6 digits) -> YYYY-MM
    if (/^\d{6}$/.test(q)) {
        const y = q.substring(0, 4);
        const m = q.substring(4, 6);
        return { type: 'month', key: `${y}-${m}`, y, m };
    }

    // Separator formats: 2024-11-05, 2024.11.05, 2024/11/05
    const sepMatch = q.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    if (sepMatch) {
        const y = sepMatch[1];
        const m = sepMatch[2].padStart(2, '0');
        const d = sepMatch[3].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }

    // MM-DD Separator (Current Year): "01-15", "1/15", "1.15"
    // Distinct from YYYY-MM (starts with 4 digits)
    const mdMatch = q.match(/^(\d{1,2})[-./](\d{1,2})$/);
    if (mdMatch) {
        const y = String(currentYear);
        const m = mdMatch[1].padStart(2, '0');
        const d = mdMatch[2].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d, ignoreYear: true };
    }

    // YYYY-MM
    const ymMatch = q.match(/^(\d{4})[-./](\d{1,2})$/);
    if (ymMatch) {
        const y = ymMatch[1];
        const m = ymMatch[2].padStart(2, '0');
        return { type: 'month', key: `${y}-${m}`, y, m };
    }

    // YYYY
    if (/^\d{4}$/.test(q)) {
        return { type: 'year', key: q, y: q };
    }

    // --- 3. Chinese Formats (Strict) ---

    // 2024年1月5日
    const cnFull = q.match(/^(\d{4})年(\d{1,2})月(\d{1,2})[日号]?$/);
    if (cnFull) {
        const y = cnFull[1];
        const m = cnFull[2].padStart(2, '0');
        const d = cnFull[3].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d };
    }

    // 1月5日 (Implies Current Year)
    const cnMonthDay = q.match(/^(\d{1,2})月(\d{1,2})[日号]?$/);
    if (cnMonthDay) {
        const y = String(currentYear);
        const m = cnMonthDay[1].padStart(2, '0');
        const d = cnMonthDay[2].padStart(2, '0');
        return { type: 'day', key: `${y}-${m}-${d}`, y, m, d, ignoreYear: true };
    }

    // 2024年1月
    const cnYearMonth = q.match(/^(\d{4})年(\d{1,2})月?$/);
    if (cnYearMonth) {
        const y = cnYearMonth[1];
        const m = cnYearMonth[2].padStart(2, '0');
        return { type: 'month', key: `${y}-${m}`, y, m };
    }

    // 1月 (Implies Current Year)
    const cnMonthOnly = q.match(/^(\d{1,2})月$/);
    if (cnMonthOnly) {
        const y = String(currentYear);
        const m = cnMonthOnly[1].padStart(2, '0');
        return { type: 'month', key: `${y}-${m}`, y, m, ignoreYear: true };
    }

    // --- 4. Date Range Formats ---
    // Support: MMDD-MMDD (e.g., 0107-0120), MMDD~MMDD, MMDD到MMDD
    // Also: MM-DD~MM-DD, MM/DD-MM/DD

    // MMDD-MMDD (8 digits with separator)
    const rangeMatch1 = q.match(/^(\d{4})[-~到](\d{4})$/);
    if (rangeMatch1) {
        const start = rangeMatch1[1];
        const end = rangeMatch1[2];

        const startM = parseInt(start.substring(0, 2), 10);
        const startD = parseInt(start.substring(2, 4), 10);
        const endM = parseInt(end.substring(0, 2), 10);
        const endD = parseInt(end.substring(2, 4), 10);

        // Validate MMDD
        if (startM >= 1 && startM <= 12 && startD >= 1 && startD <= 31 &&
            endM >= 1 && endM <= 12 && endD >= 1 && endD <= 31) {
            const y = String(currentYear);
            return {
                type: 'range',
                startKey: `${y}-${String(startM).padStart(2, '0')}-${String(startD).padStart(2, '0')}`,
                endKey: `${y}-${String(endM).padStart(2, '0')}-${String(endD).padStart(2, '0')}`,
                startM: String(startM).padStart(2, '0'),
                startD: String(startD).padStart(2, '0'),
                endM: String(endM).padStart(2, '0'),
                endD: String(endD).padStart(2, '0'),
                ignoreYear: true
            };
        }
    }

    // MM-DD~MM-DD or MM/DD-MM/DD (with separators)
    const rangeMatch2 = q.match(/^(\d{1,2})[-./](\d{1,2})[-~到](\d{1,2})[-./](\d{1,2})$/);
    if (rangeMatch2) {
        const startM = parseInt(rangeMatch2[1], 10);
        const startD = parseInt(rangeMatch2[2], 10);
        const endM = parseInt(rangeMatch2[3], 10);
        const endD = parseInt(rangeMatch2[4], 10);

        if (startM >= 1 && startM <= 12 && startD >= 1 && startD <= 31 &&
            endM >= 1 && endM <= 12 && endD >= 1 && endD <= 31) {
            const y = String(currentYear);
            return {
                type: 'range',
                startKey: `${y}-${String(startM).padStart(2, '0')}-${String(startD).padStart(2, '0')}`,
                endKey: `${y}-${String(endM).padStart(2, '0')}-${String(endD).padStart(2, '0')}`,
                startM: String(startM).padStart(2, '0'),
                startD: String(startD).padStart(2, '0'),
                endM: String(endM).padStart(2, '0'),
                endD: String(endD).padStart(2, '0'),
                ignoreYear: true
            };
        }
    }

    // YYYYMMDD-YYYYMMDD (Full date range)
    const rangeMatch3 = q.match(/^(\d{8})[-~到](\d{8})$/);
    if (rangeMatch3) {
        const start = rangeMatch3[1];
        const end = rangeMatch3[2];

        const startY = start.substring(0, 4);
        const startM = start.substring(4, 6);
        const startD = start.substring(6, 8);
        const endY = end.substring(0, 4);
        const endM = end.substring(4, 6);
        const endD = end.substring(6, 8);

        return {
            type: 'range',
            startKey: `${startY}-${startM}-${startD}`,
            endKey: `${endY}-${endM}-${endD}`,
            startY, startM, startD,
            endY, endM, endD,
            ignoreYear: false
        };
    }

    // Explicitly REJECT standalone day numbers (e.g. "15", "15日", "15号")
    // They are too ambiguous and clash with ID searches or other numbers.

    return null;
}

// ==================== 初始化 ====================

/**
 * 初始化搜索模块事件监听
 * 应在 DOM 加载完成后调用
 */
function initSearchEvents() {
    const searchInput = document.getElementById('searchInput');
    const searchResultsPanel = getSearchResultsPanel();

    // Avoid double-binding: history.js may also bind these listeners.
    // IMPORTANT: history.js binds `input` later (after async settings load). If we set
    // `data-search-bound` too early without binding `input`, search won't trigger.
    if (searchInput && !searchInput.hasAttribute('data-search-bound')) {
        // If user starts typing while a menu is open (help/mode), auto-close it
        // so the results panel can show immediately.
        searchInput.addEventListener('input', () => {
            try {
                const q = (searchInput.value || '').trim();
                if (!q) return;
                toggleSearchModeMenu(false);
                toggleSearchHelpMenu(false);
            } catch (_) { }
        });

        // Bind input -> trigger search
        if (typeof handleSearch === 'function') {
            searchInput.addEventListener('input', handleSearch);
        } else if (typeof performSearch === 'function') {
            // Fallback: call search immediately (no debounce)
            searchInput.addEventListener('input', (e) => {
                try {
                    const q = (e && e.target && typeof e.target.value === 'string')
                        ? e.target.value.trim().toLowerCase()
                        : '';
                    performSearch(q);
                } catch (_) { }
            });
        }

        // Keyboard navigation
        searchInput.addEventListener('keydown', handleSearchKeydown);
        // Suggestions / auto search on focus
        searchInput.addEventListener('focus', handleSearchInputFocus);

        searchInput.setAttribute('data-search-bound', 'true');
    }

    if (searchResultsPanel && !searchResultsPanel.hasAttribute('data-search-bound')) {
        searchResultsPanel.addEventListener('click', handleSearchResultsPanelClick);
        searchResultsPanel.addEventListener('mouseover', handleSearchResultsPanelMouseOver);
        searchResultsPanel.setAttribute('data-search-bound', 'true');
    }

    // Outside click: use the same capture+guard strategy as history.js
    if (!document.documentElement.hasAttribute('data-search-outside-bound')) {
        document.addEventListener('click', handleSearchOutsideClick, true);
        document.documentElement.setAttribute('data-search-outside-bound', 'true');
    }

    // Phase 3.5: Init Mode UI
    initSearchModeUI();
}


// ==================== 搜索模式（当前变化 / 备份历史） ====================

const SEARCH_MODES = [
    {
        key: 'current-changes',
        label: '当前变化',
        labelEn: 'Current Changes',
        icon: 'fa-exchange-alt',
        desc: '标题 / URL / 路径（空格=并且）',
        descEn: 'Title / URL / path (space = AND)'
    },
    {
        key: 'history',
        label: '备份历史',
        labelEn: 'Backup History',
        icon: 'fa-history',
        desc: '序号 / 备注 / 哈希 / 日期 / 类型 / 方向 / 变化',
        descEn: 'Seq / note / hash / date / type / direction / changes'
    }
];

const SEARCH_MODE_GUIDES = {
    'current-changes': {
        title: {
            zh_CN: '标题 / URL / 路径搜索',
            en: 'Title / URL / Path Search'
        },
        summary: {
            zh_CN: '可搜索标题、URL、路径（新路径/旧路径）。',
            en: 'Search title, URL, and path (new/old path).'
        },
        rules: {
            zh_CN: [
                '多个关键词用空格分隔，按“并且（AND）”匹配',
                '按匹配度排序，最多显示 20 条',
                '不支持序号/哈希/日期筛选'
            ],
            en: [
                'Use spaces between keywords (AND match)',
                'Sorted by relevance, up to 20 results',
                'No seq/hash/date filters in this mode'
            ]
        },
        examples: {
            zh_CN: [
                'github docs',
                '书签栏 开发',
                'openai.com api'
            ],
            en: [
                'github docs',
                'bookmarks bar dev',
                'openai.com api'
            ]
        }
    },
    'history': {
        title: {
            zh_CN: '序号 / 备注 / 哈希 / 日期搜索',
            en: 'Seq / Note / Hash / Date Search'
        },
        summary: {
            zh_CN: '可搜索序号、备注、哈希、日期、类型、方向、变化状态。',
            en: 'Search seq, note, hash, date, type, direction, and change status.'
        },
        rules: {
            zh_CN: [
                '序号：#12 或 序号12；哈希：#a1b2c3（前缀可匹配）',
                '日期：今天/昨天/本周/上月；2026-01-15；20260115；1月15日；0107-0120；20260101-20260131',
                '类型/方向/变化：手动/自动、云端/webdav/github/本地、新增/删除/移动/修改/无变化',
                '多个关键词用空格分隔，按“并且（AND）”匹配'
            ],
            en: [
                'Seq: #12 or seq12; Hash: #a1b2c3 (prefix match works)',
                'Date: today/yesterday/this week/last month; 2026-01-15; 20260115; Jan 15; 0107-0120; 20260101-20260131',
                'Type/Direction/Changes: manual/auto, cloud/webdav/github/local, added/deleted/moved/modified/no change',
                'Use spaces between keywords (AND match)'
            ]
        },
        examples: {
            zh_CN: [
                '#12 webdav',
                '今天 手动 本地',
                '2026-01-15 无变化'
            ],
            en: [
                '#12 webdav',
                'today manual local',
                '2026-01-15 no change'
            ]
        }
    }
};

const SEARCH_MODE_KEYS = ['current-changes', 'history'];

function getCurrentViewSafe() {
    try {
        if (typeof window !== 'undefined' && typeof window.currentView === 'string' && window.currentView) {
            return window.currentView;
        }
    } catch (_) { }
    try {
        if (typeof currentView === 'string' && currentView) return currentView;
    } catch (_) { }
    return '';
}

function getActiveSearchMode() {
    return SEARCH_MODES.find(m => m.key === searchUiState.activeMode) || SEARCH_MODES[0];
}

function setSearchMode(modeKey, options = {}) {
    const mode = SEARCH_MODES.find(m => m.key === modeKey);
    if (!mode) return;

    searchUiState.activeMode = modeKey;
    renderSearchModeUI();

    // Sync placeholder to the active mode as a fallback
    try {
        const input = document.getElementById('searchInput');
        if (input) {
            const isZh = currentLang === 'zh_CN';
            input.placeholder = isZh ? mode.desc : mode.descEn;
        }
    } catch (_) { }

    // Optionally switch view to match mode
    if (options && options.switchView === false) return;
    try {
        const view = getCurrentViewSafe();
        if (typeof switchView === 'function' && view && view !== modeKey) {
            switchView(modeKey);
        }
    } catch (_) { }
}

function cycleSearchMode(direction) {
    if (!SEARCH_MODE_KEYS.length) return;
    const currentIndex = SEARCH_MODE_KEYS.indexOf(searchUiState.activeMode);
    const idx = currentIndex >= 0 ? currentIndex : 0;
    let nextIndex = idx + direction;
    if (nextIndex >= SEARCH_MODE_KEYS.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = SEARCH_MODE_KEYS.length - 1;
    setSearchMode(SEARCH_MODE_KEYS[nextIndex]);

    if (searchUiState.isMenuOpen) {
        renderSearchModeMenu();
    }
}

function toggleSearchModeMenu(show) {
    const menu = document.getElementById('searchModeMenu');
    if (!menu) return;

    const shouldShow = (typeof show === 'boolean') ? show : menu.hasAttribute('hidden');
    if (shouldShow) {
        menu.removeAttribute('hidden');
        menu.dataset.menuType = 'mode';
        renderSearchModeMenu();
    } else {
        menu.setAttribute('hidden', '');
        menu.dataset.menuType = '';
    }
    searchUiState.isMenuOpen = shouldShow;
}

function toggleSearchHelpMenu(show) {
    // No help menu in this split; keep closed.
    if (show) {
        toggleSearchModeMenu(false);
    }
    searchUiState.isHelpOpen = false;
}

function renderSearchModeUI() {
    const trigger = document.getElementById('searchModeTrigger');
    if (!trigger) return;
    const mode = getActiveSearchMode();
    const isZh = currentLang === 'zh_CN';
    const label = isZh ? mode.label : mode.labelEn;

    trigger.innerHTML = `<i class="fas ${mode.icon}"></i><span class="search-mode-label">${label}</span>`;
    const triggerTitle = isZh ? '点击切换搜索模式' : 'Click to switch search mode';
    trigger.title = triggerTitle;
    trigger.setAttribute('aria-label', triggerTitle);
}

function renderSearchModeMenu() {
    const menu = document.getElementById('searchModeMenu');
    if (!menu) return;
    if (menu.dataset.menuType && menu.dataset.menuType !== 'mode') return;

    const escapeText = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const hintText = currentLang === 'zh_CN'
        ? '↑/↓ 切换，Enter 选择，Esc 关闭'
        : '↑/↓ switch, Enter select, Esc close';

    let html = `<div class="search-mode-hint" style="text-align:left;">${hintText}</div>`;

    html += SEARCH_MODES.map(mode => {
        const isActive = mode.key === searchUiState.activeMode;
        const isZh = currentLang === 'zh_CN';
        const modeName = isZh ? mode.label : mode.labelEn;
        const desc = mode.key === 'current-changes'
            ? (isZh ? '匹配标题、URL、路径（空格=并且）' : 'Match title, URL, and path (space = AND)')
            : (isZh ? '匹配序号、备注、哈希、日期、类型、方向、变化' : 'Match seq, note, hash, date, type, direction, and changes');

        return `
            <div class="search-mode-menu-item ${isActive ? 'active' : ''}" data-mode-key="${mode.key}">
                <div class="mode-icon"><i class="fas ${mode.icon}"></i></div>
                <div class="mode-info">
                    <div class="mode-name">${modeName}</div>
                    <div class="mode-desc">${desc}</div>
                </div>
            </div>
        `;
    }).join('');

    const activeMode = getActiveSearchMode();
    const isZh = currentLang === 'zh_CN';
    const langKey = isZh ? 'zh_CN' : 'en';
    const guide = SEARCH_MODE_GUIDES[activeMode.key];
    if (guide) {
        const title = guide.title?.[langKey] || '';
        const summary = guide.summary?.[langKey] || '';
        const rules = Array.isArray(guide.rules?.[langKey]) ? guide.rules[langKey] : [];
        const examples = Array.isArray(guide.examples?.[langKey]) ? guide.examples[langKey] : [];
        const exampleLabel = isZh ? '示例' : 'Examples';

        html += `
            <div class="search-mode-guide" role="note" aria-label="${escapeText(title)}">
                <div class="search-mode-guide-title">${escapeText(title)}</div>
                <div class="search-mode-guide-summary">${escapeText(summary)}</div>
                <ul class="search-mode-guide-list">
                    ${rules.map(rule => `<li>${escapeText(rule)}</li>`).join('')}
                </ul>
                <div class="search-mode-guide-examples">
                    <span class="search-mode-guide-label">${escapeText(exampleLabel)}:</span>
                    ${examples.map(ex => `<code class="search-mode-guide-pill">${escapeText(ex)}</code>`).join('')}
                </div>
            </div>
        `;
    }

    menu.innerHTML = html;
}

function initSearchModeUI() {
    const view = getCurrentViewSafe();
    const initialMode = SEARCH_MODE_KEYS.includes(view) ? view : (searchUiState.activeMode || SEARCH_MODE_KEYS[0]);
    setSearchMode(initialMode, { switchView: false });

    const trigger = document.getElementById('searchModeTrigger');
    if (trigger && !trigger.hasAttribute('data-mode-ui-bound')) {
        trigger.setAttribute('data-mode-ui-bound', 'true');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSearchHelpMenu(false);
            toggleSearchModeMenu();
        });

        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                toggleSearchModeMenu(true);
                cycleSearchMode(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                toggleSearchModeMenu(true);
                cycleSearchMode(1);
            } else if (e.key === 'Escape') {
                toggleSearchModeMenu(false);
            }
        });
    }

    const menu = document.getElementById('searchModeMenu');
    if (menu && !menu.hasAttribute('data-mode-menu-bound')) {
        menu.setAttribute('data-mode-menu-bound', 'true');
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.search-mode-menu-item');
            if (!item) return;
            const key = item.getAttribute('data-mode-key');
            if (!key) return;
            setSearchMode(key);
            toggleSearchModeMenu(false);
        });
    }
}

// =============================================================================
// Phase 2: 备份历史搜索（Backup History Search）
// =============================================================================

/**
 * 备份历史搜索数据库（缓存索引）
 */
let backupHistorySearchDb = {
    signature: null,
    items: [],
    itemByTime: new Map()
};

// ==================== Phase 2: 时间匹配工具函数 ====================

/**
 * 月份映射（中英文 -> 月份数字）
 */
const MONTH_MAPPINGS = {
    // 中文
    '一月': 1, '1月': 1, '01月': 1,
    '二月': 2, '2月': 2, '02月': 2,
    '三月': 3, '3月': 3, '03月': 3,
    '四月': 4, '4月': 4, '04月': 4,
    '五月': 5, '5月': 5, '05月': 5,
    '六月': 6, '6月': 6, '06月': 6,
    '七月': 7, '7月': 7, '07月': 7,
    '八月': 8, '8月': 8, '08月': 8,
    '九月': 9, '9月': 9, '09月': 9,
    '十月': 10, '10月': 10,
    '十一月': 11, '11月': 11,
    '十二月': 12, '12月': 12,
    // 英文完整
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    // 英文缩写
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
    'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12
};

/**
 * 星期映射（中英文 -> 0-6, 0=Sunday）
 */
const WEEKDAY_MAPPINGS = {
    // 中文
    '星期日': 0, '周日': 0, '星期天': 0,
    '星期一': 1, '周一': 1,
    '星期二': 2, '周二': 2,
    '星期三': 3, '周三': 3,
    '星期四': 4, '周四': 4,
    '星期五': 5, '周五': 5,
    '星期六': 6, '周六': 6,
    // 英文完整
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6,
    // 英文缩写
    'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3,
    'thu': 4, 'fri': 5, 'sat': 6
};

/**
 * 解析时间关键词，返回匹配范围
 * @param {string} query - 搜索关键词（已转小写）
 * @returns {Object|null} - { type, start, end } 或 null
 */
function parseTimeKeyword(query) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 相对时间关键词
    if (query === '今天' || query === 'today') {
        return {
            type: 'range',
            start: today.getTime(),
            end: today.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }
    if (query === '昨天' || query === 'yesterday') {
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        return {
            type: 'range',
            start: yesterday.getTime(),
            end: today.getTime() - 1
        };
    }
    if (query === '前天' || query === 'day before yesterday') {
        const dayBefore = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        return {
            type: 'range',
            start: dayBefore.getTime(),
            end: yesterday.getTime() - 1
        };
    }

    // 本周/上周
    if (query === '本周' || query === 'this week') {
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(today.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
        return {
            type: 'range',
            start: monday.getTime(),
            end: now.getTime()
        };
    }
    if (query === '上周' || query === 'last week') {
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const thisMonday = new Date(today.getTime() + mondayOffset * 24 * 60 * 60 * 1000);
        const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
        const lastSunday = new Date(thisMonday.getTime() - 1);
        return {
            type: 'range',
            start: lastMonday.getTime(),
            end: lastSunday.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }

    // 本月/上月
    if (query === '本月' || query === 'this month') {
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return {
            type: 'range',
            start: firstOfMonth.getTime(),
            end: now.getTime()
        };
    }
    if (query === '上月' || query === 'last month') {
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return {
            type: 'range',
            start: firstOfLastMonth.getTime(),
            end: firstOfThisMonth.getTime() - 1
        };
    }

    // 月份匹配（如：1月、January、Jan）
    const monthNum = MONTH_MAPPINGS[query];
    if (monthNum) {
        return { type: 'month', month: monthNum };
    }

    // 星期匹配（如：星期三、Wednesday、Wed）
    const weekdayNum = WEEKDAY_MAPPINGS[query];
    if (typeof weekdayNum === 'number') {
        return { type: 'weekday', weekday: weekdayNum };
    }

    // 日期匹配（如：15日、15号、15th、1st）
    const dayMatch = query.match(/^(\d{1,2})(日|号|st|nd|rd|th)?$/);
    if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        if (day >= 1 && day <= 31) {
            return { type: 'day', day };
        }
    }

    // 年份匹配（如：2026、2026年）
    const yearMatch = query.match(/^(\d{4})年?$/);
    if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        if (year >= 1970 && year <= 2100) {
            return { type: 'year', year };
        }
    }

    // 精确日期匹配（如：2026-01-15、2026年1月15日）
    // ISO格式
    const isoMatch = query.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10);
        const day = parseInt(isoMatch[3], 10);
        const date = new Date(year, month - 1, day);
        return {
            type: 'range',
            start: date.getTime(),
            end: date.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }

    // 中文日期格式
    const zhDateMatch = query.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
    if (zhDateMatch) {
        const year = parseInt(zhDateMatch[1], 10);
        const month = parseInt(zhDateMatch[2], 10);
        const day = parseInt(zhDateMatch[3], 10);
        const date = new Date(year, month - 1, day);
        return {
            type: 'range',
            start: date.getTime(),
            end: date.getTime() + 24 * 60 * 60 * 1000 - 1
        };
    }

    return null;
}

/**
 * 判断时间戳是否匹配时间关键词
 * @param {number} timestamp - 时间戳
 * @param {Object} timeKeyword - parseTimeKeyword 的返回值
 * @returns {boolean}
 */
function matchTimeRange(timestamp, timeKeyword) {
    if (!timeKeyword || !timestamp) return false;

    const date = new Date(timestamp);

    switch (timeKeyword.type) {
        case 'range':
            return timestamp >= timeKeyword.start && timestamp <= timeKeyword.end;
        case 'month':
            return date.getMonth() + 1 === timeKeyword.month;
        case 'weekday':
            return date.getDay() === timeKeyword.weekday;
        case 'day':
            return date.getDate() === timeKeyword.day;
        case 'year':
            return date.getFullYear() === timeKeyword.year;
        default:
            return false;
    }
}

/**
 * 构建时间搜索字符串（用于模糊匹配）
 * @param {number} timestamp - 时间戳
 * @returns {string}
 */
function buildTimeSearchableString(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = date.getDay();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    const zhMonths = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const enMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const enMonthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const zhWeekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const zhWeekdaysShort = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const enWeekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const enWeekdaysShort = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    const parts = [
        // ISO格式
        `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        // 中文格式
        `${year}年${month}月${day}日`,
        `${month}月${day}日`,
        `${day}日`,
        `${day}号`,
        `${year}年`,
        zhMonths[month - 1],
        zhWeekdays[weekday],
        zhWeekdaysShort[weekday],
        // 英文格式
        enMonths[month - 1],
        enMonthsShort[month - 1],
        enWeekdays[weekday],
        enWeekdaysShort[weekday],
        // 数字格式
        `${month}月`,
        `${hours}:${String(minutes).padStart(2, '0')}`,
        String(year)
    ];

    return parts.join(' ').toLowerCase();
}

// ==================== Phase 2: 字段匹配函数 ====================

/**
 * 备份类型关键词映射
 */
const TYPE_MAPPINGS = {
    '手动': 'manual', 'manual': 'manual',
    '自动': 'auto', 'auto': 'auto', '自动备份': 'auto',
    '切换': 'switch', 'switch': 'switch'
};

/**
 * 备份方向关键词映射
 */
const DIRECTION_MAPPINGS = {
    '本地': ['local', 'webdav_local', 'github_repo_local', 'cloud_local'],
    'local': ['local', 'webdav_local', 'github_repo_local', 'cloud_local'],
    '云端': ['upload', 'webdav', 'github_repo', 'cloud', 'webdav_local', 'github_repo_local', 'cloud_local'],
    'cloud': ['upload', 'webdav', 'github_repo', 'cloud', 'webdav_local', 'github_repo_local', 'cloud_local'],
    '云端1': ['webdav', 'webdav_local'],
    'cloud1': ['webdav', 'webdav_local'],
    'webdav': ['webdav', 'webdav_local'],
    '云端2': ['github_repo', 'github_repo_local'],
    'cloud2': ['github_repo', 'github_repo_local'],
    'github': ['github_repo', 'github_repo_local'],
    'repo': ['github_repo', 'github_repo_local'],
};

/**
 * 变化状态关键词映射
 */
const CHANGE_MAPPINGS = {
    '无变化': 'hasNoChange', 'no change': 'hasNoChange', '没变化': 'hasNoChange',
    '首次': 'isFirst', 'first': 'isFirst', '第一次': 'isFirst',
    '新增': 'hasAdded', 'added': 'hasAdded', '+': 'hasAdded',
    '删除': 'hasDeleted', 'deleted': 'hasDeleted', '-': 'hasDeleted',
    '移动': 'hasMoved', 'moved': 'hasMoved',
    '修改': 'hasModified', 'modified': 'hasModified'
};

/**
 * 匹配序号
 * @param {string} query - 搜索关键词
 * @param {Object} item - 索引项
 * @returns {number} - 匹配分数（0表示不匹配）
 */
function matchSeqNumber(query, item) {
    // 移除 # 前缀
    let numStr = query;
    if (query.startsWith('#')) numStr = query.slice(1);
    if (query.startsWith('序号')) numStr = query.slice(2);

    const num = parseInt(numStr, 10);
    if (Number.isNaN(num)) return 0;

    if (item.seqNumber === num) return 200;
    return 0;
}

/**
 * 匹配哈希值
 * @param {string} query - 搜索关键词
 * @param {Object} item - 索引项
 * @returns {number} - 匹配分数（0表示不匹配）
 */
function matchFingerprint(query, item) {
    if (!item.__fingerprint) return 0;

    // 移除 # 前缀
    let hashStr = query.toLowerCase();
    if (hashStr.startsWith('#')) hashStr = hashStr.slice(1);

    if (hashStr.length < 2) return 0; // 太短不匹配

    if (item.__fingerprint.startsWith(hashStr)) return 150;
    if (item.__fingerprint.includes(hashStr)) return 100;
    return 0;
}

/**
 * 匹配备注
 * @param {string} query - 搜索关键词
 * @param {Object} item - 索引项
 * @returns {number} - 匹配分数（0表示不匹配）
 */
function matchNote(query, item) {
    if (!item.__note) return 0;

    if (item.__note.startsWith(query)) return 130;
    if (item.__note.includes(query)) return 120;
    return 0;
}

/**
 * 匹配备份类型
 * @param {string} query - 搜索关键词
 * @param {Object} item - 索引项
 * @returns {number} - 匹配分数（0表示不匹配）
 */
function matchType(query, item) {
    const expectedType = TYPE_MAPPINGS[query];
    if (!expectedType) return 0;

    if (item.type === expectedType) return 80;
    return 0;
}

/**
 * 匹配备份方向
 * @param {string} query - 搜索关键词
 * @param {Object} item - 索引项
 * @returns {number} - 匹配分数（0表示不匹配）
 */
function matchDirection(query, item) {
    const validDirections = DIRECTION_MAPPINGS[query];
    if (!validDirections) return 0;

    if (validDirections.includes(item.direction)) return 70;
    return 0;
}

/**
 * 匹配变化状态
 * @param {string} query - 搜索关键词
 * @param {Object} item - 索引项
 * @returns {number} - 匹配分数（0表示不匹配）
 */
function matchChanges(query, item) {
    const changeKey = CHANGE_MAPPINGS[query];
    if (!changeKey) return 0;

    if (item[changeKey]) return 60;
    return 0;
}

/**
 * 匹配时间
 * @param {string} query - 搜索关键词
 * @param {Object} item - 索引项
 * @returns {number} - 匹配分数（0表示不匹配）
 */
function matchTime(query, item) {
    // 先尝试解析为时间关键词
    const timeKeyword = parseTimeKeyword(query);
    if (timeKeyword) {
        if (matchTimeRange(item.time, timeKeyword)) {
            // 根据匹配精确度返回不同分数
            switch (timeKeyword.type) {
                case 'range':
                    // 计算范围大小来决定分数（范围越小越精确）
                    const rangeSize = timeKeyword.end - timeKeyword.start;
                    if (rangeSize < 24 * 60 * 60 * 1000) return 100; // 一天内
                    if (rangeSize < 7 * 24 * 60 * 60 * 1000) return 90; // 一周内
                    return 85;
                case 'month':
                case 'weekday':
                case 'day':
                    return 50;
                case 'year':
                    return 40;
                default:
                    return 30;
            }
        }
        return 0;
    }

    // 模糊匹配时间字符串
    if (item.__timeSearchable && item.__timeSearchable.includes(query)) {
        return 30;
    }

    return 0;
}

// ==================== Phase 2: 索引构建 ====================

/**
 * 获取备份历史搜索签名（用于缓存失效判断）
 */
function getBackupHistorySearchSignature() {
    if (!Array.isArray(syncHistory) || syncHistory.length === 0) return '';
    const latestTime = syncHistory[syncHistory.length - 1]?.time || 0;
    return `${syncHistory.length}:${latestTime}`;
}

/**
 * 重置备份历史搜索数据库
 */
function resetBackupHistorySearchDb(reason = '') {
    backupHistorySearchDb = {
        signature: null,
        items: [],
        itemByTime: new Map()
    };
    console.log('[Search] Phase 2 cache cleared:', reason);
}

/**
 * 构建备份历史搜索数据库
 */
function buildBackupHistorySearchDb() {
    const signature = getBackupHistorySearchSignature();
    if (backupHistorySearchDb.signature === signature && Array.isArray(backupHistorySearchDb.items)) {
        return backupHistorySearchDb;
    }

    const startTime = performance.now();
    const items = [];
    const itemByTime = new Map();

    if (!Array.isArray(syncHistory) || syncHistory.length === 0) {
        backupHistorySearchDb = { signature, items, itemByTime };
        return backupHistorySearchDb;
    }

    // 反转以匹配显示顺序（最新在前）
    const reversedHistory = [...syncHistory].reverse();

    reversedHistory.forEach((record, index) => {
        // 计算变化信息
        const changes = typeof calculateChanges === 'function'
            ? calculateChanges(record, index, reversedHistory)
            : {};

        const item = {
            // 原始字段
            time: record.time,
            fingerprint: record.fingerprint || '',
            note: record.note || '',
            seqNumber: typeof record.seqNumber === 'number' ? record.seqNumber : null,
            type: record.type || 'auto',
            direction: (record.direction || 'none').toLowerCase(),

            // 变化统计（预计算）
            hasNoChange: changes.hasNoChange || false,
            isFirst: changes.isFirst || false,
            hasAdded: (changes.bookmarkAdded > 0 || changes.folderAdded > 0),
            hasDeleted: (changes.bookmarkDeleted > 0 || changes.folderDeleted > 0),
            hasMoved: changes.bookmarkMoved || changes.folderMoved || false,
            hasModified: changes.bookmarkModified || changes.folderModified || false,

            // 变化详情（用于渲染）
            changes,

            // 小写预处理（用于快速匹配）
            __note: (record.note || '').toLowerCase(),
            __fingerprint: (record.fingerprint || '').toLowerCase(),
            __timeSearchable: buildTimeSearchableString(record.time)
        };

        items.push(item);
        itemByTime.set(record.time, item);
    });

    const buildTime = performance.now() - startTime;
    console.log(`[Search] Phase 2 index built: ${items.length} items in ${buildTime.toFixed(2)}ms`);

    backupHistorySearchDb = { signature, items, itemByTime };
    return backupHistorySearchDb;
}

// ==================== Phase 2: 搜索匹配与排序 ====================

/**
 * 计算备份历史搜索项的匹配分数
 * @param {Object} item - 搜索项
 * @param {string} query - 搜索关键词
 * @returns {number} - 匹配分数（-Infinity表示不匹配）
 */
/**
 * 执行备份历史搜索并渲染结果 (Refactored for Phase 2.5: Unified Date)
 * @param {string} query - 搜索关键词
 */
function searchBackupHistoryAndRender(query) {
    // 数据尚未准备好
    if (!Array.isArray(syncHistory) || syncHistory.length === 0) {
        renderHistorySearchResultsPanel([], { query, emptyText: i18n.searchLoading?.[currentLang] || 'Loading...' });
        return;
    }

    const db = buildBackupHistorySearchDb();
    if (!db.items || db.items.length === 0) {
        renderHistorySearchResultsPanel([], { query, emptyText: i18n.searchNoResults?.[currentLang] || 'No results' });
        return;
    }

    const q = String(query).trim();
    if (!q) {
        hideSearchResultsPanel();
        return;
    }

    let results = [];
    const dateMeta = parseDateQuery(q);

    // 1. 优先日期匹配 (Unified Date Protocol)
    if (dateMeta) {
        results = db.items.filter(item => {
            const date = new Date(item.time);
            if (dateMeta.type === 'day') {
                if (dateMeta.ignoreYear) {
                    return (date.getMonth() + 1) === parseInt(dateMeta.m) &&
                        date.getDate() === parseInt(dateMeta.d);
                }
                return date.getFullYear() === parseInt(dateMeta.y) &&
                    (date.getMonth() + 1) === parseInt(dateMeta.m) &&
                    date.getDate() === parseInt(dateMeta.d);
            } else if (dateMeta.type === 'month') {
                if (dateMeta.ignoreYear) {
                    return (date.getMonth() + 1) === parseInt(dateMeta.m);
                }
                return date.getFullYear() === parseInt(dateMeta.y) &&
                    (date.getMonth() + 1) === parseInt(dateMeta.m);
            } else if (dateMeta.type === 'year') {
                return date.getFullYear() === parseInt(dateMeta.y);
            } else if (dateMeta.type === 'range') {
                // [New] Date Range Support
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                const dd = String(date.getDate()).padStart(2, '0');
                const yyyy = String(date.getFullYear());

                if (dateMeta.ignoreYear) {
                    // Compare only MM-DD
                    const mmdd = mm + '-' + dd;
                    const startMmdd = dateMeta.startM + '-' + dateMeta.startD;
                    const endMmdd = dateMeta.endM + '-' + dateMeta.endD;
                    return mmdd >= startMmdd && mmdd <= endMmdd;
                } else {
                    // Compare full date
                    const fullDate = `${yyyy}-${mm}-${dd}`;
                    return fullDate >= dateMeta.startKey && fullDate <= dateMeta.endKey;
                }
            }
            return false;
        });

        // 标记为日期结果，分数提高
        results.forEach(r => r.score = 200);
    } else {
        // 2. 关键词模糊匹配
        // Keep multi-word English keywords intact (e.g. "no change", "this week").
        const normalized = q.toLowerCase()
            .replace(/\bno\s+change\b/g, 'no_change')
            .replace(/\bthis\s+week\b/g, 'this_week')
            .replace(/\blast\s+week\b/g, 'last_week')
            .replace(/\bthis\s+month\b/g, 'this_month')
            .replace(/\blast\s+month\b/g, 'last_month');
        const tokens = normalized.split(/\s+/).filter(Boolean);

        // AND semantics across tokens: every token must match at least one field.
        results = db.items.map(item => {
            let score = 0;

            for (const t of tokens) {
                const token = t.replace(/_/g, ' ');
                let tokenScore = 0;

                // Structured filters + fast fields
                tokenScore = Math.max(tokenScore, matchSeqNumber(token, item));
                tokenScore = Math.max(tokenScore, matchFingerprint(token, item));
                tokenScore = Math.max(tokenScore, matchNote(token, item));
                tokenScore = Math.max(tokenScore, matchTime(token, item));
                tokenScore = Math.max(tokenScore, matchChanges(token, item));
                tokenScore = Math.max(tokenScore, matchType(token, item));
                tokenScore = Math.max(tokenScore, matchDirection(token, item));

                // Fallback: keep legacy direct keyword matches
                if (tokenScore === 0) {
                    if (item.type && String(item.type).toLowerCase() === token) tokenScore = 40;
                    else if (item.direction && String(item.direction).toLowerCase().includes(token)) tokenScore = 20;
                }

                if (tokenScore <= 0) return null;
                score += tokenScore;
            }

            item.score = score;
            return item;
        }).filter(Boolean);
    }

    // 默认排序：分数高 -> 时间新
    results.sort((a, b) => {
        const sa = a.score || 0;
        const sb = b.score || 0;
        if (sa !== sb) return sb - sa;
        return b.time - a.time;
    });

    const MAX_RESULTS = 30;
    const finalResults = results.slice(0, MAX_RESULTS);
    renderHistorySearchResultsPanel(finalResults, { query: q });
}

// Remove old scoreBackupHistoryItem as it is integrated
// function scoreBackupHistoryItem... (Removed)

// ==================== Phase 2: 结果渲染 ====================

/**
 * 渲染备份历史搜索结果面板
 * @param {Array} results - 搜索结果数组
 * @param {Object} options - 渲染选项
 */
function renderHistorySearchResultsPanel(results, options = {}) {
    const { query = '' } = options;
    const panel = getSearchResultsPanel();
    if (!panel) return;

    // Isolation guard: avoid rendering history results when user already cleared input or left the view.
    try {
        const input = document.getElementById('searchInput');
        const currentQ = (input && typeof input.value === 'string') ? input.value.trim().toLowerCase() : '';
        const expectedQ = String(query || '').trim().toLowerCase();
        if (typeof window.currentView === 'string' && window.currentView !== 'history') return;
        if (currentQ !== expectedQ) return;
    } catch (_) { }

    searchUiState.view = 'history';
    searchUiState.query = query;
    searchUiState.results = Array.isArray(results) ? results : [];
    searchUiState.selectedIndex = -1;

    if (!searchUiState.results.length) {
        const emptyText = options.emptyText || i18n.searchNoResults?.[currentLang] || '没有找到匹配的记录';
        panel.innerHTML = `<div class="search-results-empty">${escapeHtml(emptyText)}</div>`;
        showSearchResultsPanel();
        return;
    }

    const isZh = currentLang === 'zh_CN';

    const rowsHtml = searchUiState.results.map((item, idx) => {
        const seqDisplay = typeof item.seqNumber === 'number' ? item.seqNumber : '-';
        const noteOrTime = item.note || (typeof formatTime === 'function' ? formatTime(item.time) : new Date(item.time).toLocaleString());
        const safeTitle = escapeHtml(noteOrTime);

        // 哈希显示（前8位）
        const hashDisplay = item.fingerprint ? `#${item.fingerprint.slice(0, 8)}` : '';

        // 变化统计 - 只用符号，不显示文字
        const changes = item.changes || {};
        const changeParts = [];
        if (changes.isFirst) {
            // 首次备份显示文字（参考备份历史样式）
            changeParts.push(`<span class="search-history-stat first">${isZh ? '首次' : 'First'}</span>`);
        } else if (changes.hasNoChange) {
            // 无变化用 = 符号
            changeParts.push(`<span class="search-history-stat no-change" title="${currentLang === 'zh_CN' ? '无变化' : 'No Change'}">=</span>`);
        } else {
            if (changes.bookmarkAdded > 0 || changes.folderAdded > 0) {
                const count = (changes.bookmarkAdded || 0) + (changes.folderAdded || 0);
                changeParts.push(`<span class="search-history-stat added" title="${currentLang === 'zh_CN' ? '新增' : 'Added'}">+${count}</span>`);
            }
            if (changes.bookmarkDeleted > 0 || changes.folderDeleted > 0) {
                const count = (changes.bookmarkDeleted || 0) + (changes.folderDeleted || 0);
                changeParts.push(`<span class="search-history-stat deleted" title="${currentLang === 'zh_CN' ? '删除' : 'Deleted'}">-${count}</span>`);
            }
            if (changes.bookmarkMoved || changes.folderMoved) {
                changeParts.push(`<span class="search-history-stat moved" title="${currentLang === 'zh_CN' ? '移动' : 'Moved'}">>></span>`);
            }
            if (changes.bookmarkModified || changes.folderModified) {
                changeParts.push(`<span class="search-history-stat modified" title="${currentLang === 'zh_CN' ? '修改' : 'Modified'}">~</span>`);
            }
        }

        // 备份类型 - 已移除

        // 方向图标 - 已移除

        // 时间显示
        const timeDisplay = typeof formatTime === 'function' ? formatTime(item.time) : new Date(item.time).toLocaleString();

        return `
            <div class="search-result-item search-result-history-item" role="option" data-index="${idx}" data-record-time="${item.time}">
                <div class="search-result-row">
                    <div class="search-result-main">
                        <div class="search-result-title">
                            <span class="search-result-index">${seqDisplay}</span>
                            <span class="search-result-note">${safeTitle}</span>
                        </div>
                        <div class="search-result-history-meta">
                            <span class="search-history-time">${escapeHtml(timeDisplay)}</span>
                            <span class="search-history-stats">${changeParts.join(' ')}</span>
                        </div>
                    </div>
                    ${hashDisplay ? `<div class="search-result-right"><span class="search-result-hash">${escapeHtml(hashDisplay)}</span></div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    panel.innerHTML = rowsHtml;
    showSearchResultsPanel();
    updateSearchResultSelection(0);
}

// ==================== Phase 2: 定位实现 ====================

/**
 * 计算记录所在页码
 * @param {number} recordTime - 记录时间戳
 * @returns {number} - 页码（从1开始），如果找不到返回-1
 */
function getRecordPageNumber(recordTime) {
    if (!Array.isArray(syncHistory) || syncHistory.length === 0) return -1;

    const reversedHistory = [...syncHistory].reverse();
    const index = reversedHistory.findIndex(r => r.time === recordTime);

    if (index === -1) return -1;

    // 获取每页大小
    const pageSize = typeof HISTORY_PAGE_SIZE !== 'undefined' ? HISTORY_PAGE_SIZE : 10;
    return Math.ceil((index + 1) / pageSize);
}

/**
 * 定位到指定的备份历史记录
 * @param {number} recordTime - 记录时间戳
 * @param {Object} options - 定位选项
 */
async function locateRecordInHistory(recordTime, options = {}) {
    const { highlightDuration = 1500, openDetail = false } = options;

    if (!recordTime) return false;

    // 计算目标页码
    const targetPage = getRecordPageNumber(recordTime);
    if (targetPage === -1) {
        console.warn('[Search] Record not found in history:', recordTime);
        return false;
    }

    // 切换分页（如果需要）
    const currentPage = typeof currentHistoryPage !== 'undefined' ? currentHistoryPage : 1;
    if (currentPage !== targetPage) {
        // 更新页码
        if (typeof window !== 'undefined') {
            window.currentHistoryPage = targetPage;
        }
        // 使用全局变量
        if (typeof currentHistoryPage !== 'undefined') {
            // 直接修改全局变量（history.js 中定义）
            try {
                // 通过 eval 或直接赋值（取决于变量定义方式）
                window.currentHistoryPage = targetPage;
            } catch (_) { }
        }

        // 重新渲染历史视图
        if (typeof renderHistoryView === 'function') {
            renderHistoryView();
        }
    }

    // 等待 DOM 更新
    await new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        });
    });

    // 查找目标元素
    const targetSelector = `.commit-item[data-record-time="${recordTime}"]`;
    let target = document.querySelector(targetSelector);

    // 重试机制
    if (!target) {
        await new Promise(resolve => setTimeout(resolve, 100));
        target = document.querySelector(targetSelector);
    }
    if (!target) {
        await new Promise(resolve => setTimeout(resolve, 200));
        target = document.querySelector(targetSelector);
    }

    if (!target) {
        console.warn('[Search] Target element not found after retries:', targetSelector);
        return false;
    }

    // 滚动到目标位置
    try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }

    // 高亮闪烁
    target.classList.add('search-highlight-pulse');
    setTimeout(() => {
        try { target.classList.remove('search-highlight-pulse'); } catch (_) { }
    }, highlightDuration);

    // 可选：自动打开详情
    if (openDetail) {
        const detailBtn = target.querySelector('.detail-btn');
        if (detailBtn) {
            setTimeout(() => {
                try { detailBtn.click(); } catch (_) { }
            }, 300);
        }
    }

    return true;
}

/**
 * 激活备份历史搜索结果
 * @param {number} index - 结果索引
 */
async function activateHistorySearchResultAtIndex(index) {
    const idx = typeof index === 'number' ? index : parseInt(index, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= searchUiState.results.length) return;

    const item = searchUiState.results[idx];
    if (!item) return;

    hideSearchResultsPanel();

    // 清空输入框
    try {
        const inputEl = document.getElementById('searchInput');
        if (inputEl) inputEl.value = '';
    } catch (_) { }

    await locateRecordInHistory(item.time);
}

// =============================================================================
// Phase 2.5: 历史详情内部搜索（History Detail Search）
// =============================================================================

/**
 * Phase 2.5 模块状态
 * - 在历史详情模态框内部搜索书签/文件夹变化
 * - 复用 Phase 1 的搜索逻辑，适配模态框内的容器
 */

/**
 * 历史详情搜索数据库（按 recordTime 隔离缓存）
 * Map<recordTime, searchDb>
 */
const historyDetailSearchDbMap = new Map();

/**
 * 历史详情搜索 UI 状态
 */
const historyDetailSearchState = {
    recordTime: null,           // 当前打开的记录时间戳
    query: '',                  // 当前搜索关键词
    selectedIndex: -1,          // 选中的结果索引
    results: [],                // 搜索结果
    isActive: false             // 是否激活搜索
};

// ==================== Phase 2.5: 缓存管理 ====================

/**
 * 清除指定历史记录的搜索缓存
 * @param {string} recordTime - 记录时间戳
 */
function clearHistoryDetailSearchDb(recordTime) {
    const key = String(recordTime);
    if (historyDetailSearchDbMap.has(key)) {
        historyDetailSearchDbMap.delete(key);
        console.log('[Search] Phase 2.5 cache cleared for:', key);
    }
}

/**
 * 清除所有历史详情搜索缓存
 */
function clearAllHistoryDetailSearchDb() {
    const count = historyDetailSearchDbMap.size;
    historyDetailSearchDbMap.clear();
    if (count > 0) {
        console.log('[Search] Phase 2.5 all caches cleared, count:', count);
    }
}

// ==================== Phase 2.5: 搜索索引构建 ====================

/**
 * 构建历史详情搜索数据库
 * @param {Object} options - 构建选项
 * @param {Map} options.changeMap - 变化映射 (nodeId -> changeInfo)
 * @param {Array} options.currentTree - 当前树
 * @param {Array} options.oldTree - 旧树（可选，用于获取删除节点信息）
 * @param {string} options.recordTime - 记录时间戳（作为缓存键）
 */
function buildHistoryDetailSearchDb(options) {
    const { changeMap, currentTree, oldTree, recordTime } = options;
    const cacheKey = String(recordTime);

    // 检查缓存
    const cached = historyDetailSearchDbMap.get(cacheKey);
    if (cached && cached.signature === cacheKey) {
        return cached;
    }

    const ids = changeMap ? Array.from(changeMap.keys()).map(v => String(v)) : [];
    const idSet = new Set(ids);

    // 收集节点信息（复用 Phase 1 的函数）
    const currentInfo = collectNodeInfoForIds(currentTree, idSet);
    const oldInfo = oldTree ? collectNodeInfoForIds(oldTree, idSet) : new Map();

    const items = [];
    const itemById = new Map();

    for (const id of ids) {
        const change = changeMap ? (changeMap.get(id) || {}) : {};
        const changeType = typeof change.type === 'string' ? change.type : '';
        const changeTypeParts = changeType ? changeType.split('+') : [];

        const cur = currentInfo.get(id) || null;
        const old = oldInfo.get(id) || null;
        const title = (cur?.title || old?.title || '').trim();
        const url = (cur?.url || old?.url || '').trim();
        const nodeType = url ? 'bookmark' : 'folder';

        const newNamedPath = (change.moved && change.moved.newPath) ? String(change.moved.newPath) : (cur?.namedPath || '');
        const oldNamedPath = (change.moved && change.moved.oldPath) ? String(change.moved.oldPath) : (old?.namedPath || '');

        const titleLower = title.toLowerCase();
        const urlLower = url.toLowerCase();
        const newPathLower = (newNamedPath || '').toLowerCase();
        const oldPathLower = (oldNamedPath || '').toLowerCase();

        const item = {
            id,
            title,
            url,
            nodeType,
            changeType,
            changeTypeParts,
            newNamedPath,
            oldNamedPath,
            __t: titleLower,
            __u: urlLower,
            __pn: newPathLower,
            __po: oldPathLower
        };

        items.push(item);
        itemById.set(id, item);
    }

    const db = {
        signature: cacheKey,
        size: ids.length,
        items,
        itemById
    };

    historyDetailSearchDbMap.set(cacheKey, db);
    console.log('[Search] Phase 2.5 index built for:', cacheKey, 'items:', items.length);

    return db;
}

// ==================== Phase 2.5: 搜索执行 ====================

/**
 * 执行历史详情搜索
 * @param {string} query - 搜索关键词
 * @param {Object} db - 搜索数据库
 * @returns {Array} 搜索结果
 */
function searchHistoryDetailChanges(query, db) {
    if (!db || !db.items || db.items.length === 0) {
        return [];
    }

    const tokens = String(query).toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (!tokens.length) {
        return [];
    }

    const scored = [];
    for (const item of db.items) {
        // 复用 Phase 1 的评分逻辑
        const s = scoreCurrentChangesSearchItem(item, tokens);
        if (s > -Infinity) scored.push({ item, s });
    }

    scored.sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        const ta = a.item.title || '';
        const tb = b.item.title || '';
        const tc = ta.localeCompare(tb);
        if (tc !== 0) return tc;
        return (a.item.url || '').localeCompare((b.item.url || ''));
    });

    const MAX_RESULTS = 20;
    return scored.slice(0, MAX_RESULTS).map(x => x.item);
}

// ==================== Phase 2.5: 结果渲染 ====================

/**
 * 获取模态框内的搜索结果面板
 * @param {Element} modalContainer - 模态框容器
 */
function getHistoryDetailSearchPanel(modalContainer) {
    return modalContainer?.querySelector('.detail-search-results-panel');
}

/**
 * 显示模态框内的搜索结果面板
 * @param {Element} modalContainer - 模态框容器
 */
function showHistoryDetailSearchPanel(modalContainer) {
    const panel = getHistoryDetailSearchPanel(modalContainer);
    if (panel) panel.classList.add('visible');
}

/**
 * 隐藏模态框内的搜索结果面板
 * @param {Element} modalContainer - 模态框容器
 */
function hideHistoryDetailSearchPanel(modalContainer) {
    const panel = getHistoryDetailSearchPanel(modalContainer);
    if (panel) panel.classList.remove('visible');
}

/**
 * 渲染模态框内的搜索结果
 * @param {Array} results - 搜索结果
 * @param {Element} modalContainer - 模态框容器
 * @param {Object} options - 渲染选项
 */
function renderHistoryDetailSearchResults(results, modalContainer, options = {}) {
    const panel = getHistoryDetailSearchPanel(modalContainer);
    if (!panel) return;

    const { query = '' } = options;

    historyDetailSearchState.query = query;
    historyDetailSearchState.results = Array.isArray(results) ? results : [];
    historyDetailSearchState.selectedIndex = -1;

    if (!historyDetailSearchState.results.length) {
        const emptyText = options.emptyText || (typeof i18n !== 'undefined' && typeof currentLang !== 'undefined'
            ? i18n.searchNoResults[currentLang]
            : '无匹配结果');
        panel.innerHTML = `<div class="search-results-empty">${escapeHtml(emptyText)}</div>`;
        showHistoryDetailSearchPanel(modalContainer);
        return;
    }

    const isZh = typeof currentLang !== 'undefined' && currentLang === 'zh_CN';

    const rowsHtml = historyDetailSearchState.results.map((item, idx) => {
        const safeTitle = escapeHtml(item.title || (isZh ? '（无标题）' : '(Untitled)'));
        const metaText = item.nodeType === 'bookmark' && item.url ? escapeHtml(item.url) : '';

        // 变化类型徽章
        const parts = Array.isArray(item.changeTypeParts) ? item.changeTypeParts : [];
        const badges = [];
        if (parts.includes('added') || item.changeType === 'added') badges.push(`<span class="search-change-prefix added" title="${isZh ? '新增' : 'Added'}">+</span>`);
        if (parts.includes('deleted') || item.changeType === 'deleted') badges.push(`<span class="search-change-prefix deleted" title="${isZh ? '删除' : 'Deleted'}">-</span>`);
        if (parts.includes('moved')) badges.push(`<span class="search-change-prefix moved" title="${isZh ? '移动' : 'Moved'}">>></span>`);
        if (parts.includes('modified')) badges.push(`<span class="search-change-prefix modified" title="${isZh ? '修改' : 'Modified'}">~</span>`);
        const badgesHtml = badges.length ? badges.join('') : '';
        const changeIconsHtml = badgesHtml ? `<span class="search-change-icons">${badgesHtml}</span>` : '';

        return `
            <div class="search-result-item" role="option" data-index="${idx}" data-node-id="${escapeHtml(item.id)}" data-change-type="${escapeHtml(item.changeType || '')}">
                <div class="search-result-row">
                    <div class="search-result-main">
                        <div class="search-result-title">
                            <span class="search-result-index">${idx + 1}</span>
                            ${changeIconsHtml}
                            <span>${safeTitle}</span>
                        </div>
                        ${metaText ? `<div class="search-result-meta">${metaText}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    panel.innerHTML = rowsHtml;
    showHistoryDetailSearchPanel(modalContainer);
    updateHistoryDetailSearchSelection(modalContainer, 0);
}

/**
 * 更新模态框内搜索结果的选中状态
 * @param {Element} modalContainer - 模态框容器
 * @param {number} nextIndex - 下一个选中索引
 */
function updateHistoryDetailSearchSelection(modalContainer, nextIndex) {
    const panel = getHistoryDetailSearchPanel(modalContainer);
    if (!panel) return;

    const items = panel.querySelectorAll('.search-result-item');
    if (!items.length) {
        historyDetailSearchState.selectedIndex = -1;
        return;
    }

    const maxIdx = items.length - 1;
    const clamped = Math.max(0, Math.min(maxIdx, nextIndex));

    items.forEach(el => el.classList.remove('selected'));
    const selectedEl = items[clamped];
    if (selectedEl) {
        selectedEl.classList.add('selected');
        try {
            selectedEl.scrollIntoView({ block: 'nearest' });
        } catch (_) { }
    }
    historyDetailSearchState.selectedIndex = clamped;
}

// ==================== Phase 2.5: 定位与高亮 ====================

/**
 * 在历史详情的树预览中定位到指定节点
 * @param {string} nodeId - 节点 ID
 * @param {Element} treeContainer - 树预览容器
 * @param {Object} options - 定位选项
 */
function locateNodeInHistoryDetailPreview(nodeId, treeContainer, options = {}) {
    if (!treeContainer) return false;

    const id = String(nodeId);
    const target = treeContainer.querySelector(`.tree-item[data-node-id="${CSS.escape(id)}"]`);

    if (!target) {
        console.warn('[Search] Phase 2.5 target not found:', id);
        return false;
    }

    // 展开祖先节点（复用 Phase 1 的逻辑）
    expandAncestorsForTreeItem(target, treeContainer);

    // 滚动到目标位置
    try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }

    // 高亮效果
    const highlightClass = options.highlightClass || getHighlightClassFromChangeType(options.changeType || '');
    if (highlightClass) {
        target.classList.add(highlightClass);
        setTimeout(() => {
            try { target.classList.remove(highlightClass); } catch (_) { }
        }, 1500);
    }

    return true;
}

// ==================== Phase 2.5: 激活搜索结果 ====================

/**
 * 激活历史详情搜索结果
 * @param {number} index - 结果索引
 * @param {Element} modalContainer - 模态框容器
 */
function activateHistoryDetailSearchResult(index, modalContainer) {
    const idx = typeof index === 'number' ? index : parseInt(index, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= historyDetailSearchState.results.length) return;

    const item = historyDetailSearchState.results[idx];
    if (!item) return;

    // 隐藏搜索结果面板
    hideHistoryDetailSearchPanel(modalContainer);

    // 清空搜索输入框
    const searchInput = modalContainer?.querySelector('.detail-search-input');
    if (searchInput) searchInput.value = '';

    // 定位到目标节点
    const treeContainer = modalContainer?.querySelector('.history-tree-container');
    if (treeContainer) {
        locateNodeInHistoryDetailPreview(item.id, treeContainer, { changeType: item.changeType });
    }
}

// ==================== Phase 2.5: 初始化与清理 ====================

/**
 * 初始化历史详情搜索
 * @param {Object} record - 历史记录
 * @param {Map} changeMap - 变化映射
 * @param {Array} currentTree - 当前树（记录的书签树）
 * @param {Array} oldTree - 旧树（上一条记录的书签树，可选）
 * @param {Element} modalContainer - 模态框容器
 */
function initHistoryDetailSearch(record, changeMap, currentTree, oldTree, modalContainer) {
    if (!record || !modalContainer) return;

    const recordTime = String(record.time);
    historyDetailSearchState.recordTime = recordTime;
    historyDetailSearchState.isActive = true;

    // 检查是否有变化可搜索
    if (!changeMap || changeMap.size === 0) {
        console.log('[Search] Phase 2.5: No changes to search for record:', recordTime);
        // 隐藏搜索按钮或显示禁用状态
        const searchBtn = modalContainer.querySelector('.detail-search-btn');
        if (searchBtn) searchBtn.style.display = 'none';
        return;
    }

    // 延迟构建索引（首次输入时）
    const searchInput = modalContainer.querySelector('.detail-search-input');
    const searchContainer = modalContainer.querySelector('.detail-search-container');
    const resultsPanel = modalContainer.querySelector('.detail-search-results-panel');

    if (!searchInput || !resultsPanel) {
        console.warn('[Search] Phase 2.5: Search elements not found in modal');
        return;
    }

    let dbBuilt = false;
    let db = null;

    const buildDbIfNeeded = () => {
        if (dbBuilt) return db;
        db = buildHistoryDetailSearchDb({
            changeMap,
            currentTree,
            oldTree,
            recordTime
        });
        dbBuilt = true;
        return db;
    };

    // 防抖处理
    let debounceTimer = null;
    const handleInput = (e) => {
        const query = (e.target.value || '').trim();

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (!query) {
                hideHistoryDetailSearchPanel(modalContainer);
                return;
            }

            const searchDb = buildDbIfNeeded();
            const results = searchHistoryDetailChanges(query, searchDb);
            renderHistoryDetailSearchResults(results, modalContainer, { query });
        }, 200);
    };

    // 键盘事件处理
    const handleKeydown = (e) => {
        const panel = getHistoryDetailSearchPanel(modalContainer);
        const isVisible = panel && panel.classList.contains('visible');

        if (!isVisible) {
            if (e.key === 'Escape') {
                hideHistoryDetailSearchPanel(modalContainer);
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateHistoryDetailSearchSelection(modalContainer, historyDetailSearchState.selectedIndex + 1);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            updateHistoryDetailSearchSelection(modalContainer, historyDetailSearchState.selectedIndex - 1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            activateHistoryDetailSearchResult(historyDetailSearchState.selectedIndex, modalContainer);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            hideHistoryDetailSearchPanel(modalContainer);
        }
    };

    // 点击结果
    const handleResultClick = (e) => {
        const itemEl = e.target.closest('.search-result-item');
        if (!itemEl) return;
        const index = parseInt(itemEl.getAttribute('data-index') || '-1', 10);
        activateHistoryDetailSearchResult(index, modalContainer);
    };

    // 鼠标悬停
    const handleResultMouseOver = (e) => {
        const itemEl = e.target.closest('.search-result-item');
        if (!itemEl) return;
        const index = parseInt(itemEl.getAttribute('data-index') || '-1', 10);
        if (!Number.isNaN(index)) {
            updateHistoryDetailSearchSelection(modalContainer, index);
        }
    };

    // 点击面板外部关闭
    const handleOutsideClick = (e) => {
        if (!searchContainer || !resultsPanel) return;
        if (searchContainer.contains(e.target)) return;
        hideHistoryDetailSearchPanel(modalContainer);
    };

    // 绑定事件
    searchInput.addEventListener('input', handleInput);
    searchInput.addEventListener('keydown', handleKeydown);
    resultsPanel.addEventListener('click', handleResultClick);
    resultsPanel.addEventListener('mouseover', handleResultMouseOver);
    modalContainer.addEventListener('click', handleOutsideClick);

    // 保存清理函数
    modalContainer._searchCleanup = () => {
        clearTimeout(debounceTimer);
        searchInput.removeEventListener('input', handleInput);
        searchInput.removeEventListener('keydown', handleKeydown);
        resultsPanel.removeEventListener('click', handleResultClick);
        resultsPanel.removeEventListener('mouseover', handleResultMouseOver);
        modalContainer.removeEventListener('click', handleOutsideClick);
    };

    console.log('[Search] Phase 2.5 initialized for record:', recordTime, 'changes:', changeMap.size);
}

/**
 * 清理历史详情搜索状态
 * @param {string} recordTime - 记录时间戳
 * @param {Element} modalContainer - 模态框容器（可选）
 */
function cleanupHistoryDetailSearch(recordTime, modalContainer) {
    // 执行事件监听器清理
    if (modalContainer && modalContainer._searchCleanup) {
        modalContainer._searchCleanup();
        delete modalContainer._searchCleanup;
    }

    // 隐藏搜索面板
    if (modalContainer) {
        hideHistoryDetailSearchPanel(modalContainer);
        const searchInput = modalContainer.querySelector('.detail-search-input');
        if (searchInput) searchInput.value = '';
    }

    // 清除缓存
    if (recordTime) {
        clearHistoryDetailSearchDb(recordTime);
    }

    // 重置状态
    historyDetailSearchState.recordTime = null;
    historyDetailSearchState.query = '';
    historyDetailSearchState.selectedIndex = -1;
    historyDetailSearchState.results = [];
    historyDetailSearchState.isActive = false;

    console.log('[Search] Phase 2.5 cleanup completed for:', recordTime);
}

/**
 * 切换历史详情搜索框的显示状态
 * @param {Element} modalContainer - 模态框容器
 */
function toggleHistoryDetailSearchBox(modalContainer) {
    if (!modalContainer) return;

    const searchContainer = modalContainer.querySelector('.detail-search-container');
    const searchInput = modalContainer.querySelector('.detail-search-input');

    if (!searchContainer) return;

    const isVisible = searchContainer.classList.contains('visible');

    if (isVisible) {
        searchContainer.classList.remove('visible');
        hideHistoryDetailSearchPanel(modalContainer);
    } else {
        searchContainer.classList.add('visible');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 100);
        }
    }
}

// =============================================================================
// =============================================================================

// ==================== 导出（供 history.js 调用） ====================
// 注意：由于 history.js 不使用 ES6 模块，这些函数作为全局函数暴露
// 主要供 history.js 中的 performSearch 调用

// 将函数暴露到全局作用域，以便 history.js 可以直接调用
if (typeof window !== 'undefined') {
    // ==================== Phase 1: 当前变化搜索 ====================
    window.hideSearchResultsPanel = hideSearchResultsPanel;
    window.searchCurrentChangesAndRender = searchCurrentChangesAndRender;
    window.resetCurrentChangesSearchDb = resetCurrentChangesSearchDb;

    // ==================== Phase 2: 备份历史搜索 ====================
    window.searchBackupHistoryAndRender = searchBackupHistoryAndRender;
    window.resetBackupHistorySearchDb = resetBackupHistorySearchDb;
    window.locateRecordInHistory = locateRecordInHistory;

    // ==================== Phase 2.5: 历史详情内部搜索 ====================
    window.initHistoryDetailSearch = initHistoryDetailSearch;
    window.cleanupHistoryDetailSearch = cleanupHistoryDetailSearch;
    window.toggleHistoryDetailSearchBox = toggleHistoryDetailSearchBox;
    window.clearAllHistoryDetailSearchDb = clearAllHistoryDetailSearchDb;

    // ==================== 通用事件处理函数 ====================
    window.handleSearchKeydown = handleSearchKeydown;
    window.handleSearchInputFocus = handleSearchInputFocus;
    window.handleSearchResultsPanelClick = handleSearchResultsPanelClick;
    window.handleSearchResultsPanelMouseOver = handleSearchResultsPanelMouseOver;
    window.handleSearchOutsideClick = handleSearchOutsideClick;

    // Phase 3.5 Export
    window.setSearchMode = setSearchMode;
    window.cycleSearchMode = cycleSearchMode;
    window.toggleSearchModeMenu = toggleSearchModeMenu;

    // 初始化
    window.initSearchEvents = initSearchEvents;

    // 模块对象（可选的命名空间访问方式）
    window.searchModule = {
        // 初始化
        init: initSearchEvents,
        hidePanel: hideSearchResultsPanel,

        // Phase 1: 当前变化
        searchCurrentChanges: searchCurrentChangesAndRender,
        resetCurrentChanges: resetCurrentChangesSearchDb,

        // Phase 2: 备份历史
        searchBackupHistory: searchBackupHistoryAndRender,
        resetBackupHistory: resetBackupHistorySearchDb,
        locateRecord: locateRecordInHistory,

        // Phase 2.5: 历史详情内部搜索
        initHistoryDetailSearch: initHistoryDetailSearch,
        cleanupHistoryDetailSearch: cleanupHistoryDetailSearch,
        toggleHistoryDetailSearchBox: toggleHistoryDetailSearchBox,
        clearAllHistoryDetailSearchDb: clearAllHistoryDetailSearchDb
    };
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.initSearchEvents === 'function') {
        window.initSearchEvents();
    }
});

// [User Request] Function to update search UI language (placeholder & menu)
function updateSearchUILanguage() {
    // Sync Placeholder
    if (typeof setSearchMode === 'function' && typeof searchUiState !== 'undefined') {
        setSearchMode(searchUiState.activeMode);
    }

    // Sync Menu if open
    if (typeof renderSearchModeMenu === 'function') {
        const menu = document.getElementById('searchModeMenu');
        if (menu && !menu.hidden) {
            renderSearchModeMenu();
        }
    }
}
window.updateSearchUILanguage = updateSearchUILanguage;
