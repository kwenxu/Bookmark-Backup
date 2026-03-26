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
    currentChangesTypeFilter: null,
    currentChangesTypeCounts: null,
    currentChangesExpandedDomainGroups: new Set(),
    currentChangesDomainGroupHostFilters: new Map(),
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
    itemById: new Map(),
    changedItems: [],
    changedItemById: new Map()
};

function getSearchLangKey() {
    try {
        return currentLang === 'zh_CN' ? 'zh_CN' : 'en';
    } catch (_) {
        return 'zh_CN';
    }
}

function getSearchI18nText(groupKey, fallbackZh, fallbackEn) {
    const langKey = getSearchLangKey();
    try {
        const group = (typeof i18n !== 'undefined' && i18n && typeof i18n === 'object')
            ? i18n[groupKey]
            : null;
        const value = group && typeof group === 'object' ? group[langKey] : '';
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    } catch (_) { }
    return langKey === 'zh_CN' ? fallbackZh : fallbackEn;
}

function getSearchTreeItemLookupId(treeItem) {
    if (!treeItem || typeof treeItem.getAttribute !== 'function') return '';
    try {
        const sourceId = String(treeItem.getAttribute('data-source-node-id') || '').trim();
        if (sourceId) return sourceId;
    } catch (_) { }
    try {
        return String(treeItem.getAttribute('data-node-id') || '').trim();
    } catch (_) {
        return '';
    }
}

function escapeTreeItemLookupId(id) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    try {
        return (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
            ? CSS.escape(raw)
            : raw.replace(/["\\]/g, '\\$&');
    } catch (_) {
        return raw;
    }
}

function queryTreeItemByLookupId(treeContainer, nodeId) {
    if (!treeContainer) return null;
    const escapedId = escapeTreeItemLookupId(nodeId);
    if (!escapedId) return null;

    try {
        const direct = treeContainer.querySelector(`.tree-item[data-node-id="${escapedId}"]`);
        if (direct) return direct;
    } catch (_) { }

    try {
        return treeContainer.querySelector(`.tree-item[data-source-node-id="${escapedId}"]`);
    } catch (_) {
        return null;
    }
}

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
                ? '标题 / URL / 域名 / 路径（空格=并且）'
                : 'Title / URL / domain / path (space = AND)';
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
            searchUiState.currentChangesTypeFilter = null;
            searchUiState.currentChangesTypeCounts = null;
            searchUiState.currentChangesExpandedDomainGroups = new Set();
            searchUiState.currentChangesDomainGroupHostFilters = new Map();
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
function updateSearchResultSelection(nextIndex, options = {}) {
    const { scrollIntoView = true } = options;
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
        if (scrollIntoView) {
            // 仅在面板内滚动，不影响页面滚动
            try {
                selectedEl.scrollIntoView({ block: 'nearest' });
            } catch (_) { }
        }
    }
    searchUiState.selectedIndex = clamped;
}

// ==================== 搜索结果渲染 ====================

function renderSearchUrlLink(url, options = {}) {
    const href = String(url || '').trim();
    if (!href) return '';

    const {
        text = href,
        className = 'search-result-url-link'
    } = options;

    const label = String(text || href).trim() || href;
    return `<a class="${escapeHtml(className)}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`;
}

function renderSearchMetaContent(item, metaText) {
    const text = String(metaText || '').trim();
    const itemUrl = String(item?.url || '').trim();
    if (item?.nodeType === 'bookmark' && itemUrl && (!text || text === itemUrl)) {
        return renderSearchUrlLink(itemUrl, { text: text || itemUrl });
    }
    return text ? escapeHtml(text) : '';
}

function buildSearchChangeBadgesHtml(item, options = {}) {
    const isZh = !!options.isZh;
    const parts = Array.isArray(item?.changeTypeParts) ? item.changeTypeParts : [];
    const badges = [];
    if (parts.includes('added') || item?.changeType === 'added') badges.push(`<span class="search-change-prefix added"${isZh ? ' title="新增"' : ' title="Added"'}>+</span>`);
    if (parts.includes('deleted') || item?.changeType === 'deleted') badges.push(`<span class="search-change-prefix deleted"${isZh ? ' title="删除"' : ' title="Deleted"'}>-</span>`);
    if (parts.includes('moved')) badges.push(`<span class="search-change-prefix moved"${isZh ? ' title="移动"' : ' title="Moved"'}>>></span>`);
    if (parts.includes('modified')) badges.push(`<span class="search-change-prefix modified"${isZh ? ' title="修改"' : ' title="Modified"'}>~</span>`);
    return badges.length ? `<span class="search-change-icons">${badges.join('')}</span>` : '';
}

function normalizeSearchDomainHostValue(host) {
    return String(host || '').trim().toLowerCase();
}

function getSearchDomainSubgroups(item) {
    return (Array.isArray(item?.domainSubgroups) ? item.domainSubgroups : [])
        .filter((subgroup) => subgroup && normalizeSearchDomainHostValue(subgroup.host));
}

function resolveSearchDomainSubgroupSelection(item, selectedHost) {
    const normalizedSelectedHost = normalizeSearchDomainHostValue(selectedHost);
    if (!normalizedSelectedHost) return '';

    const subgroups = getSearchDomainSubgroups(item);
    return subgroups.some((subgroup) => normalizeSearchDomainHostValue(subgroup.host) === normalizedSelectedHost)
        ? normalizedSelectedHost
        : '';
}

function renderSearchDomainGroupSelectorRow(item, groupIdRaw, options = {}) {
    const variant = options.variant === 'detail' ? 'detail' : 'main';
    const groupId = escapeHtml(String(groupIdRaw || ''));
    const rowClass = variant === 'detail' ? 'detail-domain-selector-row' : 'changes-domain-selector-row';
    const chipClass = variant === 'detail' ? 'detail-domain-selector-chip' : 'changes-domain-selector-chip';
    const selectedHost = resolveSearchDomainSubgroupSelection(item, options.selectedHost);
    const groupIndexAttr = Number.isFinite(Number(options.groupIndex))
        ? ` data-parent-index="${Number(options.groupIndex)}"`
        : '';
    const subdomainGroups = getSearchDomainSubgroups(item)
        .filter((subgroup) => !subgroup.isRootHost);

    if (!subdomainGroups.length) return '';

    const chipsHtml = subdomainGroups.map((subgroup) => {
        const host = normalizeSearchDomainHostValue(subgroup.host);
        const safeHost = escapeHtml(String(subgroup.host || '').trim());
        const isActive = host === selectedHost;
        return `
            <button type="button" class="${chipClass}${isActive ? ' active' : ''}" data-domain-group-id="${groupId}" data-domain-host="${escapeHtml(host)}" aria-pressed="${isActive ? 'true' : 'false'}" title="${safeHost}">
                ${safeHost}
            </button>
        `;
    }).join('');

    return `<div class="${rowClass}" data-domain-group-id="${groupId}"${groupIndexAttr}>${chipsHtml}</div>`;
}

function renderSearchDomainGroupChildren(item, groupIdRaw, options = {}) {
    const variant = options.variant === 'detail' ? 'detail' : 'main';
    const isZh = !!options.isZh;
    const groupId = escapeHtml(String(groupIdRaw || ''));
    const childRowClass = variant === 'detail' ? 'detail-domain-child-row' : 'changes-domain-child-row';
    const childMainClass = variant === 'detail' ? 'detail-domain-child-main' : 'changes-domain-child-main';
    const childTitleClass = variant === 'detail' ? 'detail-domain-child-title' : 'changes-domain-child-title';
    const childMetaClass = variant === 'detail' ? 'detail-domain-child-meta' : 'changes-domain-child-meta';
    const childHostClass = variant === 'detail' ? 'detail-domain-child-host' : 'changes-domain-child-host';

    const flatChildren = Array.isArray(item?.domainChildren) ? item.domainChildren : [];
    const selectedHost = resolveSearchDomainSubgroupSelection(item, options.selectedHost);
    const subgroups = Array.isArray(item?.domainSubgroups) && item.domainSubgroups.length > 0
        ? item.domainSubgroups
        : [{
            host: String(item?.domainKey || item?.title || '').trim(),
            isRootHost: true,
            bookmarkCount: flatChildren.length,
            items: flatChildren
        }];
    const visibleSubgroups = selectedHost
        ? subgroups.filter((subgroup) => normalizeSearchDomainHostValue(subgroup?.host) === selectedHost)
        : subgroups;
    const shouldShowHostBadge = !selectedHost && visibleSubgroups.filter((subgroup) => subgroup && subgroup.host).length > 1;

    return visibleSubgroups.map((subgroup) => {
        const subgroupItems = Array.isArray(subgroup?.items) ? subgroup.items : [];
        if (!subgroupItems.length) return '';

        return subgroupItems.map((child) => {
            const childIdRaw = String(child?.id || '').trim();
            if (!childIdRaw) return '';
            const childBadgesHtml = buildSearchChangeBadgesHtml(child, { isZh });
            const childTitle = escapeHtml(child?.title || (isZh ? '（无标题）' : '(Untitled)'));
            const childHost = String(child?.__dh || subgroup?.host || '').trim();
            const hostBadgeHtml = (shouldShowHostBadge && childHost)
                ? `<span class="${childHostClass}" title="${escapeHtml(childHost)}">${escapeHtml(childHost)}</span>`
                : '';
            return `
                <div class="${childRowClass}" data-domain-group-id="${groupId}" data-domain-child-id="${escapeHtml(childIdRaw)}">
                    <div class="${childMainClass}">
                        <div class="${childTitleClass}">
                            ${childBadgesHtml}
                            ${hostBadgeHtml}
                            <i class="fas fa-bookmark" style="color:#f59e0b; font-size:11px;"></i>
                            <span>${childTitle}</span>
                        </div>
                        ${child?.url ? `<div class="${childMetaClass}">${renderSearchUrlLink(child.url, { text: child.url })}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }).join('');
}

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

    const isCurrentChangesView = view === 'current-changes';
    const currentChangesTypeCounts = isCurrentChangesView
        ? (options.currentChangesTypeCounts || searchUiState.currentChangesTypeCounts || getSearchTypeCounts(searchUiState.results))
        : null;
    const currentChangesTypeFilter = isCurrentChangesView
        ? (options.currentChangesTypeFilter || resolveSearchTypeFilter(searchUiState.currentChangesTypeFilter, currentChangesTypeCounts))
        : null;

    if (isCurrentChangesView) {
        searchUiState.currentChangesTypeCounts = currentChangesTypeCounts;
        searchUiState.currentChangesTypeFilter = currentChangesTypeFilter;
        if (!(searchUiState.currentChangesExpandedDomainGroups instanceof Set)) {
            searchUiState.currentChangesExpandedDomainGroups = new Set();
        }
        if (!(searchUiState.currentChangesDomainGroupHostFilters instanceof Map)) {
            searchUiState.currentChangesDomainGroupHostFilters = new Map();
        }
        if (currentChangesTypeFilter !== 'domain') {
            searchUiState.currentChangesExpandedDomainGroups.clear();
            searchUiState.currentChangesDomainGroupHostFilters.clear();
        }
    }

    try {
        panel.dataset.panelType = 'results';
    } catch (_) { }

    if (!searchUiState.results.length) {
        const typeToggleHtml = isCurrentChangesView
            ? buildSearchTypeToggleHtml(currentChangesTypeCounts, currentChangesTypeFilter, { variant: 'main' })
            : '';
        const emptyText = options.emptyText || getSearchI18nText('searchNoResults', '没有找到匹配结果', 'No results');
        panel.innerHTML = `${typeToggleHtml}<div class="search-results-empty">${escapeHtml(emptyText)}</div>`;
        showSearchResultsPanel();
        return;
    }

    const isZh = currentLang === 'zh_CN';

    const rowsHtml = searchUiState.results.map((item, idx) => {
        if (isCurrentChangesView && item && item.nodeType === 'domain_group') {
            const groupIdRaw = String(item.id || `domain-group-${idx}`);
            const groupId = escapeHtml(groupIdRaw);
            const safeTitle = escapeHtml(item.title || (isZh ? '域名分组' : 'Domain group'));
            const metaText = item.meta ? escapeHtml(item.meta) : '';
            const isExpanded = searchUiState.currentChangesExpandedDomainGroups.has(groupIdRaw);
            const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
            const selectedHost = searchUiState.currentChangesDomainGroupHostFilters instanceof Map
                ? (searchUiState.currentChangesDomainGroupHostFilters.get(groupIdRaw) || '')
                : '';
            const childRowsHtml = isExpanded
                ? `${renderSearchDomainGroupSelectorRow(item, groupIdRaw, { variant: 'main', groupIndex: idx, selectedHost })}${renderSearchDomainGroupChildren(item, groupIdRaw, { variant: 'main', isZh, selectedHost })}`
                : '';

            return `
                <div class="search-result-item changes-domain-group-item ${isExpanded ? 'expanded' : ''}" role="option" data-index="${idx}" data-node-id="${escapeHtml(item.id)}" data-domain-group-id="${groupId}">
                    <div class="search-result-row">
                        <div class="search-result-main">
                            <div class="search-result-title">
                                <span class="search-result-index">${idx + 1}</span>
                                <span class="changes-domain-group-chevron"><i class="fas ${chevronClass}"></i></span>
                                <i class="fas fa-globe" style="color:#0ea5e9; font-size:12px;"></i>
                                <span>${safeTitle}</span>
                            </div>
                            ${metaText ? `<div class="search-result-meta">${metaText}</div>` : ''}
                        </div>
                    </div>
                </div>
                ${childRowsHtml}
            `;
        }

        const safeTitle = escapeHtml(item.title || (currentLang === 'zh_CN' ? '（无标题）' : '(Untitled)'));

        // Meta Logic: Path or URL
        // If meta is provided (e.g. "Added on 2024..."), use it.
        // If not, and it's a bookmark, try to show URL.
        let metaText = item.meta ? String(item.meta) : '';
        if (!metaText && item.nodeType === 'bookmark' && item.url) {
            metaText = String(item.url);
        }
        const metaHtml = renderSearchMetaContent(item, metaText);

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
        } else if (item.nodeType === 'domain_group') {
            // 域名分组使用地球图标
            iconHtml = `<div class="search-result-icon-box-inline" style="display:flex; align-items:center; justify-content:center; width:20px; height:20px; flex-shrink:0;">
                <i class="fas fa-globe" style="color:#0ea5e9; font-size:14px;"></i>
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
                        ${metaHtml ? `<div class="search-result-meta-row">${metaHtml}</div>` : ''}
                    </div>
                </div>
        `;
    }).join('');

    const typeToggleHtml = isCurrentChangesView
        ? buildSearchTypeToggleHtml(currentChangesTypeCounts, currentChangesTypeFilter, { variant: 'main' })
        : '';
    panel.innerHTML = `${typeToggleHtml}${rowsHtml}`;
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
        itemById: new Map(),
        changedItems: [],
        changedItemById: new Map()
    };
}

/**
 * 获取当前变化搜索签名（用于缓存失效判断）
 */
function getCurrentChangesSearchSignature() {
    const version = lastTreeSnapshotVersion || lastTreeFingerprint || '';
    const changeMap = treeChangeMap instanceof Map ? treeChangeMap : null;
    const size = changeMap ? changeMap.size : 0;
    return [
        String(version),
        String(size),
        getSearchChangeMapDigest(changeMap)
    ].join('|');
}

function getHistoryDetailSearchSignature(options = {}) {
    const { changeMap, currentTree, oldTree, recordTime } = options;
    return [
        String(recordTime || ''),
        getSearchChangeMapDigest(changeMap),
        getSearchTreeDigest(currentTree),
        getSearchTreeDigest(oldTree)
    ].join('|');
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

const SEARCH_MULTI_LEVEL_DOMAIN_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
    'co.kr', 'ne.kr', 'or.kr', 'ac.kr', 'go.kr',
    'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in'
]);

function extractSearchHostFromUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(String(url));
        const host = String(parsed.hostname || '').trim().toLowerCase();
        return host ? host.replace(/\.$/, '') : '';
    } catch (_) {
        return '';
    }
}

function getSearchRegistrableDomain(host) {
    const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
    if (!h) return '';
    if (h === 'localhost') return h;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
    if (/^[0-9a-f:]+$/i.test(h) && h.includes(':')) return h;

    const parts = h.split('.').filter(Boolean);
    if (parts.length <= 2) return h;

    const last2 = parts.slice(-2).join('.');
    if (SEARCH_MULTI_LEVEL_DOMAIN_SUFFIXES.has(last2)) {
        return parts.slice(-3).join('.');
    }
    return last2;
}

function getSearchTypeCounts(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const domainSource = Array.isArray(options.domainItems) ? options.domainItems : null;
    let bookmarkCount = 0;
    let folderCount = 0;
    let domainCount = 0;

    for (const item of list) {
        if (!item) continue;
        if (item.nodeType === 'bookmark') {
            bookmarkCount += 1;
            continue;
        }
        if (item.nodeType === 'folder') {
            folderCount += 1;
        }
    }

    const domainList = domainSource || list;
    for (const item of domainList) {
        if (item && item.nodeType === 'bookmark' && item.__dh) {
            domainCount += 1;
        }
    }

    return { bookmarkCount, folderCount, domainCount };
}

function resolveSearchTypeFilter(typeFilter, counts) {
    const requested = String(typeFilter || '').trim().toLowerCase();
    const { bookmarkCount = 0, folderCount = 0, domainCount = 0 } = counts || {};

    if (requested === 'bookmark' && bookmarkCount > 0) return 'bookmark';
    if (requested === 'folder' && folderCount > 0) return 'folder';
    if (requested === 'domain' && domainCount > 0) return 'domain';
    return null;
}

function buildSearchDomainGroupedResults(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];

    const isZh = typeof currentLang !== 'undefined' && currentLang === 'zh_CN';
    const groupMap = new Map();
    let firstOrderSeed = 0;

    for (const item of list) {
        if (!item || item.nodeType !== 'bookmark') continue;

        const host = String(item.__dh || extractSearchHostFromUrl(item.url || '') || '').trim().toLowerCase();
        if (!host) continue;
        const root = String(item.__dr || getSearchRegistrableDomain(host) || host).trim().toLowerCase();
        const key = root || host;
        if (!key) continue;

        let group = groupMap.get(key);
        if (!group) {
            group = {
                key,
                items: [],
                hostSet: new Set(),
                subgroups: new Map(),
                firstOrder: firstOrderSeed++
            };
            groupMap.set(key, group);
        }

        group.items.push(item);
        group.hostSet.add(host);

        let subgroup = group.subgroups.get(host);
        if (!subgroup) {
            subgroup = {
                key: host,
                host,
                isRootHost: host === key,
                items: [],
                firstOrder: group.subgroups.size
            };
            group.subgroups.set(host, subgroup);
        }
        subgroup.items.push(item);
    }

    const groups = Array.from(groupMap.values());
    groups.sort((a, b) => {
        return (a.firstOrder || 0) - (b.firstOrder || 0);
    });

    return groups.map((group, idx) => {
        const primary = group.items[0] || {};
        const bookmarkCount = group.items.length;
        const hostCount = group.hostSet.size;
        const domainSubgroups = Array.from(group.subgroups.values())
            .sort((a, b) => (a.firstOrder || 0) - (b.firstOrder || 0))
            .map((subgroup) => ({
                host: subgroup.host,
                isRootHost: !!subgroup.isRootHost,
                bookmarkCount: subgroup.items.length,
                items: subgroup.items
            }));
        const subdomainCount = domainSubgroups.filter((subgroup) => !subgroup.isRootHost).length;
        const meta = isZh
            ? `${bookmarkCount} 个书签${subdomainCount > 0 ? `，${subdomainCount} 个子域名` : ''}`
            : `${bookmarkCount} bookmarks${subdomainCount > 0 ? `, ${subdomainCount} subdomains` : ''}`;

        return {
            id: primary.id || `domain-group-${group.key}-${idx}`,
            title: group.key,
            meta,
            url: '',
            nodeType: 'domain_group',
            type: 'domain-group',
            changeType: primary.changeType || '',
            changeTypeParts: [],
            idPathCandidates: Array.isArray(primary.idPathCandidates) ? primary.idPathCandidates : [],
            domainChildren: group.items,
            domainSubgroups,
            domainKey: group.key,
            domainBookmarkCount: bookmarkCount,
            domainHostCount: hostCount
        };
    });
}

function filterSearchItemsByType(items, typeFilter, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const domainMatchedItems = Array.isArray(options.domainMatchedItems) ? options.domainMatchedItems : null;
    const counts = getSearchTypeCounts(list, { domainItems: domainMatchedItems });
    const activeFilter = resolveSearchTypeFilter(typeFilter, counts);
    const domainGrouped = options && options.domainGrouped !== false;

    let filtered = list;
    if (activeFilter === 'bookmark') {
        filtered = list.filter(item => item && item.nodeType === 'bookmark');
    } else if (activeFilter === 'folder') {
        filtered = list.filter(item => item && item.nodeType === 'folder');
    } else if (activeFilter === 'domain') {
        const domainItems = Array.isArray(domainMatchedItems)
            ? domainMatchedItems.filter(item => item && item.nodeType === 'bookmark' && !!item.__dh)
            : list.filter(item => item && item.nodeType === 'bookmark' && !!item.__dh);
        filtered = domainGrouped ? buildSearchDomainGroupedResults(domainItems) : domainItems;
    }

    return { filtered, counts, activeFilter };
}

function buildSearchTypeToggleHtml(typeCounts, activeFilter, options = {}) {
    const counts = typeCounts || {};
    const isDetail = options.variant === 'detail';
    const isZh = typeof currentLang !== 'undefined' && currentLang === 'zh_CN';
    const rowClass = isDetail ? 'detail-search-type-toggle' : 'changes-search-type-toggle';
    const btnClass = isDetail ? 'detail-search-type-btn' : 'changes-search-type-btn';

    const makeBtn = (type, label, icon, count, color) => {
        if (!(Number.isFinite(Number(count)) && Number(count) > 0)) return '';
        const active = activeFilter === type ? 'active' : '';
        return `<button type="button" class="${btnClass} ${active}" data-type="${type}" data-color="${color}">
            <i class="fas ${icon}"></i>
            <span>${escapeHtml(label)}</span>
            <b>${count}</b>
        </button>`;
    };

    const bookmarkLabel = isZh ? '书签' : 'Bookmark';
    const folderLabel = isZh ? '文件夹' : 'Folder';
    const domainLabel = isZh ? '域名' : 'Domain';

    const bookmarkBtn = makeBtn('bookmark', bookmarkLabel, 'fa-bookmark', counts.bookmarkCount, '#f59e0b');
    const folderBtn = makeBtn('folder', folderLabel, 'fa-folder', counts.folderCount, '#2563eb');
    const domainBtn = makeBtn('domain', domainLabel, 'fa-globe', counts.domainCount, '#0ea5e9');

    if (!bookmarkBtn && !folderBtn && !domainBtn) return '';

    return `<div class="${rowClass}">${bookmarkBtn}${folderBtn}${domainBtn}</div>`;
}

function createSearchSignatureHasher() {
    let hash = 2166136261 >>> 0;

    return {
        push(value) {
            const text = String(value == null ? '' : value);
            for (let i = 0; i < text.length; i += 1) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 16777619) >>> 0;
            }
            hash ^= 31;
            hash = Math.imul(hash, 16777619) >>> 0;
        },
        digest() {
            return hash.toString(36);
        }
    };
}

function getSearchTreeDigest(tree) {
    if (!Array.isArray(tree) || !tree[0]) return '0:0';

    const hasher = createSearchSignatureHasher();
    const stack = [tree[0]];
    let nodeCount = 0;

    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;

        nodeCount += 1;
        hasher.push(node.id);
        hasher.push(node.title);
        hasher.push(node.url);
        hasher.push(Array.isArray(node.children) ? node.children.length : 0);

        if (Array.isArray(node.children) && node.children.length > 0) {
            for (let i = node.children.length - 1; i >= 0; i -= 1) {
                stack.push(node.children[i]);
            }
        }
    }

    return `${nodeCount}:${hasher.digest()}`;
}

function getSearchChangeMapDigest(changeMap) {
    if (!(changeMap instanceof Map) || changeMap.size === 0) return '0:0';

    const hasher = createSearchSignatureHasher();
    const ids = Array.from(changeMap.keys()).map(v => String(v)).sort();
    hasher.push(ids.length);

    for (const id of ids) {
        const change = changeMap.get(id) || {};
        const moved = change && typeof change.moved === 'object' ? change.moved : null;
        const modified = change && typeof change.modified === 'object' ? change.modified : null;

        hasher.push(id);
        hasher.push(change.type || '');
        hasher.push(change.parentId || '');
        hasher.push(change.oldParentId || '');
        hasher.push(moved?.oldPath || '');
        hasher.push(moved?.newPath || '');
        hasher.push(modified?.oldTitle || '');
        hasher.push(modified?.newTitle || '');
        hasher.push(modified?.oldUrl || '');
        hasher.push(modified?.newUrl || '');
    }

    return `${ids.length}:${hasher.digest()}`;
}

function toSearchSlashFolders(pathText) {
    if (!pathText) return '';
    try {
        return typeof breadcrumbToSlashFolders === 'function' ? String(breadcrumbToSlashFolders(pathText) || '') : '';
    } catch (_) {
        return '';
    }
}

function toSearchSlashFull(pathText) {
    if (!pathText) return '';
    try {
        return typeof breadcrumbToSlashFull === 'function' ? String(breadcrumbToSlashFull(pathText) || '') : '';
    } catch (_) {
        return '';
    }
}

function collectDescendantIdsUnderFolders(tree, folderIdSet) {
    const descendants = new Set();
    if (!tree || !tree[0] || !(folderIdSet instanceof Set) || folderIdSet.size === 0) return descendants;

    try {
        const dfs = (node, insideChangedFolder = false) => {
            if (!node || node.id == null) return;
            const id = String(node.id);
            const isChangedFolder = folderIdSet.has(id);
            const nextInside = insideChangedFolder || isChangedFolder;

            if (insideChangedFolder && id) {
                descendants.add(id);
            }

            if (Array.isArray(node.children) && node.children.length > 0) {
                for (const child of node.children) dfs(child, nextInside);
            }
        };
        dfs(tree[0], false);
    } catch (_) { }

    return descendants;
}

function collectDescendantIdsUnderFoldersFromTrees(trees, folderIdSet) {
    const merged = new Set();
    if (!Array.isArray(trees) || !(folderIdSet instanceof Set) || folderIdSet.size === 0) return merged;

    for (const tree of trees) {
        const descendants = collectDescendantIdsUnderFolders(tree, folderIdSet);
        if (!(descendants instanceof Set) || descendants.size === 0) continue;
        descendants.forEach((idRaw) => {
            const id = String(idRaw || '').trim();
            if (id) merged.add(id);
        });
    }

    return merged;
}

function collectAncestorIdsFromParentIndexes(targetIdSet, parentIndexes) {
    const ancestors = new Set();
    if (!(targetIdSet instanceof Set) || targetIdSet.size === 0 || !Array.isArray(parentIndexes)) return ancestors;

    for (const idRaw of targetIdSet) {
        const id = String(idRaw || '').trim();
        if (!id) continue;

        for (const parentIndex of parentIndexes) {
            if (!(parentIndex instanceof Map)) continue;
            let currentId = id;
            let guard = 0;
            while (guard++ < 2048) {
                const parentRaw = parentIndex.get(currentId);
                const parentId = parentRaw != null ? String(parentRaw).trim() : '';
                if (!parentId || parentId === currentId) break;
                ancestors.add(parentId);
                currentId = parentId;
            }
        }
    }

    return ancestors;
}

function collectIdsFromCollectionNodes(nodes, outSet) {
    if (!Array.isArray(nodes) || !(outSet instanceof Set)) return;
    const stack = [...nodes];
    let guard = 0;
    while (stack.length > 0 && guard++ < 200000) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        const id = String(node.id || '').trim();
        if (id) outSet.add(id);
        if (Array.isArray(node.children) && node.children.length > 0) {
            for (let i = node.children.length - 1; i >= 0; i -= 1) {
                stack.push(node.children[i]);
            }
        }
    }
}

function buildCurrentChangesCollectionScopedIdSet(changeMap) {
    const outSet = new Set();
    try {
        if (!(changeMap instanceof Map)) return outSet;
        if (!Array.isArray(cachedCurrentTree) || !cachedCurrentTree[0]) return outSet;
        if (typeof buildCurrentChangesExportTreeManual !== 'function') return outSet;

        let treeToRender = cachedCurrentTree;
        try {
            if (Array.isArray(cachedOldTree) && cachedOldTree[0] && typeof rebuildTreeWithDeleted === 'function' && typeof hasDeletedChangeInMap === 'function') {
                if (hasDeletedChangeInMap(changeMap)) {
                    treeToRender = rebuildTreeWithDeleted(cachedOldTree, cachedCurrentTree, changeMap);
                }
            }
        } catch (_) {
            treeToRender = cachedCurrentTree;
        }

        const lang = currentLang === 'zh_CN' ? 'zh_CN' : 'en';
        const collectionChildren = buildCurrentChangesExportTreeManual(treeToRender, changeMap, {
            mode: 'collection',
            lang,
            stats: {}
        });
        collectIdsFromCollectionNodes(collectionChildren, outSet);
    } catch (_) { }

    return outSet;
}

function buildCollectionScopedIdSetFromTree(treeToRender, changeMap) {
    const outSet = new Set();
    try {
        if (!(changeMap instanceof Map)) return outSet;
        if (!Array.isArray(treeToRender) || !treeToRender[0]) return outSet;
        if (typeof buildCurrentChangesExportTreeManual !== 'function') return outSet;

        const lang = currentLang === 'zh_CN' ? 'zh_CN' : 'en';
        const collectionChildren = buildCurrentChangesExportTreeManual(treeToRender, changeMap, {
            mode: 'collection',
            lang,
            stats: {}
        });
        collectIdsFromCollectionNodes(collectionChildren, outSet);
    } catch (_) { }

    return outSet;
}

function getCurrentChangesSearchScopeMode() {
    try {
        if (typeof __getChangesPreviewMode === 'function') {
            const mode = String(__getChangesPreviewMode() || '').toLowerCase();
            if (mode === 'compact' || mode === 'collection' || mode === 'detailed') return mode;
        }
    } catch (_) { }
    return 'detailed';
}

function isTreeItemVisuallyVisibleInRoot(itemEl, rootEl) {
    if (!itemEl) return false;
    try {
        if (itemEl.getClientRects().length === 0) return false;
        let cursor = itemEl;
        while (cursor && cursor !== rootEl && cursor !== document.body) {
            const style = window.getComputedStyle(cursor);
            if (!style) break;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            cursor = cursor.parentElement;
        }
    } catch (_) {
        return true;
    }
    return true;
}

function getCurrentChangesVisibleNodeIdSet(options = {}) {
    const visibleOnly = options && options.visibleOnly === true;
    try {
        const root = document.getElementById('changesTreePreviewInline');
        if (!root) return null;
        const nodes = root.querySelectorAll('.tree-item[data-node-id]');
        if (!nodes || nodes.length === 0) return null;
        const idSet = new Set();
        nodes.forEach((nodeEl) => {
            if (visibleOnly && !isTreeItemVisuallyVisibleInRoot(nodeEl, root)) return;
            const id = getSearchTreeItemLookupId(nodeEl);
            if (id) idSet.add(id);
        });
        return idSet.size > 0 ? idSet : null;
    } catch (_) {
        return null;
    }
}

function buildCurrentChangesDomOrderMap(rootEl, options = {}) {
    const visibleOnly = options && options.visibleOnly === true;
    const orderMap = new Map();
    if (!rootEl) return orderMap;

    try {
        const nodes = rootEl.querySelectorAll('.tree-item[data-node-id]');
        let order = 0;
        nodes.forEach((nodeEl) => {
            if (visibleOnly && !isTreeItemVisuallyVisibleInRoot(nodeEl, rootEl)) return;
            const id = getSearchTreeItemLookupId(nodeEl);
            if (!id || orderMap.has(id)) return;
            orderMap.set(id, order++);
        });
    } catch (_) { }

    return orderMap;
}

function buildCurrentChangesTreeOrderMapFromRoot(rootNode) {
    const orderMap = new Map();
    if (!rootNode || typeof rootNode !== 'object') return orderMap;

    try {
        const stack = [rootNode];
        let order = 0;
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || node.id == null) continue;

            const id = String(node.id || '').trim();
            if (id && !orderMap.has(id)) {
                orderMap.set(id, order++);
            }

            if (Array.isArray(node.children) && node.children.length > 0) {
                for (let i = node.children.length - 1; i >= 0; i -= 1) {
                    stack.push(node.children[i]);
                }
            }
        }
    } catch (_) { }

    return orderMap;
}

function buildCurrentChangesNodeIdSetFromRoot(rootNode) {
    const idSet = new Set();
    if (!rootNode || typeof rootNode !== 'object') return idSet;

    try {
        const stack = [rootNode];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || node.id == null) continue;

            const id = String(node.id || '').trim();
            if (id) idSet.add(id);

            if (Array.isArray(node.children) && node.children.length > 0) {
                for (let i = node.children.length - 1; i >= 0; i -= 1) {
                    stack.push(node.children[i]);
                }
            }
        }
    } catch (_) { }

    return idSet;
}

function getCurrentChangesSearchRenderTreeRootFromData() {
    try {
        if (!Array.isArray(cachedCurrentTree) || !cachedCurrentTree[0]) return null;

        let treeToRender = cachedCurrentTree;
        try {
            const changeMap = treeChangeMap instanceof Map ? treeChangeMap : null;
            if (changeMap && changeMap.size > 0 &&
                Array.isArray(cachedOldTree) && cachedOldTree[0] &&
                typeof rebuildTreeWithDeleted === 'function' &&
                typeof hasDeletedChangeInMap === 'function' &&
                hasDeletedChangeInMap(changeMap)) {
                treeToRender = rebuildTreeWithDeleted(cachedOldTree, cachedCurrentTree, changeMap);
            }
        } catch (_) {
            treeToRender = cachedCurrentTree;
        }

        return (Array.isArray(treeToRender) && treeToRender[0]) ? treeToRender[0] : null;
    } catch (_) {
        return null;
    }
}

function getCurrentChangesPreviewTreeOrderMap(previewRootEl) {
    let rootNode = null;
    try {
        rootNode = window.__changesPreviewTreeRoot || null;
    } catch (_) {
        rootNode = null;
    }
    if (!rootNode) {
        rootNode = getCurrentChangesSearchRenderTreeRootFromData();
    }

    const treeOrderMap = buildCurrentChangesTreeOrderMapFromRoot(rootNode);
    if (treeOrderMap.size > 0) return treeOrderMap;

    return buildCurrentChangesDomOrderMap(previewRootEl, { visibleOnly: false });
}

function getCurrentChangesPreviewRenderableIdSet() {
    let previewIndex = null;
    try {
        if (window.__changesPreviewTreeIndex instanceof Map) {
            previewIndex = window.__changesPreviewTreeIndex;
        }
    } catch (_) {
        previewIndex = null;
    }

    if (previewIndex instanceof Map && previewIndex.size > 0) {
        const idSet = new Set();
        try {
            previewIndex.forEach((_, idRaw) => {
                const id = String(idRaw || '').trim();
                if (id) idSet.add(id);
            });
        } catch (_) { }
        if (idSet.size > 0) return idSet;
    }

    // DOM 索引未就绪时，回退到“数据树”索引，避免受懒加载影响。
    const dataRoot = getCurrentChangesSearchRenderTreeRootFromData();
    const dataSet = buildCurrentChangesNodeIdSetFromRoot(dataRoot);
    return dataSet.size > 0 ? dataSet : null;
}

function buildSearchItemsFromTree(sourceTree, changeMap, changedItemById, options = {}) {
    const items = [];
    const itemById = new Map();
    const changedContextIdSet = options.changedContextIdSet instanceof Set ? options.changedContextIdSet : null;

    try {
        const tree = sourceTree;
        if (!tree || !tree[0]) return { items, itemById };

        const pathStack = [];
        const idStack = [];
        const dfs = (node) => {
            if (!node || typeof node.id === 'undefined' || node.id === null) return;

            const title = typeof node.title === 'string' ? node.title : '';
            if (title) pathStack.push(title);

            const id = String(node.id);
            idStack.push(id);
            const url = String(node.url || '').trim();
            const namedPath = pathStack.join(' > ');
            const shouldIndex = !!(title || url || namedPath);

            if (shouldIndex) {
                const fromChanged = (changedItemById instanceof Map) ? (changedItemById.get(id) || null) : null;
                const changedRaw = (changeMap instanceof Map) ? (changeMap.get(id) || {}) : {};
                const fallbackChangeType = (changedRaw && typeof changedRaw.type === 'string') ? changedRaw.type : '';
                const changeType = (fromChanged && typeof fromChanged.changeType === 'string' && fromChanged.changeType)
                    ? fromChanged.changeType
                    : fallbackChangeType;
                const changeTypeParts = changeType ? changeType.split('+') : [];

                const newNamedPath = (fromChanged && fromChanged.newNamedPath)
                    ? String(fromChanged.newNamedPath)
                    : namedPath;
                const oldNamedPath = (fromChanged && fromChanged.oldNamedPath)
                    ? String(fromChanged.oldNamedPath)
                    : '';

                const newFolderSlash = newNamedPath ? toSearchSlashFolders(newNamedPath) : '';
                const oldFolderSlash = oldNamedPath ? toSearchSlashFolders(oldNamedPath) : '';
                const newPathSlash = newNamedPath ? toSearchSlashFull(newNamedPath) : '';
                const oldPathSlash = oldNamedPath ? toSearchSlashFull(oldNamedPath) : '';

                const domainHost = extractSearchHostFromUrl(url);
                const domainRoot = getSearchRegistrableDomain(domainHost);
                const isChanged = (changeMap instanceof Map && changeMap.has(id)) || !!(fromChanged && fromChanged.changeType);
                const isChangedContext = !isChanged && !!(changedContextIdSet && changedContextIdSet.has(id));
                const nodeType = url ? 'bookmark' : 'folder';

                const item = {
                    id,
                    title,
                    url,
                    nodeType,
                    changeType,
                    changeTypeParts,
                    idPathCandidates: [idStack.slice()],
                    newNamedPath,
                    oldNamedPath,
                    newFolderSlash,
                    oldFolderSlash,
                    newPathSlash,
                    oldPathSlash,
                    domainHost,
                    domainRoot,
                    __t: title.toLowerCase(),
                    __u: url.toLowerCase(),
                    __pn: (newNamedPath || '').toLowerCase(),
                    __po: (oldNamedPath || '').toLowerCase(),
                    __sn: (newPathSlash || newFolderSlash || '').toLowerCase(),
                    __so: (oldPathSlash || oldFolderSlash || '').toLowerCase(),
                    __dh: (domainHost || '').toLowerCase(),
                    __dr: (domainRoot || '').toLowerCase(),
                    __changed: isChanged ? 1 : 0,
                    __changed_context: isChangedContext ? 1 : 0
                };

                items.push(item);
                itemById.set(id, item);
            }

            if (Array.isArray(node.children) && node.children.length) {
                for (const child of node.children) dfs(child);
            }

            if (title) pathStack.pop();
            idStack.pop();
        };

        dfs(tree[0]);
    } catch (_) { }

    return { items, itemById };
}

function buildAllCurrentTreeSearchItems(changeMap, changedItemById, options = {}) {
    return buildSearchItemsFromTree(cachedCurrentTree, changeMap, changedItemById, options);
}

function getCurrentChangesScopedSearchMeta(db) {
    const mode = getCurrentChangesSearchScopeMode();
    const allItems = Array.isArray(db?.items) ? db.items : [];
    const emptyMeta = { items: [], orderMap: new Map(), mode };
    if (!allItems.length) return emptyMeta;

    const previewRoot = document.getElementById('changesTreePreviewInline');
    const visibleOrderMap = buildCurrentChangesDomOrderMap(previewRoot, { visibleOnly: true });
    const visibleScopedIdSet = visibleOrderMap.size > 0 ? new Set(visibleOrderMap.keys()) : null;
    const dataOrderMap = getCurrentChangesPreviewTreeOrderMap(previewRoot);

    if (mode === 'collection') {
        // 集合模式索引源：collectionScopedIdSet（来自 collection 数据树），不依赖懒加载 DOM 可见性。
        const collectionScopedIdSet = db && db.collectionScopedIdSet instanceof Set ? db.collectionScopedIdSet : null;
        if (collectionScopedIdSet && collectionScopedIdSet.size > 0) {
            const scopedItems = allItems.filter(item => item && collectionScopedIdSet.has(String(item.id || '')));
            if (scopedItems.length > 0) {
                return { items: scopedItems, orderMap: dataOrderMap, mode };
            }
        }

        // 兜底：可见项（防止极端情况下 collection 索引构建失败）
        if (visibleScopedIdSet && visibleScopedIdSet.size > 0) {
            const visibleItems = allItems.filter(item => item && visibleScopedIdSet.has(String(item.id || '')));
            if (visibleItems.length > 0) {
                return { items: visibleItems, orderMap: visibleOrderMap, mode };
            }
        }
        return emptyMeta;
    }

    if (mode === 'compact') {
        // 简略模式索引源：compactScopedIdSet（变化节点 + 上下文 + 祖先），不依赖懒加载 DOM 可见性。
        const compactScopedIdSet = db && db.compactScopedIdSet instanceof Set ? db.compactScopedIdSet : null;
        if (compactScopedIdSet && compactScopedIdSet.size > 0) {
            const scopedItems = allItems.filter(item => item && compactScopedIdSet.has(String(item.id || '')));
            if (scopedItems.length > 0) {
                return { items: scopedItems, orderMap: dataOrderMap, mode };
            }
        }

        // 兜底：变化项/上下文
        const compactFallback = allItems.filter(item => item && (item.__changed || item.__changed_context));
        if (compactFallback.length > 0) {
            return { items: compactFallback, orderMap: dataOrderMap, mode };
        }
        return emptyMeta;
    }

    if (mode === 'detailed') {
        // 详细模式索引源：renderableIdSet（优先预览索引，缺失时回退数据树索引）。
        const renderableIdSet = getCurrentChangesPreviewRenderableIdSet();
        if (!(renderableIdSet && renderableIdSet.size > 0)) {
            return emptyMeta;
        }
        const scopedItems = allItems.filter(item => item && renderableIdSet.has(String(item.id || '')));
        return { items: scopedItems, orderMap: dataOrderMap, mode };
    }

    // 兜底：变化节点 + 变化上下文
    const fallbackOrderMap = visibleOrderMap.size > 0
        ? visibleOrderMap
        : getCurrentChangesPreviewTreeOrderMap(previewRoot);
    const scoped = allItems.filter(item => item && (item.__changed || item.__changed_context));
    if (scoped.length > 0) return { items: scoped, orderMap: fallbackOrderMap, mode };

    if (Array.isArray(db?.changedItems) && db.changedItems.length > 0) {
        return { items: db.changedItems, orderMap: fallbackOrderMap, mode };
    }

    return {
        items: allItems.filter(item => item && item.__changed),
        orderMap: fallbackOrderMap,
        mode
    };
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
    const currentParentIndex = buildNodeParentIndexForHistorySearch(cachedCurrentTree);
    const oldParentIndex = buildNodeParentIndexForHistorySearch(cachedOldTree);

    const changedItems = [];
    const changedItemById = new Map();

    for (const id of ids) {
        const change = changeMap ? (changeMap.get(id) || {}) : {};
        const changeType = typeof change.type === 'string' ? change.type : '';
        const changeTypeParts = changeType ? changeType.split('+') : [];

        const cur = currentInfo.get(id) || null;
        const old = oldInfo.get(id) || null;
        const title = (cur?.title || old?.title || '').trim();
        const url = (cur?.url || old?.url || '').trim();
        const nodeType = url ? 'bookmark' : 'folder';
        const currentIdPath = buildNodeIdPathFromParentIndex(id, currentParentIndex);
        const oldIdPath = buildNodeIdPathFromParentIndex(id, oldParentIndex);
        const idPathCandidates = mergeHistoryDetailIdPathCandidates(currentIdPath, oldIdPath);

        const newNamedPath = (change.moved && change.moved.newPath) ? String(change.moved.newPath) : (cur?.namedPath || '');
        const oldNamedPath = (change.moved && change.moved.oldPath) ? String(change.moved.oldPath) : (old?.namedPath || '');

        const newFolderSlash = newNamedPath ? toSearchSlashFolders(newNamedPath) : '';
        const oldFolderSlash = oldNamedPath ? toSearchSlashFolders(oldNamedPath) : '';

        const newPathSlash = newNamedPath ? toSearchSlashFull(newNamedPath) : '';
        const oldPathSlash = oldNamedPath ? toSearchSlashFull(oldNamedPath) : '';

        const titleLower = title.toLowerCase();
        const urlLower = url.toLowerCase();
        const newPathLower = (newNamedPath || '').toLowerCase();
        const oldPathLower = (oldNamedPath || '').toLowerCase();
        const newSlashLower = (newPathSlash || newFolderSlash || '').toLowerCase();
        const oldSlashLower = (oldPathSlash || oldFolderSlash || '').toLowerCase();
        const domainHost = extractSearchHostFromUrl(url);
        const domainRoot = getSearchRegistrableDomain(domainHost);

        const item = {
            id,
            title,
            url,
            nodeType,
            changeType,
            changeTypeParts,
            idPathCandidates,
            newNamedPath,
            oldNamedPath,
            newFolderSlash,
            oldFolderSlash,
            newPathSlash,
            oldPathSlash,
            domainHost,
            domainRoot,
            __t: titleLower,
            __u: urlLower,
            __pn: newPathLower,
            __po: oldPathLower,
            __sn: newSlashLower,
            __so: oldSlashLower,
            __dh: (domainHost || '').toLowerCase(),
            __dr: (domainRoot || '').toLowerCase(),
            __changed: 1
        };

        changedItems.push(item);
        changedItemById.set(id, item);
    }

    const changedFolderIdSet = new Set();
    for (const changedItem of changedItems) {
        if (changedItem && changedItem.nodeType === 'folder') {
            const folderId = String(changedItem.id || '').trim();
            if (folderId) changedFolderIdSet.add(folderId);
        }
    }
    const changedContextOldIdSet = collectDescendantIdsUnderFolders(cachedOldTree, changedFolderIdSet);
    const changedContextIdSet = collectDescendantIdsUnderFoldersFromTrees([cachedCurrentTree, cachedOldTree], changedFolderIdSet);
    const changedAncestorIdSet = collectAncestorIdsFromParentIndexes(idSet, [currentParentIndex, oldParentIndex]);

    const { items, itemById } = buildAllCurrentTreeSearchItems(changeMap, changedItemById, { changedContextIdSet });

    const oldOnlyContextIds = [];
    changedContextOldIdSet.forEach((idRaw) => {
        const id = String(idRaw || '').trim();
        if (!id || itemById.has(id)) return;
        oldOnlyContextIds.push(id);
    });
    if (oldOnlyContextIds.length > 0) {
        const oldOnlyIdSet = new Set(oldOnlyContextIds);
        const oldContextInfo = collectNodeInfoForIds(cachedOldTree, oldOnlyIdSet);
        const currentContextInfo = collectNodeInfoForIds(cachedCurrentTree, oldOnlyIdSet);

        for (const id of oldOnlyContextIds) {
            const cur = currentContextInfo.get(id) || null;
            const old = oldContextInfo.get(id) || null;
            if (!cur && !old) continue;
            if (itemById.has(id)) continue;

            const isChanged = (changeMap instanceof Map && changeMap.has(id)) || changedItemById.has(id);
            if (isChanged) continue;

            const title = (cur?.title || old?.title || '').trim();
            const url = (cur?.url || old?.url || '').trim();
            const newNamedPath = cur?.namedPath || '';
            const oldNamedPath = old?.namedPath || '';
            const newFolderSlash = newNamedPath ? toSearchSlashFolders(newNamedPath) : '';
            const oldFolderSlash = oldNamedPath ? toSearchSlashFolders(oldNamedPath) : '';
            const newPathSlash = newNamedPath ? toSearchSlashFull(newNamedPath) : '';
            const oldPathSlash = oldNamedPath ? toSearchSlashFull(oldNamedPath) : '';
            const domainHost = extractSearchHostFromUrl(url);
            const domainRoot = getSearchRegistrableDomain(domainHost);
            const currentIdPath = buildNodeIdPathFromParentIndex(id, currentParentIndex);
            const oldIdPath = buildNodeIdPathFromParentIndex(id, oldParentIndex);
            const idPathCandidates = mergeHistoryDetailIdPathCandidates(currentIdPath, oldIdPath);
            const nodeType = url ? 'bookmark' : 'folder';
            const shouldIndex = !!(title || url || newNamedPath || oldNamedPath);
            if (!shouldIndex) continue;

            const contextItem = {
                id,
                title,
                url,
                nodeType,
                changeType: '',
                changeTypeParts: [],
                idPathCandidates,
                newNamedPath,
                oldNamedPath,
                newFolderSlash,
                oldFolderSlash,
                newPathSlash,
                oldPathSlash,
                domainHost,
                domainRoot,
                __t: title.toLowerCase(),
                __u: url.toLowerCase(),
                __pn: (newNamedPath || '').toLowerCase(),
                __po: (oldNamedPath || '').toLowerCase(),
                __sn: (newPathSlash || newFolderSlash || '').toLowerCase(),
                __so: (oldPathSlash || oldFolderSlash || '').toLowerCase(),
                __dh: (domainHost || '').toLowerCase(),
                __dr: (domainRoot || '').toLowerCase(),
                __changed: 0,
                __changed_context: 1
            };

            items.push(contextItem);
            itemById.set(id, contextItem);
        }
    }

    for (const changedItem of changedItems) {
        const id = String(changedItem?.id || '').trim();
        if (!id) continue;

        const existing = itemById.get(id);
        if (existing) {
            existing.changeType = changedItem.changeType || existing.changeType;
            existing.changeTypeParts = Array.isArray(changedItem.changeTypeParts) ? changedItem.changeTypeParts : existing.changeTypeParts;
            if (changedItem.newNamedPath) existing.newNamedPath = changedItem.newNamedPath;
            if (changedItem.oldNamedPath) existing.oldNamedPath = changedItem.oldNamedPath;
            if (changedItem.newFolderSlash) existing.newFolderSlash = changedItem.newFolderSlash;
            if (changedItem.oldFolderSlash) existing.oldFolderSlash = changedItem.oldFolderSlash;
            if (changedItem.newPathSlash) existing.newPathSlash = changedItem.newPathSlash;
            if (changedItem.oldPathSlash) existing.oldPathSlash = changedItem.oldPathSlash;
            if (Array.isArray(changedItem.idPathCandidates) && changedItem.idPathCandidates.length > 0) {
                existing.idPathCandidates = changedItem.idPathCandidates;
            }
            if (changedItem.__pn) existing.__pn = changedItem.__pn;
            if (changedItem.__po) existing.__po = changedItem.__po;
            if (changedItem.__sn) existing.__sn = changedItem.__sn;
            if (changedItem.__so) existing.__so = changedItem.__so;
            if (changedItem.__dh && !existing.__dh) existing.__dh = changedItem.__dh;
            if (changedItem.__dr && !existing.__dr) existing.__dr = changedItem.__dr;
            existing.__changed = 1;
            existing.__changed_context = 0;
            continue;
        }

        const cloned = {
            ...changedItem,
            __changed: 1,
            __changed_context: 0
        };
        items.push(cloned);
        itemById.set(id, cloned);
    }

    currentChangesSearchDb = {
        signature,
        version: lastTreeSnapshotVersion || null,
        size,
        items,
        itemById,
        changedItems,
        changedItemById,
        compactScopedIdSet: (() => {
            const set = new Set();
            idSet.forEach((v) => set.add(String(v)));
            changedContextIdSet.forEach((v) => set.add(String(v)));
            changedAncestorIdSet.forEach((v) => set.add(String(v)));
            return set;
        })(),
        collectionScopedIdSet: buildCurrentChangesCollectionScopedIdSet(changeMap)
    };
    return currentChangesSearchDb;
}

// ==================== 搜索匹配与排序 ====================

function shouldEnablePathFieldMatch(query) {
    const q = String(query || '').trim();
    if (!q) return false;
    // 只有用户显式输入路径特征时，才启用路径字段匹配，避免“父文件夹命中导致子项误命中”。
    return q.includes('/') || q.includes('\\') || q.includes('>');
}

function isCjkSearchToken(token) {
    const t = String(token || '');
    return /[\u3400-\u9fff]/.test(t);
}

function isLikelyUrlSearchToken(token) {
    const t = String(token || '').trim().toLowerCase();
    if (!t) return false;
    if (/^[a-z][a-z0-9+.-]*:/.test(t)) return true;
    if (t.startsWith('www.')) return true;
    if (t.includes('/') || t.includes('\\') || t.includes(':') || t.includes('?') || t.includes('#') || t.includes('=')) return true;
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return true;
    return false;
}

function getSearchTokenLength(token) {
    try {
        return Array.from(String(token || '')).length;
    } catch (_) {
        return String(token || '').length;
    }
}

/**
 * 计算搜索项的匹配分数
 * @param {Object} item - 搜索项
 * @param {Array} tokens - 搜索关键词数组
 * @param {Object} options - 匹配选项
 */
function scoreCurrentChangesSearchItem(item, tokens, options = {}) {
    const allowPathMatch = !!(options && options.allowPathMatch === true);
    const domainOnly = !!(options && options.domainOnly === true);
    const normalizedQuery = String(options && options.query ? options.query : '').trim().toLowerCase();
    let score = 0;

    if (normalizedQuery) {
        if (item.__dh && item.__dh === normalizedQuery) score += 170;
        if (item.__dr && item.__dr === normalizedQuery) score += 165;
        if (!domainOnly && item.__t && item.__t === normalizedQuery) score += 220;
    }

    for (const t of tokens) {
        if (!t) continue;

        const tokenLen = getSearchTokenLength(t);
        const isCjk = isCjkSearchToken(t);
        const isUrlLike = isLikelyUrlSearchToken(t);
        const allowTitleContains = isCjk || tokenLen >= 3;
        const allowDomainFieldMatch = isUrlLike || tokenLen >= 4;
        const allowPathFieldMatch = allowPathMatch && (isUrlLike || isCjk || tokenLen >= 2);

        let matched = false;
        if (!domainOnly) {
            if (item.__t && item.__t === t) { score += 160; matched = true; }
            else if (item.__t && item.__t.startsWith(t)) { score += 120; matched = true; }
            else if (allowTitleContains && item.__t && item.__t.includes(t)) { score += 90; matched = true; }
        }

        if (!matched && allowDomainFieldMatch) {
            if (item.__dh && item.__dh === t) { score += 110; matched = true; }
            else if (item.__dh && item.__dh.startsWith(t)) { score += 88; matched = true; }
            else if (item.__dh && item.__dh.includes(t)) { score += 82; matched = true; }
            else if (item.__dr && item.__dr.includes(t)) { score += 78; matched = true; }
        }

        if (!matched && !domainOnly && allowPathFieldMatch) {
            if (item.__pn && item.__pn.includes(t)) { score += 50; matched = true; }
            else if (item.__sn && item.__sn.includes(t)) { score += 48; matched = true; }
            else if (item.__so && item.__so.includes(t)) { score += 45; matched = true; }
            else if (item.__po && item.__po.includes(t)) { score += 40; matched = true; }
        }

        if (!matched) return -Infinity;
    }

    // 轻量加权：书签优先于文件夹（更常见的定位目标）
    if (item.nodeType === 'bookmark') score += 2;
    // 变化项优先显示（全量搜索时仍优先把变化条目排在前面）
    if (item.__changed) score += 22;
    // 变化上下文次优先（例如：变化文件夹下的子项）
    if (!item.__changed && item.__changed_context) score += 10;
    return score;
}

function matchesSearchItemByDomainFields(item, tokens, options = {}) {
    if (!item || item.nodeType !== 'bookmark') return false;

    const host = String(item.__dh || '').trim().toLowerCase();
    const root = String(item.__dr || '').trim().toLowerCase();
    if (!host && !root) return false;

    const normalizedQuery = String(options && options.query ? options.query : '').trim().toLowerCase();
    if (normalizedQuery && (host === normalizedQuery || root === normalizedQuery)) {
        return true;
    }

    const normalizedTokens = Array.isArray(tokens)
        ? tokens.map((token) => String(token || '').trim().toLowerCase()).filter(Boolean)
        : [];
    if (!normalizedTokens.length) return false;

    for (const token of normalizedTokens) {
        const matched = (host && (host === token || host.startsWith(token) || host.includes(token)))
            || (root && (root === token || root.startsWith(token) || root.includes(token)));
        if (!matched) return false;
    }

    return true;
}

function getDomainMatchedSearchItems(items, tokens, options = {}) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    return list.filter((item) => matchesSearchItemByDomainFields(item, tokens, options));
}

function compareScopedSearchMatches(a, b, scopedOrderMap) {
    const aItem = a && a.item ? a.item : null;
    const bItem = b && b.item ? b.item : null;

    const aChanged = aItem && aItem.__changed ? 1 : 0;
    const bChanged = bItem && bItem.__changed ? 1 : 0;
    if (bChanged !== aChanged) return bChanged - aChanged;

    const aContext = !aChanged && aItem && aItem.__changed_context ? 1 : 0;
    const bContext = !bChanged && bItem && bItem.__changed_context ? 1 : 0;
    if (bContext !== aContext) return bContext - aContext;

    const aId = String(aItem?.id || '').trim();
    const bId = String(bItem?.id || '').trim();
    const aOrder = scopedOrderMap.has(aId) ? scopedOrderMap.get(aId) : Number.POSITIVE_INFINITY;
    const bOrder = scopedOrderMap.has(bId) ? scopedOrderMap.get(bId) : Number.POSITIVE_INFINITY;
    const aHasOrder = Number.isFinite(aOrder);
    const bHasOrder = Number.isFinite(bOrder);

    if (aHasOrder && bHasOrder && aOrder !== bOrder) return aOrder - bOrder;
    if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;

    if (b.s !== a.s) return b.s - a.s;
    const ta = aItem?.title || '';
    const tb = bItem?.title || '';
    const tc = ta.localeCompare(tb);
    if (tc !== 0) return tc;
    return (aItem?.url || '').localeCompare((bItem?.url || ''));
}

/**
 * 执行当前变化搜索并渲染结果
 * @param {string} query - 搜索关键词
 */
function searchCurrentChangesAndRender(query) {
    // 数据尚未准备好：先给出加载提示
    if (!(treeChangeMap instanceof Map)) {
        renderSearchResultsPanel([], {
            view: 'current-changes',
            query,
            emptyText: getSearchI18nText('searchLoading', '加载中...', 'Loading...')
        });
        return;
    }

    const db = buildCurrentChangesSearchDb();
    if (!db.items || db.items.length === 0) {
        renderSearchResultsPanel([], {
            view: 'current-changes',
            query,
            emptyText: getSearchI18nText('searchNoResults', '没有找到匹配结果', 'No results')
        });
        return;
    }

    const tokens = String(query).toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (!tokens.length) {
        hideSearchResultsPanel();
        return;
    }

    if (!(searchUiState.currentChangesExpandedDomainGroups instanceof Set)) {
        searchUiState.currentChangesExpandedDomainGroups = new Set();
    }
    if (!(searchUiState.currentChangesDomainGroupHostFilters instanceof Map)) {
        searchUiState.currentChangesDomainGroupHostFilters = new Map();
    }
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const previousQuery = String(searchUiState.query || '').trim().toLowerCase();
    if (normalizedQuery !== previousQuery) {
        searchUiState.currentChangesExpandedDomainGroups.clear();
        searchUiState.currentChangesDomainGroupHostFilters.clear();
        // 新查询时重置类型筛选，避免沿用上一次“域名分组”导致看起来“能匹配但不能跳转”。
        searchUiState.currentChangesTypeFilter = null;
    }

    const scopedMeta = getCurrentChangesScopedSearchMeta(db);
    const scopedItems = Array.isArray(scopedMeta?.items) ? scopedMeta.items : [];
    const scopedOrderMap = scopedMeta && scopedMeta.orderMap instanceof Map
        ? scopedMeta.orderMap
        : new Map();
    if (!scopedItems.length) {
        renderSearchResultsPanel([], {
            view: 'current-changes',
            query,
            emptyText: getSearchI18nText('searchNoResults', '没有找到匹配结果', 'No results')
        });
        return;
    }

    const allowPathMatch = shouldEnablePathFieldMatch(query);
    const scored = [];
    for (const item of scopedItems) {
        const s = scoreCurrentChangesSearchItem(item, tokens, { allowPathMatch, query });
        if (s > -Infinity) scored.push({ item, s });
    }

    scored.sort((a, b) => compareScopedSearchMatches(a, b, scopedOrderMap));

    const matchedResults = scored.map(x => x.item);
    const domainMatchedItems = getDomainMatchedSearchItems(scopedItems, tokens, { query });
    const { filtered, counts, activeFilter } = filterSearchItemsByType(matchedResults, searchUiState.currentChangesTypeFilter, {
        domainGrouped: true,
        domainMatchedItems
    });
    const MAX_RESULTS = 20;
    const results = filtered.slice(0, MAX_RESULTS);
    searchUiState.currentChangesTypeCounts = counts;
    searchUiState.currentChangesTypeFilter = activeFilter;
    if (activeFilter !== 'domain') {
        searchUiState.currentChangesExpandedDomainGroups.clear();
        searchUiState.currentChangesDomainGroupHostFilters.clear();
    }

    renderSearchResultsPanel(results, {
        view: 'current-changes',
        query,
        currentChangesTypeCounts: counts,
        currentChangesTypeFilter: activeFilter
    });
}

function toggleCurrentChangesDomainGroup(groupId, options = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) return false;

    if (!(searchUiState.currentChangesExpandedDomainGroups instanceof Set)) {
        searchUiState.currentChangesExpandedDomainGroups = new Set();
    }

    if (searchUiState.currentChangesExpandedDomainGroups.has(normalizedGroupId)) {
        searchUiState.currentChangesExpandedDomainGroups.delete(normalizedGroupId);
    } else {
        searchUiState.currentChangesExpandedDomainGroups.add(normalizedGroupId);
    }

    const input = document.getElementById('searchInput');
    const query = String((input && input.value != null ? input.value : searchUiState.query) || '').trim();
    if (!query) return false;

    const selectedIndex = Number.isFinite(Number(options.selectedIndex))
        ? Number(options.selectedIndex)
        : null;

    searchCurrentChangesAndRender(query);
    if (selectedIndex !== null) {
        updateSearchResultSelection(selectedIndex, { scrollIntoView: false });
    }
    return true;
}

function setCurrentChangesDomainGroupHostFilter(groupId, host, options = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) return false;

    if (!(searchUiState.currentChangesDomainGroupHostFilters instanceof Map)) {
        searchUiState.currentChangesDomainGroupHostFilters = new Map();
    }
    if (!(searchUiState.currentChangesExpandedDomainGroups instanceof Set)) {
        searchUiState.currentChangesExpandedDomainGroups = new Set();
    }

    const normalizedHost = normalizeSearchDomainHostValue(host);
    const currentHost = normalizeSearchDomainHostValue(searchUiState.currentChangesDomainGroupHostFilters.get(normalizedGroupId));
    if (normalizedHost && currentHost !== normalizedHost) {
        searchUiState.currentChangesDomainGroupHostFilters.set(normalizedGroupId, normalizedHost);
    } else {
        searchUiState.currentChangesDomainGroupHostFilters.delete(normalizedGroupId);
    }
    searchUiState.currentChangesExpandedDomainGroups.add(normalizedGroupId);

    const input = document.getElementById('searchInput');
    const query = String((input && input.value != null ? input.value : searchUiState.query) || '').trim();
    if (!query) return false;

    const selectedIndex = Number.isFinite(Number(options.selectedIndex))
        ? Number(options.selectedIndex)
        : null;

    searchCurrentChangesAndRender(query);
    if (selectedIndex !== null) {
        updateSearchResultSelection(selectedIndex, { scrollIntoView: false });
    }
    return true;
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
        const previewRoot = document.getElementById('changesTreePreviewInline');
        const isCompactMode = !!(previewRoot && previewRoot.classList && previewRoot.classList.contains('compact-mode'));
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

                // 简略模式：如果祖先是“变化文件夹”，程序化定位时也要展示其完整子树。
                if (isCompactMode) {
                    const isFolder = (parentItem.getAttribute('data-node-type') || parentItem.dataset?.nodeType) === 'folder';
                    const isChangedFolder = isFolder && (
                        parentItem.classList.contains('tree-change-added') ||
                        parentItem.classList.contains('tree-change-deleted') ||
                        parentItem.classList.contains('tree-change-modified') ||
                        parentItem.classList.contains('tree-change-moved') ||
                        parentItem.classList.contains('tree-change-mixed')
                    );
                    if (isChangedFolder) {
                        const parentNode = parentItem.closest('.tree-node');
                        if (parentNode) parentNode.classList.add('compact-reveal-all');
                    }
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
function getCurrentChangesSearchTreeContainer(previewContainer) {
    if (!previewContainer) return null;
    const previewTree = previewContainer.querySelector('#preview_bookmarkTree');
    if (previewTree) return previewTree;
    const historyTree = previewContainer.querySelector('.history-tree-container');
    if (historyTree) return historyTree;
    return previewContainer;
}

function getCurrentChangesTreeItemInContainer(treeContainer, nodeId) {
    return queryTreeItemByLookupId(treeContainer, nodeId);
}

function normalizeSearchNodeTitle(text) {
    return String(text || '')
        .trim()
        .replace(/^\[(\+|-|~>>|>>|~)\]\s*/, '');
}

function normalizeSearchUrlForMatch(urlText) {
    const raw = String(urlText || '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw);
        u.hash = '';
        return u.toString();
    } catch (_) {
        return raw;
    }
}

function isSearchUrlEquivalent(a, b) {
    const na = normalizeSearchUrlForMatch(a);
    const nb = normalizeSearchUrlForMatch(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    return na.replace(/\/$/, '') === nb.replace(/\/$/, '');
}

function getSearchTreeItemDisplayTitle(treeItem) {
    if (!treeItem) return '';
    try {
        const label = treeItem.querySelector('.tree-bookmark-link, .tree-label');
        return normalizeSearchNodeTitle(label && label.textContent ? label.textContent : '');
    } catch (_) {
        return '';
    }
}

function getSearchTreeItemNamedPath(treeItem, treeContainer) {
    if (!treeItem) return '';

    const parts = [];
    let currentItem = treeItem;
    let guard = 0;

    while (currentItem && guard++ < 1024) {
        const title = getSearchTreeItemDisplayTitle(currentItem);
        if (title) {
            parts.push(title);
        }

        const parentChildren = currentItem.parentElement;
        if (!parentChildren || parentChildren === treeContainer) break;

        const parentItem = parentChildren.previousElementSibling;
        if (!parentItem || !parentItem.classList || !parentItem.classList.contains('tree-item')) break;
        currentItem = parentItem;
    }

    return parts.reverse().join(' > ');
}

function collectCurrentChangesSearchFallbackCandidates(treeContainer, searchItem) {
    if (!treeContainer || !searchItem) return [];

    const results = [];
    const seenIds = new Set();
    const pushCandidate = (itemEl) => {
        if (!itemEl) return;
        const nodeId = getSearchTreeItemLookupId(itemEl);
        if (!nodeId || seenIds.has(nodeId)) return;
        seenIds.add(nodeId);
        results.push(itemEl);
    };

    const itemUrl = String(searchItem.url || '').trim();
    const itemTitle = normalizeSearchNodeTitle(searchItem.title || '');

    if (itemUrl) {
        const links = treeContainer.querySelectorAll('a.tree-bookmark-link[href], a.tree-label[href]');
        for (const link of links) {
            const href = String(link.getAttribute('href') || link.href || '').trim();
            if (!href || !isSearchUrlEquivalent(href, itemUrl)) continue;
            pushCandidate(link.closest('.tree-item[data-node-id]'));
        }
    }

    if (itemTitle) {
        const labels = treeContainer.querySelectorAll('.tree-item[data-node-id] .tree-label, .tree-item[data-node-id] .tree-bookmark-link');
        for (const label of labels) {
            const labelTitle = normalizeSearchNodeTitle(label && label.textContent ? label.textContent : '');
            if (!labelTitle || labelTitle !== itemTitle) continue;
            pushCandidate(label.closest('.tree-item[data-node-id]'));
        }
    }

    return results;
}

function findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem) {
    if (!treeContainer || !searchItem) return null;
    const candidates = collectCurrentChangesSearchFallbackCandidates(treeContainer, searchItem);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    const expectedPaths = new Set();
    const addPath = (value) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized) expectedPaths.add(normalized);
    };
    addPath(searchItem.newNamedPath);
    addPath(searchItem.oldNamedPath);

    if (expectedPaths.size > 0) {
        const pathMatches = candidates.filter((candidate) => {
            const namedPath = getSearchTreeItemNamedPath(candidate, treeContainer);
            return expectedPaths.has(String(namedPath || '').trim().toLowerCase());
        });
        if (pathMatches.length === 1) return pathMatches[0];
        if (pathMatches.length > 1) return null;
    }

    const itemUrl = String(searchItem.url || '').trim();
    const itemTitle = normalizeSearchNodeTitle(searchItem.title || '');
    const exactCandidates = candidates.filter((candidate) => {
        const candidateTitle = getSearchTreeItemDisplayTitle(candidate);
        if (itemTitle && candidateTitle !== itemTitle) return false;
        if (!itemUrl) return true;
        try {
            const link = candidate.querySelector('a.tree-bookmark-link[href], a.tree-label[href]');
            const href = String(link && (link.getAttribute('href') || link.href) || '').trim();
            return !!href && isSearchUrlEquivalent(href, itemUrl);
        } catch (_) {
            return false;
        }
    });
    if (exactCandidates.length === 1) return exactCandidates[0];

    // 候选不唯一时宁可放弃兜底，也不要把用户带到错误条目。
    return null;
}

function buildCurrentChangesIdPathFromPreviewIndex(nodeId) {
    const id = String(nodeId || '').trim();
    if (!id) return [];

    let index = null;
    try {
        if (window.__changesPreviewTreeIndex instanceof Map) {
            index = window.__changesPreviewTreeIndex;
        }
    } catch (_) { }
    if (!(index instanceof Map) || !index.has(id)) return [];

    const path = [];
    let currentId = id;
    let guard = 0;
    while (guard++ < 1024 && currentId) {
        path.push(currentId);
        const node = index.get(currentId);
        if (!node) break;
        const parentRaw = node.parentId != null ? String(node.parentId) : '';
        if (!parentRaw || parentRaw === currentId) break;
        currentId = parentRaw;
    }

    return path.reverse();
}

async function expandCurrentChangesFolderItemForSearch(folderItem) {
    if (!folderItem) return null;
    const nodeType = folderItem.getAttribute('data-node-type') || folderItem.dataset?.nodeType;
    if (nodeType !== 'folder') return null;

    const treeNode = folderItem.closest('.tree-node');
    const children = treeNode?.querySelector(':scope > .tree-children');
    if (!children) return null;

    const toggle = folderItem.querySelector(':scope > .tree-toggle') || folderItem.querySelector('.tree-toggle');
    if (toggle) toggle.classList.add('expanded');
    children.classList.add('expanded');

    const folderIcon = folderItem.querySelector('.tree-icon.fas.fa-folder, .tree-icon.fas.fa-folder-open');
    if (folderIcon) {
        folderIcon.classList.remove('fa-folder');
        folderIcon.classList.add('fa-folder-open');
    }

    const childrenLoaded = String(folderItem.dataset?.childrenLoaded || '').toLowerCase();
    const hasChildren = String(folderItem.dataset?.hasChildren || '').toLowerCase();
    const shouldLoadChildren = childrenLoaded === 'false' && hasChildren !== 'false';
    if (shouldLoadChildren && typeof loadPermanentFolderChildrenLazy === 'function') {
        const folderId = String(folderItem.getAttribute('data-node-id') || folderItem.dataset?.nodeId || '').trim();
        if (folderId) {
            try {
                await loadPermanentFolderChildrenLazy(folderId, children, 0, null, true);
            } catch (_) { }
        }
    }

    return children;
}

async function appendCurrentChangesLoadMoreBatch(loadMoreBtn) {
    if (!loadMoreBtn || typeof loadPermanentFolderChildrenLazy !== 'function') return false;
    const children = loadMoreBtn.closest('.tree-children');
    if (!children) return false;

    const parentId = String(
        loadMoreBtn.dataset.parentId ||
        (children.dataset ? children.dataset.parentId : '') ||
        ''
    ).trim();
    if (!parentId) return false;

    const startIndexRaw = Number.parseInt(loadMoreBtn.dataset.startIndex || '0', 10);
    const startIndex = Number.isFinite(startIndexRaw) ? Math.max(0, startIndexRaw) : 0;

    try {
        await loadPermanentFolderChildrenLazy(parentId, children, startIndex, loadMoreBtn, true);
        return true;
    } catch (_) {
        return false;
    }
}

async function ensureCurrentChangesTargetByScan(nodeId, previewContainer, options = {}) {
    const id = String(nodeId || '').trim();
    const treeContainer = getCurrentChangesSearchTreeContainer(previewContainer);
    if (!id || !treeContainer) return null;
    const searchItem = options && options.searchItem ? options.searchItem : null;

    const findTarget = () => getCurrentChangesTreeItemInContainer(treeContainer, id)
        || (searchItem ? findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem) : null);
    let target = findTarget();
    if (target) return target;

    const scannedFolders = new WeakSet();
    let passGuard = 0;
    while (!target && passGuard++ < 48) {
        let progressed = false;

        // 先补齐所有“加载更多”批次，再做下一层展开
        const loadMoreButtons = treeContainer.querySelectorAll('.tree-load-more');
        for (const loadMoreBtn of loadMoreButtons) {
            const loaded = await appendCurrentChangesLoadMoreBatch(loadMoreBtn);
            if (loaded) progressed = true;
            target = findTarget();
            if (target) return target;
        }

        const folders = treeContainer.querySelectorAll('.tree-item[data-node-type="folder"][data-node-id]');
        for (const folderItem of folders) {
            if (scannedFolders.has(folderItem)) continue;
            scannedFolders.add(folderItem);

            const children = await expandCurrentChangesFolderItemForSearch(folderItem);
            if (children) progressed = true;

            target = findTarget();
            if (target) return target;
        }

        if (!progressed) break;
    }

    return findTarget();
}

async function ensureCurrentChangesHistoryTreeTargetByScan(nodeId, treeContainer, options = {}) {
    const id = String(nodeId || '').trim();
    if (!id || !treeContainer) return null;
    const searchItem = options && options.searchItem ? options.searchItem : null;

    const findTarget = () => getTreeItemByNodeIdInContainer(treeContainer, id)
        || (searchItem ? findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem) : null);
    let target = findTarget();
    if (target) return target;

    const lazyContext = getHistoryDetailSearchLazyContext(treeContainer, options);
    const scannedFolders = new WeakSet();
    let passGuard = 0;

    while (!target && passGuard++ < 64) {
        let progressed = false;

        const folders = treeContainer.querySelectorAll('.tree-item[data-node-type="folder"][data-node-id]');
        for (const folderItem of folders) {
            if (scannedFolders.has(folderItem)) continue;
            scannedFolders.add(folderItem);

            const children = await expandHistoryDetailFolderItemForSearch(folderItem, treeContainer, {
                ...options,
                lazyContext
            });
            if (children) progressed = true;

            target = findTarget();
            if (target) return target;

            if (children) {
                let batchGuard = 0;
                while (!target && batchGuard++ < 256) {
                    const loadMoreBtn = children.querySelector(':scope > .tree-load-more');
                    if (!loadMoreBtn) break;
                    const loaded = appendHistoryDetailLoadMoreBatch(loadMoreBtn, treeContainer, {
                        ...options,
                        lazyContext
                    });
                    if (!loaded) break;
                    progressed = true;
                    target = findTarget();
                }
            }

            if (target) return target;
        }

        if (!progressed) break;
    }

    return findTarget();
}

async function ensureCurrentChangesPathRendered(idPath, previewContainer) {
    const treeContainer = getCurrentChangesSearchTreeContainer(previewContainer);
    if (!treeContainer) return null;

    const normalizedPath = normalizeHistoryDetailIdPath(idPath);
    if (!normalizedPath.length) return null;
    const targetId = normalizedPath[normalizedPath.length - 1];

    const findItem = (id) => getCurrentChangesTreeItemInContainer(treeContainer, id);
    let startIndex = 0;
    while (startIndex < normalizedPath.length && !findItem(normalizedPath[startIndex])) {
        startIndex += 1;
    }
    if (startIndex >= normalizedPath.length) return null;

    for (let i = startIndex; i < normalizedPath.length - 1; i += 1) {
        const currentId = normalizedPath[i];
        const nextId = normalizedPath[i + 1];
        const currentItem = findItem(currentId);
        if (!currentItem) return null;

        const children = await expandCurrentChangesFolderItemForSearch(currentItem);

        let nextItem = findItem(nextId);
        if (!nextItem && children) {
            let guard = 0;
            while (!nextItem && guard++ < 256) {
                const loadMoreBtn = children.querySelector(':scope > .tree-load-more');
                if (!loadMoreBtn) break;
                const progressed = await appendCurrentChangesLoadMoreBatch(loadMoreBtn);
                if (!progressed) break;
                nextItem = findItem(nextId);
            }
        }

        if (!nextItem) return null;
    }

    return findItem(targetId);
}

async function ensureCurrentChangesTargetRendered(nodeId, previewContainer, options = {}) {
    const id = String(nodeId || '').trim();
    const treeContainer = getCurrentChangesSearchTreeContainer(previewContainer);
    if (!id || !treeContainer) return null;
    const searchItem = options && options.searchItem ? options.searchItem : null;

    let target = getCurrentChangesTreeItemInContainer(treeContainer, id);
    if (target) return target;

    const isHistoryLazyTree = !!(
        treeContainer.classList &&
        treeContainer.classList.contains('history-tree-container')
    );
    if (isHistoryLazyTree) {
        try {
            if (typeof ensureHistoryDetailTargetRendered === 'function') {
                target = await ensureHistoryDetailTargetRendered(id, treeContainer, options);
                if (target) return target;
            }
        } catch (_) { }

        try {
            target = await ensureCurrentChangesHistoryTreeTargetByScan(id, treeContainer, options);
            if (target) return target;
        } catch (_) { }

        if (searchItem) {
            try {
                target = findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem);
                if (target) return target;
                await ensureCurrentChangesHistoryTreeTargetByScan(id, treeContainer, options);
                target = findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem);
                if (target) return target;
            } catch (_) { }
        }

        return getCurrentChangesTreeItemInContainer(treeContainer, id);
    }

    const pathCandidates = Array.isArray(options.idPathCandidates) ? options.idPathCandidates.slice() : [];
    const previewIndexPath = buildCurrentChangesIdPathFromPreviewIndex(id);
    if (previewIndexPath.length > 0) {
        pathCandidates.push(previewIndexPath);
    }
    for (const path of pathCandidates) {
        target = await ensureCurrentChangesPathRendered(normalizeHistoryDetailIdPath(path, id), previewContainer);
        if (target) return target;
    }

    try {
        target = await ensureCurrentChangesTargetByScan(id, previewContainer, options);
        if (target) return target;
    } catch (_) { }

    if (searchItem) {
        try {
            target = findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem);
            if (target) return target;
        } catch (_) { }
    }

    // 集合模式/历史树容器：继续复用 history 栈的 lazy context 作为兜底。
    try {
        if (typeof ensureHistoryDetailTargetRendered === 'function') {
            target = await ensureHistoryDetailTargetRendered(id, treeContainer, options);
            if (target) return target;
        }
    } catch (_) { }

    return getCurrentChangesTreeItemInContainer(treeContainer, id);
}

function nextAnimationFrame() {
    return new Promise((resolve) => {
        try {
            requestAnimationFrame(() => resolve());
        } catch (_) {
            setTimeout(resolve, 16);
        }
    });
}

async function waitCurrentChangesDomSettle(container, options = {}) {
    const target = container || document.getElementById('changesTreePreviewInline');
    if (!target) return;

    const idleMsRaw = Number(options.idleMs);
    const timeoutMsRaw = Number(options.timeoutMs);
    const idleMs = Number.isFinite(idleMsRaw) ? Math.max(30, idleMsRaw) : 70;
    const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(idleMs + 20, timeoutMsRaw) : 380;

    await new Promise((resolve) => {
        if (typeof MutationObserver !== 'function') {
            setTimeout(resolve, idleMs);
            return;
        }

        let done = false;
        let idleTimer = null;
        let timeoutTimer = null;
        let observer = null;

        const finish = () => {
            if (done) return;
            done = true;
            try { if (observer) observer.disconnect(); } catch (_) { }
            try { if (idleTimer) clearTimeout(idleTimer); } catch (_) { }
            try { if (timeoutTimer) clearTimeout(timeoutTimer); } catch (_) { }
            resolve();
        };

        const bumpIdle = () => {
            try { if (idleTimer) clearTimeout(idleTimer); } catch (_) { }
            idleTimer = setTimeout(finish, idleMs);
        };

        try {
            observer = new MutationObserver(() => {
                bumpIdle();
            });
            observer.observe(target, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class', 'data-children-loaded', 'data-start-index']
            });
        } catch (_) {
            finish();
            return;
        }

        bumpIdle();
        timeoutTimer = setTimeout(finish, timeoutMs);
    });
}

function clearCurrentChangesSearchHighlights(previewContainer) {
    const treeContainer = getCurrentChangesSearchTreeContainer(previewContainer) || previewContainer;
    if (!treeContainer) return;

    const selectors = [
        '.tree-item.highlight-added',
        '.tree-item.highlight-deleted',
        '.tree-item.highlight-moved',
        '.tree-item.highlight-modified',
        '.tree-item.highlight-search-neutral'
    ];
    try {
        treeContainer.querySelectorAll(selectors.join(',')).forEach((el) => {
            try {
                el.classList.remove('highlight-added', 'highlight-deleted', 'highlight-moved', 'highlight-modified', 'highlight-search-neutral');
            } catch (_) { }
        });
    } catch (_) { }
}

function triggerCurrentChangesSearchHighlight(target, highlightClass, durationMs = 1200) {
    if (!target || !highlightClass) return;

    try { target.classList.remove(highlightClass); } catch (_) { }
    // 触发一次重排，确保同一元素连续点击时动画/灰框可重复生效。
    try { void target.offsetWidth; } catch (_) { }
    try { target.classList.add(highlightClass); } catch (_) { return; }

    setTimeout(() => {
        try { target.classList.remove(highlightClass); } catch (_) { }
    }, durationMs);
}

function applyCurrentChangesSearchHighlightImmediate(target, highlightClass) {
    if (!target || !highlightClass) return;
    try { target.classList.add(highlightClass); } catch (_) { }
}

function getCurrentChangesPreviewScrollBody(previewContainer) {
    if (!previewContainer) return null;
    try {
        const body = previewContainer.querySelector('.changes-preview-readonly .permanent-section-body')
            || previewContainer.querySelector('.permanent-section-body');
        if (body) return body;
    } catch (_) { }
    return null;
}

function markCurrentChangesPreviewJumpScrollAsUser(previewBody) {
    if (!previewBody) return;
    try {
        if (typeof __getChangesPreviewScrollStorageKey === 'function' &&
            typeof __changesPreviewScrollGuards !== 'undefined' &&
            __changesPreviewScrollGuards instanceof Map) {
            const key = __getChangesPreviewScrollStorageKey();
            const guard = __changesPreviewScrollGuards.get(key);
            if (guard) {
                guard.userInteracted = true;
                guard.restoredTop = previewBody.scrollTop || 0;
                guard.suppressUntil = Date.now() + 240;
                __changesPreviewScrollGuards.set(key, guard);
            }
        }
    } catch (_) { }

    // 兜底：触发预览容器现有的交互监听（history.js 中会将 guard.userInteracted 置为 true）。
    try {
        previewBody.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    } catch (_) {
        try { previewBody.dispatchEvent(new Event('wheel', { bubbles: true })); } catch (_) { }
    }

    try {
        if (typeof saveChangesPreviewScrollTop === 'function') {
            saveChangesPreviewScrollTop(previewBody.scrollTop || 0);
        }
    } catch (_) { }
}

function getCurrentChangesContentAreaForJump() {
    try {
        return document.querySelector('.content-area');
    } catch (_) {
        return null;
    }
}

function markCurrentChangesContentJumpScroll(contentAreaEl) {
    if (!contentAreaEl) return;
    try {
        if (typeof saveCurrentChangesContentScrollTop === 'function') {
            saveCurrentChangesContentScrollTop(contentAreaEl.scrollTop || 0);
        }
    } catch (_) { }
}

async function stabilizeCurrentChangesTargetForJump(nodeId, previewContainer) {
    const id = String(nodeId || '').trim();
    if (!id || !previewContainer) return null;

    const findTarget = () => {
        const treeContainer = getCurrentChangesSearchTreeContainer(previewContainer);
        return getCurrentChangesTreeItemInContainer(treeContainer, id);
    };

    let target = findTarget();
    if (!target) return null;

    expandAncestorsForTreeItem(target, previewContainer);
    await nextAnimationFrame();
    await nextAnimationFrame();
    await waitCurrentChangesDomSettle(previewContainer, { idleMs: 70, timeoutMs: 380 });

    target = findTarget() || target;
    expandAncestorsForTreeItem(target, previewContainer);
    await nextAnimationFrame();

    return findTarget() || target;
}

async function locateNodeInCurrentChangesPreview(nodeId, options = {}) {
    const previewContainer = document.getElementById('changesTreePreviewInline');
    if (!previewContainer) return false;

    const id = String(nodeId || '').trim();
    if (!id) return false;
    const findTarget = () => {
        const treeContainer = getCurrentChangesSearchTreeContainer(previewContainer);
        return getCurrentChangesTreeItemInContainer(treeContainer, id);
    };

    let target = findTarget();
    if (!target) {
        try {
            target = await ensureCurrentChangesTargetRendered(id, previewContainer, {
                idPathCandidates: Array.isArray(options.idPathCandidates) ? options.idPathCandidates : [],
                searchItem: options.searchItem || null
            });
        } catch (_) { }
    }
    if (!target) {
        // 再给一次“懒加载+DOM稳定”窗口，优先避免整树刷新带来的滚动重置。
        try {
            await waitCurrentChangesDomSettle(previewContainer, { idleMs: 80, timeoutMs: 420 });
            target = await ensureCurrentChangesTargetRendered(id, previewContainer, {
                idPathCandidates: Array.isArray(options.idPathCandidates) ? options.idPathCandidates : [],
                searchItem: options.searchItem || null
            });
        } catch (_) { }
    }
    if (!target) {
        // 仅在前面都失败时才强制刷新视图兜底。
        try {
            await renderCurrentChangesViewWithRetry(2, true);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            target = await ensureCurrentChangesTargetRendered(id, previewContainer, {
                idPathCandidates: Array.isArray(options.idPathCandidates) ? options.idPathCandidates : [],
                searchItem: options.searchItem || null
            });
        } catch (_) { }
    }
    if (!target) return false;

    const previewBody = getCurrentChangesPreviewScrollBody(previewContainer);
    const contentArea = getCurrentChangesContentAreaForJump();
    const highlightClass = options.highlightClass || getHighlightClassFromChangeType(options.changeType || '');

    if (highlightClass) {
        clearCurrentChangesSearchHighlights(previewContainer);
        applyCurrentChangesSearchHighlightImmediate(target, highlightClass);
    }

    expandAncestorsForTreeItem(target, previewContainer);
    await nextAnimationFrame();
    target = findTarget() || target;

    try {
        target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }
    markCurrentChangesPreviewJumpScrollAsUser(previewBody);
    markCurrentChangesContentJumpScroll(contentArea);

    target = (await stabilizeCurrentChangesTargetForJump(id, previewContainer)) || target;
    if (!target) return false;

    await nextAnimationFrame();
    markCurrentChangesPreviewJumpScrollAsUser(previewBody);
    markCurrentChangesContentJumpScroll(contentArea);

    // 在懒加载继续插入节点时再兜底一次，防止被旧的滚动守卫拉回顶部。
    await waitCurrentChangesDomSettle(previewContainer, { idleMs: 50, timeoutMs: 220 });
    target = (findTarget() || target);
    try {
        target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }
    markCurrentChangesPreviewJumpScrollAsUser(previewBody);
    markCurrentChangesContentJumpScroll(contentArea);

    if (highlightClass) {
        clearCurrentChangesSearchHighlights(previewContainer);
        triggerCurrentChangesSearchHighlight(target, highlightClass, 1400);
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

    if (item.nodeType === 'domain_group') {
        toggleCurrentChangesDomainGroup(item.id, { selectedIndex: idx });
        return;
    }

    await activateCurrentChangesSearchItem(item);
}

async function activateCurrentChangesSearchItem(item) {
    if (!item) return;
    if (item.nodeType === 'domain_group') {
        toggleCurrentChangesDomainGroup(item.id, { selectedIndex: searchUiState.selectedIndex });
        return;
    }

    hideSearchResultsPanel();
    // 选择候选后清空输入框（便于继续下一次搜索）
    try {
        const inputEl = document.getElementById('searchInput');
        if (inputEl) inputEl.value = '';
    } catch (_) { }

    const itemHighlightClass = (!item.changeType || !getHighlightClassFromChangeType(item.changeType))
        ? 'highlight-search-neutral'
        : '';

    await locateNodeInCurrentChangesPreview(item.id, {
        changeType: item.changeType,
        idPathCandidates: item.idPathCandidates,
        searchItem: item,
        highlightClass: itemHighlightClass || undefined
    });
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
    const urlLink = e && e.target ? e.target.closest('a.search-result-url-link[href]') : null;
    if (urlLink) {
        try { e.stopPropagation(); } catch (_) { }
        return;
    }

    const typeBtn = e && e.target ? e.target.closest('.changes-search-type-btn') : null;
    if (typeBtn) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const type = String(typeBtn.dataset.type || '').trim().toLowerCase();
        if (type !== 'bookmark' && type !== 'folder' && type !== 'domain') return;

        searchUiState.currentChangesTypeFilter = type;
        if (type !== 'domain' && searchUiState.currentChangesExpandedDomainGroups instanceof Set) {
            searchUiState.currentChangesExpandedDomainGroups.clear();
        }
        if (type !== 'domain' && searchUiState.currentChangesDomainGroupHostFilters instanceof Map) {
            searchUiState.currentChangesDomainGroupHostFilters.clear();
        }
        const input = document.getElementById('searchInput');
        const query = String((input && input.value != null ? input.value : searchUiState.query) || '').trim();
        if (!query) return;

        searchCurrentChangesAndRender(query);
        return;
    }

    const mainDomainSelectorChip = e && e.target ? e.target.closest('.changes-domain-selector-chip') : null;
    if (mainDomainSelectorChip) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const selectorRow = mainDomainSelectorChip.closest('.changes-domain-selector-row');
        const groupId = String(mainDomainSelectorChip.getAttribute('data-domain-group-id') || selectorRow?.getAttribute('data-domain-group-id') || '').trim();
        const host = String(mainDomainSelectorChip.getAttribute('data-domain-host') || '').trim();
        const selectedIndex = parseInt(selectorRow?.getAttribute('data-parent-index') || '-1', 10);
        if (!groupId) return;
        setCurrentChangesDomainGroupHostFilter(groupId, host, {
            selectedIndex: Number.isNaN(selectedIndex) ? searchUiState.selectedIndex : selectedIndex
        });
        return;
    }

    const mainDomainGroupEl = e && e.target ? e.target.closest('.changes-domain-group-item') : null;
    if (mainDomainGroupEl) {
        try {
            e.preventDefault();
            e.stopPropagation();
        } catch (_) { }

        const groupId = String(mainDomainGroupEl.getAttribute('data-domain-group-id') || '').trim();
        const selectedIndex = parseInt(mainDomainGroupEl.getAttribute('data-index') || '-1', 10);
        if (!groupId) return;
        toggleCurrentChangesDomainGroup(groupId, {
            selectedIndex: Number.isNaN(selectedIndex) ? searchUiState.selectedIndex : selectedIndex
        });
        return;
    }

    const mainDomainChildEl = e && e.target ? e.target.closest('.changes-domain-child-row') : null;
    if (mainDomainChildEl) {
        const groupId = String(mainDomainChildEl.getAttribute('data-domain-group-id') || '').trim();
        const childId = String(mainDomainChildEl.getAttribute('data-domain-child-id') || '').trim();
        if (!childId) return;

        let targetItem = null;
        if (groupId) {
            const groupItem = searchUiState.results.find(item => item && item.nodeType === 'domain_group' && String(item.id) === groupId);
            if (groupItem && Array.isArray(groupItem.domainChildren)) {
                targetItem = groupItem.domainChildren.find(child => child && String(child.id) === childId) || null;
            }
        }
        if (!targetItem) {
            targetItem = currentChangesSearchDb?.itemById?.get(childId) || null;
        }
        if (targetItem) {
            activateCurrentChangesSearchItem(targetItem);
        }
        return;
    }

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
    updateSearchResultSelection(idx, { scrollIntoView: false });
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
        desc: '标题 / URL / 域名 / 路径（空格=并且）',
        descEn: 'Title / URL / domain / path (space = AND)'
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
            zh_CN: '标题 / URL / 域名 / 路径搜索',
            en: 'Title / URL / Domain / Path Search'
        },
        summary: {
            zh_CN: '可搜索标题、URL、域名、路径（新路径/旧路径）；并支持书签/文件夹/域名分类切换。',
            en: 'Search title, URL, domain, and path (new/old path); supports bookmark/folder/domain type filters.'
        },
        rules: {
            zh_CN: [
                '多个关键词用空格分隔，按“并且（AND）”匹配',
                '搜索范围按当前视图模式决定：简略/集合按当前可见变化范围，详细按当前书签全量范围',
                '结果顶部可切换：书签 / 文件夹 / 域名',
                '按匹配度排序，最多显示 20 条',
                '不支持序号/哈希/日期筛选'
            ],
            en: [
                'Use spaces between keywords (AND match)',
                'Scope follows current view: Compact/Collection use current visible changes; Detailed uses full current bookmark tree',
                'Use top toggles: Bookmark / Folder / Domain',
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
    '本地': ['local', 'webdav_local', 'github_repo_local', 'webdav_github_local', 'cloud_local'],
    'local': ['local', 'webdav_local', 'github_repo_local', 'webdav_github_local', 'cloud_local'],
    '云端': ['upload', 'webdav', 'github_repo', 'cloud', 'webdav_local', 'github_repo_local', 'webdav_github_local', 'cloud_local'],
    'cloud': ['upload', 'webdav', 'github_repo', 'cloud', 'webdav_local', 'github_repo_local', 'webdav_github_local', 'cloud_local'],
    '云端1': ['webdav', 'webdav_local', 'webdav_github_local'],
    'cloud1': ['webdav', 'webdav_local', 'webdav_github_local'],
    'webdav': ['webdav', 'webdav_local', 'webdav_github_local'],
    '云端2': ['github_repo', 'github_repo_local', 'webdav_github_local'],
    'cloud2': ['github_repo', 'github_repo_local', 'webdav_github_local'],
    'github': ['github_repo', 'github_repo_local', 'webdav_github_local'],
    'repo': ['github_repo', 'github_repo_local', 'webdav_github_local'],
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
    const firstTime = syncHistory[0]?.time || 0;
    const hasher = createSearchSignatureHasher();

    hasher.push(syncHistory.length);
    hasher.push(firstTime);
    hasher.push(latestTime);

    for (const record of syncHistory) {
        hasher.push(record?.time || '');
        hasher.push(record?.fingerprint || '');
        hasher.push(record?.note || '');
        hasher.push(record?.seqNumber || '');
        hasher.push(record?.type || '');
        hasher.push(record?.direction || '');
        hasher.push(record?.status || '');
    }

    return `${syncHistory.length}:${latestTime}:${hasher.digest()}`;
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
        renderHistorySearchResultsPanel([], {
            query,
            emptyText: getSearchI18nText('searchLoading', '加载中...', 'Loading...')
        });
        return;
    }

    const db = buildBackupHistorySearchDb();
    if (!db.items || db.items.length === 0) {
        renderHistorySearchResultsPanel([], {
            query,
            emptyText: getSearchI18nText('searchNoResults', '没有找到匹配结果', 'No results')
        });
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
        const emptyText = options.emptyText || getSearchI18nText('searchNoResults', '没有找到匹配的记录', 'No matching records');
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

async function renderHistorySearchTargetPage(page) {
    const targetPage = Math.max(1, Number(page) || 1);
    const pageSize = typeof HISTORY_PAGE_SIZE !== 'undefined' ? HISTORY_PAGE_SIZE : 10;

    if (typeof refreshHistoryIndexPage === 'function') {
        await refreshHistoryIndexPage({ page: targetPage, pageSize });
    } else {
        if (typeof window !== 'undefined') {
            window.currentHistoryPage = targetPage;
        }
        try {
            currentHistoryPage = targetPage;
        } catch (_) { }
    }

    if (typeof renderHistoryView === 'function') {
        renderHistoryView();
    }

    await nextAnimationFrame();
    await nextAnimationFrame();
}

async function findHistoryRecordTarget(recordTime) {
    const targetSelector = `.commit-item[data-record-time="${recordTime}"]`;
    let target = document.querySelector(targetSelector);
    if (target) return target;

    await new Promise(resolve => setTimeout(resolve, 100));
    target = document.querySelector(targetSelector);
    if (target) return target;

    await new Promise(resolve => setTimeout(resolve, 200));
    return document.querySelector(targetSelector);
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
        
        return false;
    }

    const currentPage = typeof currentHistoryPage !== 'undefined' ? currentHistoryPage : 1;
    if (currentPage !== targetPage) {
        try {
            await renderHistorySearchTargetPage(targetPage);
        } catch (error) {
            
            if (typeof window !== 'undefined') {
                window.currentHistoryPage = targetPage;
            }
            try {
                currentHistoryPage = targetPage;
            } catch (_) { }
            if (typeof renderHistoryView === 'function') {
                renderHistoryView();
            }
        }
    }

    let target = await findHistoryRecordTarget(recordTime);
    if (!target) {
        try {
            await renderHistorySearchTargetPage(targetPage);
            target = await findHistoryRecordTarget(recordTime);
        } catch (error) {
            
        }
    }

    if (!target) {
        
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
    typeFilter: null,           // 当前筛选类型（bookmark/folder/domain）
    typeCounts: null,           // 当前筛选计数
    expandedDomainGroups: new Set(), // 域名分组展开状态
    domainGroupHostFilters: new Map(), // 域名组内子域名筛选
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
    }
}

/**
 * 清除所有历史详情搜索缓存
 */
function clearAllHistoryDetailSearchDb() {
    const count = historyDetailSearchDbMap.size;
    historyDetailSearchDbMap.clear();
    if (count > 0) {}
}

function buildNodeParentIndexForHistorySearch(tree) {
    const index = new Map();
    try {
        if (!tree || !tree[0]) return index;

        const stack = [{ node: tree[0], parentId: '' }];
        while (stack.length > 0) {
            const current = stack.pop();
            const node = current && current.node;
            if (!node || node.id == null) continue;

            const nodeId = String(node.id);
            if (!nodeId) continue;
            index.set(nodeId, current.parentId ? String(current.parentId) : '');

            if (Array.isArray(node.children) && node.children.length > 0) {
                for (let i = node.children.length - 1; i >= 0; i -= 1) {
                    stack.push({ node: node.children[i], parentId: nodeId });
                }
            }
        }
    } catch (_) { }
    return index;
}

function buildNodeIdPathFromParentIndex(targetId, parentIndex) {
    const id = String(targetId || '');
    if (!id || !(parentIndex instanceof Map) || !parentIndex.has(id)) return [];

    const path = [];
    let currentId = id;
    let guard = 0;

    while (currentId && guard++ < 1024) {
        path.push(currentId);
        const parentRaw = parentIndex.get(currentId);
        const parentId = parentRaw != null ? String(parentRaw) : '';
        if (!parentId || parentId === currentId) break;
        currentId = parentId;
        if (!parentIndex.has(currentId)) {
            path.push(currentId);
            break;
        }
    }

    return path.reverse();
}

function normalizeHistoryDetailIdPath(path, targetId = '') {
    const normalized = [];

    if (Array.isArray(path)) {
        for (const idRaw of path) {
            const id = String(idRaw || '').trim();
            if (!id) continue;
            if (normalized.length && normalized[normalized.length - 1] === id) continue;
            normalized.push(id);
        }
    }

    const target = String(targetId || '').trim();
    if (target && normalized[normalized.length - 1] !== target) {
        normalized.push(target);
    }

    return normalized;
}

function mergeHistoryDetailIdPathCandidates(...paths) {
    const seen = new Set();
    const candidates = [];

    paths.forEach((path) => {
        const normalized = normalizeHistoryDetailIdPath(path);
        if (!normalized.length) return;
        const signature = normalized.join('>');
        if (seen.has(signature)) return;
        seen.add(signature);
        candidates.push(normalized);
    });

    return candidates;
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
    const signature = getHistoryDetailSearchSignature(options);

    // 检查缓存
    const cached = historyDetailSearchDbMap.get(cacheKey);
    if (cached && cached.signature === signature) {
        return cached;
    }

    const ids = changeMap ? Array.from(changeMap.keys()).map(v => String(v)) : [];
    const idSet = new Set(ids);

    // 收集节点信息（复用 Phase 1 的函数）
    const currentInfo = collectNodeInfoForIds(currentTree, idSet);
    const oldInfo = oldTree ? collectNodeInfoForIds(oldTree, idSet) : new Map();
    const currentParentIndex = buildNodeParentIndexForHistorySearch(currentTree);
    const oldParentIndex = oldTree ? buildNodeParentIndexForHistorySearch(oldTree) : new Map();

    const changedItems = [];
    const changedItemById = new Map();

    for (const id of ids) {
        const change = changeMap ? (changeMap.get(id) || {}) : {};
        const changeType = typeof change.type === 'string' ? change.type : '';
        const changeTypeParts = changeType ? changeType.split('+') : [];

        const cur = currentInfo.get(id) || null;
        const old = oldInfo.get(id) || null;
        const title = (cur?.title || old?.title || '').trim();
        const url = (cur?.url || old?.url || '').trim();
        const nodeType = url ? 'bookmark' : 'folder';
        const currentIdPath = buildNodeIdPathFromParentIndex(id, currentParentIndex);
        const oldIdPath = buildNodeIdPathFromParentIndex(id, oldParentIndex);
        const idPathCandidates = mergeHistoryDetailIdPathCandidates(currentIdPath, oldIdPath);

        const newNamedPath = (change.moved && change.moved.newPath) ? String(change.moved.newPath) : (cur?.namedPath || '');
        const oldNamedPath = (change.moved && change.moved.oldPath) ? String(change.moved.oldPath) : (old?.namedPath || '');
        const newFolderSlash = newNamedPath ? toSearchSlashFolders(newNamedPath) : '';
        const oldFolderSlash = oldNamedPath ? toSearchSlashFolders(oldNamedPath) : '';
        const newPathSlash = newNamedPath ? toSearchSlashFull(newNamedPath) : '';
        const oldPathSlash = oldNamedPath ? toSearchSlashFull(oldNamedPath) : '';

        const titleLower = title.toLowerCase();
        const urlLower = url.toLowerCase();
        const newPathLower = (newNamedPath || '').toLowerCase();
        const oldPathLower = (oldNamedPath || '').toLowerCase();
        const domainHost = extractSearchHostFromUrl(url);
        const domainRoot = getSearchRegistrableDomain(domainHost);

        const item = {
            id,
            title,
            url,
            nodeType,
            changeType,
            changeTypeParts,
            currentIdPath,
            oldIdPath,
            idPathCandidates,
            newNamedPath,
            oldNamedPath,
            newFolderSlash,
            oldFolderSlash,
            newPathSlash,
            oldPathSlash,
            domainHost,
            domainRoot,
            __t: titleLower,
            __u: urlLower,
            __pn: newPathLower,
            __po: oldPathLower,
            __sn: (newPathSlash || newFolderSlash || '').toLowerCase(),
            __so: (oldPathSlash || oldFolderSlash || '').toLowerCase(),
            __dh: (domainHost || '').toLowerCase(),
            __dr: (domainRoot || '').toLowerCase(),
            __changed: 1
        };

        changedItems.push(item);
        changedItemById.set(id, item);
    }

    const changedFolderIdSet = new Set();
    for (const changedItem of changedItems) {
        if (changedItem && changedItem.nodeType === 'folder') {
            const folderId = String(changedItem.id || '').trim();
            if (folderId) changedFolderIdSet.add(folderId);
        }
    }
    const changedContextOldIdSet = oldTree ? collectDescendantIdsUnderFolders(oldTree, changedFolderIdSet) : new Set();
    const changedContextIdSet = collectDescendantIdsUnderFoldersFromTrees([currentTree, oldTree], changedFolderIdSet);
    const changedAncestorIdSet = collectAncestorIdsFromParentIndexes(idSet, [currentParentIndex, oldParentIndex]);

    const { items, itemById } = buildSearchItemsFromTree(currentTree, changeMap, changedItemById, { changedContextIdSet });

    const oldOnlyContextIds = [];
    changedContextOldIdSet.forEach((idRaw) => {
        const id = String(idRaw || '').trim();
        if (!id || itemById.has(id)) return;
        oldOnlyContextIds.push(id);
    });
    if (oldOnlyContextIds.length > 0) {
        const oldOnlyIdSet = new Set(oldOnlyContextIds);
        const oldContextInfo = oldTree ? collectNodeInfoForIds(oldTree, oldOnlyIdSet) : new Map();
        const currentContextInfo = collectNodeInfoForIds(currentTree, oldOnlyIdSet);

        for (const id of oldOnlyContextIds) {
            const cur = currentContextInfo.get(id) || null;
            const old = oldContextInfo.get(id) || null;
            if (!cur && !old) continue;
            if (itemById.has(id)) continue;

            const isChanged = (changeMap instanceof Map && changeMap.has(id)) || changedItemById.has(id);
            if (isChanged) continue;

            const title = (cur?.title || old?.title || '').trim();
            const url = (cur?.url || old?.url || '').trim();
            const newNamedPath = cur?.namedPath || '';
            const oldNamedPath = old?.namedPath || '';
            const newFolderSlash = newNamedPath ? toSearchSlashFolders(newNamedPath) : '';
            const oldFolderSlash = oldNamedPath ? toSearchSlashFolders(oldNamedPath) : '';
            const newPathSlash = newNamedPath ? toSearchSlashFull(newNamedPath) : '';
            const oldPathSlash = oldNamedPath ? toSearchSlashFull(oldNamedPath) : '';
            const domainHost = extractSearchHostFromUrl(url);
            const domainRoot = getSearchRegistrableDomain(domainHost);
            const currentIdPath = buildNodeIdPathFromParentIndex(id, currentParentIndex);
            const oldIdPath = buildNodeIdPathFromParentIndex(id, oldParentIndex);
            const idPathCandidates = mergeHistoryDetailIdPathCandidates(currentIdPath, oldIdPath);
            const nodeType = url ? 'bookmark' : 'folder';
            const shouldIndex = !!(title || url || newNamedPath || oldNamedPath);
            if (!shouldIndex) continue;

            const contextItem = {
                id,
                title,
                url,
                nodeType,
                changeType: '',
                changeTypeParts: [],
                currentIdPath,
                oldIdPath,
                idPathCandidates,
                newNamedPath,
                oldNamedPath,
                newFolderSlash,
                oldFolderSlash,
                newPathSlash,
                oldPathSlash,
                domainHost,
                domainRoot,
                __t: title.toLowerCase(),
                __u: url.toLowerCase(),
                __pn: (newNamedPath || '').toLowerCase(),
                __po: (oldNamedPath || '').toLowerCase(),
                __sn: (newPathSlash || newFolderSlash || '').toLowerCase(),
                __so: (oldPathSlash || oldFolderSlash || '').toLowerCase(),
                __dh: (domainHost || '').toLowerCase(),
                __dr: (domainRoot || '').toLowerCase(),
                __changed: 0,
                __changed_context: 1
            };

            items.push(contextItem);
            itemById.set(id, contextItem);
        }
    }

    for (const changedItem of changedItems) {
        const id = String(changedItem?.id || '').trim();
        if (!id) continue;

        const existing = itemById.get(id);
        if (existing) {
            existing.changeType = changedItem.changeType || existing.changeType;
            existing.changeTypeParts = Array.isArray(changedItem.changeTypeParts) ? changedItem.changeTypeParts : existing.changeTypeParts;
            if (Array.isArray(changedItem.currentIdPath) && changedItem.currentIdPath.length > 0) {
                existing.currentIdPath = changedItem.currentIdPath;
            }
            if (Array.isArray(changedItem.oldIdPath) && changedItem.oldIdPath.length > 0) {
                existing.oldIdPath = changedItem.oldIdPath;
            }
            if (changedItem.newNamedPath) existing.newNamedPath = changedItem.newNamedPath;
            if (changedItem.oldNamedPath) existing.oldNamedPath = changedItem.oldNamedPath;
            if (changedItem.newFolderSlash) existing.newFolderSlash = changedItem.newFolderSlash;
            if (changedItem.oldFolderSlash) existing.oldFolderSlash = changedItem.oldFolderSlash;
            if (changedItem.newPathSlash) existing.newPathSlash = changedItem.newPathSlash;
            if (changedItem.oldPathSlash) existing.oldPathSlash = changedItem.oldPathSlash;
            if (Array.isArray(changedItem.idPathCandidates) && changedItem.idPathCandidates.length > 0) {
                existing.idPathCandidates = changedItem.idPathCandidates;
            }
            if (changedItem.__pn) existing.__pn = changedItem.__pn;
            if (changedItem.__po) existing.__po = changedItem.__po;
            if (changedItem.__sn) existing.__sn = changedItem.__sn;
            if (changedItem.__so) existing.__so = changedItem.__so;
            if (changedItem.__dh && !existing.__dh) existing.__dh = changedItem.__dh;
            if (changedItem.__dr && !existing.__dr) existing.__dr = changedItem.__dr;
            existing.__changed = 1;
            existing.__changed_context = 0;
            continue;
        }

        const cloned = {
            ...changedItem,
            __changed: 1,
            __changed_context: 0
        };
        items.push(cloned);
        itemById.set(id, cloned);
    }

    const renderTreeRoot = Array.isArray(currentTree) ? currentTree[0] : null;
    const dataOrderMap = buildCurrentChangesTreeOrderMapFromRoot(renderTreeRoot);

    const db = {
        signature,
        size: ids.length,
        items,
        itemById,
        changedItems,
        changedItemById,
        simpleScopedIdSet: (() => {
            const set = new Set();
            idSet.forEach((v) => set.add(String(v)));
            changedContextIdSet.forEach((v) => set.add(String(v)));
            changedAncestorIdSet.forEach((v) => set.add(String(v)));
            return set;
        })(),
        collectionScopedIdSet: buildCollectionScopedIdSetFromTree(currentTree, changeMap),
        renderableIdSet: buildCurrentChangesNodeIdSetFromRoot(renderTreeRoot),
        dataOrderMap
    };

    historyDetailSearchDbMap.set(cacheKey, db);

    return db;
}

function getHistoryDetailSearchScopeMode(modalContainer) {
    try {
        const activeBtn = modalContainer?.querySelector('#historyDetailModeToggleModal .toggle-btn.active[data-mode]');
        const mode = String(activeBtn?.dataset?.mode || '').toLowerCase();
        if (mode === 'simple' || mode === 'detailed' || mode === 'collection') return mode;
    } catch (_) { }

    try {
        if (typeof getRecordDetailMode === 'function') {
            const recordMode = String(getRecordDetailMode(historyDetailSearchState.recordTime) || '').toLowerCase();
            if (recordMode === 'simple' || recordMode === 'detailed' || recordMode === 'collection') return recordMode;
        }
    } catch (_) { }

    return 'detailed';
}

function getHistoryDetailScopedSearchMeta(db, modalContainer) {
    const mode = getHistoryDetailSearchScopeMode(modalContainer);
    const allItems = Array.isArray(db?.items) ? db.items : [];
    const emptyMeta = { items: [], orderMap: new Map(), mode };
    if (!allItems.length) return emptyMeta;

    const treeContainer = modalContainer?.querySelector('.history-tree-container');
    const visibleOrderMap = buildCurrentChangesDomOrderMap(treeContainer, { visibleOnly: true });
    const visibleScopedIdSet = visibleOrderMap.size > 0 ? new Set(visibleOrderMap.keys()) : null;
    const dataOrderMap = db && db.dataOrderMap instanceof Map
        ? db.dataOrderMap
        : buildCurrentChangesDomOrderMap(treeContainer, { visibleOnly: false });

    if (mode === 'collection') {
        const collectionScopedIdSet = db && db.collectionScopedIdSet instanceof Set ? db.collectionScopedIdSet : null;
        if (collectionScopedIdSet && collectionScopedIdSet.size > 0) {
            const scopedItems = allItems.filter(item => item && collectionScopedIdSet.has(String(item.id || '')));
            if (scopedItems.length > 0) {
                return { items: scopedItems, orderMap: dataOrderMap, mode };
            }
        }

        if (visibleScopedIdSet && visibleScopedIdSet.size > 0) {
            const visibleItems = allItems.filter(item => item && visibleScopedIdSet.has(String(item.id || '')));
            if (visibleItems.length > 0) {
                return { items: visibleItems, orderMap: visibleOrderMap, mode };
            }
        }
        return emptyMeta;
    }

    if (mode === 'simple') {
        const simpleScopedIdSet = db && db.simpleScopedIdSet instanceof Set ? db.simpleScopedIdSet : null;
        if (simpleScopedIdSet && simpleScopedIdSet.size > 0) {
            const scopedItems = allItems.filter(item => item && simpleScopedIdSet.has(String(item.id || '')));
            if (scopedItems.length > 0) {
                return { items: scopedItems, orderMap: dataOrderMap, mode };
            }
        }

        const simpleFallback = allItems.filter(item => item && (item.__changed || item.__changed_context));
        if (simpleFallback.length > 0) {
            return { items: simpleFallback, orderMap: dataOrderMap, mode };
        }
        return emptyMeta;
    }

    if (mode === 'detailed') {
        const renderableIdSet = db && db.renderableIdSet instanceof Set ? db.renderableIdSet : null;
        if (renderableIdSet && renderableIdSet.size > 0) {
            const scopedItems = allItems.filter(item => item && renderableIdSet.has(String(item.id || '')));
            return { items: scopedItems, orderMap: dataOrderMap, mode };
        }
        return emptyMeta;
    }

    const fallbackOrderMap = visibleOrderMap.size > 0 ? visibleOrderMap : dataOrderMap;
    const scoped = allItems.filter(item => item && (item.__changed || item.__changed_context));
    if (scoped.length > 0) {
        return { items: scoped, orderMap: fallbackOrderMap, mode };
    }
    if (Array.isArray(db?.changedItems) && db.changedItems.length > 0) {
        return { items: db.changedItems, orderMap: fallbackOrderMap, mode };
    }
    return {
        items: allItems.filter(item => item && item.__changed),
        orderMap: fallbackOrderMap,
        mode
    };
}

// ==================== Phase 2.5: 搜索执行 ====================

/**
 * 执行历史详情搜索
 * @param {string} query - 搜索关键词
 * @param {Object} db - 搜索数据库
 * @returns {Array} 搜索结果
 */
function searchHistoryDetailChanges(query, db, options = {}) {
    if (!db || !db.items || db.items.length === 0) {
        return [];
    }

    const tokens = String(query).toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (!tokens.length) {
        return [];
    }

    const scopedMeta = getHistoryDetailScopedSearchMeta(db, options.modalContainer);
    const scopedItems = Array.isArray(scopedMeta?.items) ? scopedMeta.items : [];
    const scopedOrderMap = scopedMeta && scopedMeta.orderMap instanceof Map
        ? scopedMeta.orderMap
        : new Map();
    if (!scopedItems.length) {
        return [];
    }

    const allowPathMatch = shouldEnablePathFieldMatch(query);
    const scored = [];
    for (const item of scopedItems) {
        const s = scoreCurrentChangesSearchItem(item, tokens, { allowPathMatch, query });
        if (s > -Infinity) scored.push({ item, s });
    }

    scored.sort((a, b) => compareScopedSearchMatches(a, b, scopedOrderMap));

    return scored.map(x => x.item);
}

function rerenderHistoryDetailSearchForQuery(modalContainer, options = {}) {
    if (!modalContainer) return false;

    const buildDbIfNeeded = typeof modalContainer._historyDetailSearchBuildDb === 'function'
        ? modalContainer._historyDetailSearchBuildDb
        : null;
    if (!buildDbIfNeeded) return false;

    const searchInput = modalContainer.querySelector('.detail-search-input');
    const query = String(
        options.query != null
            ? options.query
            : ((searchInput && searchInput.value != null ? searchInput.value : historyDetailSearchState.query) || '')
    ).trim();
    if (!query) return false;

    const searchDb = buildDbIfNeeded();
    const results = searchHistoryDetailChanges(query, searchDb, { modalContainer });
    renderHistoryDetailSearchResults(results, modalContainer, {
        query,
        recordTime: historyDetailSearchState.recordTime
    });

    const selectedIndex = Number.isFinite(Number(options.selectedIndex))
        ? Number(options.selectedIndex)
        : null;
    if (selectedIndex !== null) {
        updateHistoryDetailSearchSelection(modalContainer, selectedIndex, { scrollIntoView: false });
    }
    return true;
}

function toggleHistoryDetailDomainGroup(modalContainer, groupId, options = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) return false;

    if (!(historyDetailSearchState.expandedDomainGroups instanceof Set)) {
        historyDetailSearchState.expandedDomainGroups = new Set();
    }

    if (historyDetailSearchState.expandedDomainGroups.has(normalizedGroupId)) {
        historyDetailSearchState.expandedDomainGroups.delete(normalizedGroupId);
    } else {
        historyDetailSearchState.expandedDomainGroups.add(normalizedGroupId);
    }

    return rerenderHistoryDetailSearchForQuery(modalContainer, options);
}

function setHistoryDetailDomainGroupHostFilter(modalContainer, groupId, host, options = {}) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) return false;

    if (!(historyDetailSearchState.domainGroupHostFilters instanceof Map)) {
        historyDetailSearchState.domainGroupHostFilters = new Map();
    }
    if (!(historyDetailSearchState.expandedDomainGroups instanceof Set)) {
        historyDetailSearchState.expandedDomainGroups = new Set();
    }

    const normalizedHost = normalizeSearchDomainHostValue(host);
    const currentHost = normalizeSearchDomainHostValue(historyDetailSearchState.domainGroupHostFilters.get(normalizedGroupId));
    if (normalizedHost && currentHost !== normalizedHost) {
        historyDetailSearchState.domainGroupHostFilters.set(normalizedGroupId, normalizedHost);
    } else {
        historyDetailSearchState.domainGroupHostFilters.delete(normalizedGroupId);
    }
    historyDetailSearchState.expandedDomainGroups.add(normalizedGroupId);

    return rerenderHistoryDetailSearchForQuery(modalContainer, options);
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

    const { query = '', recordTime = null } = options;
    try {
        const searchInput = modalContainer?.querySelector('.detail-search-input');
        const currentQ = (searchInput && typeof searchInput.value === 'string')
            ? searchInput.value.trim().toLowerCase()
            : '';
        const expectedQ = String(query || '').trim().toLowerCase();
        const activeRecordTime = String(modalContainer?.dataset?.searchRecordTime || historyDetailSearchState.recordTime || '');
        const expectedRecordTime = String(recordTime != null ? recordTime : historyDetailSearchState.recordTime || '');
        if (currentQ !== expectedQ) return;
        if (historyDetailSearchState.isActive === false) return;
        if (expectedRecordTime && activeRecordTime && expectedRecordTime !== activeRecordTime) return;
    } catch (_) { }

    const sourceResults = Array.isArray(results) ? results : [];
    const tokens = String(query).toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean);
    let domainMatchedItems = [];
    try {
        const buildDbIfNeeded = typeof modalContainer?._historyDetailSearchBuildDb === 'function'
            ? modalContainer._historyDetailSearchBuildDb
            : null;
        const searchDb = buildDbIfNeeded ? buildDbIfNeeded() : null;
        const scopedMeta = searchDb ? getHistoryDetailScopedSearchMeta(searchDb, modalContainer) : null;
        const scopedItems = Array.isArray(scopedMeta?.items) ? scopedMeta.items : [];
        domainMatchedItems = getDomainMatchedSearchItems(scopedItems, tokens, { query });
    } catch (_) {
        domainMatchedItems = getDomainMatchedSearchItems(sourceResults, tokens, { query });
    }
    const { filtered, counts, activeFilter } = filterSearchItemsByType(sourceResults, historyDetailSearchState.typeFilter, {
        domainGrouped: true,
        domainMatchedItems
    });

    const MAX_RESULTS = Number.isFinite(Number(options.maxResults)) ? Math.max(1, Number(options.maxResults)) : 20;
    const limitedResults = filtered.slice(0, MAX_RESULTS);

    historyDetailSearchState.query = query;
    historyDetailSearchState.results = limitedResults;
    historyDetailSearchState.typeCounts = counts;
    historyDetailSearchState.typeFilter = activeFilter;
    historyDetailSearchState.selectedIndex = -1;
    if (!(historyDetailSearchState.expandedDomainGroups instanceof Set)) {
        historyDetailSearchState.expandedDomainGroups = new Set();
    }
    if (!(historyDetailSearchState.domainGroupHostFilters instanceof Map)) {
        historyDetailSearchState.domainGroupHostFilters = new Map();
    }
    if (activeFilter !== 'domain') {
        historyDetailSearchState.expandedDomainGroups.clear();
        historyDetailSearchState.domainGroupHostFilters.clear();
    }

    if (!sourceResults.length && !limitedResults.length) {
        const emptyText = options.emptyText || getSearchI18nText('searchNoResults', '无匹配结果', 'No results');
        const typeToggleHtml = buildSearchTypeToggleHtml(counts, activeFilter, { variant: 'detail' });
        panel.innerHTML = `${typeToggleHtml}<div class="search-results-empty">${escapeHtml(emptyText)}</div>`;
        showHistoryDetailSearchPanel(modalContainer);
        return;
    }

    const isZh = typeof currentLang !== 'undefined' && currentLang === 'zh_CN';

    const rowsHtml = historyDetailSearchState.results.map((item, idx) => {
        const parts = Array.isArray(item.changeTypeParts) ? item.changeTypeParts : [];
        const badges = [];
        if (parts.includes('added') || item.changeType === 'added') badges.push(`<span class="search-change-prefix added" title="${isZh ? '新增' : 'Added'}">+</span>`);
        if (parts.includes('deleted') || item.changeType === 'deleted') badges.push(`<span class="search-change-prefix deleted" title="${isZh ? '删除' : 'Deleted'}">-</span>`);
        if (parts.includes('moved')) badges.push(`<span class="search-change-prefix moved" title="${isZh ? '移动' : 'Moved'}">>></span>`);
        if (parts.includes('modified')) badges.push(`<span class="search-change-prefix modified" title="${isZh ? '修改' : 'Modified'}">~</span>`);
        const badgesHtml = badges.length ? badges.join('') : '';
        const changeIconsHtml = badgesHtml ? `<span class="search-change-icons">${badgesHtml}</span>` : '';

        if (item.nodeType === 'domain_group') {
            const groupIdRaw = String(item.id || `domain-group-${idx}`);
            const groupId = escapeHtml(groupIdRaw);
            const isExpanded = historyDetailSearchState.expandedDomainGroups.has(groupIdRaw);
            const safeTitle = escapeHtml(item.title || (isZh ? '域名分组' : 'Domain group'));
            const metaText = item.meta ? escapeHtml(item.meta) : '';
            const chevronClass = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';
            const selectedHost = historyDetailSearchState.domainGroupHostFilters instanceof Map
                ? (historyDetailSearchState.domainGroupHostFilters.get(groupIdRaw) || '')
                : '';
            const childRowsHtml = isExpanded
                ? `${renderSearchDomainGroupSelectorRow(item, groupIdRaw, { variant: 'detail', groupIndex: idx, selectedHost })}${renderSearchDomainGroupChildren(item, groupIdRaw, { variant: 'detail', isZh, selectedHost })}`
                : '';

            return `
                <div class="search-result-item detail-domain-group-item ${isExpanded ? 'expanded' : ''}" role="option" data-index="${idx}" data-node-id="${escapeHtml(item.id)}" data-domain-group-id="${groupId}">
                    <div class="search-result-row">
                        <div class="search-result-main">
                            <div class="search-result-title">
                                <span class="search-result-index">${idx + 1}</span>
                                <span class="detail-domain-group-chevron"><i class="fas ${chevronClass}"></i></span>
                                <i class="fas fa-globe" style="color:#0ea5e9; font-size:12px;"></i>
                                <span>${safeTitle}</span>
                            </div>
                            ${metaText ? `<div class="search-result-meta">${metaText}</div>` : ''}
                        </div>
                    </div>
                </div>
                ${childRowsHtml}
            `;
        }

        const safeTitle = escapeHtml(item.title || (isZh ? '（无标题）' : '(Untitled)'));
        const metaText = item.meta
            ? String(item.meta)
            : (item.nodeType === 'bookmark' && item.url ? String(item.url) : '');
        const metaHtml = renderSearchMetaContent(item, metaText);
        const typeIconHtml = item.nodeType === 'folder'
            ? '<i class="fas fa-folder" style="color:#2563eb; font-size:12px;"></i>'
            : (item.nodeType === 'domain_group'
                ? '<i class="fas fa-globe" style="color:#0ea5e9; font-size:12px;"></i>'
                : '<i class="fas fa-bookmark" style="color:#f59e0b; font-size:12px;"></i>');

        return `
            <div class="search-result-item" role="option" data-index="${idx}" data-node-id="${escapeHtml(item.id)}" data-change-type="${escapeHtml(item.changeType || '')}">
                <div class="search-result-row">
                    <div class="search-result-main">
                        <div class="search-result-title">
                            <span class="search-result-index">${idx + 1}</span>
                            ${changeIconsHtml}
                            ${typeIconHtml}
                            <span>${safeTitle}</span>
                        </div>
                        ${metaHtml ? `<div class="search-result-meta">${metaHtml}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const typeToggleHtml = buildSearchTypeToggleHtml(counts, activeFilter, { variant: 'detail' });
    panel.innerHTML = `${typeToggleHtml}${rowsHtml}`;
    showHistoryDetailSearchPanel(modalContainer);
    updateHistoryDetailSearchSelection(modalContainer, 0);
}

/**
 * 更新模态框内搜索结果的选中状态
 * @param {Element} modalContainer - 模态框容器
 * @param {number} nextIndex - 下一个选中索引
 */
function updateHistoryDetailSearchSelection(modalContainer, nextIndex, options = {}) {
    const { scrollIntoView = true } = options;
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
        if (scrollIntoView) {
            try {
                selectedEl.scrollIntoView({ block: 'nearest' });
            } catch (_) { }
        }
    }
    historyDetailSearchState.selectedIndex = clamped;
}

// ==================== Phase 2.5: 定位与高亮 ====================

function getTreeItemByNodeIdInContainer(treeContainer, nodeId) {
    return queryTreeItemByLookupId(treeContainer, nodeId);
}

function getHistoryDetailSearchLazyContext(treeContainer, options = {}) {
    try {
        if (!(window.__historyTreeLazyContexts instanceof Map)) return null;

        const treeLazyKey = treeContainer?.dataset?.lazyKey ? String(treeContainer.dataset.lazyKey) : '';
        const fallbackKey = options.recordTime != null
            ? String(options.recordTime)
            : String(historyDetailSearchState.recordTime || '');
        const contextKey = treeLazyKey || fallbackKey;
        if (!contextKey) return null;

        return window.__historyTreeLazyContexts.get(contextKey) || null;
    } catch (_) {
        return null;
    }
}

async function expandHistoryDetailFolderItemForSearch(folderItem, treeContainer, options = {}) {
    if (!folderItem) return null;
    const nodeType = folderItem.getAttribute('data-node-type') || folderItem.dataset?.nodeType;
    if (nodeType !== 'folder') return null;

    const treeNode = folderItem.closest('.tree-node');
    const children = treeNode?.querySelector(':scope > .tree-children');
    if (!children) return null;

    const toggle = folderItem.querySelector('.tree-toggle:not([style*="opacity: 0"])') || folderItem.querySelector('.tree-toggle');
    if (toggle) toggle.classList.add('expanded');
    children.classList.add('expanded');

    const folderIcon = folderItem.querySelector('.tree-icon.fa-folder, .tree-icon.fa-folder-open');
    if (folderIcon) {
        folderIcon.classList.remove('fa-folder');
        folderIcon.classList.add('fa-folder-open');
    }

    if (children.dataset && children.dataset.childrenLoaded === 'false') {
        const lazyContext = options.lazyContext || getHistoryDetailSearchLazyContext(treeContainer, options);
        if (lazyContext && typeof lazyContext.renderChildren === 'function') {
            const html = lazyContext.renderChildren(
                folderItem.dataset ? folderItem.dataset.nodeId : '',
                children.dataset ? children.dataset.childLevel : '',
                children.dataset ? children.dataset.nextForceInclude : '',
                0
            );
            children.innerHTML = typeof html === 'string' ? html : '';
            children.dataset.childrenLoaded = 'true';
        }
    }

    return children;
}

function appendHistoryDetailLoadMoreBatch(loadMoreBtn, treeContainer, options = {}) {
    if (!loadMoreBtn) return false;
    const children = loadMoreBtn.closest('.tree-children');
    if (!children) return false;

    const lazyContext = options.lazyContext || getHistoryDetailSearchLazyContext(treeContainer, options);
    if (!lazyContext || typeof lazyContext.renderChildren !== 'function') return false;

    const startIndexRaw = Number.parseInt(loadMoreBtn.dataset.startIndex || '0', 10);
    const startIndex = Number.isFinite(startIndexRaw) ? Math.max(0, startIndexRaw) : 0;
    const parentId = loadMoreBtn.dataset.parentId
        || (children.dataset ? children.dataset.parentId : '')
        || '';

    const html = lazyContext.renderChildren(
        parentId,
        children.dataset ? children.dataset.childLevel : '',
        children.dataset ? children.dataset.nextForceInclude : '',
        startIndex
    );

    if (typeof html !== 'string' || !html) {
        try { loadMoreBtn.remove(); } catch (_) { }
        if (children.dataset) children.dataset.childrenLoaded = 'true';
        return false;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const fragment = document.createDocumentFragment();
    while (tempDiv.firstChild) fragment.appendChild(tempDiv.firstChild);
    try { loadMoreBtn.remove(); } catch (_) { }
    children.appendChild(fragment);
    if (children.dataset) children.dataset.childrenLoaded = 'true';
    return true;
}

async function ensureHistoryDetailPathRendered(idPath, treeContainer, options = {}) {
    if (!treeContainer) return null;
    const normalizedPath = normalizeHistoryDetailIdPath(idPath);
    if (!normalizedPath.length) return null;

    const findItem = (id) => getTreeItemByNodeIdInContainer(treeContainer, id);
    const targetId = normalizedPath[normalizedPath.length - 1];

    let startIndex = 0;
    while (startIndex < normalizedPath.length && !findItem(normalizedPath[startIndex])) {
        startIndex += 1;
    }
    if (startIndex >= normalizedPath.length) return null;

    const lazyContext = options.lazyContext || getHistoryDetailSearchLazyContext(treeContainer, options);

    for (let i = startIndex; i < normalizedPath.length - 1; i += 1) {
        const currentId = normalizedPath[i];
        const nextId = normalizedPath[i + 1];
        const currentItem = findItem(currentId);
        if (!currentItem) return null;

        const children = await expandHistoryDetailFolderItemForSearch(currentItem, treeContainer, {
            ...options,
            lazyContext
        });

        let nextItem = findItem(nextId);
        if (!nextItem && children) {
            let guard = 0;
            while (!nextItem && guard++ < 256) {
                const loadMoreBtn = children.querySelector(':scope > .tree-load-more');
                if (!loadMoreBtn) break;
                const progressed = appendHistoryDetailLoadMoreBatch(loadMoreBtn, treeContainer, {
                    ...options,
                    lazyContext
                });
                if (!progressed) break;
                nextItem = findItem(nextId);
            }
        }

        if (!nextItem) return null;
    }

    return findItem(targetId);
}

async function ensureHistoryDetailTargetRendered(nodeId, treeContainer, options = {}) {
    const id = String(nodeId || '');
    if (!id || !treeContainer) return null;
    const searchItem = options && options.searchItem ? options.searchItem : null;

    let target = getTreeItemByNodeIdInContainer(treeContainer, id);
    if (target) return target;

    const pathCandidates = Array.isArray(options.idPathCandidates) ? options.idPathCandidates : [];
    for (const path of pathCandidates) {
        target = await ensureHistoryDetailPathRendered(path, treeContainer, options);
        if (target) return target;
    }

    if (searchItem) {
        try {
            target = findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem);
            if (target) return target;
        } catch (_) { }
    }

    return getTreeItemByNodeIdInContainer(treeContainer, id);
}

/**
 * 在历史详情的树预览中定位到指定节点
 * @param {string} nodeId - 节点 ID
 * @param {Element} treeContainer - 树预览容器
 * @param {Object} options - 定位选项
 */
async function waitHistoryDetailDomSettle(treeContainer, options = {}) {
    const target = treeContainer || document.querySelector('#modalBody .history-tree-container');
    if (!target) return;

    const idleMsRaw = Number(options.idleMs);
    const timeoutMsRaw = Number(options.timeoutMs);
    const idleMs = Number.isFinite(idleMsRaw) ? Math.max(30, idleMsRaw) : 70;
    const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(idleMs + 20, timeoutMsRaw) : 380;

    await new Promise((resolve) => {
        if (typeof MutationObserver !== 'function') {
            setTimeout(resolve, idleMs);
            return;
        }

        let done = false;
        let idleTimer = null;
        let timeoutTimer = null;
        let observer = null;

        const finish = () => {
            if (done) return;
            done = true;
            try { if (observer) observer.disconnect(); } catch (_) { }
            try { if (idleTimer) clearTimeout(idleTimer); } catch (_) { }
            try { if (timeoutTimer) clearTimeout(timeoutTimer); } catch (_) { }
            resolve();
        };

        const bumpIdle = () => {
            try { if (idleTimer) clearTimeout(idleTimer); } catch (_) { }
            idleTimer = setTimeout(finish, idleMs);
        };

        try {
            observer = new MutationObserver(() => {
                bumpIdle();
            });
            observer.observe(target, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['class', 'data-children-loaded', 'data-start-index']
            });
        } catch (_) {
            finish();
            return;
        }

        bumpIdle();
        timeoutTimer = setTimeout(finish, timeoutMs);
    });
}

async function stabilizeHistoryDetailTargetForJump(nodeId, treeContainer) {
    const id = String(nodeId || '').trim();
    if (!id || !treeContainer) return null;

    const findTarget = () => getTreeItemByNodeIdInContainer(treeContainer, id);
    let target = findTarget();
    if (!target) return null;

    expandAncestorsForTreeItem(target, treeContainer);
    await nextAnimationFrame();
    await nextAnimationFrame();
    await waitHistoryDetailDomSettle(treeContainer, { idleMs: 70, timeoutMs: 380 });

    target = findTarget() || target;
    expandAncestorsForTreeItem(target, treeContainer);
    await nextAnimationFrame();

    return findTarget() || target;
}

function clearHistoryDetailSearchHighlights(treeContainer) {
    if (!treeContainer) return;

    const selectors = [
        '.tree-item.highlight-added',
        '.tree-item.highlight-deleted',
        '.tree-item.highlight-moved',
        '.tree-item.highlight-modified',
        '.tree-item.highlight-search-neutral'
    ];
    try {
        treeContainer.querySelectorAll(selectors.join(',')).forEach((el) => {
            try {
                el.classList.remove('highlight-added', 'highlight-deleted', 'highlight-moved', 'highlight-modified', 'highlight-search-neutral');
            } catch (_) { }
        });
    } catch (_) { }
}

function triggerHistoryDetailSearchHighlight(target, highlightClass, durationMs = 1200) {
    if (!target || !highlightClass) return;

    try { target.classList.remove(highlightClass); } catch (_) { }
    try { void target.offsetWidth; } catch (_) { }
    try { target.classList.add(highlightClass); } catch (_) { return; }

    setTimeout(() => {
        try { target.classList.remove(highlightClass); } catch (_) { }
    }, durationMs);
}

function applyHistoryDetailSearchHighlightImmediate(target, highlightClass) {
    if (!target || !highlightClass) return;
    try { target.classList.add(highlightClass); } catch (_) { }
}

async function locateNodeInHistoryDetailPreview(nodeId, treeContainer, options = {}) {
    if (!treeContainer) return false;

    const id = String(nodeId || '').trim();
    if (!id) return false;
    const findTarget = () => getTreeItemByNodeIdInContainer(treeContainer, id);
    const searchItem = options && options.searchItem ? options.searchItem : null;
    const highlightClass = options.highlightClass || getHighlightClassFromChangeType(options.changeType || '');

    let target = findTarget();
    if (!target) {
        target = await ensureHistoryDetailTargetRendered(id, treeContainer, options);
    }
    if (!target && searchItem) {
        try {
            target = findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem);
        } catch (_) { }
    }
    if (!target) {
        try {
            target = await ensureCurrentChangesHistoryTreeTargetByScan(id, treeContainer, options);
        } catch (_) { }
    }
    if (!target && searchItem) {
        try {
            await waitHistoryDetailDomSettle(treeContainer, { idleMs: 80, timeoutMs: 420 });
            target = findTarget() || findCurrentChangesSearchTreeItemByContent(treeContainer, searchItem);
            if (!target) {
                target = await ensureCurrentChangesHistoryTreeTargetByScan(id, treeContainer, options);
            }
        } catch (_) { }
    }
    if (!target) {
        try {
            await waitHistoryDetailDomSettle(treeContainer, { idleMs: 60, timeoutMs: 240 });
            target = await ensureHistoryDetailTargetRendered(id, treeContainer, options);
            if (!target) {
                target = await ensureCurrentChangesHistoryTreeTargetByScan(id, treeContainer, options);
            }
        } catch (_) { }
    }

    if (!target) {
        return false;
    }

    if (highlightClass) {
        clearHistoryDetailSearchHighlights(treeContainer);
        applyHistoryDetailSearchHighlightImmediate(target, highlightClass);
    }

    expandAncestorsForTreeItem(target, treeContainer);
    await nextAnimationFrame();
    target = findTarget() || target;

    try {
        target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }

    target = (await stabilizeHistoryDetailTargetForJump(id, treeContainer)) || target;
    if (!target) return false;

    if (highlightClass) {
        clearHistoryDetailSearchHighlights(treeContainer);
        applyHistoryDetailSearchHighlightImmediate(target, highlightClass);
    }

    try {
        target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }

    await waitHistoryDetailDomSettle(treeContainer, { idleMs: 50, timeoutMs: 220 });
    target = findTarget() || target;
    try {
        target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    } catch (_) {
        try { target.scrollIntoView(); } catch (_) { }
    }

    if (highlightClass) {
        clearHistoryDetailSearchHighlights(treeContainer);
        triggerHistoryDetailSearchHighlight(target, highlightClass, 1400);
    }

    return true;
}

// ==================== Phase 2.5: 激活搜索结果 ====================

function closeHistoryDetailSearchBox(modalContainer, options = {}) {
    if (!modalContainer) return;
    const { clearInput = false } = options;

    const searchContainer = modalContainer.querySelector('.detail-search-container');
    const searchBtn = modalContainer.querySelector('.detail-search-btn');
    if (searchContainer) searchContainer.classList.remove('visible');
    if (searchBtn) searchBtn.classList.remove('active');

    hideHistoryDetailSearchPanel(modalContainer);

    if (clearInput) {
        const searchInput = modalContainer.querySelector('.detail-search-input');
        if (searchInput) searchInput.value = '';
    }
}

/**
 * 激活历史详情搜索结果
 * @param {Object} item - 搜索项
 * @param {Element} modalContainer - 模态框容器
 */
async function activateHistoryDetailSearchItem(item, modalContainer) {
    if (!item) return;

    // 选中后关闭搜索弹窗，避免遮挡详情树
    closeHistoryDetailSearchBox(modalContainer, { clearInput: true });

    // 定位到目标节点
    const treeContainer = modalContainer?.querySelector('.history-tree-container');
    const itemHighlightClass = (!item.changeType || !getHighlightClassFromChangeType(item.changeType))
        ? 'highlight-search-neutral'
        : '';
    if (treeContainer) {
        await locateNodeInHistoryDetailPreview(item.id, treeContainer, {
            changeType: item.changeType,
            idPathCandidates: item.idPathCandidates,
            searchItem: item,
            highlightClass: itemHighlightClass || undefined,
            recordTime: historyDetailSearchState.recordTime
        });
    }
}

/**
 * 激活历史详情搜索结果（按索引）
 * @param {number} index - 结果索引
 * @param {Element} modalContainer - 模态框容器
 */
async function activateHistoryDetailSearchResult(index, modalContainer) {
    try {
        const idx = typeof index === 'number' ? index : parseInt(index, 10);
        if (Number.isNaN(idx) || idx < 0 || idx >= historyDetailSearchState.results.length) return;

        const item = historyDetailSearchState.results[idx];
        if (!item) return;
        if (item.nodeType === 'domain_group') {
            toggleHistoryDetailDomainGroup(modalContainer, item.id, { selectedIndex: idx });
            return;
        }
        await activateHistoryDetailSearchItem(item, modalContainer);
    } catch (error) {
        
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
    try {
        modalContainer.dataset.searchRecordTime = recordTime;
    } catch (_) { }
    historyDetailSearchState.recordTime = recordTime;
    historyDetailSearchState.typeFilter = null;
    historyDetailSearchState.typeCounts = null;
    historyDetailSearchState.expandedDomainGroups = new Set();
    historyDetailSearchState.domainGroupHostFilters = new Map();
    historyDetailSearchState.isActive = true;

    // 检查是否有变化可搜索
    if (!changeMap || changeMap.size === 0) {
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
    modalContainer._historyDetailSearchBuildDb = buildDbIfNeeded;

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

            const normalizedQuery = String(query || '').trim().toLowerCase();
            const previousQuery = String(historyDetailSearchState.query || '').trim().toLowerCase();
            if (normalizedQuery !== previousQuery) {
                historyDetailSearchState.expandedDomainGroups = new Set();
                historyDetailSearchState.domainGroupHostFilters = new Map();
                historyDetailSearchState.typeFilter = null;
            }

            const searchDb = buildDbIfNeeded();
            const results = searchHistoryDetailChanges(query, searchDb, { modalContainer });
            renderHistoryDetailSearchResults(results, modalContainer, { query, recordTime });
        }, 200);
    };

    // 键盘事件处理
    const handleKeydown = (e) => {
        const panel = getHistoryDetailSearchPanel(modalContainer);
        const isVisible = panel && panel.classList.contains('visible');

        if (!isVisible) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeHistoryDetailSearchBox(modalContainer);
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
            const idx = historyDetailSearchState.selectedIndex;
            const item = idx >= 0 ? historyDetailSearchState.results[idx] : null;
            if (item && item.nodeType === 'domain_group') {
                toggleHistoryDetailDomainGroup(modalContainer, item.id, { selectedIndex: idx });
                return;
            }
            activateHistoryDetailSearchResult(idx, modalContainer);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeHistoryDetailSearchBox(modalContainer);
        }
    };

    // 点击结果
    const handleResultClick = (e) => {
        const urlLink = e.target.closest('a.search-result-url-link[href]');
        if (urlLink) {
            try { e.stopPropagation(); } catch (_) { }
            return;
        }

        const typeBtn = e.target.closest('.detail-search-type-btn');
        if (typeBtn) {
            try {
                e.preventDefault();
                e.stopPropagation();
            } catch (_) { }

        const type = String(typeBtn.dataset.type || '').trim().toLowerCase();
        if (type !== 'bookmark' && type !== 'folder' && type !== 'domain') return;
        historyDetailSearchState.typeFilter = type;
        if (type !== 'domain' && historyDetailSearchState.expandedDomainGroups instanceof Set) {
            historyDetailSearchState.expandedDomainGroups.clear();
        }
        if (type !== 'domain' && historyDetailSearchState.domainGroupHostFilters instanceof Map) {
            historyDetailSearchState.domainGroupHostFilters.clear();
        }
        rerenderHistoryDetailSearchForQuery(modalContainer, { selectedIndex: historyDetailSearchState.selectedIndex });
        return;
    }

        const domainSelectorChip = e.target.closest('.detail-domain-selector-chip');
        if (domainSelectorChip) {
            try {
                e.preventDefault();
                e.stopPropagation();
            } catch (_) { }

            const selectorRow = domainSelectorChip.closest('.detail-domain-selector-row');
            const groupId = String(domainSelectorChip.getAttribute('data-domain-group-id') || selectorRow?.getAttribute('data-domain-group-id') || '').trim();
            const host = String(domainSelectorChip.getAttribute('data-domain-host') || '').trim();
            const selectedIndex = parseInt(selectorRow?.getAttribute('data-parent-index') || '-1', 10);
            if (!groupId) return;
            setHistoryDetailDomainGroupHostFilter(modalContainer, groupId, host, {
                selectedIndex: Number.isNaN(selectedIndex) ? historyDetailSearchState.selectedIndex : selectedIndex
            });
            return;
        }

        const domainGroupEl = e.target.closest('.detail-domain-group-item');
        if (domainGroupEl) {
            try {
                e.preventDefault();
                e.stopPropagation();
            } catch (_) { }

            const groupId = String(domainGroupEl.getAttribute('data-domain-group-id') || '').trim();
            const selectedIndex = parseInt(domainGroupEl.getAttribute('data-index') || '-1', 10);
            if (!groupId) return;
            toggleHistoryDetailDomainGroup(modalContainer, groupId, {
                selectedIndex: Number.isNaN(selectedIndex) ? historyDetailSearchState.selectedIndex : selectedIndex
            });
            return;
        }

        const domainChildEl = e.target.closest('.detail-domain-child-row');
        if (domainChildEl) {
            const groupId = String(domainChildEl.getAttribute('data-domain-group-id') || '').trim();
            const childId = String(domainChildEl.getAttribute('data-domain-child-id') || '').trim();
            if (!childId) return;

            let targetItem = null;
            if (groupId) {
                const groupItem = historyDetailSearchState.results.find(item => item && item.nodeType === 'domain_group' && String(item.id) === groupId);
                if (groupItem && Array.isArray(groupItem.domainChildren)) {
                    targetItem = groupItem.domainChildren.find(child => child && String(child.id) === childId) || null;
                }
            }
            if (!targetItem) {
                const searchDb = buildDbIfNeeded();
                targetItem = searchDb?.itemById?.get(childId) || null;
            }

            if (targetItem) {
                activateHistoryDetailSearchItem(targetItem, modalContainer);
            }
            return;
        }

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
            updateHistoryDetailSearchSelection(modalContainer, index, { scrollIntoView: false });
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
        delete modalContainer._historyDetailSearchBuildDb;
    };
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
    if (modalContainer) {
        try {
            delete modalContainer.dataset.searchRecordTime;
        } catch (_) { }
        delete modalContainer._historyDetailSearchBuildDb;
    }

    // 隐藏搜索面板
    if (modalContainer) {
        closeHistoryDetailSearchBox(modalContainer, { clearInput: true });
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
    historyDetailSearchState.typeFilter = null;
    historyDetailSearchState.typeCounts = null;
    historyDetailSearchState.expandedDomainGroups = new Set();
    historyDetailSearchState.domainGroupHostFilters = new Map();
    historyDetailSearchState.isActive = false;
}

/**
 * 切换历史详情搜索框的显示状态
 * @param {Element} modalContainer - 模态框容器
 */
function toggleHistoryDetailSearchBox(modalContainer) {
    if (!modalContainer) return;

    const searchContainer = modalContainer.querySelector('.detail-search-container');
    const searchInput = modalContainer.querySelector('.detail-search-input');
    const searchBtn = modalContainer.querySelector('.detail-search-btn');

    if (!searchContainer) return;

    const isVisible = searchContainer.classList.contains('visible');

    if (isVisible) {
        closeHistoryDetailSearchBox(modalContainer);
    } else {
        searchContainer.classList.add('visible');
        if (searchBtn) searchBtn.classList.add('active');
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
